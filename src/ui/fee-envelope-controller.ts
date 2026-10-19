import type {WorkbenchStateOwner} from './workbench-state.js';
import {FEE_ENVELOPE_BYTES, FeeEnvelopeError, type FeeEnvelope, type FeeEnvelopeLease, type FeeEnvelopeLedger} from '../domain/fee-envelope.js';
import {parseFeeEnvelope, compareFeeEnvelopeRecovery, updateFeeEnvelopeSources, serializeFeeEnvelope} from '../data/fee-envelope.js';
import {copyFeeEnvelopeJson} from '../data/fee-envelope-json.js';

export const FEE_ENVELOPE_STORAGE_KEY = 'trade-cost-engine:fee-envelope-v1';
/** Adapter contract: compare + write must be one atomic operation among cooperating writers. */
export interface FeeEnvelopeStorage {
  getItem(key: string): string | null;
  compareAndSet(key: string, expected: string | null, next: string | null): boolean | Promise<boolean>;
}
export interface FeeEnvelopeControllerEnvironment {
  stateOwner?: WorkbenchStateOwner;
  storage?: FeeEnvelopeStorage;
  blocked(): boolean;
  changed(): void;
  write(name: string, text: string, mime: string): Promise<'SAVED' | 'DOWNLOAD_STARTED'>;
}
/** Native File is compatible. Decode bytes strictly here; File.text() can replace bad UTF-8. */
export type FeeEnvelopeFileSource = {size?: number; arrayBuffer(): Promise<ArrayBuffer>};
type Source = 'FILE' | 'MEMORY' | 'LOCAL';
type Current = {raw: string; envelope: FeeEnvelope};
type Preview = Current & {token: number; epoch: number; source: Source; status: string; adoptable: boolean; uncertain: boolean; separate: boolean};
type Decision = {acknowledge_unverifiable?: boolean; switch_business?: boolean; replace_unsaved?: boolean};
export type FeeEnvelopeBackup = 'CURRENT' | 'ORIGIN' | 'PREVIOUS' | 'INCOMING' | 'OBSERVED_LOCAL' | 'LIVE_LOCAL' | 'RETAINED_LOCAL' | 'LAST_WRITE' | 'LAST_CACHE_WRITE';
const lease = (a: FeeEnvelope): FeeEnvelopeLease => ({envelope_id: a.envelope_id, business_id: a.business_id, revision: a.revision, content_sha256: a.content_sha256});
const adoptableStatuses = new Set(['NO_CHANGE', 'DESCENDANT_PREVIEW_EXPLICIT_ADOPTION', 'PREVIEW_LATEST_UNVERIFIABLE', 'INCOMING_HISTORY_UNKNOWN', 'CURRENT_HISTORY_REQUIRES_REVIEW', 'SEPARATE_BUSINESS_PREVIEW']);
const aborted = (e: unknown) => e instanceof Error && e.name === 'AbortError';
function rawText(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > FEE_ENVELOPE_BYTES) throw Error('RAW_SIZE_OR_TYPE');
  for (const point of value) { const cp = point.codePointAt(0)!; if (cp >= 0xd800 && cp <= 0xdfff) throw Error('RAW_UTF16'); }
  if (new TextEncoder().encode(value).length > FEE_ENVELOPE_BYTES) throw Error('RAW_SIZE');
}
function decision(value: unknown): Decision {
  const d = copyFeeEnvelopeJson(value);
  if (!d || typeof d !== 'object' || Array.isArray(d) || Object.entries(d).some(([key, v]) => !['acknowledge_unverifiable', 'switch_business', 'replace_unsaved'].includes(key) || typeof v !== 'boolean')) throw Error('DECISION');
  return d as Decision;
}
/** Independent orchestration only. Construction never reads storage or installs source projects. */
export class FeeEnvelopeController {
  private current: Current | null = null;
  private originRaw: string | null = null;
  private previousRaw: string | null = null;
  private incomingRaw: string | null = null;
  private incomingError: string | null = null;
  private preview: Preview | null = null;
  private epoch = 0;
  private readToken = 0;
  private reading = false;
  private mutationBusy = false;
  private writeBusy = false;
  private cacheBusy = false;
  private notifying = false;
  private checkingBlocked = false;
  private savedRaw: string | null = null;
  private lastWriteRaw: string | null = null;
  private lastCacheWriteRaw: string | null = null;
  private observed = false;
  private observedRaw: string | null = null;
  private retainedLocalRaw: string | null = null;
  private protectedLocal = true;
  private storageStatus = 'UNOBSERVED';
  private message = '独立封套尚未载入；不会安装项目或写入费用。';
  constructor(private readonly env: FeeEnvelopeControllerEnvironment) {env.stateOwner?.bind(this, 'envelope-controller');}
  private blocked(): boolean {
    if (this.checkingBlocked) return true;
    this.checkingBlocked = true;
    try { return !!this.env.blocked(); } catch { return true; } finally { this.checkingBlocked = false; }
  }
  private available() { return !this.notifying && !this.blocked(); }
  private canMutate() { return !this.mutationBusy && this.available(); }
  private unchanged(epoch: number) { return epoch === this.epoch && !this.blocked() && epoch === this.epoch; }
  private notify(message?: string) {
    if (message !== undefined) this.message = message;
    if (this.notifying) return;
    this.notifying = true;
    try { this.env.changed(); } catch { this.message = '显示更新失败；内存与原文保留，请备份。'; } finally { this.notifying = false; }
  }
  private touch() { this.epoch++; this.readToken++; this.reading = false; this.preview = null; }
  private dirty() { return this.current !== null && this.savedRaw !== this.current.raw; }
  state() {
    return {
      scope: 'INDEPENDENT_FEE_ENVELOPE_CONTROLLER' as const, financial_writes: 0 as const, latest_proven: false as const,
      current: this.current ? {raw_json: this.current.raw, lease: lease(this.current.envelope), history_origin: this.current.envelope.history_origin} : null,
      origin_raw: this.originRaw, previous_raw: this.previousRaw, incoming_raw: this.incomingRaw, incoming_error: this.incomingError,
      preview: this.preview ? {token: this.preview.token, source: this.preview.source, status: this.preview.status, adoptable: this.preview.adoptable, acknowledge_unverifiable_required: this.preview.uncertain, switch_business_required: this.preview.separate, replace_unsaved_required: this.dirty() && this.preview.raw !== this.current?.raw, lease: lease(this.preview.envelope)} : null,
      dirty: this.dirty(), reading: this.reading, mutation_busy: this.mutationBusy, write_busy: this.writeBusy, cache_busy: this.cacheBusy,
      storage_status: this.storageStatus, storage_protected: this.protectedLocal, observed_local_raw: this.observedRaw,
      retained_local_raw: this.retainedLocalRaw, last_write_raw: this.lastWriteRaw, last_cache_write_raw: this.lastCacheWriteRaw, message: this.message,
    };
  }
  /** Runtime adapters must call this when their external context changes, including ABA changes. */
  invalidatePending() { this.touch(); this.notify('待处理候选已失效；当前文件与原文保持。'); }
  cancelRead() { this.readToken++; this.reading = false; this.preview = null; this.notify('读取已取消；当前文件和已捕获原文保持。'); }
  private beginRead() {
    const token = ++this.readToken, epoch = this.epoch;
    this.preview = null; this.incomingRaw = null; this.incomingError = null; this.reading = true;
    this.notify('正在核对独立候选；未安装来源或修改费用。');
    return {token, epoch};
  }
  private readCurrent(token: number, epoch: number) { return token === this.readToken && this.unchanged(epoch) && token === this.readToken; }
  private classify(envelope: FeeEnvelope, status: string) {
    if (!adoptableStatuses.has(status)) return {status, adoptable: false, uncertain: false, separate: false};
    const a = this.current?.envelope;
    if (a) {
      const business = a.business_id === envelope.business_id, identity = a.envelope_id === envelope.envelope_id;
      if (business !== identity) return {status: 'PARTIAL_IDENTITY_CONFLICT', adoptable: false, uncertain: false, separate: false};
      if (business) {
        if (envelope.revision < a.revision) status = 'OLDER_REVISION_CONFLICT';
        else if (a.history_origin !== envelope.history_origin) status = 'HISTORY_ORIGIN_CONFLICT';
        else {
          const before = JSON.parse(a.ledger_json) as FeeEnvelopeLedger, after = JSON.parse(envelope.ledger_json) as FeeEnvelopeLedger;
          if (before.genesis_ref !== after.genesis_ref || before.receipt_refs.some((ref, i) => after.receipt_refs[i] !== ref) || before.retired_cost_ids.some(id => !after.retired_cost_ids.includes(id))) status = 'HISTORY_FORK_CONFLICT';
          else if (envelope.revision === a.revision && envelope.content_sha256 !== a.content_sha256) status = 'SAME_REVISION_CONFLICT';
          else if (envelope.content_sha256 === a.content_sha256) status = 'NO_CHANGE';
        }
      } else status = 'SEPARATE_BUSINESS_PREVIEW';
    }
    const adoptable = adoptableStatuses.has(status);
    return {status, adoptable, uncertain: adoptable && (envelope.history_origin === 'UNKNOWN_IMPORTED' || !a || a.history_origin === 'UNKNOWN_IMPORTED'), separate: status === 'SEPARATE_BUSINESS_PREVIEW'};
  }
  private async prepare(raw: unknown, source: Source, token: number, epoch: number): Promise<boolean> {
    rawText(raw);
    if (!this.readCurrent(token, epoch)) return false;
    this.incomingRaw = raw;
    const envelope = await parseFeeEnvelope(raw);
    const comparison = await compareFeeEnvelopeRecovery(this.current?.raw ?? null, raw);
    if (!this.readCurrent(token, epoch)) return false;
    if (source === 'LOCAL' && this.readLocal() !== raw) { this.conflict(); return false; }
    if (!this.readCurrent(token, epoch)) return false;
    this.preview = {raw, envelope, source, token, epoch, ...this.classify(envelope, comparison.status)};
    this.notify('候选已核对；历史未知及无最新锚点仍须明确确认，冲突不能强行覆盖。');
    return true;
  }
  private finishRead(token: number) { if (token === this.readToken) { this.reading = false; this.notify(); } }
  private failRead(token: number, epoch: number, error: unknown) {
    if (token !== this.readToken || epoch !== this.epoch) return;
    this.incomingError = aborted(error) ? 'CANCELLED' : error instanceof FeeEnvelopeError ? 'VALIDATION_' + error.reason : 'INVALID_OR_UNREADABLE';
    this.notify(aborted(error) ? '读取已取消，资料保留。' : '候选读取或校验失败；当前资料和已捕获原文保留。');
  }
  async openFile(file: FeeEnvelopeFileSource): Promise<boolean> {
    if (!this.canMutate()) return false;
    const {token, epoch} = this.beginRead();
    try {
      const size = file.size;
      if (size !== undefined && (!Number.isSafeInteger(size) || size < 0 || size > FEE_ENVELOPE_BYTES)) throw new FeeEnvelopeError('FILE_SIZE');
      if (!this.readCurrent(token, epoch)) return false;
      const buffer = await file.arrayBuffer();
      if (!this.readCurrent(token, epoch)) return false;
      if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > FEE_ENVELOPE_BYTES || size !== undefined && size !== buffer.byteLength) throw new FeeEnvelopeError('FILE_BYTES_OR_SIZE');
      let raw: string;
      try { raw = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(buffer); }
      catch { throw new FeeEnvelopeError('FILE_UTF8'); }
      return await this.prepare(raw, 'FILE', token, epoch);
    } catch (error) { this.failRead(token, epoch, error); return false; } finally { this.finishRead(token); }
  }
  async previewMemory(raw: unknown): Promise<boolean> {
    if (!this.canMutate()) return false;
    const {token, epoch} = this.beginRead();
    try { return await this.prepare(raw, 'MEMORY', token, epoch); }
    catch (error) { this.failRead(token, epoch, error); return false; } finally { this.finishRead(token); }
  }
  async adoptIncoming(token: number, input: unknown = {}): Promise<boolean> {
    if (!this.canMutate() || !this.preview || token !== this.preview.token || token !== this.readToken) return false;
    const p = this.preview;
    let d: Decision;
    try { d = decision(input); } catch { return false; }
    if (!p.adoptable || p.uncertain && !d.acknowledge_unverifiable || p.separate && !d.switch_business || this.dirty() && p.raw !== this.current?.raw && !d.replace_unsaved) return false;
    this.mutationBusy = true;
    try {
      const envelope = await parseFeeEnvelope(p.raw);
      if (this.preview !== p || token !== this.readToken || !this.unchanged(p.epoch)) return false;
      if (p.source === 'LOCAL' && this.readLocal() !== p.raw) { this.conflict(); return false; }
      if (this.preview !== p || !this.readCurrent(token, p.epoch)) return false;
      if (this.current && this.current.raw !== p.raw) this.previousRaw = this.current.raw;
      this.current = {raw: p.raw, envelope}; this.originRaw = p.raw;
      this.savedRaw = p.source === 'FILE' ? p.raw : null;
      this.touch();
      if (p.source === 'LOCAL') { this.observed = true; this.observedRaw = p.raw; this.protectedLocal = false; this.storageStatus = 'READY'; }
      this.notify('已明确采用独立封套；未安装项目/附件，不证明最新版本或真实业务。');
      return true;
    } catch { this.notify('采用失败；当前资料和候选原文保留。'); return false; }
    finally { this.mutationBusy = false; this.notify(); }
  }
  async updateSources(expected: FeeEnvelopeLease, input: unknown): Promise<boolean> {
    if (!this.canMutate() || !this.current) return false;
    let captured: unknown, expectedLease: FeeEnvelopeLease;
    try { captured = copyFeeEnvelopeJson(input); expectedLease = copyFeeEnvelopeJson(expected) as FeeEnvelopeLease; } catch { return false; }
    const current = this.current, epoch = this.epoch;
    this.mutationBusy = true;
    try {
      const envelope = await updateFeeEnvelopeSources(current.envelope, expectedLease, captured);
      if (!this.unchanged(epoch) || this.current !== current) return false;
      if (envelope.content_sha256 === current.envelope.content_sha256) { this.notify('来源未变，原文件排版和保存状态保持。'); return true; }
      const raw = await serializeFeeEnvelope(envelope);
      if (!this.unchanged(epoch) || this.current !== current) return false;
      this.current = {raw, envelope}; this.touch(); this.notify('来源已更新，完整旧历史保持；请另存或明确写入本机缓存。');
      return true;
    } catch { this.notify('来源更新未通过校验；当前文件和历史保留。'); return false; }
    finally { this.mutationBusy = false; this.notify(); }
  }
  private readLocal(): string | null {
    if (!this.env.storage) throw Error('STORAGE_UNAVAILABLE');
    const raw = this.env.storage.getItem(FEE_ENVELOPE_STORAGE_KEY);
    if (raw !== null && typeof raw !== 'string') throw Error('STORAGE_TYPE');
    return raw;
  }
  private observeLocal() {
    if (this.observed) return;
    const epoch = this.epoch, raw = this.readLocal();
    if (epoch !== this.epoch) throw Error('OBSERVATION_INTERRUPTED');
    this.observed = true; this.observedRaw = raw;
    this.protectedLocal = raw !== null; this.storageStatus = raw === null ? 'EMPTY' : 'PENDING_RECOVERY';
  }
  private conflict() { this.protectedLocal = true; this.storageStatus = 'CONFLICT'; this.touch(); this.notify('本机原文已变化；不覆盖、不合并，当前与已观察原文均保留。'); }
  async prepareLocalRecovery(): Promise<boolean> {
    if (!this.canMutate() || this.cacheBusy) return false;
    const {token, epoch} = this.beginRead();
    try {
      const raw = this.readLocal();
      if (!this.readCurrent(token, epoch)) return false;
      if (this.observedRaw !== null && this.observedRaw !== raw) this.retainedLocalRaw = this.observedRaw;
      this.observed = true; this.observedRaw = raw; this.protectedLocal = raw !== null;
      this.storageStatus = raw === null ? 'EMPTY' : 'PENDING_RECOVERY';
      if (raw === null) { this.notify('没有本机封套可恢复；当前文件保持。'); return false; }
      return await this.prepare(raw, 'LOCAL', token, epoch);
    } catch (error) {
      if (token === this.readToken && epoch === this.epoch) { this.protectedLocal = true; this.storageStatus = this.env.storage ? 'INVALID_OR_UNREADABLE' : 'UNAVAILABLE'; }
      this.failRead(token, epoch, error); return false;
    } finally { this.finishRead(token); }
  }
  storageChanged(key: string) {
    if (key !== FEE_ENVELOPE_STORAGE_KEY) return;
    try { if (this.observed && this.readLocal() === this.observedRaw) return; } catch {}
    this.conflict();
  }
  /** Explicit cache action. CAS is required; there is no unsafe get/set fallback. */
  async persistCurrent(): Promise<boolean> {
    if (!this.available() || this.cacheBusy || !this.current) return false;
    const current = this.current, epoch = this.epoch;
    this.cacheBusy = true;
    try {
      this.observeLocal();
      if (this.protectedLocal) { this.notify('本机已有或不可读取的原文受保护；请先预览恢复或备份后明确移除。'); return false; }
      if (!this.unchanged(epoch)) return false;
      const expected = this.observedRaw;
      await parseFeeEnvelope(current.raw);
      if (!this.unchanged(epoch) || this.current !== current) return false;
      if (this.readLocal() !== expected) { this.conflict(); return false; }
      if (!this.unchanged(epoch)) return false;
      if (expected !== null) this.retainedLocalRaw = expected;
      this.lastCacheWriteRaw = current.raw;
      const ok = await this.env.storage!.compareAndSet(FEE_ENVELOPE_STORAGE_KEY, expected, current.raw);
      if (ok !== true) { this.conflict(); return false; }
      const after = this.readLocal();
      if (after !== current.raw) { this.conflict(); return false; }
      if (!this.unchanged(epoch)) { this.protectedLocal = true; this.storageStatus = 'WRITE_INTERRUPTED'; return false; }
      this.observedRaw = after; this.protectedLocal = false; this.storageStatus = 'READY';
      this.notify('独立封套缓存已比较写入并读回；仍须文件备份，不证明全局最新。'); return true;
    } catch { this.protectedLocal = true; this.storageStatus = this.env.storage ? 'WRITE_FAILED' : 'UNAVAILABLE'; this.notify('缓存未确认完整写入；内存与已捕获原文保留，实际缓存须重读，不自动回滚覆盖。'); return false; }
    finally { this.cacheBusy = false; this.notify(); }
  }
  async discardLocal(expected: string | null): Promise<boolean> {
    if (!this.available() || this.cacheBusy || expected !== null && typeof expected !== 'string') return false;
    const epoch = this.epoch; this.cacheBusy = true;
    try {
      if (this.readLocal() !== expected || !this.unchanged(epoch)) return false;
      if (expected !== null) this.retainedLocalRaw = expected;
      const ok = await this.env.storage!.compareAndSet(FEE_ENVELOPE_STORAGE_KEY, expected, null);
      if (ok !== true || this.readLocal() !== null) { this.conflict(); return false; }
      if (!this.unchanged(epoch)) { this.protectedLocal = true; this.storageStatus = 'WRITE_INTERRUPTED'; return false; }
      this.observed = true; this.observedRaw = null; this.protectedLocal = false; this.storageStatus = 'EMPTY'; this.touch();
      this.notify('已明确移除所选本机缓存；原文留在内存，当前封套保持。'); return true;
    } catch { this.protectedLocal = true; this.storageStatus = 'WRITE_FAILED'; this.notify('缓存移除未确认；当前资料与原文保留。'); return false; }
    finally { this.cacheBusy = false; this.notify(); }
  }
  private async write(name: string, raw: string, mime: string) {
    const result = await this.env.write(name, raw, mime);
    if (result !== 'SAVED' && result !== 'DOWNLOAD_STARTED') throw Error('WRITE_RESULT');
    return result;
  }
  async save(): Promise<boolean> {
    if (!this.available() || this.writeBusy || !this.current) return false;
    const {raw} = this.current, epoch = this.epoch;
    this.lastWriteRaw = raw; this.writeBusy = true; this.notify('正在另存点击时的完整原文，后续编辑不会混入。');
    try {
      await parseFeeEnvelope(raw);
      const result = await this.write('internal-fee-envelope.json', raw, 'application/json');
      if (result === 'SAVED' && this.unchanged(epoch) && this.current?.raw === raw) this.savedRaw = raw;
      this.notify(result === 'SAVED' ? '点击时原文已另存；后续变化仍须保存。' : '已发起下载，请确认落盘；未保存状态保持。'); return true;
    } catch (error) { this.notify(aborted(error) ? '另存已取消，原文与后续编辑保留。' : '另存失败，原文与后续编辑保留。'); return false; }
    finally { this.writeBusy = false; this.notify(); }
  }
  async backupRaw(kind: FeeEnvelopeBackup): Promise<boolean> {
    if (!this.available() || this.writeBusy) return false;
    let raw: string | null;
    try {
      switch (kind) {
        case 'CURRENT': raw = this.current?.raw ?? null; break;
        case 'ORIGIN': raw = this.originRaw; break;
        case 'PREVIOUS': raw = this.previousRaw; break;
        case 'INCOMING': raw = this.incomingRaw; break;
        case 'OBSERVED_LOCAL': raw = this.observedRaw; break;
        case 'LIVE_LOCAL': raw = this.readLocal(); break;
        case 'RETAINED_LOCAL': raw = this.retainedLocalRaw; break;
        case 'LAST_WRITE': raw = this.lastWriteRaw; break;
        case 'LAST_CACHE_WRITE': raw = this.lastCacheWriteRaw; break;
        default: return false;
      }
      if (raw === null) return false;
      rawText(raw);
    } catch { this.notify('原文不可读取、编码无效或超限；不删除或截断，请保留原文件。'); return false; }
    this.writeBusy = true; this.lastWriteRaw = raw;
    try { await this.write('internal-fee-envelope-' + kind.toLowerCase().replace(/_/g, '-') + '-raw.txt', raw, 'text/plain'); this.notify('已另存或发起完整原文备份；请确认落盘，保存状态保持。'); return true; }
    catch { this.notify('原文备份未完成；原资料保持。'); return false; }
    finally { this.writeBusy = false; this.notify(); }
  }
}
