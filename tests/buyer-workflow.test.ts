import { describe, expect, it } from 'vitest';
import { chinaImportSampleProjectFile, newChinaImportProjectFile } from '../src/data/sample-project';
import { parseProject, serializeProject, toScenario, toTrade, SCHEMA_VERSION } from '../src/data/project-file';
import { evidenceKey, fxEvidenceValues, taxEvidenceValues, type SourceEvidence } from '../src/domain/source-evidence';
import { eligibilityValues } from '../src/domain/import-context';
import { analyze } from '../src/engine/analyze';
import { compare, conditionalSensitivity, scenarioWithDerivedInclusions } from '../src/engine/compare';
import { renderKpis, renderOutputColumn } from '../src/ui/views-output';
import { makeCostItem } from './helpers/factory';

function confirmed(values: unknown): SourceEvidence {
  const record: SourceEvidence = { reference: '合成测试核对记录', valid_from: '2026-08-01', valid_to: '2026-09-30', checked_on: '2026-10-11', status: 'USER_CONFIRMED' };
  record.values_key = evidenceKey(values, record); return record;
}
function project(cost = '') {
  const p = chinaImportSampleProjectFile();
  p.goods.seller_goods_cost.amount = cost;
  p.tax_profile.import.rateEvidence = confirmed(taxEvidenceValues(p.tax_profile.import));
  p.tax_profile.import.eligibility!.duty_evidence = confirmed(eligibilityValues('duty', p.route, p.goods.tax_key, p.tax_profile.import));
  for (const book of p.fx_books) book.evidence = Object.fromEntries(Object.entries(book.rates).map(([pair, rate]) => {
    const [from = '', to = ''] = pair.split('/'); return [pair, confirmed(fxEvidenceValues({ ...book, from, to, rate }))];
  }));
  return p;
}
function input(p = project()) { return { trade: toTrade(p), template: toScenario(p), taxProfile: p.tax_profile, fxBooks: p.fx_books }; }
function run(p = project()) { const value = input(p); return analyze({ ...value, scenario: scenarioWithDerivedInclusions(value.template, value.trade) }); }

describe('中国进口买方工作流', () => {
  it('空白项目不填演示金额、日期、税率、原产地或汇率；未完成输入可存取', () => {
    const p = newChinaImportProjectFile();
    expect(p.goods.trade_value.amount).toBe('');
    expect(p.quote.amount).toBe('');
    expect(p.goods.seller_goods_cost.amount).toBe('');
    expect(p.tax_profile.import.dutyRates.fallback).toBe('');
    expect(p.tax_profile.import.vatRate).toBe('');
    expect(p.tax_profile.import.declarationDate).toBe('');
    expect(p.goods.trade_value_basis).toBe('UNCONFIRMED');
    expect(p.route!.origin_country).toBe('');
    expect(p.items).toEqual([]); expect(p.fx_books).toEqual([]);
    expect(parseProject(serializeProject(p))).toEqual(p);
    expect(() => run(p)).toThrow(/申报日期/);
  });

  it.each(['', '   '])('卖方成本%s为空时利润为null，买方金额保持不变并可独立排名', cost => {
    const p = project(cost); const result = run(p); const comparison = compare(input(p));
    expect(result.seller.goods_cost).toBeNull();
    expect(result.seller.margin).toBeNull();
    expect(result.seller.margin_ex_rebate).toBeNull();
    expect(result.buyer.landed_cost_with_tax.toFixed(2)).toBe('901101.49');
    expect(result.decision.ready).toBe(true);
    expect(comparison.best_seller_margin).toBeNull();
    expect(comparison.best_buyer_landed).not.toBeNull();
    expect(comparison.columns.every(c => c.seller.margin === null)).toBe(true);
    const state = { result, comparison, error: null };
    expect(renderKpis(state)).toContain('无法评估');
    expect(renderOutputColumn(state)).toContain('采购成本未知，不参与利润排名');
    expect(renderOutputColumn(state)).not.toContain('可排名方案中卖方利润最高');
  });

  it('输入实际0仍表示已知零成本，不等于未知成本', () => {
    const p = project('0'); const result = run(p);
    expect(result.seller.goods_cost!.isZero()).toBe(true);
    expect(result.seller.margin!.toFixed(2)).toBe('700000.00');
    expect(compare(input(p)).best_seller_margin).not.toBeNull();
  });

  it('未知采购成本不解析其外币，不需要不存在的卖方成本汇率', () => {
    const p = project(); p.goods.seller_goods_cost.currency = 'GBP';
    expect(run(p).buyer.landed_cost_with_tax.toFixed(2)).toBe('901101.49');
    expect(run(p).decision.sources.some(s => s.label.includes('GBP'))).toBe(false);
  });

  it.each(['1,000', 'NaN', 'abc'])('非空非法采购成本%s不能变成未知或零', cost => {
    expect(() => run(project(cost))).toThrow(/卖方采购成本.*有效数字/);
  });

  it('旧模式仍需采购成本，以免缺失数据误用于出口退税', () => {
    const p = project(); p.tax_profile.import.calculationMode = 'LEGACY';
    expect(() => run(p)).toThrow(/卖方采购成本.*未填写/);
  });

  it('未知采购成本阻止目标利润率反推，仍支持固定买方支付', () => {
    const p = project(); const value = input(p);
    expect(() => compare({ ...value, anchor: { kind: 'FIXED_MARGIN_RATE', margin_rate: '0.2' } })).toThrow(/采购成本未知.*目标利润率/);
    const compared = compare({ ...value, anchor: { kind: 'FIXED_MARKET_PRICE', buyer_total: '901101.49', currency: 'CNY' } });
    expect(compared.columns.every(c => c.feasible && c.seller.margin === null)).toBe(true);
    expect(compared.best_buyer_landed).not.toBeNull();
  });

  it('货物净价单独录入时仍可核对报价构成，不需要第二行商品金额', () => {
    const p = project(); p.items = p.items.filter(item => !item.is_goods_value);
    const result = run(p);
    expect(result.buyer.landed_cost_with_tax.toFixed(2)).toBe('901101.49');
    expect(result.warnings.some(w => w.code === 'QUOTE_NOT_RECONCILED')).toBe(false);
    p.quote.amount = '109000';
    expect(run(p).warnings.some(w => w.code === 'QUOTE_NOT_RECONCILED')).toBe(true);
  });

  it('原有商品货值行保留时不再次加计净价', () => {
    const result = run();
    expect(result.warnings.some(w => w.code === 'QUOTE_NOT_RECONCILED')).toBe(false);
    expect(result.import_tax.vat.toFixed(2)).toBe('104663.29');
  });

  it('净价口径未确认可参考但不排名；已知整价含运保费时阻断并提示拆分', () => {
    const p = project(); p.goods.trade_value_basis = 'UNCONFIRMED';
    expect(run(p).buyer.landed_cost_with_tax.toFixed(2)).toBe('901101.49');
    expect(compare(input(p)).best_buyer_landed).toBeNull();
    p.goods.trade_value_basis = 'INCLUDES_FREIGHT_INSURANCE';
    expect(() => run(p)).toThrow(/先拆出货物净价/);
  });

  it('0.4旧文件不猜测净价口径；未知成本和未完成输入按0.5存取', () => {
    const p = project(); const raw = JSON.parse(serializeProject(p));
    raw.schema_version = '0.4'; delete raw.goods.trade_value_basis;
    const restored = parseProject(JSON.stringify(raw));
    expect(restored.schema_version).toBe(SCHEMA_VERSION);
    expect(restored.goods.trade_value_basis).toBeUndefined();
    expect(run(restored).seller.margin).toBeNull();
    expect(run(restored).decision.ready).toBe(false);
  });

  it('责任敏感性仍能比较费用差额，绝对卖方利润保持未知', () => {
    const p = project();
    p.items.push(makeCostItem({ cost_id: 'loading', cost_name: '装船费', cost_category: 'ORIGIN_TERMINAL', trade_node: 'CARRIER_HANDOVER', amount: '1000' }));
    const value = input(p); value.template.incoterm = 'FCA'; value.template.quote.incoterm = 'FCA';
    const row = conditionalSensitivity(value, value.template).find(c => c.cost_id === 'loading')!;
    expect(row.seller_margin_if_buyer).toBeNull(); expect(row.seller_margin_if_seller).toBeNull();
    expect(row.seller_margin_delta.toFixed(2)).toBe('1000.00');
    expect(row.buyer_landed_delta.toFixed(2)).toBe('1000.00');
  });
});
