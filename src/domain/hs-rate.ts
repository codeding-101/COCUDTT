import type { Numeric } from './decimal.js';

/**
 * 税率口径。同一个 HS 编码在不同口径下税率不同，选哪一个取决于原产国与贸易协定，
 * 因此必须由用户显式指定，引擎不替用户选。
 */
export const DUTY_RATE_BASES = ['MFN', 'AGREEMENT', 'INTERIM', 'GENERAL'] as const;
export type DutyRateBasis = (typeof DUTY_RATE_BASES)[number];

export const DUTY_RATE_BASIS_LABELS: Record<DutyRateBasis, string> = {
  MFN: '最惠国税率',
  AGREEMENT: '协定税率（自贸协定）',
  INTERIM: '暂定税率',
  GENERAL: '普通税率',
};

/** 关税计征方式 */
export const DUTY_TYPES = ['AD_VALOREM', 'SPECIFIC', 'COMPOUND'] as const;
export type DutyType = (typeof DUTY_TYPES)[number];

export const DUTY_TYPE_LABELS: Record<DutyType, string> = {
  AD_VALOREM: '从价（完税价格 × 税率）',
  SPECIFIC: '从量（数量 × 单位税额）',
  COMPOUND: '复合（从价 + 从量）',
};

/** 一条 HS 编码的税率记录 */
export interface HsRateEntry {
  /** HS 编码，纯数字，通常 6～10 位；可以是 2/4/6 位的上级编码，供下级回退使用 */
  code: string;
  description: string;
  /** 关税计征方式，默认从价 */
  duty_type?: DutyType;
  /** 从价税率，按口径分别维护 */
  duty_rates?: Partial<Record<DutyRateBasis, Numeric>>;
  /** 从量税的单位税额 */
  specific_amount?: Numeric;
  /** 从量税的计量单位（如 千克），需与商品单位一致才能按量计征 */
  specific_unit?: string;
  /** 增值税率 */
  vat_rate?: Numeric;
  /** 消费税率 */
  consumption_tax_rate?: Numeric;
  notes?: string;
}

export interface HsRateTable {
  /** 本次核算适用哪个口径的关税税率 */
  basis: DutyRateBasis;
  entries: HsRateEntry[];
}

export type HsMatchLevel = 'EXACT' | 'PARENT';

export interface HsMatch {
  entry: HsRateEntry;
  /** 实际命中的编码，可能是输入编码的上级 */
  matched_code: string;
  level: HsMatchLevel;
}

/** HS 编码的层级：章 2 位、品目 4 位、子目 6 位、国别细分 8/10 位 */
const HS_LEVELS = [10, 8, 6, 4, 2] as const;

function normalizeCode(code: string): string {
  return code.replace(/\D/g, '');
}

/**
 * 按 HS 编码查税率：先精确匹配，再逐级向上回退（10 → 8 → 6 → 4 → 2）。
 *
 * 逐级回退是税则的实际用法：给某个 10 位编码单独维护税率很麻烦，
 * 通常只在 6 位或 8 位上维护，下级编码继承。
 */
export function findHsEntry(table: HsRateTable | undefined, code: string | undefined): HsMatch | undefined {
  if (table === undefined || code === undefined) return undefined;
  const normalized = normalizeCode(code);
  if (normalized === '') return undefined;

  const byCode = new Map(table.entries.map((entry) => [normalizeCode(entry.code), entry]));
  const exact = byCode.get(normalized);
  if (exact !== undefined) {
    return { entry: exact, matched_code: normalized, level: 'EXACT' };
  }

  for (const level of HS_LEVELS) {
    if (level >= normalized.length) continue;
    const parent = byCode.get(normalized.slice(0, level));
    if (parent !== undefined) {
      return { entry: parent, matched_code: normalized.slice(0, level), level: 'PARENT' };
    }
  }
  return undefined;
}

/** 该编码在各口径下的从价税率，缺失的口径不返回 */
export function dutyRateOf(entry: HsRateEntry, basis: DutyRateBasis): Numeric | undefined {
  return entry.duty_rates?.[basis];
}
