import type { SettlementBinding, SettlementPlan } from '../domain/settlement.js';
import { calculateFunding } from '../engine/funding.js';
import { escapeHtml as e } from './format.js';
import { renderFundingRateControls, renderFundingRateResult } from './funding-rates.js';
import { renderFundingLedgerControls, renderFundingLedgerResult } from './funding-ledger.js';

export function renderFundingResult(plan: SettlementPlan, binding: SettlementBinding): string {
  try {
    const result = calculateFunding(plan, binding);
    if (!result) return '<p data-funding-omitted>已明确选择本计划不测算资金占用；这不表示成本为零。保留的输入不参与计算。</p>';
    return `<div data-funding-result><p>${result.party === 'BUYER' ? '买方' : '卖方'} · ${result.kind === 'FINANCING' ? '融资利息假设' : '资金机会成本假设'}：${e(result.cost)} ${e(result.currency)}</p><p>${result.ledger?'期初':''}本金 ${e(result.principal)} ${e(result.currency)}，${result.rates?'期初':''}年利率 ${e(result.annual_rate)}%，${result.start_date} 至 ${result.end_date}，实际 ${result.days} 天 ÷ ${result.denominator}。</p><details><summary>展开单利公式与假设依据</summary><p>${e(result.formula)} = ${e(result.cost)} ${e(result.currency)}</p><p>${e(result.reference)}</p></details>${renderFundingRateResult(result)}${renderFundingLedgerResult(result)}</div>`;
  } catch (error) { return `<p class="banner error" data-funding-error>${e(error instanceof Error ? error.message : String(error))}</p>`; }
}
export function renderFundingFields(plan: SettlementPlan): string {
  if (plan.version === '1.0') return '<p>旧计划1.0没有资金占用字段，不自动补本金、日期或利率。</p><button data-action="settlement-enable-funding">启用资金占用字段（升级为1.1，保留原付款输入）</button>';
  const input = plan.funding!;
  const eventModel = (plan.version === '1.2'||plan.version==='1.3') && input.balance_model === 'EVENTS';
  const select = (field: string, label: string, values: [string,string][], value: string) => `<label>${label}<select data-settlement-row="funding" data-settlement-field="${field}">${values.map(([key,text]) => `<option value="${key}"${key === value ? ' selected' : ''}>${text}</option>`).join('')}</select></label>`;
  const text = (field: string, label: string, value: string) => `<label>${label}<input data-settlement-row="funding" data-settlement-field="${field}" value="${e(value)}"></label>`;
  return `<fieldset><legend>资金占用假设（${eventModel?'显式本金事件':'单笔恒定本金'}）</legend>${select('status','测算范围',[['UNCONFIRMED','待确认（不是零成本）'],['NOT_MODELED','明确选择本计划不测算'],['PROVIDED','按下列显式假设测算']],input.status)}
    ${select('kind','成本性质',[['UNCONFIRMED','待确认'],['FINANCING','融资利息假设'],['OPPORTUNITY','资金机会成本假设']],input.kind)}${select('party','测算方',[['UNCONFIRMED','待确认'],['BUYER','买方'],['SELLER','卖方']],input.party)}
    ${text('principal',eventModel?'期初本金（明确零余额填0）':'恒定本金（不自动取合同价或付款额）',input.principal)}${text('currency','本金与成本币种（三位大写）',input.currency)}${text('start_date','起始日 YYYY-MM-DD（含）',input.start_date)}${text('end_date','截止日 YYYY-MM-DD（不含）',input.end_date)}${text('annual_rate',plan.version==='1.3'&&input.rate_model==='EVENTS'?'期初年利率百分数（明确零利率填0）':'年利率百分数（例如6；明确零利率填0）',input.annual_rate)}
    ${select('day_basis','计息基准',[['UNCONFIRMED','待确认'],['ACT_365F','Actual/365 Fixed（闰年也除365）'],['ACT_360','Actual/360（实际天数除360）']],input.day_basis)}${text('reference','本金期间、利率与计息基准依据',input.reference)}
    <p class="hint">单利，算头不算尾，同日为0天。${plan.version==='1.3'&&input.rate_model==='EVENTS'?'按显式生效日采用新年利率；区间同时按有效本金划分。':eventModel?'按明确本金事件分段、期间年利率固定。':'所列期间恒定本金及年利率，不使用本金事件。'}不建模复利、还款冲抵顺序、计息日调整、负利率或实际扣款日。机会成本不表示银行账单。成本独立展示，不加进计划收付、不扣减经营利润或落地成本，避免与已有银行费用、退税资金占用成本重复计入。金额未按银行货币单位舍入，除法最多256有效位；以合同及银行实际计息约定另核。</p></fieldset>${renderFundingLedgerControls(plan)}${renderFundingRateControls(plan)}`;
}
