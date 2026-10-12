import { toScenario, toScenarios, toTrade, type ProjectFile } from '../data/project-file.js';
import type { AnalysisResult } from '../engine/analyze.js';
import { runSensitivity, type MetricChange, type SensitivityRequest, type SensitivityResult } from '../engine/sensitivity.js';
import { dec, escapeHtml } from './format.js';

export interface SensitivityControls {
  enabled: boolean;
  kind: 'FREIGHT' | 'FX' | 'RESPONSIBILITY';
  target: string;
  from: string;
  to: string;
  step: string;
}
export const newSensitivityControls = (): SensitivityControls => ({enabled:false,kind:'FREIGHT',target:'',from:'-10',to:'10',step:'5'});
export function sensitivityOptions(project: ProjectFile, result: AnalysisResult | null, kind: SensitivityControls['kind']): {value:string;label:string}[] {
  if(kind==='FX')return project.fx_books.flatMap(book=>Object.entries(book.rates).filter(([pair])=>pair.split('/')[0]!==pair.split('/')[1]).map(([pair,rate])=>({value:JSON.stringify([book.id,pair]),label:`${book.name} · ${book.type} · ${pair} = ${rate}`})));
  return project.items.filter(item=>(item.applicable_incoterms===undefined||item.applicable_incoterms.includes(project.incoterm))&&
    (kind==='FREIGHT'?['MAIN_CARRIAGE','INLAND_TRANSPORT','DESTINATION_TRANSPORT'].includes(item.cost_category)&&!item.is_goods_value&&item.source!=='DERIVED':result?.items.some(i=>i.item.cost_id===item.cost_id&&['CONDITIONAL','SHARED'].includes(i.responsibility))))
    .map(item=>({value:item.cost_id,label:`${item.cost_name} · ${item.currency}`}));
}
export function sensitivityRequest(controls: SensitivityControls): SensitivityRequest {
  if(!controls.target)throw new Error('请选择一笔费用或一行汇率');
  const variable=controls.kind==='FX'?(()=>{const value:unknown=JSON.parse(controls.target);if(!Array.isArray(value)||value.length!==2||value.some(v=>typeof v!=='string'))throw new Error('汇率选项无效，请重新选择');return {kind:'FX' as const,book_id:value[0] as string,pair:value[1] as string};})():{kind:controls.kind,cost_id:controls.target};
  return {variable,range:{from:controls.from,to:controls.to,step:controls.step}};
}
export function projectSensitivity(project: ProjectFile, controls: SensitivityControls): SensitivityResult {
  return runSensitivity({trade:toTrade(project),template:toScenario(project),scenarios:toScenarios(project),anchor:project.anchor,
    incoterms:[project.incoterm],taxProfile:project.tax_profile,fxBooks:project.fx_books,
    ...(project.export_date!==undefined?{today:project.export_date}:{})},sensitivityRequest(controls));
}
const anchorLabel=(result:SensitivityResult):string=>result.anchor.kind==='ACTUAL_QUOTES'?'保持当前方案实际合同报价':result.anchor.kind==='FIXED_QUOTE'?'固定原报价金额（商业换算随所选汇率变化）':result.anchor.kind==='FIXED_MARKET_PRICE'?`固定买方总支付 ${result.anchor.buyer_total} ${result.anchor.currency}，反解报价`:`固定目标利润率 ${result.anchor.margin_rate}，反解报价`;
function change(metric:MetricChange):string {
  if(metric.value===null)return '<span>未知或无法计算</span>';
  const delta=metric.delta===null?'变化无法评估':`${metric.delta.gt(0)?'+':''}${dec(metric.delta)}`;
  const percent=metric.percent===null?'百分比不适用（基准为零或未知）':`${metric.percent.gt(0)?'+':''}${dec(metric.percent)}%`;
  return `<strong>${dec(metric.value)}</strong><small>变化 ${delta} · ${percent}</small>`;
}
export function renderSensitivityResult(result:SensitivityResult):string {
  const points=[result.baseline,...result.points.filter(p=>p.hypothetical)];
  const rows=points.map(point=>point.error?`<tr><th>${escapeHtml(point.label)}</th><td colspan="7" class="warn-error">无法计算：${escapeHtml(point.error)}</td></tr>`:point.rows.map(row=>{
    const cells=[['报价',row.quote],['卖方利润',row.profit],['买方总支付',row.payment],['抵扣后成本',row.net_payment],['进口税额',row.tax],['完税价格',row.dutiable]] as const;
    return `<tr data-hypothesis-change="${escapeHtml(point.change)}"><th>${escapeHtml(point.label)} · ${row.incoterm}</th>${cells.map(([label,metric])=>`<td data-label="${label}" class="num">${change(metric)}</td>`).join('')}<td data-label="核对事项"><span>${point.hypothetical?'假设参考，不能作为确定推荐':row.checks_passed?'基准通过当前检查':'基准参考'}</span>${!row.feasible?'<strong>无法计算</strong>':''}${row.issues.length?`<ul>${row.issues.map(issue=>`<li>${escapeHtml(issue)}</li>`).join('')}</ul>`:'<small>该情景未产生额外核对事项；不构成真实报价确认。</small>'}</td></tr>`;
  }).join('')).join('');
  return `<div data-sensitivity-result><p><strong>${escapeHtml(result.variable_label)}</strong> · ${escapeHtml(anchorLabel(result))}</p><p class="hint">${escapeHtml(result.adjustment_note)} 仅分析当前选中的术语，其他输入保持基准。进口税额是双方承担合计，与买方支付口径分别列明。</p>
    <table class="grid stackable hypothesis-table"><thead><tr><th>情景</th><th>报价</th><th>卖方利润</th><th>买方总支付</th><th>抵扣后成本</th><th>进口税额</th><th>完税价格</th><th>核对事项</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="hint block">假设分析记录 ${result.version} · 金额币种 ${escapeHtml(result.base_currency)}；差额为情景减基准，百分比为差额÷基准绝对值，基准为零或未知时不计算。待确认费用未计入已决汇总，参考成本可能偏低。商业汇率、海关汇率独立；显式汇率或未被选用的汇率行可能使本次调整没有金额影响。假设不写回项目、不补造来源或合同确认，实际报价不勾稽及日期失效仍保留待办。</p></div>`;
}
export function renderSensitivityPanel(project: ProjectFile,result: AnalysisResult|null,controls:SensitivityControls,analysis:SensitivityResult|null,error:string|null):string {
  const options=sensitivityOptions(project,result,controls.kind);
  const field=(key:'from'|'to'|'step',label:string)=>`<label>${label}（%）<input type="text" inputmode="decimal" data-sensitivity-field="${key}" value="${escapeHtml(controls[key])}"></label>`;
  return `<details class="panel" data-evidence-section="sensitivity"><summary><span class="panel-title">假设分析 · 运费、汇率与费用承担</span></summary><div class="panel-body">
    <p class="hint">分析 ${project.incoterm} 当前方案。调整下方假设不会编辑费用、汇率、报价或保存状态；本页参数不写入项目JSON，打开新项目后重置。内部报告可保存假设及生成时结果。</p>
    <label><input type="checkbox" data-sensitivity-field="enabled"${controls.enabled?' checked':''}>启用假设分析</label>
    <div class="hypothesis-controls"><label>变量类型<select data-sensitivity-field="kind"><option value="FREIGHT"${controls.kind==='FREIGHT'?' selected':''}>单项运费涨跌</option><option value="FX"${controls.kind==='FX'?' selected':''}>单行汇率变化</option><option value="RESPONSIBILITY"${controls.kind==='RESPONSIBILITY'?' selected':''}>待确认费用承担</option></select></label>
    <label>调整对象<select data-sensitivity-field="target"><option value="">请选择</option>${options.map(option=>`<option value="${escapeHtml(option.value)}"${controls.target===option.value?' selected':''}>${escapeHtml(option.label)}</option>`).join('')}</select></label>
    ${controls.kind==='RESPONSIBILITY'?'<p class="hint">分别假设该费用全归卖方或买方，其他待确认项保持。</p>':`${field('from','起始变化')}${field('to','结束变化')}${field('step','变化步长')}`}</div>
    ${error?`<p class="banner error" role="alert">假设分析未完成：${escapeHtml(error)}</p>`:controls.enabled?(analysis?renderSensitivityResult(analysis):'<p class="hint">请选择调整对象。</p>'):'<p class="hint">启用后按变化范围重算，最多21个变化点；无金额影响也如实显示，不改推荐。</p>'}
    </div></details>`;
}
