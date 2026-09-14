import type Decimal from 'decimal.js';
import { add, cmp, d, div, isZero, mul, q, sub, sum, type Numeric } from '../../domain/decimal.js';
import type { TaxProfile } from '../../domain/tax-profile.js';
import { lookupRate } from '../../domain/rate-table.js';
import {
  dutyRateOf,
  findHsEntry,
  type DutyType,
  type HsMatchLevel,
} from '../../domain/hs-rate.js';
import type { Warning } from '../../domain/warning.js';
import { EngineError } from '../errors.js';

export interface ImportTaxInput {
  profile: TaxProfile;
  /** 完税价格（核算币种） */
  dutiableValue: Decimal;
  /** 商品大类或 HS 编码 */
  taxKey?: string;
  /** 进口数量，从量税或复合税时需要 */
  quantity?: Numeric;
  /** 商品单位，用于与从量税的计量单位核对 */
  unit?: string;
}

export interface ImportTaxResult {
  dutiable_value: Decimal;
  /** 关税合计（从价部分 + 从量部分） */
  duty: Decimal;
  /** 其中的从量部分 */
  specific_duty: Decimal;
  /** 从价税率（从量税时为 0） */
  duty_rate: Decimal;
  duty_type: DutyType;
  consumption_tax: Decimal;
  vat: Decimal;
  vat_rate: Decimal;
  /** 命中的 HS 编码（可能是输入编码的上级） */
  hs_code_matched: string | null;
  hs_match_level: HsMatchLevel | null;
  exemption_applied: boolean;
  warnings: Warning[];
}

/**
 * 进口环节税费（设计文档 9.2、9.6）：
 *
 *   关税   = 完税价格 × 关税税率                     （从价）
 *         或 数量 × 单位税额                        （从量）
 *         或 两者之和                               （复合）
 *   消费税 = (完税价格 + 关税) ÷ (1 − 消费税率) × 消费税率     [仅应税消费品]
 *   增值税 = (完税价格 + 关税 + 消费税) × 增值税率
 *
 * 注意基数是递进的，不是把费用项简单相加——这是本系统最容易写错的一处。
 *
 * 税率来源：先查 HS 税率表（可逐级回退到上级编码），未命中再回退到商品大类的兜底税率，
 * 两种情况都会给出提示，不做静默回退。
 */
export function computeImportTaxes(input: ImportTaxInput): ImportTaxResult {
  const warnings: Warning[] = [];
  const dutiable = input.dutiableValue;
  const importRules = input.profile.import;
  const hsTable = importRules.hsTable;
  const match = findHsEntry(hsTable, input.taxKey);

  // 同一编码出现多条时只会有最后一条生效，这属于数据错误，必须说出来
  if (hsTable !== undefined) {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const entry of hsTable.entries) {
      const code = entry.code.replace(/\D/g, '');
      if (seen.has(code)) duplicates.add(code);
      seen.add(code);
    }
    if (duplicates.size > 0) {
      warnings.push({
        code: 'HS_CODE_DUPLICATE',
        level: 'WARN',
        message: `HS 税率表中有重复编码（${[...duplicates].join('、')}），实际只按最后一条计算，请合并`,
      });
    }
  }

  let dutyType: DutyType = 'AD_VALOREM';
  let adValoremRate = q(lookupRate(importRules.dutyRates, input.taxKey));
  let specificAmount: Numeric | undefined;
  let specificUnit: string | undefined;
  let vatRate = q(importRules.vatRate);
  let consumptionRate: Numeric | undefined = importRules.consumptionTax?.rate;

  if (match !== undefined) {
    const entry = match.entry;
    dutyType = entry.duty_type ?? 'AD_VALOREM';
    specificAmount = entry.specific_amount;
    specificUnit = entry.specific_unit;

    const basis = hsTable?.basis ?? 'MFN';
    /*
     * 从量税本就没有从价税率，既不查也不告警——否则会拿着商品大类的兜底税率
     * 显示出一个不存在的"关税税率"，反而误导。
     */
    if (dutyType === 'SPECIFIC') {
      adValoremRate = d(0);
    } else {
      const exactRate = dutyRateOf(entry, basis);
      const mfnRate = dutyRateOf(entry, 'MFN');
      const chosen = exactRate ?? mfnRate;
      if (chosen === undefined) {
        warnings.push({
          code: 'HS_RATE_BASIS_FALLBACK',
          level: 'WARN',
          message: `HS 编码 ${match.matched_code} 未维护关税税率，已回退为商品大类的兜底税率计算`,
        });
      } else {
        adValoremRate = q(chosen);
        if (exactRate === undefined) {
          warnings.push({
            code: 'HS_RATE_BASIS_FALLBACK',
            level: 'INFO',
            message: `HS 编码 ${match.matched_code} 未提供所选口径的税率，已按最惠国税率 ${q(chosen).toString()} 计算`,
          });
        }
      }
    }

    if (entry.vat_rate !== undefined) vatRate = q(entry.vat_rate);
    if (entry.consumption_tax_rate !== undefined) consumptionRate = entry.consumption_tax_rate;

    if (match.level === 'PARENT') {
      warnings.push({
        code: 'HS_CODE_PARENT_MATCH',
        level: 'INFO',
        message: `HS 编码 ${input.taxKey ?? ''} 未单独维护税率，已按上级编码 ${match.matched_code}（${entry.description}）的税率计算`,
      });
    }
  } else if (input.taxKey !== undefined && hsTable !== undefined && hsTable.entries.length > 0) {
    warnings.push({
      code: 'HS_CODE_NOT_FOUND',
      level: 'WARN',
      message: `HS 编码 ${input.taxKey} 不在税率表中，已回退为商品大类的兜底税率计算，请核对归类`,
    });
  }

  const adValoremDuty = dutyType === 'SPECIFIC' ? d(0) : mul(dutiable, adValoremRate);

  let specificDuty = d(0);
  if (dutyType === 'SPECIFIC' || dutyType === 'COMPOUND') {
    const blank = (value: Numeric | undefined): boolean =>
      value === undefined || value === null || String(value).trim() === '';

    if (blank(specificAmount)) {
      throw new EngineError(
        'HS_SPECIFIC_AMOUNT_MISSING',
        `HS 编码 ${match?.matched_code ?? input.taxKey ?? ''} 为${dutyType === 'SPECIFIC' ? '从量' : '复合'}税，但税率表中未填写单位税额`,
        { hs_code: match?.matched_code ?? input.taxKey ?? '' },
      );
    }
    if (blank(input.quantity)) {
      throw new EngineError(
        'HS_SPECIFIC_QUANTITY_MISSING',
        `HS 编码 ${match?.matched_code ?? input.taxKey ?? ''} 为从量税，需要按数量计征，但商品数量未填写`,
        { hs_code: match?.matched_code ?? input.taxKey ?? '' },
      );
    }
    if (specificUnit !== undefined && input.unit !== undefined && specificUnit !== input.unit) {
      throw new EngineError(
        'HS_SPECIFIC_UNIT_MISMATCH',
        `HS 编码 ${match?.matched_code ?? input.taxKey ?? ''} 的从量税以「${specificUnit}」计征，商品单位是「${input.unit}」，无法直接换算，请改写商品单位或改用从价税`,
        { hs_code: match?.matched_code ?? input.taxKey ?? '', tariff_unit: specificUnit, goods_unit: input.unit },
      );
    }
    specificDuty = mul(input.quantity as Numeric, specificAmount as Numeric);
  }

  let duty = add(adValoremDuty, specificDuty);
  let exemptionApplied = false;

  const threshold = importRules.dutyExemptionThreshold;
  if (threshold !== undefined && cmp(duty, threshold) < 0 && !isZero(duty)) {
    warnings.push({
      code: 'DUTY_EXEMPTED',
      level: 'INFO',
      message: '关税税额低于免征额度，本票免征关税',
    });
    duty = d(0);
    exemptionApplied = true;
  }

  let consumptionTax = d(0);
  if (consumptionRate !== undefined && consumptionRate !== null) {
    const rate = q(consumptionRate);
    const divisor = sub(1, rate);
    if (isZero(divisor)) {
      warnings.push({
        code: 'DUTY_BASE_INCOMPLETE',
        level: 'ERROR',
        message: '消费税率为 100%，无法计算组成计税价格',
      });
    } else if (!isZero(rate)) {
      consumptionTax = mul(div(add(dutiable, duty), divisor), rate);
    }
  }

  const vat = mul(add(dutiable, add(duty, consumptionTax)), vatRate);

  return {
    dutiable_value: dutiable,
    duty,
    specific_duty: specificDuty,
    duty_rate: adValoremRate,
    duty_type: dutyType,
    consumption_tax: consumptionTax,
    vat,
    vat_rate: vatRate,
    hs_code_matched: match?.matched_code ?? null,
    hs_match_level: match?.level ?? null,
    exemption_applied: exemptionApplied,
    warnings,
  };
}

/** 增值税可抵扣部分的金额，用于不含可抵扣税的落地成本口径 */
export function deductibleVat(vat: Decimal, profile: TaxProfile): Decimal {
  return profile.import.vatDeductibleForBuyer ? vat : d(0);
}

/** 供上层做勾稽校验：各项税费之和 */
export function totalTaxes(result: ImportTaxResult): Decimal {
  return sum([result.duty, result.consumption_tax, result.vat]);
}
