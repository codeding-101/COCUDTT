import type { ProjectFile } from '../data/project-file.js';
import { CARRIAGE_MODES, CARRIAGE_MODE_LABELS } from '../domain/enums.js';
import { DELIVERY_EVENTS, DELIVERY_EVENT_LABELS, INSURANCE_COVERS } from '../domain/logistics.js';
import { escapeHtml } from './format.js';
import { renderSourceEditor } from './source-editor.js';

const coverLabels = { UNCONFIRMED: '尚未确认', ICC_A: 'Institute Cargo Clauses (A)', ICC_B: 'Institute Cargo Clauses (B)', ICC_C: 'Institute Cargo Clauses (C)', EQUIVALENT: '等效条款（需说明）', OTHER: '其他/双方偏离约定（需说明）' };
export function renderLogisticsPanel(project: ProjectFile): string {
  const term = project.incoterm;
  const record = project.term_scenarios?.[term]; const plan = record?.transport; const policy = record?.insurance;
  const textField = (kind: string, field: string, label: string, value: string, placeholder = ''): string =>
    `<label class="field">${label}<input type="text" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" data-logistics-kind="${kind}" data-logistics-field="${field}"></label>`;
  const transport = plan ? `<p class="hint block">按实际顺序记录运输段；交货点必须落在一个段的端点，段内交货请拆段。各段不自动产生运费、改变费用节点或重置风险。</p>
    ${plan.segments.map((segment, n) => `<details class="evidence" data-evidence-section="segment:${term}:${escapeHtml(segment.segment_id)}" open><summary>第 ${n + 1} 段 · ${escapeHtml(segment.from || '起点待填')} → ${escapeHtml(segment.to || '终点待填')}</summary>
      <div class="field-grid"><label class="field">运输方式<select data-logistics-kind="transport" data-logistics-field="mode" data-segment-index="${n}">${CARRIAGE_MODES.filter(mode => mode !== 'MULTIMODAL').map(mode => `<option value="${mode}"${mode === segment.mode ? ' selected' : ''}>${CARRIAGE_MODE_LABELS[mode]}</option>`).join('')}</select></label>
      ${(['from', 'to', 'carrier', 'contract_reference'] as const).map((field, index) => `<label class="field">${['起点', '终点', '承运人', '运输合同/单据编号'][index]}<input type="text" value="${escapeHtml(segment[field])}" data-logistics-kind="transport" data-logistics-field="${field}" data-segment-index="${n}"></label>`).join('')}</div>
      <button class="ghost danger" data-action="remove-transport-segment" data-segment-index="${n}">删除第 ${n + 1} 段</button></details>`).join('')}
    <button class="ghost" data-action="add-transport-segment">添加下一运输段</button>
    <h4>交货风险点与运费终点</h4><div class="field-grid">
      <label class="field">交货所在运输段<select data-logistics-kind="transport" data-logistics-field="delivery_segment_id"><option value="">待确认</option>${plan.segments.map((segment, n) => `<option value="${escapeHtml(segment.segment_id)}"${segment.segment_id === plan.delivery_segment_id ? ' selected' : ''}>第 ${n + 1} 段：${escapeHtml(segment.from || '起点待填')} → ${escapeHtml(segment.to || '终点待填')}</option>`).join('')}</select></label>
      <label class="field">段端点<select data-logistics-kind="transport" data-logistics-field="delivery_at"><option value="ORIGIN"${plan.delivery_at === 'ORIGIN' ? ' selected' : ''}>该段起点</option><option value="DESTINATION"${plan.delivery_at === 'DESTINATION' ? ' selected' : ''}>该段终点</option></select></label>
      ${textField('transport', 'delivery_location', '具体交货地点', plan.delivery_location, '与对应运输段端点使用一致名称')}
      <label class="field">交货事件<select data-logistics-kind="transport" data-logistics-field="delivery_event">${DELIVERY_EVENTS.map(event => `<option value="${event}"${event === plan.delivery_event ? ' selected' : ''}>${DELIVERY_EVENT_LABELS[event]}</option>`).join('')}</select></label>
      <label class="field">CPT/CIP承运人交货依据<select data-logistics-kind="transport" data-logistics-field="handover_basis"><option value="FIRST_CARRIER"${plan.handover_basis === 'FIRST_CARRIER' ? ' selected' : ''}>首段第一承运人接管</option><option value="AGREED_POINT"${plan.handover_basis === 'AGREED_POINT' ? ' selected' : ''}>合同明确约定的交货点</option></select></label>
      ${textField('transport', 'agreement_note', '约定交货点的条款说明', plan.agreement_note)}
      ${textField('transport', 'paid_to', '卖方运费支付终点', plan.paid_to, '照合同填写；无运输义务可留空')}
    </div>${renderSourceEditor(plan.evidence, 'transport', term)}
    <button class="ghost danger" data-action="clear-transport-plan">清除本方案运输计划</button>` : '<button class="ghost" data-action="add-transport-segment">建立本方案运输分段</button>';
  const insurance = policy ? `<div class="field-grid">
    <label class="field">承保险别<select data-logistics-kind="insurance" data-logistics-field="cover">${INSURANCE_COVERS.map(cover => `<option value="${cover}"${cover === policy.cover ? ' selected' : ''}>${coverLabels[cover]}</option>`).join('')}</select></label>
    ${textField('insurance', 'clause_version', '承保条款及版本', policy.clause_version, '照保单填写，如ICC 1/1/2009')}
    ${textField('insurance', 'sum_insured.amount', '保额（与保费分别录入）', policy.sum_insured.amount)}
    ${textField('insurance', 'sum_insured.currency', '保额币种', policy.sum_insured.currency)}
    ${textField('insurance', 'insured_from', '保障区间起点', policy.insured_from)}
    ${textField('insurance', 'insured_to', '保障区间终点', policy.insured_to)}
    ${textField('insurance', 'insurer', '保险人', policy.insurer)}
    ${textField('insurance', 'policy_reference', '保单/保险凭证编号', policy.policy_reference)}
    ${textField('insurance', 'deductible', '免赔说明', policy.deductible, '无免赔也请明确填写')}
    ${textField('insurance', 'exclusions', '除外责任说明', policy.exclusions, '照保单记录，不由险别名称推定')}
    ${textField('insurance', 'agreed_cover_note', '等效保障或险别偏离约定', policy.agreed_cover_note)}
    <label class="field">已核对区间覆盖交货点至指定目的港/地点<input type="checkbox" data-logistics-kind="insurance" data-logistics-field="scope_confirmed"${policy.scope_confirmed ? ' checked' : ''}></label>
    <label class="field">已核对买方或有保险利益人直接索赔凭证条件<input type="checkbox" data-logistics-kind="insurance" data-logistics-field="direct_claim_confirmed"${policy.direct_claim_confirmed ? ' checked' : ''}></label>
    </div>${renderSourceEditor(policy.evidence, 'insurance', term)}<button class="ghost danger" data-action="clear-insurance-plan">清除本方案保障资料</button>` : '<button class="ghost" data-action="create-insurance-plan">录入本方案保险保障资料</button>';
  return `<details class="panel" data-section="logistics"${plan || policy ? ' open' : ''}><summary><span class="panel-title">运输、保险与集装箱核对 · ${term}</span></summary><div class="panel-body">
    <h3 class="panel-heading">运输与交货事实</h3>${transport}
    <h3 class="panel-heading">保险保障资料</h3><p class="hint block">CIF默认ICC(C)，CIP默认ICC(A)或等效条款；基线为原合同价110%、合同币种及交货点至指定目的港/地点。资料与保费分开；双方险别偏离须记明，保额与保障范围仍逐项核对。模拟反推不自动更新保单。</p>${insurance}
    <h3 class="panel-heading">集装箱费用清单</h3><label class="field">装载方式<select data-path="facts.loading_mode"><option value="">未指定</option><option value="FCL"${project.facts?.loading_mode === 'FCL' ? ' selected' : ''}>整箱FCL</option><option value="LCL"${project.facts?.loading_mode === 'LCL' ? ' selected' : ''}>拼箱LCL</option></select></label>
    <p class="hint block">核对两端THC、用箱超期、仓储与开箱查验是否另计或已含。以下按钮只为当前术语新增空金额明细，归属依实际节点、原因及合同核对。D&D可按承运人资料分开或联合收费；免费期、起止事件、箱型/箱数及日费率口径请写入费用备注，系统不自动扣免费天数。</p>
    <div class="panel-actions">${[['thc-origin', '起运港THC'], ['thc-destination', '目的港THC'], ['container-demurrage', 'Demurrage'], ['container-detention', 'Detention'], ['container-combined-dd', '联合D&D'], ['destination-customs-inspection', '开箱/查验']].map(([key, label]) => `<button class="ghost" data-action="add-container-preset" data-preset="${key}">添加${label}</button>`).join('')}</div>
  </div></details>`;
}
