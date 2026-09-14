import type Decimal from 'decimal.js';
import { d, div, isZero, mul, q, toStorage, type Numeric } from '../domain/decimal.js';
import { compareDate } from '../domain/date.js';
import { FX_TYPE_LABELS, type CurrencyCode, type DateStr, type FxType } from '../domain/enums.js';
import { rateKey, type FxBook } from '../domain/fx.js';
import { EngineError } from './errors.js';

export type FxSource =
  /** 原始币种与核算币种相同，无需换算 */
  | 'IDENTITY'
  /** 费用项上的显式汇率 */
  | 'ITEM'
  /** 方案层指定的汇率簿 */
  | 'DESIGNATED_BOOK'
  /** 按汇率类型自动选择的汇率簿 */
  | 'BOOK';

export interface FxResolution {
  rate: Decimal;
  from: CurrencyCode;
  to: CurrencyCode;
  fx_type: FxType;
  fx_date: DateStr | null;
  book_id: string | null;
  source: FxSource;
  /** 是否使用了反向报价（如只有 CNY/USD 而需要 USD/CNY） */
  inverted: boolean;
}

export interface FxResolveInput {
  from: CurrencyCode;
  to: CurrencyCode;
  fxType: FxType;
  /** 费用项级显式汇率，优先级最高（设计文档 5.2 第 1 级） */
  explicitRate?: Numeric;
  fxDate?: DateStr;
  /** 项目中的全部汇率簿；只会使用 type 与 fxType 一致的簿，绝不跨类型替代（设计文档 5.3） */
  books: readonly FxBook[];
  /** 方案层指定的汇率簿 id（设计文档 5.2 第 2 级） */
  designatedBookId?: string;
}

function coversDate(book: FxBook, date: DateStr): boolean {
  if (book.valid_from !== undefined && compareDate(date, book.valid_from) < 0) return false;
  if (book.valid_to !== undefined && compareDate(date, book.valid_to) > 0) return false;
  return book.valid_from !== undefined || book.valid_to !== undefined;
}

/**
 * 选择汇率簿：先看有效期是否覆盖目标日期（海关汇率按月锁定），
 * 否则取生效日期不晚于目标日期的最新一本。
 */
function pickBook(candidates: readonly FxBook[], fxDate?: DateStr): FxBook | undefined {
  // 不用 Array.prototype.at：它是 ES2022 的运行时方法，打包目标为 es2020 时不会被降级转换
  const byLatest = (books: readonly FxBook[]): FxBook | undefined =>
    [...books].sort((a, b) => compareDate(b.date, a.date))[0];

  if (fxDate === undefined) return byLatest(candidates);

  const covering = candidates.filter((book) => coversDate(book, fxDate));
  if (covering.length > 0) return byLatest(covering);

  const notFuture = candidates.filter((book) => compareDate(book.date, fxDate) <= 0);
  return byLatest(notFuture);
}

function lookupPair(book: FxBook, from: CurrencyCode, to: CurrencyCode): { rate: Decimal; inverted: boolean } | undefined {
  // 空字符串视为没填，与"缺这个币种对"同样处理，避免流到 decimal.js 抛库错误
  const blank = (value: string | undefined): boolean => value === undefined || value.trim() === '';

  const direct = book.rates[rateKey(from, to)];
  if (!blank(direct)) {
    const rate = q(direct ?? '0');
    if (isZero(rate)) {
      throw new EngineError('FX_RATE_INVALID', `汇率簿「${book.name}」中 ${rateKey(from, to)} 为 0`, {
        book_id: book.id,
        pair: rateKey(from, to),
      });
    }
    return { rate, inverted: false };
  }

  const reverse = book.rates[rateKey(to, from)];
  if (!blank(reverse)) {
    const reversed = q(reverse ?? '0');
    if (isZero(reversed)) {
      throw new EngineError('FX_RATE_INVALID', `汇率簿「${book.name}」中 ${rateKey(to, from)} 为 0`, {
        book_id: book.id,
        pair: rateKey(to, from),
      });
    }
    // 反向报价求倒数是确定性的推导，不是跨类型回退
    return { rate: div(1, reversed), inverted: true };
  }

  return undefined;
}

function fxMissing(message: string, detail: Record<string, unknown>): never {
  throw new EngineError('FX_MISSING', message, detail);
}

/**
 * 汇率解析（设计文档 5.2），逐级且不隐式回退：
 * 1 费用项显式汇率 → 2 方案指定的汇率簿 → 3 按汇率类型自动选择的汇率簿 → 4 报错。
 */
export function resolveFxRate(input: FxResolveInput): FxResolution {
  const { from, to, fxType } = input;
  const label = FX_TYPE_LABELS[fxType];

  if (from === to) {
    return {
      rate: d(1),
      from,
      to,
      fx_type: fxType,
      fx_date: input.fxDate ?? null,
      book_id: null,
      source: 'IDENTITY',
      inverted: false,
    };
  }

  if (input.explicitRate !== undefined && input.explicitRate !== null) {
    const rate = q(input.explicitRate);
    if (isZero(rate) || rate.isNegative()) {
      throw new EngineError('FX_RATE_INVALID', `${from}/${to} 的显式汇率必须为正数，当前为 ${toStorage(rate)}`, {
        from,
        to,
        rate: toStorage(rate),
      });
    }
    return {
      rate,
      from,
      to,
      fx_type: fxType,
      fx_date: input.fxDate ?? null,
      book_id: null,
      source: 'ITEM',
      inverted: false,
    };
  }

  const candidates = input.books.filter((book) => book.type === fxType);
  if (candidates.length === 0) {
    fxMissing(`缺少「${label}」类型的汇率簿，无法把 ${from} 换算为 ${to}`, { from, to, fx_type: fxType });
  }

  let book: FxBook | undefined;
  let source: FxSource = 'BOOK';

  if (input.designatedBookId !== undefined && input.designatedBookId !== null) {
    book = candidates.find((candidate) => candidate.id === input.designatedBookId);
    if (book === undefined) {
      fxMissing(`方案指定的汇率簿不存在或汇率类型不符: ${input.designatedBookId}`, {
        from,
        to,
        fx_type: fxType,
        book_id: input.designatedBookId,
      });
    }
    source = 'DESIGNATED_BOOK';
  } else {
    book = pickBook(candidates, input.fxDate);
    if (book === undefined) {
      fxMissing(`「${label}」汇率簿中没有适用于 ${input.fxDate ?? '当前'} 的汇率`, {
        from,
        to,
        fx_type: fxType,
        fx_date: input.fxDate ?? null,
      });
    }
  }

  const pair = lookupPair(book, from, to);
  if (pair === undefined) {
    fxMissing(`汇率簿「${book.name}」中缺少 ${from}/${to} 汇率`, {
      from,
      to,
      book_id: book.id,
      fx_type: fxType,
    });
  }

  return {
    rate: pair.rate,
    from,
    to,
    fx_type: fxType,
    fx_date: input.fxDate ?? book.date,
    book_id: book.id,
    source,
    inverted: pair.inverted,
  };
}

/** 换算：base_amount = original_amount × fx_rate（设计文档 1.4） */
export function convertAmount(amount: Numeric, resolution: FxResolution): Decimal {
  return mul(amount, resolution.rate);
}
