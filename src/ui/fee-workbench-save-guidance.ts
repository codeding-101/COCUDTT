import {escapeHtml as h} from './format.js';

export type FeeWorkbenchSaveNotice = 'CHECK_UNAVAILABLE' | 'BACKUP_UNAVAILABLE' | 'SAVE_CANCELLED' | 'SAVE_UNCONFIRMED';
const headings: Record<FeeWorkbenchSaveNotice, string> = {
  CHECK_UNAVAILABLE: '完整检查未完成：先保留页面',
  BACKUP_UNAVAILABLE: '检查备份未生成：逐份保留源文件',
  SAVE_CANCELLED: '另存已取消：源文件保存状态保持',
  SAVE_UNCONFIRMED: '另存未确认：请先核对目标文件',
};
const files = [
  ['save-project', '项目 JSON'], ['save-bill', '账单 JSON'], ['save-pair', '配对 JSON'],
  ['save-attachment', '成分附件 JSON'], ['save-precision', '精度选择 JSON'], ['save-envelope', '封套 JSON'],
] as const;
/** Fixed navigation only. Does not capture, inspect, save, import or confirm any business state. */
export function renderFeeWorkbenchSaveGuidance(notice: FeeWorkbenchSaveNotice | null): string {
  if (notice === null || !Object.hasOwn(headings, notice)) return '';
  return `<aside class="fee-envelope-confirm" data-fee-workbench-save-guidance role="region" aria-label="检查失败后的资料保存"><h3>${h(headings[notice])}</h3>
    <p>完整检查与整份工作台备份可能受同一校验或资料大小限制。请保持页面开启，逐份另存当前可导出的源文件；原资料、已有费用与回执不会因本次检查或另存而被删除。</p>
    <div class="panel-actions">${files.map(([target, label]) => `<button type="button" data-action="fee-workflow-go" data-fee-workflow-target="${target}">定位${label}另存</button>`).join('')}</div>
    <p>这些按钮只定位原另存入口，不会自动保存。资料缺失或输入无效时，原入口可能不可用；请自行记录尚未提交的输入，完成必要校验后再保存。</p>
    <p><strong>六类 JSON 不等于完整工作台备份，不包含全部未提交状态。</strong>下载发起不证明落盘，取消或失败也不代表已保存；关闭或刷新页面前，请核对需要保留的文件和输入。内部资料请勿直接发送客户。</p></aside>`;
}
