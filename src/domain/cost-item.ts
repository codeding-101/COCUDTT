import type {
  CostCategory,
  CurrencyCode,
  DateStr,
  DayBasis,
  FxType,
  OccurrenceReason,
  Party,
  PricingMethod,
  Responsibility,
  ResponsibilitySource,
  RiskRelation,
  TierBasis,
  TierMode,
  TradeNode,
} from './enums.js';
import type { Numeric } from './decimal.js';

/**
 * 计费基数引用（设计文档 4.3）。
 * 引用其他费用项或完税价格会在引擎中产生依赖边，必须按拓扑序计算并检测环。
 */
export type BaseRef =
  | { kind: 'GOODS_VALUE' }
  | { kind: 'QUOTE_AMOUNT' }
  | { kind: 'COST_ITEMS'; ids: string[] }
  | { kind: 'CUSTOMS_DUTIABLE_VALUE' };

/** 阶梯收费档位（设计文档 4.4） */
export interface Tier {
  /** 区间上界（含）；null 表示无上界。上界需严格递增，且只能有一个档位无上界 */
  up_to: Numeric | null;
  rate: Numeric;
}

export interface CostTiming {
  /** 单一时点费用 */
  date?: DateStr;
  /** 期间费用（按天计费） */
  start?: DateStr;
  end?: DateStr;
  phase?: 'PRE_SHIPMENT' | 'IN_TRANSIT' | 'POST_ARRIVAL';
}

/**
 * 一笔费用（设计文档 4.1）。
 *
 * 自定义费用不得因为系统不认识其名称而无法计算：cost_name 仅用于展示，
 * 计算完全由 pricing_method 及其参数决定。
 */
export interface CostItem {
  // ---- 标识 ----
  cost_id: string;
  cost_name: string;
  cost_category: CostCategory;
  trade_node: TradeNode;
  location?: string;
  timing?: CostTiming;
  /**
   * 发生原因。滞箱费、滞期费、仓储费、查验费这类费用，
   * 同一节点、同一名称，因谁的原因产生，归属完全不同。
   * 未填写视为正常作业。
   */
  occurrence_reason?: OccurrenceReason;

  // ---- 计价 ----
  pricing_method: PricingMethod;
  amount?: Numeric;
  unit?: string;
  quantity?: Numeric;
  /** QTY_X_UNIT 的单价；PERCENT 的比率（0.008 = 0.8%）；PER_DAY 的日费率 */
  rate?: Numeric;
  days?: Numeric;
  day_basis?: DayBasis;
  calculation_base?: BaseRef;
  tiers?: Tier[];
  /** 阶梯计费方式，默认累进 */
  tier_mode?: TierMode;
  /** 阶梯的计费量取自数量还是天数，默认数量 */
  tier_basis?: TierBasis;
  /**
   * 分档计费时，是否与"高档位的最小计费量 × 该档费率"比较取低。
   * 这是空运重量等级运价的规则：实际重量按所在档费率算，与更高分界点重量按该档费率算，取低者。
   */
  tier_charge_lower?: boolean;

  // ---- 币种与汇率 ----
  currency: CurrencyCode;
  fx_rate?: Numeric;
  fx_type: FxType;
  fx_date?: DateStr;
  base_currency: CurrencyCode;
  /** [引擎输出] 换算后金额 */
  base_amount?: Numeric;

  // ---- 税务 ----
  tax_included: boolean;
  tax_rate_ref?: string;

  // ---- 归属 ----
  responsibility: Responsibility;
  responsibility_source: ResponsibilitySource;
  payment_party?: Party;
  economic_bearer?: Party;

  // ---- 报价与去重 ----
  /** 已含于成交报价（设计文档 8.3 A） */
  included_in_quoted_price: boolean;
  /** 已含于另一笔费用的报价内（设计文档 4.2、8.3 B） */
  contained_in_cost_id?: string;
  dedup_group?: string;
  /**
   * 该项代表货物本身的价值，用于报价构成与海关完税价格。
   * 不计入卖方成本汇总——卖方成本由 Goods.seller_goods_cost 代表，
   * 否则货值会与采购成本重复计算。
   */
  is_goods_value?: boolean;
  /**
   * 该笔主运输报价声明已含港口操作费（THC）。
   * 若同时存在独立的港杂费费用项且未标记 contained_in_cost_id，引擎给出重复计费告警。
   */
  includes_port_charges?: boolean;

  // ---- 风险 ----
  risk_relation?: RiskRelation;

  // ---- 元数据 ----
  /** 用户自定义费用 */
  is_custom: boolean;
  source: 'USER' | 'DERIVED';
  notes?: string;
}
