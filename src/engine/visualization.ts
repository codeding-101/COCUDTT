import type Decimal from 'decimal.js';
import { d, sum } from '../domain/decimal.js';
import { COST_CATEGORY_LABELS } from '../domain/enums.js';
import type { AnalysisResult } from './analyze.js';

export interface ChartRow { label: string; amount: Decimal; kind: 'seller' | 'buyer' | 'muted' | 'tax' }
export interface ResultChart { id: string; title: string; note: string; rows: ChartRow[]; total: Decimal }

/** 图表只聚合已决结果，不重新判定归属、去重或汇率。 */
export function resultCharts(result: AnalysisResult): ResultChart[] {
  const items = result.items;
  const seller = items.filter(i => i.counts_to_seller);
  const buyer = items.filter(i => i.counts_to_buyer);
  const excluded = items.filter(i => !i.counts_to_seller && !i.counts_to_buyer);
  const categories = [...new Set(seller.map(i => i.item.cost_category))];
  const b = result.buyer;
  return [
    { id: 'responsibility', title: '费用明细的汇总去向', note: '仅费用明细，不含独立报价与采购成本。“未计入”包括父项包含、报价内含、货值行及未拆分/待确认项；其金额仅作核对，不能加到总成本。弱推断计入项仍受待办限制。',
      rows: [
        { label: `计入卖方（${seller.length}项）`, amount: sum(seller.map(i => i.base_amount)), kind: 'seller' },
        { label: `计入买方报价外（${buyer.length}项）`, amount: sum(buyer.map(i => i.base_amount)), kind: 'buyer' },
        { label: `未计入汇总（${excluded.length}项，核对值）`, amount: sum(excluded.map(i => i.base_amount)), kind: 'muted' },
      ], total: sum([...seller, ...buyer].map(i => i.base_amount)) },
    { id: 'seller-fees', title: '卖方承担费用构成', note: '只包含计入卖方的费用，不含采购成本、退税或利润。', rows: categories.map(category => ({ label: COST_CATEGORY_LABELS[category], amount: sum(seller.filter(i => i.item.cost_category === category).map(i => i.base_amount)), kind: 'seller' })), total: result.seller.cost_total },
    { id: 'buyer-payment', title: '买方总支付构成', note: '报价只出现一次；已含于报价的买方费用不再加入。DDP由卖方承担的税额不会重复列为买方税额。', rows: [
      { label: '核算报价', amount: b.quote_amount, kind: 'buyer' },
      { label: '报价外非派生税费用', amount: b.additional_cost_total.minus(b.duty_total).minus(b.consumption_tax_total).minus(b.vat_total), kind: 'buyer' },
      { label: '买方承担关税', amount: b.duty_total, kind: 'tax' },
      { label: '买方承担消费税', amount: b.consumption_tax_total, kind: 'tax' },
      { label: '买方承担进口增值税', amount: b.vat_total, kind: 'tax' },
    ], total: b.landed_cost_with_tax },
    { id: 'customs-base', title: '海关计税价格构成', note: '使用计税换算金额，独立于商业汇率和费用归属。保额不进入税基；估算保费会明确标记。',
      rows: result.dutiable_value.components.map(c => ({ label: c.label, amount: c.amount, kind: c.basis === 'GOODS' ? 'muted' : 'tax' })), total: result.dutiable_value.value },
  ];
}

/** 带符号金额按最大绝对值绘制长度，不把负值或零总额做饼图。 */
export function barLength(amount: Decimal, rows: readonly ChartRow[]): string {
  const max = rows.reduce((value, row) => row.amount.abs().gt(value) ? row.amount.abs() : value, d(0));
  return max.isZero() ? '0' : amount.abs().div(max).times(100).toFixed(3);
}
