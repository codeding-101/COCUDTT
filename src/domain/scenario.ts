import type { CurrencyCode, DateStr, FxType, Incoterm, Party, Responsibility } from './enums.js';
import type { Numeric } from './decimal.js';
import type { ScenarioFacts } from './rule.js';

/** 成交报价（设计文档 8.1） */
export interface Quote {
  amount: Numeric;
  currency: CurrencyCode;
  /** 报价所依据的术语 */
  incoterm: Incoterm;
  /** 报价中已含的费用项 */
  included_cost_ids: string[];
  fx_rate?: Numeric;
  fx_type?: FxType;
  fx_date?: DateStr;
}

/** 用户对责任判定的显式指定（设计文档 6.2 第 1 级） */
export interface ResponsibilityOverride {
  responsibility: Responsibility;
  /** 覆盖原因，来自合同或用户判断 */
  reason?: string;
  /** 谁实际付款 */
  payment_party?: Party;
  /** 谁经济承担 */
  economic_bearer?: Party;
}

/** 比较基准，决定"利润"怎么算（设计文档 11.3） */
export type ComparisonAnchor =
  | { kind: 'FIXED_QUOTE' }
  | { kind: 'FIXED_MARKET_PRICE'; buyer_total: Numeric; currency: CurrencyCode }
  | { kind: 'FIXED_MARGIN_RATE'; margin_rate: Numeric };

/** 方案层：贸易术语与商务选择（设计文档第 2 节） */
export interface Scenario {
  id: string;
  name?: string;
  trade_id: string;
  incoterm: Incoterm;
  base_currency: CurrencyCode;
  quote: Quote;
  /** 各汇率类型指定的汇率簿 id */
  fx_book_ids?: Partial<Record<FxType, string>>;
  /** cost_id → 责任覆盖 */
  responsibility_overrides?: Record<string, ResponsibilityOverride>;
  /** cost_id → 显式汇率 */
  fx_rate_overrides?: Record<string, Numeric>;
  /** 参与规则条件匹配的事实（交货地点、运输条款变形等） */
  facts?: ScenarioFacts;
  anchor?: ComparisonAnchor;
}
