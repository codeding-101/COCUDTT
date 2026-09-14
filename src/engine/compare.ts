import type Decimal from 'decimal.js';
import { abs, cmp, d, div, isNegative, q, sub, sum, toDisplay } from '../domain/decimal.js';
import type { CurrencyCode, Incoterm } from '../domain/enums.js';
import { INCOTERMS, isIncotermAvailable, type TradeNode } from '../domain/enums.js';
import type { FxBook } from '../domain/fx.js';
import type { IncotermsRuleSet } from '../domain/rule.js';
import type { ComparisonAnchor, Quote, Scenario } from '../domain/scenario.js';
import type { TaxProfile } from '../domain/tax-profile.js';
import type { Trade } from '../domain/trade.js';
import type { Warning } from '../domain/warning.js';
import { DEFAULT_DERIVED_TAX_IDS } from './aggregate.js';
import { analyze, type AnalysisResult, type EnrichedCostItem } from './analyze.js';
import { convertAmount, resolveFxRate } from './fx.js';
import { EngineError } from './errors.js';
import { INCOTERMS_2020_RULESET } from './responsibility/rules-incoterms2020.js';
import { resolveResponsibility } from './responsibility/resolver.js';
import type { BuyerSummary, SellerSummary } from './aggregate.js';

/** 定点迭代的收敛阈值与轮次上限 */
const CONVERGENCE_EPSILON = '0.01';
const MAX_ITERATIONS = 50;

export interface CompareInput {
  trade: Trade;
  /** 方案模板：提供核算币种、报价币种、汇率选择与方案事实 */
  template: Scenario;
  /** 比较基准，默认固定报价金额 */
  anchor?: ComparisonAnchor;
  /** 参与比较的术语，默认取当前运输方式下全部可用的术语 */
  incoterms?: readonly Incoterm[];
  ruleSet?: IncotermsRuleSet;
  taxProfile: TaxProfile;
  fxBooks: readonly FxBook[];
  today?: string;
}

export interface ComparisonColumn {
  incoterm: Incoterm;
  /** 当前运输方式下该术语是否可用 */
  available: boolean;
  unavailable_reason?: string;
  /** 在该基准下是否可以解出可行的报价 */
  feasible: boolean;
  infeasible_reason?: string;
  /** 本次求解使用的报价金额（核算币种） */
  quote_amount: Decimal;
  iterations: number;
  seller: SellerSummary;
  buyer: BuyerSummary;
  /** 进口税费总额（关税 + 消费税 + 增值税） */
  import_tax_total: Decimal;
  /** 卖方承担的节点数，用来看卖方义务范围 */
  seller_cost_nodes: number;
  /**
   * 卖方实际掏钱的费用项数。
   * 与节点数配合使用：保险属于费用类别而不是贸易节点，
   * 因此 CIF 与 CFR 的节点数相同，但费用项数不同。
   */
  seller_cost_items: number;
  conditional_count: number;
  warning_count: number;
  transfer_point: string;
  transfer_node: TradeNode;
  risk_separation: boolean;
  result: AnalysisResult | null;
}

export interface Comparison {
  base_currency: CurrencyCode;
  anchor: ComparisonAnchor;
  columns: ComparisonColumn[];
  /** 卖方利润最高的术语 */
  best_seller_margin: Incoterm | null;
  /** 买方落地成本最低的术语 */
  best_buyer_landed: Incoterm | null;
  warnings: Warning[];
}

export interface ConditionalSensitivity {
  cost_id: string;
  cost_name: string;
  /** 该费用的金额（核算币种） */
  amount_base: Decimal;
  /** 归卖方时的卖方利润 */
  seller_margin_if_seller: Decimal;
  /** 归买方时的卖方利润 */
  seller_margin_if_buyer: Decimal;
  /** 归买方时的买方落地成本 */
  buyer_landed_if_buyer: Decimal;
  /** 归自己时的买方落地成本 */
  buyer_landed_if_seller: Decimal;
  /** 归属变化对卖方利润的影响 */
  seller_margin_delta: Decimal;
  /** 归属变化对买方落地成本的影响 */
  buyer_landed_delta: Decimal;
}

function anchorLabel(anchor: ComparisonAnchor): string {
  switch (anchor.kind) {
    case 'FIXED_QUOTE':
      return '固定报价金额';
    case 'FIXED_MARKET_PRICE':
      return '固定买方总支付';
    case 'FIXED_MARGIN_RATE':
      return '固定目标利润率';
  }
}

/** 报价覆盖的费用项 = 卖方在该术语下承担的费用 + 货物本身的价值 */
function deriveIncludedIds(
  trade: Trade,
  scenario: Scenario,
  ruleSet: IncotermsRuleSet,
): string[] {
  const decisions = resolveResponsibility({ trade, scenario, ruleSet });
  const included = new Set<string>();
  for (const decision of decisions) {
    if (decision.responsibility === 'SELLER') included.add(decision.cost_id);
  }
  for (const item of trade.items) {
    if (item.is_goods_value === true) included.add(item.cost_id);
  }
  return [...included];
}

/**
 * 保留模板中的报价原样，只按术语推导报价内含清单。
 * 单方案分析用这个：报价仍是用户录入的币种与金额。
 */
export function scenarioWithDerivedInclusions(
  template: Scenario,
  trade: Trade,
  ruleSet: IncotermsRuleSet = INCOTERMS_2020_RULESET,
): Scenario {
  return {
    ...template,
    quote: { ...template.quote, included_cost_ids: deriveIncludedIds(trade, template, ruleSet) },
  };
}

/**
 * 按术语构造方案：报价内含清单由该术语下的责任判定推出——
 * 报价覆盖的正是卖方在该术语下承担的费用（外加货物本身的价值）。
 * 这样"同一套费用事实 + 不同术语"才能得到可比的报价结构。
 *
 * 求解在核算币种下进行，因此生成的报价以核算币种计价，避免二次换算。
 */
export function scenarioForTerm(
  template: Scenario,
  trade: Trade,
  incoterm: Incoterm,
  quoteAmount: Decimal,
  ruleSet: IncotermsRuleSet,
): Scenario {
  const baseCurrency = template.base_currency ?? trade.base_currency;
  const quote: Quote = {
    amount: quoteAmount,
    currency: baseCurrency,
    incoterm,
    included_cost_ids: [],
    ...(template.quote.fx_type !== undefined ? { fx_type: template.quote.fx_type } : {}),
    ...(template.quote.fx_date !== undefined ? { fx_date: template.quote.fx_date } : {}),
  };
  const probe: Scenario = {
    ...template,
    id: `${template.id}-${incoterm}`,
    incoterm,
    base_currency: baseCurrency,
    quote,
  };
  return {
    ...probe,
    quote: { ...probe.quote, included_cost_ids: deriveIncludedIds(trade, probe, ruleSet) },
  };
}

interface SolveState {
  quote: Decimal;
  result: AnalysisResult;
  iterations: number;
  converged: boolean;
}

/**
 * 按基准求解报价金额。
 *
 * - 固定报价：直接使用给定金额
 * - 固定买方总支付：求解 quote 使 BuyerTotal(quote) = 目标值
 * - 固定目标利润率：按不含出口退税的毛利率反推 quote = (卖方费用 + 采购成本) ÷ (1 − 目标利润率)
 *
 * 只有存在以报价金额为基数的百分比费用项时才真正需要迭代；此时用不动点迭代，
 * 收敛判据为相邻两轮报价差额小于 0.01，不收敛即判定该术语在此基准下不可行。
 */
function solveQuote(
  input: CompareInput,
  incoterm: Incoterm,
  anchor: ComparisonAnchor,
  initialQuote: Decimal,
  targetBuyerTotal: Decimal | null,
  ruleSet: IncotermsRuleSet,
): SolveState {
  const runOnce = (quoteAmount: Decimal): AnalysisResult =>
    analyze({
      trade: input.trade,
      scenario: scenarioForTerm(input.template, input.trade, incoterm, quoteAmount, ruleSet),
      ruleSet,
      taxProfile: input.taxProfile,
      fxBooks: input.fxBooks,
      ...(input.today !== undefined ? { today: input.today } : {}),
    });

  let quote = initialQuote;
  let result = runOnce(quote);

  if (anchor.kind === 'FIXED_QUOTE') {
    return { quote, result, iterations: 1, converged: true };
  }

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
    const next =
      anchor.kind === 'FIXED_MARKET_PRICE'
        ? sub(targetBuyerTotal ?? d(0), result.buyer.additional_cost_total)
        : div(addSafe(result.seller.cost_total, result.seller.goods_cost), sub(1, anchor.margin_rate));

    const delta = abs(sub(next, quote));
    const converged = !delta.greaterThan(CONVERGENCE_EPSILON);

    quote = next;
    if (converged) {
      result = runOnce(quote);
      return { quote, result, iterations: iteration + 1, converged: true };
    }

    if (isNegative(quote)) {
      return { quote, result, iterations: iteration + 1, converged: false };
    }
    result = runOnce(quote);
  }

  return { quote, result, iterations: MAX_ITERATIONS, converged: false };
}

function addSafe(a: Decimal, b: Decimal): Decimal {
  return q(a.plus(b));
}

function countSellerNodes(items: readonly EnrichedCostItem[]): number {
  const nodes = new Set<string>();
  for (const enriched of items) {
    if (enriched.counts_to_seller) nodes.add(enriched.item.trade_node);
  }
  return nodes.size;
}

function countSellerItems(items: readonly EnrichedCostItem[]): number {
  return items.filter((enriched) => enriched.counts_to_seller).length;
}

/**
 * 11 个术语的横向对比（设计文档第 11 节）。
 *
 * 注意：进口税费总额在 11 个术语下是同一个数——完税价格以货物成交价、运费、保险费为基础，
 * 与贸易术语无关，术语改变的只是"由谁承担"。这是对比表里一个容易被忽略的恒定量。
 */
export function compare(input: CompareInput): Comparison {
  const ruleSet = input.ruleSet ?? INCOTERMS_2020_RULESET;
  const anchor: ComparisonAnchor = input.anchor ?? { kind: 'FIXED_QUOTE' };
  const base = input.template.base_currency ?? input.trade.base_currency;
  const warnings: Warning[] = [];

  const quoteCurrency = input.template.quote.currency;
  const quoteFxType = input.template.quote.fx_type ?? 'MARKET';
  const quoteBookId = input.template.fx_book_ids?.[quoteFxType];
  const convertToBase = (amount: Decimal, currency: CurrencyCode): Decimal =>
    currency === base
      ? q(amount)
      : convertAmount(
          amount,
          resolveFxRate({
            from: currency,
            to: base,
            fxType: quoteFxType,
            books: input.fxBooks,
            ...(input.template.quote.fx_date !== undefined ? { fxDate: input.template.quote.fx_date } : {}),
            ...(quoteBookId !== undefined ? { designatedBookId: quoteBookId } : {}),
          }),
        );

  const initialQuote = convertToBase(d(input.template.quote.amount), quoteCurrency);

  let targetBuyerTotal: Decimal | null = null;
  if (anchor.kind === 'FIXED_MARKET_PRICE') {
    targetBuyerTotal = convertToBase(d(anchor.buyer_total), anchor.currency);
  }
  if (anchor.kind === 'FIXED_MARGIN_RATE') {
    if (cmp(anchor.margin_rate, '0') <= 0 || cmp(anchor.margin_rate, '1') >= 0) {
      throw new EngineError('ANCHOR_MARGIN_INVALID', `目标利润率必须落在 (0, 1) 区间，当前为 ${toDisplay(anchor.margin_rate, 4)}`, {
        margin_rate: String(anchor.margin_rate),
      });
    }
  }

  const requested = input.incoterms ?? INCOTERMS;
  const columns: ComparisonColumn[] = [];

  for (const incoterm of requested) {
    if (!isIncotermAvailable(input.trade.carriage_mode, incoterm)) {
      columns.push({
        incoterm,
        available: false,
        unavailable_reason: `${incoterm} 仅适用海运及内河运输，当前运输方式为 ${input.trade.carriage_mode}`,
        feasible: false,
        infeasible_reason: '术语与运输方式不兼容',
        quote_amount: d(0),
        iterations: 0,
        seller: emptySeller(),
        buyer: emptyBuyer(),
        import_tax_total: d(0),
        seller_cost_nodes: 0,
        seller_cost_items: 0,
        conditional_count: 0,
        warning_count: 0,
        transfer_point: '',
        transfer_node: 'SELLER_PREMISES',
        risk_separation: false,
        result: null,
      });
      continue;
    }

    const solved = solveQuote(input, incoterm, anchor, initialQuote, targetBuyerTotal, ruleSet);

    if (!solved.converged) {
      columns.push({
        incoterm,
        available: true,
        feasible: false,
        infeasible_reason:
          anchor.kind === 'FIXED_MARKET_PRICE'
            ? `在买方总支付 ${toDisplay(targetBuyerTotal ?? d(0))} 下解不出可行报价（报价为负或不收敛）`
            : '不动点迭代未收敛',
        quote_amount: solved.quote,
        iterations: solved.iterations,
        seller: emptySeller(),
        buyer: emptyBuyer(),
        import_tax_total: d(0),
        seller_cost_nodes: 0,
        seller_cost_items: 0,
        conditional_count: 0,
        warning_count: 0,
        transfer_point: '',
        transfer_node: 'SELLER_PREMISES',
        risk_separation: false,
        result: null,
      });
      continue;
    }

    const result = solved.result;
    const derivedIds: readonly string[] = [
      DEFAULT_DERIVED_TAX_IDS.duty,
      DEFAULT_DERIVED_TAX_IDS.consumption_tax,
      DEFAULT_DERIVED_TAX_IDS.vat,
    ];
    columns.push({
      incoterm,
      available: true,
      feasible: true,
      quote_amount: solved.quote,
      iterations: solved.iterations,
      seller: result.seller,
      buyer: result.buyer,
      import_tax_total: sum(
        result.items
          .filter((enriched) => derivedIds.includes(enriched.item.cost_id))
          .map((enriched) => enriched.base_amount),
      ),
      seller_cost_nodes: countSellerNodes(result.items),
      seller_cost_items: countSellerItems(result.items),
      conditional_count: result.items.filter((enriched) => enriched.needs_confirmation).length,
      warning_count: result.warnings.length,
      transfer_point: result.risk.transfer_point,
      transfer_node: result.risk.transfer_node,
      risk_separation: result.risk.separation,
      result,
    });
  }

  const feasible = columns.filter((column) => column.feasible);
  const bestSeller =
    feasible.length === 0
      ? null
      : feasible.reduce((best, column) => (column.seller.margin.greaterThan(best.seller.margin) ? column : best)).incoterm;
  const bestBuyer =
    feasible.length === 0
      ? null
      : feasible.reduce((best, column) =>
          column.buyer.landed_cost_with_tax.lessThan(best.buyer.landed_cost_with_tax) ? column : best,
        ).incoterm;

  warnings.push({
    code: 'COMPARISON_ANCHOR',
    level: 'INFO',
    message: `本次对比采用「${anchorLabel(anchor)}」基准${
      anchor.kind === 'FIXED_QUOTE'
        ? '：各术语使用同一报价金额，用于观察成本承担如何变化'
        : anchor.kind === 'FIXED_MARKET_PRICE'
          ? `：买方总支付固定为 ${toDisplay(targetBuyerTotal ?? d(0))}，各术语反解报价，利润最高的术语即最赚钱的术语`
          : '：各术语按同一毛利率反推报价'
    }`,
  });

  return {
    base_currency: base,
    anchor,
    columns,
    best_seller_margin: bestSeller,
    best_buyer_landed: bestBuyer,
    warnings,
  };
}

function emptySeller(): SellerSummary {
  return {
    revenue: d(0),
    cost_total: d(0),
    cost_by_category: {},
    goods_cost: d(0),
    rebate_total: d(0),
    non_refundable_vat: d(0),
    rebate_lag_cost: d(0),
    margin: d(0),
    margin_ex_rebate: d(0),
  };
}

function emptyBuyer(): BuyerSummary {
  return {
    quote_amount: d(0),
    additional_cost_total: d(0),
    landed_cost_with_tax: d(0),
    landed_cost_ex_deductible: d(0),
    duty_total: d(0),
    consumption_tax_total: d(0),
    vat_total: d(0),
    deductible_vat: d(0),
  };
}

/**
 * CONDITIONAL 费用的敏感度分析（设计文档 6.5）：
 * 分别假设归卖方与归买方，给出对双方的影响。商务谈判真正需要的是这个差额。
 */
export function conditionalSensitivity(input: CompareInput, scenario: Scenario): ConditionalSensitivity[] {
  const ruleSet = input.ruleSet ?? INCOTERMS_2020_RULESET;
  const runWith = (overrides: Record<string, boolean>): AnalysisResult => {
    const responsibility_overrides = { ...(scenario.responsibility_overrides ?? {}) };
    for (const [costId, asSeller] of Object.entries(overrides)) {
      responsibility_overrides[costId] = {
        responsibility: asSeller ? 'SELLER' : 'BUYER',
        reason: '敏感度分析',
      };
    }
    return analyze({
      trade: input.trade,
      scenario: { ...scenario, responsibility_overrides },
      ruleSet,
      taxProfile: input.taxProfile,
      fxBooks: input.fxBooks,
      ...(input.today !== undefined ? { today: input.today } : {}),
    });
  };

  const baseline = runWith({});
  const pending = baseline.items.filter((enriched) => enriched.needs_confirmation && enriched.exclusion !== null);

  return pending.map((enriched) => {
    const asSeller = runWith({ [enriched.item.cost_id]: true });
    const asBuyer = runWith({ [enriched.item.cost_id]: false });
    return {
      cost_id: enriched.item.cost_id,
      cost_name: enriched.item.cost_name,
      amount_base: enriched.base_amount,
      seller_margin_if_seller: asSeller.seller.margin,
      seller_margin_if_buyer: asBuyer.seller.margin,
      buyer_landed_if_buyer: asBuyer.buyer.landed_cost_with_tax,
      buyer_landed_if_seller: asSeller.buyer.landed_cost_with_tax,
      seller_margin_delta: abs(sub(asSeller.seller.margin, asBuyer.seller.margin)),
      buyer_landed_delta: abs(sub(asSeller.buyer.landed_cost_with_tax, asBuyer.buyer.landed_cost_with_tax)),
    };
  });
}
