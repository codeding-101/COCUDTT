import { describe, expect, it } from 'vitest';
import { sum, toStorage } from '../src/domain/decimal';
import { convertAmount, resolveFxRate } from '../src/engine/fx';
import { normalizeAll, type PricingContext } from '../src/engine/pricing';
import { CIF_108300_SCENARIO, CIF_108300_TRADE, CONTRACT_FX_BOOK } from './fixtures/cif-108300';

const ctx: PricingContext = {
  resolveBase: () => {
    throw new Error('本用例不含基数引用');
  },
};

describe('回归用例：CIF 报价 USD 108,300 = Goods 100,000 + Freight 8,000 + Insurance 300', () => {
  const trade = CIF_108300_TRADE;
  const scenario = CIF_108300_SCENARIO;
  const priced = normalizeAll(trade.items, ctx);

  it('计价结果与报价构成逐项一致', () => {
    const byId = Object.fromEntries(priced.map((p) => [p.cost_id, toStorage(p.gross_amount)]));
    expect(byId).toEqual({
      goods: '100000.000000',
      freight: '8000.000000',
      insurance: '300.000000',
    });
  });

  it('按合同汇率换算到核算币种 CNY，并保留汇率来源', () => {
    const converted = priced.map((p) => {
      const item = trade.items.find((candidate) => candidate.cost_id === p.cost_id);
      if (item === undefined) throw new Error(`费用项缺失: ${p.cost_id}`);
      const res = resolveFxRate({
        from: p.currency,
        to: trade.base_currency,
        fxType: item.fx_type,
        explicitRate: item.fx_rate,
        fxDate: item.fx_date,
        books: [CONTRACT_FX_BOOK],
        designatedBookId: scenario.fx_book_ids?.CONTRACT,
      });
      expect(res.source).toBe('DESIGNATED_BOOK');
      expect(res.rate.toFixed(6)).toBe('7.000000');
      expect(res.fx_type).toBe('CONTRACT');
      return convertAmount(p.gross_amount, res);
    });

    expect(converted.map((amount) => toStorage(amount))).toEqual([
      '700000.000000',
      '56000.000000',
      '2100.000000',
    ]);
    expect(toStorage(sum(converted))).toBe('758100.000000');
  });

  it('报价金额换算后与报价内含费用之和勾稽一致', () => {
    const quote = scenario.quote;
    const quoteRes = resolveFxRate({
      from: quote.currency,
      to: scenario.base_currency,
      fxType: quote.fx_type ?? 'CONTRACT',
      explicitRate: quote.fx_rate,
      fxDate: quote.fx_date,
      books: [CONTRACT_FX_BOOK],
      designatedBookId: scenario.fx_book_ids?.CONTRACT,
    });
    const quoteInBase = convertAmount(quote.amount, quoteRes);

    const includedTotal = sum(
      priced
        .filter((p) => quote.included_cost_ids.includes(p.cost_id))
        .map((p) => convertAmount(p.gross_amount, quoteRes)),
    );

    expect(toStorage(quoteInBase)).toBe('758100.000000');
    expect(toStorage(includedTotal)).toBe(toStorage(quoteInBase));
  });
});
