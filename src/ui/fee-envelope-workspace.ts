import type {WorkbenchStateOwner} from './workbench-state.js';
import {FeeEnvelopeController, FEE_ENVELOPE_STORAGE_KEY, type FeeEnvelopeStorage, type FeeEnvelopeFileSource, type FeeEnvelopeBackup} from './fee-envelope-controller.js';
import {adoptLegacyFeeEnvelope, createNewFeeEnvelopeFromPair, serializeFeeEnvelope, parseFeeEnvelope, reviewFeeEnvelope} from '../data/fee-envelope.js';
import {feeEnvelopeInternalHtml, feeEnvelopeInternalWorkbook} from '../data/fee-envelope-snapshot.js';
import type {FeeEnvelopeSources} from '../domain/fee-envelope.js';
import {XLSX_MIME} from '../data/xlsx-file.js';
import {escapeHtml as h} from './format.js';
import {captureRuntimeFeeWorkbench, previewRuntimeFeeWorkbench, renderRuntimeFeeWorkbenchPreview, renderRuntimeFeeWorkbenchCandidate, type RuntimeFeeWorkbenchCapture, type RuntimeFeeWorkbenchPreview} from './fee-workbench-preview.js';
import type {RuntimeFeeApplicationRecord, RuntimeFeeCandidateSummary} from './fee-workbench-candidate.js';
import {encodeRuntimeFeeBackup} from '../data/runtime-fee-backup.js';

export interface FeeEnvelopeWorkspaceEnvironment {
  stateOwner?: WorkbenchStateOwner;
  storage: FeeEnvelopeStorage; cacheWritable: boolean;
  currentSources(): FeeEnvelopeSources | null; blocked(): boolean;
  captureWorkbench?(): RuntimeFeeWorkbenchCapture;
  prepareCandidate?(preview: RuntimeFeeWorkbenchPreview): Promise<{summary: RuntimeFeeCandidateSummary; backup_json: string}>;
  applyCandidate?(summary: RuntimeFeeCandidateSummary, active: () => boolean): Promise<RuntimeFeeApplicationRecord>;
  discardCandidate?(summary: RuntimeFeeCandidateSummary): void;
  afterApply?(): void;
  applicationDisplayFailed?(): void;
  write(name: string, data: string | Uint8Array<ArrayBuffer>, mime: string): Promise<'SAVED' | 'DOWNLOAD_STARTED'>;
}
type Pending = {action: string; token: string; basis: string; sources: FeeEnvelopeSources | null; raw?: string | null; name: string};
const backups: Record<string, {kind: FeeEnvelopeBackup; label: string}> = {
  'backup-current': {kind: 'CURRENT', label: '备份当前原文'}, 'backup-origin': {kind: 'ORIGIN', label: '备份最初采用原文'},
  'backup-previous': {kind: 'PREVIOUS', label: '备份上次替换原文'}, 'backup-incoming': {kind: 'INCOMING', label: '备份候选或坏JSON原文'},
  'backup-observed': {kind: 'OBSERVED_LOCAL', label: '备份已观察缓存'}, 'backup-live': {kind: 'LIVE_LOCAL', label: '备份实际缓存'},
  'backup-retained': {kind: 'RETAINED_LOCAL', label: '备份最近移除缓存'}, 'backup-write': {kind: 'LAST_WRITE', label: '备份上次文件写入原文'},
  'backup-cache-write': {kind: 'LAST_CACHE_WRITE', label: '备份上次缓存写入原文'},
};
const statuses: Record<string, string> = {NO_CHANGE: '相同内容（可能仅排版不同）', DESCENDANT_PREVIEW_EXPLICIT_ADOPTION: '本地后续修订候选，仍须明确采用', PREVIEW_LATEST_UNVERIFIABLE: '没有当前锚点，无法证明最新', INCOMING_HISTORY_UNKNOWN: '候选历史未知，不能推定未消费', CURRENT_HISTORY_REQUIRES_REVIEW: '当前历史未知，需复核', SEPARATE_BUSINESS_PREVIEW: '不同业务，须明确切换', OLDER_REVISION_CONFLICT: '旧修订冲突', SAME_REVISION_CONFLICT: '同修订内容冲突', HISTORY_FORK_CONFLICT: '历史分支冲突', HISTORY_ORIGIN_CONFLICT: '同身份历史起源冲突', PARTIAL_IDENTITY_CONFLICT: '业务/封套身份不完整一致'};
const caches: Record<string, string> = {UNOBSERVED: '尚未检查', EMPTY: '没有缓存', PENDING_RECOVERY: '已有原文，待明确恢复或备份', READY: '本次已核对缓存', CONFLICT: '原文已变化，保留两份资料', UNAVAILABLE: '当前环境不可用', INVALID_OR_UNREADABLE: '原文无效或不可读取', WRITE_FAILED: '写入未确认，请备份并重读', WRITE_INTERRUPTED: '写入期间资料变化，不能当作新版本已缓存'};

/** Independent file adoption and a separate, explicitly confirmed whole-workbench application. */
export class FeeEnvelopeWorkspace {
  readonly controller: FeeEnvelopeController;
  private pending: Pending | null = null;
  private generation = 0; private busy = false; private exporting = false; private message = ''; private businessName = '';
  private choices: Record<string, boolean> = {}; private choiceToken = -1;
  private reviewKey = ''; private reviewGeneration = 0; private reviewHtml = '';
  private workbenchResult: RuntimeFeeWorkbenchPreview | null = null;
  private workbenchCandidate: {summary: RuntimeFeeCandidateSummary; backup_json: string} | null = null;
  private workbenchConfirmation: {token: string; generation: number; summary: RuntimeFeeCandidateSummary; acknowledged: boolean} | null = null;
  private workbenchApplication: RuntimeFeeApplicationRecord | null = null;
  private workbenchGeneration = 0; private workbenchBusy = false; private workbenchMessage = '';
  constructor(private readonly env: FeeEnvelopeWorkspaceEnvironment) {
    this.controller = new FeeEnvelopeController({stateOwner:env.stateOwner,storage: env.storage, blocked: () => env.blocked() || this.busy, changed: () => {this.invalidateWorkbenchPreview(); this.refresh();}, write: (...args) => env.write(...args)});
    env.stateOwner?.bind(this, 'envelope-workspace');
  }
  private live() { try { return this.env.currentSources(); } catch { return null; } }
  workbenchCapture() {return {pending: this.pending ? structuredClone(this.pending) : null, generation: this.generation, busy: this.busy, exporting: this.exporting, business_name: this.businessName, choices: {...this.choices}};}
  private invalidateWorkbenchPreview() {this.workbenchGeneration++; if (this.workbenchResult || this.workbenchBusy) this.workbenchMessage = '资料或操作状态已变化，请重新核对完整批次；原项目保持。'; if (this.workbenchCandidate) this.env.discardCandidate?.(this.workbenchCandidate.summary); this.workbenchResult = null; this.workbenchCandidate = null; this.workbenchConfirmation = null; this.workbenchBusy = false;}
  private basis() { const s = this.controller.state(); return JSON.stringify([this.generation, s.current?.lease, s.preview?.token, this.businessName, this.live()]); }
  private button(action: string, label: string, disabled = false, extra = '') { return `<button type="button" data-action="fee-envelope-${action}"${disabled ? ' disabled' : ''}${extra}>${h(label)}</button>`; }
  render() { return `<details class="panel fee-envelope-workspace" data-evidence-section="fee-envelope"><summary><span class="panel-title">项目资料封套 · 内部交接</span></summary><div class="panel-body" data-fee-envelope-host>${this.body()}</div></details>`; }
  private body(): string {
    const s = this.controller.state(), p = s.preview, writing = s.write_busy || this.exporting, locked = this.busy || s.mutation_busy;
    if (this.choiceToken !== (p?.token ?? -1)) { this.choiceToken = p?.token ?? -1; this.choices = {}; }
    const b = (key: string, label: string, disabled = false) => this.button(key, label, disabled || locked);
    const check = (key: string, text: string) => `<label class="fee-envelope-check"><input type="checkbox" data-fee-envelope-choice="${key}"${this.choices[key] ? ' checked' : ''}>${h(text)}</label>`;
    return `<p>适用场景：把项目、账单与核对资料保存在同一份内部文件，方便交接并保留历史。采用只替换本面板文件，不安装其中的项目或附件，不写费用、利润或税基。整批费用应用须在下方单独预览并明确确认。</p>
      <p role="status" aria-live="polite" data-fee-envelope-status>${h(s.message)}</p><p data-fee-envelope-info>${s.current ? `封套 ${h(s.current.lease.envelope_id)} · 修订 ${s.current.lease.revision} · ${s.dirty ? '有待另存资料' : '已打开或另存文件'} · ${s.current.history_origin === 'UNKNOWN_IMPORTED' ? '历史未知，不能推定未消费' : '仅声明的本地历史，不证明真实业务'}` : '先打开独立文件，或从当前项目与账单生成历史未知候选。'}</p>
      <div class="panel-actions">${b('open', '打开封套 JSON')}${b('capture', '捕获当前资料为历史未知候选', !this.live())}${b('update', '更新当前封套来源（保留历史）', !s.current || !this.live())}${b('save', '另存封套 JSON', !s.current || writing)}${b('html', '导出内部审计 HTML', !s.current || writing)}${b('xlsx', '导出内部审计 Excel', !s.current || writing)}</div><input id="fee-envelope-file-input" type="file" accept=".json,application/json" hidden>
      ${s.reading ? b('cancel', '取消读取') : ''}${s.incoming_error ? `<p role="alert">候选未通过读取或校验：${h(s.incoming_error)}。原文件不被修改；已捕获文字可在备份区另存。</p>` : ''}
      ${p ? `<section class="fee-envelope-confirm" data-fee-envelope-preview><h3>待采用候选 · 修订 ${p.lease.revision}</h3><p>${h(statuses[p.status] ?? '未识别状态，禁止采用：' + p.status)}</p><p>不证明最新版本、真实订单、付款事实或全局未重复。冲突不能用确认绕过。</p>${p.adoptable ? (p.acknowledge_unverifiable_required ? check('acknowledge_unverifiable', '我已知历史或最新版本无法证明，仍明确采用该独立候选') : '') + (p.switch_business_required ? check('switch_business', '明确切换本面板业务，工作台项目保持') : '') + (p.replace_unsaved_required ? check('replace_unsaved', '已备份需要保留的资料，明确替换本面板未保存文件') : '') : ''}<div class="panel-actions">${b('adopt', '明确采用候选', !p.adoptable || p.acknowledge_unverifiable_required && !this.choices.acknowledge_unverifiable || p.switch_business_required && !this.choices.switch_business || p.replace_unsaved_required && !this.choices.replace_unsaved)}${b('cancel', '保留当前文件')}</div></section>` : ''}
      ${this.pending ? `<section class="fee-envelope-confirm" role="alert"><p>${h(({capture: '从当前完整来源生成历史未知候选，不推定未消费。', update: '更新当前封套内来源并保留旧历史，不更新工作台。', 'new-business': '复制当前配对为独立新业务候选，重建身份并撤销已知确认，不识别真实订单。', clear: '仅移除所选本机缓存，原文留在内存，当前文件保持。'} as Record<string,string>)[this.pending.action] ?? '')} 请先另存需要保留的资料。</p>${this.button('confirm', '确认执行', locked, ` data-fee-envelope-token="${this.pending.token}"`)}${b('cancel', '取消操作')}</section>` : ''}
      ${s.current ? `<div data-fee-envelope-review>${this.reviewHtml || '正在核对封套内来源与历史…'}</div>` : ''}
      ${this.env.captureWorkbench ? renderRuntimeFeeWorkbenchPreview(this.workbenchResult, this.workbenchBusy, this.workbenchMessage) : ''}
      ${renderRuntimeFeeWorkbenchCandidate(this.workbenchCandidate?.summary ?? null)}
      ${this.env.applyCandidate && this.workbenchCandidate ? `<div class="panel-actions">${this.button('workbench-arm', '核对完成，准备整批应用', this.workbenchBusy || locked || writing)}</div>` : ''}
      ${this.workbenchConfirmation ? `<section class="fee-envelope-confirm" data-fee-workbench-confirmation role="region" aria-label="确认整批费用应用"><h3>确认应用当前完整批次</h3><p>拟新增 ${this.workbenchConfirmation.summary.costs_added} 笔费用，并记录一份整批回执。原配对、成分与精度资料保留；客户报价的旧确认将撤销。仅有引用的行不会再次增加费用。</p><label class="fee-envelope-check"><input type="checkbox" data-fee-envelope-choice="apply-batch"${this.workbenchConfirmation.acknowledged ? ' checked' : ''}${this.workbenchBusy ? ' disabled' : ''}>我已核对原币金额、费用归属及税务依据，确认应用整批资料，并会重新检查客户报价和另存文件。</label><div class="panel-actions">${this.button('workbench-apply', this.workbenchBusy ? '正在重新核对并应用…' : '确认整批应用', this.workbenchBusy || !this.workbenchConfirmation.acknowledged || locked || writing, ` data-fee-envelope-apply-token="${h(this.workbenchConfirmation.token)}"`)}${this.button('workbench-cancel', '取消，保留当前项目')}</div></section>` : ''}
      ${this.workbenchApplication ? `<section data-fee-workbench-application><h3>最近一次已应用批次</h3><p>批次 ${h(this.workbenchApplication.transaction_id)}：新增 ${this.workbenchApplication.costs_added} 笔费用，引用 ${this.workbenchApplication.references_recorded} 笔已有费用，回执 1 份。后续缓存、显示或保存失败不会撤销已应用事实；不能据此再次计费。</p><p>请分别另存项目与封套，再检查客户报价。此记录属于当时批次，不表示后来修改或切换的资料仍与它一致。</p>${this.button('workbench-application-backup', '另存最近应用批次恢复备份', writing)}</section>` : ''}
      <details><summary>复制新业务候选</summary><p>仅用于明确的新业务。名称与新编号不能证明真实订单唯一；旧资料及确认按复制规则保留为待复核。</p><label>新业务名称（必填）<input data-fee-envelope-field="business-name" maxlength="120" value="${h(this.businessName)}"></label>${b('new-business', '复制当前配对为新业务封套候选', !this.businessName.trim() || !this.live()?.pair_json)}</details>
      <details><summary>本机缓存与完整原文备份</summary><p>资料仅保存在本机浏览器，清除存储会丢失。缓存不替代文件另存，不自动恢复或覆盖已有原文。${this.env.cacheWritable ? '当前环境支持协调缓存写入。' : '当前环境关闭缓存写入，可使用文件交接和只读备份。'}</p><p data-fee-envelope-cache>${h(caches[s.storage_status] ?? s.storage_status)}</p><div class="panel-actions">${b('recover', '检查本机封套缓存', s.cache_busy)}${b('persist', '明确缓存当前封套', !s.current || !this.env.cacheWritable || s.cache_busy)}${b('clear', '明确移除所选本机缓存', !this.env.cacheWritable || s.cache_busy)}${Object.entries(backups).map(([key, v]) => b(key, v.label, writing)).join('')}</div><p>备份保留完整原文，不标记文件已保存。备份槽只保留对应的最近一份，不是无限撤销。内部输出含完整来源，请勿直接发送客户；报告超限时仍可另存完整 JSON。</p></details><p data-fee-envelope-export role="status">${h(this.message)}</p>`;
  }
  refresh() {
    if (typeof document === 'undefined') return;
    const host = document.querySelector<HTMLElement>('[data-fee-envelope-host]'); if (!host) return;
    const active = document.activeElement, field = active instanceof HTMLInputElement ? active.dataset.feeEnvelopeField : undefined, choice = active instanceof HTMLInputElement ? active.dataset.feeEnvelopeChoice : undefined;
    const selection = field && active instanceof HTMLInputElement ? [active.selectionStart, active.selectionEnd] as const : null;
    const workbenchOpen = host.querySelector<HTMLDetailsElement>('[data-fee-workbench-panel]')?.open;
    host.innerHTML = this.body();
    if (workbenchOpen) {const panel = host.querySelector<HTMLDetailsElement>('[data-fee-workbench-panel]'); if (panel) panel.open = true;}
    if (field || choice) { const next = host.querySelector<HTMLInputElement>(field ? '[data-fee-envelope-field="business-name"]' : `[data-fee-envelope-choice="${choice}"]`); next?.focus(); if (next && field && selection && selection[0] !== null) next.setSelectionRange(selection[0], selection[1]); }
    this.review();
  }
  afterRender() { this.externalChanged(); this.review(); }
  /** Conservative external epoch: raw input, full app render, and parent file events. */
  externalChanged() { this.invalidateWorkbenchPreview(); this.generation++; this.pending = null; this.controller.invalidatePending(); }
  field(value: string) { this.invalidateWorkbenchPreview(); this.businessName = value; this.pending = null; this.refresh(); }
  choice(key: string, checked: boolean) { if (key === 'apply-batch') {if (this.workbenchBusy) this.invalidateWorkbenchPreview(); else if (this.workbenchConfirmation) this.workbenchConfirmation = {...this.workbenchConfirmation, acknowledged: checked}; this.refresh(); return;} if (['acknowledge_unverifiable', 'switch_business', 'replace_unsaved'].includes(key)) { this.invalidateWorkbenchPreview(); this.choices[key] = checked; this.refresh(); } }
  storageChanged(key: string | null) { this.invalidateWorkbenchPreview(); if (key === null || key === FEE_ENVELOPE_STORAGE_KEY) { this.pending = null; this.controller.storageChanged(FEE_ENVELOPE_STORAGE_KEY); } else this.refresh(); }
  applicationBackup(): string | null {return this.workbenchApplication?.backup_json ?? null;}
  /** Recovery can call this even while the main interface is blocked. It never marks any source file saved. */
  async backupApplication(): Promise<boolean> {
    const raw = this.applicationBackup(); if (raw === null || this.exporting) return false;
    this.exporting = true;
    try {const status = await this.env.write('internal-fee-application-recovery.json', raw, 'application/json'); if (status !== 'SAVED' && status !== 'DOWNLOAD_STARTED') throw Error('WRITE_RESULT'); this.workbenchMessage = status === 'SAVED' ? '最近应用批次恢复备份已另存；项目与封套仍须分别保存。' : '已发起最近应用批次恢复备份下载，请确认落盘；不标记项目或封套已保存。'; return true;}
    catch {this.workbenchMessage = '恢复备份另存未完成；已应用费用与回执保持，请保留页面并重试备份。'; return false;}
    finally {this.exporting = false; if (!this.env.blocked()) {try {this.refresh();} catch {this.env.applicationDisplayFailed?.();}}}
  }
  async openFile(file: FeeEnvelopeFileSource) { if (!this.env.blocked() && !this.busy) { this.pending = null; await this.controller.openFile(file); } }
  private review() {
    const raw = this.controller.state().current?.raw_json, key = JSON.stringify([raw, this.generation]); if (key === this.reviewKey) return;
    this.reviewKey = key; const generation = ++this.reviewGeneration; this.reviewHtml = '';
    if (!raw) return;
    void parseFeeEnvelope(raw).then(async a => ({a, review: await reviewFeeEnvelope(a)})).then(({a, review}) => {
      if (generation !== this.reviewGeneration || this.controller.state().current?.raw_json !== raw) return;
      const live = this.live(), same = live !== null && JSON.stringify(live) === JSON.stringify(a.current_sources);
      this.reviewHtml = `<p data-fee-envelope-live>${same ? '工作台完整来源原文相符，仍须专业复核。' : '工作台来源不可用或不同；以下只核对封套内资料，不表示工作台已同步。'}</p><p>历史：${review.history_status === 'NOT_ESTABLISHED' ? '未知，不能推定未消费' : '本地结构已核对，不是业务认证'}；回执 ${review.receipts.length}；本地已消费来源 ${review.consumed.length}；归档 ${a.archives.length}。不重放旧回执。</p><p>封套内原始待办：${h(review.issues.join('；'))}</p><p>完整来源、回执与逐步审计请导出内部报告或另存 JSON。JSON 核对与业务资格分别保留，不自动确认税务或费用应用资格。</p>`;
      const host = typeof document === 'undefined' ? null : document.querySelector('[data-fee-envelope-review]'); if (host) host.innerHTML = this.reviewHtml;
    }).catch(() => { if (generation === this.reviewGeneration) { this.reviewHtml = '<p role="alert">核对未完成，原资料保留，请先备份。</p>'; const host = typeof document === 'undefined' ? null : document.querySelector('[data-fee-envelope-review]'); if (host) host.innerHTML = this.reviewHtml; } });
  }
  async action(action: string, data: DOMStringMap): Promise<void> {
    if (this.env.blocked()) return;
    const key = action.replace(/^fee-envelope-/, ''), s = this.controller.state();
    try {
      if (key.startsWith('workbench-')) {await this.workbenchAction(key, data); return;}
      this.invalidateWorkbenchPreview();
      if (key === 'cancel') { this.pending = null; this.generation++; this.controller.cancelRead(); return; }
      if (this.busy || s.mutation_busy) return;
      if (key === 'confirm') {
        const p = this.pending; this.pending = null;
        if (!p || p.token !== data.feeEnvelopeToken || p.basis !== this.basis()) { this.message = '确认期间资料已变化，未执行，请重新核对。'; this.refresh(); return; }
        if (p.action === 'clear') { if (this.env.cacheWritable) await this.controller.discardLocal(p.raw ?? null); return; }
        if (p.action === 'update') { if (s.current && p.sources) await this.controller.updateSources(s.current.lease, p.sources); return; }
        if (!p.sources) return;
        if (p.action === 'new-business' && !p.sources.pair_json) return;
        const generation = this.generation; this.busy = true; this.refresh();
        let raw: string;
        try { const a = p.action === 'new-business' && p.sources.pair_json ? await createNewFeeEnvelopeFromPair(p.sources.pair_json, p.name.trim(), new Date().toISOString()) : await adoptLegacyFeeEnvelope(p.sources); raw = await serializeFeeEnvelope(a); }
        finally { this.busy = false; }
        if (generation !== this.generation || p.basis !== this.basis() || this.env.blocked()) { this.message = '来源在捕获期间已变化，候选未安装；原资料保持。'; this.refresh(); return; }
        await this.controller.previewMemory(raw); return;
      }
      if (['capture', 'update', 'new-business', 'clear'].includes(key)) {
        if (key === 'clear' && !this.env.cacheWritable || key === 'new-business' && !this.businessName.trim()) return;
        const sources = this.live(); if (key !== 'clear' && !sources || key === 'new-business' && !sources?.pair_json) return;
        const raw = key === 'clear' ? this.env.storage.getItem(FEE_ENVELOPE_STORAGE_KEY) : undefined;
        this.pending = {action: key, token: crypto.randomUUID(), basis: this.basis(), sources: sources ? {...sources} : null, name: this.businessName, raw}; this.refresh(); return;
      }
      this.pending = null;
      if (key === 'open') { const input = document.querySelector<HTMLInputElement>('#fee-envelope-file-input'); if (input) { input.value = ''; input.click(); } return; }
      if (key === 'adopt') { if (s.preview) await this.controller.adoptIncoming(s.preview.token, {...this.choices}); return; }
      if (key === 'recover') { await this.controller.prepareLocalRecovery(); return; }
      if (key === 'persist') { if (this.env.cacheWritable) await this.controller.persistCurrent(); return; }
      if (key === 'save') { if (!this.exporting) await this.controller.save(); return; }
      if (key.startsWith('backup-')) { if (backups[key] && !this.exporting) await this.controller.backupRaw(backups[key].kind); return; }
      if (key === 'html' || key === 'xlsx') {
        if (!s.current || s.write_busy || this.exporting) return;
        const raw = s.current.raw_json; this.exporting = true; this.refresh();
        try { const bytes = key === 'html' ? await feeEnvelopeInternalHtml(raw) : await feeEnvelopeInternalWorkbook(raw); await this.env.write('internal-fee-envelope.' + key, bytes, key === 'html' ? 'text/html' : XLSX_MIME); this.message = '点击时封套的完整内部审计已另存或发起下载，请确认落盘；不代表当前工作台已同步。'; }
        finally { this.exporting = false; this.refresh(); }
      }
    } catch { this.busy = false; this.message = '操作未完成或报告超限，原资料保留；可先另存完整 JSON 或原文备份。'; this.refresh(); }
  }
  private async workbenchAction(key: string, data: DOMStringMap) {
    if (!this.env.captureWorkbench) return;
    if (key === 'workbench-application-backup') {await this.backupApplication(); return;}
    if (key === 'workbench-cancel') {this.invalidateWorkbenchPreview(); this.workbenchMessage = '本次预览已清除，当前项目和独立资料保持。'; this.refresh(); return;}
    if (key === 'workbench-arm') {
      if (!this.env.applyCandidate || this.workbenchBusy || this.exporting || !this.workbenchCandidate || !this.workbenchResult) return;
      if (JSON.stringify(captureRuntimeFeeWorkbench(this.env.captureWorkbench())) !== JSON.stringify(this.workbenchResult.capture)) {this.invalidateWorkbenchPreview(); this.refresh(); return;}
      this.workbenchConfirmation = {token: crypto.randomUUID(), generation: this.workbenchGeneration, summary: this.workbenchCandidate.summary, acknowledged: false}; this.refresh(); return;
    }
    if (key === 'workbench-apply') {
      if (this.workbenchBusy || !this.env.applyCandidate) return;
      const confirmation = this.workbenchConfirmation;
      if (!confirmation || confirmation.token !== data.feeEnvelopeApplyToken || !confirmation.acknowledged) {this.invalidateWorkbenchPreview(); this.workbenchMessage = '确认已失效或尚未完整勾选，未应用费用；请重新预览。'; this.refresh(); return;}
      const active = () => !this.env.blocked() && this.workbenchConfirmation === confirmation && confirmation.generation === this.workbenchGeneration && this.workbenchCandidate?.summary === confirmation.summary;
      this.workbenchBusy = true; this.refresh();
      try {await this.env.applyCandidate(confirmation.summary, active);}
      catch {if (this.workbenchConfirmation !== confirmation || confirmation.generation !== this.workbenchGeneration) return; this.invalidateWorkbenchPreview(); this.workbenchMessage = '重新核对未通过、资料变化或确认已取消；本次没有应用费用，请重新核对完整批次。'; this.refresh(); return;}
      // The root already contains the immutable applied record and backup. Display is a later effect, never a rollback.
      try {if (this.env.afterApply) this.env.afterApply(); else this.refresh();}
      catch {this.workbenchMessage = '整批费用与回执已经应用，后续显示未完成；请另存恢复备份，不要重复计费。'; try {this.env.applicationDisplayFailed?.();} catch {/* Applied memory and backup remain available. */}}
      return;
    }
    if (key === 'workbench-backup') {
      if (this.exporting) return;
      const capture = captureRuntimeFeeWorkbench(this.env.captureWorkbench());
      const raw = this.workbenchCandidate && this.workbenchResult && JSON.stringify(capture) === JSON.stringify(this.workbenchResult.capture) ? this.workbenchCandidate.backup_json : encodeRuntimeFeeBackup(JSON.stringify({kind: 'INTERNAL_RUNTIME_FEE_WORKBENCH_CHECK_BACKUP', version: '0.1', capture, preview: this.workbenchResult, financial_writes: 0, import_authority: false}, null, 2) + '\n');
      this.exporting = true; this.refresh();
      try {const status = await this.env.write('internal-fee-workbench-check.json', raw, 'application/json'); this.workbenchMessage = status === 'SAVED' ? '已另存点击时的内部检查资料；当前项目保存状态保持。' : '已发起内部检查资料下载，请确认落盘；不标记项目或封套已保存。';}
      finally {this.exporting = false; this.refresh();}
      return;
    }
    if (key !== 'workbench-preview' || this.workbenchBusy) return;
    this.invalidateWorkbenchPreview(); this.workbenchBusy = true; this.workbenchMessage = '正在核对完整来源、未提交输入、历史与整批费用。';
    const generation = ++this.workbenchGeneration;
    this.refresh();
    try {
      const capture = captureRuntimeFeeWorkbench(this.env.captureWorkbench()), basis = JSON.stringify(capture);
      const result = await previewRuntimeFeeWorkbench(capture, 'preview-' + crypto.randomUUID());
      if (generation !== this.workbenchGeneration || this.env.blocked()) return;
      const candidate = result.status === 'STAGED' && this.env.prepareCandidate ? await this.env.prepareCandidate(result) : null;
      if (generation !== this.workbenchGeneration || this.env.blocked()) return;
      if (basis !== JSON.stringify(captureRuntimeFeeWorkbench(this.env.captureWorkbench()))) {this.invalidateWorkbenchPreview(); this.workbenchMessage = '核对期间完整资料已变化，迟到预览已丢弃，请重新核对。'; return;}
      this.workbenchResult = result; this.workbenchCandidate = candidate; this.workbenchMessage = result.status === 'STAGED' ? '完整批次已准备，仅供核对；实际费用和回执尚未写入。' : '请处理以下具体待办后重新核对；当前费用保持。';
    } catch {if (generation === this.workbenchGeneration) this.workbenchMessage = '完整检查未完成；原文保留，可另存当前工作台检查备份后继续核对。';}
    finally {if (generation === this.workbenchGeneration) this.workbenchBusy = false; this.refresh();}
  }
}
