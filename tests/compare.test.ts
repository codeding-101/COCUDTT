import { describe, expect, it } from 'vitest';
import { d, toStorage } from '../src/domain/decimal';
import type { ComparisonAnchor, Scenario } from '../src/domain/scenario';
import { compare, conditionalSensitivity, scenarioForTerm } from '../src/engine/compare';
import { EngineError } from '../src/engine/errors';
import { INCOTERMS_2020_RULESET } from '../src/engine/responsibility/rules-incoterms2020';
import {
  CIF_108300_SCENARIO,
  CIF_108300_TRADE,
  CONTRACT_FX_BOOK,
  CUSTOMS_FX_BOOK,
  TEST_TAX_PROFILE,
} from './fixtures/cif-108300';
import { makeCostItem, makeScenario, makeTrade } from './helpers/factory';

const BASE_INPUT = {
  trade: CIF_108300_TRADE,
  template: CIF_108300_SCENARIO,
  taxProfile: TEST_TAX_PROFILE,
  fxBooks: [CONTRACT_FX_BOOK, CUSTOMS_FX_BOOK],
};

function columnFor(result: ReturnType<typeof compare>, incoterm: string) {
  const column = result.columns.find((candidate) => candidate.incoterm === incoterm);
  if (column === undefined) throw new Error(`缺少术语列: ${incoterm}`);
  return column;
}

describe('11 术语横向对比', () => {
  describe('固定报价基准', () => {
    const result = compare(BASE_INPUT);

    it('海运下 11 个术语全部可用', () => {
      expect(result.columns).toHaveLength(11);
      expect(result.columns.every((column) => column.available)).toBe(true);
    });

    it('各术语使用同一报价金额', () => {
      for (const column of result.columns) {
        expect(toStorage(column.quote_amount)).toBe('758100.000000');
      }
    });

    it('进口税费总额与术语无关——术语改变的只是承担方', () => {
      const totals = new Set(result.columns.map((column) => toStorage(column.import_tax_total)));
      expect(totals.size).toBe(1);
      expect([...totals][0]).toBe('143001.486000');
    });

    it('EXW：卖方不承担任何费用项，买方承担运费保险与税费', () => {
      const exw = columnFor(result, 'EXW');
      expect(toStorage(exw.seller.cost_total)).toBe('0.000000');
      // 运费 56,000 + 保险费 2,100 + 税费 143,001.486
      expect(toStorage(exw.buyer.additional_cost_total)).toBe('201101.486000');
      expect(toStorage(exw.buyer.landed_cost_with_tax)).toBe('959201.486000');
      // 货值由采购成本代表，卖方名下没有费用项
      expect(exw.seller_cost_nodes).toBe(0);
    });

    it('CIF：卖方承担运费与保险费，买方只承担税费', () => {
      const cif = columnFor(result, 'CIF');
      expect(toStorage(cif.seller.cost_total)).toBe('58100.000000');
      expect(toStorage(cif.buyer.additional_cost_total)).toBe('143001.486000');
      expect(toStorage(cif.seller.margin)).toBe('151327.433628');
    });

    it('DDP：税费也转到卖方，买方额外成本为 0', () => {
      const ddp = columnFor(result, 'DDP');
      expect(toStorage(ddp.seller.cost_total)).toBe('201101.486000');
      expect(toStorage(ddp.buyer.additional_cost_total)).toBe('0.000000');
      expect(toStorage(ddp.seller.margin)).toBe('8325.947628');
      expect(ddp.seller_cost_nodes).toBeGreaterThan(columnFor(result, 'CIF').seller_cost_nodes);
    });

    it('同一报价下卖方义务越重利润越低', () => {
      const margin = (incoterm: string) => columnFor(result, incoterm).seller.margin;
      // 本用例只有货值、运费、保险费三项，装船前费用为 0，
      // 因此 EXW / FCA / FAS / FOB 承担的费用相同，利润也相同
      expect(toStorage(margin('EXW'))).toBe(toStorage(margin('FOB')));
      expect(margin('FOB').greaterThan(margin('CIF'))).toBe(true);
      expect(margin('CIF').greaterThan(margin('DDP'))).toBe(true);
      expect(result.best_seller_margin).toBe('EXW');
    });

    it('风险转移点与分离标记随术语变化', () => {
      expect(columnFor(result, 'CIF').risk_separation).toBe(true);
      expect(columnFor(result, 'CIF').transfer_point).toContain('装上船');
      expect(columnFor(result, 'DDP').risk_separation).toBe(false);
      expect(columnFor(result, 'DDP').transfer_point).toContain('目的地');
    });
  });

  describe('固定买方总支付基准', () => {
    const anchor: ComparisonAnchor = { kind: 'FIXED_MARKET_PRICE', buyer_total: '901101.486', currency: 'CNY' };
    const result = compare({ ...BASE_INPUT, anchor });

    it('所有术语的买方总支付被拉到同一水平', () => {
      for (const column of result.columns) {
        expect(toStorage(column.buyer.landed_cost_with_tax)).toBe('901101.486000');
      }
    });

    it('CIF 反解出的报价与固定报价基准下一致', () => {
      expect(toStorage(columnFor(result, 'CIF').quote_amount)).toBe('758100.000000');
    });

    it('DDP 因承担税费，报价必须抬到买方总支付本身', () => {
      expect(toStorage(columnFor(result, 'DDP').quote_amount)).toBe('901101.486000');
    });

    it('各术语报价差异很大：EXW 最低，DDP 最高', () => {
      expect(toStorage(columnFor(result, 'EXW').quote_amount)).toBe('700000.000000');
      expect(toStorage(columnFor(result, 'DDP').quote_amount)).toBe('901101.486000');
    });

    it('报价已按各自成本结构调整，因此各术语利润趋于一致', () => {
      // 买方总支付固定、每笔费用的金额不因由谁承担而变时，
      // 卖方净得 = 买方总支付 − 全部费用 − 采购成本，与术语无关。
      // 术语在此基准下改变的是报价金额、承担范围与风险，而不是总利润。
      const margins = new Set(result.columns.map((column) => toStorage(column.seller.margin)));
      expect(margins.size).toBe(1);
      const quotes = new Set(result.columns.map((column) => toStorage(column.quote_amount)));
      expect(quotes.size).toBeGreaterThan(2);
    });

    it('承担范围与风险仍随术语变化', () => {
      expect(columnFor(result, 'EXW').seller_cost_nodes).toBeLessThan(columnFor(result, 'DDP').seller_cost_nodes);
      expect(columnFor(result, 'DDP').risk_separation).toBe(false);
      expect(columnFor(result, 'CIF').risk_separation).toBe(true);
    });

    it('迭代在少数几轮内收敛', () => {
      for (const column of result.columns) {
        expect(column.iterations).toBeLessThanOrEqual(3);
      }
    });
  });

  describe('生产企业路径下的退税基数差异', () => {
    const manufacturerProfile = {
      ...TEST_TAX_PROFILE,
      export: {
        ...TEST_TAX_PROFILE.export,
        rebate: { ...TEST_TAX_PROFILE.export.rebate, entityType: 'MANUFACTURER' as const },
      },
    };

    it('固定报价基准下，退税基数（离岸价）随术语变化', () => {
      const result = compare({ ...BASE_INPUT, taxProfile: manufacturerProfile });
      const rebateOf = (incoterm: string) => {
        const column = columnFor(result, incoterm);
        if (column.result === null) throw new Error('列不可行');
        return column.result.rebate.rebate_total;
      };
      // CIF 报价中扣掉运费保险费后离岸价为 700,000，退税率 13% → 91,000
      expect(toStorage(rebateOf('CIF'))).toBe('91000.000000');
      // EXW 报价中不含运费保险费，离岸价即 758,100 → 98,553
      expect(toStorage(rebateOf('EXW'))).toBe('98553.000000');
    });
  });

  describe('固定目标利润率基准', () => {
    const result = compare({ ...BASE_INPUT, anchor: { kind: 'FIXED_MARGIN_RATE', margin_rate: '0.2' } });

    it('各术语的毛利率都被拉到目标值', () => {
      for (const column of result.columns) {
        const rate = column.seller.margin_ex_rebate.dividedBy(column.seller.revenue).toDecimalPlaces(4);
        expect(rate.toFixed(4)).toBe('0.2000');
      }
    });

    it('承担更多义务的术语需要报出更高的价格', () => {
      expect(columnFor(result, 'EXW').quote_amount.lessThan(columnFor(result, 'CIF').quote_amount)).toBe(true);
      expect(columnFor(result, 'CIF').quote_amount.lessThan(columnFor(result, 'DDP').quote_amount)).toBe(true);
    });

    it('目标利润率超出 (0, 1) 时报错', () => {
      expect(() => compare({ ...BASE_INPUT, anchor: { kind: 'FIXED_MARGIN_RATE', margin_rate: '1.5' } })).toThrowError(
        EngineError,
      );
    });
  });

  describe('运输方式限制', () => {
    it('空运下只有 7 个术语可用，海运专属术语被标记为不可用', () => {
      const trade = { ...CIF_108300_TRADE, carriage_mode: 'AIR' as const };
      const result = compare({ ...BASE_INPUT, trade });
      const available = result.columns.filter((column) => column.available).map((column) => column.incoterm);
      const unavailable = result.columns.filter((column) => !column.available).map((column) => column.incoterm);
      expect(available).toEqual(['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP']);
      expect(unavailable).toEqual(['FAS', 'FOB', 'CFR', 'CIF']);
      expect(columnFor(result, 'FOB').unavailable_reason).toContain('仅适用海运及内河运输');
    });
  });
});

describe('按术语生成方案的报价内含清单', () => {
  it('报价覆盖的正是卖方在该术语下承担的费用', () => {
    const exw = scenarioForTerm(CIF_108300_SCENARIO, CIF_108300_TRADE, 'EXW', d('758100'), INCOTERMS_2020_RULESET);
    expect([...exw.quote.included_cost_ids].sort()).toEqual(['goods']);

    const cif = scenarioForTerm(CIF_108300_SCENARIO, CIF_108300_TRADE, 'CIF', d('758100'), INCOTERMS_2020_RULESET);
    expect([...cif.quote.included_cost_ids].sort()).toEqual(['freight', 'goods', 'insurance']);
  });
});

describe('CONDITIONAL 费用的敏感度分析', () => {
  const trade = makeTrade({
    items: [
      makeCostItem({
        cost_id: 'goods',
        cost_category: 'GOODS_AND_PACKING',
        trade_node: 'SELLER_PREMISES',
        amount: '6666',
        is_goods_value: true,
      }),
      makeCostItem({
        cost_id: 'loading',
        cost_name: '装船费',
        cost_category: 'ORIGIN_TERMINAL',
        trade_node: 'CARRIER_HANDOVER',
        amount: '1000',
      }),
    ],
    goods: {
      name: '测试商品',
      quantity: '1',
      unit: 'PCS',
      trade_value: { amount: '6666', currency: 'CNY' },
      seller_goods_cost: { amount: '5000', currency: 'CNY' },
    },
  });
  const scenario: Scenario = makeScenario({
    incoterm: 'FCA',
    base_currency: 'CNY',
    quote: { amount: '6666', currency: 'CNY', incoterm: 'FCA', included_cost_ids: [] },
  });

  it('交货地点未填时装船费判定为 CONDITIONAL', () => {
    const result = compare({ ...BASE_INPUT, trade, template: scenario, incoterms: ['FCA'], fxBooks: [] });
    expect(columnFor(result, 'FCA').conditional_count).toBeGreaterThan(0);
  });

  it('给出归属变化对买卖双方的影响金额', () => {
    const sensitivity = conditionalSensitivity({ ...BASE_INPUT, trade, template: scenario, fxBooks: [] }, scenario);
    expect(sensitivity).toHaveLength(1);
    const item = sensitivity[0];
    if (item === undefined) throw new Error('缺少敏感度结果');
    expect(item.cost_id).toBe('loading');
    expect(toStorage(item.seller_margin_delta)).toBe('1000.000000');
    expect(toStorage(item.buyer_landed_delta)).toBe('1000.000000');
  });
});
