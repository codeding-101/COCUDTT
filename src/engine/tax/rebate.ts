import type Decimal from 'decimal.js';
import { add, cmp, d, div, isNegative, isZero, mul, q, sub } from '../../domain/decimal.js';
import { compareDate } from '../../domain/date.js';
import type { DateStr, RebateEntityType } from '../../domain/enums.js';
import type { RebateProfile } from '../../domain/rebate.js';
import { lookupRate } from '../../domain/rate-table.js';
import type { Warning } from '../../domain/warning.js';
import type { CalculationStep } from '../calculation.js';

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
  /** 兼容已有调用；仅凭当前日期不判断退税申报或收汇是否逾期。 */
  today?: DateStr;
}

export interface RebateResult {
  calculations?: CalculationStep[];
  /** 中国进口场景不适用中国出口退税，区别于适用但金额为零。 */
  applicable?: boolean;
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

export function noExportRebate(profile: RebateProfile): RebateResult {
  return {
    calculations: [{ id: 'not-applicable', label: '中国出口退税', formula: '中国进口场景不适用', substitution: '境外卖方本国税务未建模', value: null }],
    applicable: false, entity_type: profile.entityType, fob_value: d(0), basis: d(0),
    basis_rule: '中国进口场景不适用中国出口退税；境外卖方本国税务未建模',
    rebate_rate: d(0), vat_rate: d(0), vat_rebate: d(0), consumption_tax_rebate: d(0),
    rebate_total: d(0), theoretical_rebate: d(0), non_refundable_vat: d(0),
    is_capped_by_credit: false, lag_cost: d(0), warnings: [],
  };
}

/**
 * 期限核对提示，不是税务机关的逾期或征税认定。
 * 财政部、税务总局公告2026年第11号九（一）4、十：2026年起新增36个月规则，
 * 2025-12-31及以前出口业务按原政策过渡。申报期、出口类型、凭证和收汇状态均未建模，
 * 因此不再用次年4月30日的近似日期推定逾期或视同内销。
 * https://szs.mof.gov.cn/zhengcefabu/202601/t20260131_3983038.htm
 */
function declarationReview(exportDate?: DateStr): Warning {
  const validDate = exportDate !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(exportDate)
    && !Number.isNaN(Date.parse(exportDate))
    && new Date(exportDate).toISOString().slice(0, 10) === exportDate;
  let rule: string;
  if (!validDate) {
    rule = '缺少有效出口日期，无法区分旧业务过渡与2026年起的规则';
  } else if (exportDate !== undefined && compareDate(exportDate, '2026-01-01') < 0) {
    rule = '录入日期在2025年12月31日及以前；财政部、税务总局公告2026年第11号规定此类出口业务仍按原政策执行，不适用新增36个月期限未申报视同向境内销售的规定';
  } else {
    rule = '2026年起的业务需按财政部、税务总局公告2026年第11号核对；普通报关出口货物涉及次月起至次年4月30日前的各增值税纳税申报期、收汇及36个月期限规则';
  }
  return {
    code: 'REBATE_DEADLINE',
    level: 'WARN',
    message: `出口退（免）税申报与收汇期限需核对：${rule}。本工具未录入出口类型、实际申报、凭证及收汇状态，不判定是否逾期或应按境内销售征税；请向主管税务机关核实，测算金额不等于可取得的退税款`,
  };
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
  const calculations: CalculationStep[] = [];
  const profile = input.profile;

  const vatRate = q(lookupRate(profile.vatRates, input.taxKey));
  const rebateRate = q(lookupRate(profile.rebateRates, input.taxKey));

  const { fob, warnings: fobWarnings } = restoreFobValue(input);
  warnings.push(...fobWarnings);
  calculations.push({ id: 'fob', label: '模型离岸价还原', formula: 'max(0, 报价 − 报价已含装船后费用 + 报价未含装船前费用)',
    substitution: `max(0, ${input.quote_amount_base} − ${input.post_shipment_included_base} + ${input.pre_shipment_excluded_base})`, value: fob,
    note: '按现有粗粒度贸易节点还原；非海运/多式联运及实际申报离岸价须人工复核，不从运输分段自动推导。' });

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
  calculations.push({ id: 'basis', label: '退税计税依据', formula: isTrading ? '采购含税成本 ÷ (1 + 征税率)' : '模型还原离岸价',
    substitution: isTrading ? `${input.seller_goods_cost_base} ÷ (1 + ${vatRate})` : `${fob}`, value: basis, note: basisRule });
  calculations.push({ id: 'theoretical-vat', label: '理论增值税退税', formula: '退税计税依据 × 退税率', substitution: `${basis} × ${rebateRate}`, value: vatRebateTheoretical });
  calculations.push({ id: 'vat-rebate', label: '模型增值税退税', formula: !isTrading && credit !== undefined ? 'min(理论增值税退税, 期末留抵税额)' : '理论增值税退税（本模型未另设上限）',
    substitution: !isTrading && credit !== undefined ? `min(${vatRebateTheoretical}, ${credit})` : `${vatRebateTheoretical}`, value: vatRebate,
    note: '简化测算，未覆盖全部免抵退抵减、凭证和申报条件，不等于可取得的退税款。' });
  calculations.push({ id: 'consumption-rebate', label: '模型消费税退税', formula: '计税依据 × 录入消费税退税率', substitution: consumptionRebateRate === undefined ? '未配置，按0计' : `${basis} × ${consumptionRebateRate}`, value: consumptionTaxRebate });
  calculations.push({ id: 'rebate-total', label: '退税合计', formula: '模型增值税退税 + 模型消费税退税', substitution: `${vatRebate} + ${consumptionTaxRebate}`, value: rebateTotal });
  calculations.push({ id: 'non-refundable', label: '征退税率差测算', formula: '依据 × max(0, 征税率 − 退税率)', substitution: `${basis} × max(0, ${vatRate} − ${rebateRate})`, value: nonRefundable,
    note: '现有采购成本为含税成本；该差额只作提示，不再单独扣一次利润，避免重复计成本。' });

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

  warnings.push(declarationReview(input.export_date));
  calculations.push({ id: 'lag-cost', label: '退税资金占用', formula: lagDays !== undefined && fundingRate !== undefined && lagDays > 0 ? '退税合计 × 年资金率 × 天数 ÷ 365' : '未启用退税资金占用测算',
    substitution: lagDays !== undefined && fundingRate !== undefined && lagDays > 0 ? `${rebateTotal} × ${fundingRate} × ${lagDays} ÷ 365` : '按0计', value: lagCost,
    note: '退税与资金占用中间计算保留6位小数。' });

  return {
    calculations,
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
