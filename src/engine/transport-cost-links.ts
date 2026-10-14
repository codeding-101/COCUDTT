import type {CostItem} from '../domain/cost-item.js';
import type {Scenario} from '../domain/scenario.js';
import type {Trade} from '../domain/trade.js';
import {evidenceKey} from '../domain/source-evidence.js';
import {TRANSPORT_CHARGE_KINDS,transportCostLinkEvidenceValues,type TransportCostLink,type TransportCostLinkInput,type TransportChargeKind} from '../domain/transport-cost-links.js';
import {checkSource} from './decision-readiness.js';
import {costsForTerm} from './scenario-costs.js';

export type TransportLinkIssueCode='TRADE_MISMATCH'|'AMBIGUOUS_COST_ID'|'AMBIGUOUS_SEGMENT_ID'|'UNKNOWN_COST'|'LINK_UNCONFIRMED'|'SOURCE_UNCONFIRMED'|'NOT_APPLICABLE_HAS_LINKS'|'TRANSPORT_REQUIRED'|'SEGMENTS_REQUIRED'|'CHARGE_KIND_UNCONFIRMED'|'CHARGE_SCOPE_REQUIRED'|'DUPLICATE_SEGMENT'|'UNKNOWN_SEGMENT'|'NONCONTIGUOUS_SEGMENTS'|'ROUTE_GAP';
export interface TransportLinkIssue {code:TransportLinkIssueCode;cost_id?:string;segment_id?:string;message:string}
export interface TransportCostLinkReview {
 version:'0.1';
 scope:'REFERENCE_CHECK_ONLY';
 requested:boolean;
 reference_checks_passed:boolean;
 review_required:boolean;
 issues:TransportLinkIssue[];
 active_target_cost_ids:string[];
 inactive_target_cost_ids:string[];
 unlinked_target_cost_ids:string[];
 /** Descriptive only: absence does not prove a charge is missing or free. */
 segments_without_links:string[];
 links:{cost_id:string;state:TransportCostLink['state'];segment_ids:string[];charge_kind:TransportChargeKind;scope_id:string;source_reference:string;source_issues:string[]}[];
 potential_overlaps:{cost_ids:[string,string];segment_ids:string[];charge_kind:TransportChargeKind;scope_id:string;existing_containment:'DIRECT'|'COMMON_PARENT'|'NONE'}[];
}
function fail(message:string):never{throw Error(`运输费用关联结构无效：${message}`);}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function text(value:unknown,label:string,max=200,nonempty=true):asserts value is string{
 if(typeof value!=='string'||value.length>max||nonempty&&!value.trim())fail(`${label}须为${nonempty?'非空':''}文本（最多${max}字符）`);
}
/** Strict new-API shape check; incomplete drafts are allowed, financial inputs remain untouched. */
export function validateTransportCostLinkInput(value:unknown):asserts value is TransportCostLinkInput{
 if(!object(value)||!Array.isArray(value.target_cost_ids)||!Array.isArray(value.links)||value.target_cost_ids.length>100||value.links.length>100)fail('核对范围和关联须为数组，分别最多100项');
 const targets=new Set<string>();for(const id of value.target_cost_ids){text(id,'费用编号');if(targets.has(id))fail('核对费用编号重复');targets.add(id);}
 const costs=new Set<string>();for(const raw of value.links){
  if(!object(raw))fail('关联须为对象');text(raw.cost_id,'关联费用编号');
  if(costs.has(raw.cost_id)||!targets.has(raw.cost_id))fail('每笔费用仅有一条关联，且须在明确核对范围内');costs.add(raw.cost_id);
  if(typeof raw.state!=='string'||!['UNCONFIRMED','LINKED','NOT_APPLICABLE'].includes(raw.state))fail('关联状态不支持');
  if(!Array.isArray(raw.segment_ids)||raw.segment_ids.length>100)fail('运输段引用须为数组，最多100段');
  for(const id of raw.segment_ids)text(id,'运输段编号');
  if(typeof raw.charge_kind!=='string'||!(TRANSPORT_CHARGE_KINDS as readonly string[]).includes(raw.charge_kind))fail('收费类型不支持');text(raw.scope_id,'收费范围编号',200,false);
  if(raw.evidence!==undefined){if(!object(raw.evidence))fail('依据须为对象');const e=raw.evidence;for(const key of ['reference','valid_from','valid_to','checked_on'])text(e[key],'依据'+key,4000,false);if(typeof e.status!=='string'||!['EXAMPLE','UNVERIFIED','USER_CONFIRMED'].includes(e.status))fail('依据状态不支持');if(e.values_key!==undefined)text(e.values_key,'依据快照',1048576,false);}
 }
}
/** Independent review over validated trade/scenario inputs. No monetary/risk/tax writes or defaults. */
export function reviewTransportCostLinks(trade:Trade,scenario:Scenario,input:TransportCostLinkInput):TransportCostLinkReview{
 validateTransportCostLinkInput(input);
 const issues:TransportLinkIssue[]=[],add=(code:TransportLinkIssueCode,message:string,cost_id?:string,segment_id?:string)=>issues.push({code,message,...(cost_id===undefined?{}:{cost_id}),...(segment_id===undefined?{}:{segment_id})});
 const result:TransportCostLinkReview={version:'0.1',scope:'REFERENCE_CHECK_ONLY',requested:input.target_cost_ids.length>0,reference_checks_passed:false,review_required:false,issues,active_target_cost_ids:[],inactive_target_cost_ids:[],unlinked_target_cost_ids:[],segments_without_links:[],links:[],potential_overlaps:[]};
 if(scenario.trade_id!==trade.id)add('TRADE_MISMATCH','方案不属于当前交易');
 const byCost=new Map<string,CostItem>();for(const cost of trade.items){if(byCost.has(cost.cost_id))add('AMBIGUOUS_COST_ID','原费用编号重复，不能确定关联对象',cost.cost_id);else byCost.set(cost.cost_id,cost);}
 // Reuse existing applicability/alternative/reference checks. Never union different scenarios.
 const selected=costsForTerm(trade,scenario.incoterm),activeIds=new Set(selected.trade.items.map(c=>c.cost_id));
 const plan=scenario.transport,segments=plan?.segments??[],bySegment=new Map<string,number>();
 for(const [i,segment]of segments.entries()){
  if(!segment.segment_id.trim()||bySegment.has(segment.segment_id))add('AMBIGUOUS_SEGMENT_ID','原运输段编号为空或重复，不能确定关联对象',undefined,segment.segment_id);
  else bySegment.set(segment.segment_id,i);
 }
 const rows=new Map(input.links.map(link=>[link.cost_id,link])),linked:{cost:CostItem;link:TransportCostLink}[]=[],covered=new Set<string>();
 for(const id of input.target_cost_ids){
  const cost=byCost.get(id);if(!cost){add('UNKNOWN_COST','核对范围引用了不存在的费用',id);continue;}
  if(!activeIds.has(id)){result.inactive_target_cost_ids.push(id);continue;}
  result.active_target_cost_ids.push(id);const link=rows.get(id);
  if(!link||link.state==='UNCONFIRMED'){result.unlinked_target_cost_ids.push(id);add('LINK_UNCONFIRMED','本笔费用尚未明确关联运输段或说明不适用',id);continue;}
  const source=checkSource('费用运输范围关联',scenario.contract_review?.evaluation_date??'',link.evidence,link.evidence?evidenceKey(transportCostLinkEvidenceValues(cost,scenario,link),link.evidence):undefined);
  if(source.issues.length)add('SOURCE_UNCONFIRMED',source.issues.join('；'),id);
  result.links.push({cost_id:id,state:link.state,segment_ids:[...link.segment_ids],charge_kind:link.charge_kind,scope_id:link.scope_id,source_reference:link.evidence?.reference??'',source_issues:[...source.issues]});
  if(link.state==='NOT_APPLICABLE'){
   if(link.segment_ids.length||link.charge_kind!=='UNCONFIRMED'||link.scope_id.trim())add('NOT_APPLICABLE_HAS_LINKS','明确不适用时须清空段引用、收费类型和范围，保留不适用依据',id);
   continue;
  }
  if(!plan||!segments.length)add('TRANSPORT_REQUIRED','明确关联须有实际运输分段，不能从费用名称补造运输段',id);
  if(!link.segment_ids.length)add('SEGMENTS_REQUIRED','明确关联至少选择一个运输段',id);
  if(link.charge_kind==='UNCONFIRMED')add('CHARGE_KIND_UNCONFIRMED','须明确本关联的收费类型',id);
  if(!link.scope_id.trim())add('CHARGE_SCOPE_REQUIRED','须据合同或账单明确收费范围编号',id);
  let previous=-1,valid=true;const seen=new Set<string>();
  for(const segmentId of link.segment_ids){
   const index=bySegment.get(segmentId);
   if(seen.has(segmentId)){add('DUPLICATE_SEGMENT','段引用重复，不自动去重',id,segmentId);valid=false;}seen.add(segmentId);
   if(index===undefined){add('UNKNOWN_SEGMENT','引用的运输段不存在',id,segmentId);valid=false;continue;}
   if(previous>=0&&index!==previous+1){add('NONCONTIGUOUS_SEGMENTS','须按原路线连续选段；不自动排序或补中间段',id,segmentId);valid=false;}
   if(previous>=0&&index===previous+1&&segments[previous]!.to.trim()!==segments[index]!.from.trim()){add('ROUTE_GAP','所选相邻运输段地点未衔接，须明确实际范围',id,segmentId);valid=false;}
   previous=index;
  }
  if(valid&&link.segment_ids.length){link.segment_ids.forEach(segmentId=>covered.add(segmentId));linked.push({cost,link});}
 }
 for(let a=0;a<linked.length;a++)for(let b=a+1;b<linked.length;b++){
  const x=linked[a]!,y=linked[b]!;
  if(x.link.charge_kind==='UNCONFIRMED'||x.link.charge_kind!==y.link.charge_kind||!x.link.scope_id.trim()||x.link.scope_id!==y.link.scope_id)continue;
  const common=x.link.segment_ids.filter(id=>y.link.segment_ids.includes(id));if(!common.length)continue;
  const direct=x.cost.contained_in_cost_id===y.cost.cost_id||y.cost.contained_in_cost_id===x.cost.cost_id;
  result.potential_overlaps.push({cost_ids:[x.cost.cost_id,y.cost.cost_id],segment_ids:common,charge_kind:x.link.charge_kind,scope_id:x.link.scope_id,existing_containment:direct?'DIRECT':x.cost.contained_in_cost_id&&x.cost.contained_in_cost_id===y.cost.contained_in_cost_id?'COMMON_PARENT':'NONE'});
 }
 result.segments_without_links=segments.map(s=>s.segment_id).filter(id=>!covered.has(id));
 result.reference_checks_passed=result.requested&&result.active_target_cost_ids.length>0&&issues.length===0;
 result.review_required=issues.length>0||result.potential_overlaps.length>0;
 return result;
}
