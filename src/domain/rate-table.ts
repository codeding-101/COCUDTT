import type { Numeric } from './decimal.js';

/**
 * 税率查表：按商品/HS 大类手工维护，未命中时用 fallback。
 * v1 不建 HS 编码库（设计文档 1.5）。
 */
export interface TaxRateTable {
  /** 兜底税率，未命中 byKey 时使用 */
  fallback: Numeric;
  /** 按商品或 HS 大类维护的税率 */
  byKey?: Record<string, Numeric>;
}

export function lookupRate(table: TaxRateTable, key?: string): Numeric {
  if (key !== undefined && table.byKey !== undefined) {
    const hit = table.byKey[key];
    if (hit !== undefined) return hit;
  }
  return table.fallback;
}
