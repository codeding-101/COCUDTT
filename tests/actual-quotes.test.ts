import { describe, expect, it } from 'vitest';
import { parseProject, serializeProject, toScenario, toScenarios, toTrade, type ProjectFile } from '../src/data/project-file';
import { analyze } from '../src/engine/analyze';
import { compare, scenarioWithDerivedInclusions } from '../src/engine/compare';
import { createProjectReport } from '../src/ui/project-report';
import { renderContractPanel } from '../src/ui/contracts-input';
import { renderOutputColumn } from '../src/ui/views-output';
import { actualQuotesProject, confirmInsurance, confirmOverride, confirmQuote, syntheticEvidence } from './fixtures/actual-quotes';
import { makeCostItem } from './helpers/factory';
import { fxEvidenceValues } from '../src/domain/source-evidence';

function input(p: ProjectFile) { return { trade: toTrade(p), template: toScenario(p), scenarios: toScenarios(p), anchor: p.anchor, taxProfile: p.tax_profile, fxBooks: p.fx_books }; }
function run(p: ProjectFile) { const i = input(p); return analyze({ ...i, scenario: scenarioWithDerivedInclusions(i.template, i.trade) }); }
function columns(p: ProjectFile) { return compare(input(p)); }
function col(p: ProjectFile, term = 'CIF') { return columns(p).columns.find(x => x.incoterm === term)!; }

describe('各方案独立合同报价与费用约定', () => {
  it('实际FOB/CIF报价与各自运价联动计算，其他术语缺失不补齐；未知采购成本仍可比较买方', () => {
    const p = actualQuotesProject(); const before = JSON.stringify(p); const c = columns(p);
    const cif = c.columns.find(x => x.incoterm === 'CIF')!; const fob = c.columns.find(x => x.incoterm === 'FOB')!;
    expect(cif.quote_amount.toFixed(2)).toBe('10700.00'); expect(fob.quote_amount.toFixed(2)).toBe('10000.00');
    expect(cif.buyer.landed_cost_with_tax.toFixed(2)).toBe('12695.55'); expect(fob.buyer.landed_cost_with_tax.toFixed(2)).toBe('13170.15');
    expect(cif.import_tax_total.toFixed(2)).toBe('1995.55'); expect(fob.import_tax_total.toFixed(2)).toBe('2070.15');
    expect(cif.decision_issues).toEqual([]); expect(fob.decision_issues).toEqual([]);
    expect(c.columns.filter(x => x.feasible)).toHaveLength(2);
    expect(c.best_buyer_landed).toBe('CIF'); expect(c.best_seller_margin).toBeNull(); expect(JSON.stringify(p)).toBe(before);
  });
  it.each(['2026-09-01', '2026-09-30'])('报价有效期包含首尾日期 %s；税源继续按申报日期核对', date => {
    const p = actualQuotesProject(); p.evaluation_date = date;
    expect(col(p).decision_ready).toBe(true); expect(run(p).decision.ready).toBe(true);
  });
  it.each(['', '2026-02-30', '2026-08-31', '2026-10-01'])('比较日期 %s 缺失、无效或超期时保留参考金额并排除排名', date => {
    const p = actualQuotesProject(); p.evaluation_date = date;
    expect(col(p).feasible).toBe(true); expect(col(p).decision_ready).toBe(false); expect(columns(p).best_buyer_landed).toBeNull();
    expect(run(p).decision.ready).toBe(false); expect(run(p).decision.issues.join()).toMatch(/日期|适用期/);
  });
  it('仅CIF过期时不影响FOB排名，并保留CIF金额', () => {
    const p = actualQuotesProject(); confirmQuote(p, 'CIF', { valid_to: '2026-09-09' });
    expect(col(p).feasible).toBe(true); expect(col(p).decision_ready).toBe(false); expect(columns(p).best_buyer_landed).toBe('FOB');
  });
  it.each(['EXAMPLE', 'UNVERIFIED'] as const)('报价状态%s不参与推荐', status => {
    const p = actualQuotesProject(); p.term_scenarios!.CIF!.quote_evidence!.status = status;
    expect(col(p).decision_ready).toBe(false); expect(columns(p).best_buyer_landed).toBe('FOB');
  });
  it('商品、金额、指定地点或来源被文件修改后，旧核对快照失效', () => {
    for (const change of [
      (p: ProjectFile) => { p.goods.quantity = '2'; },
      (p: ProjectFile) => { p.term_scenarios!.CIF!.quote!.amount = '10699'; },
      (p: ProjectFile) => { p.term_scenarios!.CIF!.quote!.named_place = '其他港口'; },
      (p: ProjectFile) => { p.term_scenarios!.CIF!.quote_evidence!.reference = '替换凭证'; },
    ]) {
      const p = actualQuotesProject(); change(p); expect(col(p).decision_ready).toBe(false);
      expect(col(p).decision_issues.join()).toContain('重新核对');
    }
  });
  it('实际报价未填写指定地点，或货物净价与报价构成不一致时，不能作为确定排名', () => {
    const p = actualQuotesProject(); p.term_scenarios!.CIF!.quote!.named_place = ''; confirmQuote(p, 'CIF');
    expect(col(p).decision_issues.join()).toContain('指定地点');
    p.term_scenarios!.CIF!.quote!.named_place = '上海'; p.term_scenarios!.CIF!.quote!.amount = '10800'; confirmQuote(p, 'CIF');
    expect(col(p).decision_ready).toBe(false); expect(col(p).decision_issues.join()).toContain('报价构成');
  });
  it.each(['', '0', '-1', 'NaN', 'abc', '1,000'])('CIF金额 %s 无效时仅阻断CIF列，FOB继续计算', amount => {
    const p = actualQuotesProject(); p.term_scenarios!.CIF!.quote!.amount = amount;
    expect(col(p).feasible).toBe(false); expect(col(p, 'FOB').decision_ready).toBe(true); expect(columns(p).best_buyer_landed).toBe('FOB');
  });
  it('独立币种及商业汇率日期不使用公共报价汇率；一个方案缺汇率不阻断另一方案', () => {
    const p = actualQuotesProject(); p.term_scenarios!.CIF!.quote = { amount: '1528.57142857142857', currency: 'USD', fx_type: 'CONTRACT', fx_date: '2026-09-15', named_place: '上海' };
    p.fx_books = [{ id: 'contract-usd', name: '合成商业汇率', type: 'CONTRACT', date: '2026-09-15', rates: { 'USD/CNY': '7' },
      evidence: { 'USD/CNY': syntheticEvidence(fxEvidenceValues({ type: 'CONTRACT', date: '2026-09-15', from: 'USD', to: 'CNY', rate: '7' })) } }];
    p.quote = { amount: '', currency: 'GBP', fx_type: 'MARKET', fx_date: '1999-01-01' }; confirmQuote(p, 'CIF');
    p.term_scenarios!.CIF!.insurance!.sum_insured = { amount: '1682', currency: 'USD' }; confirmInsurance(p, 'CIF');
    expect(col(p).quote_amount.toFixed(2)).toBe('10700.00'); expect(col(p).decision_ready).toBe(true);
    p.fx_books = []; expect(col(p).feasible).toBe(false); expect(col(p, 'FOB').decision_ready).toBe(true);
  });
  it('缺少实际报价映射不能回退到共享报价；币种或术语错配被拒绝', () => {
    const p = actualQuotesProject(); const i = input(p);
    expect(compare({ ...i, scenarios: undefined }).columns.every(x => !x.feasible)).toBe(true);
    i.scenarios.CIF!.quote.incoterm = 'FOB'; expect(compare(i).columns.find(x => x.incoterm === 'CIF')!.infeasible_reason).toContain('术语');
    i.scenarios.CIF!.quote.incoterm = 'CIF'; i.scenarios.CIF!.base_currency = 'USD';
    expect(compare(i).columns.find(x => x.incoterm === 'CIF')!.infeasible_reason).toContain('核算币种');
  });
  it('FOB港杂费合同约定只改变FOB费用，未确认时仍不推荐，风险继续为装船', () => {
    const p = actualQuotesProject(); p.incoterm = 'FOB'; p.facts = { shipping_terms: 'LINER' };
    p.items.push(makeCostItem({ cost_id: 'thc', cost_name: '起运港THC', cost_category: 'ORIGIN_TERMINAL', trade_node: 'ORIGIN_TERMINAL', amount: '150' }));
    confirmQuote(p, 'FOB'); confirmQuote(p, 'CIF');
    expect(col(p, 'FOB').decision_ready).toBe(false);
    p.term_scenarios!.FOB!.responsibility_overrides = { ...p.term_scenarios!.FOB!.responsibility_overrides, thc: { responsibility: 'SELLER', reason: '合同约定卖方承担起运港THC' } };
    confirmOverride(p, 'FOB', 'insurance');
    p.term_scenarios!.FOB!.quote!.amount = '10150'; confirmQuote(p, 'FOB');
    expect(col(p, 'FOB').result!.items.find(x => x.item.cost_id === 'thc')!.responsibility).toBe('SELLER');
    expect(col(p, 'FOB').decision_ready).toBe(false); confirmOverride(p, 'FOB', 'thc');
    expect(col(p, 'FOB').decision_issues).toEqual([]); expect(col(p, 'FOB').transfer_point).toContain('装上船');
    expect(toScenario(p, 'CIF').responsibility_overrides).toBeUndefined();
    p.items.at(-1)!.amount = '151'; expect(col(p, 'FOB').decision_issues.join()).toContain('重新核对');
  });
  it('费用约定缺说明、引用不存在费用或已过期时暴露待办；未启用费用约定不阻止当前方案', () => {
    const p = actualQuotesProject(); p.term_scenarios!.CIF!.responsibility_overrides = { insurance: { responsibility: 'SELLER' } };
    confirmOverride(p, 'CIF', 'insurance'); expect(col(p).decision_issues.join()).toContain('条款说明');
    p.term_scenarios!.CIF!.responsibility_overrides!.insurance!.reason = '保险费由卖方承担';
    confirmOverride(p, 'CIF', 'insurance', { valid_to: '2026-09-09' });
    expect(col(p).decision_issues.join()).toContain('适用期');
    p.term_scenarios!.CIF!.responsibility_overrides = { missing: { responsibility: 'SELLER', reason: '不存在的费用' } };
    expect(col(p).decision_issues.join()).toContain('不存在的费用');
    p.term_scenarios!.CIF!.responsibility_overrides = { 'buyer-freight': { responsibility: 'BUYER' } };
    expect(col(p).decision_ready).toBe(true);
  });
  it('切换模拟基准后实际报价与核对记录保留，不用实际报价冒充反推结果', () => {
    const p = actualQuotesProject(); const records = JSON.stringify(p.term_scenarios);
    p.anchor = { kind: 'FIXED_QUOTE' }; p.quote = { amount: '9000', currency: 'CNY', fx_type: 'CONTRACT' };
    expect(col(p).quote_amount.toFixed(2)).toBe('9000.00'); expect(run(p).decision.sources.some(x => x.label.includes('合同报价'))).toBe(false);
    expect(JSON.stringify(p.term_scenarios)).toBe(records);
    p.anchor = { kind: 'ACTUAL_QUOTES' }; expect(col(p).quote_amount.toFixed(2)).toBe('10700.00');
  });
  it('0.7完整存取，0.6旧文件不生成实际报价，错误映射和结构拒绝打开', () => {
    const p = actualQuotesProject(); const restored = parseProject(serializeProject(p));
    expect(restored.term_scenarios).toEqual(p.term_scenarios); expect(restored.schema_version).toBe('0.8'); expect(col(restored).decision_ready).toBe(true);
    const old = { ...p, schema_version: '0.6', term_scenarios: undefined, evaluation_date: undefined, anchor: { kind: 'FIXED_QUOTE' } };
    expect(parseProject(JSON.stringify(old)).term_scenarios).toBeUndefined();
    for (const bad of [{ FOO: {} }, { CIF: { quote: null } }, { CIF: { quote_evidence: {} } }, { CIF: { responsibility_overrides: { insurance: { responsibility: 'SHARED' } } } }]) {
      expect(() => parseProject(JSON.stringify({ ...p, term_scenarios: bad }))).toThrow(/term_scenarios/);
    }
  });
  it('内部报告冻结独立报价、比较日期与来源；文本转义且没有脚本，界面无公共报价回退', () => {
    const p = actualQuotesProject(); p.term_scenarios!.CIF!.quote!.named_place = '<script>alert(1)</script>'; confirmQuote(p, 'CIF');
    const report = createProjectReport(p, '2026-10-11T00:00:00Z');
    expect(report).toContain('各方案实际报价'); expect(report).toContain('合同比较日期'); expect(report).toContain('CIF 合同报价');
    expect(report).toContain('&lt;script&gt;alert(1)&lt;/script&gt;'); expect(report).not.toContain('<script>');
    expect(renderContractPanel(p)).toContain('term_scenarios.CIF.quote.amount');
    expect(renderOutputColumn({ result: run(p), comparison: columns(p), error: null })).not.toContain('固定报价仍假设');
    p.term_scenarios!.CIF!.quote!.amount = '2'; expect(report).toContain('10700');
  });
});
