import { describe, expect, it } from 'vitest';
import { toStorage } from '../src/domain/decimal';
import type { BaseRef } from '../src/domain/cost-item';
import { computeGrossAmount, normalizeAll, type PricingContext } from '../src/engine/pricing';
import { EngineError } from '../src/engine/errors';
import { makeCostItem } from './helpers/factory';

const ctx: PricingContext = {
  resolveBase: (ref: BaseRef) => {
    switch (ref.kind) {
      case 'GOODS_VALUE':
        return '100000';
      case 'COST_ITEMS':
        return '250000';
      case 'QUOTE_AMOUNT':
        return '108300';
      default:
        return '0';
    }
  },
};

function expectEngineError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).code).toBe(code);
    return;
  }
  throw new Error(`预期抛出 ${code}，但没有抛出任何错误`);
}

describe('Cost Engine 计费归一化', () => {
  it('固定金额', () => {
    const item = makeCostItem({ cost_id: 'a', pricing_method: 'FIXED', amount: '800' });
    expect(toStorage(computeGrossAmount(item, ctx))).toBe('800.000000');
  });

  it('用户直接输入实际金额', () => {
    const item = makeCostItem({ cost_id: 'a', pricing_method: 'ACTUAL', amount: '1234.5678' });
    expect(toStorage(computeGrossAmount(item, ctx))).toBe('1234.567800');
  });

  it('数量 × 单价', () => {
    const item = makeCostItem({
      cost_id: 'a',
      pricing_method: 'QTY_X_UNIT',
      quantity: '2',
      unit: 'TEU',
      rate: '950',
    });
    expect(toStorage(computeGrossAmount(item, ctx))).toBe('1900.000000');
  });

  it('百分比基于计算基数', () => {
    const item = makeCostItem({
      cost_id: 'a',
      pricing_method: 'PERCENT',
      rate: '0.008',
      calculation_base: { kind: 'GOODS_VALUE' },
    });
    expect(toStorage(computeGrossAmount(item, ctx))).toBe('800.000000');
  });

  it('百分比可引用指定费用项之和', () => {
    const item = makeCostItem({
      cost_id: 'a',
      pricing_method: 'PERCENT',
      rate: '0.05',
      calculation_base: { kind: 'COST_ITEMS', ids: ['x', 'y'] },
    });
    expect(toStorage(computeGrossAmount(item, ctx))).toBe('12500.000000');
  });

  it('按天计费：直接给出天数', () => {
    const item = makeCostItem({ cost_id: 'a', pricing_method: 'PER_DAY', rate: '120', days: '5' });
    expect(toStorage(computeGrossAmount(item, ctx))).toBe('600.000000');
  });

  it('按天计费：天数由 timing 推导', () => {
    const item = makeCostItem({ cost_id: 'a', pricing_method: 'PER_DAY', rate: '120' });
    const withDays: PricingContext = { ...ctx, resolveDays: () => '7' };
    expect(toStorage(computeGrossAmount(item, withDays))).toBe('840.000000');
  });

  it('自定义费用不因名称陌生而无法计算', () => {
    const item = makeCostItem({
      cost_id: 'fumigation',
      cost_name: '熏蒸费',
      pricing_method: 'QTY_X_UNIT',
      quantity: '3',
      unit: 'CTN',
      rate: '85.5',
      is_custom: true,
      cost_category: 'CUSTOM',
    });
    expect(toStorage(computeGrossAmount(item, ctx))).toBe('256.500000');
  });

  it('阶梯计费缺少档位时报错，不静默按 0 处理', () => {
    const item = makeCostItem({ cost_id: 'a', pricing_method: 'TIERED', quantity: '10' });
    expectEngineError(() => computeGrossAmount(item, ctx), 'PRICING_TIER_INVALID');
  });

  it('缺少计价参数时报出缺哪个字段', () => {
    const item = makeCostItem({ cost_id: 'a', pricing_method: 'QTY_X_UNIT', quantity: '2' });
    expectEngineError(() => computeGrossAmount(item, ctx), 'PRICING_INPUT_MISSING');
  });

  it('百分比缺少计算基数时报错', () => {
    const item = makeCostItem({ cost_id: 'a', pricing_method: 'PERCENT', rate: '0.01' });
    expectEngineError(() => computeGrossAmount(item, ctx), 'PRICING_INPUT_MISSING');
  });

  it('按天计费无法确定天数时报错，不按 1 天兜底', () => {
    const item = makeCostItem({ cost_id: 'a', pricing_method: 'PER_DAY', rate: '120' });
    expectEngineError(() => computeGrossAmount(item, ctx), 'PRICING_BASE_MISSING');
  });

  it('费用 id 重复时报错', () => {
    const items = [
      makeCostItem({ cost_id: 'dup', amount: '1' }),
      makeCostItem({ cost_id: 'dup', amount: '2' }),
    ];
    expectEngineError(() => normalizeAll(items, ctx), 'DUPLICATE_COST_ID');
  });
});

/**
 * 报错文案是给外贸业务人员看的，不能出现 QTY_X_UNIT / quantity / cost_id 这类实现词汇。
 * 这一类问题已经被指出过两次（"参数"、报错里的 quantity），因此用测试锁住。
 */
describe('报错文案面向用户', () => {
  const internals = /QTY_X_UNIT|PER_DAY|TIERED|quantity|cost_id|timing\.start|day_basis|freight|insurance/;

  function messageOf(partial: Parameters<typeof makeCostItem>[0]): string {
    try {
      computeGrossAmount(makeCostItem(partial), ctx);
    } catch (error) {
      return (error as EngineError).message;
    }
    throw new Error('预期抛错，但没有抛出');
  }

  it('缺少计价参数时用中文名说明缺的是什么', () => {
    const message = messageOf({
      cost_id: 'freight',
      cost_name: '国际海运费',
      pricing_method: 'QTY_X_UNIT',
      quantity: '2',
    });
    expect(message).toContain('数量 × 单价');
    expect(message).toContain('单价');
    expect(message).not.toMatch(internals);
  });

  it('按天计费无法确定天数时不出现 days / timing 这类字段名', () => {
    const message = messageOf({
      cost_id: 'storage',
      cost_name: '目的港仓储费',
      pricing_method: 'PER_DAY',
      rate: '120',
    });
    expect(message).toContain('天数');
    expect(message).not.toMatch(internals);
  });

  it('阶梯计费的问题说明里不出现内部字段名', () => {
    const messages = [
      messageOf({ cost_id: 'a', cost_name: '滞箱费', pricing_method: 'TIERED', quantity: '9' }),
      messageOf({
        cost_id: 'a',
        cost_name: '滞箱费',
        pricing_method: 'TIERED',
        tier_basis: 'DAYS',
        tiers: [{ up_to: '7', rate: '0' }],
      }),
      messageOf({
        cost_id: 'a',
        cost_name: '滞箱费',
        pricing_method: 'TIERED',
        quantity: '99',
        tiers: [{ up_to: '7', rate: '0' }],
      }),
    ];
    for (const message of messages) {
      expect(message).not.toMatch(internals);
    }
  });
});
