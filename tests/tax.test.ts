import { describe, expect, it } from 'vitest';
import { d, toStorage } from '../src/domain/decimal';
import type { Goods } from '../src/domain/goods';
import { computeDutiableValue } from '../src/engine/tax/dutiable-value';
import { computeImportTaxes, totalTaxes } from '../src/engine/tax/import-tax';
import { CUSTOMS_FX_BOOK, TEST_TAX_PROFILE } from './fixtures/cif-108300';
import { makeCostItem } from './helpers/factory';

const goods: Goods = {
  name: '示例商品',
  quantity: '1000',
  unit: 'PCS',
  trade_value: { amount: '100000', currency: 'USD' },
  seller_goods_cost: { amount: '620000', currency: 'CNY' },
  tax_key: 'DEMO',
};

const items = [
  makeCostItem({
    cost_id: 'freight',
    cost_name: '国际海运费',
    cost_category: 'MAIN_CARRIAGE',
    trade_node: 'MAIN_CARRIAGE',
    pricing_method: 'ACTUAL',
    amount: '8000',
    currency: 'USD',
    fx_type: 'CONTRACT',
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
  }),
];

const grossOf = (costId: string): ReturnType<typeof d> =>
  d(items.find((item) => item.cost_id === costId)?.amount ?? '0');
/** 商业汇率 7.00 */
const amountBase = (costId: string): ReturnType<typeof d> => d(grossOf(costId).times('7'));

describe('完税价格', () => {
  it('按海关适用汇率折算，与商业汇率口径不同', () => {
    const result = computeDutiableValue({
      goods,
      items,
      baseCurrency: 'CNY',
      books: [CUSTOMS_FX_BOOK],
      profile: TEST_TAX_PROFILE,
      goodsValueBase: d('700000'),
      grossOf,
      amountBase,
    });
    // (100,000 + 8,000 + 300) × 7.08
    expect(toStorage(result.value)).toBe('766764.000000');
    expect(result.warnings).toHaveLength(0);
    expect(result.components.map((component) => component.basis)).toEqual(['GOODS', 'FREIGHT', 'INSURANCE']);
  });

  it('缺少海关适用汇率时给出告警并退回商业口径，不静默混用', () => {
    const result = computeDutiableValue({
      goods,
      items,
      baseCurrency: 'CNY',
      books: [],
      profile: TEST_TAX_PROFILE,
      goodsValueBase: d('700000'),
      grossOf,
      amountBase,
    });
    expect(toStorage(result.value)).toBe('758100.000000');
    expect(result.warnings.map((warning) => warning.code)).toContain('CUSTOMS_FX_FALLBACK');
  });

  it('未录入保险费时按货价加运费的比率计提', () => {
    const profile = {
      ...TEST_TAX_PROFILE,
      import: { ...TEST_TAX_PROFILE.import, insuranceFallbackRate: '0.003' },
    };
    const result = computeDutiableValue({
      goods,
      items: items.filter((item) => item.cost_id === 'freight'),
      baseCurrency: 'CNY',
      books: [CUSTOMS_FX_BOOK],
      profile,
      goodsValueBase: d('700000'),
      grossOf,
      amountBase,
    });
    // (100000 + 8000) × 7.08 = 764,640；保险费 = 764,640 × 0.3% = 2,293.92
    expect(toStorage(result.value)).toBe('766933.920000');
    expect(result.warnings.map((warning) => warning.code)).toContain('INSURANCE_FALLBACK_APPLIED');
  });

  it('已声明含在父项报价中的费用项不重复计入完税价格', () => {
    const contained = makeCostItem({
      cost_id: 'thc',
      cost_category: 'MAIN_CARRIAGE',
      amount: '500',
      currency: 'USD',
      contained_in_cost_id: 'freight',
    });
    const result = computeDutiableValue({
      goods,
      items: [...items, contained],
      baseCurrency: 'CNY',
      books: [CUSTOMS_FX_BOOK],
      profile: TEST_TAX_PROFILE,
      goodsValueBase: d('700000'),
      grossOf: (costId) => (costId === 'thc' ? d('500') : grossOf(costId)),
      amountBase: (costId) => (costId === 'thc' ? d('3500') : amountBase(costId)),
    });
    expect(toStorage(result.value)).toBe('766764.000000');
  });
});

describe('进口环节税费', () => {
  const dutiable = d('766764');

  it('关税 → 增值税的递进基数', () => {
    const result = computeImportTaxes({ profile: TEST_TAX_PROFILE, dutiableValue: dutiable });
    expect(toStorage(result.duty)).toBe('38338.200000');
    expect(toStorage(result.consumption_tax)).toBe('0.000000');
    expect(toStorage(result.vat)).toBe('104663.286000');
    expect(toStorage(totalTaxes(result))).toBe('143001.486000');
  });

  it('消费税并入增值税基数', () => {
    const profile = {
      ...TEST_TAX_PROFILE,
      import: { ...TEST_TAX_PROFILE.import, consumptionTax: { rate: '0.1', basis: 'DUTIABLE_PLUS_DUTY' as const } },
    };
    const result = computeImportTaxes({ profile, dutiableValue: dutiable });
    // (766,764 + 38,338.2) ÷ 0.9 × 0.1 = 89,455.8
    expect(toStorage(result.consumption_tax)).toBe('89455.800000');
    // (766,764 + 38,338.2 + 89,455.8) × 0.13 = 116,292.54
    expect(toStorage(result.vat)).toBe('116292.540000');
  });

  it('关税低于免征额度时免征并告警', () => {
    const profile = {
      ...TEST_TAX_PROFILE,
      import: { ...TEST_TAX_PROFILE.import, dutyExemptionThreshold: '50000' },
    };
    const result = computeImportTaxes({ profile, dutiableValue: dutiable });
    expect(toStorage(result.duty)).toBe('0.000000');
    expect(result.exemption_applied).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toContain('DUTY_EXEMPTED');
    // 增值税基数回到不含关税的口径
    expect(toStorage(result.vat)).toBe('99679.320000');
  });
});
