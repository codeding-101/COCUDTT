import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { d, sum } from '../src/domain/decimal';
import { parseProject, toScenario, toTrade } from '../src/data/project-file';
import { chinaImportSampleProjectFile } from '../src/data/sample-project';
import { analyze } from '../src/engine/analyze';
import { scenarioWithDerivedInclusions } from '../src/engine/compare';
import { computeGrossAmount } from '../src/engine/pricing';
import { computeImportTaxes } from '../src/engine/tax/import-tax';
import { computeRebate } from '../src/engine/tax/rebate';
import { resolveItemResponsibility } from '../src/engine/responsibility/resolver';
import { INCOTERMS_2020_RULESET } from '../src/engine/responsibility/rules-incoterms2020';
import { barLength, resultCharts } from '../src/engine/visualization';
import type { CalculationStep } from '../src/engine/calculation';
import type { IncotermsRuleSet } from '../src/domain/rule';
import type { CostItem } from '../src/domain/cost-item';
import { createProjectReport } from '../src/ui/project-report';
import { renderCostCharts } from '../src/ui/result-explanation';
import { makeCostItem, makeScenario, makeTrade } from './helpers/factory';
import { logisticsProject } from './fixtures/logistics-project';
import { TEST_TAX_PROFILE } from './fixtures/cif-108300';

function analyzed(p = logisticsProject()) {
  const trade = toTrade(p);
  return analyze({ trade, scenario: scenarioWithDerivedInclusions(toScenario(p), trade), taxProfile: p.tax_profile, fxBooks: p.fx_books });
}
const last = <T>(items: readonly T[]) => items[items.length - 1]!;
const valueOf = (steps: CalculationStep[] | undefined, id: string) => steps!.find(s => s.id === id)!;

describe('可复核的责任链', () => {
  const item = makeCostItem({ cost_id: 'freight', trade_node: 'MAIN_CARRIAGE', cost_category: 'MAIN_CARRIAGE', amount: '100', occurrence_reason: 'NORMAL_OPERATION' });
  const trade = makeTrade({ items: [item] });
  it('记录真实执行顺序，人工指定优先且后续层不伪装成已执行', () => {
    const scenario = makeScenario({ incoterm: 'CIF', responsibility_overrides: { freight: { responsibility: 'BUYER', reason: '单独合同约定' } } });
    const r = resolveItemResponsibility(item, { trade, scenario, ruleSet: INCOTERMS_2020_RULESET });
    expect(r.trace).toHaveLength(1); expect(r.trace[0]!.stage).toBe('USER_OVERRIDE');
    expect(r.trace[0]!.detail).toContain('单独合同约定'); expect(r.responsibility).toBe('BUYER');
  });
  it('合同优先于原因及术语，展示实际命中的选择器', () => {
    const r = resolveItemResponsibility({ ...item, occurrence_reason: 'SELLER_FAULT' }, { trade, scenario: makeScenario({ incoterm: 'CIF' }), ruleSet: { ...INCOTERMS_2020_RULESET, contract_clauses: [{ id: 'contract', cost_id: 'freight', responsibility: 'BUYER', note: '单独运费条款' }] } });
    expect(r.trace.map(s => s.stage)).toEqual(['USER_OVERRIDE', 'CONTRACT']);
    expect(last(r.trace).detail).toContain('freight'); expect(last(r.trace).matched).toBe(true);
    expect(r.responsibility).toBe('BUYER');
  });
  it('买方原因覆盖CIF卖方正常运费，但不把未录入原因伪装成正常作业', () => {
    const scenario = makeScenario({ incoterm: 'CIF' });
    const fault = resolveItemResponsibility({ ...item, occurrence_reason: 'BUYER_FAULT' }, { trade, scenario, ruleSet: INCOTERMS_2020_RULESET });
    expect(fault.responsibility).toBe('BUYER'); expect(last(fault.trace).stage).toBe('OCCURRENCE_REASON');
    const unknown = resolveItemResponsibility({ ...item, occurrence_reason: undefined }, { trade, scenario, ruleSet: INCOTERMS_2020_RULESET });
    expect(unknown.trace.find(s => s.stage === 'OCCURRENCE_REASON')!.detail).toContain('未录入');
    expect(last(unknown.trace).stage).toBe('INCOTERM_RULE');
  });
  it('条件具体度与缺失事实的选择反映在链条里', () => {
    const conditional = makeCostItem({ cost_id: 'loading', amount: '1', trade_node: 'SELLER_PREMISES', cost_category: 'GOODS_AND_PACKING' });
    const rules: IncotermsRuleSet = { id: 'test', version: '1', rules: [
      { id: 'broad', incoterm: 'FCA', conditions: [], responsibility: 'BUYER', note: '通配' },
      { id: 'specific', incoterm: 'FCA', trade_node: 'SELLER_PREMISES', conditions: [{ kind: 'DELIVERY_PLACE', is: 'SELLER_PREMISES' }], responsibility: 'SELLER', note: '已确认交货地点' },
    ] };
    const yes = resolveItemResponsibility(conditional, { trade, scenario: makeScenario({ incoterm: 'FCA', facts: { delivery_place: 'SELLER_PREMISES' } }), ruleSet: rules });
    expect(yes.rule_id).toBe('specific'); expect(last(yes.trace).detail).toContain('交货地点=卖方场所');
    const no = resolveItemResponsibility(conditional, { trade, scenario: makeScenario({ incoterm: 'FCA' }), ruleSet: rules });
    expect(no.rule_id).toBe('broad'); expect(last(no.trace).detail).toContain('无附加条件');
    expect(last(yes.trace).candidates!.find(c => c.id === 'broad')!.matched).toBe(true);
    expect(last(yes.trace).candidates!.find(c => c.id === 'specific')!.selected).toBe(true);
    expect(last(no.trace).candidates!.find(c => c.id === 'specific')!.checks.join(' ')).toContain('录入 缺失（不符）');
  });
  it.each(['special', 'fallback', 'unresolved'] as const)('保留%s分支及低可信边界', branch => {
    const rules: IncotermsRuleSet = { id: 'empty', version: '1', rules: [],
      ...(branch === 'special' ? { special_facts: [{ id: 'special', conditions: [], responsibility: 'SELLER' as const, note: '特殊事实' }] } : {}),
      ...(branch === 'fallback' ? { node_fallbacks: [{ incoterm: 'CIF' as const, seller_nodes: ['MAIN_CARRIAGE' as const] }] } : {}) };
    const r = resolveItemResponsibility(item, { trade, scenario: makeScenario({ incoterm: 'CIF' }), ruleSet: rules });
    expect(last(r.trace).stage).toBe(branch === 'special' ? 'SPECIAL_CONDITION' : branch === 'fallback' ? 'TRADE_NODE' : 'UNRESOLVED');
    if (branch !== 'special') expect(r.needs_confirmation).toBe(true);
  });
  it('同分按顺序选择；即使规则ID重复，候选标记仍对准实际选中的声明', () => {
    const rules: IncotermsRuleSet = { id: 'test', version: '1', rules: [
      { id: 'repeat', incoterm: 'CIF', conditions: [], responsibility: 'BUYER', note: '通配' },
      { id: 'repeat', incoterm: 'CIF', conditions: [], trade_node: 'MAIN_CARRIAGE', responsibility: 'SELLER', note: '第一具体规则' },
      { id: 'third', incoterm: 'CIF', conditions: [], trade_node: 'MAIN_CARRIAGE', responsibility: 'BUYER', note: '第二具体规则' },
    ] };
    const r = resolveItemResponsibility(item, { trade, scenario: makeScenario({ incoterm: 'CIF' }), ruleSet: rules });
    expect(r.note).toBe('第一具体规则'); expect(last(r.trace).candidates!.map(c => c.selected)).toEqual([false, true, false]);
  });
});

describe('实际计费操作数', () => {
  const cases: [string, Partial<CostItem>, string, string][] = [
    ['fixed', { pricing_method: 'FIXED', amount: '12.3456789' }, '12.345679', '12.3456789'],
    ['actual', { pricing_method: 'ACTUAL', amount: '0' }, '0', '0'],
    ['quantity', { pricing_method: 'QTY_X_UNIT', quantity: '3', rate: '4.25' }, '12.75', '3 × 4.25'],
    ['days', { pricing_method: 'PER_DAY', days: '3', rate: '20' }, '60', '3 × 20'],
    ['percent', { pricing_method: 'PERCENT', calculation_base: { kind: 'GOODS_VALUE' }, rate: '0.005' }, '50', '10000 × 0.005'],
    ['marginal', { pricing_method: 'TIERED', quantity: '600', tiers: [{ up_to: '100', rate: '10' }, { up_to: '500', rate: '8' }, { up_to: null, rate: '6' }] }, '4800', '400 × 8'],
    ['flat', { pricing_method: 'TIERED', tier_mode: 'FLAT', quantity: '40', tiers: [{ up_to: '45', rate: '35' }, { up_to: null, rate: '30.5' }] }, '1400', '40 × 35'],
    ['charge-lower', { pricing_method: 'TIERED', tier_mode: 'FLAT', tier_charge_lower: true, quantity: '40', tiers: [{ up_to: '45', rate: '35' }, { up_to: null, rate: '30.5' }] }, '1372.5', '45 × 30.5'],
  ];
  it.each(cases)('%s记录实际档位/操作数且不改变金额', (_, fields, expected, expression) => {
    const steps: CalculationStep[] = [];
    const item = makeCostItem({ cost_id: 'fee', ...fields });
    const result = computeGrossAmount(item, { resolveBase: () => '10000', record: step => steps.push(step) });
    expect(result.toString()).toBe(expected); expect(last(steps).value!.toString()).toBe(expected);
    expect(last(steps).substitution).toContain(expression);
  });
  it('百分比依赖链使用解析金额，核算换算步骤只记录一次', () => {
    const p = logisticsProject(); p.items.push(makeCostItem({ cost_id: 'percent-fee', pricing_method: 'PERCENT', calculation_base: { kind: 'COST_ITEMS', ids: ['seller-freight', 'insurance'] }, rate: '0.01' }));
    const r = analyzed(p); const fee = r.items.find(i => i.item.cost_id === 'percent-fee')!;
    expect(fee.calculations.map(s => s.id)).toEqual(['gross', 'conversion']);
    expect(fee.calculations[0]!.substitution).toBe('700 × 0.01'); expect(fee.base_amount.toString()).toBe('7');
  });
});

describe('税额展开与手算案例一致', () => {
  it.each(['consumption-rounding', 'cif-dual-fx', 'specific-duty'])('%s保留税基、递进税额、舍入及支付', name => {
    const p = parseProject(readFileSync(new URL(`./fixtures/import-cases/${name}.project.json`, import.meta.url), 'utf8'));
    const expected = JSON.parse(readFileSync(new URL(`./fixtures/import-cases/${name}.case.json`, import.meta.url), 'utf8')).expected;
    const result = analyzed(p);
    expect(valueOf(result.calculations[0]!.steps, 'dutiable-total').value!.toFixed(2)).toBe(expected.dutiable_value);
    for (const [id, key] of [['duty', 'duty'], ['consumption', 'consumption_tax'], ['vat', 'vat']]) expect(valueOf(result.import_tax.calculations, id!).value!.toFixed(2)).toBe(expected[key!]);
    expect(valueOf(result.calculations.find(g => g.id === 'totals')!.steps, 'buyer-total').value!.toFixed(2)).toBe(expected.buyer_total);
    if (name === 'cif-dual-fx') {
      expect(valueOf(result.calculations[0]!.steps, 'goods-value').substitution).toBe('100000 × 7.08');
      expect(valueOf(result.calculations.find(g => g.id === 'totals')!.steps, 'quote').substitution).toBe('108300 × 7');
    }
    if (name === 'consumption-rounding') expect(valueOf(result.import_tax.calculations, 'vat-raw').substitution).toBe('(1234.56 + 61.73 + 144.03) × 0.13');
  });
  it.each(['49.99', '50'])('关税%s门槛前后分别记录，增值税采用实征关税', amount => {
    const profile = structuredClone(chinaImportSampleProjectFile().tax_profile); delete profile.import.hsTable;
    profile.import.dutyRates = { fallback: amount === '50' ? '0.05' : '0.04999' };
    const r = computeImportTaxes({ profile, dutiableValue: d(1000) });
    expect(valueOf(r.calculations, 'duty-raw').value!.toString()).toBe(amount === '50' ? '50' : '49.99');
    expect(valueOf(r.calculations, 'duty').value!.toString()).toBe(amount === '50' ? '50' : '0');
    expect(valueOf(r.calculations, 'vat-raw').substitution).toContain(`+ ${amount === '50' ? '50' : '0'} +`);
  });
  it('复合关税显示数量及单位税额；中国模式只对总额舍入', () => {
    const profile = structuredClone(chinaImportSampleProjectFile().tax_profile);
    profile.import.hsTable = { basis: 'MFN', entries: [{ code: '12345678', description: '合成', duty_type: 'COMPOUND', duty_rates: { MFN: '0.05' }, specific_amount: '0.333333', specific_unit: 'PCS' }] };
    const r = computeImportTaxes({ profile, taxKey: '12345678', quantity: '300', unit: 'PCS', dutiableValue: d('1234.56') });
    expect(valueOf(r.calculations, 'duty-raw').substitution).toBe('1234.56 × 0.05 + 300 × 0.333333');
    expect(r.duty.toFixed(2)).toBe('161.73');
  });
  it('未配置消费税、通用100%非法消费税不伪装成可用公式', () => {
    const profile = structuredClone(TEST_TAX_PROFILE);
    const zero = computeImportTaxes({ profile, dutiableValue: d('1000') });
    expect(valueOf(zero.calculations, 'consumption-raw').substitution).toBe('不计消费税');
    profile.import.consumptionTax = { rate: '1', basis: 'DUTIABLE_PLUS_DUTY' };
    const invalid = computeImportTaxes({ profile, dutiableValue: d('1000') });
    expect(valueOf(invalid.calculations, 'consumption-raw').value).toBeNull();
    expect(invalid.warnings.some(w => w.level === 'ERROR')).toBe(true);
  });
  it('缺海关汇率通用回退及估算保险均明确解释，不冒充真实换算', () => {
    const p = chinaImportSampleProjectFile(); delete p.tax_profile.import.calculationMode; p.fx_books = p.fx_books.filter(b => b.type !== 'CUSTOMS');
    const r = analyzed(p);
    expect(valueOf(r.calculations[0]!.steps, 'goods-value').formula).toContain('缺海关汇率');
    const p2 = logisticsProject(); p2.items = p2.items.filter(i => i.cost_category !== 'INSURANCE'); p2.tax_profile.import.insuranceFallbackRate = '0.003';
    expect(valueOf(analyzed(p2).calculations[0]!.steps, 'insurance-fallback').substitution).toBe('(10000 + 600) × 0.003');
  });
});

describe('退税与利润边界', () => {
  it('中国进口的退税是不适用，采购成本未知不生成零利润', () => {
    const r = analyzed(); expect(valueOf(r.rebate.calculations, 'not-applicable').value).toBeNull();
    expect(valueOf(r.calculations.find(g => g.id === 'totals')!.steps, 'profit').value).toBeNull();
  });
  it.each(['TRADING', 'MANUFACTURER'] as const)('%s计税依据、留抵上限及资金占用与手算一致', entityType => {
    const r = computeRebate({ profile: { entityType, vatRates: { fallback: '0.13' }, rebateRates: { fallback: '0.09' }, endingCreditBalance: '100', rebateLagDays: 30, sellerFundingRate: '0.05' },
      seller_goods_cost_base: d('11300'), quote_amount_base: d('12000'), post_shipment_included_base: d('1000'), pre_shipment_excluded_base: d('0') });
    expect(valueOf(r.calculations, 'basis').value!.toString()).toBe(entityType === 'TRADING' ? '10000' : '11000');
    expect(valueOf(r.calculations, 'vat-rebate').value!.toString()).toBe(entityType === 'TRADING' ? '900' : '100');
    expect(valueOf(r.calculations, 'lag-cost').value!.toString()).toBe(entityType === 'TRADING' ? '3.69863' : '0.410959');
  });
});

describe('图表的汇总口径与离线报告', () => {
  it('CIP各图独立勾稽，排除未启用运价、已含及父项金额', () => {
    const p = logisticsProject();
    p.items.push(makeCostItem({ cost_id: 'child', amount: '50', contained_in_cost_id: 'seller-freight' }));
    const r = analyzed(p); const charts = resultCharts(r);
    expect(charts.find(c => c.id === 'seller-fees')!.total.toString()).toBe('700');
    expect(charts.find(c => c.id === 'customs-base')!.total.toString()).toBe('10700');
    expect(charts.find(c => c.id === 'buyer-payment')!.total.toString()).toBe('12695.55');
    for (const chart of charts.filter(c => c.id !== 'responsibility')) expect(sum(chart.rows.map(row => row.amount)).eq(chart.total)).toBe(true);
    expect(charts.find(c => c.id === 'responsibility')!.rows[2]!.amount.toString()).toBe('50');
    expect(r.inactive_items.map(i => i.cost_id)).toContain('buyer-freight');
  });
  it('DDP税额只归卖方，买方图中税额/抵扣不重复列支', () => {
    const p = chinaImportSampleProjectFile(); p.incoterm = 'DDP'; p.tax_profile.import.vatDeductibleForBuyer = true;
    const r = analyzed(p); const rows = resultCharts(r).find(c => c.id === 'buyer-payment')!.rows;
    expect(rows.filter(row => row.kind === 'tax').every(row => row.amount.isZero())).toBe(true);
    expect(r.buyer.deductible_vat.isZero()).toBe(true); expect(r.seller.cost_by_category.IMPORT_DUTIES!.gt(0)).toBe(true);
  });
  it('归属买方但报价内含的费用只计报价一次，图和推理均显示排除', () => {
    const p = logisticsProject(); p.items.push(makeCostItem({ cost_id: 'included-fee', amount: '50', trade_node: 'IMPORT_CLEARANCE', included_in_quoted_price: true }));
    const trade = toTrade(p), scenario = toScenario(p); scenario.quote.included_cost_ids = ['seller-freight', 'insurance', 'included-fee'];
    const r = analyze({ trade, scenario, taxProfile: p.tax_profile, fxBooks: p.fx_books });
    expect(r.items.find(i => i.item.cost_id === 'included-fee')!.exclusion).toBe('INCLUDED_IN_QUOTE');
    expect(r.buyer.landed_cost_with_tax.toString()).toBe('12695.55');
    expect(resultCharts(r).find(c => c.id === 'responsibility')!.rows[2]!.amount.toString()).toBe('50');
  });
  it.each(['CONDITIONAL', 'SHARED'] as const)('%s费用保留核对金额，不能因图表出现就计入支付', responsibility => {
    const p = logisticsProject(); p.items.push(makeCostItem({ cost_id: 'pending', amount: '100', trade_node: 'IMPORT_CLEARANCE' }));
    p.term_scenarios!.CIP!.responsibility_overrides = { pending: { responsibility, reason: '合成待分配费用' } };
    const r = analyzed(p);
    expect(r.items.find(i => i.item.cost_id === 'pending')!.counts_to_buyer).toBe(false);
    expect(r.buyer.landed_cost_with_tax.toString()).toBe('12695.55');
    expect(resultCharts(r).find(c => c.id === 'responsibility')!.rows[2]!.amount.toString()).toBe('100');
    expect(renderCostCharts(r)).toContain('参考测算');
  });
  it('负数冲减与零总额采用绝对条长，极端金额不出现NaN或Infinity', () => {
    const rows = [{ label: '正', amount: d('1e300'), kind: 'seller' as const }, { label: '负', amount: d('-1e300'), kind: 'seller' as const }];
    expect(barLength(rows[0]!.amount, rows)).toBe('100.000'); expect(barLength(rows[1]!.amount, rows)).toBe('100.000');
    expect(barLength(d(0), [{ ...rows[0]!, amount: d(0) }])).toBe('0');
    const p = logisticsProject(); p.items.push(makeCostItem({ cost_id: 'refund', amount: '-10', trade_node: 'IMPORT_CLEARANCE' }));
    expect(renderCostCharts(analyzed(p))).toContain('冲减');
  });
  it('报告展开公式及完整责任链，用户文本转义，输入和已生成报告保持独立', () => {
    const p = logisticsProject(); p.items[0]!.cost_name = '<img src=x onerror=alert(1)>';
    const before = JSON.stringify(p); const html = createProjectReport(p);
    expect(JSON.stringify(p)).toBe(before); expect(html).toContain('费用与税基可视化'); expect(html).toContain('本方案没有对该费用的显式指定');
    expect(html).toContain('data-calculation="buyer-total"'); expect(html).toContain('四舍五入至分'); expect(html).toContain('不适用/无法计算');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;'); expect(html).not.toMatch(/<script|<img|<iframe|<form|data-action=/i);
    expect(html).toMatch(/calculation-group[^>]* open>/); p.items[0]!.amount = '999'; expect(html).toContain('600 × 1');
  });
});
