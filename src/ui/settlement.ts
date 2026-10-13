import type { ProjectFile } from '../data/project-file.js';
import { settlementBinding } from '../data/settlement-context.js';
import type { SettlementPlan } from '../domain/settlement.js';
import { calculateSettlement, type SettlementResult } from '../engine/settlement.js';
import type { AnalysisResult } from '../engine/analyze.js';
import { escapeHtml } from './format.js';
import { renderFundingFields, renderFundingResult } from './funding.js';

export function renderSettlementResult(result: SettlementResult): string {
  return `<div data-settlement-result><p>合同价 ${escapeHtml(result.principal)} · 付款合计 ${escapeHtml(result.allocated)} · 对账差额 ${escapeHtml(result.difference)}（合同原币）</p>
    <table class="grid stackable"><thead><tr><th>日期</th><th>付款流向</th><th>金额/币种</th><th>条件与计算</th></tr></thead><tbody>${result.events.map(row => `<tr><th>${row.date}</th><td data-label="流向">${row.payer === 'BUYER' ? '买方' : '卖方'} → ${row.recipient === 'SELLER' ? '卖方' : '银行'} · ${row.kind === 'PRINCIPAL' ? '合同价款' : '银行费用'}</td><td data-label="金额">${escapeHtml(row.amount)} ${escapeHtml(row.currency)}</td><td data-label="条件">${escapeHtml(row.label)}<small>${escapeHtml(row.formula)}</small></td></tr>`).join('')}</tbody></table>
    <table class="grid stackable"><thead><tr><th>币种</th><th>买方付款</th><th>卖方收款</th><th>卖方银行付款</th><th>卖方收付净额</th></tr></thead><tbody>${result.totals.map(row => `<tr><th>${row.currency}</th><td data-label="买方付款">${row.buyer_outflow}</td><td data-label="卖方收款">${row.seller_inflow}</td><td data-label="银行付款">${row.seller_outflow}</td><td data-label="收付净额">${row.seller_net}</td></tr>`).join('')}</tbody></table>
    <p class="hint">这是一份合同价款与银行费用的计划，不含其他运输、保险、税款或货物采购付款；收付净额不是利润，不能代替买方落地成本。不同币种分别列示，未推定结算汇率、货币最小单位或实际到账日。百分比按原始报价精确分配，不自动舍入或补尾款；实际银行入账单位须另核。</p></div>`;
}
export function renderSettlementSnapshot(project: ProjectFile, plan: SettlementPlan, analysis: AnalysisResult | null): string {
  let result: string;
  try { result = renderSettlementResult(calculateSettlement(plan, settlementBinding(project), analysis, project.term_scenarios?.[project.incoterm]?.responsibility_overrides)); }
  catch (error) { result = `<p class="banner error">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`; }
  let funding: string;
  try { funding = renderFundingResult(plan, settlementBinding(project)); }
  catch (error) { funding = `<p class="banner error">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`; }
  return `<section class="panel"><div class="panel-body"><h2>内部付款计划快照（${plan.version}）</h2>${result}<h3>资金占用假设</h3>${funding}<p>仅计划与算术核对，不证明信用证单证相符、保证收款或条件已满足；不改变贸易术语风险转移。资金成本不改变收付净额、经营利润或落地成本。</p><pre>${escapeHtml(JSON.stringify(plan, null, 2))}</pre></div></section>`;
}
export function renderSettlementPanel(project: ProjectFile, plan: SettlementPlan | null, analysis: AnalysisResult | null, busy: boolean): string {
  const disabled = busy ? ' disabled' : '';
  const input = (kind: 'payment'|'fee', index: number, key: string, label: string, value: string) => `<label>${label}<input type="text" data-settlement-row="${kind}" data-settlement-index="${index}" data-settlement-field="${key}" value="${escapeHtml(value)}"></label>`;
  const options = (values: [string,string][], value: string) => values.map(([key,label]) => `<option value="${key}"${key === value ? ' selected' : ''}>${label}</option>`).join('');
  let html = `<p>绑定当前术语实际报价，逐笔输入约定付款日。付款安排不决定货损风险、所有权或信用风险；L/C付款条件及单证相符需另核，TT不等于已预付，OA不自动生成30/60/90天账期。</p><p class="hint">内部付款计划独立保存为JSON默认1.1（兼容读取1.0–1.4；本金/利率事件及金额舍入须显式升级），本页修改不写入项目0.8或自动草稿，刷新或打开项目后重置。请单独保存；客户文件不自动包含这份内部计划。银行费先在费用清单录入并确认承担方，或明确确认属于未录入的新费用；不按名称自动识别账单重复。</p>`;
  if (!plan) html += `<button data-action="settlement-create"${disabled}>绑定当前报价并新建付款计划</button>`;
  else {
    html += `<p>绑定：${escapeHtml(plan.binding.incoterm)} ${escapeHtml(plan.binding.named_place)} · ${escapeHtml(plan.binding.amount)} ${escapeHtml(plan.binding.currency)}</p>
      <button data-action="settlement-rebind"${disabled}>核对后重新绑定当前报价（保留付款输入）</button>
      <label>付款方式<select data-settlement-field="method">${options([['UNCONFIRMED','待确认'],['TT','TT 电汇（付款时间另填）'],['LC','L/C 信用证（条件另核）'],['OA','OA 赊销（账期另填）']],plan.method)}</select></label>
      ${plan.payments.map((row,index) => `<fieldset><legend>合同价款 ${index+1}</legend><label>输入口径<select data-settlement-row="payment" data-settlement-index="${index}" data-settlement-field="basis">${options([['AMOUNT','原币金额'],['PERCENT','合同价百分比（例如30）']],row.basis)}</select></label>${input('payment',index,'value','金额/百分比',row.value)}${input('payment',index,'date','约定付款日 YYYY-MM-DD',row.date)}${input('payment',index,'trigger','触发条件与合同依据',row.trigger)}<button data-action="settlement-remove-payment" data-settlement-index="${index}">删除本笔价款</button></fieldset>`).join('')}
      <button data-action="settlement-add-payment">增加一笔价款</button>
      <label>银行费用核对<select data-settlement-field="bank_status">${options([['UNCONFIRMED','尚未核对（不是零费用）'],['NO_FEES','已核对无银行费用'],['LISTED','按下方逐笔清单核对']],plan.bank_status)}</select></label>
      ${plan.bank_fees.map((row,index) => `<fieldset><legend>银行费用 ${index+1}</legend><label>费用来源<select data-settlement-row="fee" data-settlement-index="${index}" data-settlement-field="source">${options([['EXISTING','关联项目已有费用'],['EXTRA','新增，仅付款计划']],row.source)}</select></label>
        ${row.source === 'EXISTING' ? `<label>已有自定义费用（人工确认是银行费用）<select data-settlement-row="fee" data-settlement-index="${index}" data-settlement-field="cost_id"><option value="">请选择</option>${project.items.filter(item => item.source === 'USER' && item.cost_category === 'CUSTOM' && !item.is_goods_value).map(item => `<option value="${escapeHtml(item.cost_id)}"${item.cost_id === row.cost_id ? ' selected' : ''}>${escapeHtml(item.cost_name)} · ${escapeHtml(item.currency)}</option>`).join('')}</select></label>` : `${input('fee',index,'amount','新增费用原币金额（确认为零再填0）',row.amount)}${input('fee',index,'currency','费用币种（三位大写）',row.currency)}<label><input type="checkbox" data-settlement-row="fee" data-settlement-index="${index}" data-settlement-field="not_in_project"${row.not_in_project ? ' checked' : ''}>已核对：这笔费用没有在项目费用清单中录入</label>`}
        ${row.source === 'EXTRA' && row.cost_id ? input('fee',index,'cost_id','原费用关联ID（新增费用须先明确清空）',row.cost_id) : ''}
        <label>经济承担方<select data-settlement-row="fee" data-settlement-index="${index}" data-settlement-field="bearer">${options([['UNCONFIRMED','待确认'],['BUYER','买方'],['SELLER','卖方']],row.bearer)}</select></label><label>计划实际付款方（代付/垫付另核）<select data-settlement-row="fee" data-settlement-index="${index}" data-settlement-field="payer">${options([['UNCONFIRMED','待确认'],['BUYER','买方'],['SELLER','卖方']],row.payer)}</select></label>${input('fee',index,'date','约定费用付款日 YYYY-MM-DD',row.date)}${input('fee',index,'reference','银行收费与承担约定依据',row.reference)}<button data-action="settlement-remove-fee" data-settlement-index="${index}">删除本笔费用</button></fieldset>`).join('')}
      <button data-action="settlement-add-fee">增加一笔银行费</button>
      <label>内部付款备注<input data-settlement-field="notes" value="${escapeHtml(plan.notes)}"></label>`;
    try { html += renderSettlementResult(calculateSettlement(plan, settlementBinding(project), analysis, project.term_scenarios?.[project.incoterm]?.responsibility_overrides)); }
    catch (error) { html += `<p class="banner error" role="alert">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`; }
    html += renderFundingFields(plan);
    try { html += renderFundingResult(plan, settlementBinding(project)); }
    catch (error) { html += `<p class="banner error">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`; }
    html += `<button data-action="settlement-save"${disabled}>保存内部付款计划 JSON（可保存未完成输入）</button>`;
  }
  html += `<button data-action="settlement-open"${disabled}>打开内部付款计划 JSON</button><input id="settlement-file-input" type="file" accept=".json,application/json" hidden><p class="hint">内部HTML和内部Excel记录本页付款及资金占用假设快照。${busy ? '正在保存付款计划，等待期间编辑不改变本次文件。' : '不建模保证金冻结、净额抵扣、银行扣费后到账推算或实际结算汇率。'}</p>`;
  return `<details class="panel settlement-panel" data-evidence-section="settlement"><summary><span class="panel-title">付款时间表与银行费用 · 内部计划</span></summary><div class="panel-body">${html}</div></details>`;
}
