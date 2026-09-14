import type Decimal from 'decimal.js';
import { add, cmp, d, isNegative, minOf, mul, q, sub, type Numeric } from '../domain/decimal.js';
import type { BaseRef, CostItem, Tier } from '../domain/cost-item.js';
import { PRICING_METHOD_LABELS, type CurrencyCode } from '../domain/enums.js';
import { EngineError } from './errors.js';

/**
 * 计费上下文。计费基数的解析由依赖图层提供（设计文档 4.3、第 10 节步骤 3–5），
 * 使计费模块保持纯函数、可单测。
 */
export interface PricingContext {
  /** 解析 calculation_base 引用的金额（已换算到核算币种或原币，由调用方约定） */
  resolveBase(ref: BaseRef): Numeric;
  /** 由 timing 推导天数，供 PER_DAY 使用 */
  resolveDays?(item: CostItem): Numeric | null;
}

export interface PricedItem {
  cost_id: string;
  currency: CurrencyCode;
  /** 原币金额，按 pricing_method 归一化后的结果 */
  gross_amount: Decimal;
}

/**
 * 报错文案里出现的字段名。不能用 amount / quantity / rate 这类内部标识符：
 * 用户看到的是「缺少『数量』」而不是「缺少 quantity」。
 */
const FIELD_LABELS: Record<string, string> = {
  amount: '金额',
  quantity: '数量',
  unit: '单位',
  calculation_base: '计算基数',
};

/** 同一个字段在不同计费方式下叫法不同 */
const RATE_LABELS: Record<string, string> = {
  QTY_X_UNIT: '单价',
  PERCENT: '比率',
  PER_DAY: '日费率',
  TIERED: '费率',
};

function fieldLabel(field: string, item: CostItem): string {
  if (field === 'rate') return RATE_LABELS[item.pricing_method] ?? '费率';
  return FIELD_LABELS[field] ?? field;
}

function missing(item: CostItem, field: string): never {
  throw new EngineError(
    'PRICING_INPUT_MISSING',
    `费用「${item.cost_name}」按「${PRICING_METHOD_LABELS[item.pricing_method]}」计费，但缺少「${fieldLabel(field, item)}」`,
    { cost_id: item.cost_id, pricing_method: item.pricing_method, field },
  );
}

/**
 * 空字符串、null、undefined 都算"没填"——用户清空输入框拿到的是 ''。
 * 声明为类型谓词，这样调用处排查之后就能把 null / undefined 排除掉；
 * 空字符串无法用类型表达，只能在运行时挡。
 */
function isBlank(value: Numeric | undefined | null): value is null | undefined {
  if (value === undefined || value === null) return true;
  return typeof value === 'string' && value.trim() === '';
}

function requireNumeric(value: Numeric | undefined, field: string, item: CostItem): Numeric {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    missing(item, field);
  }
  return value;
}

/** 按计费方式把费用归一化为原币金额（设计文档 4.4） */
export function normalizeItem(item: CostItem, ctx: PricingContext): PricedItem {
  return {
    cost_id: item.cost_id,
    currency: item.currency,
    gross_amount: computeGrossAmount(item, ctx),
  };
}

export function normalizeAll(items: readonly CostItem[], ctx: PricingContext): PricedItem[] {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.cost_id)) {
      throw new EngineError('DUPLICATE_COST_ID', `费用 id 重复: ${item.cost_id}`, { cost_id: item.cost_id });
    }
    seen.add(item.cost_id);
  }
  return items.map((item) => normalizeItem(item, ctx));
}

export function computeGrossAmount(item: CostItem, ctx: PricingContext): Decimal {
  switch (item.pricing_method) {
    case 'FIXED':
    case 'ACTUAL':
      return q(requireNumeric(item.amount, 'amount', item));

    case 'QTY_X_UNIT': {
      const quantity = requireNumeric(item.quantity, 'quantity', item);
      const rate = requireNumeric(item.rate, 'rate', item);
      return mul(quantity, rate);
    }

    case 'PERCENT': {
      const rate = requireNumeric(item.rate, 'rate', item);
      const baseRef = item.calculation_base;
      if (baseRef === undefined) missing(item, 'calculation_base');
      return mul(ctx.resolveBase(baseRef), rate);
    }

    case 'PER_DAY': {
      const rate = requireNumeric(item.rate, 'rate', item);
      /*
       * 注意用 isBlank 而不是 ??：空字符串不是 nullish，
       * `item.days ?? fallback` 遇到 '' 会原样返回空串，绕过"没填"的判断。
       */
      const days = item.days ?? ctx.resolveDays?.(item) ?? null;
      if (isBlank(days)) {
        throw new EngineError(
          'PRICING_BASE_MISSING',
          `费用「${item.cost_name}」按天计费，但天数无法确定：请填写「天数」，或填完整的「起止日期」`,
          { cost_id: item.cost_id },
        );
      }
      return mul(days, rate);
    }

    case 'TIERED':
      return computeTieredAmount(item, ctx);
  }
}

/** 阶梯档位按上界升序排列，无上界者排最后 */
function normalizeTiers(item: CostItem): Tier[] {
  const tiers = item.tiers ?? [];
  if (tiers.length === 0) {
    throw new EngineError(
      'PRICING_TIER_INVALID',
      `费用「${item.cost_name}」使用阶梯计费，但没有填写任何档位`,
      { cost_id: item.cost_id },
    );
  }

  const sorted = [...tiers].sort((a, b) => {
    if (a.up_to === null) return 1;
    if (b.up_to === null) return -1;
    return cmp(a.up_to, b.up_to);
  });

  const unlimited = sorted.filter((tier) => tier.up_to === null);
  if (unlimited.length > 1) {
    throw new EngineError(
      'PRICING_TIER_INVALID',
      `费用「${item.cost_name}」 有 ${unlimited.length} 个无上界的档位，只能有一个（表示"以上"）`,
      { cost_id: item.cost_id, count: unlimited.length },
    );
  }

  let previous: Decimal | null = null;
  for (const tier of sorted) {
    if (isBlank(tier.rate)) {
      throw new EngineError(
        'PRICING_TIER_INVALID',
        `费用「${item.cost_name}」有档位没有填费率，请补齐后再算`,
        { cost_id: item.cost_id },
      );
    }
    if (isNegative(tier.rate)) {
      throw new EngineError(
        'PRICING_TIER_INVALID',
        `费用「${item.cost_name}」 的档位费率不能为负：${tier.rate}`,
        { cost_id: item.cost_id, rate: String(tier.rate) },
      );
    }
    if (tier.up_to === null) continue;
    if (isNegative(tier.up_to) || cmp(tier.up_to, 0) === 0) {
      throw new EngineError(
        'PRICING_TIER_INVALID',
        `费用「${item.cost_name}」 的档位上界必须大于 0：${tier.up_to}`,
        { cost_id: item.cost_id, up_to: String(tier.up_to) },
      );
    }
    if (previous !== null && cmp(tier.up_to, previous) <= 0) {
      throw new EngineError(
        'PRICING_TIER_INVALID',
        `费用「${item.cost_name}」 的档位上界必须严格递增：${previous} → ${tier.up_to}`,
        { cost_id: item.cost_id, previous: previous.toString(), up_to: String(tier.up_to) },
      );
    }
    previous = d(tier.up_to);
  }

  return sorted;
}

/** 阶梯的计费量：按数量或按天数 */
function tierQuantity(item: CostItem, ctx: PricingContext): Decimal {
  const basis = item.tier_basis ?? 'QUANTITY';
  if (basis === 'DAYS') {
    // 同上：'' 不是 nullish，必须用 isBlank 判断
    const days = item.days ?? ctx.resolveDays?.(item) ?? null;
    if (isBlank(days)) {
      throw new EngineError(
        'PRICING_BASE_MISSING',
        `费用「${item.cost_name}」按阶梯计费且计费量取天数，但天数无法确定：请填写「天数」，或填完整的「起止日期」`,
        { cost_id: item.cost_id },
      );
    }
    return d(days);
  }
  if (item.quantity === undefined || item.quantity === null) {
    throw new EngineError(
      'PRICING_INPUT_MISSING',
      `费用「${item.cost_name}」按阶梯计费且计费量取数量，但未填写「数量」`,
      { cost_id: item.cost_id },
    );
  }
  return d(item.quantity);
}

/**
 * 阶梯计费（设计文档 4.4）。
 *
 * MARGINAL 累进：每档费率只作用于落在该档内的部分。
 *   例：0–100 每单位 10，100–500 每单位 8，500 以上每单位 6，数量 600
 *       → 100×10 + 400×8 + 100×6 = 4,800
 *
 * FLAT 分档：由计费量所在档决定费率，全量按该费率计算。
 *   例：0–45 每公斤 35，45–100 每公斤 30.5，数量 40
 *       → 40×35 = 1,400
 *   勾选"按高一档择低"后（空运重量等级运价规则），再与"高档位最小计费量 × 该档费率"比较取低：
 *       → min(1,400, 45×30.5 = 1,372.5) = 1,372.5
 */
export function computeTieredAmount(item: CostItem, ctx: PricingContext): Decimal {
  const tiers = normalizeTiers(item);
  const quantity = tierQuantity(item, ctx);

  if (isNegative(quantity)) {
    throw new EngineError(
      'PRICING_TIER_INVALID',
      `费用「${item.cost_name}」 的计费量不能为负：${quantity.toString()}`,
      { cost_id: item.cost_id, quantity: quantity.toString() },
    );
  }

  const index = tiers.findIndex((tier) => tier.up_to === null || cmp(quantity, tier.up_to) <= 0);
  if (index < 0) {
    const last = tiers[tiers.length - 1];
    throw new EngineError(
      'PRICING_TIER_NOT_COVERED',
      `费用「${item.cost_name}」 的计费量 ${quantity.toString()} 超出最后一个档位（上界 ${last?.up_to ?? '无'}），请补一个无上界的档位`,
      { cost_id: item.cost_id, quantity: quantity.toString() },
    );
  }

  const containing = tiers[index];
  if (containing === undefined) {
    throw new EngineError('PRICING_TIER_INVALID', `费用「${item.cost_name}」 档位解析失败`, {
      cost_id: item.cost_id,
    });
  }

  if ((item.tier_mode ?? 'MARGINAL') === 'MARGINAL') {
    let total = d(0);
    let lower = d(0);
    for (let i = 0; i <= index; i += 1) {
      const tier = tiers[i];
      if (tier === undefined) break;
      const upper = tier.up_to === null ? quantity : minOf([tier.up_to, quantity]);
      const within = sub(upper, lower);
      if (!isNegative(within)) total = add(total, mul(within, tier.rate));
      if (tier.up_to === null) break;
      lower = d(tier.up_to);
    }
    return total;
  }

  let total = mul(quantity, containing.rate);
  if (item.tier_charge_lower === true) {
    let lower = d(0);
    for (let i = 0; i < tiers.length; i += 1) {
      const tier = tiers[i];
      if (tier === undefined) break;
      if (i > index) {
        // lower 即该档的最小计费量（上一档的上界）
        const candidate = mul(lower, tier.rate);
        if (candidate.lessThan(total)) total = candidate;
      }
      lower = tier.up_to === null ? quantity : d(tier.up_to);
    }
  }
  return total;
}
