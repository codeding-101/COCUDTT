import type {ContainerCostPair} from '../domain/container-cost-pair.js';
import type {ContainerReviewRecordInput} from '../domain/container-cost-review-plan.js';
import {emptyEvidence} from '../domain/source-evidence.js';
import {containerCostPairBusiness,validateContainerCostPair} from './container-cost-pair.js';
import {validateContainerCostProposalJson} from '../engine/container-cost-proposal.js';
import {reviewContainerCostBoundaries} from '../engine/container-cost-review.js';

export const REVIEW_EDITOR_STORAGE_KEY='trade-cost-engine:container-review-editor-v1';
export const REVIEW_EDITOR_FIELDS=['decision','target','explanation','coverage','left_description','right_description','reference','valid_from','valid_to','checked_on'] as const;
export type ReviewEditorField=typeof REVIEW_EDITOR_FIELDS[number];
export interface ContainerReviewEditor {
 kind:'INTERNAL_CONTAINER_REVIEW_EDITOR';version:'0.1';pair_id:string;pair_key:string;original_record_id:string|null;
 fields:Record<ReviewEditorField,string>;
}
const decisions=['QUOTE_INCLUDED','KEEP_RECORDED_AMOUNT','FULL_PARENT_INCLUSION','DIFFERENT_CHARGE_CONTENT','DISJOINT_COVERAGE'];
export const containerReviewTargetKey=(target:ContainerReviewRecordInput['target'])=>JSON.stringify(Object.fromEntries(Object.entries(target).sort(([a],[b])=>a<b?-1:a>b?1:0)));
function fail():never {throw Error('CONTAINER_REVIEW_EDITOR_INVALID');}
export function validateContainerReviewEditor(value:unknown):asserts value is ContainerReviewEditor {
 validateContainerCostProposalJson(value);
 if(!value||typeof value!=='object'||Array.isArray(value))fail();const v=value as Record<string,unknown>;
 if(Object.keys(v).sort().join('|')!==['kind','version','pair_id','pair_key','original_record_id','fields'].sort().join('|')||v.kind!=='INTERNAL_CONTAINER_REVIEW_EDITOR'||v.version!=='0.1')fail();
 if(typeof v.pair_id!=='string'||!v.pair_id.trim()||v.pair_id.length>200||typeof v.pair_key!=='string'||!v.pair_key||v.original_record_id!==null&&(typeof v.original_record_id!=='string'||!v.original_record_id.trim()||v.original_record_id.length>200))fail();
 if(!v.fields||typeof v.fields!=='object'||Array.isArray(v.fields))fail();const f=v.fields as Record<string,unknown>;
 if(Object.keys(f).sort().join('|')!==[...REVIEW_EDITOR_FIELDS].sort().join('|')||Object.values(f).some(x=>typeof x!=='string'||Array.from(x).length>4000))fail();
 if(f.decision!==''&&!decisions.includes(f.decision as string))fail();
}
export function containerReviewEditorIsCurrent(editor:ContainerReviewEditor,pair:ContainerCostPair):boolean {
 try{validateContainerReviewEditor(editor);validateContainerCostPair(pair);return pair.version==='1.1'&&editor.pair_id===pair.pair_id&&editor.pair_key===pair.content_key&&(!editor.original_record_id||!!pair.review_plan?.records.some(r=>r.record_id===editor.original_record_id));}catch{return false;}
}
export function containerReviewTargets(pair:ContainerCostPair,decision:string){
 const business=containerCostPairBusiness(pair),audit=reviewContainerCostBoundaries(business,business.content_key);
 const options:{key:string;label:string;target:ContainerReviewRecordInput['target']}[]=[];
 const add=(target:ContainerReviewRecordInput['target'],label:string)=>options.push({target,key:containerReviewTargetKey(target),label});
 const rowTarget=(row:typeof audit.rows[number])=>({kind:'ROW' as const,mapping_id:row.mapping.mapping_id,line_id:row.mapping.line_id,cost_id:row.mapping.cost_id});
 const label=(id:string)=>{const i=pair.bill.rows.findIndex(r=>r.input.line_id===id);return`账单行${i+1}（${pair.bill.rows[i]?.input.charge_kind??'未知收费'}）`;};
 if(decision==='QUOTE_INCLUDED'||decision==='KEEP_RECORDED_AMOUNT')for(const row of audit.rows){
  if(decision==='QUOTE_INCLUDED'?row.quote_inclusion.recorded===true:row.original_amount!==null)add(rowTarget(row),label(row.mapping.line_id)+' → '+row.mapping.cost_id);
 }
 if(decision==='FULL_PARENT_INCLUSION'&&!audit.issues.includes('PROJECT_COST_SELECTION_INVALID'))for(const p of audit.parent_relationships){
  const row=audit.rows.find(r=>r.mapping.cost_id===p.cost_id);if(row&&p.issues.every(i=>i==='FULL_COVERAGE_EVIDENCE_REQUIRED'))add({...rowTarget(row),kind:'PARENT',parent_cost_id:p.parent_cost_id},label(row.mapping.line_id)+' → 父项 '+p.parent_cost_id);
 }
 if(decision==='DIFFERENT_CHARGE_CONTENT'||decision==='DISJOINT_COVERAGE')for(const range of audit.coverage){
  if(decision==='DISJOINT_COVERAGE'&&!['DISJOINT_BOXES','DISJOINT_DAYS'].includes(range.status))continue;
  const ids=[...range.line_ids].sort() as [string,string];add({kind:'BILL_PAIR',line_ids:ids},label(ids[0])+' ↔ '+label(ids[1]));
 }
 if(decision==='DIFFERENT_CHARGE_CONTENT')for(const c of audit.existing_cost_candidates){const row=audit.rows.find(r=>r.mapping.line_id===c.line_id)!;add({...rowTarget(row),kind:'EXISTING_COST',target_cost_id:c.cost_id},label(c.line_id)+' ↔ 已有费用 '+c.cost_id);}
 return options;
}
export function startContainerReviewEditor(pair:ContainerCostPair,record_id:string|null=null):ContainerReviewEditor {
 validateContainerCostPair(pair);if(pair.version!=='1.1')fail();const r=record_id?pair.review_plan!.records.find(r=>r.record_id===record_id):null;if(record_id&&!r)fail();
 const fields=Object.fromEntries(REVIEW_EDITOR_FIELDS.map(k=>[k,''])) as ContainerReviewEditor['fields'];
 if(r){fields.decision=r.decision;fields.target=containerReviewTargetKey(r.target);fields.explanation=r.explanation;
  for(const f of ['reference','valid_from','valid_to','checked_on'] as const)fields[f]=r.evidence[f];
  if(r.decision==='FULL_PARENT_INCLUSION')fields.coverage=r.coverage;
  if(r.decision==='DIFFERENT_CHARGE_CONTENT'){fields.left_description=r.left_description;fields.right_description=r.right_description;}
 }
 const result:ContainerReviewEditor={kind:'INTERNAL_CONTAINER_REVIEW_EDITOR',version:'0.1',pair_id:pair.pair_id,pair_key:pair.content_key,original_record_id:record_id,fields};validateContainerReviewEditor(result);return result;
}
export function buildContainerReviewRecord(editor:ContainerReviewEditor,pair:ContainerCostPair):ContainerReviewRecordInput {
 if(!containerReviewEditorIsCurrent(editor,pair))fail();const f=editor.fields,option=containerReviewTargets(pair,f.decision).find(o=>o.key===f.target);if(!option)fail();
 const original=editor.original_record_id?pair.review_plan!.records.find(r=>r.record_id===editor.original_record_id):null;
 if(original&&(original.decision!==f.decision||containerReviewTargetKey(original.target)!==f.target))fail();
 const evidence={...emptyEvidence(),reference:f.reference,valid_from:f.valid_from,valid_to:f.valid_to,checked_on:f.checked_on};if(original?.evidence.status==='EXAMPLE')evidence.status='EXAMPLE';
 const common={explanation:f.explanation,evidence},target=structuredClone(option.target);
 if((f.decision==='QUOTE_INCLUDED'||f.decision==='KEEP_RECORDED_AMOUNT')&&target.kind==='ROW')return{...common,decision:f.decision,target};
 if(f.decision==='FULL_PARENT_INCLUSION'&&target.kind==='PARENT'&&f.coverage==='FULL')return{...common,decision:f.decision,target,coverage:'FULL'};
 if(f.decision==='DIFFERENT_CHARGE_CONTENT'&&(target.kind==='BILL_PAIR'||target.kind==='EXISTING_COST'))return{...common,decision:f.decision,target,left_description:f.left_description,right_description:f.right_description};
 if(f.decision==='DISJOINT_COVERAGE'&&target.kind==='BILL_PAIR')return{...common,decision:f.decision,target};fail();
}
