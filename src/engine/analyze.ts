import type Decimal from 'decimal.js';
import { add, d, q, type Numeric } from '../domain/decimal.js';
import type { CostItem } from '../domain/cost-item.js';
import type { CurrencyCode, DateStr, Incoterm, Responsibility, ResponsibilitySource, TradeNode } from '../domain/enums.js';
import { TRADE_NODES } from '../domain/enums.js';
import type { FxBook } from '../domain/fx.js';
import type { IncotermsRuleSet } from '../domain/rule.js';
import type { Scenario } from '../domain/scenario.js';
import type { TaxProfile } from '../domain/tax-profile.js';
import type { Trade } from '../domain/trade.js';
import type { Warning } from '../domain/warning.js';
import {
  aggregate,
  DEFAULT_DERIVED_TAX_IDS,
  type BuyerSummary,
  type SellerSummary,
} from './aggregate.js';
import { convertAmount, resolveFxRate, type FxResolution } from './fx.js';
import { EngineError } from './errors.js';
import { compareDate } from '../domain/date.js';
import { buildValueGraph, type ValueGraph } from './graph.js';
import { applyInclusion, buildInclusionPredicate, type ExclusionReason, type InclusionConflict } from './inclusion.js';
import { INCOTERMS_2020_RULESET } from './responsibility/rules-incoterms2020.js';
import { resolveItemResponsibility, resolveResponsibility, type Confidence } from './responsibility/resolver.js';
import { resolveRisk, type RiskResult } from './risk.js';
import { computeDutiableValue, type DutiableComponent } from './tax/dutiable-value.js';
import { computeImportTaxes, type ImportTaxResult } from './tax/import-tax.js';
import { computeRebate, type RebateResult } from './tax/rebate.js';

const SHIPMENT_BOUNDARY: TradeNode = 'CARRIER_HANDOVER';

/** 装船（承运人接管）及其之前 */
function isPreShipment(node: TradeNode): boolean {
  return TRADE_NODES.indexOf(node) <= TRADE_NODES.indexOf(SHIPMENT_BOUNDARY);
}

export interface AnalysisInput {
  trade: Trade;
  scenario: Scenario;
  ruleSet?: IncotermsRuleSet;
  taxProfile: TaxProfile;
  fxBooks: readonly FxBook[];
  /** 当前日期，用于出口退税申报期限提示 */
  today?: DateStr;
}

export interface EnrichedCostItem {
  item: CostItem;
  /** 原币金额 */
  gross_amount: Decimal;
  /** 核算币种金额 */
  base_amount: Decimal;
  fx: FxResolution | null;
  responsibility: Responsibility;
  responsibility_source: ResponsibilitySource;
  rule_id: string | null;
  note: string;
  confidence: Confidence;
  needs_confirmation: boolean;
  exclusion: ExclusionReason | null;
  counts_to_seller: boolean;
  counts_to_buyer: boolean;
}

export interface AnalysisResult {
  scenario_id: string;
  incoterm: Incoterm;
  base_currency: CurrencyCode;
  items: EnrichedCostItem[];
  seller: SellerSummary;
  buyer: BuyerSummary;
  rebate: RebateResult;
  import_tax: ImportTaxResult;
  dutiable_value: { value: Decimal; components: DutiableComponent[] };
  risk: RiskResult;
  conflicts: InclusionConflict[];
  warnings: Warning[];
}

/** CIF / CIP 要求卖方投保，用于判断报价结构是否完整 */
function hasInsuranceItem(trade: Trade): boolean {
  return trade.items.some((item) => item.cost_category === 'INSURANCE' && item.contained_in_cost_id === undefined);
}

function derivedTaxItems(
  currency: CurrencyCode,
  amounts: { duty: Decimal; consumptionTax: Decimal; vat: Decimal },
): CostItem[] {
  const ids = DEFAULT_DERIVED_TAX_IDS;
  const base = {
    cost_category: 'IMPORT_DUTIES' as const,
    trade_node: 'IMPORT_DUTIES' as const,
    pricing_method: 'ACTUAL' as const,
    currency,
    fx_type: 'CUSTOMS' as const,
    base_currency: currency,
    tax_included: false,
    responsibility: 'CONDITIONAL' as const,
    responsibility_source: 'UNRESOLVED' as const,
    included_in_quoted_price: false,
    is_custom: false,
    source: 'DERIVED' as const,
  };
  return [
    { ...base, cost_id: ids.duty, cost_name: '进口关税', amount: amounts.duty },
    { ...base, cost_id: ids.consumption_tax, cost_name: '进口消费税', amount: amounts.consumptionTax },
    { ...base, cost_id: ids.vat, cost_name: '进口增值税', amount: amounts.vat },
  ];
}

/** 合法十进制：允许负号与小数，不允许货币符号、千分位、空格 */
const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;

/**
 * 入口处的数值校验。
 *
 * 这几项是必填的金额/数量，用户清空输入框时拿到的是空串。
 * 不做这一层校验的话，空串会一路流到 decimal.js，
 * 抛出 [DecimalError] Invalid argument 这类库错误——界面只能显示"未知错误"，
 * 用户完全不知道哪里没填。
 */
function requireNumericInput(value: Numeric | undefined, label: string): void {
  const text = value === undefined || value === null ? '' : String(value).trim();
  if (text === '') {
    throw new EngineError('INPUT_VALUE_MISSING', `「${label}」未填写，无法计算`, { field: label });
  }
  if (!NUMERIC_TEXT.test(text)) {
    throw new EngineError(
      'INPUT_VALUE_MISSING',
      `「${label}」不是有效数字：${text}。请填纯数字，不要带货币符号或千分位`,
      { field: label, value: text },
    );
  }
}

/**
 * 分析管线（设计文档第 10 节）。
 * 输入同一套交易事实与一个方案，输出该方案下买卖双方的成本与利润。
 */
export function analyze(input: AnalysisInput): AnalysisResult {
  const { trade, scenario, taxProfile, fxBooks } = input;
  const ruleSet = input.ruleSet ?? INCOTERMS_2020_RULESET;
  const base = scenario.base_currency ?? trade.base_currency;
  const warnings: Warning[] = [];

  requireNumericInput(trade.goods.quantity, '商品数量');
  requireNumericInput(trade.goods.trade_value.amount, '成交货值');
  requireNumericInput(trade.goods.seller_goods_cost.amount, '卖方采购成本');
  requireNumericInput(scenario.quote.amount, '报价金额');

  // 步骤 1：责任判定（同时校验术语与运输方式是否兼容）
  const initialDecisions = resolveResponsibility({ trade, scenario, ruleSet });
  const decisions = new Map(initialDecisions.map((decision) => [decision.cost_id, decision]));

  // 步骤 2：报价、货值、采购成本换算到核算币种
  const quoteFxType = scenario.quote.fx_type ?? 'MARKET';
  const quoteBookId = scenario.fx_book_ids?.[quoteFxType];
  const priceLevelFxInput = {
    to: base,
    fxType: quoteFxType,
    ...(scenario.quote.fx_date !== undefined ? { fxDate: scenario.quote.fx_date } : {}),
    books: fxBooks,
    ...(quoteBookId !== undefined ? { designatedBookId: quoteBookId } : {}),
  };

  const quoteFx = resolveFxRate({
    from: scenario.quote.currency,
    ...priceLevelFxInput,
    ...(scenario.quote.fx_rate !== undefined ? { explicitRate: scenario.quote.fx_rate } : {}),
  });
  const quoteAmountBase = convertAmount(scenario.quote.amount, quoteFx);

  const convertPriceLevel = (amount: Numeric, currency: CurrencyCode): Decimal =>
    currency === base ? q(amount) : convertAmount(amount, resolveFxRate({ from: currency, ...priceLevelFxInput }));

  const goodsValueBase = convertPriceLevel(trade.goods.trade_value.amount, trade.goods.trade_value.currency);
  const sellerGoodsCostBase = convertPriceLevel(
    trade.goods.seller_goods_cost.amount,
    trade.goods.seller_goods_cost.currency,
  );

  // 步骤 3：每笔费用的汇率解析（四级顺序，绝不跨类型回退）
  const fxByCostId = new Map<string, FxResolution>();
  for (const item of trade.items) {
    const explicitRate = item.fx_rate ?? scenario.fx_rate_overrides?.[item.cost_id];
    const designatedBookId = scenario.fx_book_ids?.[item.fx_type];
    fxByCostId.set(
      item.cost_id,
      resolveFxRate({
        from: item.currency,
        to: base,
        fxType: item.fx_type,
        books: fxBooks,
        ...(explicitRate !== undefined ? { explicitRate } : {}),
        ...(item.fx_date !== undefined ? { fxDate: item.fx_date } : {}),
        ...(designatedBookId !== undefined ? { designatedBookId } : {}),
      }),
    );
  }

  // 步骤 4：依赖图与完税价格（税费口径的完税价格按海关适用汇率折算）
  let dutiableComponents: DutiableComponent[] = [];
  const graph: ValueGraph = buildValueGraph({
    items: trade.items,
    baseCurrency: base,
    goodsValueBase,
    quoteAmountBase,
    fxByCostId,
    dutiableValueResolver: ({ amountBase, grossOriginal }) => {
      const result = computeDutiableValue({
        goods: trade.goods,
        items: trade.items,
        baseCurrency: base,
        books: fxBooks,
        profile: taxProfile,
        goodsValueBase,
        grossOf: grossOriginal,
        amountBase,
        ...(scenario.quote.fx_date !== undefined ? { fxDate: scenario.quote.fx_date } : {}),
      });
      dutiableComponents = result.components;
      warnings.push(...result.warnings);
      return result.value;
    },
  });

  const itemAmounts = graph.allAmounts();
  const dutiableValue = graph.dutiableValue();

  // 步骤 5：进口环节税费（税率优先查 HS 税率表，从量税需要商品数量）
  const importTax = computeImportTaxes({
    profile: taxProfile,
    dutiableValue,
    ...(trade.goods.tax_key !== undefined ? { taxKey: trade.goods.tax_key } : {}),
    quantity: trade.goods.quantity,
    unit: trade.goods.unit,
  });
  warnings.push(...importTax.warnings);

  // 步骤 6：派生的税费费用项也要走规则判定（DAP 归买方、DDP 归卖方）
  const taxItems = derivedTaxItems(base, {
    duty: importTax.duty,
    consumptionTax: importTax.consumption_tax,
    vat: importTax.vat,
  });
  const taxDecisions = new Map(
    taxItems.map((item) => [item.cost_id, resolveItemResponsibility(item, { trade, scenario, ruleSet })]),
  );
  for (const [costId, decision] of taxDecisions) decisions.set(costId, decision);

  const taxAmounts = new Map<string, Decimal>([
    [DEFAULT_DERIVED_TAX_IDS.duty, importTax.duty],
    [DEFAULT_DERIVED_TAX_IDS.consumption_tax, importTax.consumption_tax],
    [DEFAULT_DERIVED_TAX_IDS.vat, importTax.vat],
  ]);
  const allItems = [...trade.items, ...taxItems];
  const amountBaseOf = (costId: string): Decimal => taxAmounts.get(costId) ?? itemAmounts.get(costId) ?? q(0);

  // 步骤 7：出口退税（离岸价还原的术语依赖性见设计文档 9.5.2）
  const declaredIds = new Set(scenario.quote.included_cost_ids);
  const isIncludedInQuote = buildInclusionPredicate(scenario.quote.included_cost_ids);
  let postShipmentIncludedBase = d(0);
  let preShipmentExcludedBase = d(0);
  for (const item of trade.items) {
    if (item.contained_in_cost_id !== undefined || item.is_goods_value === true) continue;
    const amount = itemAmounts.get(item.cost_id) ?? q(0);
    const included = isIncludedInQuote(item);
    if (included && !isPreShipment(item.trade_node)) postShipmentIncludedBase = add(postShipmentIncludedBase, amount);
    if (!included && isPreShipment(item.trade_node)) preShipmentExcludedBase = add(preShipmentExcludedBase, amount);
  }

  const rebate = computeRebate({
    profile: taxProfile.export.rebate,
    seller_goods_cost_base: sellerGoodsCostBase,
    quote_amount_base: quoteAmountBase,
    post_shipment_included_base: postShipmentIncludedBase,
    pre_shipment_excluded_base: preShipmentExcludedBase,
    ...(trade.goods.tax_key !== undefined ? { taxKey: trade.goods.tax_key } : {}),
    ...(trade.export_date !== undefined ? { export_date: trade.export_date } : {}),
    ...(input.today !== undefined ? { today: input.today } : {}),
  });
  warnings.push(...rebate.warnings);

  // 步骤 8：报价内含去重与冲突检测
  const inclusion = applyInclusion({
    items: allItems,
    included_cost_ids: scenario.quote.included_cost_ids,
    quote_amount_base: quoteAmountBase,
    amountBaseOf,
    responsibilityOf: (costId) => decisions.get(costId)?.responsibility ?? 'CONDITIONAL',
  });
  warnings.push(...inclusion.warnings);

  /*
   * 报价既没有声明内含清单、费用项上也没有任何标记时，"报价勾稽校验"会被跳过、
   * "离岸价还原"也会退化为把所有报价外成本当作装船前费用。界面按术语自动推导这份清单，
   * 但直接调用引擎的代码可能忘记，这里把这种退化显式说出来，避免静默失真。
   */
  const anyItemMarked = trade.items.some((item) => item.included_in_quoted_price);
  if (scenario.quote.included_cost_ids.length === 0 && !anyItemMarked) {
    warnings.push({
      code: 'QUOTE_INCLUSION_UNSPECIFIED',
      level: 'INFO',
      message:
        '报价未声明内含费用清单，费用项上也没有标记：报价勾稽校验已跳过，还原的离岸价也可能偏大。界面会按术语自动推导清单；直接调用引擎时请一并处理',
    });
  }

  // 步骤 9：汇总
  const aggregated = aggregate({
    items: allItems,
    amountBaseOf,
    exclusions: inclusion.exclusions,
    decisionOf: (costId) => decisions.get(costId),
    quote_amount_base: quoteAmountBase,
    seller_goods_cost_base: sellerGoodsCostBase,
    rebate,
    vat_deductible_for_buyer: taxProfile.import.vatDeductibleForBuyer,
  });
  warnings.push(...aggregated.warnings);

  // 步骤 10：风险转移
  const risk = resolveRisk(scenario.incoterm);

  // 步骤 11：其余业务告警
  for (const decision of decisions.values()) {
    if (decision.source === 'TRADE_NODE') {
      warnings.push({
        code: 'RESP_NODE_INFERRED',
        level: 'WARN',
        message: `费用「${decision.cost_name}」的归属仅由贸易节点推断，请核对合同：${decision.note}`,
        cost_id: decision.cost_id,
      });
    }
  }
  if (scenario.incoterm === 'DDP') {
    warnings.push({
      code: 'DDP_PRACTICAL_WARNING',
      level: 'INFO',
      message: 'DDP 下卖方承担进口清关与关税；部分国家实操上卖方难以作为进口方，需确认可行性',
    });
  }

  // CIF / CIP 下卖方有投保义务，缺保险费项说明报价结构不完整
  if ((scenario.incoterm === 'CIF' || scenario.incoterm === 'CIP') && !hasInsuranceItem(trade)) {    warnings.push({
      code: 'INSURANCE_REQUIRED_MISSING',
      level: 'WARN',
      message: `${scenario.incoterm} 下卖方负有投保义务（保额不低于合同价 110%），但费用清单中没有保险费项，卖方成本与利润会被高估`,
    });
  }

  // 承运人原因与不可抗力产生的费用先按术语归属垫付，再向承运人索赔
  const claimable = trade.items.filter(
    (item) => item.occurrence_reason === 'CARRIER_FAULT' || item.occurrence_reason === 'FORCE_MAJEURE',
  );
  if (claimable.length > 0) {
    warnings.push({
      code: 'CARRIER_FAULT_CLAIMABLE',
      level: 'INFO',
      message: `以下费用因承运人原因或不可抗力产生（${claimable
        .map((item) => item.cost_name)
        .join('、')}）：先按术语归属由承担方垫付，可向承运人索赔或另行协商`,
    });
  }

  // 海关汇率按月锁定，出口日期不在任何一本海关汇率簿的有效期内时提示
  if (trade.export_date !== undefined && fxBooks.some((book) => book.type === 'CUSTOMS')) {
    const covered = fxBooks.some(
      (book) =>
        book.type === 'CUSTOMS' &&
        (book.valid_from === undefined || compareDate(trade.export_date as string, book.valid_from) >= 0) &&
        (book.valid_to === undefined || compareDate(trade.export_date as string, book.valid_to) <= 0),
    );
    if (!covered) {
      warnings.push({
        code: 'CUSTOMS_FX_EXPIRED',
        level: 'WARN',
        message: `出口日期 ${trade.export_date} 不在任何一本海关适用汇率簿的有效期内，请确认所用海关汇率`,
      });
    }
  }

  // 步骤 12：逐项结果
  const items: EnrichedCostItem[] = allItems.map((item) => {
    const decision = decisions.get(item.cost_id);
    const exclusion = inclusion.exclusions.get(item.cost_id) ?? null;
    const baseAmount = amountBaseOf(item.cost_id);
    const fx = fxByCostId.get(item.cost_id) ?? null;
    const responsibility = decision?.responsibility ?? 'CONDITIONAL';
    return {
      item,
      gross_amount: taxAmounts.has(item.cost_id) ? baseAmount : graph.grossOriginal(item.cost_id),
      base_amount: baseAmount,
      fx,
      responsibility,
      responsibility_source: decision?.source ?? 'UNRESOLVED',
      rule_id: decision?.rule_id ?? null,
      note: decision?.note ?? '',
      confidence: decision?.confidence ?? 'LOW',
      needs_confirmation: decision?.needs_confirmation ?? true,
      exclusion,
      counts_to_seller: exclusion === null && responsibility === 'SELLER',
      counts_to_buyer: exclusion === null && responsibility === 'BUYER',
    };
  });

  return {
    scenario_id: scenario.id,
    incoterm: scenario.incoterm,
    base_currency: base,
    items,
    seller: aggregated.seller,
    buyer: aggregated.buyer,
    rebate,
    import_tax: importTax,
    dutiable_value: { value: dutiableValue, components: dutiableComponents },
    risk,
    conflicts: inclusion.conflicts,
    warnings,
  };
}
