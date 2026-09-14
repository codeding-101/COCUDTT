import { describe, expect, it } from 'vitest';
import { d } from '../src/domain/decimal';
import type { CostItem } from '../src/domain/cost-item';
import type { Responsibility } from '../src/domain/enums';
import { applyInclusion } from '../src/engine/inclusion';
import { makeCostItem } from './helpers/factory';

interface RunOptions {
  included?: string[];
  quote?: string;
  responsibility?: Record<string, Responsibility>;
}

function run(items: CostItem[], options: RunOptions = {}) {
  const amountById = new Map(items.map((item) => [item.cost_id, d(String(item.amount ?? '0'))]));
  return applyInclusion({
    items,
    included_cost_ids: options.included ?? [],
    quote_amount_base: d(options.quote ?? '0'),
    amountBaseOf: (costId) => amountById.get(costId) ?? d(0),
    responsibilityOf: (costId) => options.responsibility?.[costId] ?? 'SELLER',
  });
}

function codes(warnings: { code: string }[]): string[] {
  return warnings.map((warning) => warning.code);
}

describe('报价内含去重', () => {
  it('已含于报价且由卖方承担的费用照常计入卖方成本', () => {
    const items = [
      makeCostItem({ cost_id: 'freight', amount: '1000', included_in_quoted_price: true, cost_category: 'MAIN_CARRIAGE' }),
    ];
    const result = run(items, { quote: '1000' });
    expect(result.exclusions.size).toBe(0);
    expect(result.included_total.toFixed(6)).toBe('1000.000000');
  });

  it('已含于报价却按术语应由买方承担时给出冲突并排除，避免重复计费', () => {
    const items = [makeCostItem({ cost_id: 'freight', amount: '1000', included_in_quoted_price: true })];
    const result = run(items, { quote: '1000', responsibility: { freight: 'BUYER' }, included: ['freight'] });
    expect(result.exclusions.get('freight')).toBe('INCLUDED_IN_QUOTE');
    expect(result.conflicts.map((conflict) => conflict.cost_id)).toEqual(['freight']);
    expect(codes(result.warnings)).toContain('QUOTE_INCLUSION_CONFLICT');
  });

  it('已含在其他费用报价内的费用项不参与汇总', () => {
    const items = [
      makeCostItem({ cost_id: 'freight', amount: '1000', cost_category: 'MAIN_CARRIAGE' }),
      makeCostItem({ cost_id: 'thc', amount: '300', contained_in_cost_id: 'freight' }),
    ];
    const result = run(items);
    expect(result.exclusions.get('thc')).toBe('CONTAINED_IN_PARENT');
    expect(result.exclusions.has('freight')).toBe(false);
  });

  it('父项不存在时告警但仍排除，防止静默计入', () => {
    const items = [makeCostItem({ cost_id: 'thc', amount: '300', contained_in_cost_id: 'missing' })];
    const result = run(items);
    expect(result.exclusions.get('thc')).toBe('CONTAINED_IN_PARENT');
    expect(codes(result.warnings)).toContain('CONTAINED_PARENT_MISSING');
  });

  it('代表货值的费用项被排除，避免与采购成本重复计算', () => {
    const items = [makeCostItem({ cost_id: 'goods', amount: '700000', is_goods_value: true })];
    const result = run(items, { quote: '700000' });
    expect(result.exclusions.get('goods')).toBe('GOODS_VALUE');
    expect(codes(result.warnings)).toContain('GOODS_VALUE_EXCLUDED');
  });

  it('责任无法确定的费用项不计入任何一方', () => {
    const items = [makeCostItem({ cost_id: 'storage', amount: '500' })];
    const result = run(items, { responsibility: { storage: 'CONDITIONAL' } });
    expect(result.exclusions.get('storage')).toBe('CONDITIONAL_UNRESOLVED');
    expect(codes(result.warnings)).toContain('RESP_CONDITIONAL');
  });

  it('共担费用不作拆分，提示用户确认', () => {
    const items = [makeCostItem({ cost_id: 'shared', amount: '500' })];
    const result = run(items, { responsibility: { shared: 'SHARED' } });
    expect(result.exclusions.get('shared')).toBe('SHARED_NOT_SPLIT');
    expect(codes(result.warnings)).toContain('RESP_SHARED_NOT_SPLIT');
  });
});

describe('重复计费与勾稽校验', () => {
  it('同一费用分组下多笔费用时提示可能重复', () => {
    const items = [
      makeCostItem({ cost_id: 'a', amount: '100', dedup_group: 'ocean-freight' }),
      makeCostItem({ cost_id: 'b', amount: '100', dedup_group: 'ocean-freight' }),
    ];
    expect(codes(run(items).warnings)).toContain('POSSIBLE_DUPLICATE');
  });

  it('主运费声明含港杂费却另有独立港口费用时提示重复计费', () => {
    const items = [
      makeCostItem({
        cost_id: 'freight',
        cost_name: '海运费',
        amount: '1000',
        cost_category: 'MAIN_CARRIAGE',
        includes_port_charges: true,
      }),
      makeCostItem({ cost_id: 'thc', cost_name: '起运港港杂费', amount: '300', trade_node: 'ORIGIN_TERMINAL' }),
    ];
    expect(codes(run(items).warnings)).toContain('PORT_CHARGE_DOUBLE_COUNT');
  });

  it('港口费用已标记为含在运费内时不再提示', () => {
    const items = [
      makeCostItem({
        cost_id: 'freight',
        amount: '1000',
        cost_category: 'MAIN_CARRIAGE',
        includes_port_charges: true,
      }),
      makeCostItem({
        cost_id: 'thc',
        amount: '300',
        trade_node: 'ORIGIN_TERMINAL',
        contained_in_cost_id: 'freight',
      }),
    ];
    expect(codes(run(items).warnings)).not.toContain('PORT_CHARGE_DOUBLE_COUNT');
  });

  it('报价金额与含于报价的费用项合计不符时告警', () => {
    const items = [
      makeCostItem({ cost_id: 'goods', amount: '700000', included_in_quoted_price: true, is_goods_value: true }),
      makeCostItem({ cost_id: 'freight', amount: '56000', included_in_quoted_price: true, cost_category: 'MAIN_CARRIAGE' }),
    ];
    expect(codes(run(items, { quote: '756000' }).warnings)).not.toContain('QUOTE_NOT_RECONCILED');
    expect(codes(run(items, { quote: '800000' }).warnings)).toContain('QUOTE_NOT_RECONCILED');
  });

  it('报价声明内含不存在的费用项时告警', () => {
    const items = [makeCostItem({ cost_id: 'a', amount: '1' })];
    expect(codes(run(items, { included: ['ghost'] }).warnings)).toContain('CONTAINED_PARENT_MISSING');
  });
});
