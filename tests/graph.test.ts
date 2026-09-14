import { describe, expect, it, vi } from 'vitest';
import { d, toStorage } from '../src/domain/decimal';
import type { FxResolution } from '../src/engine/fx';
import { buildValueGraph } from '../src/engine/graph';
import { EngineError } from '../src/engine/errors';
import { makeCostItem } from './helpers/factory';

const IDENTITY_CNY: FxResolution = {
  rate: d(1),
  from: 'CNY',
  to: 'CNY',
  fx_type: 'MARKET',
  fx_date: null,
  book_id: null,
  source: 'IDENTITY',
  inverted: false,
};

function graphFor(
  items: ReturnType<typeof makeCostItem>[],
  fx: Map<string, FxResolution>,
  options: { goodsValue?: string; quote?: string; dutiable?: () => string } = {},
) {
  return buildValueGraph({
    items,
    baseCurrency: 'CNY',
    goodsValueBase: d(options.goodsValue ?? '100000'),
    quoteAmountBase: d(options.quote ?? '108300'),
    fxByCostId: fx,
    dutiableValueResolver: () => d(options.dutiable?.() ?? '0'),
  });
}

function fxMap(items: { cost_id: string }[]): Map<string, FxResolution> {
  return new Map(items.map((item) => [item.cost_id, IDENTITY_CNY]));
}

describe('依赖图与计费基数', () => {
  it('解析引用其他费用项的百分比基数', () => {
    const items = [
      makeCostItem({ cost_id: 'a', pricing_method: 'FIXED', amount: '1000' }),
      makeCostItem({
        cost_id: 'b',
        pricing_method: 'PERCENT',
        rate: '0.05',
        calculation_base: { kind: 'COST_ITEMS', ids: ['a'] },
      }),
    ];
    const graph = graphFor(items, fxMap(items));
    expect(toStorage(graph.amountBase('b'))).toBe('50.000000');
  });

  it('支持货值与报价作为基数', () => {
    const items = [
      makeCostItem({ cost_id: 'onGoods', pricing_method: 'PERCENT', rate: '0.02', calculation_base: { kind: 'GOODS_VALUE' } }),
      makeCostItem({ cost_id: 'onQuote', pricing_method: 'PERCENT', rate: '0.03', calculation_base: { kind: 'QUOTE_AMOUNT' } }),
    ];
    const graph = graphFor(items, fxMap(items));
    expect(toStorage(graph.amountBase('onGoods'))).toBe('2000.000000');
    expect(toStorage(graph.amountBase('onQuote'))).toBe('3249.000000');
  });

  it('支持完税价格作为基数，且只解析一次', () => {
    const items = [
      makeCostItem({ cost_id: 'fee', pricing_method: 'PERCENT', rate: '0.01', calculation_base: { kind: 'CUSTOMS_DUTIABLE_VALUE' } }),
    ];
    const resolver = vi.fn(() => '766764');
    const graph = graphFor(items, fxMap(items), { dutiable: resolver });
    expect(toStorage(graph.amountBase('fee'))).toBe('7667.640000');
    graph.dutiableValue();
    graph.dutiableValue();
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('检测出计算基数成环', () => {
    const items = [
      makeCostItem({ cost_id: 'a', pricing_method: 'PERCENT', rate: '0.1', calculation_base: { kind: 'COST_ITEMS', ids: ['b'] } }),
      makeCostItem({ cost_id: 'b', pricing_method: 'PERCENT', rate: '0.1', calculation_base: { kind: 'COST_ITEMS', ids: ['a'] } }),
    ];
    const graph = graphFor(items, fxMap(items));
    expect(() => graph.amountBase('a')).toThrowError(EngineError);
    try {
      graph.amountBase('a');
    } catch (error) {
      expect((error as EngineError).code).toBe('GRAPH_CYCLE');
    }
  });

  it('百分比费用项的币种必须与核算币种一致', () => {
    const items = [
      makeCostItem({
        cost_id: 'a',
        pricing_method: 'PERCENT',
        rate: '0.1',
        currency: 'USD',
        calculation_base: { kind: 'GOODS_VALUE' },
      }),
    ];
    const graph = graphFor(items, fxMap(items));
    try {
      graph.amountBase('a');
      throw new Error('预期抛错');
    } catch (error) {
      expect((error as EngineError).code).toBe('PRICING_CURRENCY_MISMATCH');
    }
  });

  it('引用不存在的费用项时报错', () => {
    const items = [
      makeCostItem({ cost_id: 'a', pricing_method: 'PERCENT', rate: '0.1', calculation_base: { kind: 'COST_ITEMS', ids: ['missing'] } }),
    ];
    const graph = graphFor(items, fxMap(items));
    try {
      graph.amountBase('a');
      throw new Error('预期抛错');
    } catch (error) {
      expect((error as EngineError).code).toBe('COST_ITEM_NOT_FOUND');
    }
  });

  it('外币费用项按汇率换算到核算币种', () => {
    const items = [makeCostItem({ cost_id: 'a', pricing_method: 'FIXED', amount: '1000', currency: 'USD' })];
    const fx = new Map<string, FxResolution>([['a', { ...IDENTITY_CNY, from: 'USD', rate: d('7.05'), book_id: 'market' }]]);
    const graph = graphFor(items, fx);
    expect(toStorage(graph.grossOriginal('a'))).toBe('1000.000000');
    expect(toStorage(graph.amountBase('a'))).toBe('7050.000000');
  });
});
