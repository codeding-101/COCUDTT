import { describe, expect, it } from 'vitest';
import { d, toStorage } from '../src/domain/decimal';
import type { CostItem } from '../src/domain/cost-item';
import type { HsRateEntry } from '../src/domain/hs-rate';
import type { Scenario } from '../src/domain/scenario';
import type { Trade } from '../src/domain/trade';
import { analyze } from '../src/engine/analyze';
import { compare } from '../src/engine/compare';
import { EngineError } from '../src/engine/errors';
import { renderItemsPanel } from '../src/ui/views-input';
import type { ProjectFile } from '../src/data/project-file';
import { CONTRACT_FX_BOOK, CUSTOMS_FX_BOOK, TEST_TAX_PROFILE } from './fixtures/cif-108300';
import { VIRTUAL_FX_BOOKS, VIRTUAL_TAX_PROFILE, VIRTUAL_TRADE } from './fixtures/virtual-trade';
import { makeCostItem, makeScenario, makeTrade } from './helpers/factory';

/**
 * 压力测试。
 *
 * 关注的不是"正常数据算得对"（那是其余测试的事），而是：
 *   · 数据量大时还能不能算完、耗时是否可接受
 *   · 极端数值与病理结构会不会把它卡死或算爆
 *   · 大规模下不变量是否仍然成立（每笔费用恰好归属一次、结论确定）
 */

const BASE_INPUT = {
  taxProfile: VIRTUAL_TAX_PROFILE,
  fxBooks: VIRTUAL_FX_BOOKS,
};

const VIRTUAL_SCENARIO: Scenario = {
  id: 'stress-base',
  trade_id: VIRTUAL_TRADE.id,
  incoterm: 'CIF',
  base_currency: 'CNY',
  quote: {
    amount: '200000',
    currency: 'USD',
    incoterm: 'CIF',
    included_cost_ids: [],
    fx_type: 'CONTRACT',
  },
};

/** 生成 N 笔费用：覆盖六种计费方式、两种币种、多节点 */
function buildItems(count: number): CostItem[] {
  const items: CostItem[] = [];
  for (let index = 0; index < count; index += 1) {
    const variant = index % 6;
    const id = `item-${index}`;
    const common = {
      cost_id: id,
      cost_name: `压力费用 ${index}`,
      currency: (index % 3 === 0 ? 'USD' : 'CNY') as string,
      fx_type: (index % 3 === 0 ? 'CONTRACT' : 'MARKET') as 'CONTRACT' | 'MARKET',
      base_currency: 'CNY',
    };
    switch (variant) {
      case 0:
        items.push(makeCostItem({ ...common, pricing_method: 'FIXED', amount: '1000', cost_category: 'CUSTOM' }));
        break;
      case 1:
        items.push(
          makeCostItem({ ...common, pricing_method: 'QTY_X_UNIT', quantity: '3', rate: '250.5', unit: 'CTN', cost_category: 'INLAND_TRANSPORT', trade_node: 'INLAND_TRANSPORT' }),
        );
        break;
      case 2:
        items.push(
          makeCostItem({ ...common, pricing_method: 'PERCENT', rate: '0.012', currency: 'CNY', fx_type: 'MARKET', calculation_base: { kind: 'GOODS_VALUE' }, cost_category: 'MAIN_CARRIAGE', trade_node: 'MAIN_CARRIAGE' }),
        );
        break;
      case 3:
        items.push(makeCostItem({ ...common, pricing_method: 'PER_DAY', days: '15', rate: '80', cost_category: 'DESTINATION_TERMINAL', trade_node: 'DESTINATION_TERMINAL' }));
        break;
      case 4:
        items.push(
          makeCostItem({
            ...common,
            pricing_method: 'TIERED',
            quantity: '42',
            cost_category: 'ORIGIN_TERMINAL',
            trade_node: 'ORIGIN_TERMINAL',
            tiers: [
              { up_to: '45', rate: '35' },
              { up_to: '100', rate: '30.5' },
              { up_to: null, rate: '25' },
            ],
          }),
        );
        break;
      default:
        items.push(makeCostItem({ ...common, pricing_method: 'ACTUAL', amount: '777.77', cost_category: 'EXPORT_CLEARANCE', trade_node: 'EXPORT_CLEARANCE' }));
        break;
    }
  }
  return items;
}

function buildTrade(count: number): Trade {
  return makeTrade({
    items: buildItems(count),
    goods: {
      name: '压力测试商品',
      quantity: '10000',
      unit: 'PCS',
      trade_value: { amount: '150000', currency: 'USD' },
      seller_goods_cost: { amount: '800000', currency: 'CNY' },
      tax_key: '851830',
    },
  });
}

function ms(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

describe('压力测试 · 数据量', () => {
  it('300 笔费用：单方案分析在 1 秒内完成', () => {
    const trade = buildTrade(300);
    let result: ReturnType<typeof analyze> | undefined;
    const elapsed = ms(() => {
      result = analyze({ ...BASE_INPUT, trade, scenario: VIRTUAL_SCENARIO });
    });
    expect(result?.items.length).toBe(303); // 300 笔用户费用 + 3 笔引擎派生的进口税费
    // 报告实测值，便于观察随数据量的变化
    console.log(`    300 笔费用单方案分析：${elapsed.toFixed(1)} ms`);
    expect(elapsed).toBeLessThan(1000);
  });

  it('300 笔费用：11 术语对比（约 20 次分析）在 5 秒内完成', () => {
    const trade = buildTrade(300);
    let comparison: ReturnType<typeof compare> | undefined;
    const elapsed = ms(() => {
      comparison = compare({ ...BASE_INPUT, trade, template: VIRTUAL_SCENARIO });
    });
    expect(comparison?.columns).toHaveLength(11);
    expect(comparison?.columns.every((column) => column.feasible)).toBe(true);
    console.log(`    300 笔费用 11 术语对比：${elapsed.toFixed(1)} ms`);
    expect(elapsed).toBeLessThan(5000);
  });

  it('5000 条 HS 税率表：查表不拖慢计算', () => {
    const entries: HsRateEntry[] = [];
    for (let index = 0; index < 5000; index += 1) {
      entries.push({ code: `${851800 + index}`, description: `品目 ${index}`, duty_rates: { MFN: '0.037' } });
    }
    const trade = buildTrade(50);
    const profile = {
      ...VIRTUAL_TAX_PROFILE,
      import: { ...VIRTUAL_TAX_PROFILE.import, hsTable: { basis: 'MFN' as const, entries } },
    };
    let result: ReturnType<typeof analyze> | undefined;
    const elapsed = ms(() => {
      result = analyze({ ...BASE_INPUT, trade, scenario: VIRTUAL_SCENARIO, taxProfile: profile });
    });
    expect(result?.import_tax.hs_code_matched).toBe('851830');
    console.log(`    5000 条税率的查表：${elapsed.toFixed(1)} ms`);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('压力测试 · 极端数值', () => {
  const scenarioWith = (amount: string): Scenario => ({
    ...VIRTUAL_SCENARIO,
    quote: { ...VIRTUAL_SCENARIO.quote, amount },
  });

  it('超大金额不丢精度、不产生指数记法', () => {
    const trade = makeTrade({
      items: [makeCostItem({ cost_id: 'a', pricing_method: 'FIXED', amount: '999999999999.999999' })],
      goods: {
        name: 'g',
        quantity: '1',
        unit: 'PCS',
        trade_value: { amount: '999999999999.99', currency: 'CNY' },
        seller_goods_cost: { amount: '1', currency: 'CNY' },
      },
    });
    const result = analyze({ ...BASE_INPUT, trade, scenario: scenarioWith('1000000') });
    const text = toStorage(result.seller.cost_total);
    expect(text).toBe('999999999999.999999');
    expect(text).not.toMatch(/e/i);
  });

  it('极小数值保留 6 位小数，不被抹成 0', () => {
    const trade = makeTrade({
      items: [makeCostItem({ cost_id: 'a', pricing_method: 'QTY_X_UNIT', quantity: '0.000001', rate: '0.000002' })],
    });
    const result = analyze({ ...BASE_INPUT, trade, scenario: scenarioWith('1000') });
    expect(toStorage(result.seller.cost_total)).toBe('0.000000'); // 6 位精度下确实为 0
    // 但 1 分钱级别的值必须留住
    const trade2 = makeTrade({
      items: [makeCostItem({ cost_id: 'a', pricing_method: 'QTY_X_UNIT', quantity: '0.5', rate: '0.02' })],
    });
    const result2 = analyze({ ...BASE_INPUT, trade: trade2, scenario: scenarioWith('1000') });
    expect(toStorage(result2.seller.cost_total)).toBe('0.010000');
  });

  it('零金额不报错：费用为 0，利润按 0 收入 − 采购成本 + 退税 计算', () => {
    const trade = makeTrade({ items: [makeCostItem({ cost_id: 'a', pricing_method: 'FIXED', amount: '0' })] });
    const result = analyze({ ...BASE_INPUT, trade, scenario: scenarioWith('0') });
    expect(toStorage(result.seller.cost_total)).toBe('0.000000');
    // 默认 fixture 的采购成本 800、征退税率同为 13% → 0 − 800 + 800/1.13×0.13
    expect(toStorage(result.seller.margin)).toBe('-707.964602');
  });

  it('负金额（折扣）按原样参与计算', () => {
    const trade = makeTrade({ items: [makeCostItem({ cost_id: 'a', pricing_method: 'FIXED', amount: '-500' })] });
    const result = analyze({ ...BASE_INPUT, trade, scenario: scenarioWith('1000') });
    expect(toStorage(result.seller.cost_total)).toBe('-500.000000');
  });

  it('百分比接近 1 时不出怪数', () => {
    const trade = makeTrade({
      items: [
        makeCostItem({ cost_id: 'a', pricing_method: 'PERCENT', rate: '0.999999', calculation_base: { kind: 'QUOTE_AMOUNT' } }),
      ],
    });
    const result = analyze({ ...BASE_INPUT, trade, scenario: scenarioWith('1000') });
    // 报价 1,000 USD 按合同汇率 7.10 折为 7,100 CNY，再乘 0.999999
    expect(toStorage(result.seller.cost_total)).toBe('7099.992900');
  });

  it('目标利润率趋近 1 时报错，不返回天文数字', () => {
    const trade = buildTrade(5);
    expect(() =>
      compare({ ...BASE_INPUT, trade, template: VIRTUAL_SCENARIO, anchor: { kind: 'FIXED_MARGIN_RATE', margin_rate: '1' } }),
    ).toThrowError(EngineError);
  });

  it('买方总支付目标为 0 时，需要倒贴报价的术语判为不可行，而不是崩掉', () => {
    const trade = buildTrade(5);
    const comparison = compare({
      ...BASE_INPUT,
      trade,
      template: VIRTUAL_SCENARIO,
      anchor: { kind: 'FIXED_MARKET_PRICE', buyer_total: '0', currency: 'CNY' },
    });
    const byIncoterm = new Map(comparison.columns.map((column) => [column.incoterm, column]));
    // CIF 下买方要付进口税费，报价会被压成负数 → 不可行，并给出原因
    expect(byIncoterm.get('CIF')?.feasible).toBe(false);
    expect(byIncoterm.get('CIF')?.infeasible_reason).toBeTruthy();
    // DDP 下买方不承担任何费用，报价 0 就能满足目标，因此可行
    expect(byIncoterm.get('DDP')?.feasible).toBe(true);
    expect(toStorage(byIncoterm.get('DDP')?.quote_amount ?? d(1))).toBe('0.000000');
  });
});

describe('压力测试 · 病理结构', () => {
  it('200 层深的百分比依赖链：能算完且不爆栈', () => {
    const items: CostItem[] = [
      makeCostItem({ cost_id: 'base', pricing_method: 'FIXED', amount: '1000' }),
    ];
    for (let index = 1; index <= 200; index += 1) {
      items.push(
        makeCostItem({
          cost_id: `chain-${index}`,
          pricing_method: 'PERCENT',
          rate: '0.5',
          calculation_base: { kind: 'COST_ITEMS', ids: [index === 1 ? 'base' : `chain-${index - 1}`] },
        }),
      );
    }
    const trade = makeTrade({ items });
    const result = analyze({ ...BASE_INPUT, trade, scenario: VIRTUAL_SCENARIO });
    // 每层减半：1000 × 0.5^1 … 最后一层已经小到 0
    expect(toStorage(result.items[1]?.base_amount ?? d(0))).toBe('500.000000');
    expect(result.items).toHaveLength(204); // 1 个基数 + 200 层链 + 3 笔派生税费
  });

  it('200 层链里插入一个环：立刻报环，不无限递归', () => {
    const items: CostItem[] = [];
    for (let index = 0; index < 200; index += 1) {
      items.push(
        makeCostItem({
          cost_id: `c-${index}`,
          pricing_method: 'PERCENT',
          rate: '0.5',
          calculation_base: { kind: 'COST_ITEMS', ids: [index === 199 ? 'c-0' : `c-${index + 1}`] },
        }),
      );
    }
    const trade = makeTrade({ items });
    const start = performance.now();
    try {
      analyze({ ...BASE_INPUT, trade, scenario: VIRTUAL_SCENARIO });
      throw new Error('预期抛出环检测错误');
    } catch (error) {
      expect((error as EngineError).code).toBe('GRAPH_CYCLE');
    }
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('互相包含的两笔费用（A 含于 B、B 含于 A）不会卡死', () => {
    const items = [
      makeCostItem({ cost_id: 'a', pricing_method: 'FIXED', amount: '100', contained_in_cost_id: 'b' }),
      makeCostItem({ cost_id: 'b', pricing_method: 'FIXED', amount: '200', contained_in_cost_id: 'a' }),
    ];
    const trade = makeTrade({ items });
    const result = analyze({ ...BASE_INPUT, trade, scenario: VIRTUAL_SCENARIO });
    // 只检查用户录入的费用项；引擎派生的税费项不走包含关系
    const userItems = result.items.filter((enriched) => !enriched.item.cost_id.startsWith('derived-'));
    expect(userItems.every((enriched) => enriched.exclusion === 'CONTAINED_IN_PARENT')).toBe(true);
    expect(toStorage(result.seller.cost_total)).toBe('0.000000');
  });

  it('自己包含自己也不卡死', () => {
    const items = [makeCostItem({ cost_id: 'a', pricing_method: 'FIXED', amount: '100', contained_in_cost_id: 'a' })];
    const trade = makeTrade({ items });
    const result = analyze({ ...BASE_INPUT, trade, scenario: VIRTUAL_SCENARIO });
    expect(result.items[0]?.exclusion).toBe('CONTAINED_IN_PARENT');
  });

  it('200 档的阶梯仍能正确定位档位', () => {
    const tiers = [];
    for (let index = 1; index <= 199; index += 1) tiers.push({ up_to: String(index * 10), rate: '1' });
    tiers.push({ up_to: null, rate: '0.5' });
    const trade = makeTrade({
      items: [makeCostItem({ cost_id: 'a', pricing_method: 'TIERED', quantity: '1505', tiers })],
    });
    const result = analyze({ ...BASE_INPUT, trade, scenario: VIRTUAL_SCENARIO });
    // 累进：前 199 档各 10 单位 × 1 = 1,990，余下 1,505−1,990 < 0 不会发生
    expect(Number(toStorage(result.seller.cost_total))).toBeGreaterThan(0);
  });

  it('数量为负的阶梯报错，不静默算出负数', () => {
    const trade = makeTrade({
      items: [
        makeCostItem({
          cost_id: 'a',
          pricing_method: 'TIERED',
          quantity: '-5',
          tiers: [{ up_to: null, rate: '10' }],
        }),
      ],
    });
    try {
      analyze({ ...BASE_INPUT, trade, scenario: VIRTUAL_SCENARIO });
      throw new Error('预期抛错');
    } catch (error) {
      expect((error as EngineError).code).toBe('PRICING_TIER_INVALID');
    }
  });

  it('费用名里的 HTML 会被转义，不会注入界面', () => {
    const project = {
      schema_version: '0.1',
      name: 'x',
      updated_at: 'x',
      base_currency: 'CNY',
      carriage_mode: 'SEA',
      goods: { name: 'g', quantity: '1', unit: 'PCS', trade_value: { amount: '1', currency: 'CNY' }, seller_goods_cost: { amount: '1', currency: 'CNY' } },
      items: [
        makeCostItem({
          cost_id: 'a',
          cost_name: '<img src=x onerror=alert(1)>"><script>alert(2)</script>',
          pricing_method: 'FIXED',
          amount: '10',
        }),
      ],
      fx_books: [],
      tax_profile: TEST_TAX_PROFILE,
      quote: { amount: '10', currency: 'CNY', fx_type: 'MARKET' },
      incoterm: 'CIF',
      anchor: { kind: 'FIXED_QUOTE' },
    } as unknown as ProjectFile;
    const html = renderItemsPanel(project, new Map());
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('压力测试 · 不变量', () => {
  it('每笔费用恰好归属一次：计入的 + 排除的 = 全部', () => {
    const trade = buildTrade(120);
    const result = analyze({ ...BASE_INPUT, trade, scenario: VIRTUAL_SCENARIO });
    const counted = result.items.filter((item) => item.counts_to_seller || item.counts_to_buyer).length;
    const excluded = result.items.filter((item) => item.exclusion !== null).length;
    expect(counted + excluded).toBe(result.items.length);
  });

  it('同一输入连算两次结果完全一致（无隐藏状态）', () => {
    const trade = buildTrade(60);
    const first = analyze({ ...BASE_INPUT, trade, scenario: VIRTUAL_SCENARIO });
    const second = analyze({ ...BASE_INPUT, trade, scenario: VIRTUAL_SCENARIO });
    expect(toStorage(second.seller.margin)).toBe(toStorage(first.seller.margin));
    expect(toStorage(second.buyer.landed_cost_with_tax)).toBe(toStorage(first.buyer.landed_cost_with_tax));
    expect(second.warnings.length).toBe(first.warnings.length);
  });

  it('大规模下"进口税费与术语无关"仍然成立', () => {
    const trade = buildTrade(120);
    const comparison = compare({ ...BASE_INPUT, trade, template: VIRTUAL_SCENARIO });
    const totals = new Set(comparison.columns.map((column) => toStorage(column.import_tax_total)));
    expect(totals.size).toBe(1);
  });

  it('卖方成本 = 各分类之和（汇总不漏项）', () => {
    const trade = buildTrade(120);
    const result = analyze({ ...BASE_INPUT, trade, scenario: VIRTUAL_SCENARIO });
    const byCategory = Object.values(result.seller.cost_by_category).reduce(
      (acc, value) => acc.plus(value ?? d(0)),
      d(0),
    );
    expect(toStorage(byCategory)).toBe(toStorage(result.seller.cost_total));
  });

  it('连续 200 次改动不产生漂移（重复计算稳定）', () => {
    const trade = buildTrade(30);
    const first = analyze({ ...BASE_INPUT, trade, scenario: VIRTUAL_SCENARIO });
    for (let index = 0; index < 200; index += 1) {
      analyze({ ...BASE_INPUT, trade, scenario: VIRTUAL_SCENARIO });
    }
    const last = analyze({ ...BASE_INPUT, trade, scenario: VIRTUAL_SCENARIO });
    expect(toStorage(last.seller.margin)).toBe(toStorage(first.seller.margin));
  });
});

describe('压力测试 · 渲染规模', () => {
  function projectWith(count: number): ProjectFile {
    return {
      schema_version: '0.1',
      name: '渲染规模',
      updated_at: '2026-09-14',
      base_currency: 'CNY',
      carriage_mode: 'SEA',
      goods: {
        name: 'g',
        quantity: '1',
        unit: 'PCS',
        trade_value: { amount: '1', currency: 'CNY' },
        seller_goods_cost: { amount: '1', currency: 'CNY' },
      },
      items: buildItems(count),
      fx_books: [],
      tax_profile: TEST_TAX_PROFILE,
      quote: { amount: '10', currency: 'CNY', fx_type: 'MARKET' },
      incoterm: 'CIF',
      anchor: { kind: 'FIXED_QUOTE' },
    };
  }

  /**
   * "已含于"下拉若为每笔费用列出其余全部费用项，option 数就是 O(n²)：
   * 300 笔费用会产生约 9 万个 option，页面加载超过 30 秒（引擎只要 30ms，瓶颈全在 DOM）。
   * 该字段现在只在获得焦点时才填充候选，因此渲染出的 option 数应当与费用项数近似线性。
   */
  it('渲染出的 option 数随费用项数线性增长，不是平方', () => {
    const count = 80;
    const html = renderItemsPanel(projectWith(count), new Map());
    const options = (html.match(/<option/g) ?? []).length;
    // 每张卡片约 40 个静态选项（节点/类别/计费方式/汇率类型/发生原因）+ 1 个"未含于他项"
    expect(options).toBeLessThan(count * 50);
    // 若退回 O(n²)，这里会是 80×79 + 静态项 ≈ 9,500
    expect(options).toBeLessThan(5000);
  });

  it('已有父项的卡片会回显该父项，不因懒加载而丢失当前值', () => {
    const project = projectWith(3);
    const first = project.items[0];
    if (first === undefined) throw new Error('缺少费用项');
    first.contained_in_cost_id = project.items[1]?.cost_id ?? '';
    const html = renderItemsPanel(project, new Map());
    expect(html).toContain(`value="${first.contained_in_cost_id}" selected`);
  });
});

describe('压力测试 · 回归样例仍成立', () => {
  it('小数据量下 CIF 108,300 用例的数字不变', () => {
    const result = analyze({
      trade: VIRTUAL_TRADE,
      scenario: VIRTUAL_SCENARIO,
      taxProfile: VIRTUAL_TAX_PROFILE,
      fxBooks: VIRTUAL_FX_BOOKS,
    });
    expect(result.incoterm).toBe('CIF');
    expect(toStorage(result.seller.revenue)).toBe('1420000.000000');
  });

  it('未使用的税率簿不影响结果', () => {
    const result = analyze({
      trade: VIRTUAL_TRADE,
      scenario: VIRTUAL_SCENARIO,
      taxProfile: { ...VIRTUAL_TAX_PROFILE, import: { ...VIRTUAL_TAX_PROFILE.import, dutyRates: { fallback: '0.5' } } },
      fxBooks: [CONTRACT_FX_BOOK, CUSTOMS_FX_BOOK, ...VIRTUAL_FX_BOOKS],
    });
    expect(result.warnings.filter((warning) => warning.level === 'ERROR')).toHaveLength(0);
  });
});
