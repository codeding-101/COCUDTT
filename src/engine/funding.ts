import Decimal from 'decimal.js';
import type { SettlementBinding, SettlementPlan } from '../domain/settlement.js';
import { validateSettlementBinding } from './settlement.js';
import { isIsoDate } from './tax/china-import.js';

// Isolated from the existing trade/tax engine. Division may recur; expose the basis and precision.
const Money = Decimal.clone({ precision: 256, rounding: Decimal.ROUND_HALF_UP });
const fail = (message: string): never => { throw Error(`资金占用假设未完成：${message}`); };
function number(value: string, label: string, positive: boolean): Decimal {
  const text = value.trim();
  if (text.length > 160 || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return fail(`${label}须为无千分位的非负十进制文本`);
  const result = new Money(text);
  if (!result.isFinite() || result.sd() > 80 || result.dp() > 40 || (positive ? result.lte(0) : result.lt(0))) return fail(`${label}须${positive ? '大于零' : '非负'}，最多80有效位与40小数位`);
  return result;
}
export interface FundingResult {
  kind: 'FINANCING' | 'OPPORTUNITY';
  party: 'BUYER' | 'SELLER';
  principal: string;
  currency: string;
  start_date: string;
  end_date: string;
  annual_rate: string;
  days: number;
  denominator: 365 | 360;
  cost: string;
  formula: string;
  reference: string;
}
/** Null means explicitly not modeled, never an assumed zero cost. */
export function calculateFunding(plan: SettlementPlan, current: SettlementBinding): FundingResult | null {
  validateSettlementBinding(plan, current);
  const input = plan.funding;
  if (!input || input.status === 'UNCONFIRMED') return fail('尚未设置资金占用口径，不能以空白当零成本');
  if (input.status === 'NOT_MODELED') return null;
  if (input.kind === 'UNCONFIRMED' || input.party === 'UNCONFIRMED') return fail('请选择融资利息/机会成本及测算方，不从付款方式猜测');
  if (input.day_basis === 'UNCONFIRMED') return fail('请明确计息基准，不从币种推定365或360');
  if (!/^[A-Z]{3}$/.test(input.currency)) return fail('币种须为三位大写代码，不推定汇率');
  if (!isIsoDate(input.start_date) || !isIsoDate(input.end_date)) return fail('起止日期须为真实有效的YYYY-MM-DD');
  // ISO civil dates in UTC prevent DST/timezone changes. Start included, end excluded.
  const days = (Date.parse(input.end_date + 'T00:00:00Z') - Date.parse(input.start_date + 'T00:00:00Z')) / 86400000;
  if (!Number.isSafeInteger(days) || days < 0) return fail('截止日不能早于起始日；同日为0天');
  if (!input.reference.trim()) return fail('须记录本金期间、年利率及计息基准的假设依据');
  const principal = number(input.principal, '本金', true), rate = number(input.annual_rate, '年利率（百分数）', false);
  const denominator = input.day_basis === 'ACT_365F' ? 365 : 360;
  const cost = principal.times(rate).times(days).div(100).div(denominator);
  return { kind: input.kind, party: input.party, principal: principal.toFixed(), currency: input.currency,
    start_date: input.start_date, end_date: input.end_date, annual_rate: rate.toFixed(), days, denominator,
    cost: cost.toFixed(), formula: `${principal.toFixed()} × ${rate.toFixed()} ÷ 100 × ${days} ÷ ${denominator}`,
    reference: input.reference };
}
