import type Decimal from 'decimal.js';
import type { CustomerQuote } from '../domain/customer-quote.js';
import { CARRIAGE_MODE_LABELS, COST_CATEGORY_LABELS, TRADE_NODE_LABELS } from '../domain/enums.js';
import { compare, type Comparison } from '../engine/compare.js';
import type { AnalysisResult } from '../engine/analyze.js';
import { isIsoDate } from '../engine/tax/china-import.js';
import { toScenario, toScenarios, toTrade, serializeProject, type ProjectFile } from './project-file.js';
import { decimalCell as n, textCell as t, type WorkbookCell, type WorkbookSheet, type WorkbookSnapshot } from './xlsx-file.js';
import{calculationAssumptions,type AssumptionAttachments}from'./calculation-assumptions.js';
import{requireCustomerQuoteView,type CustomerQuoteView}from'./customer-quote-view.js';

const DISCLAIMER='本工具仅供学习与内部测算参考，不构成法律或专业贸易建议。实际合同请以 Incoterms® 官方文本及当地法规为准。';
const PRECISION='数值超出 Excel 的15位有效数字/整数位或12位小数展示范围时以文本保留原值；本文件为生成时快照，编辑单元格不会重新运行测算引擎。';
const sheet=(name:string,headers:string[],widths:number[],rows:WorkbookCell[][],freezeColumns=1):WorkbookSheet=>({name,headers,widths,rows,freezeColumns});
const metric=(value:Decimal|null):WorkbookCell=>value===null?t('未知'):n(value.toFixed());
const pair=(label:string,value:string):WorkbookCell[]=>[t(label),t(value||'待双方确认')];
const bearers={SELLER:'卖方',BUYER:'买方',SHARED:'共担（未拆分）',CONDITIONAL:'待确认'};

/** Rebuild only enumerated public cells. Unknown object properties are never copied. */
export function customerWorkbook(quote:CustomerQuote,generatedAt=new Date().toISOString(),view:CustomerQuoteView='full'):WorkbookSnapshot {
  requireCustomerQuoteView(view);
  const rows:WorkbookCell[][]=[pair('文档性质','客户报价说明草稿，尚不表示已签署合同或确认全部履约条件'),pair('生成时间',generatedAt),
    pair('报价提供方',quote.issuer),pair('客户/接收方',quote.recipient),pair('公开编号',quote.reference),pair('商品',quote.goods.description),[t('数量'),n(quote.goods.quantity)],pair('单位',quote.goods.unit),
    [t('报价总额（原币）'),n(quote.quote.amount)],pair('报价币种',quote.quote.currency),pair('贸易术语',quote.quote.incoterm),pair('指定地点',quote.quote.named_place),pair('术语版本','Incoterms® '+quote.quote.incoterms_version),
    pair('报价有效期',quote.quote.valid_from&&quote.quote.valid_to?`${quote.quote.valid_from} 至 ${quote.quote.valid_to}`:''),pair('交付安排',quote.terms.delivery),pair('付款安排',quote.terms.payment),pair('报价包含范围',quote.terms.included),pair('报价不包含范围',quote.terms.excluded),pair('保险安排',quote.terms.insurance),pair('税费口径',quote.terms.tax),pair('公开备注',quote.terms.remarks),
    pair('标准风险转移提示',quote.standard.risk_point+(quote.standard.risk_pending?'（待核对具体分支）':'')),
    pair('标准运费与风险关系',quote.standard.freight_risk_separated?'卖方支付运费至约定目的地，不代表货损风险持续由卖方承担至该目的地。':'具体交付事实和费用范围仍须双方确认。'),
    pair('标准保险提示',quote.standard.insurance_obligation?`本术语通常要求卖方投保，默认协会货物条款${quote.standard.insurance_obligation==='ICC_A'?'(A)':'(C)'}或等效保障；保额与实际条款另核。`:'本术语未规定双方须向对方订立保险合同，实际安排依双方约定。'),
    pair('标准进口费用承担',`${bearers[quote.standard.import_cost_bearer]}；费用承担不自动确定法定纳税人或抵扣资格，卸货费用另核合同。`),
    pair('合同另约','所有权、付款和违约处理须另约；标准提示不代替实际合同。')];
  const pending=[...quote.pending];const date=generatedAt.slice(0,10);
  if(quote.quote.valid_from&&quote.quote.valid_to&&isIsoDate(date)&&(date<quote.quote.valid_from||date>quote.quote.valid_to))pending.push('文档生成日期不在所列报价有效期内，需重新确认报价，不能自动延长有效期');
  pending.forEach((item,i)=>rows.push(pair(`待双方确认 ${i+1}`,item)));
  rows.push(pair('金额精度与使用',PRECISION),pair('责任声明',DISCLAIMER));
  const page=sheet(view==='compact'?'客户报价简洁草稿':'客户报价草稿',['项目','公开内容'],[26,86],rows);if(view==='compact')page.rowSpacing='compact';
  return {audience:'CUSTOMER',title:quote.reference||'客户报价说明',generatedAt,sheets:[page]};
}

export function compareProject(project:ProjectFile):Comparison {
  return compare({trade:toTrade(project),template:toScenario(project),scenarios:toScenarios(project),anchor:project.anchor,taxProfile:project.tax_profile,fxBooks:project.fx_books,...(project.export_date!==undefined?{today:project.export_date}:{})});
}
const currentResult=(comparison:Comparison,term:string):AnalysisResult|null=>comparison.columns.find(c=>c.incoterm===term)?.result??null;

/** Uses per-term engine results; failed or inactive rows never get fabricated zero values. */
export function internalWorkbook(project:ProjectFile,generatedAt=new Date().toISOString(),attachments:AssumptionAttachments={}):WorkbookSnapshot {
  // Engine outputs and all sheet strings are detached before any asynchronous file picker.
  const comparison=compareProject(project),result=currentResult(comparison,project.incoterm),base=comparison.base_currency;
  const actual=project.anchor.kind==='ACTUAL_QUOTES';
  const overview=[pair('文档性质','内部成本与方案比较快照，含采购成本及来源资料，请勿向客户直接发送'),pair('生成时间',generatedAt),pair('项目',project.name),pair('商品',project.goods.name),pair('商品数量',String(project.goods.quantity)),pair('单位',project.goods.unit),pair('运输方式',CARRIAGE_MODE_LABELS[project.carriage_mode]),pair('当前术语',project.incoterm),pair('核算币种',base),pair('比较基准',actual?'各方案实际报价':project.anchor.kind==='FIXED_QUOTE'?'固定报价金额模拟':project.anchor.kind==='FIXED_MARKET_PRICE'?'固定买方总支付模拟':'固定目标利润率模拟'),
    pair('合同比较日期',project.evaluation_date??'未填写'),pair('进口申报日期',project.tax_profile.import.declarationDate??'未填写'),pair('格式/费用规则版本',`输入 ${project.schema_version}；费用规则 ${result?.rule_set.version??'见可计算方案'}`),pair('采购成本（输入原币）',String(project.goods.seller_goods_cost.amount).trim()===''?'未知':`${project.goods.seller_goods_cost.amount} ${project.goods.seller_goods_cost.currency}`),pair('当前方案状态',result?(result.decision.ready?'满足当前排名检查条件':'参考测算，仍有待办'):'当前方案无法计算，见方案对比及原因'),pair('金额与口径',PRECISION),pair('责任声明',DISCLAIMER)];
  const assumptions=calculationAssumptions(project,result,comparison,'COMPARISON',attachments);
  overview.splice(3,0,pair('计算假设摘要','内部复核；当前术语的方案对比记录，实际/模拟与当前录入报价分别核对。'),...assumptions.flatMap(s=>[pair(`摘要分组 · ${s.title}`,'以下为生成时记录'),...s.rows.map(r=>pair(r.label,r.value))]));
  const columns=comparison.columns.map(c=>{
    const scenario=project.term_scenarios?.[c.incoterm]?.quote;
    const ok=c.available&&c.feasible&&c.result!==null;
    const m=(value:Decimal|null)=>ok?metric(value):t('无法计算');
    return [t(c.incoterm),t(!c.available?'不适用':!ok?'无法计算':c.decision_ready?'通过当前排名检查':'参考方案'),t(actual?'实际报价':'模拟测算'),t(scenario?.named_place??(actual?'未录入':project.quote.named_place??'')),t(actual?scenario?`${scenario.amount} ${scenario.currency}`:'缺实际报价':'模拟报价见核算金额'),m(c.quote_amount),m(c.seller.goods_cost),m(c.seller.cost_total),m(c.seller.margin),m(c.buyer.landed_cost_with_tax),m(c.buyer.deductible_vat),m(c.buyer.landed_cost_ex_deductible),m(c.import_tax_total),t(ok&&c.result?.rebate.applicable===false?'不适用中国出口退税':ok?'出口退税测算':'无法计算'),ok&&c.result?.rebate.applicable===false?t('不适用'):m(c.seller.rebate_total),t(base),t(c.transfer_point),t(c.unavailable_reason??c.infeasible_reason??c.decision_issues.join('\n'))];
  });
  const fees:WorkbookCell[][]=[],calculations:WorkbookCell[][]=[],sources:WorkbookCell[][]=[];
  for(const column of comparison.columns){
    const r=column.result;if(!column.available||!column.feasible||!r)continue;
    if(r.transport_cost_links){const a=r.transport_cost_links;sources.push([t(r.incoterm),t('运输关联状态'),t(a.version),t(a.reference_checks_passed?'引用/来源通过':'待核对'),t('仅限明确范围；候选仍须复核，不代表费用完整')]);for(const l of a.links)sources.push([t(r.incoterm),t('运输关联'),t(l.cost_id),t(l.state),t(JSON.stringify(l))]);for(const i of a.issues)sources.push([t(r.incoterm),t('运输关联问题'),t(i.cost_id??''),t(i.code),t(i.message)]);for(const p of a.resolved_overlap_pairs??[])sources.push([t(r.incoterm),t('运输关联候选核对'),t(p.cost_ids.join(' / ')),t(p.basis),t(JSON.stringify(p))]);for(const p of a.potential_overlaps)sources.push([t(r.incoterm),t('运输关联重叠候选'),t(p.cost_ids.join(' / ')),t(p.existing_containment),t(JSON.stringify(p))]);}
    for(const cost of r.items){
      fees.push([t(r.incoterm),t(cost.item.cost_id),t(cost.item.cost_name),t(COST_CATEGORY_LABELS[cost.item.cost_category]),t(TRADE_NODE_LABELS[cost.item.trade_node]),metric(cost.gross_amount),t(cost.item.currency),metric(cost.base_amount),t(base),t(bearers[cost.responsibility]),t(cost.counts_to_seller?'是':'否'),t(cost.counts_to_buyer?'是':'否'),t(cost.exclusion??'无排除'),t(cost.included_in_quote?'是':'否'),t(cost.note),t(cost.item.notes??'')]);
      cost.responsibility_trace.forEach((step,i)=>sources.push([t(r.incoterm),t('费用推理'),t(cost.item.cost_id),t(`${i+1} ${step.stage} · ${step.matched?'命中':'未命中'}`),t(step.detail)]));
      if(cost.fx)sources.push([t(r.incoterm),t('商业费用汇率'),t(cost.item.cost_id),t(cost.fx.fx_type),t(JSON.stringify(cost.fx))]);
      cost.calculations.forEach(step=>calculations.push([t(r.incoterm),t(cost.item.cost_name),t(step.label),t(step.formula),t(step.substitution),step.value===null?t('不适用/无法计算'):metric(step.value),t('见公式与代入值'),t(step.note??'') ]));
    }
    for(const item of r.inactive_items)fees.push([t(r.incoterm),t(item.cost_id),t(item.cost_name),t(COST_CATEGORY_LABELS[item.cost_category]),t(TRADE_NODE_LABELS[item.trade_node]),t('未解析'),t(item.currency),t('未解析'),t(base),t('不适用'),t('否'),t('否'),t('本方案未启用，不计入汇总或税基'),t('未判定'),t('适用术语筛选'),t(item.notes??'')]);
    r.calculations.forEach(group=>group.steps.forEach(step=>calculations.push([t(r.incoterm),t(group.label),t(step.label),t(step.formula),t(step.substitution),step.value===null?t('不适用/无法计算'):metric(step.value),t('见公式与代入值'),t(step.note??'')])));
    r.dutiable_value.components.forEach(c=>calculations.push([t(r.incoterm),t('完税价格组成'),t(c.label),t(c.basis),t(c.cost_id),metric(c.amount),t(base),t('海关计税组成；不与买卖方费用汇总直接相加')]));
    r.dutiable_value.components.forEach(c=>{if(c.fx)sources.push([t(r.incoterm),t('海关计税汇率'),t(c.cost_id),t(c.fx.fx_type),t(JSON.stringify(c.fx))]);});
    r.decision.sources.forEach(s=>sources.push([t(r.incoterm),t('来源核对'),t(s.label),t(s.issues.length?s.issues.join('；'):'通过当前来源检查'),t(JSON.stringify({applicable_date:s.applicable_date,evidence:s.evidence??null}))]));
    r.decision.issues.forEach(issue=>sources.push([t(r.incoterm),t('待办'),t('排名条件'),t('待核对'),t(issue)]));
    r.warnings.forEach(w=>sources.push([t(r.incoterm),t('告警'),t(w.code),t(w.level),t(w.message)]));
    [...(r.logistics.transport?.issues??[]),...r.logistics.insurance.issues,...r.logistics.container_reminders].forEach(issue=>sources.push([t(r.incoterm),t('物流待办/提醒'),t('资料核对'),t('待核对'),t(issue)]));
  }
  comparison.warnings.forEach(w=>sources.push([t('全部方案'),t('比较告警'),t(w.code),t(w.level),t(w.message)]));
  const snapshot=serializeProject(project),snapshotRows:WorkbookCell[][]=[];
  // Explicit internal-only input archive; bounded chunks stay within native cell limits.
  const points=Array.from(snapshot);for(let i=0;i<points.length;i+=240)snapshotRows.push([t(String(i/240+1)),t(points.slice(i,i+240).join(''))]);
  return {audience:'INTERNAL',title:project.name,generatedAt,sheets:[sheet('交易口径',['项目','内部内容'],[26,86],overview),sheet('方案对比',['术语','状态','报价性质','指定地点','输入原币报价','核算报价','采购成本','卖方费用（不含采购）','卖方利润','买方总支付','可抵扣进口VAT','抵扣后成本','进口税款总额（双方）','退税适用','出口退税测算','核算币种','风险转移点','原因/待办'],[12,24,16,26,26,20,20,26,20,20,20,20,26,28,22,12,36,70],columns),sheet('费用明细',['术语','费用ID','费用名称','类别','节点','原币金额','原币','核算金额','核算币种','费用归属','计入卖方','计入买方','排除原因','报价内含','归属依据','内部备注'],[12,26,26,24,26,20,12,20,12,24,14,14,34,14,60,60],fees,2),sheet('税费与公式',['术语','分组/费用','步骤','公式/组成类型','代入值/组成ID','引擎结果','结果单位/口径','说明'],[12,26,30,50,70,24,26,60],calculations,2),sheet('来源与待办',['术语','记录类型','项目/代码','状态/阶段','依据与待办'],[12,20,30,38,90],sources,2),sheet('输入快照',['片段序号','完整项目JSON（按序拼接，供内部复核）'],[16,100],snapshotRows)]};
}
