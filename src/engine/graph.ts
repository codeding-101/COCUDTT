import type Decimal from 'decimal.js';
import { q, sum } from '../domain/decimal.js';
import type { BaseRef, CostItem } from '../domain/cost-item.js';
import type { CurrencyCode } from '../domain/enums.js';
import { EngineError } from './errors.js';
import { convertAmount, type FxResolution } from './fx.js';
import { computeGrossAmount } from './pricing.js';

/**
 * 完税价格解析器。由税务模块实现，通过回调拿到费用项金额，
 * 从而在不产生循环依赖的前提下复用依赖图。
 */
export type DutiableValueResolver = (access: {
  /** 核算币种金额（商业汇率） */
  amountBase: (costId: string) => Decimal;
  /** 原币金额 */
  grossOriginal: (costId: string) => Decimal;
}) => Decimal;

export interface ValueGraphInput {
  items: readonly CostItem[];
  baseCurrency: CurrencyCode;
  /** 货值（核算币种） */
  goodsValueBase: Decimal;
  /** 报价（核算币种） */
  quoteAmountBase: Decimal;
  /** 每笔费用的汇率解析结果（原币 → 核算币种） */
  fxByCostId: ReadonlyMap<string, FxResolution>;
  dutiableValueResolver: DutiableValueResolver;
}

export interface ValueGraph {
  /** 核算币种金额 */
  amountBase(costId: string): Decimal;
  /** 原币金额 */
  grossOriginal(costId: string): Decimal;
  /** 完税价格（核算币种） */
  dutiableValue(): Decimal;
  /** 全部费用项的核算币种金额 */
  allAmounts(): ReadonlyMap<string, Decimal>;
}

/**
 * 费用项金额与计费基数的依赖解析（设计文档 4.3、第 10 节步骤 3–5）。
 *
 * 约定：百分比计费的基数统一按核算币种计算，因此百分比费用项本身必须使用核算币种，
 * 否则金额会与币种脱节。其他计费方式按各自币种计价后再换算。
 */
export function buildValueGraph(input: ValueGraphInput): ValueGraph {
  const itemsById = new Map(input.items.map((item) => [item.cost_id, item]));
  const grossCache = new Map<string, Decimal>();
  const baseCache = new Map<string, Decimal>();
  const visiting = new Set<string>();
  let dutiableCache: Decimal | null = null;

  function requireItem(costId: string): CostItem {
    const item = itemsById.get(costId);
    if (item === undefined) {
      throw new EngineError('COST_ITEM_NOT_FOUND', `计费基数引用了不存在的费用项: ${costId}`, { cost_id: costId });
    }
    return item;
  }

  function amountBase(costId: string): Decimal {
    const cached = baseCache.get(costId);
    if (cached !== undefined) return cached;

    const item = requireItem(costId);
    if (visiting.has(costId)) {
      throw new EngineError(
        'GRAPH_CYCLE',
        `计费基数出现环形引用，涉及费用项: ${[...visiting, costId].join(' → ')}`,
        { cost_id: costId, chain: [...visiting, costId] },
      );
    }

    visiting.add(costId);
    try {
      const gross = grossOriginal(costId);
      let value: Decimal;

      if (item.pricing_method === 'PERCENT') {
        if (item.currency !== input.baseCurrency) {
          throw new EngineError(
            'PRICING_CURRENCY_MISMATCH',
            `费用「${item.cost_name}」按百分比计费，币种（${item.currency}）必须与核算币种（${input.baseCurrency}）一致，否则基数与金额会脱节`,
            { cost_id: costId, currency: item.currency, base_currency: input.baseCurrency },
          );
        }
        value = gross;
      } else {
        const fx = input.fxByCostId.get(costId);
        if (fx === undefined) {
          throw new EngineError('FX_MISSING', `费用「${item.cost_name}」缺少汇率解析结果`, { cost_id: costId });
        }
        value = convertAmount(gross, fx);
      }

      baseCache.set(costId, value);
      return value;
    } finally {
      visiting.delete(costId);
    }
  }

  function grossOriginal(costId: string): Decimal {
    const cached = grossCache.get(costId);
    if (cached !== undefined) return cached;

    const item = requireItem(costId);
    const gross = computeGrossAmount(item, {
      resolveBase: (ref) => resolveBaseRef(ref),
    });
    grossCache.set(costId, gross);
    return gross;
  }

  function resolveBaseRef(ref: BaseRef): Decimal {
    switch (ref.kind) {
      case 'GOODS_VALUE':
        return q(input.goodsValueBase);
      case 'QUOTE_AMOUNT':
        return q(input.quoteAmountBase);
      case 'CUSTOMS_DUTIABLE_VALUE':
        return dutiableValue();
      case 'COST_ITEMS': {
        if (ref.ids.length === 0) {
          throw new EngineError('PRICING_BASE_MISSING', '计费基数引用的费用项列表为空');
        }
        return sum(ref.ids.map((id) => amountBase(id)));
      }
    }
  }

  function dutiableValue(): Decimal {
    if (dutiableCache === null) {
      dutiableCache = q(input.dutiableValueResolver({ amountBase, grossOriginal }));
    }
    return dutiableCache;
  }

  function allAmounts(): ReadonlyMap<string, Decimal> {
    for (const item of input.items) amountBase(item.cost_id);
    return new Map(baseCache);
  }

  return { amountBase, grossOriginal, dutiableValue, allAmounts };
}
