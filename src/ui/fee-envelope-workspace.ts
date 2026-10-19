import {FeeEnvelopeController, FEE_ENVELOPE_STORAGE_KEY, type FeeEnvelopeStorage, type FeeEnvelopeFileSource, type FeeEnvelopeBackup} from './fee-envelope-controller.js';
import {adoptLegacyFeeEnvelope, createNewFeeEnvelopeFromPair, serializeFeeEnvelope, parseFeeEnvelope, reviewFeeEnvelope} from '../data/fee-envelope.js';
import {feeEnvelopeInternalHtml, feeEnvelopeInternalWorkbook} from '../data/fee-envelope-snapshot.js';
import type {FeeEnvelopeSources} from '../domain/fee-envelope.js';
import {XLSX_MIME} from '../data/xlsx-file.js';
import {escapeHtml as h} from './format.js';

export interface FeeEnvelopeWorkspaceEnvironment {
  storage: FeeEnvelopeStorage; cacheWritable: boolean;
  currentSources(): FeeEnvelopeSources | null; blocked(): boolean;
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

/** Independent internal panel: no source installation, global project fields, or financial writes. */
export class FeeEnvelopeWorkspace {
  readonly controller: FeeEnvelopeController;
  private pending: Pending | null = null;
  private generation = 0; private busy = false; private exporting = false; private message = ''; private businessName = '';
  private choices: Record<string, boolean> = {}; private choiceToken = -1;
  private reviewKey = ''; private reviewGeneration = 0; private reviewHtml = '';
  constructor(private readonly env: FeeEnvelopeWorkspaceEnvironment) {
    this.controller = new FeeEnvelopeController({storage: env.storage, blocked: () => env.blocked() || this.busy, changed: () => this.refresh(), write: (...args) => env.write(...args)});
  }
  private live() { try { return this.env.currentSources(); } catch { return null; } }
  private basis() { const s = this.controller.state(); return JSON.stringify([this.generation, s.current?.lease, s.preview?.token, this.businessName, this.live()]); }
  private button(action: string, label: string, disabled = false, extra = '') { return `<button type="button" data-action="fee-envelope-${action}"${disabled ? ' disabled' : ''}${extra}>${h(label)}</button>`; }
  render() { return `<details class="panel fee-envelope-workspace" data-evidence-section="fee-envelope"><summary><span class="panel-title">项目资料封套 · 内部交接</span></summary><div class="panel-body" data-fee-envelope-host>${this.body()}</div></details>`; }
  private body(): string {
    const s = this.controller.state(), p = s.preview, writing = s.write_busy || this.exporting, locked = this.busy || s.mutation_busy;
    if (this.choiceToken !== (p?.token ?? -1)) { this.choiceToken = p?.token ?? -1; this.choices = {}; }
    const b = (key: string, label: string, disabled = false) => this.button(key, label, disabled || locked);
    const check = (key: string, text: string) => `<label class="fee-envelope-check"><input type="checkbox" data-fee-envelope-choice="${key}"${this.choices[key] ? ' checked' : ''}>${h(text)}</label>`;
    return `<p>适用场景：把项目、账单与核对资料保存在同一份内部文件，方便交接并保留历史。采用只替换本面板文件，不安装其中的项目或附件，不写费用、利润或税基。</p>
      <p role="status" aria-live="polite" data-fee-envelope-status>${h(s.message)}</p><p data-fee-envelope-info>${s.current ? `封套 ${h(s.current.lease.envelope_id)} · 修订 ${s.current.lease.revision} · ${s.dirty ? '有待另存资料' : '已打开或另存文件'} · ${s.current.history_origin === 'UNKNOWN_IMPORTED' ? '历史未知，不能推定未消费' : '仅声明的本地历史，不证明真实业务'}` : '先打开独立文件，或从当前项目与账单生成历史未知候选。'}</p>
      <div class="panel-actions">${b('open', '打开封套 JSON')}${b('capture', '捕获当前资料为历史未知候选', !this.live())}${b('update', '更新当前封套来源（保留历史）', !s.current || !this.live())}${b('save', '另存封套 JSON', !s.current || writing)}${b('html', '导出内部审计 HTML', !s.current || writing)}${b('xlsx', '导出内部审计 Excel', !s.current || writing)}</div><input id="fee-envelope-file-input" type="file" accept=".json,application/json" hidden>
      ${s.reading ? b('cancel', '取消读取') : ''}${s.incoming_error ? `<p role="alert">候选未通过读取或校验：${h(s.incoming_error)}。原文件不被修改；已捕获文字可在备份区另存。</p>` : ''}
      ${p ? `<section class="fee-envelope-confirm" data-fee-envelope-preview><h3>待采用候选 · 修订 ${p.lease.revision}</h3><p>${h(statuses[p.status] ?? '未识别状态，禁止采用：' + p.status)}</p><p>不证明最新版本、真实订单、付款事实或全局未重复。冲突不能用确认绕过。</p>${p.adoptable ? (p.acknowledge_unverifiable_required ? check('acknowledge_unverifiable', '我已知历史或最新版本无法证明，仍明确采用该独立候选') : '') + (p.switch_business_required ? check('switch_business', '明确切换本面板业务，工作台项目保持') : '') + (p.replace_unsaved_required ? check('replace_unsaved', '已备份需要保留的资料，明确替换本面板未保存文件') : '') : ''}<div class="panel-actions">${b('adopt', '明确采用候选', !p.adoptable || p.acknowledge_unverifiable_required && !this.choices.acknowledge_unverifiable || p.switch_business_required && !this.choices.switch_business || p.replace_unsaved_required && !this.choices.replace_unsaved)}${b('cancel', '保留当前文件')}</div></section>` : ''}
      ${this.pending ? `<section class="fee-envelope-confirm" role="alert"><p>${h(({capture: '从当前完整来源生成历史未知候选，不推定未消费。', update: '更新当前封套内来源并保留旧历史，不更新工作台。', 'new-business': '复制当前配对为独立新业务候选，重建身份并撤销已知确认，不识别真实订单。', clear: '仅移除所选本机缓存，原文留在内存，当前文件保持。'} as Record<string,string>)[this.pending.action] ?? '')} 请先另存需要保留的资料。</p>${this.button('confirm', '确认执行', locked, ` data-fee-envelope-token="${this.pending.token}"`)}${b('cancel', '取消操作')}</section>` : ''}
      ${s.current ? `<div data-fee-envelope-review>${this.reviewHtml || '正在核对封套内来源与历史…'}</div>` : ''}
      <details><summary>复制新业务候选</summary><p>仅用于明确的新业务。名称与新编号不能证明真实订单唯一；旧资料及确认按复制规则保留为待复核。</p><label>新业务名称（必填）<input data-fee-envelope-field="business-name" maxlength="120" value="${h(this.businessName)}"></label>${b('new-business', '复制当前配对为新业务封套候选', !this.businessName.trim() || !this.live()?.pair_json)}</details>
      <details><summary>本机缓存与完整原文备份</summary><p>资料仅保存在本机浏览器，清除存储会丢失。缓存不替代文件另存，不自动恢复或覆盖已有原文。${this.env.cacheWritable ? '当前环境支持协调缓存写入。' : '当前环境关闭缓存写入，可使用文件交接和只读备份。'}</p><p data-fee-envelope-cache>${h(caches[s.storage_status] ?? s.storage_status)}</p><div class="panel-actions">${b('recover', '检查本机封套缓存', s.cache_busy)}${b('persist', '明确缓存当前封套', !s.current || !this.env.cacheWritable || s.cache_busy)}${b('clear', '明确移除所选本机缓存', !this.env.cacheWritable || s.cache_busy)}${Object.entries(backups).map(([key, v]) => b(key, v.label, writing)).join('')}</div><p>备份保留完整原文，不标记文件已保存。备份槽只保留对应的最近一份，不是无限撤销。内部输出含完整来源，请勿直接发送客户；报告超限时仍可另存完整 JSON。</p></details><p data-fee-envelope-export role="status">${h(this.message)}</p>`;
  }
  refresh() {
    if (typeof document === 'undefined') return;
    const host = document.querySelector<HTMLElement>('[data-fee-envelope-host]'); if (!host) return;
    const active = document.activeElement, field = active instanceof HTMLInputElement ? active.dataset.feeEnvelopeField : undefined, choice = active instanceof HTMLInputElement ? active.dataset.feeEnvelopeChoice : undefined;
    const selection = field && active instanceof HTMLInputElement ? [active.selectionStart, active.selectionEnd] as const : null;
    host.innerHTML = this.body();
    if (field || choice) { const next = host.querySelector<HTMLInputElement>(field ? '[data-fee-envelope-field="business-name"]' : `[data-fee-envelope-choice="${choice}"]`); next?.focus(); if (next && field && selection && selection[0] !== null) next.setSelectionRange(selection[0], selection[1]); }
    this.review();
  }
  afterRender() { this.externalChanged(); this.review(); }
  /** Conservative external epoch: raw input, full app render, and parent file events. */
  externalChanged() { this.generation++; this.pending = null; this.controller.invalidatePending(); }
  field(value: string) { this.businessName = value; this.pending = null; this.refresh(); }
  choice(key: string, checked: boolean) { if (['acknowledge_unverifiable', 'switch_business', 'replace_unsaved'].includes(key)) { this.choices[key] = checked; this.refresh(); } }
  storageChanged(key: string | null) { if (key === null || key === FEE_ENVELOPE_STORAGE_KEY) { this.pending = null; this.controller.storageChanged(FEE_ENVELOPE_STORAGE_KEY); } }
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
}
