import type { Scenario } from './scenario.js';
import type { Trade } from './trade.js';

/** 用原始报价生成核对快照，不能用换算后金额或派生内含清单替换合同输入。 */
export function quoteEvidenceValues(trade: Trade, scenario: Scenario): unknown {
  const quote = scenario.quote;
  return { incoterm: scenario.incoterm, base_currency: scenario.base_currency, amount: quote.amount, currency: quote.currency,
    fx_type: quote.fx_type, fx_date: quote.fx_date, named_place: quote.named_place,
    goods: { name: trade.goods.name, quantity: trade.goods.quantity, unit: trade.goods.unit, trade_value: trade.goods.trade_value },
    facts: scenario.facts };
}

export function overrideEvidenceValues(trade: Trade, scenario: Scenario, costId: string): unknown {
  const override = scenario.responsibility_overrides?.[costId];
  return { incoterm: scenario.incoterm, base_currency: scenario.base_currency, cost: trade.items.find(item => item.cost_id === costId),
    responsibility: override?.responsibility, reason: override?.reason,
    payment_party: override?.payment_party, economic_bearer: override?.economic_bearer, facts: scenario.facts };
}
