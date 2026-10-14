import type { CompareInput } from '../../src/engine/compare';
import type { Scenario } from '../../src/domain/scenario';
import { INCOTERMS } from '../../src/domain/enums';

/** 财务勾稽用例的独立合成合同前提，不作为术语默认值或实际业务资料。 */
export function explicitAgreements(input: CompareInput): CompareInput {
  const scenarios: Partial<Record<Scenario['incoterm'], Scenario>> = {};
  for (const term of INCOTERMS) {
    const template = input.scenarios?.[term] ?? input.template;
    const overrides = { ...template.responsibility_overrides };
    for (const item of input.trade.items) {
      if (item.cost_category === 'INSURANCE' && !['CIF', 'CIP'].includes(term)) overrides[item.cost_id] = {
        responsibility: ['DAP', 'DPU', 'DDP'].includes(term) ? 'SELLER' : 'BUYER',
        reason: '合成手算合同明确该方自愿投保付费；非术语强制保险义务',
      };
      if (item.trade_node === 'DESTINATION_TERMINAL' && !item.occurrence_reason) overrides[item.cost_id] = {
        responsibility: ['CPT', 'CIP', 'DAP', 'DPU', 'DDP'].includes(term) ? 'SELLER' : 'BUYER',
        reason: '合成手算合同明确港杂费是否由卖方运输合同承担；不从术语或班轮名称推定',
      };
      if (item.trade_node === 'DESTINATION_TRANSPORT' && ['CPT', 'CIP'].includes(term)) overrides[item.cost_id] = {
        responsibility: 'SELLER', reason: '合成合同的指定运费终点为内陆仓库，此段包含在卖方运输安排内',
      };
    }
    scenarios[term] = { ...template, incoterm: term, quote: { ...template.quote, incoterm: term }, responsibility_overrides: overrides,
      ...(term === 'FCA' ? { facts: { ...template.facts, delivery_place: 'SELLER_PREMISES' } } : {}) };
  }
  return { ...input, scenarios };
}
