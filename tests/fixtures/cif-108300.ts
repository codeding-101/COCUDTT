import type { FxBook } from '../../src/domain/fx';
import type { Scenario } from '../../src/domain/scenario';
import type { TaxProfile } from '../../src/domain/tax-profile';
import type { Trade } from '../../src/domain/trade';
import { makeCostItem } from '../helpers/factory';

/**
 * 需求中给出的回归用例（设计文档 8.1）：
 *
 *   CIF Price = USD 108,300
 *     其中 Goods     100,000
 *          Freight     8,000
 *          Insurance     300
 *
 * 三项合计恰好等于报价，用于验证「计价 → 换算 → 与报价勾稽」这条链路。
 */
export const CONTRACT_FX_BOOK: FxBook = {
  id: 'fx-contract-2026-08',
  name: '合同约定汇率 2026-08',
  type: 'CONTRACT',
  date: '2026-08-15',
  rates: { 'USD/CNY': '7.0000' },
};

/** 海关适用汇率与合同汇率不是同一个数，完税价格必须用海关汇率折算 */
export const CUSTOMS_FX_BOOK: FxBook = {
  id: 'fx-customs-2026-09',
  name: '海关适用汇率 2026-09',
  type: 'CUSTOMS',
  date: '2026-09-17',
  valid_from: '2026-09-01',
  valid_to: '2026-09-30',
  rates: { 'USD/CNY': '7.0800' },
};

export const TEST_TAX_PROFILE: TaxProfile = {
  id: 'china-customs',
  version: 'test',
  import: {
    dutiableValueBasis: 'CIF',
    dutyRates: { fallback: '0.05' },
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

export const CIF_108300_TRADE: Trade = {
  id: 'trade-cif-108300',
  name: 'CIF 报价 108,300 回归用例',
  base_currency: 'CNY',
  carriage_mode: 'SEA',
  export_date: '2026-09-01',
  goods: {
    name: '示例商品',
    quantity: '1000',
    unit: 'PCS',
    trade_value: { amount: '100000', currency: 'USD' },
    seller_goods_cost: { amount: '620000', currency: 'CNY' },
    tax_key: 'DEMO',
  },
  items: [
    makeCostItem({
      cost_id: 'goods',
      cost_name: '商品货值',
      cost_category: 'GOODS_AND_PACKING',
      trade_node: 'SELLER_PREMISES',
      pricing_method: 'ACTUAL',
      amount: '100000',
      currency: 'USD',
      fx_type: 'CONTRACT',
      responsibility: 'SELLER',
      responsibility_source: 'INCOTERM_RULE',
      included_in_quoted_price: true,
      is_goods_value: true,
      is_custom: false,
    }),
    makeCostItem({
      cost_id: 'freight',
      cost_name: '国际海运费',
      cost_category: 'MAIN_CARRIAGE',
      trade_node: 'MAIN_CARRIAGE',
      pricing_method: 'ACTUAL',
      amount: '8000',
      currency: 'USD',
      fx_type: 'CONTRACT',
      responsibility: 'SELLER',
      responsibility_source: 'INCOTERM_RULE',
      included_in_quoted_price: true,
      is_custom: false,
    }),
    makeCostItem({
      cost_id: 'insurance',
      cost_name: '保险费',
      cost_category: 'INSURANCE',
      trade_node: 'MAIN_CARRIAGE',
      pricing_method: 'ACTUAL',
      amount: '300',
      currency: 'USD',
      fx_type: 'CONTRACT',
      responsibility: 'SELLER',
      responsibility_source: 'INCOTERM_RULE',
      included_in_quoted_price: true,
      is_custom: false,
    }),
  ],
};

/** 报价 108,300 USD，内含商品、运费、保险三项 */
export const CIF_108300_SCENARIO: Scenario = {
  id: 'scenario-cif-108300',
  name: 'CIF 方案',
  trade_id: CIF_108300_TRADE.id,
  incoterm: 'CIF',
  base_currency: 'CNY',
  quote: {
    amount: '108300',
    currency: 'USD',
    incoterm: 'CIF',
    included_cost_ids: ['goods', 'freight', 'insurance'],
    fx_type: 'CONTRACT',
  },
  fx_book_ids: { CONTRACT: CONTRACT_FX_BOOK.id },
  anchor: { kind: 'FIXED_QUOTE' },
};
