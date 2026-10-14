import type { CostItem } from '../domain/cost-item.js';
import { INCOTERMS, type Incoterm } from '../domain/enums.js';
import type { Trade } from '../domain/trade.js';
import { EngineError } from './errors.js';

/** 先选实际费用，再计算汇率、依赖和计税；不将费用承担方推定为运输组织方。 */
export function costsForTerm(trade: Trade, term: Incoterm): { trade: Trade; inactive: CostItem[] } {
  const active: CostItem[] = []; const inactive: CostItem[] = [];
  for (const item of trade.items) {
    const terms = item.applicable_incoterms;
    if (terms !== undefined && (!Array.isArray(terms) || terms.some(t => !INCOTERMS.includes(t)) || new Set(terms).size !== terms.length)) {
      throw new EngineError('INPUT_VALUE_MISSING', `费用「${item.cost_name}」的适用术语无效或重复`, { cost_id: item.cost_id });
    }
    (terms === undefined || terms.includes(term) ? active : inactive).push(item);
  }
  const inactiveIds = new Set(inactive.map(item => item.cost_id));
  const groups = new Map<string, CostItem>();
  for (const item of active) {
    const group = item.alternative_group?.trim();
    if (group) {
      const previous = groups.get(group);
      if (previous !== undefined) throw new EngineError('INPUT_VALUE_MISSING', `${term}方案的替代报价组「${group}」同时启用了「${previous.cost_name}」和「${item.cost_name}」，请设置不重叠的适用术语`, { cost_id: item.cost_id });
      groups.set(group, item);
    }
    const references = [
      ...(item.contained_in_cost_id === undefined ? [] : [item.contained_in_cost_id]),
      ...(item.calculation_base?.kind === 'COST_ITEMS' ? item.calculation_base.ids : []),
    ];
    const missing = references.find(id => inactiveIds.has(id));
    if (missing !== undefined) throw new EngineError('COST_ITEM_NOT_FOUND', `${term}方案的费用「${item.cost_name}」引用了未启用费用 ${missing}；请调整适用术语或引用`, { cost_id: item.cost_id, reference: missing });
  }
  return { trade: { ...trade, items: active }, inactive };
}
