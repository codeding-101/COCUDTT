import type { SettlementPlan } from '../domain/settlement.js';
import type { FundingResult } from '../engine/funding.js';
import { escapeHtml as e } from './format.js';
import Decimal from 'decimal.js';
const scopeLabel=(scope:string)=>scope==='TOTAL'?'合计后舍入':'逐计息区间舍入';
const modeLabel=(mode:string)=>({HALF_UP:'就近，恰半向上',HALF_EVEN:'就近，恰半取偶数个步长',DOWN:'向零截断'}[mode]??'待确认');
const brief=(s:string):string=>{const original=new Decimal(s),short=original.toSignificantDigits(12);return`${short.eq(original)?'':'≈'}${e(short.toString())}`;};
export function renderFundingRoundingResult(result:FundingResult):string {
  const r=result.rounding;if(!r)return '';
  return `<details data-funding-rounding open><summary>金额舍入假设与层级差异</summary><p>本次选定：${scopeLabel(r.scope)}；${modeLabel(r.mode)}；金额步长 ${e(r.unit)} ${e(result.currency)}。</p><p data-rounded-cost>舍入假设金额：${e(r.rounded_cost)} ${e(result.currency)}</p>
    <p>合计后舍入 ${e(r.total_rounded)}；若逐计算区间舍入 ${e(r.interval_rounded)}；逐区间 − 合计差额 ${e(r.scope_difference)} ${e(result.currency)}。比较值不证明银行采用该边界；逐区间应用须另行明确确认。</p><p>依据：${e(r.reference)}</p>
    <p>本次金额 − 原始单利：${brief(r.adjustment)} ${e(result.currency)}</p><details><summary>展开精确分数与差额</summary><p>原始单利精确分数：${e(r.unrounded_fraction)}</p><p>舍入调整精确分数：${e(r.adjustment_fraction)}；十进制展示：${e(r.adjustment)}</p></details>
    <table class="grid stackable"><thead><tr><th>计算区间（仅舍入比较）</th><th>未舍入 / 按区间舍入</th><th>调整与精确核对</th></tr></thead><tbody>${r.intervals.map(row=>`<tr><th>${row.start_date} → ${row.end_date}</th><td data-label="金额">${brief(row.unrounded_cost)} → ${e(row.rounded_cost)} ${e(result.currency)}</td><td data-label="调整">${brief(row.adjustment)} ${e(result.currency)}<details><summary>完整值与精确分数</summary><p>未舍入：${e(row.unrounded_cost)}；精确分数 ${e(row.unrounded_fraction)}</p><p>调整：${e(row.adjustment)}；精确分数 ${e(row.adjustment_fraction)}</p></details></td></tr>`).join('')}</tbody></table>
    <p class="hint">舍入按原始十进制本金/利率的精确分数比较余数，不用已截短的循环小数判断恰半。原始计算与差额十进制最多256有效位，精确分数另列；对比金额不改变付款、税款、利润或落地成本，不表示银行扣款。分段因新增本金/利率生效日而变化，明确归集期在1.5独立填写；不支持逐日舍入、利息资本化或实际账单确认。</p></details>`;
}
export function renderFundingRoundingControls(plan:SettlementPlan):string {
  if(plan.version==='1.3')return '<button data-action="settlement-enable-rounding">启用金额舍入假设（升级为1.4，须重新确认）</button>';
  if(plan.version!=='1.4'&&plan.version!=='1.5')return '';
  const f=plan.funding!.rounding!,select=(key:string,label:string,value:string,choices:[string,string][])=>`<label>${label}<select data-settlement-row="funding-rounding" data-settlement-field="${key}">${choices.map(([v,t])=>`<option value="${v}"${value===v?' selected':''}>${t}</option>`).join('')}</select></label>`;
  return `<fieldset><legend>金额舍入假设（${plan.version}）</legend>
    ${select('status','是否应用',f.status,[['UNCONFIRMED','待确认'],['NOT_APPLIED','明确保留未舍入结果'],['APPLIED','应用下列明确舍入假设']])}
    ${select('scope','舍入层级',f.scope,[['UNCONFIRMED','待确认'],['TOTAL','整个期间合计后舍入'],['INTERVALS','逐计算区间舍入再相加'],...(plan.version==='1.5'?[['PERIODS','按明确期间汇总后舍入'] as [string,string]]:[])])}
    ${select('mode','舍入方式',f.mode,[['UNCONFIRMED','待确认'],['HALF_UP','就近，恰半向上'],['HALF_EVEN','就近，恰半取偶数个步长'],['DOWN','向零截断（本模型金额非负）']])}
    <label>金额步长（例如0.01，不从币种推定）<input data-settlement-row="funding-rounding" data-settlement-field="unit" value="${e(f.unit)}"></label>
    <label>金额单位、方式、层级及舍入时点依据<input data-settlement-row="funding-rounding" data-settlement-field="reference" value="${e(f.reference)}"></label>
    ${plan.version==='1.5'&&f.scope==='PERIODS'?'<p>逐计算区间确认不适用于本模式；请在下方期间表独立确认归集边界。</p>':`<label><input type="checkbox" data-settlement-row="funding-rounding" data-settlement-field="intervals_confirmed"${f.intervals_confirmed?' checked':''}>我已核对，并确认当前计算区间就是本次拟采用的逐区间舍入边界</label>`}
    <p class="hint">原始单利始终保留，舍入金额另列。区间是本金/利率生效日形成的计算区间，不自动等于银行结息日；修改日期、模型或增删事件后须重新核对边界。切换舍入层级须重新确认应用状态。不默认两位小数；非十进制步长（如1/3）、负利率、逐日舍入、实际结息日和复利另设模型。明确不应用可保留未完成字段，但不是确认银行不舍入。</p></fieldset>`;
}
