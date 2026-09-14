import type { CostItem } from '../../domain/cost-item.js';
import type { CarriageMode, Party, Responsibility, ResponsibilitySource } from '../../domain/enums.js';
import type {
  Condition,
  ContractClause,
  CostResponsibilityRule,
  IncotermRule,
  IncotermsRuleSet,
  ScenarioFacts,
} from '../../domain/rule.js';
import type { Scenario } from '../../domain/scenario.js';
import type { Trade } from '../../domain/trade.js';
import { isIncotermAvailable } from '../../domain/enums.js';
import { EngineError } from '../errors.js';

/** 无法判定时的固定提示文案（设计文档 6.5） */
export const CONDITIONAL_MESSAGE = '该费用无法仅依据 Incoterms 自动确定，请根据实际合同及费用产生原因确认。';

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ConditionContext {
  facts?: ScenarioFacts;
  carriage_mode: CarriageMode;
}

/**
 * 条件求值。事实缺失时条件不成立——不能因为用户没填就默认某个分支，
 * 必须落到更低优先级的规则上。
 */
export function conditionHolds(condition: Condition, ctx: ConditionContext): boolean {
  switch (condition.kind) {
    case 'DELIVERY_PLACE':
      return ctx.facts?.delivery_place === condition.is;
    case 'SHIPPING_TERMS':
      return ctx.facts?.shipping_terms === condition.is;
    case 'CLEARANCE_AGENT':
      return ctx.facts?.clearance_agent === condition.is;
    case 'LOADING_MODE':
      return ctx.facts?.loading_mode === condition.is;
    case 'CARRIAGE_MODE':
      return ctx.carriage_mode === condition.is;
  }
}

/**
 * 规则具体度：条件越多越具体；带费用类别的比只认节点的具体；认节点的比通配的具体。
 * 同分时保留声明顺序在前的一条。
 */
export function specificity(rule: CostResponsibilityRule): number {
  return (
    rule.conditions.length * 100 +
    (rule.cost_category !== undefined ? 10 : 0) +
    (rule.trade_node !== undefined ? 1 : 0)
  );
}

function ruleMatches(rule: CostResponsibilityRule, item: CostItem, ctx: ConditionContext): boolean {
  if (rule.trade_node !== undefined && rule.trade_node !== item.trade_node) return false;
  if (rule.cost_category !== undefined && rule.cost_category !== item.cost_category) return false;
  return rule.conditions.every((condition) => conditionHolds(condition, ctx));
}

function pickBest<T extends CostResponsibilityRule>(
  rules: readonly T[],
  item: CostItem,
  ctx: ConditionContext,
): T | null {
  let best: T | null = null;
  let bestScore = -1;
  for (const rule of rules) {
    if (!ruleMatches(rule, item, ctx)) continue;
    const score = specificity(rule);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  return best;
}

function clauseMatches(clause: ContractClause, item: CostItem): boolean {
  if (clause.cost_id !== undefined && clause.cost_id !== item.cost_id) return false;
  if (clause.cost_category !== undefined && clause.cost_category !== item.cost_category) return false;
  if (clause.trade_node !== undefined && clause.trade_node !== item.trade_node) return false;
  if (clause.cost_name_contains !== undefined && !item.cost_name.includes(clause.cost_name_contains)) return false;
  return true;
}

function clauseHasSelector(clause: ContractClause): boolean {
  return (
    clause.cost_id !== undefined ||
    clause.cost_category !== undefined ||
    clause.trade_node !== undefined ||
    clause.cost_name_contains !== undefined
  );
}

export interface ResponsibilityDecision {
  cost_id: string;
  cost_name: string;
  responsibility: Responsibility;
  source: ResponsibilitySource;
  /** 命中的规则或条款 id，用于人工复核 */
  rule_id: string | null;
  note: string;
  confidence: Confidence;
  payment_party: Party | null;
  economic_bearer: Party | null;
  /** 责任未经自动确定，需要用户确认 */
  needs_confirmation: boolean;
}

export interface ResolveParams {
  trade: Trade;
  scenario: Scenario;
  ruleSet: IncotermsRuleSet;
}

function nodeFallbackResponsibility(
  ruleSet: IncotermsRuleSet,
  incoterm: string,
  item: CostItem,
): Responsibility | null {
  const fallback = ruleSet.node_fallbacks?.find((entry) => entry.incoterm === incoterm);
  if (fallback === undefined) return null;
  return fallback.seller_nodes.includes(item.trade_node) ? 'SELLER' : 'BUYER';
}

/**
 * 责任判定（设计文档 6.2），逐级降级且不跨级猜测：
 * 1 用户显式指定 → 2 合同条款 → 3 Incoterms 规则（含条件维度）
 * → 4 特殊事实兜底 → 5 贸易节点弱推断 → 6 CONDITIONAL
 */
export function resolveItemResponsibility(item: CostItem, params: ResolveParams): ResponsibilityDecision {
  const { scenario, ruleSet, trade } = params;
  const ctx: ConditionContext = { facts: scenario.facts, carriage_mode: trade.carriage_mode };

  const invalidClause = ruleSet.contract_clauses?.find((clause) => !clauseHasSelector(clause));
  if (invalidClause !== undefined) {
    throw new EngineError(
      'CONTRACT_CLAUSE_TOO_BROAD',
      `合同条款 ${invalidClause.id} 未指定任何匹配条件，会命中全部费用项，请补充匹配条件`,
      { clause_id: invalidClause.id },
    );
  }

  const override = scenario.responsibility_overrides?.[item.cost_id];
  if (override !== undefined) {
    return {
      cost_id: item.cost_id,
      cost_name: item.cost_name,
      responsibility: override.responsibility,
      source: 'USER_OVERRIDE',
      rule_id: null,
      note: override.reason ?? '用户显式指定',
      confidence: 'HIGH',
      payment_party: override.payment_party ?? null,
      economic_bearer: override.economic_bearer ?? null,
      needs_confirmation: false,
    };
  }

  const clause = ruleSet.contract_clauses?.find((candidate) => clauseMatches(candidate, item));
  if (clause !== undefined) {
    return {
      cost_id: item.cost_id,
      cost_name: item.cost_name,
      responsibility: clause.responsibility,
      source: 'CONTRACT',
      rule_id: clause.id,
      note: clause.note,
      confidence: 'HIGH',
      payment_party: null,
      economic_bearer: null,
      needs_confirmation: false,
    };
  }

  // 发生原因（过错责任）优先于术语的费用划分：因谁的原因产生的费用由谁承担
  if (item.occurrence_reason !== undefined && item.occurrence_reason !== 'NORMAL_OPERATION') {
    const matches = (ruleSet.reason_rules ?? []).filter(
      (rule) =>
        rule.reason === item.occurrence_reason &&
        (rule.trade_node === undefined || rule.trade_node === item.trade_node),
    );
    const reasonRule = matches.find((rule) => rule.trade_node !== undefined) ?? matches[0];
    if (reasonRule !== undefined) {
      return {
        cost_id: item.cost_id,
        cost_name: item.cost_name,
        responsibility: reasonRule.responsibility,
        source: 'OCCURRENCE_REASON',
        rule_id: reasonRule.id,
        note: reasonRule.note,
        confidence: 'HIGH',
        payment_party: null,
        economic_bearer: null,
        needs_confirmation: false,
      };
    }
  }

  const candidates: IncotermRule[] = ruleSet.rules.filter((rule) => rule.incoterm === scenario.incoterm);
  const matched = pickBest(candidates, item, ctx);
  if (matched !== null) {
    return {
      cost_id: item.cost_id,
      cost_name: item.cost_name,
      responsibility: matched.responsibility,
      source: 'INCOTERM_RULE',
      rule_id: matched.id,
      note: matched.note,
      confidence: 'HIGH',
      payment_party: null,
      economic_bearer: null,
      needs_confirmation: matched.responsibility === 'CONDITIONAL',
    };
  }

  const specialFact = pickBest(ruleSet.special_facts ?? [], item, ctx);
  if (specialFact !== null) {
    return {
      cost_id: item.cost_id,
      cost_name: item.cost_name,
      responsibility: specialFact.responsibility,
      source: 'SPECIAL_CONDITION',
      rule_id: specialFact.id,
      note: specialFact.note,
      confidence: 'MEDIUM',
      payment_party: null,
      economic_bearer: null,
      needs_confirmation: specialFact.responsibility === 'CONDITIONAL',
    };
  }

  const fallbackResponsibility = nodeFallbackResponsibility(ruleSet, scenario.incoterm, item);
  if (fallbackResponsibility !== null) {
    return {
      cost_id: item.cost_id,
      cost_name: item.cost_name,
      responsibility: fallbackResponsibility,
      source: 'TRADE_NODE',
      rule_id: null,
      note: `依据贸易节点推断：${scenario.incoterm} 下该节点默认由${fallbackResponsibility === 'SELLER' ? '卖方' : '买方'}承担，请核对合同`,
      confidence: 'LOW',
      payment_party: null,
      economic_bearer: null,
      needs_confirmation: true,
    };
  }

  return {
    cost_id: item.cost_id,
    cost_name: item.cost_name,
    responsibility: 'CONDITIONAL',
    source: 'UNRESOLVED',
    rule_id: null,
    note: CONDITIONAL_MESSAGE,
    confidence: 'LOW',
    payment_party: null,
    economic_bearer: null,
    needs_confirmation: true,
  };
}

export function resolveResponsibility(params: ResolveParams): ResponsibilityDecision[] {
  const { trade, scenario, ruleSet } = params;

  if (!isIncotermAvailable(trade.carriage_mode, scenario.incoterm)) {
    throw new EngineError(
      'INCOTERM_MODE_INCOMPATIBLE',
      `${scenario.incoterm} 仅适用海运及内河运输，当前运输方式为 ${trade.carriage_mode}`,
      { incoterm: scenario.incoterm, carriage_mode: trade.carriage_mode },
    );
  }

  return trade.items.map((item) => resolveItemResponsibility(item, params));
}
