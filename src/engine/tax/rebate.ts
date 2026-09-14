import type Decimal from 'decimal.js';
import { add, cmp, d, div, isNegative, isZero, mul, q, sub } from '../../domain/decimal.js';
import { compareDate } from '../../domain/date.js';
import type { DateStr, RebateEntityType } from '../../domain/enums.js';
import type { RebateProfile } from '../../domain/rebate.js';
import { lookupRate } from '../../domain/rate-table.js';
import type { Warning } from '../../domain/warning.js';

export interface RebateInput {
  profile: RebateProfile;
  /** 卖方采购含税成本 / 生产成本（核算币种） */
  seller_goods_cost_base: Decimal;
  /** 报价金额（核算币种） */
  quote_amount_base: Decimal;
  /** 报价已含、且发生在装船之后的费用项金额合计（核算币种） */
  post_shipment_included_base: Decimal;
  /** 报价未含、且发生在装船之前（含装船）的费用项金额合计（核算币种） */
  pre_shipment_excluded_base: Decimal;
  taxKey?: string;
  export_date?: DateStr;
  /** 当前日期，用于申报期限提示 */
  today?: DateStr;
}

export interface RebateResult {
  entity_type: RebateEntityType;
  /** 由成交价还原的离岸价 */
  fob_value: Decimal;
  /** 退税计税依据 */
  basis: Decimal;
  basis_rule: string;
  rebate_rate: Decimal;
  vat_rate: Decimal;
  vat_rebate: Decimal;
  consumption_tax_rebate: Decimal;
  rebate_total: Decimal;
  /** 未受留抵税额限制的理论退税额 */
  theoretical_rebate: Decimal;
  /** 不得免征和抵扣税额，须转入成本 */
  non_refundable_vat: Decimal;
  is_capped_by_credit: boolean;
  /** 退税到账周期造成的资金占用成本 */
  lag_cost: Decimal;
  warnings: Warning[];
}

/** 出口退税申报期限：次年 4 月增值税纳税申报期截止，此处按 4 月 30 日近似 */
function declarationDeadline(exportDate: DateStr): DateStr {
  const year = Number(exportDate.slice(0, 4)) + 1;
  return `${year}-04-30`;
}

/**
 * 离岸价还原（设计文档 9.5.2）：
 *
 *   FOB 价 = 报价金额
 *          + 报价未含、且发生在装船之前（含装船）的费用   ← 属于 FOB 价的组成部分
 *          − 报价已含、且发生在装船之后的费用             ← 报价里包含的到岸费用，不属于 FOB 价
 *
 * 例：报价 108,300 以 CIF 成交，其中已含运费 8,000 与保险费 300，
 *     则 FOB 价 = 108,300 − 8,300 = 100,000。
 */
export function restoreFobValue(input: RebateInput): { fob: Decimal; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const raw = add(
    sub(input.quote_amount_base, input.post_shipment_included_base),
    input.pre_shipment_excluded_base,
  );
  if (isNegative(raw)) {
    warnings.push({
      code: 'REBATE_FOB_NEGATIVE',
      level: 'WARN',
      message: `还原后的离岸价为负（${raw.toString()}），已按 0 处理；请检查报价金额与运费保险费的录入口径`,
    });
    return { fob: d(0), warnings };
  }
  return { fob: raw, warnings };
}

/**
 * 出口退税（设计文档 9.5）。两种主体的计算路径完全不同：
 *
 * - TRADING（外贸企业，免退税）：依据为增值税专用发票不含税金额，与出口售价及术语无关
 * - MANUFACTURER（生产企业，免抵退税）：依据为离岸价 FOB，随术语变化
 */
export function computeRebate(input: RebateInput): RebateResult {
  const warnings: Warning[] = [];
  const profile = input.profile;

  const vatRate = q(lookupRate(profile.vatRates, input.taxKey));
  const rebateRate = q(lookupRate(profile.rebateRates, input.taxKey));

  const { fob, warnings: fobWarnings } = restoreFobValue(input);
  warnings.push(...fobWarnings);

  const isTrading = profile.entityType === 'TRADING';

  // 计税依据
  let basis: Decimal;
  let basisRule: string;
  if (isTrading) {
    basis = div(input.seller_goods_cost_base, add(1, vatRate));
    basisRule = '外贸企业（免退税）：增值税专用发票不含税金额 = 采购含税成本 ÷ (1 + 征税率)';
  } else {
    basis = fob;
    basisRule = '生产企业（免抵退税）：出口货物离岸价 FOB';
  }

  const vatRebateTheoretical = mul(basis, rebateRate);

  let vatRebate = vatRebateTheoretical;
  let isCapped = false;
  const credit = profile.endingCreditBalance;
  if (!isTrading && credit !== undefined && cmp(credit, vatRebateTheoretical) < 0) {
    vatRebate = d(credit);
    isCapped = true;
    warnings.push({
      code: 'REBATE_CAPPED_BY_CREDIT',
      level: 'WARN',
      message: '生产企业实际退税额受期末留抵税额限制，低于按离岸价计算的理论退税额',
    });
  }

  const rateGap = sub(vatRate, rebateRate);
  const nonRefundable = rateGap.isNegative() ? d(0) : mul(basis, rateGap);

  const consumptionRebateRate = profile.consumption_tax_rebate_rate;
  const consumptionTaxRebate =
    consumptionRebateRate === undefined ? d(0) : mul(basis, consumptionRebateRate);

  const rebateTotal = add(vatRebate, consumptionTaxRebate);

  if (isZero(rebateRate)) {
    warnings.push({
      code: 'REBATE_RATE_ZERO',
      level: 'INFO',
      message: '该商品退税率为 0，不计出口退税',
    });
  }

  let lagCost = d(0);
  const lagDays = profile.rebateLagDays;
  const fundingRate = profile.sellerFundingRate;
  if (lagDays !== undefined && fundingRate !== undefined && lagDays > 0) {
    lagCost = div(mul(mul(rebateTotal, fundingRate), String(lagDays)), '365');
    warnings.push({
      code: 'REBATE_LAG_COST',
      level: 'INFO',
      message: `按 ${lagDays} 天退税到账周期计提资金占用成本`,
    });
  }

  if (input.export_date !== undefined && input.today !== undefined) {
    const deadline = declarationDeadline(input.export_date);
    if (compareDate(input.today, deadline) > 0) {
      warnings.push({
        code: 'REBATE_DEADLINE',
        level: 'WARN',
        message: `出口退税申报期限（${deadline}）已过，逾期未申报可能视同内销征税`,
      });
    }
  }

  return {
    entity_type: profile.entityType,
    fob_value: fob,
    basis,
    basis_rule: basisRule,
    rebate_rate: rebateRate,
    vat_rate: vatRate,
    vat_rebate: vatRebate,
    consumption_tax_rebate: consumptionTaxRebate,
    rebate_total: rebateTotal,
    theoretical_rebate: add(vatRebateTheoretical, consumptionTaxRebate),
    non_refundable_vat: nonRefundable,
    is_capped_by_credit: isCapped,
    lag_cost: lagCost,
    warnings,
  };
}
