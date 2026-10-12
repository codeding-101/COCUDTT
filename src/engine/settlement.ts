import Decimal from 'decimal.js';
import { isIsoDate } from './tax/china-import.js';
import type { AnalysisResult } from './analyze.js';
import type { SettlementBinding, SettlementPlan } from '../domain/settlement.js';
import { validateSettlementPlan } from '../domain/settlement-validation.js';
import type { ResponsibilityOverride } from '../domain/scenario.js';

// Isolated arithmetic: never alter the existing trade engine's precision or q().
const Money = Decimal.clone({ precision: 256, rounding: Decimal.ROUND_HALF_UP });
const fail = (message: string): never => { throw Error(`付款计划未完成：${message}`); };
function numeric(value: string, label: string, positive = true): Decimal {
  const text = value.trim();
  if (text.length > 160 || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return fail(`${label}须为无千分位的非负十进制文本`);
  const number = new Money(text);
  if (!number.isFinite() || number.sd() > 80 || number.dp() > 40 || (positive ? number.lte(0) : number.lt(0))) return fail(`${label}须${positive ? '大于零' : '非负'}，最多80有效位与40小数位`);
  return number;
}
function currency(value: string): string {
  if (!/^[A-Z]{3}$/.test(value)) return fail('币种须为三位大写代码；不自动推定汇率或最小货币单位');
  return value;
}
function date(value: string): string {
  if (!isIsoDate(value)) return fail('每笔付款/费用须填写真实有效的YYYY-MM-DD日期，不从方式或触发事件猜付款日');
  return value;
}
export interface SettlementEvent {
  id: string;
  date: string;
  currency: string;
  amount: string;
  kind: 'PRINCIPAL' | 'BANK_FEE';
  payer: 'BUYER' | 'SELLER';
  recipient: 'SELLER' | 'BANK';
  label: string;
  formula: string;
  cost_id?: string;
}
export interface SettlementTotals {
  currency: string;
  buyer_outflow: string;
  seller_inflow: string;
  seller_outflow: string;
  seller_net: string;
  bank_fees: string;
}
export interface SettlementResult {
  version: '1.0';
  principal: string;
  allocated: string;
  difference: string;
  events: SettlementEvent[];
  totals: SettlementTotals[];
}
export function calculateSettlement(plan: SettlementPlan, current: SettlementBinding, analysis: AnalysisResult | null, overrides: Record<string, ResponsibilityOverride> = {}): SettlementResult {
  validateSettlementPlan(plan);
  for (const key of Object.keys(current) as (keyof SettlementBinding)[]) if (plan.binding[key] !== current[key]) return fail('绑定报价或交易范围已变更，请核对原付款安排后重新绑定当前报价');
  if (!['TT','LC','OA'].includes(plan.method)) return fail('请选择TT、L/C或OA；方式只作记录，不表示收款保证');
  const principal = numeric(current.amount, '合同报价'), principalCurrency = currency(current.currency);
  if (!plan.payments.length) return fail('至少录入一笔合同价款付款');
  let allocated = new Money(0);
  const events: SettlementEvent[] = plan.payments.map(row => {
    const value = numeric(row.value, '分期金额或比例');
    if (row.basis === 'PERCENT' && value.gt(100)) return fail('单笔比例不能超过100%');
    const amount = row.basis === 'PERCENT' ? principal.times(value).div(100) : value;
    allocated = allocated.plus(amount);
    if (!row.trigger.trim()) return fail('每笔付款须说明触发条件/合同依据；日期不代表条件已经满足');
    return { id: row.id, kind: 'PRINCIPAL', payer: 'BUYER', recipient: 'SELLER', date: date(row.date), currency: principalCurrency,
      amount: amount.toFixed(), label: row.trigger, formula: row.basis === 'PERCENT' ? `${principal.toFixed()} × ${value.toFixed()} ÷ 100` : value.toFixed() };
  });
  const difference = allocated.minus(principal);
  if (!difference.isZero()) return fail(`付款合计${allocated.toFixed()}与合同价${principal.toFixed()}不一致，差额${difference.toFixed()} ${principalCurrency}；不自动补尾款或舍入差额`);
  if (plan.bank_status === 'UNCONFIRMED') return fail('银行费用尚未核对，不能以空清单当零费用');
  if ((plan.bank_status === 'NO_FEES' && plan.bank_fees.length) || (plan.bank_status === 'LISTED' && !plan.bank_fees.length)) return fail('银行费用核对状态与清单冲突，请保留并核对现有输入');
  const linked = new Set<string>();
  for (const row of plan.bank_fees) {
    if (!row.reference.trim()) return fail('银行费用须记录账单/费率及承担约定依据');
    if (row.bearer === 'UNCONFIRMED' || row.payer === 'UNCONFIRMED') return fail('银行费用承担方或实际付款方待确认，不从贸易术语或付款方式猜测');
    if (row.payer !== row.bearer) return fail('代付/垫付及双方清偿尚未建模，不能把费用承担方当实际付款方');
    let amount: Decimal, feeCurrency: string, label: string;
    if (row.source === 'EXISTING') {
      if (!row.cost_id || linked.has(row.cost_id)) return fail('已有费用未选择或被重复关联');
      linked.add(row.cost_id);
      if (analysis && analysis.incoterm !== current.incoterm) return fail('银行费用计算快照不属于当前贸易术语');
      const found = analysis?.items.find(item => item.item.cost_id === row.cost_id);
      if (!found || found.item.source !== 'USER' || found.item.cost_category !== 'CUSTOM' || found.item.is_goods_value) return fail('关联项须为当前方案的用户自定义银行费用，请先在费用清单录入并核对');
      if ((found.item.payment_party && found.item.payment_party !== row.payer) || (found.item.economic_bearer && found.item.economic_bearer !== row.bearer)) return fail('银行费用计划与原费用的付款方/经济承担方冲突，请先核对，不能静默改归属');
      const override = overrides[row.cost_id];
      if ((override?.payment_party && override.payment_party !== row.payer) || (override?.economic_bearer && override.economic_bearer !== row.bearer)) return fail('银行费用计划与本术语合同覆盖中的付款方/经济承担方冲突，请先核对');
      if (found.needs_confirmation || found.responsibility !== row.bearer || (row.bearer === 'BUYER' ? !found.counts_to_buyer : !found.counts_to_seller)) return fail('关联费用未计入该承担方、责任未定或已去重/含报价；不生成重复付款');
      amount = numeric(found.gross_amount.toFixed(), '已有银行费用', false);
      feeCurrency = currency(found.item.currency);
      label = found.item.cost_name;
    } else {
      if (!row.not_in_project || row.cost_id) return fail('新增银行费用须明确确认未录入项目清单，且不能同时关联已有费用');
      amount = numeric(row.amount, '新增银行费用', false);
      feeCurrency = currency(row.currency);
      label = '新增银行费用（仅付款计划）';
    }
    events.push({ id: row.id, kind: 'BANK_FEE', payer: row.payer, recipient: 'BANK', date: date(row.date),
      currency: feeCurrency, amount: amount.toFixed(), label: `${label} · ${row.reference}`, formula: '原币账单金额；此处不重复写回经营成本',
      ...(row.source === 'EXISTING' ? { cost_id: row.cost_id } : {}) });
  }
  const compareText = (a: string, b: string): number => a === b ? 0 : a < b ? -1 : 1;
  events.sort((a, b) => compareText(a.date,b.date) || compareText(a.kind,b.kind) || compareText(a.id,b.id));
  const totals = [...new Set(events.map(event => event.currency))].sort().map(code => {
    const sum = (predicate: (event: SettlementEvent) => boolean): Decimal => events.filter(event => event.currency === code && predicate(event)).reduce((acc, event) => acc.plus(event.amount), new Money(0));
    const buyer = sum(event => event.payer === 'BUYER'), incoming = sum(event => event.recipient === 'SELLER'), outgoing = sum(event => event.payer === 'SELLER');
    return { currency: code, buyer_outflow: buyer.toFixed(), seller_inflow: incoming.toFixed(), seller_outflow: outgoing.toFixed(),
      seller_net: incoming.minus(outgoing).toFixed(), bank_fees: sum(event => event.kind === 'BANK_FEE').toFixed() };
  });
  return { version: '1.0', principal: principal.toFixed(), allocated: allocated.toFixed(), difference: difference.toFixed(), events, totals };
}
