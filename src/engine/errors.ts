/**
 * 引擎错误码。抛出即**阻断计算**，界面显示"无法计算"并原样给出编码与说明，
 * 不允许降级为"猜一个值"继续算。
 *
 * 不阻断计算的问题（能算出结果但需要用户核对）走 `Warning`，
 * 两套机制不要混用。每条编码都必须真的有地方抛出，`tools/audit.mjs` 会检查。
 */
export type EngineErrorCode =
  // 校验
  | 'FX_MISSING'
  | 'FX_RATE_INVALID'
  | 'INCOTERM_MODE_INCOMPATIBLE'
  | 'GRAPH_CYCLE'
  // 计价
  | 'PRICING_INPUT_MISSING'
  | 'PRICING_BASE_MISSING'
  | 'PRICING_CURRENCY_MISMATCH'
  | 'PRICING_TIER_INVALID'
  | 'PRICING_TIER_NOT_COVERED'
  // HS 税率表
  | 'HS_SPECIFIC_AMOUNT_MISSING'
  | 'HS_SPECIFIC_QUANTITY_MISSING'
  | 'HS_SPECIFIC_UNIT_MISMATCH'
  // 结构
  | 'DUPLICATE_COST_ID'
  | 'COST_ITEM_NOT_FOUND'
  | 'CONTRACT_CLAUSE_TOO_BROAD'
  | 'ANCHOR_MARGIN_INVALID'
  // 输入
  | 'INPUT_VALUE_MISSING'
  // 项目文件
  | 'PROJECT_PARSE_FAILED'
  | 'PROJECT_VERSION_UNSUPPORTED';

export interface EngineErrorDetail {
  [key: string]: unknown;
}

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly detail: EngineErrorDetail;

  constructor(code: EngineErrorCode, message: string, detail: EngineErrorDetail = {}) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.detail = detail;
  }
}

export function isEngineError(value: unknown): value is EngineError {
  return value instanceof EngineError;
}
