import type {RuntimeFeeWorkbenchPreview} from './fee-workbench-preview.js';
import {runtimeFeeWorkbenchIssue} from './fee-workbench-preview.js';
import type {RuntimeFeeApplicationRecord} from './fee-workbench-candidate.js';
import {escapeHtml as h} from './format.js';

const targets = {
  bill: {section: 'container-bill', selector: '[data-evidence-section="container-bill"] > summary'},
  pair: {section: 'container-cost-pair', selector: '[data-evidence-section="container-cost-pair"] > summary'},
  attachment: {section: 'fee-tax-attachment', selector: '[data-evidence-section="fee-tax-attachment"] > summary'},
  precision: {section: 'fee-precision-selection', selector: '[data-evidence-section="fee-precision-selection"] > summary'},
  envelope: {section: 'fee-envelope', selector: '[data-evidence-section="fee-envelope"] > summary'},
  preview: {section: 'fee-envelope', selector: '[data-fee-workbench-panel] > summary'},
  guide: {section: 'fee-envelope', selector: '[data-fee-workflow-guide] > summary'},
  customer: {section: 'customer-quote', selector: '[data-evidence-section="customer-quote"] > summary'},
} as const;
export type FeeWorkflowTarget = keyof typeof targets;
/** A fixed navigation allowlist. Imported text can never become a selector or an action. */
export function feeWorkflowTarget(key: unknown) {
  return typeof key === 'string' && Object.hasOwn(targets, key) ? targets[key as FeeWorkflowTarget] : null;
}
const go = (target: FeeWorkflowTarget, label: string) => `<button type="button" data-action="fee-workflow-go" data-fee-workflow-target="${target}">${h(label)} →</button>`;
export function feeWorkflowIssueTarget(code: string): FeeWorkflowTarget {
  if (code === 'MISSING_ENVELOPE' || code === 'WORKBENCH_SOURCES_DIFFER' || code === 'HISTORY_NOT_ESTABLISHED') return 'envelope';
  if (code === 'MISSING_BILL' || code === 'ACTIVE_BILL_READ') return 'bill';
  if (code === 'UNCOMMITTED_COST' || code === 'UNCOMMITTED_REVIEW' || code === 'ACTIVE_PAIR_READ' || code === 'CURRENT_PAIR_MISSING') return 'pair';
  if (code === 'UNCOMMITTED_ATTACHMENT' || code === 'ACTIVE_ATTACHMENT_MUTATION' || code === 'CURRENT_ATTACHMENT_OR_PAIR_MISSING' || code === 'CURRENT_ATTACHMENT_PAIR_MISMATCH') return 'attachment';
  if (code === 'UNCOMMITTED_PRECISION' || code === 'ACTIVE_PRECISION_MUTATION' || code === 'CURRENT_PRECISION_OR_SOURCES_MISSING' || code === 'CURRENT_PRECISION_SOURCE_MISMATCH') return 'precision';
  // Unclassified issues retain their exact code and lead to the full check, not an invented remedy.
  return 'preview';
}
const steps: readonly {id: string; title: string; target: FeeWorkflowTarget; source?: 'bill_json' | 'pair_json' | 'attachment_json' | 'precision_json'; text: string}[] = [
  {id: 'bill', title: '账单与计费事实', target: 'bill', source: 'bill_json', text: '填写箱组、日期、免费期及计费口径，逐行核对来源。未知规则保留待办；示例来源不能作为真实账单确认。'},
  {id: 'pair', title: '配对与费用去重', target: 'pair', source: 'pair_json', text: '先核对当前项目与账单，再捕获完整修订；逐行明确新建费用或引用已有费用。检查报价内含、父项及收费范围，不凭不同名称判断没有重复。'},
  {id: 'attachment', title: '成分与税务假设', target: 'attachment', source: 'attachment_json', text: '基于当前配对新建或明确重绑附件，分别核对拆税、抵扣及海关成分来源。税务未知不填零，也不能用说明文字代替资格。'},
  {id: 'precision', title: '原币精度与换汇政策', target: 'precision', source: 'precision_json', text: '基于当前配对和附件明确选择原成分、通道及算术政策，再单独确认。政策确认不代表税务或业务资格通过；原金额保持。'},
  {id: 'envelope', title: '封套、来源与历史', target: 'envelope', text: '逐项核对封套与当前工作台的完整来源。历史未知不能通过勾选变为从未消费；复制新业务会换身份、撤销已知确认，不能用来绕过旧业务历史。'},
  {id: 'apply', title: '完整预览与整批确认', target: 'preview', text: '检查完整批次，核对原币金额及当前/候选结果，再准备确认、勾选声明并最终确认。导航、预览、下载和打开封套都不应用费用。'},
  {id: 'handoff', title: '保存与应用后交接', target: 'envelope', text: '应用后分别另存项目与封套，并备份原配对、成分、精度资料及应用恢复备份。原资料保留为历史；修订、引用改选或重绑要明确操作并重新核对，不能重放恢复备份。'},
  {id: 'customer', title: '重新核对客户报价', target: 'customer', text: '回到当前交易检查报价金额、币种、条款和完整预览，再明确客户确认并导出。应用会撤销旧确认；本导航不代表已重新确认、已导出或已发送。'},
];
/** Read-only presentation of the existing full preview. No parsing, rules, captures or state installation. */
export function renderFeeWorkflowGuide(result: RuntimeFeeWorkbenchPreview | null, busy: boolean, application: Pick<RuntimeFeeApplicationRecord, 'transaction_id' | 'costs_added' | 'references_recorded'> | null): string {
  const status = !result ? '尚无当前完整检查；资料修改后请重新检查。' : result.status === 'STAGED' ? '本次完整预览通过；尚未应用，最终确认时仍会重新校验。' : '本次检查有待办；先处理下列问题，再重新检查。';
  const presence = (step: typeof steps[number]) => {
    if (!result) return '尚未检查';
    const raw = step.source ? result.capture.sources[step.source] : step.id === 'envelope' ? result.capture.envelope_json : undefined;
    return raw === undefined ? '须单独操作' : raw === null ? '缺少资料' : '已有原文，仍须核对';
  };
  const files = result ? (['project', 'bill', 'pair', 'attachment', 'precision', 'envelope'] as const).map((key, n) => {
    const raw = key === 'envelope' ? result.capture.envelope_json : result.capture.sources[`${key}_json`], evidence = result.capture.files[key];
    const text = raw === null ? '当前无资料' : evidence.saved_raw === raw ? '与已打开 / 已另存的原文证据相同' : '缺少相同原文的打开 / 另存证据';
    return `<li>${['项目', '账单', '配对', '成分附件', '精度选择', '封套'][n]}：${h(text)}${evidence.name === null ? '；文件名未知' : `；${h(evidence.name)}`}</li>`;
  }).join('') : '';
  return `<details class="fee-workflow-guide" data-fee-workflow-guide><summary>费用工作流 · 从账单到客户重新报价</summary>
    <p>按顺序核对八步。资料存在、完整预览通过、实际应用、文件保存与客户确认是不同状态。</p>
    <p role="status" data-fee-workflow-status>${h(status)}</p><button type="button" data-action="fee-envelope-workbench-preview"${busy ? ' disabled' : ''}>${busy ? '正在检查完整批次…' : '检查当前步骤与整批候选'}</button>
    ${result?.issues.length ? `<ul class="fee-workflow-issues">${result.issues.map(code => `<li><span>${h(runtimeFeeWorkbenchIssue(code))} <small>（${h(code)}）</small></span>${go(feeWorkflowIssueTarget(code), '查看相关步骤')}</li>`).join('')}</ul>` : ''}
    <ol class="fee-workflow-steps">${steps.map(step => `<li data-fee-workflow-step="${step.id}"><div><h3>${h(step.title)}</h3><span class="fee-workflow-evidence">${h(presence(step))}</span></div><p>${h(step.text)}</p>${go(step.target, '前往核对')}</li>`).join('')}</ol>
    ${application ? `<aside data-fee-workflow-applied><strong>最近一次应用的交接提醒</strong><p>批次 ${h(application.transaction_id)} 已新增 ${application.costs_added} 笔费用、记录 ${application.references_recorded} 笔引用。这是当时的事实，不证明后来修改或切换的当前资料仍匹配。费用不会因保存失败而撤销，请勿重新计费。</p><p>先保留原资料与恢复备份，再分别另存项目、封套，最后重新核对客户报价。</p></aside>` : ''}
    <details data-fee-workflow-files><summary>六类文件的原文证据 · 上次完整检查时</summary><p>打开证据不等于本轮另存；下载发起不证明文件已落盘。此处不读取磁盘，文件名未知不补造；后续修改需重新检查。</p>${files ? `<ul>${files}</ul>` : '<p>请先检查当前步骤。</p>'}</details>
    <details data-fee-workflow-example><summary>合成题：新增与引用为什么不同</summary><p>这是一组固定手算说明，不载入交易，也不赋予来源确认。假设商业换算明确为 1 USD = 7 CNY、新增费用由买方承担、不含报价、不计入海关完税价格且无税款抵扣；其他条件保持。该汇率不是海关汇率或市场推荐，海关排除也不是通用实务判断。</p><ul><li>新增 113 USD：买方总支付增加 791 CNY（113 × 7）。</li><li>仅引用已计入的 113 USD：买方总支付增加 0，不再复制费用。</li><li>引用已有 113 USD，同时新增 20 USD：只增加 140 CNY（20 × 7）。</li></ul><p>这些条件下卖方利润保持；原利润未知仍为未知。未知历史、示例来源、非零抵扣、部分海关金额或精度损失仍会阻断，不能照抄本题解除。</p></details>
  </details>`;
}
