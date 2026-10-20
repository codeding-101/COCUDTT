import {FEE_WORKBENCH_FILES, FEE_WORKBENCH_EDITORS, FEE_WORKBENCH_ACTIVITY, type FeeWorkbenchInput, type FeeWorkbenchSnapshot, type FeeWorkbenchPreview, type FeeWorkbenchEffectKind, type FeeWorkbenchEffectStatus, type FeeWorkbenchEffectResult} from '../domain/fee-workbench.js';
import type {FeeEnvelope} from '../domain/fee-envelope.js';
import type {FeeApplicationTransactionPreview} from '../domain/fee-application-transaction.js';
import {FeeApplicationTransactionError} from '../domain/fee-application-transaction.js';
import {copyFeeEnvelopeJson as copy, parseFeeEnvelopeJson as json, canonicalFeeEnvelopeJson as canonical} from './fee-envelope-json.js';
import {parseFeeEnvelope} from './fee-envelope.js';
import {prepareFeeApplicationTransaction, stageFeeApplicationTransaction} from './fee-application-transaction.js';
import {validateDraftFxRows} from './project-validation.js';
import {parseProject} from './project-file.js';
import {booksToRows, rowsToBooks, type FxRow} from '../ui/fx-rows.js';

function fail(reason: string): never {throw new FeeApplicationTransactionError('WORKBENCH_' + reason);}
function freeze<T>(value: T): T {if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);} return value;}
function shape(value: unknown, fields: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some(k => !Object.hasOwn(value, k))) fail('SHAPE');
}
const nullableText = (v: unknown) => {if (v !== null && typeof v !== 'string') fail('TEXT');};
/** Capture every caller-owned value before the first await. Invalid unfinished editor text is retained. */
function capture(input: FeeWorkbenchInput): FeeWorkbenchInput {
  const c = copy(input) as FeeWorkbenchInput;
  shape(c, ['envelope_json', 'sources', 'fx', 'files', 'editors', 'activity', 'retained_json']);
  if (typeof c.envelope_json !== 'string' || typeof c.retained_json !== 'string') fail('TEXT');
  json(c.retained_json);
  shape(c.sources, ['project_json', 'bill_json', 'pair_json', 'attachment_json', 'precision_json']);
  if (typeof c.sources.project_json !== 'string' || typeof c.sources.bill_json !== 'string') fail('SOURCES');
  for (const k of ['pair_json', 'attachment_json', 'precision_json'] as const) nullableText(c.sources[k]);
  shape(c.fx, ['rows_json', 'preserved_row_key', 'preserved_books_json']);
  if (typeof c.fx.rows_json !== 'string') fail('FX_ROWS');
  nullableText(c.fx.preserved_row_key); nullableText(c.fx.preserved_books_json);
  if ((c.fx.preserved_row_key === null) !== (c.fx.preserved_books_json === null)) fail('FX_LEASE');
  shape(c.files, FEE_WORKBENCH_FILES);
  for (const file of Object.values(c.files)) {shape(file, ['name', 'saved_raw', 'saved_at']); Object.values(file).forEach(nullableText);}
  shape(c.editors, FEE_WORKBENCH_EDITORS); Object.values(c.editors).forEach(nullableText);
  shape(c.activity, FEE_WORKBENCH_ACTIVITY); if (Object.values(c.activity).some(v => typeof v !== 'boolean')) fail('ACTIVITY');
  return c;
}
function readyIssues(c: FeeWorkbenchInput, a: FeeEnvelope): string[] {
  const issues: string[] = [];
  if (canonical(c.sources) !== canonical(a.current_sources)) issues.push('WORKBENCH_SOURCES_DIFFER');
  for (const [key, value] of Object.entries(c.editors)) if (value !== null) issues.push('UNCOMMITTED_' + key.toUpperCase());
  for (const [key, value] of Object.entries(c.activity)) if (value) issues.push('ACTIVE_' + key.toUpperCase());
  try {
    const rows = json(c.fx.rows_json) as FxRow[]; validateDraftFxRows(rows);
    if (rows.some(r => !r.from.trim() || !r.to.trim() || !r.rate.trim())) issues.push('INCOMPLETE_FX_ROWS');
    if (new Set(rows.map(r => r.row_id)).size !== rows.length) issues.push('DUPLICATE_FX_ROW_ID');
    const keys = rows.map(r => canonical([r.type, r.date, r.valid_from ?? '', r.valid_to ?? '', r.from, r.to]));
    if (new Set(keys).size !== keys.length) issues.push('DUPLICATE_FX_PAIR');
    const project = parseProject(c.sources.project_json);
    if (c.fx.preserved_books_json !== null) {
      const books = json(c.fx.preserved_books_json);
      if (c.fx.preserved_row_key !== JSON.stringify(rows) || canonical(books) !== canonical(project.fx_books) || canonical(booksToRows(books as typeof project.fx_books)) !== canonical(rows)) issues.push('STALE_FX_LEASE');
    } else if (canonical(rowsToBooks(rows)) !== canonical(project.fx_books)) issues.push('FX_ROWS_DIFFER_FROM_PROJECT');
  } catch {issues.push('INVALID_FX_OR_PROJECT');}
  return issues;
}
function snapshot(input: FeeWorkbenchInput, commit: FeeWorkbenchSnapshot['commit'] = null): FeeWorkbenchSnapshot {
  const raw = (key: typeof FEE_WORKBENCH_FILES[number]) => key === 'envelope' ? input.envelope_json : input.sources[`${key}_json`];
  return freeze({input, dirty_files: FEE_WORKBENCH_FILES.filter(key => raw(key) !== input.files[key].saved_raw), commit, requires_recompute: true as const, customer_review_valid: false as const});
}
const backup = (s: FeeWorkbenchSnapshot) => JSON.stringify({kind: 'INTERNAL_FEE_WORKBENCH_MEMORY_BACKUP', version: '0.1', snapshot: s}, null, 2) + '\n';
type Capability = {transaction: FeeApplicationTransactionPreview; before: FeeWorkbenchSnapshot; candidate: FeeWorkbenchSnapshot; backup_json: string};

/** One private owner for the entire integration snapshot. No running-app setters or implicit effects. */
export class FeeWorkbenchTransaction {
  private generation = 0;
  private blocked = false;
  private busy = false;
  private pending: FeeWorkbenchPreview | null = null;
  private readonly capabilities = new WeakMap<object, Capability>();
  private readonly committed = new WeakSet<object>();
  private readonly effectsBusy = new Set<FeeWorkbenchEffectKind>();
  private readonly effects: Partial<Record<FeeWorkbenchEffectKind, FeeWorkbenchEffectResult>> = {};
  private constructor(private current: FeeWorkbenchSnapshot, private envelope: FeeEnvelope) {}
  static async open(input: FeeWorkbenchInput) {const c = capture(input), a = await parseFeeEnvelope(c.envelope_json); return new FeeWorkbenchTransaction(snapshot(c), a);}
  private invalidate() {if (this.generation === Number.MAX_SAFE_INTEGER) fail('GENERATION_LIMIT'); this.generation++; this.pending = null;}
  state() {return Object.freeze({current: this.current, generation: this.generation, busy: this.busy, blocked: this.blocked, has_pending: this.pending !== null, effects: Object.freeze({...this.effects}), runtime_writes: 0 as const});}
  cancel() {this.invalidate();}
  setBlocked(value: boolean) {if (typeof value !== 'boolean') fail('BLOCKED_FLAG'); if (value !== this.blocked) {this.invalidate(); this.blocked = value;}}
  /** A whole capture replaces the whole state; no caller can install just the project half. */
  async replace(expected: FeeWorkbenchSnapshot, input: FeeWorkbenchInput) {
    if (expected !== this.current || this.blocked) fail('STALE_REPLACE');
    const c = capture(input); this.invalidate(); const generation = this.generation, before = this.current;
    const a = await parseFeeEnvelope(c.envelope_json), next = snapshot(c, c.envelope_json === before.input.envelope_json ? before.commit : null);
    if (generation !== this.generation || before !== this.current || this.blocked) fail('STALE_REPLACE');
    if (canonical(before.input) !== canonical(c)) {this.current = next; this.envelope = a;}
    return this.state();
  }
  async preview(transaction_id: string): Promise<FeeWorkbenchPreview> {
    if (this.blocked || this.busy) fail('BLOCKED_OR_BUSY');
    this.invalidate(); const generation = this.generation, before = this.current, issues = readyIssues(before.input, this.envelope);
    const blocked = (reasons: readonly string[], diagnostics: readonly string[] = []): FeeWorkbenchPreview => freeze({scope: 'FEE_WORKBENCH_SNAPSHOT_PREVIEW', status: 'BLOCKED', transaction_id, issues: [...reasons], diagnostics: [...diagnostics], plan_json: null, costs_added: 0, references_recorded: 0, before_sources: copy(before.input.sources) as FeeWorkbenchInput['sources'], after_sources: null, historical_sources: [], runtime_writes: 0});
    if (issues.length) return blocked(issues);
    const transaction = await prepareFeeApplicationTransaction(before.input.envelope_json, transaction_id);
    if (generation !== this.generation || before !== this.current || this.blocked) fail('STALE_PREVIEW');
    if (transaction.status !== 'STAGED') return blocked(transaction.issues, transaction.diagnostics);
    const staged = await stageFeeApplicationTransaction(transaction, before.input.envelope_json);
    if (staged.status !== 'STAGED' || !staged.envelope_json) fail('STAGING');
    const a = JSON.parse(staged.envelope_json) as FeeEnvelope;
    const candidate = snapshot(capture({...before.input, envelope_json: staged.envelope_json, sources: a.current_sources}), {transaction_id, costs_added: transaction.costs_added, receipts_added: 1});
    const backup_json = backup(candidate);
    const p: FeeWorkbenchPreview = freeze({scope: 'FEE_WORKBENCH_SNAPSHOT_PREVIEW', status: 'STAGED', transaction_id, issues: [], diagnostics: [...transaction.diagnostics], plan_json: transaction.plan_json, costs_added: transaction.costs_added, references_recorded: transaction.references_recorded, before_sources: copy(before.input.sources) as FeeWorkbenchInput['sources'], after_sources: copy(candidate.input.sources) as FeeWorkbenchInput['sources'], historical_sources: transaction.costs_added ? ['pair', 'attachment', 'precision'] : [], runtime_writes: 0});
    if (generation !== this.generation || before !== this.current || this.blocked) fail('STALE_PREVIEW');
    this.capabilities.set(p, {transaction, before, candidate, backup_json}); this.pending = p; return p;
  }
  async confirm(preview: FeeWorkbenchPreview) {
    const capability = this.capabilities.get(preview); if (!capability) fail('FOREIGN_PREVIEW');
    const result = (status: string, costs_added = 0, receipts_added = 0) => Object.freeze({status, costs_added, receipts_added, runtime_writes: 0 as const});
    if (this.blocked) return result('BLOCKED'); if (this.busy) return result('BUSY');
    if (preview !== this.pending && !this.committed.has(preview)) return result('PREVIEW_EXPIRED');
    if (readyIssues(this.current.input, this.envelope).length) return result('WORKBENCH_REQUIRES_REVIEW');
    const generation = this.generation, before = this.current; this.busy = true;
    try {
      const staged = await stageFeeApplicationTransaction(capability.transaction, before.input.envelope_json);
      if (generation !== this.generation || before !== this.current || this.blocked) return result('STALE_CONTEXT');
      if (staged.status !== 'STAGED') return result(staged.status);
      if (preview !== this.pending || capability.before !== before) return result('PREVIEW_EXPIRED');
      if (staged.envelope_json !== capability.candidate.input.envelope_json) fail('CANDIDATE_CHANGED');
      const envelope = JSON.parse(staged.envelope_json!) as FeeEnvelope;
      // All parsing, calculations, complete capture and backup preparation precede this replacement.
      this.invalidate(); this.current = capability.candidate; this.envelope = envelope; this.committed.add(preview);
      return result('APPLIED_WORKBENCH_SNAPSHOT', preview.costs_added, 1);
    } finally {this.busy = false;}
  }
  recoveryBackup() {return backup(this.current);}
  private async effect(kind: FeeWorkbenchEffectKind, task: (s: FeeWorkbenchSnapshot) => Promise<FeeWorkbenchEffectStatus>): Promise<FeeWorkbenchEffectResult> {
    const current = this.current, generation = this.generation, raw = current.input.envelope_json, backup_json = backup(current);
    const report = (status: FeeWorkbenchEffectStatus) => freeze({kind, status, stale_context: this.current !== current || this.generation !== generation, envelope_json: raw, backup_json, financial_rollback: false as const});
    if (this.blocked) return report('BLOCKED'); if (this.effectsBusy.has(kind)) return report('BUSY');
    this.effectsBusy.add(kind);
    try {const status = await task(current); const r = report(status); this.effects[kind] = r; return r;}
    catch {const r = report('FAILED'); this.effects[kind] = r; return r;}
    finally {this.effectsBusy.delete(kind);}
  }
  /** Explicit CAS, exact readback, no rollback even when the adapter wrote then threw. */
  cache(expected: string | null, adapter: {compareAndSet(expected: string | null, next: string): Promise<boolean>; read(): string | null}) {
    nullableText(expected);
    return this.effect('CACHE', async s => {if (!await adapter.compareAndSet(expected, s.input.envelope_json)) return 'CONFLICT'; return adapter.read() === s.input.envelope_json ? 'CONFIRMED' : 'UNCONFIRMED';});
  }
  render(renderer: (s: FeeWorkbenchSnapshot) => void | Promise<void>) {return this.effect('RENDER', async s => {await renderer(s); return 'CONFIRMED';});}
  async save(writer: (name: string, raw: string) => Promise<'SAVED' | 'DOWNLOAD_STARTED'>) {
    const captured = this.current;
    const result = await this.effect('FILE_SAVE', async s => {
      const saved = await writer('internal-fee-envelope.json', s.input.envelope_json);
      if (saved !== 'SAVED' && saved !== 'DOWNLOAD_STARTED') fail('SAVE_RESULT');
      return saved === 'SAVED' ? 'CONFIRMED' : 'DOWNLOAD_STARTED';
    });
    if (result.status === 'CONFIRMED' && !result.stale_context && this.current === captured) {
      const next = capture({...captured.input, files: {...captured.input.files, envelope: {name: 'internal-fee-envelope.json', saved_raw: captured.input.envelope_json, saved_at: null}}});
      this.invalidate(); this.current = snapshot(next, captured.commit);
    }
    return result;
  }
}
