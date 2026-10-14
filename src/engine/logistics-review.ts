import type Decimal from 'decimal.js';
import { d } from '../domain/decimal.js';
import { DELIVERY_EVENT_LABELS, type DeliveryEvent, type TransportPlan } from '../domain/logistics.js';
import { insuranceEvidenceValues, transportEvidenceValues } from '../domain/logistics-evidence.js';
import type { Scenario } from '../domain/scenario.js';
import type { Trade } from '../domain/trade.js';
import { evidenceKey } from '../domain/source-evidence.js';
import { checkSource, type DecisionReadiness } from './decision-readiness.js';
import { isIsoDate } from './tax/china-import.js';
import type { RiskResult } from './risk.js';

export interface LogisticsReview {
  version: '1.0';
  transport: { plan: TransportPlan; delivery_index: number; confirmed: boolean; issues: string[] } | null;
  insurance: { required: boolean; configured: boolean; minimum_amount: Decimal | null; currency: string;
    contract_amount: string; cover: string; sum_insured: string; sum_insured_currency: string; insured_from: string; insured_to: string; issues: string[] };
  container_reminders: string[];
}

function expectedEvent(scenario: Scenario): DeliveryEvent {
  switch (scenario.incoterm) {
    case 'EXW': return 'AVAILABLE';
    case 'FCA': return scenario.facts?.delivery_place === 'SELLER_PREMISES' ? 'LOADED' : scenario.facts?.delivery_place === 'OTHER' ? 'READY_UNLOAD' : 'UNCONFIRMED';
    case 'FAS': return 'ALONGSIDE';
    case 'FOB': case 'CFR': case 'CIF': return 'ON_BOARD';
    case 'CPT': case 'CIP': return 'CARRIER_HANDOVER';
    case 'DPU': return 'UNLOADED';
    case 'DAP': case 'DDP': return 'READY_UNLOAD';
  }
}
const samePlace = (a: string, b: string): boolean => a.trim() === b.trim();

export function reviewLogistics(base: DecisionReadiness, trade: Trade, scenario: Scenario, activeIds: readonly string[], risk: RiskResult): {
  decision: DecisionReadiness; logistics: LogisticsReview; risk: RiskResult;
} {
  const issues = [...base.issues]; const sources = [...base.sources]; const context = [...base.context];
  const date = scenario.contract_review?.evaluation_date ?? '';
  const plan = scenario.transport;
  const transportRequired = trade.carriage_mode === 'MULTIMODAL' && scenario.contract_review?.require_quote;
  const transportIssues: string[] = [];
  let index = -1;
  if (transportRequired && !plan) { transportIssues.push('实际多式联运方案尚未录入运输分段与具体交货点，不能只凭运输方式推定完整风险链'); context.push('实际多式联运的运输段与具体交货事实仍待录入。'); }
  if (plan) {
    if (!isIsoDate(date)) transportIssues.push('运输交货事实缺少有效的合同比较日期');
    if (!plan.segments.length) transportIssues.push('运输分段为空，请录入实际运输段');
    if (trade.carriage_mode === 'MULTIMODAL' && new Set(plan.segments.map(segment => segment.mode)).size < 2) transportIssues.push('多式联运分段尚未记录至少两种运输方式；请补齐实际路线或核对总体运输方式');
    const ids = new Set<string>();
    for (const [n, segment] of plan.segments.entries()) {
      if (!segment.segment_id.trim() || ids.has(segment.segment_id)) transportIssues.push(`第${n + 1}运输段编号为空或重复`);
      ids.add(segment.segment_id);
      if (!segment.from.trim() || !segment.to.trim() || !segment.carrier.trim() || !segment.contract_reference.trim()) transportIssues.push(`第${n + 1}运输段起讫地点、承运人或运输合同依据未填写`);
      if (n > 0 && !samePlace(plan.segments[n - 1]!.to, segment.from)) transportIssues.push(`第${n}与第${n + 1}运输段地点未衔接，请使用一致地点名称或补充衔接段`);
    }
    index = plan.segments.findIndex(segment => segment.segment_id === plan.delivery_segment_id);
    const leg = plan.segments[index];
    if (!leg) transportIssues.push('交货点引用的运输段不存在');
    if (!plan.delivery_location.trim()) transportIssues.push('具体交货地点未填写');
    else if (leg && !samePlace(plan.delivery_location, plan.delivery_at === 'ORIGIN' ? leg.from : leg.to)) transportIssues.push('交货地点与所选运输段端点不一致；段内交货请在该点拆段');
    const expected = expectedEvent(scenario);
    if (expected === 'UNCONFIRMED' || plan.delivery_event !== expected) transportIssues.push(`${scenario.incoterm}的交货事件需核对：${DELIVERY_EVENT_LABELS[expected]}`);
    if (['FOB', 'FAS', 'CFR', 'CIF'].includes(scenario.incoterm)) {
      if (leg && !['SEA', 'INLAND_WATERWAY'].includes(leg.mode)) transportIssues.push('海运术语的船边或上船交货必须落在海运/内河运输段');
      if (plan.delivery_at !== 'ORIGIN') transportIssues.push('船边或上船交货须位于该海运段起点，不能用目的港到达替代');
    }
    if (['CPT', 'CIP'].includes(scenario.incoterm)) {
      if (plan.handover_basis === 'FIRST_CARRIER' && (index !== 0 || plan.delivery_at !== 'ORIGIN')) transportIssues.push('第一承运人交货应为首段起点；其他明确约定点须选择合同约定并填写条款');
      if (plan.handover_basis === 'AGREED_POINT' && !plan.agreement_note.trim()) transportIssues.push('明确约定的承运人交货点缺少合同条款说明');
    }
    if (['DAP', 'DPU', 'DDP'].includes(scenario.incoterm) && (index !== plan.segments.length - 1 || plan.delivery_at !== 'DESTINATION')) transportIssues.push('D类目的地交货须落在末段终点，不能用前段承运人接管替代');
    if (scenario.incoterm === 'EXW' && (index !== 0 || plan.delivery_at !== 'ORIGIN')) transportIssues.push('EXW置于买方处置的交货点须为首段起点');
    if (scenario.incoterm === 'FCA' && scenario.facts?.delivery_place === 'SELLER_PREMISES' && (index !== 0 || plan.delivery_at !== 'ORIGIN')) transportIssues.push('FCA卖方场所装货完成的交货点须为首段起点');
    if (['CPT', 'CIP', 'CFR', 'CIF', 'DAP', 'DPU', 'DDP'].includes(scenario.incoterm) && !plan.paid_to.trim()) transportIssues.push('卖方运输费用支付终点未填写，须与风险交货点分开确认');
    const namedPlace = (scenario.logistics_quote ?? scenario.quote).named_place;
    if (['CPT', 'CIP', 'CFR', 'CIF', 'DAP', 'DPU', 'DDP'].includes(scenario.incoterm) && namedPlace?.trim() && !samePlace(plan.paid_to, namedPlace)) transportIssues.push('卖方运费终点与原报价指定目的港/地点不一致，请使用一致地点名称并核对合同范围');
    const source = checkSource(`${scenario.incoterm} 运输与交货事实`, date, plan.evidence,
      plan.evidence ? evidenceKey(transportEvidenceValues(scenario), plan.evidence) : undefined);
    sources.push(source); transportIssues.push(...source.issues.map(text => `运输交货依据：${text}`));
    context.push(`运输分段：${plan.segments.map((segment, n) => `${n + 1}. ${segment.from || '未填'} → ${segment.to || '未填'}（${segment.mode}，承运人${segment.carrier || '未填'}；合同${segment.contract_reference || '未填'}）`).join('；')}`);
    context.push(`唯一交货风险点：${plan.delivery_location || '待填'} · ${DELIVERY_EVENT_LABELS[plan.delivery_event]}；卖方运费支付终点：${plan.paid_to || '未填/无运输义务'}。换段不自动重置风险，分段不自动生成费用或决定海关加计。`);
  }
  const required = scenario.incoterm === 'CIF' || scenario.incoterm === 'CIP';
  const policy = scenario.insurance;
  const quote = scenario.logistics_quote ?? scenario.quote;
  const insuranceIssues: string[] = [];
  let minimum: Decimal | null = null;
  if (required && scenario.contract_review?.require_quote && !policy) insuranceIssues.push(`${scenario.incoterm}尚未录入保单保障资料，保费金额不代表险别、保额或区间已核对`);
  if (policy) {
    if (!isIsoDate(date)) insuranceIssues.push('保险保障缺少有效的合同比较日期');
    try { const price = d(quote.amount); if (price.isFinite() && price.gt(0)) minimum = price.mul('1.1'); else insuranceIssues.push('保险核对的原合同报价须为有限正数'); }
    catch { insuranceIssues.push('保险核对的原合同报价缺失或无效'); }
    if (!samePlace(policy.sum_insured.currency, quote.currency)) insuranceIssues.push('保额币种应为合同报价币种，不用商业/海关汇率代替合同币种要求');
    try { const insured = d(policy.sum_insured.amount); if (!insured.isFinite() || insured.lte(0)) insuranceIssues.push('保额须为有限正数'); else if (required && minimum && insured.lt(minimum)) insuranceIssues.push('保额低于原合同价110%的基线'); }
    catch { insuranceIssues.push('保额未填写或不是有效数值'); }
    const defaultCovers = scenario.incoterm === 'CIF' ? ['ICC_C', 'ICC_B', 'ICC_A'] : ['ICC_A'];
    if (policy.cover === 'UNCONFIRMED') insuranceIssues.push('保险险别尚未确认');
    else if (required && !defaultCovers.includes(policy.cover) && !policy.agreed_cover_note.trim()) insuranceIssues.push(`${scenario.incoterm}险别不在默认保障检查范围，请记录等效保障依据或双方偏离约定`);
    if (!policy.clause_version.trim() || !policy.policy_reference.trim() || !policy.insurer.trim()) insuranceIssues.push('承保条款版本、保险人或保单编号未填写');
    if (!policy.insured_from.trim() || !policy.insured_to.trim() || !policy.scope_confirmed) insuranceIssues.push('保障区间尚未核对是否覆盖术语交货点至指定目的港/地点');
    if (!policy.direct_claim_confirmed) insuranceIssues.push('买方或有保险利益人向保险人直接索赔的凭证条件尚未核对');
    if (!policy.deductible.trim() || !policy.exclusions.trim()) insuranceIssues.push('免赔及除外责任未记录，请据保单填明（无免赔须明确填写）');
    const source = checkSource(`${scenario.incoterm} 保险保障资料`, date, policy.evidence,
      policy.evidence ? evidenceKey(insuranceEvidenceValues(scenario, trade.goods), policy.evidence) : undefined);
    sources.push(source); insuranceIssues.push(...source.issues.map(text => `保险依据：${text}`));
    context.push(`保险保障：${policy.cover} · ${policy.clause_version || '版本未填'}；保额${policy.sum_insured.amount || '未填'} ${policy.sum_insured.currency}；区间${policy.insured_from || '未填'} → ${policy.insured_to || '未填'}；保险人${policy.insurer || '未填'}；保单${policy.policy_reference || '未填'}；免赔${policy.deductible || '未填'}；除外${policy.exclusions || '未填'}${policy.agreed_cover_note ? `；等效/偏离约定${policy.agreed_cover_note}` : ''}`);
    context.push(`保额基价采用原录入/已保存的合同报价${quote.amount} ${quote.currency}，模拟反推报价不自动改变已承保价格。保障范围与直接索赔条件为人工记录，不代表保险合同合格或可获赔。`);
  } else if (required) context.push('保险保障资料尚未录入；旧模拟模式只测算费用，不证明保险符合合同要求。');
  const active = trade.items.filter(item => activeIds.includes(item.cost_id));
  const dd = active.filter(item => ['DEMURRAGE', 'DETENTION', 'COMBINED_DD'].includes(item.container_charge ?? '') && !item.contained_in_cost_id);
  const ddScopes = new Map<string, typeof dd>();
  for (const item of dd) {
    const scope = item.container_charge_scope?.trim() || `${item.trade_node}|${item.location?.trim() ?? ''}`;
    const group = ddScopes.get(scope) ?? []; group.push(item); ddScopes.set(scope, group);
  }
  for (const group of ddScopes.values()) if (group.some(item => item.container_charge === 'COMBINED_DD') && group.some(item => item.container_charge !== 'COMBINED_DD')) issues.push('联合D&D与分开demurrage/detention在同一或未区分的范围同时启用，须核对是否重复收费；不同范围请明确填写收费范围，报价内分项应设置已含于关系');
  const reminders: string[] = [];
  if (scenario.facts?.loading_mode || dd.length) {
    for (const [kind, label] of [['THC_ORIGIN', '起运港THC'], ['THC_DESTINATION', '目的港THC'], ['INSPECTION', '开箱/海关查验']] as const) {
      if (!active.some(item => item.container_charge === kind)) reminders.push(`${label}未标记：核对是否不适用、含在报价内或需另列费用，不自动补金额。`);
    }
    reminders.push('D&D需核对承运人/港口收费口径、免费期、起止事件、箱型和箱数。保留联合或分开收费原文；按日计费填本笔全部箱子的日费率合计和扣除已核对免费期后的计费天数，系统不自动扣免费天数。');
  }
  issues.push(...transportIssues, ...insuranceIssues);
  const decision = { ready: issues.length === 0, issues: [...new Set(issues)], sources, context };
  const logistics: LogisticsReview = { version: '1.0', transport: plan ? { plan: { ...plan, segments: plan.segments.map(segment => ({ ...segment })), ...(plan.evidence ? { evidence: { ...plan.evidence } } : {}) }, delivery_index: index, confirmed: transportIssues.length === 0, issues: transportIssues } : null,
    insurance: { required, configured: !!policy, minimum_amount: minimum, currency: quote.currency, contract_amount: String(quote.amount), cover: policy?.cover ?? 'UNCONFIRMED', sum_insured: policy?.sum_insured.amount ?? '', sum_insured_currency: policy?.sum_insured.currency ?? '', insured_from: policy?.insured_from ?? '', insured_to: policy?.insured_to ?? '', issues: insuranceIssues },
    container_reminders: reminders };
  return { decision, logistics, risk: plan || transportRequired ? { ...risk, needs_confirmation: risk.needs_confirmation || transportIssues.length > 0,
    transfer_point: plan ? `${risk.transfer_point}；录入具体交货点：${plan.delivery_location || '未填'}（${DELIVERY_EVENT_LABELS[plan.delivery_event]}）` : `${risk.transfer_point}；实际多式联运的具体交货点待录入` } : risk };
}
