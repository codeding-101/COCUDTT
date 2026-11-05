/** Local development prototype: reading an archive never installs data or restores authority. */
import {FeeRecoveryFormat, type FeeRecoveryData} from './fee-recovery-format';
import {FEE_RECOVERY_SUPPLEMENT_FIELDS, freezeRecoveryData} from './fee-recovery-supplement';
import {feeEnvelopeSha256} from '../src/data/fee-envelope-json';

type Data = Record<string, unknown>;
export type RecoveryReviewPolicy = 'COMMITTED_DOCUMENT' | 'REVIEW_AND_REENTER' | 'REENTER_REQUIRED' | 'DISPLAY_ONLY' | 'HISTORY_ONLY' | 'NEVER_REPLAY' | 'UNKNOWN_ARCHIVE';
export const RECOVERY_REVIEW_POLICIES: Readonly<Record<RecoveryReviewPolicy, {label: string; reason: string}>> = Object.freeze({
  COMMITTED_DOCUMENT: {label: '已提交资料 · 另行校验', reason: '仅供既有独立载入路径重新校验；本面板不会安装资料或确认业务事实。'},
  REVIEW_AND_REENTER: {label: '草稿 · 核对后重新录入', reason: '保留原编辑内容，不自动提交；须在对应业务表单重新录入并通过原校验。'},
  REENTER_REQUIRED: {label: '须重新输入或选取', reason: '浏览器坏数字缓冲或未读文件内容不在档案内；空字符串和文件元数据不能补回原输入。'},
  DISPLAY_ONLY: {label: '显示偏好 · 暂不安装', reason: '仅保留历史界面偏好，不操作原页面；不能作为金额、来源或业务确认。'},
  HISTORY_ONLY: {label: '历史资料 · 仅核对', reason: '历史提示、计算、文件或保存信息不代表当前结果、实际落盘或最新业务事实。'},
  NEVER_REPLAY: {label: '旧执行资格 · 不恢复', reason: '不恢复旧候选、勾选、Promise、活动读取、补丁、缓存写入或客户批准；后续业务须重新核对。'},
  UNKNOWN_ARCHIVE: {label: '未知字段 · 只归档', reason: '完整原文继续保留，不解释未知扩展，也不把它转换为运行字段。'},
});
export const RECOVERY_REVIEW_ROW_LIMIT = 1024;
export interface RecoveryReviewRow {
  readonly id: string; readonly path: readonly string[]; readonly policy: RecoveryReviewPolicy;
  readonly value_kind: string; readonly has_value: boolean; readonly requires_attention: boolean;
}
export interface RecoveryReviewManifest {
  readonly scope: 'INDEPENDENT_ARCHIVE_READING_MANIFEST'; readonly version: '0.1'; readonly captured_at: string;
  readonly source_sha256: string; readonly supplement_sha256: string; readonly rows: readonly RecoveryReviewRow[];
  readonly required_choice: 'OPEN_ARCHIVE_READING_ONLY'; readonly financial_writes: 0; readonly installation_authority: false;
  readonly customer_approval: false; readonly full_live_workbench_reopen: false;
}
interface Prepared {
  manifest: RecoveryReviewManifest; archive: FeeRecoveryData; values: ReadonlyMap<string, unknown>;
  generation: number; context: number; cleanup: () => void;
}
interface Current extends Prepared {read: Set<string>}
interface Operation {generation: number; context: number; controller: AbortController; external?: AbortSignal; reject: (error: Error) => void; cleanup: () => void}
const failure = (code: string) => Error('FEE_RECOVERY_REVIEW_' + code);
const record = (v: unknown): Data => v && typeof v === 'object' && !Array.isArray(v) ? v as Data : {};
const pointer = (path: readonly string[]) => '/' + path.map(s => s.replaceAll('~', '~0').replaceAll('/', '~1')).join('/');
const meaningful = (v: unknown): boolean => v !== null && v !== false && v !== '' && (Array.isArray(v) ? v.length > 0 : typeof v === 'object' ? Object.keys(v as object).length > 0 : true);
function verifiedArchive(value: FeeRecoveryData) {
  if (!value || typeof value !== 'object' || !Object.isFrozen(value)) return false;
  const d = Object.getOwnPropertyDescriptors(value), keys = ['kind','version','captured_at','source_wire','supplement_json','restoration','supplement','logical_utf8_bytes','financial_writes','import_authority','confirmation_authority','runtime_installed'];
  return Reflect.ownKeys(d).length === keys.length && keys.every(k => d[k]?.enumerable && 'value' in d[k]!) &&
    d.kind!.value === 'INTERNAL_FEE_WORKBENCH_RECOVERED_DATA' && d.version!.value === '0.1' && d.financial_writes!.value === 0 &&
    d.import_authority!.value === false && d.confirmation_authority!.value === false && d.runtime_installed!.value === false &&
    Object.isFrozen(d.restoration!.value) && Object.isFrozen(d.supplement!.value);
}

function inventory(archive: FeeRecoveryData) {
  const rows: RecoveryReviewRow[] = [], values = new Map<string, unknown>(), s = archive.supplement;
  const reenter = s.pending_control?.bad_input === true || Array.isArray(s.pending_control?.files) && s.pending_control.files.length > 0;
  function add(path: string[], value: unknown, policy: RecoveryReviewPolicy) {
    if (rows.length >= RECOVERY_REVIEW_ROW_LIMIT) throw failure('ROW_LIMIT');
    const id = pointer(path); if (values.has(id)) throw failure('DUPLICATE_PATH');
    values.set(id, value); rows.push({id, path, policy, value_kind: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
      has_value: value !== null, requires_attention: meaningful(value) && ['REVIEW_AND_REENTER', 'REENTER_REQUIRED', 'NEVER_REPLAY', 'UNKNOWN_ARCHIVE'].includes(policy)});
  }
  const pending: RecoveryReviewPolicy = reenter ? 'REENTER_REQUIRED' : 'REVIEW_AND_REENTER';
  const c = archive.restoration.capture;
  for (const [key, value] of Object.entries(c)) {
    if (key === 'retained_json') continue; // Exactly the separately decoded retained tree, not a missing field.
    if (['sources', 'fx', 'files', 'editors', 'activity'].includes(key)) {
      for (const [field, child] of Object.entries(record(value))) add(['capture', key, field], child,
        key === 'sources' || key === 'fx' ? 'COMMITTED_DOCUMENT' : key === 'files' ? 'HISTORY_ONLY' : key === 'activity' ? 'NEVER_REPLAY' : field === 'pending_input' ? pending : 'REVIEW_AND_REENTER');
    } else add(['capture', key], value, key === 'envelope_json' ? 'COMMITTED_DOCUMENT' : 'HISTORY_ONLY');
  }
  const root = record(archive.restoration.retained_root);
  const direct: Record<string, RecoveryReviewPolicy> = {
    project_raw: 'HISTORY_ONLY', project_read_epoch: 'NEVER_REPLAY', project_read_token: 'NEVER_REPLAY', settlement_epoch: 'NEVER_REPLAY',
    settlement_plan: 'REVIEW_AND_REENTER', sensitivity: 'REVIEW_AND_REENTER', customer_fields: 'REVIEW_AND_REENTER', customer_view: 'DISPLAY_ONLY',
    customer_reviewed: 'NEVER_REPLAY', pending_control: pending, storage: 'UNKNOWN_ARCHIVE',
  };
  const groups = ['project_file', 'bill', 'pair', 'tax', 'precision', 'envelope', 'tax_workspace', 'precision_workspace', 'envelope_workspace'];
  const inert = ['epoch','read_token','reading','write_busy','mutation_busy','cache_busy','preview','recovery','pending','generation','busy','exporting','export_busy','choices','protected_slots','writing_slots'];
  const history = ['name','saved_at','dirty','saved_raw_known','file_evidence','loaded','message','attachment','selection','current','source_is_current','editor_is_current','saved_content_sha256','storage_status','observed','observed_local_raw','retained_local_raw','last_write_raw','origin_raw','original','incoming_raw','incoming_error','latest_proven','lock_busy'];
  for (const [key, value] of Object.entries(root)) {
    if (groups.includes(key)) {
      for (const [field, child] of Object.entries(record(value))) add(['retained', key, field], child,
        field === 'editor' || field === 'typing' ? 'REVIEW_AND_REENTER' : inert.includes(field) ? 'NEVER_REPLAY' : history.includes(field) ? 'HISTORY_ONLY' : 'UNKNOWN_ARCHIVE');
      if (!Object.keys(record(value)).length) add(['retained', key], value, 'HISTORY_ONLY');
    } else add(['retained', key], value, Object.hasOwn(direct, key) ? direct[key]! : 'UNKNOWN_ARCHIVE');
  }
  const display = ['workspace_mode','workspace_note','input_locations','review_page','collapsed_sections','expanded_evidence_sections','business_name'];
  const never = ['recovery_review','recovery_review_epoch','recovery_review_busy','project_save_busy','project_resource_busy','settlement_busy','customer_summary_busy','customer_pdf_busy','review_key','review_generation','choices','choice_token','workbench_candidate','workbench_confirmation','workbench_generation','workbench_busy'];
  for (const [group, value] of Object.entries(s)) {
    if (Object.hasOwn(FEE_RECOVERY_SUPPLEMENT_FIELDS, group)) {
      const known = FEE_RECOVERY_SUPPLEMENT_FIELDS[group as keyof typeof FEE_RECOVERY_SUPPLEMENT_FIELDS];
      for (const [field, child] of Object.entries(record(value))) add(['supplement', group, field], child,
        !(known as readonly string[]).includes(field) ? 'UNKNOWN_ARCHIVE' : field === 'pending_calculation' ? 'REVIEW_AND_REENTER' : display.includes(field) ? 'DISPLAY_ONLY' : never.includes(field) ? 'NEVER_REPLAY' : 'HISTORY_ONLY');
    } else add(['supplement', group], value, group === 'pending_control' ? pending : group === 'pending_other' || group === 'pending_present' ? 'REVIEW_AND_REENTER' : group === 'extensions' ? 'UNKNOWN_ARCHIVE' : 'HISTORY_ONLY');
  }
  return {rows: freezeRecoveryData(rows), values};
}

/** A bounded TEXT preview; original strings, whitespace, false, null and negative zero stay untouched. */
export function previewRecoveryReviewValue(value: unknown): {readonly text: string; readonly truncated: boolean} {
  let text = '', truncated = false, nodes = 0;
  function append(part: string) {
    const left = 2000 - text.length;
    if (part.length <= left) {text += part; return;}
    let end = Math.max(0, left); if (end && /[\uD800-\uDBFF]/.test(part[end - 1]!)) end--;
    text += part.slice(0, end); truncated = true;
  }
  function walk(v: unknown, depth: number) {
    if (truncated) return;
    if (++nodes > 120 || depth > 6) {truncated = true; return;}
    if (typeof v === 'string') {append(v); return;}
    if (v === null || typeof v !== 'object') {append(Object.is(v, -0) ? '-0' : String(v)); return;}
    const array = Array.isArray(v); append(array ? '[' : '{'); let first = true;
    for (const [key, child] of Object.entries(v)) {if (truncated) break; if (!first) append(', '); first = false; if (!array) append(key + ': '); walk(child, depth + 1);}
    if (!truncated) append(array ? ']' : '}');
  }
  walk(value, 0); return Object.freeze({text, truncated});
}

/** Private one-use selection and read marks. No API in this class can apply, install, save or approve. */
export class FeeRecoveryReview {
  private generation = 0; private context = 0; private busy = false; private closed = false;
  private contextIdentity: object = Object.freeze({});
  private operation: Operation | null = null; private staged: Prepared | null = null; private active: Current | null = null;
  private physical: Promise<void> = Promise.resolve();
  private readonly issued = new WeakMap<object, Prepared>();
  constructor(private readonly format: Pick<FeeRecoveryFormat, 'decode'> = new FeeRecoveryFormat()) {}
  private available() {if (this.closed) throw failure('CLOSED');}
  private matches(op: Operation) {return !this.closed && this.operation === op && this.generation === op.generation && this.context === op.context && !op.controller.signal.aborted && !op.external?.aborted;}
  private check(op: Operation) {if (!this.matches(op)) throw failure(this.closed ? 'CLOSED' : 'CANCELLED_OR_STALE');}
  cancel() {
    this.contextIdentity = Object.freeze({});
    this.generation++; const candidate = this.staged; this.staged = null; if (candidate) {candidate.cleanup(); this.issued.delete(candidate.manifest);}
    const op = this.operation; this.operation = null; if (op) {op.cleanup(); op.reject(failure('CANCELLED_OR_STALE')); op.controller.abort();}
  }
  /** Caller-observed context changes include ABA; marks never survive them. No live app is subscribed here. */
  invalidateContext() {this.context++; this.active?.read.clear(); this.cancel();}
  current() {return this.active?.manifest ?? null;}
  pending() {return this.staged?.manifest ?? null;}
  /** Read-only identity for dependent local views. A cancelled switch never revives an old identity. */
  contextStamp(): object {return this.contextIdentity;}
  whenIdle() {return this.physical;}
  state() {
    const a = this.active, phase = this.closed ? 'CLOSED' : this.busy ? this.operation ? 'DECODING' : 'SETTLING' : this.staged ? 'STAGED' : a ? a.context === this.context ? 'OPEN' : 'STALE' : 'EMPTY';
    return freezeRecoveryData({scope: 'INDEPENDENT_ARCHIVE_READING', phase, row_count: a?.manifest.rows.length ?? 0, read_count: a?.read.size ?? 0,
      attention_count: a?.manifest.rows.filter(r => r.requires_attention).length ?? 0,
      input_reentry_required: a?.manifest.rows.some(r => r.has_value && r.policy === 'REENTER_REQUIRED') ?? false,
      financial_writes: 0, installation_authority: false, customer_reviewed: false, storage_reads: 0, storage_writes: 0, file_writes: 0,
      pending_patch_replays: 0, production_integrated: false, full_live_workbench_reopen: false});
  }
  async stage(raw: unknown, external?: AbortSignal): Promise<RecoveryReviewManifest> {
    this.available(); if (this.busy) throw failure('BUSY'); if (external?.aborted) throw failure('CANCELLED_OR_STALE'); this.cancel(); this.busy = true;
    let reject!: (error: Error) => void; const interrupted = new Promise<never>((_, no) => {reject = no;}); void interrupted.catch(() => {});
    const op: Operation = {generation: this.generation, context: this.context, controller: new AbortController(), external, reject, cleanup: () => {}};
    this.operation = op; const abort = () => {if (this.operation === op || this.staged?.generation === op.generation) this.cancel();};
    external?.addEventListener('abort', abort, {once: true}); op.cleanup = () => external?.removeEventListener('abort', abort);
    const task = (async () => {
      try {
        const archive = await this.format.decode(raw, op.controller.signal); this.check(op);
        // The real decoder validates/detaches all original fields. An injected test decoder must still return frozen data.
        if (!verifiedArchive(archive)) throw failure('INVALID_DATA'); this.check(op);
        const {rows, values} = inventory(archive), source_sha256 = await feeEnvelopeSha256(archive.source_wire), supplement_sha256 = await feeEnvelopeSha256(archive.supplement_json); this.check(op);
        const manifest: RecoveryReviewManifest = freezeRecoveryData({scope: 'INDEPENDENT_ARCHIVE_READING_MANIFEST', version: '0.1', captured_at: archive.captured_at,
          source_sha256, supplement_sha256, rows, required_choice: 'OPEN_ARCHIVE_READING_ONLY', financial_writes: 0, installation_authority: false, customer_approval: false, full_live_workbench_reopen: false});
        const prepared = {manifest, archive, values, generation: op.generation, context: op.context, cleanup: op.cleanup};
        this.check(op); this.staged = prepared; this.issued.set(manifest, prepared); return manifest;
      } catch {this.check(op); throw failure('DECODE_OR_INVENTORY_FAILED');}
      finally {if (this.staged?.generation !== op.generation) op.cleanup(); if (this.operation === op) this.operation = null; this.busy = false;}
    })(); this.physical = task.then(() => {}, () => {}); return Promise.race([task, interrupted]);
  }
  confirm(manifest: RecoveryReviewManifest, choice: 'OPEN_ARCHIVE_READING_ONLY') {
    this.available(); const p = this.issued.get(manifest);
    if (!p || this.staged !== p || p.generation !== this.generation || p.context !== this.context) throw failure('FOREIGN_CONSUMED_OR_STALE');
    if (choice !== 'OPEN_ARCHIVE_READING_ONLY') throw failure('READING_CHOICE_REQUIRED'); if (this.busy) throw failure('BUSY');
    this.issued.delete(manifest); p.cleanup(); this.staged = null; this.contextIdentity = Object.freeze({}); this.active = {...p, read: new Set()}; return manifest;
  }
  private currentRow(manifest: RecoveryReviewManifest, id: string) {
    this.available(); const a = this.active;
    if (!a || a.manifest !== manifest || a.context !== this.context || this.busy || this.staged) throw failure('FOREIGN_LOCKED_OR_STALE_REVIEW');
    if (!a.values.has(id)) throw failure('UNKNOWN_ROW'); return a;
  }
  details(manifest: RecoveryReviewManifest, id: string) {const a = this.currentRow(manifest, id); return previewRecoveryReviewValue(a.values.get(id));}
  markRead(manifest: RecoveryReviewManifest, id: string, checked: boolean, choice: 'READ_ONLY_NOT_ADOPT') {
    const a = this.currentRow(manifest, id); if (typeof checked !== 'boolean' || choice !== 'READ_ONLY_NOT_ADOPT') throw failure('READ_MARK_ONLY');
    if (checked) a.read.add(id); else a.read.delete(id);
  }
  isRead(manifest: RecoveryReviewManifest, id: string) {return this.currentRow(manifest, id).read.has(id);}
  /** The original immutable archive, for INTERNAL inspection only; no new project/envelope format. */
  archive() {return this.active?.archive ?? null;}
  dispose() {this.closed = true; this.cancel(); this.active?.read.clear();}
}
