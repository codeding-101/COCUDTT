import type {RuntimeFeeWorkbenchPreview} from './fee-workbench-preview.js';
import {runtimeFeeWorkbenchIssue} from './fee-workbench-preview.js';
import type {RuntimeFeeApplicationRecord} from './fee-workbench-candidate.js';
import {escapeHtml as h} from './format.js';

const targets = {
  'save-project': {section: 'workspace-core', selector: '[data-action="save"]'},
  'save-bill': {section: 'container-bill', selector: '[data-action="bill-save"]'},
  'save-pair': {section: 'container-cost-pair', selector: '[data-action="pair-save"]'},
  'save-attachment': {section: 'fee-tax-attachment', selector: '[data-action="fee-tax-save"]'},
  'save-precision': {section: 'fee-precision-selection', selector: '[data-action="fee-precision-save"]'},
  'save-envelope': {section: 'fee-envelope', selector: '[data-action="fee-envelope-save"]'},
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
const requoteSteps: readonly {title: string; target: FeeWorkflowTarget; text: string}[] = [
  {title: '保留历史，再核对已有费用', target: 'pair', text: '先备份应用时的原资料与恢复文件。已有费用只作引用时，明确移除旧选择、核对当前账单引用，再建立新的引用映射；退休映射与原回执保留，不能再选为新增费用。'},
  {title: '成分记录明确删除、重新新增', target: 'attachment', text: '重绑当前配对后，先检查旧记录是否悬空。需要更换目标时，明确删除旧记录，再选择新映射新增；旧编号退休，不按名称迁移。逐项填写并重新核对拆税、抵扣、海关来源，新记录不继承旧确认，未知不能填零。'},
  {title: '精度政策重新选择、单独确认', target: 'precision', text: '成分附件完成后，再重绑完整双来源。明确删除失配政策、选择新成分与原通道、填写政策并单独确认；原政策编号退休。原币金额保持，政策确认不代替业务或税务资格。'},
  {title: '核对封套并检查完整批次', target: 'envelope', text: '逐项核对后，明确更新封套的当前来源，保留原历史与回执，再运行整批预览。只引用已有费用时，应为拟新增0笔且金额保持；任何待办都须处理。若需记录本次引用，仍须单独完成整批确认，预览和导航不提交。'},
  {title: '分别保存，再重新确认客户内容', target: 'customer', text: '项目、账单、配对、成分、精度和封套分别另存，并保留历史备份。检查当前客户预览的原币实际报价、币种和条款，再明确勾选公开内容确认，按需导出HTML、Excel或PDF。资料核对不自动调整合同报价，引用回执与内部成分不进入客户报价。'},
];
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
export function renderFeeWorkflowGuide(result: RuntimeFeeWorkbenchPreview | null, busy: boolean, application: Pick<RuntimeFeeApplicationRecord, 'transaction_id' | 'costs_added' | 'references_recorded'> | null, exerciseBusy = false): string {
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
    <section class="fee-workflow-exercises" data-fee-workflow-exercises><h3>用合成资料练习</h3><p>三组独立案例：新增113 USD、仅引用已有113 USD、已有113与拟新增20混合。ZIP内含六类正式JSON、核对题与文件指纹清单。全部为示例，历史未知、成分及政策待核对；下载不读取或替换当前交易，不提供来源确认。请解压并先读README，再按各面板明确打开。</p><button type="button" data-action="download-fee-exercises"${exerciseBusy ? ' disabled' : ''}>${exerciseBusy ? '正在生成或另存练习包…' : '下载合成练习包（ZIP）'}</button></section>
    <p role="status" data-fee-workflow-status>${h(status)}</p><button type="button" data-action="fee-envelope-workbench-preview"${busy ? ' disabled' : ''}>${busy ? '正在检查完整批次…' : '检查当前步骤与整批候选'}</button>
    ${result?.issues.length ? `<ul class="fee-workflow-issues">${result.issues.map(code => `<li><span>${h(runtimeFeeWorkbenchIssue(code))} <small>（${h(code)}）</small></span>${go(feeWorkflowIssueTarget(code), '查看相关步骤')}</li>`).join('')}</ul>` : ''}
    <ol class="fee-workflow-steps">${steps.map(step => `<li data-fee-workflow-step="${step.id}"><div><h3>${h(step.title)}</h3><span class="fee-workflow-evidence">${h(presence(step))}</span></div><p>${h(step.text)}</p>${go(step.target, '前往核对')}</li>`).join('')}</ol>
    ${application ? `<aside data-fee-workflow-applied><strong>最近一次应用的交接提醒</strong><p>批次 ${h(application.transaction_id)} 已新增 ${application.costs_added} 笔费用、记录 ${application.references_recorded} 笔引用。这是当时的事实，不证明后来修改或切换的当前资料仍匹配。费用不会因保存失败而撤销，请勿重新计费。</p><p>先保留原资料与恢复备份，再分别另存项目、封套，最后重新核对客户报价。</p><p>继续核对时须明确修订配对并检查已有费用引用；附件重绑会撤销来源确认，旧映射记录可能悬空，不能自动换目标。需要新目标须明确删除旧记录并新增，退休编号保留；精度重绑也须重新确认政策。</p></aside>` : ''}
    ${application ? `<details data-fee-workflow-requote><summary>应用后如何更新资料并再次报价</summary><p>以下是人工操作顺序，不代表当前资料已完成核对。保留历史、重新核对、确认引用和客户导出分别进行。</p><ol class="fee-workflow-steps">${requoteSteps.map(step => `<li><h3>${h(step.title)}</h3><p>${h(step.text)}</p>${go(step.target, '前往处理')}</li>`).join('')}</ol></details>` : ''}
    <details data-fee-workflow-files><summary>六类文件的原文证据 · 上次完整检查时</summary><p>打开证据不等于本轮另存；下载发起不证明文件已落盘。此处不读取磁盘，文件名未知不补造；后续修改需重新检查。</p>${files ? `<ul>${files}</ul>` : '<p>请先检查当前步骤。</p>'}</details>
    <details data-fee-workflow-example><summary>合成题：新增与引用为什么不同</summary><p>这是一组固定手算说明，不载入交易，也不赋予来源确认。假设商业换算明确为 1 USD = 7 CNY、新增费用由买方承担、不含报价、不计入海关完税价格且无税款抵扣；其他条件保持。该汇率不是海关汇率或市场推荐，海关排除也不是通用实务判断。</p><ul><li>新增 113 USD：买方总支付增加 791 CNY（113 × 7）。</li><li>仅引用已计入的 113 USD：买方总支付增加 0，不再复制费用。</li><li>引用已有 113 USD，同时新增 20 USD：只增加 140 CNY（20 × 7）。</li></ul><p>这些条件下卖方利润保持；原利润未知仍为未知。未知历史、示例来源、非零抵扣、部分海关金额或精度损失仍会阻断，不能照抄本题解除。</p></details>
  </details>`;
}
