import { describe, expect, it } from 'vitest';
import { toStorage } from '../src/domain/decimal';
import type { Scenario } from '../src/domain/scenario';
import { analyze } from '../src/engine/analyze';
import { CIF_108300_SCENARIO, CIF_108300_TRADE, CONTRACT_FX_BOOK, CUSTOMS_FX_BOOK, TEST_TAX_PROFILE } from './fixtures/cif-108300';

const INPUT = {
  trade: CIF_108300_TRADE,
  taxProfile: TEST_TAX_PROFILE,
  fxBooks: [CONTRACT_FX_BOOK, CUSTOMS_FX_BOOK],
};

const DDP_SCENARIO: Scenario = {
  ...CIF_108300_SCENARIO,
  id: 'scenario-ddp-108300',
  incoterm: 'DDP',
  quote: { ...CIF_108300_SCENARIO.quote, incoterm: 'DDP' },
};

describe('端到端：CIF 报价 USD 108,300', () => {
  const result = analyze({ ...INPUT, scenario: CIF_108300_SCENARIO });

  it('完税价格按海关汇率折算，与商业汇率口径不同', () => {
    // (100,000 + 8,000 + 300) × 7.08
    expect(toStorage(result.dutiable_value.value)).toBe('766764.000000');
  });

  it('关税与增值税按递进基数计算', () => {
    expect(toStorage(result.import_tax.duty)).toBe('38338.200000');
    expect(toStorage(result.import_tax.vat)).toBe('104663.286000');
  });

  it('运费与保险费不进入买方额外成本', () => {
    const buyerCategories = result.items
      .filter((enriched) => enriched.counts_to_buyer)
      .map((enriched) => enriched.item.cost_category);
    expect(buyerCategories).not.toContain('MAIN_CARRIAGE');
    expect(buyerCategories).not.toContain('INSURANCE');
    expect(buyerCategories).toEqual(['IMPORT_DUTIES', 'IMPORT_DUTIES', 'IMPORT_DUTIES']);
  });

  it('买方额外成本只含进口税费，落地成本给出双口径', () => {
    expect(toStorage(result.buyer.additional_cost_total)).toBe('143001.486000');
    expect(toStorage(result.buyer.landed_cost_with_tax)).toBe('901101.486000');
    // 增值税一般纳税人可抵扣，不含可抵扣税的口径要扣掉
    expect(toStorage(result.buyer.landed_cost_ex_deductible)).toBe('796438.200000');
  });

  it('卖方成本不含货值，货值由采购成本代表', () => {
    const goodsValue = result.items.find((enriched) => enriched.item.cost_id === 'goods');
    expect(goodsValue?.exclusion).toBe('GOODS_VALUE');
    expect(goodsValue?.counts_to_seller).toBe(false);
    // 运费 56,000 + 保险费 2,100
    expect(toStorage(result.seller.cost_total)).toBe('58100.000000');
    expect(toStorage(result.seller.goods_cost)).toBe('620000.000000');
  });

  it('利润区分含退税与不含退税两个口径', () => {
    // 758,100 − 58,100 − 620,000 = 80,000
    expect(toStorage(result.seller.margin_ex_rebate)).toBe('80000.000000');
    // 80,000 + 退税 71,327.433628
    expect(toStorage(result.seller.rebate_total)).toBe('71327.433628');
    expect(toStorage(result.seller.margin)).toBe('151327.433628');
  });

  it('风险与费用分离标记正确', () => {
    expect(result.risk.transfer_point).toContain('装上船');
    expect(result.risk.separation).toBe(true);
    expect(result.risk.separation_note).toContain('风险与费用在此分离');
  });

  it('每笔费用的责任都能回溯到规则依据', () => {
    for (const enriched of result.items) {
      expect(enriched.rule_id).not.toBeNull();
      expect(enriched.note.length).toBeGreaterThan(0);
    }
    const freight = result.items.find((enriched) => enriched.item.cost_id === 'freight');
    expect(freight?.rule_id).toBe('CIF.MAIN_CARRIAGE');
  });
});

describe('同一报价换用 DDP 术语：进口税费改由卖方承担', () => {
  const result = analyze({ ...INPUT, scenario: DDP_SCENARIO });

  it('关税与增值税计入卖方成本，买方额外成本为 0', () => {
    expect(toStorage(result.buyer.additional_cost_total)).toBe('0.000000');
    expect(toStorage(result.buyer.landed_cost_with_tax)).toBe('758100.000000');
    // 运费 56,000 + 保险费 2,100 + 关税 38,338.2 + 增值税 104,663.286
    expect(toStorage(result.seller.cost_total)).toBe('201101.486000');
  });

  it('买方口径下的税费为 0——他不承担这些税，界面不能显示他付过', () => {
    expect(toStorage(result.buyer.duty_total)).toBe('0.000000');
    expect(toStorage(result.buyer.consumption_tax_total)).toBe('0.000000');
    expect(toStorage(result.buyer.vat_total)).toBe('0.000000');
    expect(toStorage(result.buyer.deductible_vat)).toBe('0.000000');
  });

  it('买方卡片各项能加成落地成本，且没有可抵扣项时两个口径相同', () => {
    // 报价金额 + 报价外费用（0） = 落地成本
    expect(toStorage(result.buyer.additional_cost_total.minus(result.buyer.duty_total).minus(result.buyer.vat_total))).toBe(
      '0.000000',
    );
    // DDP 下买方没有可抵扣增值税，两个口径必须相等（此前会凭空少掉一笔税）
    expect(toStorage(result.buyer.landed_cost_ex_deductible)).toBe(toStorage(result.buyer.landed_cost_with_tax));
  });

  it('DDP 下的买家税费总额仍计入卖方成本，没有被丢弃', () => {
    // 卖方成本里含关税与增值税
    expect(toStorage(result.seller.cost_by_category.IMPORT_DUTIES ?? '0')).toBe('143001.486000');
  });

  it('同一报价下 DDP 的利润远低于 CIF，说明跨术语比较必须固定基准', () => {
    expect(toStorage(result.seller.margin)).toBe('8325.947628');
    expect(result.seller.margin.toNumber()).toBeLessThan(
      analyze({ ...INPUT, scenario: CIF_108300_SCENARIO }).seller.margin.toNumber(),
    );
  });
});
