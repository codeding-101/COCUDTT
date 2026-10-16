import type{ProjectFile}from'./project-file.js';
import{toScenario}from'./project-file.js';
import type{AnalysisResult}from'../engine/analyze.js';
import type{Comparison}from'../engine/compare.js';
import type{SourceEvidence}from'../domain/source-evidence.js';
import type{FxResolution}from'../engine/fx.js';
import{CARRIAGE_MODE_LABELS,FX_TYPE_LABELS}from'../domain/enums.js';
import{DUTY_TYPE_LABELS}from'../domain/hs-rate.js';

export interface AssumptionSection{title:string;rows:{label:string;value:string}[];}
export interface AssumptionAttachments{sensitivity?:boolean;settlement?:boolean;bill?:boolean;pair?:boolean;}
export type AssumptionScope='CURRENT_INPUT'|'COMPARISON';
const missing=(value:unknown):string=>value===undefined||value===null||String(value).trim()===''?'未填写':String(value);
const evidence=(e:SourceEvidence|undefined):string=>e?`来源：${missing(e.reference)}；标记：${e.status}（用户记录，非认证）；适用期：${missing(e.valid_from)} 至 ${missing(e.valid_to)}；核对日：${missing(e.checked_on)}`:'未提供来源记录';
const source:Record<FxResolution['source'],string>={IDENTITY:'同币种，无需换算',ITEM:'费用项显式汇率',BOOK:'按类型选择汇率簿',DESIGNATED_BOOK:'方案指定汇率簿'};
const bearer={SELLER:'卖方',BUYER:'买方',CONDITIONAL:'条件未决',SHARED:'共担未拆分'};
const netBasis={NET:'用户记录为货物净价（NET，仍须复核）',UNCONFIRMED:'尚未确认净价（UNCONFIRMED）',INCLUDES_FREIGHT_INSURANCE:'含运保费整价（INCLUDES_FREIGHT_INSURANCE，须拆分核对）'};
const excluded={CONTAINED_IN_PARENT:'已含于父费用',INCLUDED_IN_QUOTE:'已含于报价',GOODS_VALUE:'货值行，采购成本另计',SHARED_NOT_SPLIT:'共担未拆分',CONDITIONAL_UNRESOLVED:'承担条件未决'};
/** Detached internal-only strings, projected from the supplied calculation records.
 * No rate selection, financial arithmetic, source re-confirmation or business edits. */
export function calculationAssumptions(project:ProjectFile,result:AnalysisResult|null,comparison:Comparison,scope:AssumptionScope,attachments:AssumptionAttachments={}):AssumptionSection[]{
 if(comparison.base_currency!==project.base_currency||result&&(result.incoterm!==project.incoterm||result.base_currency!==project.base_currency))throw Error('计算假设摘要与当前方案不一致');
 const sections:AssumptionSection[]=[];
 const section=(title:string)=>{const rows:AssumptionSection['rows']=[];sections.push({title,rows});return(label:string,value:unknown)=>rows.push({label,value:missing(value)});};
 let row=section('范围与报价口径');
 row('文档边界','内部复核资料，含成本和来源，不可直接作为客户报价；生成时快照，编辑单元格不会运行测算。');
 row('本摘要对应',scope==='CURRENT_INPUT'?'当前录入报价的单方案测算；方案对比另按所选基准，不混用两组结果。':'方案对比中当前术语的计算记录；目标基准可能反推报价，不代表录入报价的当前卡片。');
 const scenario=toScenario(project);row('术语与地点',`${project.incoterm} · ${missing(scenario.quote.named_place)} · ${CARRIAGE_MODE_LABELS[project.carriage_mode]}`);
 row('版本',`项目格式 ${project.schema_version}；税务配置 ${project.tax_profile.id} / ${project.tax_profile.version}；费用规则 ${result?`${result.rule_set.id} / ${result.rule_set.version}`:'本术语无计算结果，未补设'}`);
 row('录入报价（原币）',`${missing(scenario.quote.amount)} ${scenario.quote.currency}；这不是反推报价。`);
 const anchor=project.anchor;row('比较基准',anchor.kind==='ACTUAL_QUOTES'?'各术语独立实际报价；缺失不回退到公共报价。':anchor.kind==='FIXED_QUOTE'?'固定报价金额模拟；不证明各术语有相同真实合同报价。':anchor.kind==='FIXED_MARGIN_RATE'?`固定目标利润率 ${anchor.margin_rate}（比例）；反推报价只在对比结果。`:`固定买方总支付 ${anchor.buyer_total} ${anchor.currency}；反推报价只在对比结果。`);
 row('日期',`出口日期 ${missing(project.export_date)}；合同比较日期 ${missing(project.evaluation_date)}；进口申报日期 ${missing(project.tax_profile.import.declarationDate)}；用途分别保留。`);
 row('货物与采购输入',`货值 ${project.goods.trade_value.amount} ${project.goods.trade_value.currency}；${project.goods.quantity} ${project.goods.unit}；采购 ${missing(project.goods.seller_goods_cost.amount)} ${project.goods.seller_goods_cost.currency}，未知不补零。`);
 row('输入净价口径',project.goods.trade_value_basis?netBasis[project.goods.trade_value_basis]:'未确认');
 row('计算状态',result?(result.decision.ready?'通过当前程序检查，仍需真实合同及专业核实。':'参考测算，仍有待核对事项。'):'当前术语无可用计算结果；不使用其他术语的金额或占位零。');
 const currentColumn=comparison.columns.find(c=>c.incoterm===project.incoterm);if(!result)row('本术语原因',currentColumn?.unavailable_reason??currentColumn?.infeasible_reason??'未提供本术语计算记录');
 if(result)for(const step of result.calculations.find(g=>g.id==='totals')?.steps.filter(s=>s.id==='quote'||s.id==='goods-cost')??[])row(`实际记录 · ${step.label}`,`${step.formula}；${step.substitution} → ${step.value===null?'未知/不适用':`${step.value.toFixed()} ${result.base_currency}`}；${step.note??'无额外说明'}`);
 row=section('汇率与来源');
 row('阅读规则','下方先列实际解析记录，再列输入汇率簿。录入某条汇率不代表本次采用；来源标记与本次来源检查分别展示。报价/采购换算以实际公式记录为准，不从字符串反推汇率。');
 const fx=(label:string,f:FxResolution)=>row(label,`1 ${f.from} = ${f.rate.toFixed()} ${f.to}；类型 ${f.fx_type}（${FX_TYPE_LABELS[f.fx_type]}）；${source[f.source]}；簿 ${f.book_id??'无'}；解析适用日 ${f.fx_date??'未指定'}；${f.inverted?'反向报价解析':'未反向解析'}；${evidence(f.evidence)}`);
 if(result){
  for(const c of result.items){if(c.fx)fx(`费用实际解析 · ${c.item.cost_id} ${c.item.cost_name}`,c.fx);else row(`费用解析 · ${c.item.cost_id}`, '没有独立汇率解析记录，不补设汇率1；是否计入汇总另看费用记录。');}
  for(const c of result.dutiable_value.components){if(c.fx)fx(`计税实际解析 · ${c.cost_id} ${c.label}`,c.fx);else row(`计税换算记录 · ${c.cost_id}`,c.calculation?`${c.calculation.formula}；${c.calculation.substitution}；${c.calculation.note??'详见原计税公式'}`:'没有独立换算记录；不推断同币种或海关汇率。');}
  for(const s of result.decision.sources)row(`本次来源检查 · ${s.label}`,`适用日 ${missing(s.applicable_date)}；${s.issues.length?s.issues.join('；'):'通过当前来源记录检查，不认证真实来源'}；${evidence(s.evidence)}`);
 }
 for(const book of project.fx_books)for(const[pair,rate]of Object.entries(book.rates))row(`录入簿（不代表使用） · ${book.id} ${pair}`,`${book.name}；类型 ${book.type}；原始报价 ${rate}；生效日 ${book.date}；簿适用期 ${missing(book.valid_from)} 至 ${missing(book.valid_to)}；${evidence(book.evidence?.[pair])}`);
 row=section('费用与计税范围');
 row('核算币种',project.base_currency);row('范围说明','费用承担、付款、报价包含、汇总排除与海关加计分别记录；风险转移不由付款或运费终点推定。税基仅以本次实际组成及原公式核对，不把全部费用相加。');
 if(result){
  row('本术语范围',`已解析 ${result.items.length} 项；未启用 ${result.inactive_items.length} 项（未解析金额/汇率，未纳入本术语税基或费用汇总）。`);
  for(const c of result.items)row(`费用范围 · ${c.item.cost_id} ${c.item.cost_name}`,`承担 ${bearer[c.responsibility]}；报价包含 ${c.included_in_quote?'是':'否'} / ${c.inclusion_basis==='DECLARED_LIST'?'声明的包含清单':'费用行包含标记'}；计入卖方 ${c.counts_to_seller?'是':'否'}；计入买方报价外费用 ${c.counts_to_buyer?'是':'否'}；排除 ${c.exclusion?`${excluded[c.exclusion]}（${c.exclusion}）`:'无'}；${c.note}`);
  for(const c of result.inactive_items)row(`未启用 · ${c.cost_id} ${c.cost_name}`,'本术语未启用，未解析金额和汇率，不把未知原值当零。');
  for(const c of result.dutiable_value.components)row(`实际计税组成 · ${c.cost_id} ${c.label}`,`${c.basis}；${c.amount.toFixed()} ${result.base_currency}；${c.calculation?.note??'依据原计税公式'}`);
  row('本次完税价格',`${result.dutiable_value.value.toFixed()} ${result.base_currency}`);
 }
 row=section('税务假设与独立资料');
 row('输入计税模式',project.tax_profile.import.calculationMode==='CN_GENERAL_TRADE'?'中国一般贸易进口、单商品一票；人民币计税，海关汇率适用期按申报日期核对。':'通用/历史计算口径；未全面核验其他国家专用税制。');
 row('输入VAT抵扣假设',project.tax_profile.import.vatDeductibleForBuyer?'按可抵扣假设；资格、用途及凭证须核对，卖方承担的税不自动算成买方抵扣。':'按买方不可抵扣假设。');
 if(result){row('实际税率记录',`关税方式 ${DUTY_TYPE_LABELS[result.import_tax.duty_type]}（${result.import_tax.duty_type}）；从价税率 ${result.import_tax.duty_rate.toFixed()}；进口VAT税率 ${result.import_tax.vat_rate.toFixed()}（均为比例）；命中编码 ${result.import_tax.hs_code_matched??'无'} / ${result.import_tax.hs_match_level??'无'}；从量税及完整公式另见原记录。`);row('本次买方可抵扣进口VAT',`${result.buyer.deductible_vat.toFixed()} ${result.base_currency}（引擎结果，非资格认证）`);row('出口退税范围',result.rebate.applicable===false?result.rebate.basis_rule:`${result.rebate.basis_rule}；仅模型测算，不证明申报资格、实际退税或到账。`);for(const context of result.decision.context)row('本次条件记录',context);}
 row('精度与税款','常规金额中间处理保留6位小数、算术40位有效数字；中国进口税款有独立舍入路径，实际公式为准。卡片展示值不用于重算；Excel为静态快照。');
 row('独立附件范围',`敏感性分析：${attachments.sensitivity?'附有参数/尝试结果，成功与否见独立章节':'本次未附'}；付款计划：${attachments.settlement?'独立资金/收付假设，不自动写回利润':'本次未附'}；集装箱账单：${attachments.bill?'独立账单，不自动入费用':'本次未附'}；配对记录：${attachments.pair?'已保存核对资料，不清除原待办或应用费用':'本次未附'}。`);
 row=section('待核对事项与比较限制');
 if(result){for(const issue of result.decision.issues)row('当前测算待办',issue);for(const w of result.warnings)row(`当前告警 · ${w.code}`,`${w.level}：${w.message}`);for(const issue of [...(result.logistics.transport?.issues??[]),...result.logistics.insurance.issues,...result.logistics.container_reminders])row('当前物流提醒',issue);for(const issue of result.transport_cost_links?.issues??[])row('当前运输关联提醒',`${issue.code}：${issue.message}`);}
 const grouped=new Map<string,string[]>();for(const column of comparison.columns){const issues=!column.available?[column.unavailable_reason??'当前运输方式不适用']:!column.feasible?[column.infeasible_reason??'无法计算']:column.decision_issues;for(const issue of issues){const terms=grouped.get(issue)??[];if(!terms.includes(column.incoterm))terms.push(column.incoterm);grouped.set(issue,terms);}}
 for(const[issue,terms]of grouped)row(`比较范围 · ${terms.join('/')}`,issue);for(const w of comparison.warnings)row(`比较告警 · ${w.code}`,w.message);
 row('复核边界','待办未列出不等于真实业务通过；本摘要不提升排名资格、清除来源问题或改变原计算。完整公式、来源与输入快照继续保留。');
 return sections;
}
