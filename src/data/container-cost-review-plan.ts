import type {ContainerCostPair} from '../domain/container-cost-pair.js';
import type {ContainerCostReview} from '../domain/container-cost-review.js';
import type {ContainerCostReviewPlan,ContainerReviewRecord,ContainerReviewRecordInput} from '../domain/container-cost-review-plan.js';
import {INCOTERMS} from '../domain/enums.js';
import {emptyEvidence,evidenceKey,type SourceEvidence} from '../domain/source-evidence.js';
import {validateContainerCostPair} from './container-cost-pair.js';
import {validateContainerBillEvidence} from './container-bill-file.js';
import {validateContainerCostProposalJson} from '../engine/container-cost-proposal.js';
import {reviewContainerCostBoundaries} from '../engine/container-cost-review.js';
import {checkSource} from '../engine/decision-readiness.js';
import {isIsoDate} from '../engine/tax/china-import.js';
import type {JsonSchema} from './project-validation.js';

export const CONTAINER_REVIEW_PLAN_BYTES=10*1024*1024;
export const CONTAINER_REVIEW_RECORD_LIMIT=2000;
const MAX_REVISION=1000000000;
const key=(value:unknown)=>evidenceKey(value,emptyEvidence());
function fail(reason:string):never {throw Error('CONTAINER_COST_REVIEW_PLAN_INVALID:'+reason);}
function shape(v:unknown,required:string[]):asserts v is Record<string,unknown>{
 if(!v||typeof v!=='object'||Array.isArray(v)||required.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!required.includes(k)))fail('shape');
}
function text(v:unknown,max:number,id=false):asserts v is string {
 if(typeof v!=='string'||Array.from(v).length>max||!v.trim()||id&&['__proto__','constructor','prototype'].includes(v))fail('text');
}
function revision(v:unknown):void {if(!Number.isSafeInteger(v)||Number(v)<1||Number(v)>MAX_REVISION)fail('revision');}
function record(value:unknown,stored:true):asserts value is ContainerReviewRecord;
function record(value:unknown,stored:false):asserts value is ContainerReviewRecordInput;
function record(value:unknown,stored:boolean):asserts value is ContainerReviewRecordInput {
 if(!value||typeof value!=='object'||Array.isArray(value))fail('record');const r=value as Record<string,unknown>;
 const common=['decision','target','explanation','evidence',...(stored?['record_id']:[])];
 const extra=r.decision==='FULL_PARENT_INCLUSION'?['coverage']:r.decision==='DIFFERENT_CHARGE_CONTENT'?['left_description','right_description']:[];
 shape(r,[...common,...extra]);if(stored)text(r.record_id,200,true);text(r.explanation,4000);validateContainerBillEvidence(r.evidence);
 const target=r.target;if(!target||typeof target!=='object'||Array.isArray(target))fail('target');const t=target as Record<string,unknown>;
 if(t.kind==='BILL_PAIR'){
  shape(t,['kind','line_ids']);if(!Array.isArray(t.line_ids)||t.line_ids.length!==2)fail('line_ids');t.line_ids.forEach(v=>text(v,200,true));
  // Canonical UTF-16 order; reject reversal rather than silently swapping service descriptions.
  if(!(t.line_ids[0]<t.line_ids[1]))fail('line_order');
 }else{
  const extra=t.kind==='PARENT'?['parent_cost_id']:t.kind==='EXISTING_COST'?['target_cost_id']:t.kind==='ROW'?[]:fail('target_kind');
  shape(t,['kind','mapping_id','line_id','cost_id',...extra]);for(const field of ['mapping_id','line_id','cost_id',...extra])text(t[field],200,true);
 }
 if(r.decision==='QUOTE_INCLUDED'||r.decision==='KEEP_RECORDED_AMOUNT'){if(t.kind!=='ROW')fail('decision_target');}
 else if(r.decision==='FULL_PARENT_INCLUSION'){if(t.kind!=='PARENT'||r.coverage!=='FULL')fail('coverage');}
 else if(r.decision==='DIFFERENT_CHARGE_CONTENT'){
  if(!['BILL_PAIR','EXISTING_COST'].includes(t.kind as string))fail('decision_target');
  text(r.left_description,4000);text(r.right_description,4000);
  if(r.left_description.normalize('NFC').trim()===r.right_description.normalize('NFC').trim())fail('same_description');
 }else if(r.decision==='DISJOINT_COVERAGE'){if(t.kind!=='BILL_PAIR')fail('decision_target');}
 else fail('decision');
}
const facet=(r:ContainerReviewRecordInput)=>r.decision==='QUOTE_INCLUDED'?'QUOTE':r.decision==='KEEP_RECORDED_AMOUNT'?'AMOUNT':r.decision==='FULL_PARENT_INCLUSION'?'PARENT':'COVERAGE';
const slot=(r:ContainerReviewRecordInput)=>key({facet:facet(r),target:r.target});
function contentKey(plan:Omit<ContainerCostReviewPlan,'content_key'>|ContainerCostReviewPlan):string {
 const {content_key:_key,...values}=plan as ContainerCostReviewPlan;return key(values);
}
export function validateContainerCostReviewPlan(value:unknown):asserts value is ContainerCostReviewPlan {
 validateContainerCostProposalJson(value);
 shape(value,['kind','version','plan_id','revision','basis','records','retired_record_ids','content_key']);
 if(value.kind!=='INTERNAL_CONTAINER_COST_REVIEW_PLAN'||value.version!=='0.1')fail('kind/version');text(value.plan_id,200,true);revision(value.revision);
 shape(value.basis,['pair_id','pair_revision','pair_key','term','review_date']);text(value.basis.pair_id,200,true);revision(value.basis.pair_revision);text(value.basis.pair_key,CONTAINER_REVIEW_PLAN_BYTES);
 if(!INCOTERMS.includes(value.basis.term as never)||typeof value.basis.review_date!=='string'||!isIsoDate(value.basis.review_date))fail('basis');
 if(!Array.isArray(value.records)||value.records.length>CONTAINER_REVIEW_RECORD_LIMIT||!Array.isArray(value.retired_record_ids)||value.retired_record_ids.length>CONTAINER_REVIEW_RECORD_LIMIT)fail('records');
 const ids=new Set<string>(),slots=new Set<string>();
 for(const raw of value.records){record(raw,true);const s=slot(raw);if(ids.has(raw.record_id)||slots.has(s))fail('duplicate_record');ids.add(raw.record_id);slots.add(s);}
 for(const raw of value.retired_record_ids){text(raw,200,true);if(ids.has(raw))fail('retired_identity');ids.add(raw);}
 if(typeof value.content_key!=='string'||value.content_key!==contentKey(value as unknown as ContainerCostReviewPlan))fail('content_key');
 if(new TextEncoder().encode(JSON.stringify(value,null,2)+'\n').length>CONTAINER_REVIEW_PLAN_BYTES)fail('size');
}
function seal(plan:Omit<ContainerCostReviewPlan,'content_key'>|ContainerCostReviewPlan):ContainerCostReviewPlan {
 const result={...structuredClone(plan),content_key:contentKey(plan)};validateContainerCostReviewPlan(result);return result;
}
function basis(pair:ContainerCostPair):ContainerCostReviewPlan['basis'] {
 return{pair_id:pair.pair_id,pair_revision:pair.revision,pair_key:pair.content_key,term:pair.project.incoterm,review_date:pair.bill.review_date};
}
function lease(plan:ContainerCostReviewPlan,expected_key:string):void {validateContainerCostReviewPlan(plan);if(plan.content_key!==expected_key)fail('stale_plan');}
function current(plan:ContainerCostReviewPlan,pair:ContainerCostPair):boolean {return key(plan.basis)===key(basis(pair));}
function bound(plan:ContainerCostReviewPlan,expected_key:string,pair:ContainerCostPair):ContainerCostReview {
 lease(plan,expected_key);validateContainerCostPair(pair);if(!current(plan,pair))fail('stale_basis');return reviewContainerCostBoundaries(pair,pair.content_key);
}
function next(plan:ContainerCostReviewPlan):ContainerCostReviewPlan {if(plan.revision>=MAX_REVISION)fail('revision_limit');const copy=structuredClone(plan);copy.revision++;return copy;}
function targetIssues(r:ContainerReviewRecordInput,audit:ContainerCostReview):string[] {
 const t=r.target,issues:string[]=[];
 if(t.kind==='BILL_PAIR'){
  const range=audit.coverage.find(c=>JSON.stringify([...c.line_ids].sort())===JSON.stringify(t.line_ids));
  if(!range)issues.push('COVERAGE_TARGET_MISSING');
  else if(r.decision==='DISJOINT_COVERAGE'&&!['DISJOINT_BOXES','DISJOINT_DAYS'].includes(range.status))issues.push('DISJOINT_COVERAGE_NOT_PROVEN');
 }else{
  const row=audit.rows.find(row=>row.mapping.mapping_id===t.mapping_id&&row.mapping.line_id===t.line_id&&row.mapping.cost_id===t.cost_id);
  if(!row)issues.push('MAPPING_TARGET_MISSING');
  else if(t.kind==='ROW'){
   if(r.decision==='QUOTE_INCLUDED'&&row.quote_inclusion.recorded!==true)issues.push('QUOTE_INCLUSION_NOT_RECORDED');
   if(r.decision==='KEEP_RECORDED_AMOUNT'&&row.original_amount===null)issues.push('ORIGINAL_AMOUNT_UNKNOWN');
  }else if(t.kind==='EXISTING_COST'){
   if(!audit.existing_cost_candidates.some(c=>c.line_id===t.line_id&&c.cost_id===t.target_cost_id))issues.push('EXISTING_COST_TARGET_MISSING');
  }else{
   const relation=audit.parent_relationships.find(p=>p.cost_id===t.cost_id&&p.parent_cost_id===t.parent_cost_id);
   if(!relation)issues.push('PARENT_TARGET_MISSING');
   else issues.push(...relation.issues.filter(i=>i!=='FULL_COVERAGE_EVIDENCE_REQUIRED'));
   if(audit.issues.includes('PROJECT_COST_SELECTION_INVALID'))issues.push('PROJECT_COST_SELECTION_INVALID');
  }
 }
 return issues;
}
function sourceValues(plan:ContainerCostReviewPlan,r:ContainerReviewRecord):unknown {
 const {evidence:_evidence,...values}=r;return{plan_id:plan.plan_id,basis:plan.basis,record:values};
}
function sourceIssues(plan:ContainerCostReviewPlan,r:ContainerReviewRecord):string[] {
 // A valid key contains the full business key. Reject implausibly short imported keys
 // before rebuilding a large context for each claimed confirmation.
 const expected=r.evidence.status==='USER_CONFIRMED'&&r.evidence.values_key!==undefined&&r.evidence.values_key.length>=plan.basis.pair_key.length?evidenceKey(sourceValues(plan,r),r.evidence):undefined;
 const issues=checkSource('核对假设',plan.basis.review_date,r.evidence,expected).issues;
 if(isIsoDate(r.evidence.checked_on)&&r.evidence.checked_on>plan.basis.review_date)issues.push('CHECKED_ON_AFTER_REVIEW_DATE');return issues;
}
export function createContainerCostReviewPlan(pair:ContainerCostPair,expected_pair_key:string):ContainerCostReviewPlan {
 reviewContainerCostBoundaries(pair,expected_pair_key);if(!isIsoDate(pair.bill.review_date))fail('review_date');
 return seal({kind:'INTERNAL_CONTAINER_COST_REVIEW_PLAN',version:'0.1',plan_id:'review-'+crypto.randomUUID(),revision:1,basis:basis(pair),records:[],retired_record_ids:[]});
}
/** Explicit edit clears only this record's confirmation; unrelated records keep their source lease. */
export function setContainerReviewRecord(plan:ContainerCostReviewPlan,expected_key:string,pair:ContainerCostPair,input:ContainerReviewRecordInput):ContainerCostReviewPlan {
 const audit=bound(plan,expected_key,pair);validateContainerCostProposalJson(input);record(input,false);if(targetIssues(input,audit).length)fail('unsupported_target');
 const copy=next(plan),index=copy.records.findIndex(r=>slot(r)===slot(input));
 const evidence=structuredClone(input.evidence);if(evidence.status==='USER_CONFIRMED')evidence.status='UNVERIFIED';delete evidence.values_key;
 const record_id=index<0?'record-'+crypto.randomUUID():copy.records[index]!.record_id;
 if(index<0&&(copy.records.some(r=>r.record_id===record_id)||copy.retired_record_ids.includes(record_id)))fail('identity_collision');
 const result={...structuredClone(input),evidence,record_id};if(index<0)copy.records.push(result);else copy.records[index]=result;return seal(copy);
}
export function confirmContainerReviewRecord(plan:ContainerCostReviewPlan,expected_key:string,pair:ContainerCostPair,record_id:string):ContainerCostReviewPlan {
 const audit=bound(plan,expected_key,pair),copy=next(plan),r=copy.records.find(r=>r.record_id===record_id);if(!r||targetIssues(r,audit).length||r.evidence.status==='EXAMPLE')fail('confirmation');
 r.evidence.status='USER_CONFIRMED';r.evidence.values_key=evidenceKey(sourceValues(copy,r),r.evidence);
 if(r.evidence.values_key.length>1048576||sourceIssues(copy,r).length)fail('source');return seal(copy);
}
export function removeContainerReviewRecord(plan:ContainerCostReviewPlan,expected_key:string,record_id:string):ContainerCostReviewPlan {
 lease(plan,expected_key);if(!plan.records.some(r=>r.record_id===record_id))fail('record_missing');const copy=next(plan);
 copy.records=copy.records.filter(r=>r.record_id!==record_id);copy.retired_record_ids.push(record_id);return seal(copy);
}
/** Explicit same-business refresh preserves all old text/targets but invalidates every source. */
export function rebaseContainerCostReviewPlan(plan:ContainerCostReviewPlan,expected_key:string,pair:ContainerCostPair,expected_pair_key:string):ContainerCostReviewPlan {
 lease(plan,expected_key);reviewContainerCostBoundaries(pair,expected_pair_key);if(plan.basis.pair_id!==pair.pair_id)fail('different_business');
 if(current(plan,pair))return structuredClone(plan);const copy=next(plan);copy.basis=basis(pair);
 for(const r of copy.records){if(r.evidence.status==='USER_CONFIRMED')r.evidence.status='UNVERIFIED';delete r.evidence.values_key;}return seal(copy);
}
export function reviewContainerCostReviewPlan(plan:ContainerCostReviewPlan,pair:ContainerCostPair){
 validateContainerCostReviewPlan(plan);const audit=reviewContainerCostBoundaries(pair,pair.content_key),basis_current=current(plan,pair);
 const result={scope:'RECORDED_ASSUMPTIONS_ONLY' as const,plan_id:plan.plan_id,revision:plan.revision,plan_key:plan.content_key,pair_key:pair.content_key,basis_current,issues:['NO_FEE_APPLICATION',...(!basis_current?['STALE_BUSINESS_BASIS']:[])],
  boundary_review:audit,records:plan.records.map(r=>{const issues=[...(!basis_current?['STALE_BUSINESS_BASIS']:[]),...targetIssues(r,audit),...sourceIssues(plan,r)];return{record_id:r.record_id,status:issues.length?'NEEDS_REVIEW' as const:'RECORDED_ASSUMPTION' as const,issues};})};
 validateContainerCostProposalJson(result);return result;
}
export function serializeContainerCostReviewPlan(plan:ContainerCostReviewPlan):string {validateContainerCostReviewPlan(plan);return JSON.stringify(plan,null,2)+'\n';}
export function parseContainerCostReviewPlan(text:string):ContainerCostReviewPlan {
 if(typeof text!=='string'||new TextEncoder().encode(text).length>CONTAINER_REVIEW_PLAN_BYTES)fail('size');let value:unknown;try{value=JSON.parse(text);}catch{fail('JSON');}validateContainerCostReviewPlan(value);return value;
}

export function containerCostReviewPlanSchema():JsonSchema {
 const id={type:'string',minLength:1,maxLength:200,pattern:'\\S',not:{enum:['__proto__','constructor','prototype']}},text={type:'string',maxLength:4000,pattern:'\\S'};
 const obj=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
 const row=obj({kind:{const:'ROW'},mapping_id:id,line_id:id,cost_id:id});
 const pair=obj({kind:{const:'BILL_PAIR'},line_ids:{type:'array',minItems:2,maxItems:2,uniqueItems:true,items:id}});
 const parent=obj({kind:{const:'PARENT'},mapping_id:id,line_id:id,cost_id:id,parent_cost_id:id});
 const existing=obj({kind:{const:'EXISTING_COST'},mapping_id:id,line_id:id,cost_id:id,target_cost_id:id});
 const source=obj({reference:{type:'string',maxLength:4000},valid_from:{type:'string',maxLength:4000},valid_to:{type:'string',maxLength:4000},checked_on:{type:'string',maxLength:4000},status:{enum:['EXAMPLE','UNVERIFIED','USER_CONFIRMED']},values_key:{type:'string',maxLength:1048576}},['reference','valid_from','valid_to','checked_on','status']);
 const common={record_id:id,explanation:text,evidence:source};
 return{$schema:'http://json-schema.org/draft-07/schema#',$id:'urn:cocudtt:internal-container-cost-review-plan:0.1',title:'COCUDTT internal review records 0.1',description:'Internal assumptions only. Full snapshot, canonical order, duplicate facets, target eligibility and source confirmation require runtime checks. No fees applied.',
  ...obj({kind:{const:'INTERNAL_CONTAINER_COST_REVIEW_PLAN'},version:{const:'0.1'},plan_id:id,revision:{type:'integer',minimum:1,maximum:MAX_REVISION},basis:obj({pair_id:id,pair_revision:{type:'integer',minimum:1,maximum:MAX_REVISION},pair_key:{type:'string',minLength:1,maxLength:CONTAINER_REVIEW_PLAN_BYTES},term:{enum:INCOTERMS},review_date:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'}}),records:{type:'array',maxItems:CONTAINER_REVIEW_RECORD_LIMIT,items:{oneOf:[obj({...common,decision:{enum:['QUOTE_INCLUDED','KEEP_RECORDED_AMOUNT']},target:row}),obj({...common,decision:{const:'FULL_PARENT_INCLUSION'},target:parent,coverage:{const:'FULL'}}),obj({...common,decision:{const:'DIFFERENT_CHARGE_CONTENT'},target:{oneOf:[pair,existing]},left_description:text,right_description:text}),obj({...common,decision:{const:'DISJOINT_COVERAGE'},target:pair})]}},retired_record_ids:{type:'array',maxItems:CONTAINER_REVIEW_RECORD_LIMIT,uniqueItems:true,items:id},content_key:{type:'string'}})};
}
