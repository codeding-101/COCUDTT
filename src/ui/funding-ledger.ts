import type { FundingResult } from '../engine/funding.js';
import type { SettlementPlan } from '../domain/settlement.js';
import {escapeHtml as e} from './format.js';
import Decimal from 'decimal.js';
function briefCost(cost:string):string {
  const original=new Decimal(cost),brief=original.toSignificantDigits(12);
  return `${brief.eq(original)?'':'≈'}${e(brief.toString())}`;
}
export function renderFundingLedgerResult(result:FundingResult):string {
  const ledger=result.ledger;if(!ledger)return '';
  return `<details data-funding-ledger open><summary>本金事件与计息区间</summary><p>期初本金 ${e(result.principal)} ${e(result.currency)}；截止日余额 ${e(ledger.closing_principal)} ${e(result.currency)}；本金×天数合计 ${e(ledger.principal_days)} ${e(result.currency)}·天。期间结束不推定本金已归还。</p>
  <table class="grid stackable"><thead><tr><th>日期/事件ID</th><th>增减额</th><th>事件前 → 后余额</th><th>依据</th></tr></thead><tbody>${ledger.events.map(row=>`<tr><th>${e(row.date)} / ${e(row.id)}</th><td data-label="增减额">${row.direction==='INCREASE'?'+':'−'}${e(row.amount)} ${e(row.currency)}</td><td data-label="余额">${e(row.before)} → ${e(row.after)}</td><td data-label="依据">${e(row.reference)}</td></tr>`).join('')}</tbody></table>
  <table class="grid stackable"><thead><tr><th>计息区间（含起日、不含止日）</th><th>本金 / 天数</th><th>单利成本与公式</th></tr></thead><tbody>${ledger.segments.map(row=>`<tr><th>${row.start_date} → ${row.end_date}</th><td data-label="本金/天数">${e(row.principal)} ${e(result.currency)} / ${row.days}天${row.annual_rate!==undefined?` / 年利率${e(row.annual_rate)}%`:''}</td><td data-label="成本/公式">${briefCost(row.cost)} ${e(result.currency)}<details><summary>完整精度与单利公式</summary><p>${e(row.cost)} ${e(result.currency)}</p><p>${e(row.formula)}</p>${row.rate_reference!==undefined?`<p>利率依据：${e(row.rate_reference)}</p>`:''}</details></td></tr>`).join('')}</tbody></table>
  <p class="hint">分段默认最多12有效位，近似值标≈，完整计算精度可展开；显示截短不改变计算或Excel原值。${result.rates?'合计先汇总本金×年利率百分数×天数，再除100及年基数；':'合计先汇总本金×天数再统一除年基数；'}每段循环小数独立展示，尾数可能与显示值直接相加不同，不进行银行货币单位舍入。</p></details>`;
}
export function renderFundingLedgerControls(plan:SettlementPlan):string {
  if(plan.version==='1.1')return '<button data-action="settlement-enable-ledger">启用变动本金（升级为1.2，须重新确认假设）</button>';
  if(plan.version!=='1.2'&&plan.version!=='1.3')return '';
  const input=plan.funding!;
  const field=(index:number,key:string,label:string,value:string)=>`<label>${label}<input data-settlement-row="funding-event" data-settlement-index="${index}" data-settlement-field="${key}" value="${e(value)}"></label>`;
  return `<fieldset><legend>本金模型（${plan.version}）</legend><label>计息模型<select data-settlement-row="funding" data-settlement-field="balance_model"><option value="CONSTANT"${input.balance_model==='CONSTANT'?' selected':''}>恒定本金；保留的事件不参与</option><option value="EVENTS"${input.balance_model==='EVENTS'?' selected':''}>显式本金事件</option></select></label>
  <p class="hint">切换模型须重新选择测算范围。事件只代表明确的本金变化，不自动成为合同付款或银行收付；同一主体、同一币种；固定年利率或1.3显式利率事件。期初金额不从报价推定，明确零余额填0。</p>
  ${input.events!.map((row,index)=>`<fieldset><legend>本金事件 ${index+1} · ${e(row.id)}${input.balance_model==='CONSTANT'?'（已保留，未参与）':''}</legend><label>增减方向<select data-settlement-row="funding-event" data-settlement-index="${index}" data-settlement-field="direction"><option value="INCREASE"${row.direction==='INCREASE'?' selected':''}>增加本金</option><option value="DECREASE"${row.direction==='DECREASE'?' selected':''}>减少本金（不冲抵利息）</option></select></label>${field(index,'amount','本金变化金额（须大于0）',row.amount)}${field(index,'currency','事件币种（须与本金一致）',row.currency)}${field(index,'date','本金变化生效日 YYYY-MM-DD',row.date)}${field(index,'reference','本金变化依据/凭证',row.reference)}<button data-action="settlement-remove-funding-event" data-settlement-index="${index}">删除此事件</button></fieldset>`).join('')}
  <button data-action="settlement-add-funding-event"${input.events!.length>=100?' disabled':''}>增加本金事件（最多100笔）</button>
  <p class="hint">日期须按升序录入，同日按列表顺序逐笔处理，不自动排序或净额合并；每步余额不能为负。事件在当天计息前生效；起止日内的事件须明确录入，截止日事件改变截止余额、不增加计息天数。每个区间含起日不含止日。固定模型不会使用这些事件。</p></fieldset>`;
}
