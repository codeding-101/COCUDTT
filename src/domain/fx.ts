import type { FxType, CurrencyCode } from './enums.js';
import type { Numeric } from './decimal.js';

/**
 * 一张汇率表。rates 的键为 "FROM/TO"，值为「1 单位 FROM = ? 单位 TO」。
 * 落盘使用字符串，保证汇率精度不丢。
 */
export interface FxBook {
  id: string;
  name: string;
  type: FxType;
  /** 汇率生效日期 */
  date: string;
  /** 海关汇率按月锁定（设计文档 5.1） */
  valid_from?: string;
  valid_to?: string;
  rates: Record<string, string>;
}

export function rateKey(from: CurrencyCode, to: CurrencyCode): string {
  return `${from}/${to}`;
}

export function rateValue(book: FxBook, from: CurrencyCode, to: CurrencyCode): Numeric | undefined {
  return book.rates[rateKey(from, to)];
}
