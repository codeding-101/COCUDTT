import { describe, expect, it } from 'vitest';
import { parseProject, serializeProject, toScenario, toScenarios, toTrade, type ProjectFile } from '../src/data/project-file';
import { analyze } from '../src/engine/analyze';
import { compare, scenarioWithDerivedInclusions } from '../src/engine/compare';
import { logisticsProject, confirmTransport } from './fixtures/logistics-project';
import { actualQuotesProject, confirmInsurance, confirmQuote, confirmOverride } from './fixtures/actual-quotes';
import { makeCostItem } from './helpers/factory';
import { createProjectReport } from '../src/ui/project-report';
import { renderOutputColumn } from '../src/ui/views-output';
import { COST_PRESETS, presetToCostItem } from '../src/data/cost-presets';
import { renderLogisticsPanel } from '../src/ui/logistics-input';

function input(p: ProjectFile) { return { trade: toTrade(p), template: toScenario(p), scenarios: toScenarios(p), anchor: p.anchor, taxProfile: p.tax_profile, fxBooks: p.fx_books }; }
function run(p: ProjectFile) { const i = input(p); return analyze({ ...i, scenario: scenarioWithDerivedInclusions(i.template, i.trade) }); }

describe('运输交货、保单保障与集装箱漏项核对', () => {
  it.each(['CPT', 'CIP'] as const)('%s陆海陆组合只在第一承运人处交货，运费支付终点独立；不重复计入运输段金额', term => {
    const p = logisticsProject(term); const before = JSON.stringify(p); const r = run(p);
    expect(r.decision.issues).toEqual([]); expect(r.risk.separation).toBe(true); expect(r.risk.transfer_point).toContain('汉堡工厂');
    expect(r.logistics.transport!.delivery_index).toBe(0); expect(r.logistics.transport!.plan.paid_to).toBe('上海仓库');
    expect(r.buyer.landed_cost_with_tax.toFixed(2)).toBe('12695.55'); expect(JSON.stringify(p)).toBe(before);
    expect((renderOutputColumn({ result: r, comparison: compare(input(p)), error: null }).match(/data-risk-event/g) ?? []).length).toBe(1);
  });
  it('CIF交货落在海运段起点上船，前后陆运不被当作风险重新转移', () => {
    const r = run(logisticsProject('CIF')); expect(r.decision.ready).toBe(true);
    expect(r.logistics.transport!.delivery_index).toBe(1); expect(r.risk.transfer_point).toContain('装上船');
    expect(r.risk.transfer_point).toContain('汉堡港'); expect(r.logistics.transport!.plan.paid_to).toBe('上海港');
  });
  it('实际多式联运缺运输段时保留参考金额、排除排名；不从模式推定具体交货点', () => {
    const p = logisticsProject(); delete p.term_scenarios!.CIP!.transport; confirmInsurance(p, 'CIP');
    const r = run(p); expect(r.decision.issues.join()).toContain('尚未录入运输分段'); expect(r.risk.needs_confirmation).toBe(true);
    expect(r.buyer.landed_cost_with_tax.toFixed(2)).toBe('12695.55'); expect(compare(input(p)).best_buyer_landed).toBeNull();
  });
  it('后续承运人不是默认第一承运人；明确交货约定有来源后才通过', () => {
    const p = logisticsProject('CPT'); const plan = p.term_scenarios!.CPT!.transport!;
    plan.delivery_segment_id = 'sea'; plan.delivery_location = '汉堡港'; confirmTransport(p);
    expect(run(p).decision.issues.join()).toContain('第一承运人交货应为首段起点');
    plan.handover_basis = 'AGREED_POINT'; expect(run(p).decision.issues.join()).toContain('合同条款说明');
    plan.agreement_note = '合成合同明确约定在汉堡港交给该承运人'; confirmTransport(p);
    expect(run(p).decision.ready).toBe(true); expect(run(p).logistics.transport!.delivery_index).toBe(1);
  });
  it.each(['event', 'sea-mode', 'destination'])('CIF不能把%s当作上船交货', branch => {
    const p = logisticsProject('CIF'); const plan = p.term_scenarios!.CIF!.transport!;
    if (branch === 'event') plan.delivery_event = 'CARRIER_HANDOVER';
    if (branch === 'sea-mode') plan.segments[1]!.mode = 'ROAD';
    if (branch === 'destination') { plan.delivery_at = 'DESTINATION'; plan.delivery_location = '上海港'; }
    confirmTransport(p); confirmInsurance(p, 'CIF'); expect(run(p).decision.ready).toBe(false); expect(run(p).risk.needs_confirmation).toBe(true);
  });
  it.each(['missing-leg', 'duplicate', 'gap', 'carrier', 'point', 'paid-to', 'unconfirmed'])('运输计划%s缺陷保留输入和金额，展示可行动待办', kind => {
    const p = logisticsProject('CPT'); const plan = p.term_scenarios!.CPT!.transport!;
    if (kind === 'missing-leg') plan.delivery_segment_id = 'gone';
    if (kind === 'duplicate') plan.segments[1]!.segment_id = plan.segments[0]!.segment_id;
    if (kind === 'gap') plan.segments[1]!.from = '另一港口';
    if (kind === 'carrier') plan.segments[0]!.carrier = '';
    if (kind === 'point') plan.delivery_location = '段内地点';
    if (kind === 'paid-to') plan.paid_to = '另一个目的地';
    confirmTransport(p); if (kind === 'unconfirmed') plan.evidence!.status = 'UNVERIFIED';
    const r = run(p); expect(r.decision.ready).toBe(false); expect(r.logistics.transport!.issues.length).toBeGreaterThan(0);
    expect(r.buyer.landed_cost_with_tax.toFixed(2)).toBe('12695.55');
  });
  it('运输事实被外部JSON修改后，运输和相关保险的核对快照均失效', () => {
    const p = logisticsProject(); p.term_scenarios!.CIP!.transport!.segments[0]!.carrier = '替换承运人';
    const r = run(p); expect(r.logistics.transport!.issues.join()).toContain('重新核对'); expect(r.logistics.insurance.issues.join()).toContain('重新核对');
  });
  it('实际多式联运不能用单一运输方式的分段冒充完整组合', () => {
    const p = logisticsProject('CPT'); p.term_scenarios!.CPT!.transport!.segments.forEach(segment => { segment.mode = 'ROAD'; }); confirmTransport(p);
    expect(run(p).decision.issues.join()).toContain('至少两种运输方式');
  });
  it('DPU卸货完成与DAP准备卸货不同，末段前的接管不等于目的地交货', () => {
    const p = logisticsProject('CPT'); const record = p.term_scenarios!.CPT!; p.term_scenarios!.DPU = record;
    p.incoterm = 'DPU'; p.items[0]!.applicable_incoterms!.push('DPU'); record.quote!.amount = '10700';
    record.responsibility_overrides!.insurance!.responsibility = 'SELLER'; confirmOverride(p, 'DPU', 'insurance');
    record.transport!.delivery_segment_id = 'road-destination'; record.transport!.delivery_at = 'DESTINATION'; record.transport!.delivery_location = '上海仓库'; record.transport!.delivery_event = 'UNLOADED';
    confirmQuote(p, 'DPU'); confirmTransport(p); expect(run(p).decision.ready).toBe(true);
    record.transport!.delivery_segment_id = 'sea'; record.transport!.delivery_location = '上海港'; confirmTransport(p);
    expect(run(p).decision.issues.join()).toContain('末段终点');
  });
  it('保费不能代替保障资料；旧0.7实际CIF缺保单时仍能计算但退出排名', () => {
    const p = actualQuotesProject(); delete p.term_scenarios!.CIF!.insurance;
    const restored = parseProject(JSON.stringify({ ...p, schema_version: '0.7' }));
    expect(restored.term_scenarios!.CIF!.insurance).toBeUndefined(); expect(run(restored).decision.issues.join()).toContain('保费金额不代表');
    expect(run(restored).buyer.landed_cost_with_tax.toFixed(2)).toBe('12695.55'); expect(compare(input(restored)).best_buyer_landed).toBe('FOB');
  });
  it.each(['11769.99', '0', '-1', '', 'NaN', 'Infinity', 'garbage'])('CIF保额%s不能通过110%%基线，但不会计入成本或税基', amount => {
    const p = actualQuotesProject(); p.term_scenarios!.CIF!.insurance!.sum_insured.amount = amount; confirmInsurance(p, 'CIF');
    const r = run(p); expect(r.decision.ready).toBe(false); expect(r.dutiable_value.value.toFixed(2)).toBe('10700.00'); expect(r.buyer.landed_cost_with_tax.toFixed(2)).toBe('12695.55');
  });
  it('110%恰好通过，保额增加不增加成本；币种错配不按汇率悄悄转换', () => {
    const p = actualQuotesProject(); expect(run(p).logistics.insurance.minimum_amount!.toString()).toBe('11770'); expect(run(p).decision.ready).toBe(true);
    p.term_scenarios!.CIF!.insurance!.sum_insured.amount = '999999'; confirmInsurance(p, 'CIF'); expect(run(p).buyer.landed_cost_with_tax.toFixed(2)).toBe('12695.55');
    p.term_scenarios!.CIF!.insurance!.sum_insured.currency = 'USD'; confirmInsurance(p, 'CIF');
    expect(run(p).decision.issues.join()).toContain('保额币种'); expect(run(p).logistics.insurance.sum_insured_currency).toBe('USD');
  });
  it('CIF默认C及更高保障可核对，CIP较低险别须另有约定，约定不绕过保额最低检查', () => {
    const p = logisticsProject(); const policy = p.term_scenarios!.CIP!.insurance!;
    policy.cover = 'ICC_C'; confirmInsurance(p, 'CIP'); expect(run(p).decision.issues.join()).toContain('险别');
    policy.agreed_cover_note = '合成双方合同约定较低险别，须专业复核'; confirmInsurance(p, 'CIP'); expect(run(p).decision.ready).toBe(true);
    policy.sum_insured.amount = '10000'; confirmInsurance(p, 'CIP'); expect(run(p).decision.issues.join()).toContain('110%');
    const cif = actualQuotesProject(); cif.term_scenarios!.CIF!.insurance!.cover = 'ICC_A'; confirmInsurance(cif, 'CIF'); expect(run(cif).decision.ready).toBe(true);
  });
  it.each(['scope', 'direct-claim', 'version', 'policy', 'insurer', 'deductible', 'exclusions', 'source'])('保单%s缺失不作为已核对保障', field => {
    const p = actualQuotesProject(); const policy = p.term_scenarios!.CIF!.insurance!;
    if (field === 'scope') policy.scope_confirmed = false;
    if (field === 'direct-claim') policy.direct_claim_confirmed = false;
    if (field === 'version') policy.clause_version = '';
    if (field === 'policy') policy.policy_reference = '';
    if (field === 'insurer') policy.insurer = '';
    if (field === 'deductible') policy.deductible = '';
    if (field === 'exclusions') policy.exclusions = '';
    confirmInsurance(p, 'CIF'); if (field === 'source') delete policy.evidence;
    expect(run(p).decision.ready).toBe(false); expect(run(p).logistics.insurance.issues.length).toBeGreaterThan(0);
  });
  it('模拟反推使用原合同价格核对保单，不把反推新价自动当成已保险', () => {
    const p = actualQuotesProject(); p.anchor = { kind: 'FIXED_MARKET_PRICE', buyer_total: '14000', currency: 'CNY' }; p.quote = { amount: '10700', currency: 'CNY', fx_type: 'CONTRACT' };
    const cif = compare(input(p)).columns.find(column => column.incoterm === 'CIF')!;
    expect(cif.quote_amount.toFixed(2)).toBe('12004.45'); expect(cif.result!.logistics.insurance.minimum_amount!.toFixed(2)).toBe('11770.00');
    expect(cif.decision_ready).toBe(true); expect(cif.result!.decision.context.join()).toContain('模拟反推报价不自动改变');
  });
  it('集装箱提醒不自动补零或生成费用；联合与分开收费在同范围冲突，不同范围和包含分项不误算', () => {
    const p = actualQuotesProject(); p.facts = { loading_mode: 'FCL' }; confirmQuote(p, 'CIF'); const before = p.items.length;
    expect(run(p).logistics.container_reminders.join()).toContain('免费期'); expect(p.items).toHaveLength(before);
    const combined = makeCostItem({ cost_id: 'dd', amount: '200', trade_node: 'DESTINATION_TERMINAL', cost_category: 'DESTINATION_TERMINAL', container_charge: 'COMBINED_DD', applicable_incoterms: ['CIF'] });
    const separate = makeCostItem({ ...combined, cost_id: 'dem', amount: '100', container_charge: 'DEMURRAGE' }); p.items.push(combined, separate);
    expect(run(p).decision.issues.join()).toContain('联合D&D');
    separate.container_charge_scope = '不同箱及期间'; expect(run(p).decision.issues.join()).not.toContain('联合D&D');
    delete separate.container_charge_scope; separate.contained_in_cost_id = 'dd'; expect(run(p).decision.issues.join()).not.toContain('联合D&D');
  });
  it('新增预设为明确类型，旧合并名不推定联合口径；空费用草稿允许保存', () => {
    const input = { cost_id: 'test', currency: 'CNY', base_currency: 'CNY', days: '', rate: '' };
    const item = presetToCostItem(COST_PRESETS.find(preset => preset.key === 'container-detention')!, input);
    expect(item.container_charge).toBe('DETENTION'); expect(item.rate).toBe(''); expect(item.days).toBe('');
    expect(presetToCostItem(COST_PRESETS.find(preset => preset.key === 'demurrage')!, input).container_charge).toBeUndefined();
    const p = actualQuotesProject(); p.items.push(item); expect(parseProject(serializeProject(p)).items.at(-1)!.container_charge).toBe('DETENTION');
  });
  it('0.8运输/保险配置、来源与精度往返完整；坏结构不会成为可打开的草稿', () => {
    const p = logisticsProject(); p.term_scenarios!.CIP!.insurance!.sum_insured.amount = '11770.123456789'; confirmInsurance(p, 'CIP');
    const restored = parseProject(serializeProject(p)); expect(restored).toEqual(p); expect(restored.schema_version).toBe('0.8'); expect(run(restored).decision.ready).toBe(true);
    for (const bad of [null, { ...p.term_scenarios!.CIP!.transport, segments: {} }, { ...p.term_scenarios!.CIP!.transport, delivery_event: 'ARRIVED_ANYWHERE' }]) {
      const raw = structuredClone(p); (raw.term_scenarios!.CIP as unknown as Record<string, unknown>).transport = bad; expect(() => parseProject(JSON.stringify(raw))).toThrow(/transport/);
    }
    const raw = structuredClone(p); (raw.term_scenarios!.CIP!.insurance as unknown as Record<string, unknown>).scope_confirmed = 'yes'; expect(() => parseProject(JSON.stringify(raw))).toThrow(/scope_confirmed/);
  });
  it('内部报告冻结分段、保单和唯一交货点；不漏除外条款，用户文本转义', () => {
    const p = logisticsProject(); p.term_scenarios!.CIP!.insurance!.exclusions = '<script>alert(1)</script>'; confirmInsurance(p, 'CIP');
    const html = createProjectReport(p, '2026-10-12T00:00:00Z'); expect(html).toContain('合成公路承运人'); expect(html).toContain('11770.00');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;'); expect(html).not.toContain('<script>'); expect((html.match(/data-risk-event/g) ?? []).length).toBe(1);
    expect(renderLogisticsPanel(p)).toContain('data-logistics-field="scope_confirmed"');
    p.term_scenarios!.CIP!.transport!.segments[0]!.carrier = '改了'; expect(html).toContain('合成公路承运人');
  });
});
