import Decimal from 'decimal.js';

// 全局精度设得足够宽，真正的精度控制由本模块的 q() 负责，
// 避免 decimal.js 自身的有效位数截断影响中间结果。
Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
});

/** 中间计算保留的小数位（设计文档 1.4） */
export const SCALE = 6;

/** 展示保留的小数位（设计文档 1.4） */
export const DISPLAY_SCALE = 2;

/** 金额、汇率、比率的统一输入类型 */
export type Numeric = string | number | Decimal;

export function d(value: Numeric): Decimal {
  if (value instanceof Decimal) return value;
  /*
   * 空字符串不是"0"，也不是合法的十进制。用户清空一个输入框时拿到的是 ''，
   * 若直接交给 decimal.js 会抛出 [DecimalError] Invalid argument 这种库错误，
   * 既没告诉用户该填什么，还会被界面报成"未知错误"。
   * 这里明确拒绝，上层再用字段级校验给出"缺少「单价」"这类可读说明。
   */
  if (typeof value === 'string' && value.trim() === '') {
    throw new Error('数值不能为空');
  }
  return new Decimal(value);
}

/**
 * 统一舍入到 SCALE 位小数（ROUND_HALF_UP）。
 * 所有中间结果必须经过它，保证「中间计算保留 6 位小数」这一不变量。
 */
export function q(value: Numeric): Decimal {
  return d(value).toDecimalPlaces(SCALE, Decimal.ROUND_HALF_UP);
}

export function add(a: Numeric, b: Numeric): Decimal {
  return q(d(a).plus(d(b)));
}

export function sub(a: Numeric, b: Numeric): Decimal {
  return q(d(a).minus(d(b)));
}

export function mul(a: Numeric, b: Numeric): Decimal {
  return q(d(a).times(d(b)));
}

export function div(a: Numeric, b: Numeric): Decimal {
  const divisor = d(b);
  if (divisor.isZero()) {
    throw new Error('DivisionByZero');
  }
  return q(d(a).dividedBy(divisor));
}

export function neg(a: Numeric): Decimal {
  return q(d(a).negated());
}

export function abs(a: Numeric): Decimal {
  return q(d(a).abs());
}

export function sum(values: readonly Numeric[]): Decimal {
  let acc = new Decimal(0);
  for (const value of values) {
    acc = acc.plus(d(value));
  }
  return q(acc);
}

/** -1 / 0 / 1 */
export function cmp(a: Numeric, b: Numeric): -1 | 0 | 1 {
  const result = d(a).comparedTo(d(b));
  if (result < 0) return -1;
  if (result > 0) return 1;
  return 0;
}

export function isZero(a: Numeric): boolean {
  return d(a).isZero();
}

export function isNegative(a: Numeric): boolean {
  return d(a).isNegative();
}

export function maxOf(values: readonly Numeric[]): Decimal {
  if (values.length === 0) throw new Error('maxOf: empty');
  return q(Decimal.max(...values.map((v) => d(v))));
}

export function minOf(values: readonly Numeric[]): Decimal {
  if (values.length === 0) throw new Error('minOf: empty');
  return q(Decimal.min(...values.map((v) => d(v))));
}

/** 序列化：固定 SCALE 位小数的字符串，保证项目文件可读且无浮点误差 */
export function toStorage(value: Numeric): string {
  return q(value).toFixed(SCALE);
}

/** 展示：默认 2 位小数 */
export function toDisplay(value: Numeric, scale: number = DISPLAY_SCALE): string {
  return q(value).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toFixed(scale);
}
