import {FeeApplicationTransactionError, type FeeApplicationTransactionPreview, type FeeApplicationStageResult, type FeeApplicationReplayStatus} from '../domain/fee-application-transaction.js';
import type {FeeEnvelope, FeeEnvelopeLease, FeeEnvelopeLedger, FeeEnvelopePayload, FeeEnvelopePlan, FeeEnvelopeReceipt} from '../domain/fee-envelope.js';
import {copyFeeEnvelopeJson as copy, parseFeeEnvelopeJson as json, canonicalFeeEnvelopeJson as canonical, feeEnvelopeSha256 as sha} from './fee-envelope-json.js';
import {parseFeeEnvelope, validateFeeEnvelope, serializeFeeEnvelope, reviewFeeEnvelope} from './fee-envelope.js';
import {proposeFeeApplication} from './fee-application-proposal.js';
import {parseContainerCostPair} from './container-cost-pair.js';
import type {ProjectFile} from './project-file.js';

function fail(reason: string): never { throw new FeeApplicationTransactionError(reason); }
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const descriptive = new Set(['NO_FEE_APPLICATION', 'NO_GLOBAL_DUPLICATE_PROOF', 'BUSINESS_IDENTITY_NOT_ESTABLISHED', 'HISTORY_NOT_ESTABLISHED']);
const issued = new WeakMap<object, {after_json: string; after_lease: FeeEnvelopeLease; plan_json: string}>();
export const transactionLease = (a: FeeEnvelope): FeeEnvelopeLease => ({envelope_id: a.envelope_id, business_id: a.business_id, revision: a.revision, content_sha256: a.content_sha256});
function freeze<T>(v: T): T { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function identity(v: unknown): asserts v is string { if (typeof v !== 'string' || !v.trim() || Array.from(v).length > 200 || ['__proto__', 'constructor', 'prototype'].includes(v)) fail('TRANSACTION_ID'); }
function planText(text: unknown): FeeEnvelopePlan {
  const p = json(text, 1024 * 1024) as FeeEnvelopePlan;
  const fields = 'kind version business_id transaction_id sources before_payload_ref before_ledger_ref rows'.split(' ');
  if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).length !== fields.length || fields.some(k => !Object.hasOwn(p, k)) || p.kind !== 'INTERNAL_FEE_APPLICATION_PLAN' || p.version !== '1.0') fail('PLAN');
  identity(p.business_id); identity(p.transaction_id);
  const refs = ['project_ref', 'bill_ref', 'pair_ref', 'attachment_ref', 'precision_ref'];
  if (!p.sources || typeof p.sources !== 'object' || Array.isArray(p.sources) || Object.keys(p.sources).length !== refs.length || refs.some(k => !Object.hasOwn(p.sources, k))) fail('PLAN');
  if ([p.before_payload_ref, p.before_ledger_ref, ...Object.values(p.sources)].some(v => typeof v !== 'string' || !/^[0-9a-f]{64}$/.test(v))) fail('PLAN');
  if (!Array.isArray(p.rows) || !p.rows.length || p.rows.length > 50) fail('PLAN');
  const sources = new Set<string>(), targets = new Set<string>();
  for (const r of p.rows) {
    if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).length !== 5 || ['mapping_id', 'bill_id', 'line_id', 'cost_id', 'operation'].some(k => !Object.hasOwn(r, k))) fail('PLAN');
    [r.mapping_id, r.bill_id, r.line_id, r.cost_id].forEach(identity);
    const key = canonical([r.bill_id, r.line_id]);
    if (!['CREATE_NEW', 'REFERENCE_EXISTING'].includes(r.operation) || sources.has(key) || targets.has(r.cost_id)) fail('PLAN');
    sources.add(key); targets.add(r.cost_id);
  }
  return p;
}
async function replay(a: FeeEnvelope, plan: FeeEnvelopePlan): Promise<FeeApplicationReplayStatus> {
  if (a.business_id !== plan.business_id) return 'BUSINESS_MISMATCH';
  if (a.history_origin === 'UNKNOWN_IMPORTED') return 'HISTORY_UNKNOWN';
  const audit = await reviewFeeEnvelope(a), receipt = audit.receipts.find(r => r.transaction_id === plan.transaction_id);
  if (!receipt) return 'NOT_RECORDED';
  const stored = JSON.parse(a.archives.find(b => b.sha256 === receipt.plan_ref)!.raw_json) as FeeEnvelopePlan;
  if (!same(stored, plan)) return 'TRANSACTION_ID_COLLISION';
  const after = JSON.parse(a.archives.find(b => b.sha256 === receipt.after_payload_ref)!.raw_json) as FeeEnvelopePayload;
  return audit.receipts.at(-1)?.transaction_id === plan.transaction_id && after.project_json === a.current_sources.project_json && after.bill_json === a.current_sources.bill_json ? 'ALREADY_RECORDED_NO_WRITE' : 'RECORDED_HISTORY_REQUIRES_REVIEW';
}
/** Recovery/retry inspection is read-only; a transaction ID alone never authorizes a replay. */
export async function inspectFeeApplicationReplay(envelope_json: string, plan_json: string) {
  const request = planText(plan_json), a = await parseFeeEnvelope(envelope_json);
  return {status: await replay(a, request), workbench_writes: 0 as const};
}

/** Stage the entire validated batch privately. No source installation, storage, or existing-state mutation. */
export async function prepareFeeApplicationTransaction(envelope_json: string, transaction_id: string): Promise<FeeApplicationTransactionPreview> {
  identity(transaction_id); const before_json = envelope_json, a = await parseFeeEnvelope(before_json), before_lease = transactionLease(a), s = a.current_sources;
  const issues: string[] = [], diagnostics = ['LOCAL_LINEAGE_ONLY', 'NO_GLOBAL_DUPLICATE_PROOF', 'PAYMENT_NOT_CERTIFIED', 'NO_WORKBENCH_INSTALLATION'];
  const blocked = (): FeeApplicationTransactionPreview => freeze({scope: 'INDEPENDENT_FEE_APPLICATION_PREVIEW', status: 'BLOCKED', transaction_id, before_json, before_lease, plan_json: null, issues: [...new Set(issues)], diagnostics, costs_added: 0, references_recorded: 0, workbench_writes: 0});
  if (a.history_origin !== 'NEW_DECLARED') issues.push('HISTORY_NOT_ESTABLISHED');
  if (!s.pair_json || !s.attachment_json || !s.precision_json) issues.push('COMPLETE_CURRENT_SOURCES_REQUIRED');
  if (issues.length) return blocked();
  const history = await reviewFeeEnvelope(a), ledger = JSON.parse(a.ledger_json) as FeeEnvelopeLedger;
  if (history.receipts.some(r => r.transaction_id === transaction_id)) issues.push('TRANSACTION_ALREADY_RECORDED_INSPECT_ORIGINAL_PLAN');
  if (a.revision >= 1000000000) issues.push('REVISION_LIMIT');
  if (ledger.receipt_refs.length >= 64) issues.push('RECEIPT_LIMIT');
  const audit = await proposeFeeApplication({...s, pair_json: s.pair_json!, attachment_json: s.attachment_json!, precision_json: s.precision_json!, history_json: null});
  issues.push(...audit.issues.filter(c => !descriptive.has(c)), ...audit.rows.flatMap(r => r.blockers));
  if (!audit.rows.length) issues.push('EMPTY_BATCH');
  const created = new Set(history.receipts.flatMap(r => r.rows.filter(row => row.operation === 'CREATE_NEW').map(row => row.cost_id)));
  for (const row of audit.rows) if (row.mapping.operation === 'CREATE_NEW') {
    if (history.consumed.some(c => c.key === canonical([a.business_id, row.mapping.bill_id, row.mapping.line_id]))) issues.push('SOURCE_ALREADY_CONSUMED');
    if (created.has(row.mapping.cost_id) || ledger.retired_cost_ids.includes(row.mapping.cost_id)) issues.push('TARGET_ID_USED_OR_RETIRED');
  }
  if (issues.length) return blocked();
  const after = copy(a) as FeeEnvelope;
  const archive = async (value: unknown) => {
    const raw_json = typeof value === 'string' ? value : JSON.stringify(value), sha256 = await sha(raw_json);
    const existing = after.archives.find(b => b.sha256 === sha256);
    if (existing && existing.raw_json !== raw_json) fail('ARCHIVE_COLLISION');
    if (!existing) after.archives.push({sha256, raw_json});
    return sha256;
  };
  const before_payload: FeeEnvelopePayload = {kind: 'INTERNAL_FEE_APPLICATION_PAYLOAD', version: '1.0', project_json: s.project_json, bill_json: s.bill_json};
  const before_payload_ref = await archive(before_payload), before_ledger_ref = await archive(a.ledger_json);
  const plan: FeeEnvelopePlan = {kind: 'INTERNAL_FEE_APPLICATION_PLAN', version: '1.0', business_id: a.business_id, transaction_id,
    sources: {project_ref: await archive(s.project_json), bill_ref: await archive(s.bill_json), pair_ref: await archive(s.pair_json!), attachment_ref: await archive(s.attachment_json!), precision_ref: await archive(s.precision_json!)}, before_payload_ref, before_ledger_ref, rows: audit.rows.map(r => structuredClone(r.mapping))};
  const project = json(s.project_json, 10 * 1024 * 1024) as unknown as ProjectFile, pair = parseContainerCostPair(s.pair_json!);
  for (const row of plan.rows) if (row.operation === 'CREATE_NEW') {
    const intent = pair.selection.intents.find(i => i.line_id === row.line_id);
    if (intent?.operation !== 'CREATE_NEW') fail('PLAN_INTENT');
    project.items.push(structuredClone(intent.new_cost));
  }
  const costs_added = plan.rows.filter(r => r.operation === 'CREATE_NEW').length;
  // A reference-only receipt does not reformat either financial source.
  const after_payload = {...before_payload, project_json: costs_added ? JSON.stringify(project, null, 2) + '\n' : s.project_json};
  const after_payload_ref = await archive(after_payload), plan_json = JSON.stringify(plan);
  const body = {kind: 'INTERNAL_FEE_APPLICATION_RECEIPT' as const, version: '1.0' as const, business_id: a.business_id, transaction_id, sequence: ledger.receipt_refs.length + 1, previous_sha256: ledger.receipt_refs.at(-1) ?? ledger.genesis_ref, plan_ref: await archive(plan_json), before_payload_ref, after_payload_ref, before_ledger_ref, rows: structuredClone(plan.rows)};
  const receipt: FeeEnvelopeReceipt = {...body, entry_sha256: await sha(canonical(body))};
  ledger.receipt_refs.push(await archive(receipt)); after.ledger_json = JSON.stringify(ledger); after.current_sources.project_json = after_payload.project_json; after.revision++;
  const {content_sha256: _, ...envelopeBody} = after; after.content_sha256 = await sha(canonical(envelopeBody));
  // Revalidate full historical closure and effective core responsibility before offering the candidate.
  const verified = await validateFeeEnvelope(after), after_json = await serializeFeeEnvelope(verified);
  const preview: FeeApplicationTransactionPreview = freeze({scope: 'INDEPENDENT_FEE_APPLICATION_PREVIEW', status: 'STAGED', transaction_id, before_json, before_lease, plan_json, issues: [], diagnostics, costs_added, references_recorded: plan.rows.length - costs_added, workbench_writes: 0});
  issued.set(preview, {after_json, after_lease: transactionLease(verified), plan_json}); return preview;
}

/** Only an issued object is a capability. Serialized/copied previews never grant a commit. */
export async function stageFeeApplicationTransaction(preview: FeeApplicationTransactionPreview, current_json: string): Promise<FeeApplicationStageResult> {
  const captured = issued.get(preview); if (!captured) fail('UNISSUED_PREVIEW');
  const current = await parseFeeEnvelope(current_json);
  if (current_json !== preview.before_json) {
    const status = await replay(current, planText(captured.plan_json));
    return freeze({status: status === 'NOT_RECORDED' ? 'STALE_CONTEXT' : status, envelope_json: null, lease: null, workbench_writes: 0});
  }
  if (!same(transactionLease(current), preview.before_lease)) fail('STALE_LEASE');
  await parseFeeEnvelope(captured.after_json);
  return freeze({status: 'STAGED', envelope_json: captured.after_json, lease: captured.after_lease, workbench_writes: 0});
}
