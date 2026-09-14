import type Decimal from 'decimal.js';
import { add, d, sub } from '../domain/decimal.js';
import type { CostItem } from '../domain/cost-item.js';
import type { CostCategory, Responsibility } from '../domain/enums.js';
import type { Warning } from '../domain/warning.js';
import type { ExclusionReason } from './inclusion.js';
import type { RebateResult } from './tax/rebate.js';

export interface DerivedTaxIds {
  duty: string;
  consumption_tax: string;
  vat: string;
}

export const DEFAULT_DERIVED_TAX_IDS: DerivedTaxIds = {
  duty: 'derived-import-duty',
  consumption_tax: 'derived-consumption-tax',
  vat: 'derived-import-vat',
};

export interface AggregateInput {
  items: readonly CostItem[];
  amountBaseOf: (costId: string) => Decimal;
  exclusions: ReadonlyMap<string, ExclusionReason>;
  decisionOf: (
    costId: string,
  ) => { responsibility: Responsibility; source: string; confidence: string; note: string } | undefined;
  quote_amount_base: Decimal;
  /** 卖方采购含税成本 / 生产成本（核算币种） */
  seller_goods_cost_base: Decimal;
  rebate: RebateResult;
  /** 买方进口增值税是否可抵扣，决定落地成本的不含税口径 */
  vat_deductible_for_buyer: boolean;
  derived_tax_ids?: DerivedTaxIds;
}

export interface SellerSummary {
  revenue: Decimal;
  cost_total: Decimal;
  cost_by_category: Partial<Record<CostCategory, Decimal>>;
  goods_cost: Decimal;
  rebate_total: Decimal;
  non_refundable_vat: Decimal;
  rebate_lag_cost: Decimal;
  /** 含出口退税的利润 */
  margin: Decimal;
  /** 不含出口退税的利润，用于看利润对退税的依赖度 */
  margin_ex_rebate: Decimal;
}

export interface BuyerSummary {
  quote_amount: Decimal;
  additional_cost_total: Decimal;
  landed_cost_with_tax: Decimal;
  landed_cost_ex_deductible: Decimal;
  /** 买方承担的关税（DDP 下由卖方承担，此处为 0） */
  duty_total: Decimal;
  /** 买方承担的消费税 */
  consumption_tax_total: Decimal;
  /** 买方承担的进口增值税 */
  vat_total: Decimal;
  /** 买方承担、且可抵扣的增值税 */
  deductible_vat: Decimal;
}

export interface AggregateResult {
  seller: SellerSummary;
  buyer: BuyerSummary;
  warnings: Warning[];
}

/** 退税对利润的贡献超过该比例时提示依赖度 */
const REBATE_DEPENDENCE_THRESHOLD = 0.5;

export function aggregate(input: AggregateInput): AggregateResult {
  const warnings: Warning[] = [];
  const taxIds = input.derived_tax_ids ?? DEFAULT_DERIVED_TAX_IDS;

  const countsTo = (costId: string): Responsibility | null => {
    if (input.exclusions.has(costId)) return null;
    const decision = input.decisionOf(costId);
    if (decision === undefined) return null;
    if (decision.responsibility === 'SELLER' || decision.responsibility === 'BUYER') {
      return decision.responsibility;
    }
    return null;
  };

  let costTotal = d(0);
  const costByCategory: Partial<Record<CostCategory, Decimal>> = {};
  let additionalTotal = d(0);
  let dutyTotal = d(0);
  let consumptionTaxTotal = d(0);
  let vatTotal = d(0);

  for (const item of input.items) {
    const side = countsTo(item.cost_id);
    if (side === null) continue;
    const amount = input.amountBaseOf(item.cost_id);

    if (side === 'SELLER') {
      costTotal = add(costTotal, amount);
      costByCategory[item.cost_category] = add(costByCategory[item.cost_category] ?? d(0), amount);
      // 卖方承担的税费计入其成本，不计入买方口径
      continue;
    }

    additionalTotal = add(additionalTotal, amount);
    /*
     * 只累计"买方承担"的税费。
     * DDP 下进口税费由卖方承担，若这里把总额记到买方头上，
     * 买方卡片会出现他没付过的税、并且"落地成本（含税）"与上面各项加不起来。
     * 术语无关的税费总额由上层（compare）另行汇总。
     */
    if (item.cost_id === taxIds.duty) dutyTotal = add(dutyTotal, amount);
    if (item.cost_id === taxIds.consumption_tax) consumptionTaxTotal = add(consumptionTaxTotal, amount);
    if (item.cost_id === taxIds.vat) vatTotal = add(vatTotal, amount);
  }

  const deductibleVatAmount = input.vat_deductible_for_buyer ? vatTotal : d(0);

  const landedWithTax = add(input.quote_amount_base, additionalTotal);
  const landedExDeductible = sub(landedWithTax, deductibleVatAmount);

  const rebateTotal = input.rebate.rebate_total;
  const marginExRebate = sub(sub(input.quote_amount_base, costTotal), input.seller_goods_cost_base);
  const margin = sub(add(marginExRebate, rebateTotal), input.rebate.lag_cost);

  if (!rebateTotal.isZero()) {
    if (margin.isNegative()) {
      warnings.push({
        code: 'REBATE_DRIVES_MARGIN',
        level: 'WARN',
        message: '该方案在含退税后仍然亏损，退税未能补平成本',
      });
    } else if (rebateTotal.dividedBy(margin).greaterThan(REBATE_DEPENDENCE_THRESHOLD)) {
      warnings.push({
        code: 'REBATE_DRIVES_MARGIN',
        level: 'WARN',
        message: `出口退税占利润的比例超过 ${REBATE_DEPENDENCE_THRESHOLD * 100}%，该方案对退税依赖度较高`,
      });
    }
  }

  return {
    seller: {
      revenue: input.quote_amount_base,
      cost_total: costTotal,
      cost_by_category: costByCategory,
      goods_cost: input.seller_goods_cost_base,
      rebate_total: rebateTotal,
      non_refundable_vat: input.rebate.non_refundable_vat,
      rebate_lag_cost: input.rebate.lag_cost,
      margin,
      margin_ex_rebate: marginExRebate,
    },
    buyer: {
      quote_amount: input.quote_amount_base,
      additional_cost_total: additionalTotal,
      landed_cost_with_tax: landedWithTax,
      landed_cost_ex_deductible: landedExDeductible,
      duty_total: dutyTotal,
      consumption_tax_total: consumptionTaxTotal,
      vat_total: vatTotal,
      deductible_vat: deductibleVatAmount,
    },
    warnings,
  };
}
