import { describe, expect, it } from 'vitest';
import { chinaImportSampleProjectFile } from '../src/data/sample-project';
import { parseProject, serializeProject, toScenario, toTrade, SCHEMA_VERSION } from '../src/data/project-file';
import { eligibilityValues } from '../src/domain/import-context';
import { emptyEvidence, evidenceKey, fxEvidenceValues, hsEvidenceValues, taxEvidenceValues, type SourceEvidence } from '../src/domain/source-evidence';
import { analyze } from '../src/engine/analyze';
import { compare, scenarioWithDerivedInclusions } from '../src/engine/compare';
import { resolveFxRate } from '../src/engine/fx';
import { checkFxSources, checkSource } from '../src/engine/decision-readiness';
import { booksToRows, rowsToBooks } from '../src/ui/fx-rows';
import { renderOutputColumn } from '../src/ui/views-output';
import { makeCostItem } from './helpers/factory';
import { CIF_108300_SCENARIO, CIF_108300_TRADE, CONTRACT_FX_BOOK, CUSTOMS_FX_BOOK, TEST_TAX_PROFILE } from './fixtures/cif-108300';

function confirmed(values: unknown, overrides: Partial<SourceEvidence> = {}): SourceEvidence {
  const evidence: SourceEvidence = { reference: '人工核对文件 A', valid_from: '2026-08-01', valid_to: '2026-09-30', checked_on: '2026-10-11', status: 'USER_CONFIRMED', ...overrides };
  evidence.values_key = evidenceKey(values, evidence);
  return evidence;
}

function project(checked = true) {
  const project = chinaImportSampleProjectFile();
  if (checked) {
    project.tax_profile.import.eligibility!.duty_evidence = confirmed(eligibilityValues('duty', project.route, project.goods.tax_key, project.tax_profile.import));
    project.tax_profile.import.rateEvidence = confirmed(taxEvidenceValues(project.tax_profile.import));
    for (const book of project.fx_books) {
      book.evidence = Object.fromEntries(Object.entries(book.rates).map(([pair, rate]) => {
        const [from = '', to = ''] = pair.split('/');
        return [pair, confirmed(fxEvidenceValues({ ...book, from, to, rate }))];
      }));
    }
  }
  return project;
}

function run(p = project()) {
  const trade = toTrade(p);
  const template = toScenario(p);
  return analyze({ trade, scenario: scenarioWithDerivedInclusions(template, trade), taxProfile: p.tax_profile, fxBooks: p.fx_books });
}
function comparison(p = project()) {
  return compare({ trade: toTrade(p), template: toScenario(p), taxProfile: p.tax_profile, fxBooks: p.fx_books });
}

describe('来源核对与结果排名', () => {
  it.each([
    ['export_country', '', '出口国'], ['origin_country', '', '原产国'],
    ['import_country', '德国', '进口国'], ['import_country', '香港', '进口国'],
    ['customs_regime', 'OTHER', '一般贸易'], ['customs_regime', 'UNCONFIRMED', '一般贸易'],
  ])('路线 %s=%s 不满足中国一般贸易范围时保留金额并排除排名', (field, value, issue) => {
    const p = project();
    Object.assign(p.route!, { [field]: value });
    const result = run(p);
    expect(result.import_tax.vat.toFixed(2)).toBe('104663.29');
    expect(result.decision.ready).toBe(false);
    expect(result.decision.issues.join()).toContain(issue);
    expect(comparison(p).best_buyer_landed).toBeNull();
  });

  it('出口国与原产国分开核对，不根据出口国自动填入原产国', () => {
    const p = project(); p.route!.origin_country = '法国';
    p.tax_profile.import.eligibility!.duty_evidence = confirmed(eligibilityValues('duty', p.route, p.goods.tax_key, p.tax_profile.import));
    expect(run(p).decision.ready).toBe(true);
    expect(run(p).decision.context.join()).toContain('出口国/地区：德国（演示）');
    expect(run(p).decision.context.join()).toContain('原产国/地区：法国');
  });

  it('协定税率需记录协定名称及待遇条件，不自动选择税率', () => {
    const p = project(); p.tax_profile.import.hsTable!.basis = 'AGREEMENT';
    expect(run(p).decision.issues.join()).toContain('协定名称');
    p.tax_profile.import.eligibility!.agreement_name = '合成协定';
    expect(run(p).decision.issues.join()).toContain('已变动');
    p.tax_profile.import.eligibility!.duty_evidence = confirmed(eligibilityValues('duty', p.route, p.goods.tax_key, p.tax_profile.import));
    expect(run(p).decision.ready).toBe(true);
    expect(run(p).decision.context.join()).toContain('合成协定');
    expect(p.tax_profile.import.hsTable!.basis).toBe('AGREEMENT');
  });

  it.each([
    (p: ReturnType<typeof project>) => { p.route!.origin_country = '法国'; },
    (p: ReturnType<typeof project>) => { p.goods.tax_key = '123456'; },
    (p: ReturnType<typeof project>) => { p.tax_profile.import.declarationDate = '2026-09-11'; },
    (p: ReturnType<typeof project>) => { p.tax_profile.import.hsTable!.basis = 'INTERIM'; },
  ])('文件外修改路线、商品、日期或待遇后，旧资格快照失效 #%#', change => {
    const p = project(); change(p);
    const result = run(parseProject(serializeProject(p)));
    expect(result.decision.sources.find(s => s.label === '原产地与关税待遇适用条件')!.issues).toContain('数据或来源记录已变动，需要重新核对');
  });

  it.each([
    ['UNCONFIRMED', 'UNCONFIRMED'], ['OTHER', 'TAXABLE_BUSINESS'], ['GENERAL', 'OTHER'],
  ])('开启VAT抵扣但身份或用途为%s/%s时不排名', (taxpayer, use) => {
    const p = project(); const rules = p.tax_profile.import;
    rules.vatDeductibleForBuyer = true;
    Object.assign(rules.eligibility!, { vat_taxpayer: taxpayer, vat_use: use });
    rules.eligibility!.vat_evidence = confirmed(eligibilityValues('vat', p.route, p.goods.tax_key, rules));
    expect(run(p).decision.ready).toBe(false);
    expect(comparison(p).best_buyer_landed).toBeNull();
  });

  it('抵扣假设经身份、用途和资料核对后允许排名；修改原产地也令抵扣记录失效', () => {
    const p = project(); const rules = p.tax_profile.import;
    rules.vatDeductibleForBuyer = true;
    Object.assign(rules.eligibility!, { vat_taxpayer: 'GENERAL', vat_use: 'TAXABLE_BUSINESS' });
    expect(run(p).decision.ready).toBe(false);
    rules.eligibility!.vat_evidence = confirmed(eligibilityValues('vat', p.route, p.goods.tax_key, rules));
    expect(run(p).decision.ready).toBe(true);
    p.route!.origin_country = '法国';
    expect(run(p).decision.sources.find(s => s.label.includes('抵扣资格'))!.issues).toContain('数据或来源记录已变动，需要重新核对');
  });

  it('读取0.3旧文件不推断国家、制度或资格，也不丢弃已经记录的税率来源', () => {
    const p = project();
    const old = JSON.parse(serializeProject(p)); old.schema_version = '0.3';
    delete old.route; delete old.tax_profile.import.eligibility;
    const restored = parseProject(JSON.stringify(old));
    expect(restored.schema_version).toBe(SCHEMA_VERSION);
    expect(restored.route).toBeUndefined();
    expect(restored.tax_profile.import.rateEvidence).toEqual(p.tax_profile.import.rateEvidence);
    expect(run(restored).decision.ready).toBe(false);
    expect(run(restored).decision.issues.join()).toContain('一般贸易');
  });

  it.each([
    ['route', null], ['route', { export_country: '德国', import_country: '中国', origin_country: '法国', customs_regime: 'AUTO' }],
    ['eligibility', null], ['eligibility', { agreement_name: '', vat_taxpayer: 'AUTO', vat_use: 'UNCONFIRMED' }],
  ])('损坏的业务条件%s拒绝导入', (field, value) => {
    const raw = JSON.parse(serializeProject(project()));
    if (field === 'route') raw.route = value; else raw.tax_profile.import.eligibility = value;
    expect(() => parseProject(JSON.stringify(raw))).toThrow(/project\./);
  });

  it('示例仍能计算相同税款，但所有术语均排除排名', () => {
    const sample = project(false);
    const result = run(sample);
    expect(result.import_tax.vat.toFixed(2)).toBe('104663.29');
    expect(result.decision.ready).toBe(false);
    expect(result.decision.issues.join()).toContain('示例数据');
    const compared = comparison(sample);
    expect(compared.columns.every((column) => column.feasible && !column.decision_ready)).toBe(true);
    expect(compared.best_seller_margin).toBeNull();
    expect(compared.best_buyer_landed).toBeNull();
  });

  it('核对记录完整且与实际数值一致时，允许排名并列出实际数据来源', () => {
    const result = run();
    expect(result.decision.ready).toBe(true);
    expect(result.decision.issues).toEqual([]);
    expect(result.decision.sources.some((source) => source.label.includes('海关计征'))).toBe(true);
    expect(result.decision.sources.some((source) => source.label.includes('商业'))).toBe(true);
    expect(comparison().best_seller_margin).not.toBeNull();
  });

  it.each(['reference', 'checked_on', 'valid_from', 'valid_to'] as const)('缺少来源字段 %s 时保持参考状态', (field) => {
    const p = project();
    p.tax_profile.import.rateEvidence![field] = '';
    expect(run(p).decision.ready).toBe(false);
  });

  it.each([
    { valid_from: '2026-09-11' }, { valid_to: '2026-09-09' },
    { checked_on: '2026-02-30' }, { valid_from: '2026-10-01', valid_to: '2026-09-01' },
    { status: 'UNVERIFIED' as const },
  ])('适用期或核对状态有问题时不参与排名：%j', (overrides) => {
    const p = project();
    p.tax_profile.import.rateEvidence = confirmed(taxEvidenceValues(p.tax_profile.import), overrides);
    expect(run(p).decision.ready).toBe(false);
  });

  it('从旧文件读入的来源缺失不能变成已核对', () => {
    const p = project();
    delete p.tax_profile.import.rateEvidence;
    p.fx_books.forEach((book) => delete book.evidence);
    const raw = JSON.parse(serializeProject(p));
    raw.schema_version = '0.2';
    const restored = parseProject(JSON.stringify(raw));
    expect(restored.schema_version).toBe(SCHEMA_VERSION);
    expect(run(restored).decision.ready).toBe(false);
  });

  it('在文件外修改税率、汇率或来源后，旧核对快照失效', () => {
    for (const change of [
      (p: ReturnType<typeof project>) => { p.tax_profile.import.vatRate = '0.09'; },
      (p: ReturnType<typeof project>) => { p.fx_books[0]!.rates['USD/CNY'] = '7.1'; },
      (p: ReturnType<typeof project>) => { p.tax_profile.import.rateEvidence!.reference = '不同的来源'; },
    ]) {
      const p = project(); change(p);
      expect(run(parseProject(serializeProject(p))).decision.issues.join()).toContain('已变动');
    }
  });

  it('HS覆盖值按HS来源核对；未覆盖的VAT、消费税仍检查兜底来源', () => {
    const p = project();
    p.goods.tax_key = '123456';
    const entry = { code: '123456', description: '测试', duty_rates: { MFN: '0.05' } };
    p.tax_profile.import.hsTable = { basis: 'MFN', entries: [entry] };
    expect(run(p).decision.ready).toBe(false);
    p.tax_profile.import.hsTable.entries[0]!.evidence = confirmed(hsEvidenceValues(entry, 'MFN'));
    p.tax_profile.import.eligibility!.duty_evidence = confirmed(eligibilityValues('duty', p.route, p.goods.tax_key, p.tax_profile.import));
    expect(run(p).decision.ready).toBe(true);
    delete p.tax_profile.import.rateEvidence;
    expect(run(p).decision.issues.join()).toContain('进口增值税率');
  });

  it('HS关税口径发生变化时核对快照失效', () => {
    const p = project();
    const entry = { code: '123456', description: '测试', duty_rates: { MFN: '0.05', GENERAL: '0.1' } };
    p.goods.tax_key = entry.code;
    p.tax_profile.import.hsTable = { basis: 'MFN', entries: [{ ...entry, evidence: confirmed(hsEvidenceValues(entry, 'MFN')) }] };
    p.tax_profile.import.eligibility!.duty_evidence = confirmed(eligibilityValues('duty', p.route, p.goods.tax_key, p.tax_profile.import));
    expect(run(p).decision.ready).toBe(true);
    p.tax_profile.import.hsTable.basis = 'GENERAL';
    expect(run(p).decision.ready).toBe(false);
  });

  it('单独的原报价换汇也要核对，不因对比中报价已转为CNY而漏检', () => {
    const p = project();
    p.goods.trade_value = { amount: '700000', currency: 'CNY' };
    p.items.forEach((item) => { item.currency = 'CNY'; });
    delete p.fx_books[0]!.evidence;
    expect(comparison(p).best_seller_margin).toBeNull();
    expect(comparison(p).columns[0]!.decision_issues.join()).toContain('商业汇率');
  });

  it('单个术语费用归属未确定时排除该行，而非把它的成本漏计当成最优', () => {
    const p = project();
    p.items.push(makeCostItem({ cost_id: 'loading', cost_name: '装船费', cost_category: 'ORIGIN_TERMINAL', trade_node: 'CARRIER_HANDOVER', amount: '1000' }));
    const result = comparison(p);
    const fca = result.columns.find((column) => column.incoterm === 'FCA')!;
    expect(fca.feasible).toBe(true);
    expect(fca.decision_ready).toBe(false);
    expect(fca.decision_issues.join()).toContain('未计入');
    expect(result.best_seller_margin).not.toBe('FCA');
  });

  it('不完整税基与非有限税款即使能返回结果，也不能排名', () => {
    const p = project(); p.items = p.items.filter((item) => item.cost_id !== 'freight');
    expect(run(p).decision.issues.join()).toContain('完税价格');
    const result = compare({ trade: CIF_108300_TRADE, template: CIF_108300_SCENARIO, taxProfile: { ...TEST_TAX_PROFILE, import: { ...TEST_TAX_PROFILE.import, vatRate: 'NaN' } }, fxBooks: [CONTRACT_FX_BOOK, CUSTOMS_FX_BOOK] });
    expect(result.best_seller_margin).toBeNull();
    expect(result.best_buyer_landed).toBeNull();
  });

  it('每个币种对的来源随汇率行无损存取；末行无记录时不继承前行来源', () => {
    const p = project();
    const rows = booksToRows(p.fx_books);
    const books = rowsToBooks(rows);
    expect(books[0]!.evidence?.['USD/CNY']).toEqual(p.fx_books[0]!.evidence?.['USD/CNY']);
    expect(run({ ...p, fx_books: books }).decision.ready).toBe(true);
    rows.push({ ...rows[0]!, row_id: 'duplicate', rate: '8', evidence: undefined });
    expect(rowsToBooks(rows)[0]!.evidence?.['USD/CNY']).toBeUndefined();
  });

  it('反向报价只使用实际被选中的币种对来源，并核对原始值', () => {
    const row = { type: 'CUSTOMS' as const, date: '2026-08-19', valid_from: '2026-09-01', valid_to: '2026-09-30', from: 'CNY', to: 'USD', rate: '0.14' };
    const evidence = confirmed(fxEvidenceValues(row));
    const fx = resolveFxRate({ from: 'USD', to: 'CNY', fxType: 'CUSTOMS', fxDate: '2026-09-10', books: [{ id: 'r', name: 'r', ...row, rates: { 'CNY/USD': '0.14' }, evidence: { 'CNY/USD': evidence } }] });
    expect(fx.inverted).toBe(true);
    expect(checkSource('反向汇率', '2026-09-10', fx.evidence, fx.evidence_key).issues).toEqual([]);
  });

  it('非法嵌套来源结构拒绝导入', () => {
    const raw = JSON.parse(serializeProject(project()));
    raw.fx_books[0].evidence['USD/CNY'].status = 'AUTO_CERTIFIED';
    expect(() => parseProject(JSON.stringify(raw))).toThrow(/status/);
    raw.fx_books[0].evidence = null;
    expect(() => parseProject(JSON.stringify(raw))).toThrow(/evidence/);
  });

  it('两笔同数值显式汇率分别核对，已确认来源不能覆盖另一笔缺失来源', () => {
    const input = { from: 'USD', to: 'CNY', fxType: 'CONTRACT' as const, fxDate: '2026-09-10', explicitRate: '7', books: [] };
    const evidence = confirmed({ from: input.from, to: input.to, type: input.fxType, date: input.fxDate, rate: input.explicitRate });
    const checks = checkFxSources([
      resolveFxRate(input), resolveFxRate({ ...input, explicitEvidence: evidence }),
    ]);
    expect(checks).toHaveLength(2);
    expect(checks[0]!.issues).toContain('缺少来源核对记录');
    expect(checks[1]!.issues).toEqual([]);
  });

  it('FCA交货地点待确认时保留测算、排除排名，确认分支后恢复并保存往返', () => {
    const p = project();
    p.incoterm = 'FCA';
    const reference = run(p);
    expect(reference.risk.needs_confirmation).toBe(true);
    expect(reference.warnings.some(w => w.code === 'FCA_DELIVERY_UNCONFIRMED')).toBe(true);
    expect(reference.decision.ready).toBe(false);
    const compared = comparison(p);
    expect(compared.columns.find(c => c.incoterm === 'FCA')!.feasible).toBe(true);
    expect(compared.columns.find(c => c.incoterm === 'FCA')!.decision_ready).toBe(false);
    expect(compared.best_buyer_landed).not.toBe('FCA');
    const html = renderOutputColumn({ result: reference, comparison: compared, error: null });
    expect(html).toContain('交货地点待确认');

    p.facts = { delivery_place: 'SELLER_PREMISES' };
    const confirmed = run(parseProject(serializeProject(p)));
    expect(confirmed.rule_set).toEqual({ id: 'incoterms2020', version: '1.1' });
    expect(confirmed.risk.transfer_node).toBe('SELLER_PREMISES');
    expect(confirmed.risk.transfer_point).toContain('装货完成');
    expect(confirmed.decision.ready).toBe(true);
    expect(confirmed.buyer.landed_cost_with_tax.toString()).toBe(reference.buyer.landed_cost_with_tax.toString());
    p.facts = { delivery_place: 'OTHER' };
    const other = run(p);
    expect(other.risk.transfer_point).toContain('准备卸货');
    expect(other.decision.ready).toBe(true);
  });

  it('FOB班轮港杂费未确认时排除排名，引擎逐项覆盖后恢复', () => {
    const p = project(); p.incoterm = 'FOB'; p.facts = { shipping_terms: 'LINER' };
    p.items.push(makeCostItem({ cost_id: 'thc', cost_name: '待核对THC', trade_node: 'ORIGIN_TERMINAL', cost_category: 'ORIGIN_TERMINAL', amount: '150' }));
    const reference = run(p);
    expect(reference.items.find(i => i.item.cost_id === 'thc')!.responsibility).toBe('CONDITIONAL');
    expect(reference.decision.ready).toBe(false);
    const trade = toTrade(p);
    const template = { ...toScenario(p), responsibility_overrides: { thc: { responsibility: 'BUYER' as const, reason: '合同明确本项含在买方运费中' } } };
    const confirmed = analyze({ trade, scenario: scenarioWithDerivedInclusions(template, trade), taxProfile: p.tax_profile, fxBooks: p.fx_books });
    expect(confirmed.items.find(i => i.item.cost_id === 'thc')!.responsibility_source).toBe('USER_OVERRIDE');
    expect(confirmed.decision.ready).toBe(true);
    expect(confirmed.risk.transfer_point).toContain('装上船');
  });

  it('来源URL只允许http(s)链接；文本和恶意HTML都安全显示', () => {
    const p = project();
    p.tax_profile.import.rateEvidence = confirmed(taxEvidenceValues(p.tax_profile.import), { reference: 'javascript:alert(1)<img src=x>' });
    const result = run(p);
    const html = renderOutputColumn({ result, comparison: comparison(p), error: null });
    expect(html).toContain('javascript:alert(1)&lt;img src=x&gt;');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<img src=x>');
    expect(emptyEvidence().status).toBe('UNVERIFIED');
  });
});
