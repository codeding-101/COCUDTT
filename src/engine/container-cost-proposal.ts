import type {ContainerBillDraft} from '../domain/container-bill-draft.js';
import type {ContainerCostIntent,ContainerCostProposal,ContainerCostProposalInput} from '../domain/container-cost-proposal.js';
import {emptyEvidence,evidenceKey,type SourceEvidence} from '../domain/source-evidence.js';
import type {ProjectFile} from '../data/project-file.js';
import {toTrade} from '../data/project-file.js';
import {validateProjectStructure} from '../data/project-validation.js';
import {validateContainerBillDraft,validateContainerBillEvidence} from '../data/container-bill-file.js';
import {reviewContainerBillDraft} from './container-bill-draft.js';
import {costsForTerm} from './scenario-costs.js';
import {checkSource} from './decision-readiness.js';

function fail(path:string):never {throw Error('CONTAINER_COST_PROPOSAL_INVALID:'+path);}
/** Validate descriptors before serialization so getters and lossy JSON never enter a lease. */
function jsonInput(value:unknown):void {
 let nodes=0;const parents=new Set<object>();
 const visit=(v:unknown,depth:number):void=>{
  if(++nodes>300000||depth>32)fail('JSON_CONTENT');
  if(v===null||typeof v==='string'||typeof v==='boolean')return;
  if(typeof v==='number'){if(!Number.isFinite(v))fail('JSON_CONTENT');return;}
  if(!v||typeof v!=='object'||parents.has(v)||Object.getOwnPropertySymbols(v).length)fail('JSON_CONTENT');
  parents.add(v);
  if(Array.isArray(v)){
   if(Object.getPrototypeOf(v)!==Array.prototype||Object.getOwnPropertyNames(v).length!==v.length+1)fail('JSON_CONTENT');
   for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d?.enumerable||!Object.hasOwn(d,'value'))fail('JSON_CONTENT');visit(d.value,depth+1);}
  }else{
   if(![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('JSON_CONTENT');
   for(const d of Object.values(Object.getOwnPropertyDescriptors(v))){if(!d.enumerable||!Object.hasOwn(d,'value'))fail('JSON_CONTENT');visit(d.value,depth+1);}
  }
  parents.delete(v);
 };visit(value,0);
 if(new TextEncoder().encode(JSON.stringify(value)).length>10*1024*1024)fail('size');
}
function shape(v:unknown,required:string[],optional:string[]=[]):asserts v is Record<string,unknown>{
 if(!v||typeof v!=='object'||Array.isArray(v))fail('shape');
 if(required.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!required.includes(k)&&!optional.includes(k)))fail('shape');
}
function text(v:unknown,max:number,id=false):asserts v is string {
 if(typeof v!=='string'||Array.from(v).length>max||id&&(!v.trim()||['__proto__','constructor','prototype'].includes(v)))fail('text');
}
function inputs(project:ProjectFile,bill:ContainerBillDraft,input:ContainerCostProposalInput):void {
 jsonInput({project,bill,input});validateProjectStructure(project);validateContainerBillDraft(bill);
 shape(input,['version','intents']);if(input.version!=='0.1'||!Array.isArray(input.intents)||input.intents.length>50)fail('version/intents');
 for(const intent of input.intents){
  if(!intent||typeof intent!=='object'||Array.isArray(intent))fail('intent');
  if(intent.operation==='REFERENCE_EXISTING'){shape(intent,['line_id','operation','cost_id','note']);text(intent.cost_id,200,true);}
  else if(intent.operation==='CREATE_NEW'){
   shape(intent,['line_id','operation','new_cost','note'],['evidence']);
   shape(intent.new_cost,['cost_id'],['cost_name','container_charge','container_charge_scope','applicable_incoterms','alternative_group','cost_category','trade_node','location','timing','occurrence_reason','pricing_method','amount','unit','quantity','rate','days','day_basis','calculation_base','tiers','tier_mode','tier_basis','tier_charge_lower','currency','fx_rate','fx_evidence','fx_type','fx_date','base_currency','base_amount','tax_included','tax_rate_ref','customs_value','responsibility','responsibility_source','payment_party','economic_bearer','included_in_quoted_price','contained_in_cost_id','dedup_group','is_goods_value','includes_port_charges','risk_relation','is_custom','source','notes']);
   // Reuse project structure checks, including cross-item ID uniqueness, later as row issues.
   validateProjectStructure({...project,items:[intent.new_cost]});
   text(intent.new_cost.cost_id,200,true);
   if(intent.evidence!==undefined)validateContainerBillEvidence(intent.evidence);
  }else fail('operation');
  text(intent.line_id,200,true);text(intent.note,4000);
 }
}
/** Exact decimal text only; independent of global Decimal precision and core rounding. */
function canonical(value:unknown):string|null {
 if(typeof value!=='string'||value.length>200||!/^\d+(?:\.\d+)?$/.test(value))return null;
 const [whole,fraction='']=value.split('.');const tail=fraction.replace(/0+$/,'');
 return whole!.replace(/^0+(?=\d)/,'')+(tail?'.'+tail:'');
}
function sourceValues(project:ProjectFile,bill:ContainerBillDraft,intent:Extract<ContainerCostIntent,{operation:'CREATE_NEW'}>):unknown {
 const {evidence:_evidence,...selection}=intent;return{project,bill,selection};
}
/** Explicit caller action records assumptions; no CostItem is inserted. */
export function confirmContainerCostIntent(project:ProjectFile,bill:ContainerBillDraft,intent:Extract<ContainerCostIntent,{operation:'CREATE_NEW'}>,source:SourceEvidence):Extract<ContainerCostIntent,{operation:'CREATE_NEW'}> {
 inputs(project,bill,{version:'0.1',intents:[intent]});validateContainerBillEvidence(source);
 if(source.status==='EXAMPLE')fail('example_source');
 const evidence={...structuredClone(source),status:'USER_CONFIRMED' as const};evidence.values_key=evidenceKey(sourceValues(project,bill,intent),evidence);
 if(evidence.values_key.length>1048576||checkSource('新费用假设',bill.review_date,evidence,evidence.values_key).issues.length)fail('source');
 return{...structuredClone(intent),evidence};
}
/** Conservative proposals. No aggregate, no FX/tax calculation, no readiness promotion. */
export function proposeContainerCosts(project:ProjectFile,bill:ContainerBillDraft,input:ContainerCostProposalInput):ContainerCostProposal {
 inputs(project,bill,input);
 const review=reviewContainerBillDraft(bill,project),issues=[...review.issues];
 if(!input.intents.length)issues.push('EMPTY_PROPOSAL_SCOPE');
 const active=(()=>{try{return costsForTerm(toTrade(project),project.incoterm).trade.items;}catch{return[];}})();
 const costId=(i:ContainerCostIntent)=>i.operation==='CREATE_NEW'?i.new_cost.cost_id:i.cost_id;
 const rows=input.intents.map(intent=>{
  const row=review.rows.find(r=>r.line_id===intent.line_id),draft=bill.rows.find(r=>r.input.line_id===intent.line_id),amount=row?.calculation?.amount??null;
  const problems:string[]=[],source_issues:string[]=[],id=costId(intent);
  if(!row)problems.push('UNKNOWN_BILL_LINE');
  if(!row?.calculation)problems.push('BILL_INPUT_NOT_CALCULABLE');
  if(!row?.source_current)problems.push('BILL_SOURCE_REVIEW_REQUIRED');
  if(!intent.note.trim())problems.push('INTENT_NOTE_REQUIRED');
  if(input.intents.filter(i=>i.line_id===intent.line_id).length>1)problems.push('DUPLICATE_LINE_INTENT');
  if(input.intents.filter(i=>costId(i)===id).length>1)problems.push('MULTIPLE_LINES_TARGET_SAME_COST');
  if(amount&&(canonical(amount)?.split('.')[1]?.length??0)>6)problems.push('CORE_PRECISION_LOSS');
  if(review.potential_overlaps.some(p=>p.line_ids.includes(intent.line_id)))problems.push('BILL_OVERLAP_REVIEW_REQUIRED');
  if(intent.operation==='REFERENCE_EXISTING'){
   const ref=row?.cost_reference;
   if(!ref||ref.cost_id!==id)problems.push('CURRENT_COST_REFERENCE_REQUIRED');
   else{problems.push(...ref.issues);source_issues.push(...ref.source_issues);}
  }else{
   const cost=intent.new_cost;
   if(draft?.cost_reference)problems.push('EXISTING_REFERENCE_MUST_BE_REVIEWED');
   if(project.items.some(c=>c.cost_id===id))problems.push('COST_ID_ALREADY_EXISTS');
   if(!cost.cost_name.trim())problems.push('COST_NAME_REQUIRED');
   if(cost.pricing_method!=='FIXED'||canonical(cost.amount)===null||canonical(cost.amount)!==canonical(amount))problems.push('EXACT_ORIGINAL_AMOUNT_REQUIRED');
   if(cost.currency!==draft?.input.currency||cost.base_currency!==project.base_currency)problems.push('COST_CURRENCY_MISMATCH');
   if(cost.container_charge!==draft?.input.charge_kind||cost.container_charge_scope!==draft?.input.scope_id)problems.push('COST_SCOPE_REVIEW_REQUIRED');
   if(cost.applicable_incoterms?.length!==1||cost.applicable_incoterms[0]!==project.incoterm)problems.push('CURRENT_TERM_ONLY_REQUIRED');
   if(!['SELLER','BUYER'].includes(cost.responsibility)||cost.responsibility_source!=='CONTRACT'||!cost.occurrence_reason||!cost.payment_party||!cost.economic_bearer)problems.push('EXPLICIT_PARTIES_AND_CAUSE_REQUIRED');
   if(!cost.customs_value)problems.push('EXPLICIT_CUSTOMS_TREATMENT_REQUIRED');
   if(cost.source!=='USER'||!cost.is_custom)problems.push('USER_COST_REQUIRED');
   if(cost.included_in_quoted_price||cost.contained_in_cost_id||cost.alternative_group||cost.dedup_group||cost.calculation_base||cost.is_goods_value||cost.includes_port_charges||cost.base_amount!==undefined)problems.push('INCLUSION_OR_DERIVED_FIELDS_REVIEW_REQUIRED');
   if(['unit','quantity','rate','days','day_basis','tiers','tier_mode','tier_basis','tier_charge_lower'].some(k=>Object.hasOwn(cost,k)))problems.push('INACTIVE_PRICING_FIELDS_REVIEW_REQUIRED');
   // Existing costs lack per-box/day ranges: same scope is a candidate, not proof of duplication.
   if(active.some(c=>c.container_charge_scope===cost.container_charge_scope&&c.container_charge&&
    (c.container_charge===cost.container_charge||['DEMURRAGE','DETENTION','COMBINED_DD'].includes(c.container_charge)&&['DEMURRAGE','DETENTION','COMBINED_DD'].includes(cost.container_charge!))))problems.push('EXISTING_COST_SCOPE_REVIEW_REQUIRED');
   if((cost.container_charge==='THC_ORIGIN'||cost.container_charge==='THC_DESTINATION')&&active.some(c=>c.includes_port_charges))problems.push('PORT_CHARGE_INCLUSION_REVIEW_REQUIRED');
   source_issues.push(...checkSource('新费用假设',bill.review_date,intent.evidence,intent.evidence?evidenceKey(sourceValues(project,bill,intent),intent.evidence):undefined).issues);
  }
  return{line_id:intent.line_id,operation:intent.operation,cost_id:id,original_amount:amount,proposed_cost:intent.operation==='CREATE_NEW'?structuredClone(intent.new_cost):null,issues:problems,source_issues};
 });
 const proposal:ContainerCostProposal={version:'0.1',scope:'NO_WRITE_PROPOSAL',snapshot_key:evidenceKey({project,bill,input},emptyEvidence()),issues,rows};
 jsonInput(proposal);return proposal;
}
/** Recompute everything; changed inputs or altered output require a new proposal. Not an apply API. */
export function containerCostProposalIsCurrent(proposal:ContainerCostProposal,project:ProjectFile,bill:ContainerBillDraft,input:ContainerCostProposalInput):boolean {
 try{jsonInput(proposal);return evidenceKey(proposal,emptyEvidence())===evidenceKey(proposeContainerCosts(project,bill,input),emptyEvidence());}catch{return false;}
}
