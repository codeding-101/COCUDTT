import type { SettlementPlan } from '../domain/settlement.js';
import type { FundingResult } from '../engine/funding.js';
import { escapeHtml as e } from './format.js';
export function renderFundingRateResult(result:FundingResult):string {
  const rates=result.rates;if(!rates)return '';
  return `<details data-funding-rates open><summary>利率事件与合计口径</summary><p>期初年利率 ${e(result.annual_rate)}%；截止日年利率 ${e(rates.closing_rate)}%。新利率为绝对百分数，生效日起使用；截止日变化只记审计，不增加计息日。</p>
  <table class="grid stackable"><thead><tr><th>生效日 / 事件ID</th><th>原 → 新年利率</th><th>依据</th></tr></thead><tbody>${rates.events.map(row=>`<tr><th>${e(row.date)} / ${e(row.id)}</th><td data-label="年利率">${e(row.before)}% → ${e(row.after)}%</td><td data-label="依据">${e(row.reference)}</td></tr>`).join('')}</tbody></table>
  <p>Σ(本金 × 年利率百分数 × 实际天数) = ${e(rates.weighted_principal_rate_days)}；再 ÷100 ÷${result.denominator}。不使用期初或截止利率替代整段利率，上述原始单利不按金额步长舍入，1.4舍入假设另列。</p></details>`;
}
export function renderFundingRateControls(plan:SettlementPlan):string {
  if(plan.version==='1.2')return '<button data-action="settlement-enable-rates">启用利率事件（升级为1.3，须重新确认假设）</button>';
  if(plan.version!=='1.3'&&plan.version!=='1.4'&&plan.version!=='1.5')return '';
  const f=plan.funding!,field=(index:number,key:string,label:string,value:string)=>`<label>${label}<input data-settlement-row="funding-rate" data-settlement-index="${index}" data-settlement-field="${key}" value="${e(value)}"></label>`;
  return `<fieldset><legend>利率模型（${plan.version}）</legend><label>年利率模型<select data-settlement-row="funding" data-settlement-field="rate_model"><option value="CONSTANT"${f.rate_model==='CONSTANT'?' selected':''}>固定年利率；保留事件不参与</option><option value="EVENTS"${f.rate_model==='EVENTS'?' selected':''}>显式新年利率及生效日</option></select></label>
  <p class="hint">切换模型须重新确认测算范围。期初年利率仍须填写；事件填写新的绝对年利率百分数，不填增减幅度。利率与本金模型可独立选择。</p>
  ${f.rate_events!.map((row,index)=>`<fieldset><legend>利率事件 ${index+1} · ${e(row.id)}${f.rate_model==='CONSTANT'?'（已保留，未参与）':''}</legend>${field(index,'date','新利率生效日 YYYY-MM-DD',row.date)}${field(index,'annual_rate','新年利率百分数（明确零利率填0）',row.annual_rate)}${field(index,'reference','新利率及生效日依据',row.reference)}<button data-action="settlement-remove-rate-event" data-settlement-index="${index}">删除此利率事件</button></fieldset>`).join('')}
  <button data-action="settlement-add-rate-event"${f.rate_events!.length>=100?' disabled':''}>增加利率事件（最多100笔）</button>
  <p class="hint">严格按日期升序，同日重复利率须人工核对。生效日先处理本金变化与新利率，再计息；截止日不计息。同一主体、币种与计息基准；不推定市场指数、加点、利率下限、营业日调整、复利或银行扣款。</p></fieldset>`;
}
