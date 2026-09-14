import type { Numeric } from './decimal.js';
import type { CurrencyCode, TradeNode } from './enums.js';

/**
 * 业务告警编码。
 * 这里只放**不阻断计算**的问题：算得出结果，但结果可能不符合用户预期，
 * 需要提示用户核对。会阻断计算的情况（缺汇率、缺计费参数、引用成环等）
 * 一律抛 `EngineError`，界面显示为"无法计算"，不进这个联合类型——
 * 两套机制混在一起会让人误以为某个校验是告警而不是错误。
 *
 * 每条编码都必须真的有地方发出；`tools/audit.mjs` 会检查这一点，
 * 避免留下"声明了但从未产生"的编码，让人误以为校验存在。
 */
export type WarningCode =
  // 汇率
  | 'CUSTOMS_FX_FALLBACK'
  // 规则与责任
  | 'RESP_CONDITIONAL'
  | 'RESP_NODE_INFERRED'
  | 'RESP_SHARED_NOT_SPLIT'
  // 报价与去重
  | 'QUOTE_INCLUSION_CONFLICT'
  | 'QUOTE_INCLUSION_UNSPECIFIED'
  | 'POSSIBLE_DUPLICATE'
  | 'PORT_CHARGE_DOUBLE_COUNT'
  | 'CONTAINED_PARENT_MISSING'
  | 'GOODS_VALUE_EXCLUDED'
  | 'QUOTE_NOT_RECONCILED'
  // 税务
  | 'DUTY_BASE_INCOMPLETE'
  | 'CUSTOMS_FX_EXPIRED'
  | 'INSURANCE_FALLBACK_APPLIED'
  | 'DUTY_EXEMPTED'
  | 'DDP_PRACTICAL_WARNING'
  // HS 税率表
  | 'HS_CODE_NOT_FOUND'
  | 'HS_CODE_PARENT_MATCH'
  | 'HS_CODE_DUPLICATE'
  | 'HS_RATE_BASIS_FALLBACK'
  // 出口退税
  | 'REBATE_RATE_ZERO'
  | 'REBATE_FOB_NEGATIVE'
  | 'REBATE_CAPPED_BY_CREDIT'
  | 'REBATE_DEADLINE'
  | 'REBATE_DRIVES_MARGIN'
  | 'REBATE_LAG_COST'
  // 结构与其他
  | 'INSURANCE_REQUIRED_MISSING'
  | 'CARRIER_FAULT_CLAIMABLE'
  | 'COMPARISON_ANCHOR';

export type WarningLevel = 'ERROR' | 'WARN' | 'INFO';

export interface Warning {
  code: WarningCode;
  level: WarningLevel;
  message: string;
  cost_id?: string;
  node?: TradeNode;
  currency?: CurrencyCode;
  amount?: Numeric;
}
