import type {WorkbenchPreparation, WorkbenchStateOwner} from './workbench-state.js';
import {captureRuntimeFeeWorkbench, runtimeFeeWorkbenchPreparedSnapshot, type RuntimeFeeWorkbenchCapture, type RuntimeFeeWorkbenchPreview} from './fee-workbench-preview.js';
import {parseProject, toTrade, toScenario, toScenarios} from '../data/project-file.js';
import {parseContainerBillDraft} from '../data/container-bill-file.js';
import {parseContainerCostPair, reviewContainerCostPair} from '../data/container-cost-pair.js';
import {parseFeeTaxAttachment} from '../data/fee-tax-attachment.js';
import {parseFeePrecisionSelection} from '../data/fee-precision-selection.js';
import {parseFeeEnvelope} from '../data/fee-envelope.js';
import {parseFeeEnvelopeJson} from '../data/fee-envelope-json.js';
import {analyze} from '../engine/analyze.js';
import {compare, scenarioWithDerivedInclusions} from '../engine/compare.js';
import type {FxRow} from './fx-rows.js';
import {encodeRuntimeFeeBackup} from '../data/runtime-fee-backup.js';

export interface RuntimeFeeCandidateSummary {
  scope: 'RUNTIME_FEE_WORKBENCH_PREPARED_CANDIDATE';
  transaction_id: string; participants: readonly string[]; costs_added: number; receipts_added: 1;
  base_currency: string;
  before: {seller_profit: string | null; buyer_total: string};
  after: {seller_profit: string | null; buyer_total: string};
  historical_sources: readonly string[]; runtime_financial_writes: 0; confirmation_enabled: false;
}
export interface RuntimeFeeCandidateEnvironment {
  owner: WorkbenchStateOwner;
  capture(): RuntimeFeeWorkbenchCapture;
  targets: {app: object; workflow: object; bill: object; pair: object; tax: object; precision: object; envelope: object; taxUi: object; precisionUi: object; envelopeUi: object};
}
export interface RuntimeFeeApplicationRecord {
  readonly scope: 'RUNTIME_FEE_WORKBENCH_APPLICATION';
  readonly transaction_id: string; readonly costs_added: number; readonly references_recorded: number; readonly receipts_added: 1;
  readonly base_currency: string; readonly before: RuntimeFeeCandidateSummary['before']; readonly after: RuntimeFeeCandidateSummary['after'];
  readonly backup_json: string;
}
function calculate(project: ReturnType<typeof parseProject>) {
  const trade = toTrade(project), template = toScenario(project), today = project.export_date === undefined ? {} : {today: project.export_date};
  const result = analyze({trade, scenario: scenarioWithDerivedInclusions(template, trade), taxProfile: project.tax_profile, fxBooks: project.fx_books, ...today});
  const comparison = compare({trade, template, scenarios: toScenarios(project), anchor: project.anchor, taxProfile: project.tax_profile, fxBooks: project.fx_books, ...today});
  if (result.warnings.some(w => w.level === 'ERROR')) throw Error('RUNTIME_CANDIDATE_CALCULATION');
  return {result, comparison};
}
const expectedOrder = ['app', 'workflow', 'bill', 'pair', 'tax-controller', 'precision-controller', 'envelope-controller', 'tax-workspace', 'precision-workspace', 'envelope-workspace'];
/** Prepares actual holders; only an active explicit confirmation can request the single root commit. No effects. */
export class RuntimeFeeWorkbenchCandidatePreparer {
  private readonly issued = new WeakMap<object, {updates: readonly WorkbenchPreparation[]; preview: RuntimeFeeWorkbenchPreview; basis: string; backup: string; rawBackup: string}>();
  private applying = false;
  constructor(private readonly env: RuntimeFeeCandidateEnvironment) {}
  async prepare(preview: RuntimeFeeWorkbenchPreview): Promise<RuntimeFeeCandidateSummary> {
    const basis = JSON.stringify(captureRuntimeFeeWorkbench(this.env.capture()));
    if (basis !== JSON.stringify(preview.capture)) throw Error('RUNTIME_CANDIDATE_STALE_CAPTURE');
    const snapshot = runtimeFeeWorkbenchPreparedSnapshot(preview), input = snapshot.input, s = input.sources;
    if (!snapshot.commit || !s.pair_json || !s.attachment_json || !s.precision_json) throw Error('RUNTIME_CANDIDATE_INCOMPLETE');
    const project = parseProject(s.project_json), bill = parseContainerBillDraft(s.bill_json), pair = parseContainerCostPair(s.pair_json);
    const [attachment, selection, envelope] = await Promise.all([parseFeeTaxAttachment(s.attachment_json), parseFeePrecisionSelection(s.precision_json), parseFeeEnvelope(input.envelope_json)]);
    const before = calculate(parseProject(preview.capture.sources.project_json!)), after = calculate(project);
    const t = this.env.targets, ui = {pending: null, typing: false, reviewKey: '', reviewHtml: ''};
    const updates: WorkbenchPreparation[] = [
      {target: t.app, advance: [], values: {project, fxRows: parseFeeEnvelopeJson(input.fx.rows_json) as FxRow[], result: after.result, comparison: after.comparison, error: null, ...(snapshot.commit.costs_added > 0 ? {dirty: true} : {}), status: '整批费用及回执已应用；请核对结果并另存项目与封套。', statusLevel: 'warn'}},
      {target: t.workflow, advance: ['projectReadEpoch', 'settlementEpoch', 'recoveryReviewEpoch'], values: {projectReadToken: null, pendingCalculation: false, editedControl: null, pairFxLease: input.fx.preserved_books_json === null ? null : {row_key: input.fx.preserved_row_key!, books: parseFeeEnvelopeJson(input.fx.preserved_books_json)}, customerReviewed: false, customerPreview: null, customerError: null, sensitivityAnalysis: null, sensitivityError: null, inputLocations: [], calculatedAt: '', workspaceNote: '整批费用已应用；原配对、成分和精度资料按来源复核，内部原文保留。'}},
      {target: t.bill, advance: ['epoch'], values: {draft: bill, readingToken: null}},
      {target: t.pair, advance: ['epoch'], values: {pair, review: reviewContainerCostPair(pair), editor: null, reviewEditor: null, readingToken: null, reviewCache: null, targetCache: null, copyAcknowledged: false, copyKey: null}},
      {target: t.tax, advance: ['epoch', 'readToken'], values: {attachment, editor: null, preview: null, recovery: null, readingToken: null}},
      {target: t.precision, advance: ['epoch', 'readToken'], values: {selection, editor: null, preview: null, recovery: null, readingToken: null}},
      {target: t.envelope, advance: ['epoch', 'readToken'], values: {current: {raw: input.envelope_json, envelope}, previousRaw: preview.capture.envelope_json, preview: null, reading: false}},
      {target: t.taxUi, advance: ['reviewGeneration'], values: ui},
      {target: t.precisionUi, advance: ['reviewGeneration'], values: {...ui}},
      {target: t.envelopeUi, advance: ['generation', 'reviewGeneration', 'workbenchGeneration'], values: {pending: null, choices: {}, choiceToken: -1, reviewKey: '', reviewHtml: '', workbenchResult: null, workbenchCandidate: null, workbenchBusy: false}},
    ];
    const plan = this.env.owner.prepareUpdates(updates);
    if (JSON.stringify(plan.order) !== JSON.stringify(expectedOrder) || basis !== JSON.stringify(captureRuntimeFeeWorkbench(this.env.capture()))) throw Error('RUNTIME_CANDIDATE_STALE_PREPARATION');
    const metrics = (r: typeof after.result) => Object.freeze({seller_profit: r.seller.margin?.toString() ?? null, buyer_total: r.buyer.landed_cost_with_tax.toString()});
    const summary: RuntimeFeeCandidateSummary = Object.freeze({scope: 'RUNTIME_FEE_WORKBENCH_PREPARED_CANDIDATE', transaction_id: snapshot.commit.transaction_id, participants: plan.participants, costs_added: snapshot.commit.costs_added, receipts_added: 1, base_currency: project.base_currency, before: metrics(before.result), after: metrics(after.result), historical_sources: preview.preview!.historical_sources, runtime_financial_writes: 0, confirmation_enabled: false});
    // The complete original texts occur once. References are inspection metadata, never executable/import authority.
    const ref = (path: string, operation = 'READ_JSON_TEXT') => ({kind: 'INTERNAL_PREPARED_FIELD_REFERENCE', path, operation});
    const source = (name: string) => ref('prepared_candidate.candidate.input.envelope_json/current_sources/' + name, 'PARSE_JSON');
    const refs: Record<string, Record<string, unknown>> = {
      app: {project: source('project_json'), fxRows: ref('capture.fx.rows_json', 'PARSE_JSON'), result: ref('prepared_candidate.candidate.input.envelope_json/current_sources/project_json', 'RECALCULATE_ANALYSIS'), comparison: ref('prepared_candidate.candidate.input.envelope_json/current_sources/project_json', 'RECALCULATE_COMPARISON')},
      workflow: {pairFxLease: ref('capture.fx', 'PRESERVE_EXACT_FX_LEASE')}, bill: {draft: source('bill_json')}, pair: {pair: source('pair_json'), review: ref('prepared_candidate.candidate.input.envelope_json/current_sources/pair_json', 'RECALCULATE_PAIR_REVIEW')},
      'tax-controller': {attachment: source('attachment_json')}, 'precision-controller': {selection: source('precision_json')},
      'envelope-controller': {current: ref('prepared_candidate.candidate.input.envelope_json', 'PARSE_ENVELOPE_AND_KEEP_RAW'), previousRaw: ref('capture.envelope_json')},
    };
    const rawBackup = JSON.stringify({kind: 'INTERNAL_RUNTIME_FEE_WORKBENCH_CHECK_BACKUP', version: '0.2', capture: preview.capture, prepared_candidate: {summary, candidate: {...snapshot, input: {envelope_json: input.envelope_json, sources_from: 'prepared_candidate.candidate.input.envelope_json/current_sources', unchanged_fields_from: 'capture', unchanged_fields: ['fx', 'files', 'editors', 'activity', 'retained_json']}}, pending_patches: plan.updates.map((u, i) => ({participant: plan.order[i], values: {...u.values, ...refs[plan.order[i]!]}}))}, financial_writes: 0, import_authority: false}, null, 2) + '\n';
    const backup = encodeRuntimeFeeBackup(rawBackup);
    if (new TextEncoder().encode(backup).length > 64 * 1024 * 1024) throw Error('RUNTIME_CANDIDATE_BACKUP_SIZE');
    if (basis !== JSON.stringify(captureRuntimeFeeWorkbench(this.env.capture()))) throw Error('RUNTIME_CANDIDATE_STALE_BACKUP');
    this.issued.set(summary, {updates, preview, basis, backup, rawBackup}); return summary;
  }
  backup(summary: RuntimeFeeCandidateSummary): string {const c = this.issued.get(summary); if (!c) throw Error('RUNTIME_CANDIDATE_FOREIGN_SUMMARY'); return c.backup;}
  discard(summary: RuntimeFeeCandidateSummary): void {this.issued.delete(summary);}
  /** The UI owns the active confirmation. Consume its candidate once; never install preview-era cancellation epochs. */
  async apply(summary: RuntimeFeeCandidateSummary, active: () => boolean): Promise<RuntimeFeeApplicationRecord> {
    const original = this.issued.get(summary);
    if (!original || this.applying) throw Error('RUNTIME_APPLICATION_EXPIRED_OR_BUSY');
    this.issued.delete(summary); this.applying = true;
    try {
      if (!active() || original.basis !== JSON.stringify(captureRuntimeFeeWorkbench(this.env.capture()))) throw Error('RUNTIME_APPLICATION_STALE');
      const current = await this.prepare(original.preview), fresh = this.issued.get(current)!;
      this.issued.delete(current);
      if (!active() || fresh.basis !== original.basis) throw Error('RUNTIME_APPLICATION_STALE');
      const checkpoint = this.env.owner.checkpoint(), plan = this.env.owner.prepareUpdates(fresh.updates);
      if (JSON.stringify(plan.order) !== JSON.stringify(expectedOrder)) throw Error('RUNTIME_APPLICATION_PARTICIPANTS');
      const facts = Object.freeze({scope: 'RUNTIME_FEE_WORKBENCH_APPLICATION' as const, transaction_id: current.transaction_id,
        costs_added: current.costs_added, references_recorded: original.preview.preview!.references_recorded, receipts_added: 1 as const,
        base_currency: current.base_currency, before: current.before, after: current.after});
      const appliedMessage = '整批费用及一份回执已应用。请重新核对客户报价，并分别另存项目与封套；本机缓存尚未更新。';
      const backup = JSON.parse(fresh.rawBackup);
      backup.kind = 'INTERNAL_RUNTIME_FEE_APPLICATION_BACKUP'; backup.version = '0.1'; backup.financial_writes = 1; backup.application = facts;
      // Keep compact source references, but report the latest cancellation epochs actually being installed.
      backup.prepared_candidate.pending_patches = plan.updates.map((update, i) => {
        const previous = backup.prepared_candidate.pending_patches[i].values;
        const values = Object.fromEntries(Object.entries(update.values).map(([key, value]) => [key, previous[key]?.kind === 'INTERNAL_PREPARED_FIELD_REFERENCE' ? previous[key] : value]));
        if (plan.order[i] === 'envelope-workspace') {values.workbenchApplication = {kind: 'INTERNAL_PREPARED_FIELD_REFERENCE', path: 'application', operation: 'APPLICATION_RECORD_WITH_THIS_BACKUP'}; values.workbenchConfirmation = null; values.workbenchMessage = appliedMessage;}
        return {participant: plan.order[i], values};
      });
      const backup_json = encodeRuntimeFeeBackup(JSON.stringify(backup, null, 2) + '\n');
      if (new TextEncoder().encode(backup_json).length > 64 * 1024 * 1024) throw Error('RUNTIME_APPLICATION_BACKUP_SIZE');
      const record: RuntimeFeeApplicationRecord = Object.freeze({...facts, backup_json});
      const updates = plan.updates.map(update => update.target === this.env.targets.envelopeUi ? {...update, values: {...update.values,
        workbenchConfirmation: null, workbenchApplication: record, workbenchMessage: appliedMessage}} : update);
      // All parsing, recalculation, backup construction and fresh epoch preparation precede this synchronous boundary.
      if (!active() || original.basis !== JSON.stringify(captureRuntimeFeeWorkbench(this.env.capture())) || !this.env.owner.isCurrent(checkpoint)) throw Error('RUNTIME_APPLICATION_STALE');
      if (!this.env.owner.commit(checkpoint, updates)) throw Error('RUNTIME_APPLICATION_STALE');
      return record;
    } finally {this.applying = false;}
  }
}
