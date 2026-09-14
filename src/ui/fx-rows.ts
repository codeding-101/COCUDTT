import type { CurrencyCode, DateStr, FxType } from '../domain/enums.js';
import type { FxBook } from '../domain/fx.js';

/**
 * 界面上用扁平的一行表示一条汇率：类型 + 生效日期 + 币种对 + 汇率。
 * 与 FxBook 之间可以无损互转：同一（类型, 日期, 有效期）的多行会合并成一本汇率簿的多个币种对。
 */
export interface FxRow {
  row_id: string;
  type: FxType;
  date: DateStr;
  valid_from?: DateStr;
  valid_to?: DateStr;
  from: CurrencyCode;
  to: CurrencyCode;
  rate: string;
}

export function booksToRows(books: readonly FxBook[]): FxRow[] {
  const rows: FxRow[] = [];
  books.forEach((book) => {
    Object.entries(book.rates).forEach(([pair, rate], index) => {
      const [from, to] = pair.split('/');
      rows.push({
        row_id: `${book.id}-${index}`,
        type: book.type,
        date: book.date,
        ...(book.valid_from !== undefined ? { valid_from: book.valid_from } : {}),
        ...(book.valid_to !== undefined ? { valid_to: book.valid_to } : {}),
        from: from ?? '',
        to: to ?? '',
        rate,
      });
    });
  });
  return rows;
}

export function rowsToBooks(rows: readonly FxRow[]): FxBook[] {
  const grouped = new Map<string, FxBook>();
  for (const row of rows) {
    if (row.from.trim() === '' || row.to.trim() === '' || row.rate.trim() === '') continue;
    const key = `${row.type}|${row.date}|${row.valid_from ?? ''}|${row.valid_to ?? ''}`;
    const book: FxBook =
      grouped.get(key) ?? {
        id: `fx-${key.replace(/[^A-Za-z0-9]/g, '-')}`,
        name: `${row.type} ${row.date}`,
        type: row.type,
        date: row.date,
        ...(row.valid_from !== undefined ? { valid_from: row.valid_from } : {}),
        ...(row.valid_to !== undefined ? { valid_to: row.valid_to } : {}),
        rates: {},
      };
    book.rates[`${row.from}/${row.to}`] = row.rate;
    grouped.set(key, book);
  }
  return [...grouped.values()];
}
