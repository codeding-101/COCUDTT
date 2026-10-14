import type { RecoveryReview, RecoveryPartStatus } from '../data/recovery-review.js';
import { escapeHtml } from './format.js';
const statuses: Record<RecoveryPartStatus,string> = {
  STRUCTURE_OK:'结构可读取；未核对业务有效性', INVALID:'结构无法读取；保留原文人工核对',
  ABSENT:'快照记录为无此内容，不代表费用为零', MISSING:'字段缺失；无法确认是否已备份',
  UNSUPPORTED:'版本不受支持；不迁移、不解释',
};
export function renderRecoveryReviewPanel(review: RecoveryReview | null, busy: boolean, error: string | null): string {
  return `<details class="panel" data-evidence-section="recovery-review"><summary><span class="panel-title">内部恢复备份 · 只读检查与复原指引</span></summary><div class="panel-body">
  <p>选择内部恢复JSON，只在本机检查结构。检查不替换当前交易、不写草稿，也不恢复客户确认。备份含内部成本及客户资料，请勿发送给客户。</p>
  <button data-action="inspect-recovery">选择恢复备份（最多5 MiB）</button><button data-action="clear-recovery-review">清除检查结果</button>
  <input type="file" id="recovery-review-input" accept=".json,application/json" style="display:none" />
  ${busy?'<p role="status">正在本机读取恢复文件…</p>':''}${error?`<p class="hint" role="alert">${escapeHtml(error)}</p>`:''}
  ${review?`<div data-recovery-review-result><p>识别为内部恢复快照1.0；${review.unknownFields}个未知顶层字段保留在原文件，不参与检查。</p><ul>${review.parts.map(p=>`<li>${escapeHtml(p.label)}：${statuses[p.status]}</li>`).join('')}</ul></div>`:''}
  <p class="hint">结构可读取不表示能计算、税率有效、付款绑定一致或内容无损。原始汇率编辑行可能与项目汇率簿不同；检查不合并、转换或选择其中一套，也不重新输出原始数据。</p>
  <ol><li>保留原备份及原项目的副本，先保存当前交易；启动失败时项目内容可能为空。</li><li>有最近保存的项目时先用副本打开，逐项对照备份的项目内容和原始汇率行。没有项目文件时，按备份人工重新录入；不要把整个恢复JSON当作项目打开。</li><li>付款计划单独核对版本、绑定报价、逐笔原币金额及资金假设；未完成绑定核对前不沿用旧合计。损坏浏览器草稿仅保留原文，不回写本地存储。</li><li>假设参数和客户公开输入在本页手动填写；重新预览并检查客户报价。恢复后重新核对汇率类型/有效期、税率来源、费用和计算过程，分别保存新项目及新付款文件。</li></ol>
  <p class="hint">有独立集装箱账单时，备份另含账单和其浏览器草稿原文，仍须人工核对并另存账单1.0 JSON，不自动入费用。本入口不提供自动导入、局部文件提取或数值精度保证；检查时的JSON解析结果仅用于结构判定，原文件仍是人工复原依据。</p>
  </div></details>`;
}
