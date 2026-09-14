import type { CarriageMode, CostCategory, Incoterm, OccurrenceReason, Responsibility, TradeNode } from './enums.js';

/**
 * 运输条款变形。同一个词在不同节点含义不同：
 * 装货变形（STOWED / TRIMMED / STOWED_TRIMMED）作用于起运港，
 * 卸货变形（LINER / EX_SHIP_HOLD）作用于目的港。
 *
 * 注意：实务上常见的写法是「FOB 班轮条件」「CIF 舱底交货」，
 * 语义必须以节点为准，不能只看字面。
 */
export type ShippingTerms =
  | 'LINER'
  | 'UNDER_TACKLE'
  | 'STOWED'
  | 'TRIMMED'
  | 'STOWED_TRIMMED'
  | 'EX_SHIP_HOLD'
  | 'BULK';

/** 方案层的事实，用于规则条件匹配（设计文档 6.1） */
export interface ScenarioFacts {
  /** FCA 交货地点：卖方场所，或其他指定地点 */
  delivery_place?: 'SELLER_PREMISES' | 'OTHER';
  /** 运输条款变形 */
  shipping_terms?: ShippingTerms;
  /** 卖方代买方办理出口清关（EXW 实务中最常见的偏离） */
  clearance_agent?: 'SELLER_ACTS_FOR_BUYER';
  loading_mode?: 'FCL' | 'LCL';
}

/**
 * 规则条件。事实缺失时条件不成立——不能因为用户没填就默认某个分支，
 * 必须落到更低优先级的规则上。
 */
export type Condition =
  | { kind: 'DELIVERY_PLACE'; is: 'SELLER_PREMISES' | 'OTHER' }
  | { kind: 'SHIPPING_TERMS'; is: ShippingTerms }
  | { kind: 'CLEARANCE_AGENT'; is: 'SELLER_ACTS_FOR_BUYER' }
  | { kind: 'LOADING_MODE'; is: 'FCL' | 'LCL' }
  | { kind: 'CARRIAGE_MODE'; is: CarriageMode };

/**
 * 发生原因规则。**过错责任优先于术语的费用划分**：
 * 即便术语是 FOB，若目的港滞箱费是因卖方单证错误导致的，该费用仍由卖方承担。
 * 只有费用项显式记录了非正常作业的原因时才启用这一层。
 */
export interface ReasonRule {
  id: string;
  reason: OccurrenceReason;
  /** 省略表示适用于任意节点 */
  trade_node?: TradeNode;
  responsibility: Responsibility;
  note: string;
}

/** 费用责任规则（设计文档 6.1） */
export interface CostResponsibilityRule {
  id: string;
  /** 省略表示适用于任意节点 */
  trade_node?: TradeNode;
  /** 省略表示适用于该节点下的任意费用类别 */
  cost_category?: CostCategory;
  /** 空数组表示无条件 */
  conditions: Condition[];
  responsibility: Responsibility;
  /** 依据说明，会展示给用户，用于解释"为什么归这一方" */
  note: string;
}

export interface IncotermRule extends CostResponsibilityRule {
  incoterm: Incoterm;
}

/** 合同条款（设计文档 6.2 第 2 级）。至少给出一个匹配条件。 */
export interface ContractClause {
  id: string;
  cost_id?: string;
  cost_category?: CostCategory;
  trade_node?: TradeNode;
  /** 费用名称包含该关键字即匹配，用于覆盖系统不认识的费用 */
  cost_name_contains?: string;
  responsibility: Responsibility;
  note: string;
}

/** 贸易节点兜底（设计文档 6.2 第 4 级） */
export interface NodeFallback {
  incoterm: Incoterm;
  /** 该术语下默认由卖方承担的节点；其余节点归买方 */
  seller_nodes: TradeNode[];
}

export interface IncotermsRuleSet {
  id: string;
  version: string;
  rules: IncotermRule[];
  /** 发生原因规则（过错责任），见 ReasonRule */
  reason_rules?: ReasonRule[];
  /** 规则表未覆盖的事实兜底（设计文档 6.2 第 3 级） */
  special_facts?: CostResponsibilityRule[];
  contract_clauses?: ContractClause[];
  node_fallbacks?: NodeFallback[];
}
