/** Separate, internal, read-only panel. Archived HTML is always escaped text. */
import {escapeHtml as h} from '../src/ui/format';
import {FeeRecoveryReview, RECOVERY_REVIEW_POLICIES, type RecoveryReviewManifest, type RecoveryReviewRow} from './fee-recovery-review';

export class FeeRecoveryReviewPanel {
  private message = '先读取恢复资料，再明确选择这次核对；原工作台保持。';
  private filter = 'attention'; private revealed = new Set<string>(); private disposed = false; private operation = 0;
  private shown: RecoveryReviewManifest | null = null;
  private readonly click = (event: Event) => {
    const target = event.target; if (!(target instanceof Element) || !this.host.contains(target)) return;
    const button = target.closest<HTMLElement>('[data-review-action]'); if (!button) return;
    try {
      const action = button.dataset.reviewAction;
      if (action === 'cancel') {this.operation++; this.review.cancel(); this.message = '已取消本次候选；原核对资料与原工作台保留。';}
      if (action === 'open' && this.review.pending()) {this.review.confirm(this.review.pending()!, 'OPEN_ARCHIVE_READING_ONLY'); this.revealed.clear(); this.message = '仅核对归档内容；已阅读不代表采用、输入修复或业务批准。';}
      if (action === 'reveal' && this.shown) {const row = this.shown.rows[Number(button.dataset.row)]; if (!row) throw Error(); this.review.details(this.shown, row.id); this.revealed.has(row.id) ? this.revealed.delete(row.id) : this.revealed.add(row.id);}
    } catch {this.message = '资料或核对上下文已变化，请重新读取；当前原文保留。';}
    this.render();
  };
  private readonly change = (event: Event) => {
    const target = event.target; if (!(target instanceof Element) || !this.host.contains(target)) return;
    try {
      if (target instanceof HTMLSelectElement && target.matches('[data-review-filter]')) {this.filter = target.value;}
      if (target instanceof HTMLInputElement && target.matches('[data-review-read]') && this.shown) {
        const row = this.shown.rows[Number(target.dataset.reviewRead)]; if (!row) throw Error();
        this.review.markRead(this.shown, row.id, target.checked, 'READ_ONLY_NOT_ADOPT');
        this.message = '已记录阅读情况；须重新输入的资料和全部原业务门槛仍保持。';
      }
    } catch {this.message = '这份核对已过期，请重新读取；不会采用任何归档输入。';}
    this.render();
  };
  constructor(private readonly host: HTMLElement, readonly review = new FeeRecoveryReview()) {
    host.addEventListener('click', this.click); host.addEventListener('change', this.change); this.render();
  }
  /** Host supplies already-read LOCAL text; this panel has no upload, storage or file-picker capability. */
  async inspect(raw: unknown) {
    if (this.disposed) return;
    if (['DECODING','SETTLING'].includes(this.review.state().phase)) {this.message = '前一次读取尚未结束，请稍后重试；不会排队读取更多档案。'; this.render(); return;}
    const operation = ++this.operation, pending = this.review.stage(raw); this.message = '正在读取归档清单；原工作台保持。'; this.render();
    try {await pending; if (operation !== this.operation) return; this.message = '候选清单已生成，请明确选择；此前的核对资料仍保留。';}
    catch {if (operation !== this.operation) return; this.message = '读取或清单构建未完成；原核对资料保留，可取消后重试。';}
    finally {if (operation === this.operation) this.render(); else void this.review.whenIdle().then(() => this.render());}
  }
  invalidateContext() {this.operation++; this.review.invalidateContext(); this.revealed.clear(); this.message = '来源或界面上下文已变化，旧阅读记录已撤销；请重新读取归档。'; this.render();}
  private row(row: RecoveryReviewRow, index: number, manifest: RecoveryReviewManifest, locked: boolean) {
    const policy = RECOVERY_REVIEW_POLICIES[row.policy]; let detail = '', read = false;
    if (!locked) {read = this.review.isRead(manifest, row.id); if (this.revealed.has(row.id)) {const preview = this.review.details(manifest, row.id); detail = `<pre data-review-value>${h(preview.text)}</pre>${preview.truncated ? '<p>此处只显示受限文字预览，完整原文仍保存在原档案；未截断归档数据。</p>' : ''}`;}}
    return `<article class="reading-row" data-review-row="${index}"><p class="reading-path">${h(row.path.join(' / '))}</p><p><strong>${h(policy.label)}</strong> · ${h(row.value_kind)}${row.has_value ? '' : ' · 无值'}</p><p>${h(policy.reason)}</p><div class="reading-actions"><button type="button" data-review-action="reveal" data-row="${index}"${locked ? ' disabled' : ''}>${this.revealed.has(row.id) ? '收起原文预览' : '查看内部原文'}</button><label><input type="checkbox" data-review-read="${index}"${read ? ' checked' : ''}${locked ? ' disabled' : ''}>已阅读处理说明（不采用）</label></div>${detail}</article>`;
  }
  render() {
    if (this.disposed) return;
    const state = this.review.state(), pending = this.review.pending(), current = this.review.current(), locked = state.phase !== 'OPEN'; this.shown = current;
    const rows = current?.rows.map((row, index) => ({row, index})).filter(({row}) => this.filter === 'all' || this.filter === 'attention' && row.requires_attention || this.filter === 'drafts' && ['REVIEW_AND_REENTER', 'REENTER_REQUIRED'].includes(row.policy) || this.filter === 'archive' && ['HISTORY_ONLY', 'NEVER_REPLAY', 'UNKNOWN_ARCHIVE'].includes(row.policy)) ?? [];
    this.host.innerHTML = `<h1>恢复资料逐项核对</h1><p>本地开发原型 · 内部资料。原工作台保持；本面板不能安装数据、应用费用或批准客户报价。</p><p role="status" aria-live="polite" data-review-status>${h(this.message)}</p><div class="reading-metrics"><p>归档条目 <strong data-review-count>${state.row_count}</strong></p><p>已阅读说明 <strong data-review-read-count>${state.read_count}</strong></p><p>需留意条目 <strong>${state.attention_count}</strong></p></div><p class="reading-notice" data-review-boundary>${state.input_reentry_required ? '仍须重新输入或选取文件。' : ''}阅读记录不会清除待办，不恢复旧候选、勾选或客户确认。</p><div class="reading-actions"><button type="button" data-review-action="cancel">取消本次候选 · 保留当前资料</button></div>${pending ? `<section data-review-candidate><h2>选择本次核对资料</h2><p>捕获时间 ${h(pending.captured_at)} · ${pending.rows.length} 个条目。选择只切换独立核对面板。</p><button type="button" data-review-action="open">明确打开这份归档的核对清单</button></section>` : ''}${current ? `<p class="reading-binding">本次归档来源 SHA-256：${h(current.source_sha256)}<br>补充资料 SHA-256：${h(current.supplement_sha256)}</p><label>显示条目<select data-review-filter>${[['attention','需要留意'],['drafts','草稿与重新输入'],['archive','历史与旧资格'],['all','全部条目']].map(([value, text]) => `<option value="${value}"${this.filter === value ? ' selected' : ''}>${text}</option>`).join('')}</select></label><p>${rows.length ? `显示 ${rows.length} 个条目` : '此分类没有条目。可切换“全部条目”查看归档范围。'}</p><div data-review-rows>${rows.map(({row, index}) => this.row(row, index, current, locked)).join('')}</div>` : '<p data-review-empty>读取归档后，可先查看未提交草稿、坏数字、未读文件及旧确认的处理办法。</p>'}`;
  }
  dispose() {this.disposed = true; this.operation++; this.review.dispose(); this.host.removeEventListener('click', this.click); this.host.removeEventListener('change', this.change);}
}
