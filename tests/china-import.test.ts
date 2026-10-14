import { describe, expect, it } from 'vitest';
import { d, toStorage } from '../src/domain/decimal';
import type { TaxProfile } from '../src/domain/tax-profile';
import { chinaImportSampleProjectFile } from '../src/data/sample-project';
import { parseProject, SCHEMA_VERSION, serializeProject, toScenario, toTrade } from '../src/data/project-file';
import { analyze } from '../src/engine/analyze';
import { compare, scenarioWithDerivedInclusions } from '../src/engine/compare';
import { resolveFxRate } from '../src/engine/fx';
import { computeImportTaxes, totalTaxes } from '../src/engine/tax/import-tax';
import { TEST_TAX_PROFILE } from './fixtures/cif-108300';
import { makeCostItem } from './helpers/factory';

function profile(overrides: Partial<TaxProfile['import']> = {}): TaxProfile {
  return { ...TEST_TAX_PROFILE, import: {
    ...TEST_TAX_PROFILE.import, calculationMode: 'CN_GENERAL_TRADE', declarationDate: '2026-09-10', ...overrides,
  } };
}

function input() {
  const project = chinaImportSampleProjectFile();
  const trade = toTrade(project);
  return { project, trade, scenario: scenarioWithDerivedInclusions(toScenario(project), trade), taxProfile: project.tax_profile, fxBooks: project.fx_books };
}

describe('中国一般贸易进口：单商品一票', () => {
  it('人工对照用例：CIF 108300 USD；税基按 7.08，商业报价按 7.00', () => {
    const result = analyze(input());
    expect(toStorage(result.dutiable_value.value)).toBe('766764.000000');
    expect(toStorage(result.import_tax.duty)).toBe('38338.200000');
    expect(toStorage(result.import_tax.vat)).toBe('104663.290000');
    expect(toStorage(totalTaxes(result.import_tax))).toBe('143001.490000');
    expect(toStorage(result.buyer.landed_cost_with_tax)).toBe('901101.490000');
    expect(result.rebate.applicable).toBe(false);
    expect(result.seller.rebate_total.isZero()).toBe(true);
    expect(result.seller.non_refundable_vat.isZero()).toBe(true);
    expect(toStorage(result.seller.margin!)).toBe('80000.000000');
    expect(result.warnings.map((w) => w.code)).not.toContain('REBATE_DEADLINE');
  });

  it('逐项税款舍入后再进入后续税基，不仅是最终显示两位小数', () => {
    const result = computeImportTaxes({ profile: profile({ consumptionTax: { rate: '0.1', basis: 'DUTIABLE_PLUS_DUTY' } }), dutiableValue: d('1234.56') });
    expect(result.duty.toFixed(2)).toBe('61.73');
    expect(result.consumption_tax.toFixed(2)).toBe('144.03');
    expect(result.vat.toFixed(2)).toBe('187.24');
    expect(totalTaxes(result).toFixed(2)).toBe('393.00');
  });

  it.each([
    ['999.80', '0.00', true], ['999.90', '50.00', false], ['1000', '50.00', false],
  ])('小额关税边界：税基 %s，先舍入税款再按低于50元判断', (value, expected, exempt) => {
    const result = computeImportTaxes({ profile: profile(), dutiableValue: d(value) });
    expect(result.duty.toFixed(2)).toBe(expected);
    expect(result.exemption_applied).toBe(exempt);
  });

  it.each([
    ['449.91', '0.00', true], ['450', '50.00', false],
  ])('小额消费税独立判断：税基 %s', (value, expected, exempt) => {
    const result = computeImportTaxes({ profile: profile({ dutyRates: { fallback: '0' }, consumptionTax: { rate: '0.1', basis: 'DUTIABLE_PLUS_DUTY' } }), dutiableValue: d(value) });
    expect(result.consumption_tax.toFixed(2)).toBe(expected);
    expect(result.tax_exemptions?.consumption_tax).toBe(exempt);
    if (exempt) expect(result.vat.toFixed(2)).toBe('58.49');
  });

  it.each([
    ['384.53', '0.00', true], ['384.58', '50.00', false],
  ])('小额增值税独立判断：税基 %s', (value, expected, exempt) => {
    const result = computeImportTaxes({ profile: profile({ dutyRates: { fallback: '0' } }), dutiableValue: d(value) });
    expect(result.vat.toFixed(2)).toBe(expected);
    expect(result.tax_exemptions?.vat).toBe(exempt);
  });

  it('拒绝不正确的核算币种和缺少/无效申报日期', () => {
    const data = input();
    expect(() => analyze({ ...data, scenario: { ...data.scenario, base_currency: 'USD' } })).toThrow(/CNY/);
    for (const date of ['', '2026-02-30', '2026/09/10', '2024-11-30']) {
      expect(() => analyze({ ...data, taxProfile: profile({ declarationDate: date }) })).toThrow(/申报|历史/);
    }
  });

  it('计征汇率依申报日期选择，与报价和出口日期无关', () => {
    const data = input();
    data.trade.export_date = '2026-10-11';
    data.scenario.quote.fx_date = '2026-08-15';
    data.fxBooks.push({ id: 'october', name: '10月', type: 'CUSTOMS', date: '2026-09-16', valid_from: '2026-10-01', valid_to: '2026-10-31', rates: { 'USD/CNY': '8' } });
    expect(toStorage(analyze(data).dutiable_value.value)).toBe('766764.000000');
  });

  it('缺失或过期计征汇率必须阻断，不用商业汇率补缺', () => {
    for (const books of [[], input().fxBooks.filter((book) => book.type !== 'CUSTOMS')]) {
      expect(() => analyze({ ...input(), fxBooks: books })).toThrow(/汇率/);
    }
    expect(() => analyze({ ...input(), taxProfile: profile({ declarationDate: '2026-10-01' }) })).toThrow(/海关适用/);
    const data = input();
    const customs = data.fxBooks.find((book) => book.type === 'CUSTOMS')!;
    delete customs.valid_to;
    expect(() => analyze(data)).toThrow(/海关适用/);
    customs.valid_to = 'garbage';
    expect(() => analyze(data)).toThrow(/海关适用/);
  });

  it.each(['-0.1', 'NaN', 'Infinity', 'abc', '1'])('拒绝非法消费税率 %s，不输出零消费税及看似正常的VAT', (rate) => {
    expect(() => computeImportTaxes({ profile: profile({ consumptionTax: { rate, basis: 'DUTIABLE_PLUS_DUTY' } }), dutiableValue: d('10000') })).toThrow(/消费税率/);
  });

  it('拒绝负税基和无效增值税率', () => {
    expect(() => computeImportTaxes({ profile: profile(), dutiableValue: d('-100') })).toThrow(/计税价格/);
    expect(() => computeImportTaxes({ profile: profile({ vatRate: 'NaN' }), dutiableValue: d('10000') })).toThrow(/增值税率/);
  });

  it('合法消费税分母不被6位中间舍入误变成0', () => {
    const result = computeImportTaxes({ profile: profile({ consumptionTax: { rate: '0.9999999', basis: 'DUTIABLE_PLUS_DUTY' } }), dutiableValue: d('10000') });
    expect(result.consumption_tax.greaterThan(0)).toBe(true);
    expect(result.warnings.some((warning) => warning.level === 'ERROR')).toBe(false);
  });

  it('从量税必须同时给出匹配单位', () => {
    const specific = profile({ hsTable: { basis: 'MFN', entries: [{ code: '01', description: '演示', duty_type: 'SPECIFIC', specific_amount: '3.333333' }] } });
    expect(() => computeImportTaxes({ profile: specific, dutiableValue: d('1000'), taxKey: '01', quantity: '100', unit: 'KG' })).toThrow(/计量单位/);
    specific.import.hsTable!.entries[0]!.specific_unit = 'KG';
    const result = computeImportTaxes({ profile: specific, dutiableValue: d('1000'), taxKey: '01', quantity: '100', unit: 'KG' });
    expect(result.duty.toFixed(2)).toBe('333.33');
    expect(() => computeImportTaxes({ profile: specific, dutiableValue: d('1000'), taxKey: '01', quantity: '100', unit: 'PCS' })).toThrow(/无法直接换算/);
  });

  it('所选关税口径缺失时不自动改用MFN；重复HS税率不静默取最后一条', () => {
    const rules = profile({ hsTable: { basis: 'AGREEMENT', entries: [{ code: '01', description: '演示', duty_rates: { MFN: '0.1' } }] } });
    expect(() => computeImportTaxes({ profile: rules, dutiableValue: d('10000'), taxKey: '01' })).toThrow(/不自动改用/);
    rules.import.hsTable!.basis = 'MFN';
    rules.import.hsTable!.entries.push({ code: '01', description: '重复', duty_rates: { MFN: '0.2' } });
    expect(() => computeImportTaxes({ profile: rules, dutiableValue: d('10000'), taxKey: '01' })).toThrow(/重复 HS/);
  });

  it('计税费用调整可加计、排除，并且已包含在父项中的费用不重复加计', () => {
    const data = input();
    data.trade.items.push(makeCostItem({ cost_id: 'royalty', cost_name: '未含于净价的特许权使用费', amount: '1000', customs_value: 'ADD' }));
    data.trade.items.push(makeCostItem({ cost_id: 'child', amount: '300', customs_value: 'ADD', contained_in_cost_id: 'royalty' }));
    const result = analyze(data);
    expect(result.dutiable_value.value.toFixed(2)).toBe('767764.00');
    expect(result.dutiable_value.components.filter((component) => component.basis === 'ADJUSTMENT')).toHaveLength(1);
    data.trade.items.find((item) => item.cost_id === 'freight')!.customs_value = 'EXCLUDE';
    expect(analyze(data).dutiable_value.value.toFixed(2)).toBe('711124.00');
  });

  it('相同交易事实下，跨术语税额保持一致且不产生中国出口退税', () => {
    const data = input();
    const result = compare({ ...data, template: toScenario(data.project) });
    expect(new Set(result.columns.map((col) => col.import_tax_total.toFixed(2)))).toEqual(new Set(['143001.49']));
    expect(result.columns.every((col) => col.seller.rebate_total.isZero())).toBe(true);
  });

  it('计税调整费用按计税价格百分比收取时检测循环，不发生递归溢出', () => {
    const data = input();
    data.trade.items.push(makeCostItem({ cost_id: 'cycle', customs_value: 'ADD', pricing_method: 'PERCENT', rate: '0.1', calculation_base: { kind: 'CUSTOMS_DUTIABLE_VALUE' } }));
    expect(() => analyze(data)).toThrow(expect.objectContaining({ code: 'GRAPH_CYCLE' }));
  });

  it('旧版税务计算保留6位中间结果', () => {
    const result = computeImportTaxes({ profile: TEST_TAX_PROFILE, dutiableValue: d('766764') });
    expect(toStorage(result.vat)).toBe('104663.286000');
  });

  it('新文件拒绝被旧程序静默误读；旧文件可升级且不自动切换口径', () => {
    const data = input();
    const restored = parseProject(serializeProject(data.project));
    expect(restored.schema_version).toBe(SCHEMA_VERSION);
    expect(restored.tax_profile.import.calculationMode).toBe('CN_GENERAL_TRADE');
    const old = JSON.parse(serializeProject(data.project));
    old.schema_version = '0.1';
    delete old.tax_profile.import.calculationMode;
    const migrated = parseProject(JSON.stringify(old));
    expect(migrated.schema_version).toBe(SCHEMA_VERSION);
    expect(migrated.tax_profile.import.calculationMode).toBeUndefined();
  });

  it.each(['-7', 'NaN', 'Infinity', 'abc'])('汇率簿的非法汇率 %s 无论正向反向都拒绝', (rate) => {
    for (const pair of ['USD/CNY', 'CNY/USD']) {
      expect(() => resolveFxRate({ from: 'USD', to: 'CNY', fxType: 'CUSTOMS', books: [{ id: 'x', name: 'x', type: 'CUSTOMS', date: '2026-09-01', rates: { [pair]: rate } }] })).toThrow(expect.objectContaining({ code: 'FX_RATE_INVALID' }));
    }
  });
});
