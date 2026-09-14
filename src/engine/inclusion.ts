import type Decimal from 'decimal.js';
import { abs, isZero, sub, sum, toDisplay } from '../domain/decimal.js';
import type { CostItem } from '../domain/cost-item.js';
import type { Responsibility } from '../domain/enums.js';
import type { Warning } from '../domain/warning.js';

export type ExclusionReason =
  /** 已含在另一笔费用的报价内 */
  | 'CONTAINED_IN_PARENT'
  /** 已含于成交报价 */
  | 'INCLUDED_IN_QUOTE'
  /** 代表货物本身的价值，卖方成本由 Goods.seller_goods_cost 代表 */
  | 'GOODS_VALUE'
  /** 责任为 SHARED，v1 不做拆分 */
  | 'SHARED_NOT_SPLIT'
  /** 责任无法确定 */
  | 'CONDITIONAL_UNRESOLVED';

export interface InclusionConflict {
  cost_id: string;
  cost_name: string;
  message: string;
}

export interface InclusionInput {
  items: readonly CostItem[];
  /** 报价声明内含的费用项 id */
  included_cost_ids: readonly string[];
  /** 报价金额（核算币种） */
  quote_amount_base: Decimal;
  amountBaseOf: (costId: string) => Decimal;
  responsibilityOf: (costId: string) => Responsibility;
}

export interface InclusionResult {
  exclusions: ReadonlyMap<string, ExclusionReason>;
  conflicts: InclusionConflict[];
  warnings: Warning[];
  /** 报价声明内含的费用项金额合计（核算币种） */
  included_total: Decimal;
}

/**
 * 报价内含判定。
 *
 * 报价声明的内含清单为**权威口径**：一旦声明了非空清单，就完全覆盖费用项上的
 * `included_in_quoted_price` 标记。否则同一笔费用事实在 A 术语下"已含于报价"、
 * 换到 B 术语下仍然被当成已含，跨术语对比会失真。
 * 报价未声明清单时（单方案手工录入情形），退回使用费用项上的标记。
 */
export function buildInclusionPredicate(includedCostIds: readonly string[]): (item: CostItem) => boolean {
  const declared = new Set(includedCostIds);
  const authoritative = declared.size > 0;
  return (item) => (authoritative ? declared.has(item.cost_id) : item.included_in_quoted_price);
}

/**
 * 报价内含去重（设计文档 8.3）。
 *
 * 关键点：去重方向随术语变化，因此判定挂在"本次方案的报价所含集合"上，
 * 而不是费用项自身的布尔字段上。
 */
export function applyInclusion(input: InclusionInput): InclusionResult {
  const exclusions = new Map<string, ExclusionReason>();
  const conflicts: InclusionConflict[] = [];
  const warnings: Warning[] = [];
  const declared = new Set(input.included_cost_ids);
  const isIncluded = buildInclusionPredicate(input.included_cost_ids);
  const itemsById = new Map(input.items.map((item) => [item.cost_id, item]));

  for (const costId of declared) {
    if (!itemsById.has(costId)) {
      warnings.push({
        code: 'CONTAINED_PARENT_MISSING',
        level: 'WARN',
        message: `报价声明内含费用项 ${costId}，但费用清单中不存在该项`,
        cost_id: costId,
      });
    }
  }

  for (const item of input.items) {
    if (item.is_goods_value === true) {
      exclusions.set(item.cost_id, 'GOODS_VALUE');
      warnings.push({
        code: 'GOODS_VALUE_EXCLUDED',
        level: 'INFO',
        message: `费用「${item.cost_name}」代表货物本身的价值，不计入卖方成本汇总（卖方成本由采购成本代表），仅用于报价构成与完税价格`,
        cost_id: item.cost_id,
      });
      continue;
    }

    if (item.contained_in_cost_id !== undefined) {
      if (!itemsById.has(item.contained_in_cost_id)) {
        warnings.push({
          code: 'CONTAINED_PARENT_MISSING',
          level: 'WARN',
          message: `费用「${item.cost_name}」声明已含在 ${item.contained_in_cost_id} 中，但该父项不存在，请核对`,
          cost_id: item.cost_id,
        });
      }
      exclusions.set(item.cost_id, 'CONTAINED_IN_PARENT');
      continue;
    }

    const responsibility = input.responsibilityOf(item.cost_id);

    if (responsibility === 'CONDITIONAL') {
      exclusions.set(item.cost_id, 'CONDITIONAL_UNRESOLVED');
      warnings.push({
        code: 'RESP_CONDITIONAL',
        level: 'WARN',
        message: `费用「${item.cost_name}」的责任无法自动确定，未计入任何一方成本，请确认归属`,
        cost_id: item.cost_id,
      });
      continue;
    }

    if (responsibility === 'SHARED') {
      exclusions.set(item.cost_id, 'SHARED_NOT_SPLIT');
      warnings.push({
        code: 'RESP_SHARED_NOT_SPLIT',
        level: 'WARN',
        message: `费用「${item.cost_name}」为双方共担，当前版本不做拆分，未计入任何一方成本`,
        cost_id: item.cost_id,
      });
      continue;
    }

    if (isIncluded(item) && responsibility === 'BUYER') {
      exclusions.set(item.cost_id, 'INCLUDED_IN_QUOTE');
      conflicts.push({
        cost_id: item.cost_id,
        cost_name: item.cost_name,
        message: '该费用已含在报价中，但按当前术语应由买方承担，请确认是否为卖方代垫',
      });
      warnings.push({
        code: 'QUOTE_INCLUSION_CONFLICT',
        level: 'WARN',
        message: `费用「${item.cost_name}」已含在报价中，但按术语应由买方承担：已按"不重复计费"排除在买方额外成本之外，请确认是否为卖方代垫`,
        cost_id: item.cost_id,
      });
    }
  }

  // 疑似重复计费：同一实物流费用被录入多次
  const byDedupGroup = new Map<string, CostItem[]>();
  for (const item of input.items) {
    if (item.dedup_group === undefined) continue;
    const group = byDedupGroup.get(item.dedup_group) ?? [];
    group.push(item);
    byDedupGroup.set(item.dedup_group, group);
  }
  for (const [group, groupItems] of byDedupGroup) {
    if (groupItems.length > 1) {
      warnings.push({
        code: 'POSSIBLE_DUPLICATE',
        level: 'WARN',
        message: `费用分组「${group}」下有 ${groupItems.length} 笔费用（${groupItems
          .map((item) => item.cost_name)
          .join('、')}），可能是同一笔费用的重复录入`,
      });
    }
  }

  // 港杂费重复计费：主运输报价已声明含港杂费，却另有独立的港口费用项
  const freightDeclaringPortCharges = input.items.filter((item) => item.includes_port_charges === true);
  if (freightDeclaringPortCharges.length > 0) {
    const standaloneTerminalFees = input.items.filter(
      (item) =>
        (item.trade_node === 'ORIGIN_TERMINAL' || item.trade_node === 'DESTINATION_TERMINAL') &&
        item.contained_in_cost_id === undefined &&
        item.includes_port_charges !== true,
    );
    if (standaloneTerminalFees.length > 0) {
      warnings.push({
        code: 'PORT_CHARGE_DOUBLE_COUNT',
        level: 'WARN',
        message: `主运输报价（${freightDeclaringPortCharges
          .map((item) => item.cost_name)
          .join('、')}）已声明包含港口操作费，但仍存在独立的港口费用项（${standaloneTerminalFees
          .map((item) => item.cost_name)
          .join('、')}），请确认是否重复计费`,
      });
    }
  }

  // 报价勾稽：报价金额应等于其声明内含的费用项金额之和
  const quotedItems = input.items.filter(
    (item) => isIncluded(item) && item.contained_in_cost_id === undefined,
  );
  const includedTotal = sum(quotedItems.map((item) => input.amountBaseOf(item.cost_id)));

  if (quotedItems.length > 0) {
    const diff = abs(sub(includedTotal, input.quote_amount_base));
    if (!isZero(diff) && diff.greaterThan('0.01')) {
      warnings.push({
        code: 'QUOTE_NOT_RECONCILED',
        level: 'WARN',
        message: `报价金额与已标记为"含于报价"的费用项合计不一致：费用合计 ${toDisplay(
          includedTotal,
        )}，报价 ${toDisplay(input.quote_amount_base)}，差额 ${toDisplay(diff)}。请核对报价构成是否录全`,
      });
    }
  }

  return { exclusions, conflicts, warnings, included_total: includedTotal };
}
