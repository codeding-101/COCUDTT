import Decimal from 'decimal.js';
import type {SettlementPlan} from '../domain/settlement.js';
import type {FundingResult} from '../engine/funding.js';
import {escapeHtml as e} from './format.js';
const brief=(text:string):string=>{const value=new Decimal(text),short=value.toSignificantDigits(12);return`${short.eq(value)?'':'≈'}${e(short.toString())}`;};
export function renderFundingPeriodControls(plan:SettlementPlan):string{
  if(plan.version==='1.4')return '<button data-action="settlement-enable-periods">启用明确计息归集期（升级为1.5，须重新确认）</button>';
  if(plan.version!=='1.5')return '';
  const s=plan.funding!.period_schedule!,field=(i:number,key:string,label:string,value:string)=>`<label>${label}<input data-settlement-row="funding-period" data-settlement-index="${i}" data-settlement-field="${key}" value="${e(value)}"></label>`;
  return `<fieldset data-funding-period-controls><legend>明确计息归集期（1.5）</legend><p>计算分段由本金/利率事件形成，归集期独立录入；归集期末不表示银行已结息或实际付款。仅在舍入层级选择“按明确期间汇总后舍入”时参与计算。</p>
    <label>期间表状态<select data-settlement-row="funding-period-schedule" data-settlement-field="status"><option value="UNCONFIRMED"${s.status==='UNCONFIRMED'?' selected':''}>待确认</option><option value="PROVIDED"${s.status==='PROVIDED'?' selected':''}>按以下明确期间</option></select></label>
    <label>整体期间划分依据<input data-settlement-row="funding-period-schedule" data-settlement-field="reference" value="${e(s.reference)}"></label>
    ${s.periods.map((p,i)=>`<fieldset><legend>归集期 ${i+1} · ${e(p.id)}</legend>${field(i,'start_date','起始日 YYYY-MM-DD（含）',p.start_date)}${field(i,'end_date','结束日 YYYY-MM-DD（不含）',p.end_date)}${field(i,'reference','本期起止及短尾期处理依据',p.reference)}<button data-action="settlement-remove-period" data-settlement-index="${i}">删除本期</button></fieldset>`).join('')}
    <button data-action="settlement-add-period"${s.periods.length>=100?' disabled':''}>增加归集期（最多100期）</button>
    <label><input type="checkbox" data-settlement-row="funding-period-schedule" data-settlement-field="periods_confirmed"${s.periods_confirmed?' checked':''}>我已核对本次测算范围、整体依据及各期边界；这不证明实际银行已结息或付款</label>
    <p class="hint">按原列表首尾连续、无重叠并完整覆盖起止日；不自动补月末、尾期、节假日或排序。零天数只接受明确空期表。短尾期须说明内部应计依据，不能称已结息。修改资金/事件/期间或舍入假设后此确认失效；修改方式、步长、层级或舍入依据也须重新确认应用。期内先精确汇总再舍入一次，不补尾差、不资本化、不生成银行扣款。</p></fieldset>`;
}
export function renderFundingPeriodResult(result:FundingResult):string{
  const a=result.periods;if(!a)return '';
  return `<details data-funding-periods open><summary>按明确期间汇总与舍入审计</summary><p>方式 ${e(a.mode)}；金额步长 ${e(a.unit)} ${e(a.currency)}；已明确确认本次归集边界。</p><p data-period-rounded-cost>期间舍入假设金额：${e(a.rounded_cost)} ${e(a.currency)}</p>
    <p>原始单利 ${brief(a.unrounded_cost)}；合计后舍入对照 ${e(a.total_rounded)}；按期 − 合计差额 ${e(a.scope_difference)} ${e(a.currency)}。金额独立于利润、税费和收付，不表示扣款。</p>
    <p>整体期间依据：${e(a.schedule_reference)}</p><p>舍入依据：${e(a.reference)}</p><details><summary>原值与调整精确核对</summary><p>原值精确分数 ${e(a.unrounded_fraction)}；调整 ${e(a.adjustment)}；调整精确分数 ${e(a.adjustment_fraction)}。十进制展示最多256有效位。</p></details>
    <table class="grid stackable"><thead><tr><th>归集期 / 天数</th><th>未舍入 → 舍入</th><th>精确核对及交集来源</th></tr></thead><tbody>${a.periods.map(p=>`<tr><th>${e(p.id)}<br>${e(p.start_date)} → ${e(p.end_date)}<br>${p.days}天</th><td data-label="金额">${brief(p.unrounded_cost)} → ${e(p.rounded_cost)} ${e(a.currency)}</td><td data-label="审计"><p>${e(p.reference)}</p><details><summary>展开本期及原段交集</summary><p>原值 ${e(p.unrounded_cost)}；精确分数 ${e(p.unrounded_fraction)}；调整 ${e(p.adjustment)}；调整分数 ${e(p.adjustment_fraction)}</p>${p.fragments.map(f=>`<p>原计算段 ${f.segment_index+1}：${e(f.start_date)} → ${e(f.end_date)}，${f.days}天，本金${e(f.principal)} ${e(a.currency)}，年利率${e(f.annual_rate)}%；原值${e(f.unrounded_cost)}；分数${e(f.unrounded_fraction)}。本金依据链：${f.principal_references.map(e).join('；')}；利率依据：${e(f.rate_reference)}</p>`).join('')}</details></td></tr>`).join('')}</tbody></table><p class="hint">原计算分段共${a.calculation_segment_count}段，归集切点不改变原分段。段编号仅对应本次快照；每期一次舍入后相加，不再次舍入合计。实际结息、清偿、复利、业务日调整和最低收费另按合同核对。</p></details>`;
}
