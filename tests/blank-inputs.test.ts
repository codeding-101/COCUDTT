import { describe, expect, it } from 'vitest';
import { d, toStorage } from '../src/domain/decimal';
import type { FxBook } from '../src/domain/fx';
import { analyze } from '../src/engine/analyze';
import { EngineError } from '../src/engine/errors';
import { computeGrossAmount, type PricingContext } from '../src/engine/pricing';
import { resolveFxRate } from '../src/engine/fx';
import { computeImportTaxes } from '../src/engine/tax/import-tax';
import { CIF_108300_SCENARIO, CIF_108300_TRADE, CONTRACT_FX_BOOK, CUSTOMS_FX_BOOK, TEST_TAX_PROFILE } from './fixtures/cif-108300';
import { makeCostItem, makeScenario, makeTrade } from './helpers/factory';

/**
 * 空输入回归。
 *
 * 用户在界面上清空任何一个数字框，传到引擎的是空字符串而不是 undefined。
 * 曾经这些空串会一路流进 decimal.js，抛出 `[DecimalError] Invalid argument`——
 * 界面只能显示"未知错误"，且泄露了内部库的名字。
 *
 * 正确行为：拦住，并说清是哪一项没填。
 */

const ctx: PricingContext = { resolveBase: () => '0' };

function codeAndMessage(fn: () => unknown): { code: string; message: string } {
  try {
    fn();
  } catch (error) {
    if (error instanceof EngineError) return { code: error.code, message: error.message };
    throw new Error(`抛出的不是 EngineError，而是：${String(error)}`);
  }
  throw new Error('预期抛错，但没有抛出');
}

describe('空输入 · 数值层', () => {
  it('空字符串不是 0，也不交给库去报错', () => {
    expect(() => d('')).toThrowError('数值不能为空');
    expect(() => d('   ')).toThrowError('数值不能为空');
    // 真正的 0 仍然正常
    expect(toStorage(d('0'))).toBe('0.000000');
  });
});

describe('空输入 · 计价', () => {
  it('清空单价：说缺的是单价', () => {
    const item = makeCostItem({
      cost_id: 'freight',
      cost_name: '国际海运费',
      pricing_method: 'QTY_X_UNIT',
      quantity: '2',
      rate: '',
    });
    const result = codeAndMessage(() => computeGrossAmount(item, ctx));
    expect(result.code).toBe('PRICING_INPUT_MISSING');
    expect(result.message).toContain('单价');
    expect(result.message).not.toMatch(/DecimalError|Invalid argument/);
  });

  it('清空数量：说缺的是数量', () => {
    const item = makeCostItem({
      cost_id: 'freight',
      cost_name: '国际海运费',
      pricing_method: 'QTY_X_UNIT',
      quantity: '',
      rate: '150',
    });
    expect(codeAndMessage(() => computeGrossAmount(item, ctx)).message).toContain('数量');
  });

  it('清空金额：说缺的是金额', () => {
    const item = makeCostItem({ cost_id: 'a', cost_name: '报关费', pricing_method: 'FIXED', amount: '' });
    expect(codeAndMessage(() => computeGrossAmount(item, ctx)).message).toContain('金额');
  });

  it('清空按天计费的天数：提示填天数或起止日期', () => {
    const item = makeCostItem({ cost_id: 'a', cost_name: '仓储费', pricing_method: 'PER_DAY', rate: '120', days: '' });
    const result = codeAndMessage(() => computeGrossAmount(item, ctx));
    expect(result.message).toContain('天数');
    expect(result.message).not.toMatch(/timing|days/);
  });
});

describe('空输入 · 阶梯', () => {
  it('档位费率没填时明确说出来，而不是抛库错误', () => {
    const item = makeCostItem({
      cost_id: 'a',
      cost_name: '滞箱费',
      pricing_method: 'TIERED',
      quantity: '9',
      tiers: [
        { up_to: '7', rate: '0' },
        { up_to: null, rate: '' },
      ],
    });
    const result = codeAndMessage(() => computeGrossAmount(item, ctx));
    expect(result.code).toBe('PRICING_TIER_INVALID');
    expect(result.message).toContain('费率');
    expect(result.message).not.toMatch(/DecimalError|Invalid argument/);
  });
});

describe('空输入 · 汇率簿', () => {
  const bookWithBlank: FxBook = {
    id: 'fx-blank',
    name: '有空格子的汇率簿',
    type: 'CONTRACT',
    date: '2026-09-01',
    rates: { 'USD/CNY': '' },
  };

  it('汇率格里是空的，按"缺这个币种对"处理，不抛库错误', () => {
    const result = codeAndMessage(() =>
      resolveFxRate({ from: 'USD', to: 'CNY', fxType: 'CONTRACT', books: [bookWithBlank] }),
    );
    expect(result.code).toBe('FX_MISSING');
    expect(result.message).toContain('USD/CNY');
    expect(result.message).not.toMatch(/DecimalError|Invalid argument/);
  });
});

describe('空输入 · 入口校验', () => {
  const base = { trade: CIF_108300_TRADE, taxProfile: TEST_TAX_PROFILE, fxBooks: [CONTRACT_FX_BOOK, CUSTOMS_FX_BOOK] };

  it('报价金额为空时点名是哪一项', () => {
    const scenario = { ...CIF_108300_SCENARIO, quote: { ...CIF_108300_SCENARIO.quote, amount: '' } };
    const result = codeAndMessage(() => analyze({ ...base, scenario }));
    expect(result.code).toBe('INPUT_VALUE_MISSING');
    expect(result.message).toContain('报价金额');
    expect(result.message).not.toMatch(/DecimalError|Invalid argument/);
  });

  it('成交货值为空时点名是哪一项', () => {
    const trade = { ...CIF_108300_TRADE, goods: { ...CIF_108300_TRADE.goods, trade_value: { amount: '', currency: 'USD' } } };
    const result = codeAndMessage(() => analyze({ ...base, trade, scenario: CIF_108300_SCENARIO }));
    expect(result.message).toContain('成交货值');
  });

  it('商品数量为空时点名是哪一项', () => {
    const trade = { ...CIF_108300_TRADE, goods: { ...CIF_108300_TRADE.goods, quantity: '' } };
    expect(codeAndMessage(() => analyze({ ...base, trade, scenario: CIF_108300_SCENARIO })).message).toContain('商品数量');
  });

  it('填了带千分位或货币符号的数字时，说清楚要填纯数字', () => {
    const scenario = { ...CIF_108300_SCENARIO, quote: { ...CIF_108300_SCENARIO.quote, amount: '108,300' } };
    const result = codeAndMessage(() => analyze({ ...base, scenario }));
    expect(result.code).toBe('INPUT_VALUE_MISSING');
    expect(result.message).toContain('纯数字');
  });
});

describe('空输入 · HS 从量税', () => {
  it('单位税额为空时按"未填写"报错', () => {
    const profile = {
      ...TEST_TAX_PROFILE,
      import: {
        ...TEST_TAX_PROFILE.import,
        hsTable: {
          basis: 'MFN' as const,
          entries: [{ code: '2203000000', description: '啤酒', duty_type: 'SPECIFIC' as const, specific_amount: '' }],
        },
      },
    };
    const result = codeAndMessage(() =>
      computeImportTaxes({ profile, dutiableValue: d('100000'), taxKey: '2203000000', quantity: '1000', unit: '升' }),
    );
    expect(result.code).toBe('HS_SPECIFIC_AMOUNT_MISSING');
    expect(result.message).not.toMatch(/DecimalError|Invalid argument/);
  });
});
