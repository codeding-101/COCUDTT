import { describe, expect, it } from 'vitest';
import { toDisplay, toStorage } from '../src/domain/decimal';
import type { Scenario } from '../src/domain/scenario';
import { analyze } from '../src/engine/analyze';
import { compare, scenarioWithDerivedInclusions } from '../src/engine/compare';
import { INCOTERMS_2020_RULESET } from '../src/engine/responsibility/rules-incoterms2020';
import { resolveResponsibility } from '../src/engine/responsibility/resolver';
import {
  VIRTUAL_FX_BOOKS,
  VIRTUAL_SCENARIO,
  VIRTUAL_TAX_PROFILE,
  VIRTUAL_TRADE,
} from './fixtures/virtual-trade';

/**
 * 虚拟数值测试：用一笔构造的交易（1,200 台小家电出口汉堡）跑通全链路，
 * 逐环节核对数字，并把结果打印出来人工复核。
 *
 * 这里断言的都是可独立验算的算式，不是"引擎自己算出来的值"——
 * 否则测试只能证明代码没变，证明不了算得对。
 *
 * 注意：单方案分析必须先按术语推导报价内含清单（`scenarioWithDerivedInclusions`），
 * 这与界面里的流程一致。不推导的话 `included_cost_ids` 为空，报价勾稽校验会被跳过、
 * 还原出的离岸价也会偏大——这正是本次测试第一版踩到的坑。
 */

const INPUT = {
  trade: VIRTUAL_TRADE,
  taxProfile: VIRTUAL_TAX_PROFILE,
  fxBooks: VIRTUAL_FX_BOOKS,
};

const SCENARIO = scenarioWithDerivedInclusions(VIRTUAL_SCENARIO, VIRTUAL_TRADE);
const result = analyze({ ...INPUT, scenario: SCENARIO });

/** 合同 7.10 / 市场 7.12 / 海关 7.08 */
const CUSTOMS_RATE = 7.08;
const CONTRACT_RATE = 7.1;

function findItem(costId: string) {
  const found = result.items.find((enriched) => enriched.item.cost_id === costId);
  if (found === undefined) throw new Error(`缺少费用项: ${costId}`);
  return found;
}

describe('虚拟数值测试 · 逐环节核对', () => {
  it('计算全程无错误级告警', () => {
    const errors = result.warnings.filter((warning) => warning.level === 'ERROR');
    expect(errors).toEqual([]);
  });

  it('按术语推导内含清单后，不出现"报价未声明内含清单"的退化提示', () => {
    expect(result.warnings.map((warning) => warning.code)).not.toContain('QUOTE_INCLUSION_UNSPECIFIED');
  });

  it('不推导内含清单时引擎会明说校验已退化，而不是静默跳过', () => {
    const withoutInclusions = analyze({ ...INPUT, scenario: VIRTUAL_SCENARIO });
    expect(withoutInclusions.warnings.map((warning) => warning.code)).toContain('QUOTE_INCLUSION_UNSPECIFIED');
    // 退化的后果：还原的离岸价偏大（少扣了已含在报价里的运保费）
    expect(toStorage(withoutInclusions.rebate.fob_value)).not.toBe(toStorage(result.rebate.fob_value));
  });

  it('报价与内含费用勾稽一致，不产生提示', () => {
    // 106,800 USD × 7.10 = 758,280
    expect(toStorage(result.seller.revenue)).toBe('758280.000000');
    expect(result.warnings.map((warning) => warning.code)).not.toContain('QUOTE_NOT_RECONCILED');
  });

  it('完税价格按海关汇率折算，与商业汇率口径不同', () => {
    // (96,000 + 8,200 + 600) × 7.08 = 741,984（若误用合同汇率 7.10 会得到 744,080）
    expect(toStorage(result.dutiable_value.value)).toBe('741984.000000');
    expect(toStorage(result.dutiable_value.value)).not.toBe(
      toStorage(result.dutiable_value.value.dividedBy(CUSTOMS_RATE).times(CONTRACT_RATE)),
    );
  });

  it('关税与增值税按递进基数计算', () => {
    // 关税 = 741,984 × 3.7% = 27,453.408
    expect(toStorage(result.import_tax.duty)).toBe('27453.408000');
    // 增值税 = (741,984 + 27,453.408) × 13% = 100,026.863040
    expect(toStorage(result.import_tax.vat)).toBe('100026.863040');
    // 合计 127,480.271040
    expect(toStorage(result.import_tax.duty.plus(result.import_tax.vat))).toBe('127480.271040');
  });

  it('CIF 下卖方承担的成本等于国内费用加运费保险', () => {
    // 国内：3,600 + 4,800 + 800 + 1,200 + 900 + 500 + 2,400 = 14,200
    // 运保：(8,200 + 600) × 7.10 = 62,480
    expect(toStorage(result.seller.cost_total)).toBe('76680.000000');
    expect(toStorage(findItem('goods').base_amount)).toBe('681600.000000');
    expect(findItem('goods').counts_to_seller).toBe(false);
  });

  it('出口退税按采购发票不含税金额计算', () => {
    // 520,000 ÷ 1.13 × 13% = 59,823.008850
    expect(toStorage(result.seller.rebate_total)).toBe('59823.008850');
  });

  it('还原离岸价：CIF 报价扣掉运保费后 = 货值 + 国内费用', () => {
    // 758,280 − 62,480 = 695,800 = 681,600（货值）+ 14,200（国内费用）
    // 国内费用发生在装船前，属于离岸价的组成部分，因此应留在基数里
    expect(toStorage(result.rebate.fob_value)).toBe('695800.000000');
    expect(toStorage(result.rebate.fob_value)).toBe(
      toStorage(findItem('goods').base_amount.plus(findItem('inland').base_amount).plus(findItem('packing').base_amount).plus(findItem('export-broker').base_amount).plus(findItem('inspection').base_amount).plus(findItem('fumigation').base_amount).plus(findItem('booking').base_amount).plus(findItem('thc-origin').base_amount)),
    );
  });

  it('卖方利润：报价 − 成本 − 采购 + 退税', () => {
    expect(toStorage(result.seller.margin_ex_rebate)).toBe('161600.000000');
    expect(toStorage(result.seller.margin)).toBe('221423.008850');
    // 独立验算：758,280 − 76,680 − 520,000 + 59,823.008850
    expect(toStorage(result.seller.margin)).toBe(
      toStorage(
        result.seller.revenue.minus(result.seller.cost_total).minus(result.seller.goods_cost).plus(result.seller.rebate_total),
      ),
    );
  });

  it('滞箱费按天分档：前 7 天免费，第 8–9 天每天 55 美元', () => {
    // 7×0 + 2×55 = 110 USD × 7.10 = 781
    const demurrage = findItem('demurrage');
    expect(toStorage(demurrage.gross_amount)).toBe('110.000000');
    expect(toStorage(demurrage.base_amount)).toBe('781.000000');
  });

  it('买方额外成本与落地成本', () => {
    // 3,200 + 781 + 1,500 + 4,200 + 127,480.271040 = 137,161.271040
    expect(toStorage(result.buyer.additional_cost_total)).toBe('137161.271040');
    expect(toStorage(result.buyer.landed_cost_with_tax)).toBe('895441.271040');
    // 不含可抵扣增值税：895,441.271040 − 100,026.863040
    expect(toStorage(result.buyer.landed_cost_ex_deductible)).toBe('795414.408000');
  });

  it('风险与费用分离：CIF 已装船即转移风险，卖方仍付运费保险费', () => {
    expect(result.risk.separation).toBe(true);
    // 主运输 8,200 USD 与保险 600 USD 分别归入各自类别，合计 62,480
    expect(toStorage(result.seller.cost_by_category.MAIN_CARRIAGE ?? '0')).toBe('58220.000000');
    expect(toStorage(result.seller.cost_by_category.INSURANCE ?? '0')).toBe('4260.000000');
  });
});

describe('虚拟数值测试 · 跨术语一致性', () => {
  const comparisonA = compare({ ...INPUT, template: VIRTUAL_SCENARIO, anchor: { kind: 'FIXED_QUOTE' } });

  it('11 个术语下的进口税费总额完全相同', () => {
    const totals = new Set(comparisonA.columns.map((column) => toStorage(column.import_tax_total)));
    expect(totals.size).toBe(1);
    expect([...totals][0]).toBe('127480.271040');
  });

  it('承担范围用费用项数区分 CFR 与 CIF：节点数相同，但 CIF 多一笔保险费', () => {
    const columnOf = (incoterm: string) => {
      const found = comparisonA.columns.find((column) => column.incoterm === incoterm);
      if (found === undefined) throw new Error(`缺少术语列: ${incoterm}`);
      return found;
    };
    expect(columnOf('CIF').seller_cost_nodes).toBe(columnOf('CFR').seller_cost_nodes);
    expect(columnOf('CIF').seller_cost_items).toBe(columnOf('CFR').seller_cost_items + 1);
  });

  it('固定买方总支付时各术语利润一致，差别在报价与承担范围', () => {
    const landed = result.buyer.landed_cost_with_tax;
    const comparisonB = compare({
      ...INPUT,
      template: VIRTUAL_SCENARIO,
      anchor: { kind: 'FIXED_MARKET_PRICE', buyer_total: toStorage(landed), currency: 'CNY' },
    });
    const margins = new Set(comparisonB.columns.map((column) => toStorage(column.seller.margin)));
    const quotes = new Set(comparisonB.columns.map((column) => toStorage(column.quote_amount)));
    expect(margins.size).toBe(1);
    expect(quotes.size).toBeGreaterThan(2);
  });

  it('过错责任优先于术语：买方原因产生的滞箱费在 DDP 下仍归买方', () => {
    const ddpScenario: Scenario = {
      ...VIRTUAL_SCENARIO,
      id: 'scenario-ddp',
      incoterm: 'DDP',
      quote: { ...VIRTUAL_SCENARIO.quote, incoterm: 'DDP' },
    };

    const demurrageItem = VIRTUAL_TRADE.items.find((item) => item.cost_id === 'demurrage');
    if (demurrageItem === undefined) throw new Error('缺少滞箱费费用项');

    const decisions = resolveResponsibility({ trade: VIRTUAL_TRADE, scenario: ddpScenario, ruleSet: INCOTERMS_2020_RULESET });
    const demurrage = decisions.find((decision) => decision.cost_id === 'demurrage');
    expect(demurrage?.responsibility).toBe('BUYER');
    expect(demurrage?.source).toBe('OCCURRENCE_REASON');
    expect(demurrage?.rule_id).toBe('RR.BUYER_FAULT');
  });
});

describe('虚拟数值测试 · 结果速览', () => {
  it('打印完整结果供人工复核', () => {
    const lines: string[] = [];
    const pct = (value: number): string => `${value.toFixed(1)}%`;
    lines.push('');
    lines.push('══ 虚拟交易：1,200 台小家电 · 出口德国汉堡 · 海运整箱 ══');
    lines.push(
      `报价 CIF 汉堡 USD ${toDisplay(result.seller.revenue.dividedBy(7.1), 0)}（合同汇率 7.10 → CNY ${toDisplay(result.seller.revenue)}）`,
    );
    lines.push('');
    lines.push('── 逐项明细 ──');
    lines.push('费用                          节点            核算金额(CNY)      责任      归属依据');
    for (const enriched of result.items) {
      const amount = toDisplay(enriched.base_amount).padStart(14);
      const resp = (enriched.responsibility === 'SELLER' ? '卖方' : enriched.responsibility === 'BUYER' ? '买方' : '待确认').padEnd(6);
      lines.push(
        `${enriched.item.cost_name.padEnd(22).slice(0, 22)}  ${enriched.item.trade_node.padEnd(18).slice(0, 18)}${amount}  ${resp}  ${enriched.rule_id ?? ''}`,
      );
    }
    lines.push('');
    lines.push('── 卖方 ──');
    lines.push(`  报价收入        ${toDisplay(result.seller.revenue).padStart(12)}`);
    lines.push(`  承担费用       -${toDisplay(result.seller.cost_total).padStart(12)}`);
    lines.push(`  采购含税成本   -${toDisplay(result.seller.goods_cost).padStart(12)}`);
    lines.push(`  出口退税       +${toDisplay(result.seller.rebate_total).padStart(12)}`);
    lines.push(`  利润            ${toDisplay(result.seller.margin).padStart(12)}   （不含退税 ${toDisplay(result.seller.margin_ex_rebate)}）`);
    lines.push(`  利润率          ${pct(result.seller.margin.dividedBy(result.seller.revenue).times(100).toNumber()).padStart(12)}   （退税贡献 ${pct(result.seller.rebate_total.dividedBy(result.seller.margin).times(100).toNumber())}）`);
    lines.push('');
    lines.push('── 买方 ──');
    lines.push(`  报价金额        ${toDisplay(result.buyer.quote_amount).padStart(12)}`);
    lines.push(`  关税            +${toDisplay(result.buyer.duty_total).padStart(12)}`);
    lines.push(`  增值税          +${toDisplay(result.buyer.vat_total).padStart(12)}`);
    lines.push(`  报价外其他费用  +${toDisplay(result.buyer.additional_cost_total.minus(result.buyer.duty_total).minus(result.buyer.vat_total)).padStart(12)}`);
    lines.push(`  落地成本（含税）${toDisplay(result.buyer.landed_cost_with_tax).padStart(12)}`);
    lines.push('');
    lines.push('── 11 术语对比（固定报价基准）──');
    const comparison = compare({ ...INPUT, template: VIRTUAL_SCENARIO, anchor: { kind: 'FIXED_QUOTE' } });
    lines.push('术语   报价金额      承担费用      卖方利润      买方总支付    承担节点');
    for (const column of comparison.columns) {
      if (!column.feasible) continue;
      lines.push(
        `${column.incoterm.padEnd(6)}${toDisplay(column.quote_amount).padStart(12)}${toDisplay(column.seller.cost_total).padStart(14)}${toDisplay(column.seller.margin).padStart(14)}${toDisplay(column.buyer.landed_cost_with_tax).padStart(14)}${String(column.seller_cost_nodes).padStart(10)}`,
      );
    }
    lines.push(`最优：卖方利润 ${comparison.best_seller_margin} · 买方总支付最低 ${comparison.best_buyer_landed}`);
    lines.push('');
    lines.push('── 校验与提示 ──');
    for (const warning of result.warnings) {
      lines.push(`  [${warning.level}] ${warning.code} ${warning.message}`);
    }
    const report = lines.join('\n');
    console.log(report);

    expect(report.length).toBeGreaterThan(500);
  });
});
