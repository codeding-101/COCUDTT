import { customCostItem, presetToCostItem, COST_PRESETS } from '../../src/data/cost-presets';
import type { CostItem } from '../../src/domain/cost-item';
import type { FxBook } from '../../src/domain/fx';
import type { Scenario } from '../../src/domain/scenario';
import type { TaxProfile } from '../../src/domain/tax-profile';
import type { Trade } from '../../src/domain/trade';

/**
 * 虚拟交易：1,200 台小家电出口德国汉堡，海运整箱。
 *
 * 全部数值均为虚构，但按实务口径构造，用于端到端核对：
 * 多币种（USD 报价与海运费、CNY 国内费用）、三套汇率（合同/市场/海关）、
 * 阶梯计费（滞箱费按天分档）、发生原因改判（滞箱费因买方原因归买方）。
 */

function preset(key: string) {
  const found = COST_PRESETS.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`缺少费用预设: ${key}`);
  return found;
}

/** 合同汇率 7.10、市场汇率 7.12、海关汇率 7.08 —— 三套互不替代 */
export const VIRTUAL_FX_BOOKS: FxBook[] = [
  {
    id: 'fx-contract',
    name: '合同约定汇率',
    type: 'CONTRACT',
    date: '2026-09-01',
    rates: { 'USD/CNY': '7.1000' },
  },
  {
    id: 'fx-market',
    name: '市场汇率',
    type: 'MARKET',
    date: '2026-09-08',
    rates: { 'USD/CNY': '7.1200' },
  },
  {
    id: 'fx-customs',
    name: '海关适用汇率 2026-09',
    type: 'CUSTOMS',
    date: '2026-09-17',
    valid_from: '2026-09-01',
    valid_to: '2026-09-30',
    rates: { 'USD/CNY': '7.0800' },
  },
];

export const VIRTUAL_TAX_PROFILE: TaxProfile = {
  id: 'virtual',
  version: '1.0',
  import: {
    dutiableValueBasis: 'CIF',
    dutyRates: { fallback: '0.037' },
    vatRate: '0.13',
    consumptionTax: null,
    vatDeductibleForBuyer: true,
  },
  export: {
    dutiableValueBasis: 'FOB',
    dutyRates: { fallback: '0' },
    rebate: {
      entityType: 'TRADING',
      vatRates: { fallback: '0.13' },
      rebateRates: { fallback: '0.13' },
    },
  },
  customsFx: { bookType: 'CUSTOMS', lockPeriod: 'MONTHLY' },
};

export const VIRTUAL_TRADE: Trade = {
  id: 'trade-virtual',
  name: '虚拟交易：小家电出口德国汉堡',
  base_currency: 'CNY',
  carriage_mode: 'SEA',
  export_date: '2026-09-10',
  goods: {
    name: '小家电（虚构型号）',
    quantity: '1200',
    unit: 'PCS',
    trade_value: { amount: '96000', currency: 'USD' },
    seller_goods_cost: { amount: '520000', currency: 'CNY' },
    tax_key: 'APPLIANCE',
  },
  items: [
    presetToCostItem(preset('goods-value'), {
      cost_id: 'goods',
      currency: 'USD',
      base_currency: 'CNY',
      fx_type: 'CONTRACT',
      amount: '96000',
      overrides: { cost_name: '商品货值' },
    }),
    presetToCostItem(preset('packing'), {
      cost_id: 'packing',
      currency: 'CNY',
      base_currency: 'CNY',
      amount: '3600',
    }),
    presetToCostItem(preset('inland-freight'), {
      cost_id: 'inland',
      currency: 'CNY',
      base_currency: 'CNY',
      quantity: '2',
      rate: '2400',
      unit: '车',
    }),
    presetToCostItem(preset('export-customs-broker'), {
      cost_id: 'export-broker',
      currency: 'CNY',
      base_currency: 'CNY',
      amount: '800',
    }),
    presetToCostItem(preset('commodity-inspection'), {
      cost_id: 'inspection',
      currency: 'CNY',
      base_currency: 'CNY',
      amount: '1200',
    }),
    presetToCostItem(preset('fumigation'), {
      cost_id: 'fumigation',
      currency: 'CNY',
      base_currency: 'CNY',
      amount: '900',
    }),
    presetToCostItem(preset('booking'), {
      cost_id: 'booking',
      currency: 'CNY',
      base_currency: 'CNY',
      amount: '500',
    }),
    presetToCostItem(preset('thc-origin'), {
      cost_id: 'thc-origin',
      currency: 'CNY',
      base_currency: 'CNY',
      quantity: '2',
      rate: '1200',
    }),
    customCostItem({
      cost_id: 'ocean-freight',
      cost_name: '国际海运费',
      cost_category: 'MAIN_CARRIAGE',
      trade_node: 'MAIN_CARRIAGE',
      currency: 'USD',
      base_currency: 'CNY',
      fx_type: 'CONTRACT',
      amount: '8200',
    }),
    customCostItem({
      cost_id: 'insurance',
      cost_name: '保险费（CIF 卖方投保）',
      cost_category: 'INSURANCE',
      trade_node: 'MAIN_CARRIAGE',
      currency: 'USD',
      base_currency: 'CNY',
      fx_type: 'CONTRACT',
      amount: '600',
    }),
    presetToCostItem(preset('thc-destination'), {
      cost_id: 'thc-dest',
      currency: 'CNY',
      base_currency: 'CNY',
      quantity: '2',
      rate: '1600',
    }),
    customCostItem({
      cost_id: 'demurrage',
      cost_name: '目的港滞箱费',
      cost_category: 'DESTINATION_TERMINAL',
      trade_node: 'DESTINATION_TERMINAL',
      currency: 'USD',
      base_currency: 'CNY',
      fx_type: 'CONTRACT',
      pricing_method: 'TIERED',
      tier_mode: 'MARGINAL',
      tier_basis: 'DAYS',
      days: '9',
      // 买方未及时提货：过错责任优先于术语，即便 DDP 也归买方
      occurrence_reason: 'BUYER_FAULT',
      tiers: [
        { up_to: '7', rate: '0' },
        { up_to: '15', rate: '55' },
        { up_to: null, rate: '90' },
      ],
    }),
    presetToCostItem(preset('import-customs-broker'), {
      cost_id: 'import-broker',
      currency: 'CNY',
      base_currency: 'CNY',
      amount: '1500',
    }),
    presetToCostItem(preset('destination-transport'), {
      cost_id: 'dest-transport',
      currency: 'CNY',
      base_currency: 'CNY',
      amount: '4200',
    }),
  ],
};

/**
 * 报价 CIF 汉堡 USD 106,800。
 *
 * 构成：货值 96,000 + 国内费用 2,000（14,200 元 ÷ 7.10）+ 海运费 8,200 + 保险费 600。
 * 国内费用必须计入报价，否则报价不覆盖卖方全部成本，勾稽校验会（正确地）报警。
 * 按 7.10 折算刚好是整数，便于核对。
 */
export const VIRTUAL_SCENARIO: Scenario = {
  id: 'scenario-virtual',
  name: 'CIF 汉堡',
  trade_id: VIRTUAL_TRADE.id,
  incoterm: 'CIF',
  base_currency: 'CNY',
  quote: {
    amount: '106800',
    currency: 'USD',
    incoterm: 'CIF',
    included_cost_ids: [],
    fx_type: 'CONTRACT',
    fx_date: '2026-09-01',
  },
  anchor: { kind: 'FIXED_QUOTE' },
};
