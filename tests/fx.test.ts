import { describe, expect, it } from 'vitest';
import { toStorage } from '../src/domain/decimal';
import type { FxBook } from '../src/domain/fx';
import { convertAmount, resolveFxRate } from '../src/engine/fx';
import { EngineError } from '../src/engine/errors';

const contractBook: FxBook = {
  id: 'contract-1',
  name: '合同汇率',
  type: 'CONTRACT',
  date: '2026-08-15',
  rates: { 'USD/CNY': '7.0000' },
};
const marketOld: FxBook = {
  id: 'market-08',
  name: '市场汇率 8月',
  type: 'MARKET',
  date: '2026-08-14',
  rates: { 'USD/CNY': '7.1000' },
};
const marketNew: FxBook = {
  id: 'market-09',
  name: '市场汇率 9月',
  type: 'MARKET',
  date: '2026-09-14',
  rates: { 'USD/CNY': '7.0512' },
};
const customsAug: FxBook = {
  id: 'customs-08',
  name: '海关汇率 8月',
  type: 'CUSTOMS',
  date: '2026-08-20',
  valid_from: '2026-08-01',
  valid_to: '2026-08-31',
  rates: { 'USD/CNY': '7.0800' },
};
const customsSep: FxBook = {
  id: 'customs-09',
  name: '海关汇率 9月',
  type: 'CUSTOMS',
  date: '2026-09-17',
  valid_from: '2026-09-01',
  valid_to: '2026-09-30',
  rates: { 'USD/CNY': '7.0600' },
};
const reverseOnly: FxBook = {
  id: 'market-reverse',
  name: '只有反向报价',
  type: 'MARKET',
  date: '2026-09-14',
  rates: { 'CNY/USD': '0.14' },
};

function expectEngineError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).code).toBe(code);
    return;
  }
  throw new Error(`预期抛出 ${code}，但没有抛出任何错误`);
}

describe('FX Engine 汇率解析', () => {
  it('原始币种与核算币种相同时无需汇率簿', () => {
    const res = resolveFxRate({ from: 'CNY', to: 'CNY', fxType: 'MARKET', books: [] });
    expect(res.source).toBe('IDENTITY');
    expect(toStorage(res.rate)).toBe('1.000000');
  });

  it('费用项显式汇率优先级最高', () => {
    const res = resolveFxRate({
      from: 'USD',
      to: 'CNY',
      fxType: 'MARKET',
      explicitRate: '6.9',
      books: [marketNew],
    });
    expect(res.source).toBe('ITEM');
    expect(toStorage(res.rate)).toBe('6.900000');
  });

  it('方案指定的汇率簿优先于自动选择', () => {
    const res = resolveFxRate({
      from: 'USD',
      to: 'CNY',
      fxType: 'MARKET',
      books: [marketOld, marketNew],
      designatedBookId: 'market-08',
    });
    expect(res.source).toBe('DESIGNATED_BOOK');
    expect(res.book_id).toBe('market-08');
    expect(toStorage(res.rate)).toBe('7.100000');
  });

  it('自动选择不晚于目标日期的最新汇率簿', () => {
    const res = resolveFxRate({
      from: 'USD',
      to: 'CNY',
      fxType: 'MARKET',
      fxDate: '2026-08-20',
      books: [marketOld, marketNew],
    });
    expect(res.book_id).toBe('market-08');
    expect(res.source).toBe('BOOK');
  });

  it('目标日期之前没有可用汇率时无法换算，不套用未来汇率', () => {
    expectEngineError(
      () =>
        resolveFxRate({
          from: 'USD',
          to: 'CNY',
          fxType: 'MARKET',
          fxDate: '2026-08-01',
          books: [marketNew],
        }),
      'FX_MISSING',
    );
  });

  it('海关汇率按月锁定', () => {
    const august = resolveFxRate({
      from: 'USD',
      to: 'CNY',
      fxType: 'CUSTOMS',
      fxDate: '2026-08-25',
      books: [customsAug, customsSep],
    });
    expect(august.book_id).toBe('customs-08');

    const september = resolveFxRate({
      from: 'USD',
      to: 'CNY',
      fxType: 'CUSTOMS',
      fxDate: '2026-09-10',
      books: [customsAug, customsSep],
    });
    expect(september.book_id).toBe('customs-09');
  });

  it('只有反向报价时求倒数，并标记 inverted', () => {
    const res = resolveFxRate({ from: 'USD', to: 'CNY', fxType: 'MARKET', books: [reverseOnly] });
    expect(res.inverted).toBe(true);
    expect(toStorage(res.rate)).toBe('7.142857');
  });

  it('商业汇率、合同汇率、海关汇率互不替代', () => {
    expectEngineError(
      () => resolveFxRate({ from: 'USD', to: 'CNY', fxType: 'MARKET', books: [contractBook] }),
      'FX_MISSING',
    );
    expectEngineError(
      () => resolveFxRate({ from: 'USD', to: 'CNY', fxType: 'CUSTOMS', books: [contractBook, marketNew] }),
      'FX_MISSING',
    );
  });

  it('汇率簿存在但缺少币种对时报错', () => {
    expectEngineError(
      () => resolveFxRate({ from: 'EUR', to: 'CNY', fxType: 'CONTRACT', books: [contractBook] }),
      'FX_MISSING',
    );
  });

  it('显式汇率必须为正数', () => {
    expectEngineError(
      () => resolveFxRate({ from: 'USD', to: 'CNY', fxType: 'MARKET', explicitRate: '0', books: [] }),
      'FX_RATE_INVALID',
    );
    expectEngineError(
      () => resolveFxRate({ from: 'USD', to: 'CNY', fxType: 'MARKET', explicitRate: '-7', books: [] }),
      'FX_RATE_INVALID',
    );
  });

  it('方案指定的汇率簿不存在或类型不符时报错', () => {
    expectEngineError(
      () =>
        resolveFxRate({
          from: 'USD',
          to: 'CNY',
          fxType: 'MARKET',
          books: [marketNew, contractBook],
          designatedBookId: 'contract-1',
        }),
      'FX_MISSING',
    );
  });

  it('换算：base_amount = 原币金额 × 汇率', () => {
    const res = resolveFxRate({ from: 'USD', to: 'CNY', fxType: 'CONTRACT', books: [contractBook] });
    expect(toStorage(convertAmount('100000', res))).toBe('700000.000000');
    expect(toStorage(convertAmount('300', res))).toBe('2100.000000');
  });
});
