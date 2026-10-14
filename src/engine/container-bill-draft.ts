import Decimal from 'decimal.js';
import type {ContainerBillAudit,ContainerBillLine,ContainerBillLineAudit} from '../domain/container-bill.js';
import type {ContainerBillDraft,ContainerBillDraftRow} from '../domain/container-bill-draft.js';
import {containerBillSourceValues} from '../domain/container-bill-draft.js';
import {evidenceKey,type SourceEvidence} from '../domain/source-evidence.js';
import type {ProjectFile} from '../data/project-file.js';
import {toTrade} from '../data/project-file.js';
import {validateContainerBillDraft,validateContainerBillEvidence} from '../data/container-bill-file.js';
import {containerBillBinding,containerBillCostSourceValues} from '../data/container-bill-context.js';
import {calculateContainerBill,validateContainerBillInput} from './container-bill.js';
import {checkSource} from './decision-readiness.js';
import {costsForTerm} from './scenario-costs.js';

export interface ContainerBillDraftReview {
 scope:'DRAFT_REFERENCE_ONLY';issues:string[];
 rows:{line_id:string;calculation:ContainerBillLineAudit|null;input_issue:string|null;source_current:boolean;source_issues:string[];
  cost_reference:null|{cost_id:string;issues:string[];source_issues:string[];existing_containment:string|null;included_in_quoted_price:boolean|null}}[];
 potential_overlaps:ContainerBillAudit['potential_overlaps'];
}
function sameBinding(file:ContainerBillDraft,project:ProjectFile):boolean {
 const expected=containerBillBinding(project);return file.binding?.term===expected.term&&file.binding.context_key===expected.context_key;
}
/** Only original FIXED amount is compared; no global precision, conversion or rounding. */
function sameAmount(value:unknown,expected:string):boolean {
 try{const d=new Decimal(String(value));return d.isFinite()&&!d.isNegative()&&d.eq(expected);}catch{return false;}
}
export function reviewContainerBillDraft(file:ContainerBillDraft,project?:ProjectFile):ContainerBillDraftReview {
 validateContainerBillDraft(file);
 const issues:string[]=[],valid:ContainerBillLine[]=[],bad=new Map<string,string>();
 if(!file.rows.length)issues.push('EMPTY_REVIEW_SCOPE');
 if(project&&!sameBinding(file,project))issues.push('PROJECT_BINDING_MISMATCH');
 const references=new Map<string,number>();for(const row of file.rows)if(row.cost_reference?.cost_id)references.set(row.cost_reference.cost_id,(references.get(row.cost_reference.cost_id)??0)+1);
 let active:Set<string>|undefined;
 if(project){try{active=new Set(costsForTerm(toTrade(project),project.incoterm).trade.items.map(item=>item.cost_id));}catch{issues.push('PROJECT_COST_SELECTION_INVALID');}}
 for(const row of file.rows){
  const input={version:'0.1',lines:[row.input]};
  try{validateContainerBillInput(input);valid.push(input.lines[0]!);}catch(error){
   if(!(error instanceof Error)||!error.message.startsWith('CONTAINER_BILL_INVALID:'))throw Error('CONTAINER_BILL_REVIEW_FAILED');
   bad.set(row.input.line_id,error.message);
  }
 }
 if(bad.size)issues.push('OVERLAP_SCOPE_INCOMPLETE');
 const audit=calculateContainerBill({version:'0.1',lines:valid}),calculations=new Map(audit.lines.map(a=>[a.input.line_id,a]));
 const rows=file.rows.map(row=>{
  const id=row.input.line_id,e=row.evidence,source=checkSource('账单条件',file.review_date,e,e?evidenceKey(containerBillSourceValues(file,row),e):undefined);
  const calculation=calculations.get(id)??null,ref=row.cost_reference;
  let cost_reference:ContainerBillDraftReview['rows'][number]['cost_reference']=null;
  if(ref){
   const problems:string[]=[],candidates=project?.items.filter(c=>c.cost_id===ref.cost_id)??[],cost=candidates.length===1?candidates[0]:undefined;
   if(!project)problems.push('PROJECT_REQUIRED');else if(!sameBinding(file,project))problems.push('PROJECT_BINDING_MISMATCH');
   if(!ref.cost_id.trim())problems.push('COST_ID_REQUIRED');else if(project&&!candidates.length)problems.push('UNKNOWN_COST');else if(candidates.length>1)problems.push('AMBIGUOUS_COST');
   if((references.get(ref.cost_id)??0)>1)problems.push('MULTIPLE_LINES_REFERENCE_SAME_COST');
   if(!ref.note.trim())problems.push('REFERENCE_NOTE_REQUIRED');
   if(cost){
    if(!active?.has(cost.cost_id))problems.push('COST_NOT_ACTIVE_OR_SELECTION_INVALID');
    if(cost.currency!==row.input.currency)problems.push('COST_CURRENCY_MISMATCH');
    if(cost.container_charge!==row.input.charge_kind||cost.container_charge_scope!==row.input.scope_id)problems.push('COST_SCOPE_REVIEW_REQUIRED');
    if(!calculation)problems.push('BILL_INPUT_NOT_CALCULABLE');
    else if(cost.pricing_method!=='FIXED')problems.push('NON_FIXED_AMOUNT_REVIEW_REQUIRED');
    else if(typeof cost.amount!=='string')problems.push('ORIGINAL_AMOUNT_TEXT_REQUIRED');
    else if(!sameAmount(cost.amount,calculation.amount))problems.push('COST_AMOUNT_MISMATCH');
    if(cost.contained_in_cost_id||cost.included_in_quoted_price)problems.push('EXISTING_INCLUSION_REVIEW_REQUIRED');
    if((row.input.charge_kind==='THC_ORIGIN'||row.input.charge_kind==='THC_DESTINATION')&&project?.items.some(c=>active?.has(c.cost_id)&&c.includes_port_charges))problems.push('PORT_CHARGE_INCLUSION_REVIEW_REQUIRED');
   }
   const s=checkSource('已有费用引用',file.review_date,ref.evidence,project&&ref.evidence?evidenceKey(containerBillCostSourceValues(file,row,project),ref.evidence):undefined);
   cost_reference={cost_id:ref.cost_id,issues:problems,source_issues:s.issues,existing_containment:cost?.contained_in_cost_id??null,included_in_quoted_price:cost?.included_in_quoted_price??null};
  }
  return{line_id:id,calculation,input_issue:bad.get(id)??null,source_current:!!calculation&&source.issues.length===0,source_issues:source.issues,cost_reference};
 });
 return{scope:'DRAFT_REFERENCE_ONLY',issues,rows,potential_overlaps:audit.potential_overlaps};
}
function confirmedEvidence(values:unknown,date:string,input:SourceEvidence):SourceEvidence {
 validateContainerBillEvidence(input);
 if(input.status==='EXAMPLE')throw Error('CONTAINER_BILL_CONFIRM_INVALID:example');
 const e={...structuredClone(input),status:'USER_CONFIRMED' as const};e.values_key=evidenceKey(values,e);
 if(checkSource('账单人工确认',date,e,e.values_key).issues.length)throw Error('CONTAINER_BILL_CONFIRM_INVALID:source');
 return e;
}
function selectedRow(file:ContainerBillDraft,id:string):ContainerBillDraftRow {
 const row=file.rows.find(row=>row.input.line_id===id);if(!row)throw Error('CONTAINER_BILL_CONFIRM_INVALID:line');return row;
}
export function confirmContainerBillLine(file:ContainerBillDraft,id:string,source:SourceEvidence):ContainerBillDraft {
 validateContainerBillDraft(file);const row=selectedRow(file,id);validateContainerBillInput({version:'0.1',lines:[row.input]});
 const copy=structuredClone(file);selectedRow(copy,id).evidence=confirmedEvidence(containerBillSourceValues(file,row),file.review_date,source);
 validateContainerBillDraft(copy);return copy;
}
/** Records a reference only. Even a clean reference does not write a cost or resolve overlaps. */
export function confirmContainerBillCostReference(file:ContainerBillDraft,id:string,project:ProjectFile,source:SourceEvidence):ContainerBillDraft {
 validateContainerBillDraft(file);const row=selectedRow(file,id),review=reviewContainerBillDraft(file,project).rows.find(r=>r.line_id===id)!;
 if(!review.source_current||!review.cost_reference||review.cost_reference.issues.length)throw Error('CONTAINER_BILL_CONFIRM_INVALID:cost_reference');
 const copy=structuredClone(file),ref=selectedRow(copy,id).cost_reference!;
 ref.evidence=confirmedEvidence(containerBillCostSourceValues(file,row,project),file.review_date,source);
 validateContainerBillDraft(copy);return copy;
}
