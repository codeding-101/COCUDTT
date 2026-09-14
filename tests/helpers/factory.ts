import type { CostItem } from '../../src/domain/cost-item';
import type { Incoterm } from '../../src/domain/enums';
import type { Scenario } from '../../src/domain/scenario';
import type { Trade } from '../../src/domain/trade';

/** 构造测试用费用项，只写关心的字段，其余取中性默认值 */
export function makeCostItem(partial: Partial<CostItem> & Pick<CostItem, 'cost_id'>): CostItem {
  return {
    cost_name: partial.cost_id,
    cost_category: 'CUSTOM',
    trade_node: 'SELLER_PREMISES',
    pricing_method: 'FIXED',
    currency: 'CNY',
    fx_type: 'MARKET',
    base_currency: 'CNY',
    tax_included: false,
    responsibility: 'CONDITIONAL',
    responsibility_source: 'UNRESOLVED',
    included_in_quoted_price: false,
    is_custom: true,
    source: 'USER',
    ...partial,
  };
}

export function makeTrade(partial: Partial<Trade> & Pick<Trade, 'items'>): Trade {
  return {
    id: 'trade-test',
    name: '测试交易',
    base_currency: 'CNY',
    carriage_mode: 'SEA',
    goods: {
      name: '测试商品',
      quantity: '1',
      unit: 'PCS',
      trade_value: { amount: '1000', currency: 'CNY' },
      seller_goods_cost: { amount: '800', currency: 'CNY' },
    },
    ...partial,
  };
}

export function makeScenario(partial: Partial<Scenario> & Pick<Scenario, 'incoterm'>): Scenario {
  const incoterm: Incoterm = partial.incoterm;
  return {
    id: 'scenario-test',
    trade_id: 'trade-test',
    base_currency: 'CNY',
    quote: {
      amount: '1000',
      currency: 'CNY',
      incoterm,
      included_cost_ids: [],
    },
    ...partial,
    incoterm,
  };
}
