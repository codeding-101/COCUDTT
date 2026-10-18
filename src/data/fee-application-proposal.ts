import {FeeApplicationProposalError,type FeeApplicationProposalSources} from '../domain/fee-application-proposal.js';
import type {PrecisionFraction} from '../domain/fee-precision.js';
import {copyFeePrecisionSelectionJson as copy,parseFeePrecisionSelectionJson as json,canonicalFeePrecisionSelectionJson as canonical,feePrecisionSelectionSha256 as sha} from './fee-precision-selection-json.js';
import {parseProject} from './project-file.js';
import {parseContainerBillDraft} from './container-bill-file.js';
import {parseContainerCostPair,reviewContainerCostPair,containerCostPairBusiness} from './container-cost-pair.js';
import {parseFeeTaxAttachment,reviewFeeTaxAttachment} from './fee-tax-attachment.js';
import {parseFeePrecisionSelection,reviewFeePrecisionSelection} from './fee-precision-selection.js';
import {reviewContainerCostBoundaries} from '../engine/container-cost-review.js';
import {reviewContainerCostReviewPlan} from './container-cost-review-plan.js';
import {proposeContainerCosts} from '../engine/container-cost-proposal.js';

const slots=['project_json','bill_json','pair_json','attachment_json','precision_json','history_json'] as const;
const limits=[10,5,10,24,64,5].map(n=>n*1024*1024);
const diagnostics=new Set(['NO_FEE_APPLICATION','NO_GLOBAL_DUPLICATE_PROOF','CASH_PAYMENT_NOT_VERIFIED','ECONOMIC_COST_NOT_DETERMINED','CUSTOMS_COMPONENT_NOT_DETERMINED']);
const fail=(reason:string):never=>{throw new FeeApplicationProposalError(reason);};
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const equal=(a:PrecisionFraction|null,b:PrecisionFraction|null)=>a!==null&&b!==null&&BigInt(a.numerator)*BigInt(b.denominator)===BigInt(b.numerator)*BigInt(a.denominator);
const zero=(a:PrecisionFraction|null)=>a!==null&&BigInt(a.numerator)===0n;
function decimal(text:unknown):PrecisionFraction|null {
 if(typeof text!=='string'||!/^(0|[1-9]\d{0,99})(\.\d{1,40})?$/.test(text))return null;
 const [n='',d='']=text.split('.');return{numerator:BigInt(n+d).toString(),denominator:(10n**BigInt(d.length)).toString()};
}
function capture(value:unknown):FeeApplicationProposalSources {
 // Descriptor inspection and detachment precede the first asynchronous digest.
 let v:unknown;try{v=copy(value);}catch{return fail('STRICT_INPUT');}
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==slots.length||slots.some(k=>!Object.hasOwn(v,k)))fail('SOURCE_FIELDS');
 const s=v as FeeApplicationProposalSources;
 slots.forEach((k,i)=>{if(k==='history_json'&&s[k]===null)return;try{json(s[k],limits[i]);}catch{fail('STRICT_SOURCE:'+k);}});
 return s;
}

/** Recompute complete real sources. Numeric compatibility never authorizes a write. */
export async function proposeFeeApplication(value:unknown){
 const sources=capture(value);
 const project=parseProject(sources.project_json),bill=parseContainerBillDraft(sources.bill_json),pair=parseContainerCostPair(sources.pair_json);
 if(pair.mapping.entries.length>50)fail('ROW_LIMIT');
 const attachment=await parseFeeTaxAttachment(sources.attachment_json),precision=await parseFeePrecisionSelection(sources.precision_json);
 const pair_review=reviewContainerCostPair(pair,project,bill),boundary_review=reviewContainerCostBoundaries(pair,pair.content_key);
 const review_plan=pair.version==='1.1'?reviewContainerCostReviewPlan(pair.review_plan!,containerCostPairBusiness(pair)):null;
 const attachment_review=await reviewFeeTaxAttachment(attachment,sources.pair_json);
 const precision_review=await reviewFeePrecisionSelection(precision,sources.pair_json,sources.attachment_json);
 const issues=['NO_FEE_APPLICATION','NO_GLOBAL_DUPLICATE_PROOF','BUSINESS_IDENTITY_NOT_ESTABLISHED',sources.history_json===null?'HISTORY_NOT_ESTABLISHED':'HISTORY_FORMAT_UNSUPPORTED',...pair_review.issues];
 if(!attachment_review.pair_is_current)issues.push('ATTACHMENT_PAIR_NOT_CURRENT');
 for(const [name,current] of Object.entries(precision_review.source_status))if(!current)issues.push('PRECISION_SOURCE_NOT_CURRENT:'+name);
 let current_proposal:ReturnType<typeof proposeContainerCosts>|null=null;
 try{current_proposal=proposeContainerCosts(project,bill,pair.selection);}catch{issues.push('CURRENT_PROPOSAL_UNAVAILABLE');}
 const sourceCounts=new Map<string,number>(),targetCounts=new Map<string,number>();
 for(const m of pair.mapping.entries){const source=canonical([m.bill_id,m.line_id]);sourceCounts.set(source,(sourceCounts.get(source)??0)+1);targetCounts.set(m.cost_id,(targetCounts.get(m.cost_id)??0)+1);}
 const globalIssues=[...boundary_review.issues,...pair_review.proposal.issues,...(current_proposal?.issues??[]),...(review_plan?.issues??[]),...(review_plan?.records.flatMap(r=>r.issues)??[])];
 issues.push(...globalIssues.filter(c=>!diagnostics.has(c)));
 // Unselected/orphan records remain part of the complete source, never silently skipped.
 for(const r of attachment_review.rows){
  issues.push(...r.issues.map(c=>'ATTACHMENT:'+r.record_id+':'+c));
  for(const [facet,ack]of Object.entries(r.acknowledgements)){
   if(ack.status!=='RECORDED_ASSUMPTION')issues.push('ATTACHMENT:'+r.record_id+':'+facet+':ASSUMPTION_NOT_CURRENT');
   issues.push(...ack.issues.map(c=>'ATTACHMENT:'+r.record_id+':'+facet+':'+c));
  }
 }
 for(const r of precision_review.rows){
  issues.push(...[...r.binding_issues,...r.business_issues,...r.policy.issues,...(r.calculation?.issues??[])].map(c=>'PRECISION:'+r.record.record_id+':'+c));
  if(r.policy.status!=='RECORDED_POLICY_ASSUMPTION')issues.push('PRECISION:'+r.record.record_id+':ASSUMPTION_NOT_CURRENT');
 }
 const rows=pair.mapping.entries.map(mapping=>{
  const proposal=pair_review.proposal.rows.find(r=>r.line_id===mapping.line_id)!,boundary=boundary_review.rows.find(r=>r.mapping.mapping_id===mapping.mapping_id)!;
  const current=current_proposal?.rows.find(r=>r.line_id===mapping.line_id);
  const intent=pair.selection.intents.find(r=>r.line_id===mapping.line_id)!;
  const cost=intent.operation==='CREATE_NEW'?intent.new_cost:project.items.find(c=>c.cost_id===mapping.cost_id);
  const components=attachment_review.rows.filter(r=>same(r.target,mapping)),component=components.length===1?components[0]:undefined;
  const policies=component?precision_review.rows.filter(r=>r.record.component_record_id===component.record_id):[];
  const cashPolicies=policies.filter(r=>r.record.channel==='cash'),cash=cashPolicies.length===1?cashPolicies[0]:undefined;
  const preserved_issues=[...proposal.issues,...proposal.source_issues,...boundary.issues,...(current?.issues??[]),...(current?.source_issues??[])];
  const blockers=preserved_issues.filter(c=>!diagnostics.has(c));
  if((sourceCounts.get(canonical([mapping.bill_id,mapping.line_id]))??0)>1)blockers.push('DUPLICATE_BATCH_SOURCE');
  if((targetCounts.get(mapping.cost_id)??0)>1)blockers.push('DUPLICATE_BATCH_TARGET');
  if(mapping.operation==='CREATE_NEW'&&project.items.some(c=>c.cost_id===mapping.cost_id))blockers.push('TARGET_ALREADY_EXISTS');
  if(mapping.operation==='CREATE_NEW'&&pair.retired_mappings.some(m=>m.cost_id===mapping.cost_id))blockers.push('TARGET_ID_RETIRED');
  if(mapping.operation==='REFERENCE_EXISTING'&&!project.items.some(c=>c.cost_id===mapping.cost_id))blockers.push('REFERENCE_TARGET_MISSING');
  if(components.length!==1)blockers.push(components.length?'AMBIGUOUS_COMPONENT':'COMPONENT_MISSING');
  if(component){
   blockers.push(...component.issues);
   blockers.push(...component.calculation.issues.filter(c=>c!=='TAX_NOT_SEPARATED'||component.calculation.input.tax.kind!=='NO_SEPARATION'));
   for(const [facet,ack]of Object.entries(component.acknowledgements)){
    if(ack.status!=='RECORDED_ASSUMPTION')blockers.push('COMPONENT_ASSUMPTION_NOT_CURRENT:'+facet);
    blockers.push(...ack.issues.map(c=>facet+':'+c));
   }
  }
  if(!cash)blockers.push('CASH_POLICY_MISSING');
  for(const policy of policies){
   blockers.push(...policy.binding_issues,...policy.business_issues,...policy.policy.issues);
   blockers.push(...(policy.calculation?.issues??[]));
   if(policy.policy.status!=='RECORDED_POLICY_ASSUMPTION')blockers.push('PRECISION_ASSUMPTION_NOT_CURRENT:'+policy.record.channel);
   if(policy.record.choice.kind==='FX')blockers.push('FX_APPLICATION_UNSUPPORTED');
  }
  const channels=component?.calculation.channels??null,numeric_issues:string[]=[];
  const original=decimal(proposal.original_amount),proposed=decimal(proposal.proposed_cost?.amount??null);
  const candidate=cash?.calculation?.values.rounded??null,delta=cash?.calculation?.values.delta??null;
  if(!channels)numeric_issues.push('COMPONENTS_UNKNOWN');
  else{
   if(!equal(original,channels.cash))numeric_issues.push('ORIGINAL_CASH_MISMATCH');
   if(!zero(channels.credit)||!equal(channels.cash,channels.economic))numeric_issues.push('SEPARATE_ECONOMIC_MODEL_REQUIRED');
   if(channels.customs===null)numeric_issues.push('CUSTOMS_COMPONENT_UNKNOWN');
   else if(!zero(channels.customs)&&!equal(channels.customs,channels.cash))numeric_issues.push('PARTIAL_CUSTOMS_MODEL_REQUIRED');
   else if(!cost||!['ADD','EXCLUDE'].includes(cost.customs_value??''))numeric_issues.push('CUSTOMS_FLAG_UNKNOWN');
   else if(!zero(channels.cash)&&((zero(channels.customs)&&cost.customs_value!=='EXCLUDE')||(!zero(channels.customs)&&cost.customs_value!=='ADD')))numeric_issues.push('CUSTOMS_FLAG_MISMATCH');
   if((channels.net===null)!==(channels.tax===null))numeric_issues.push('INCOMPLETE_TAX_SPLIT');
   if(channels.net===null&&component?.calculation.input.tax.kind!=='NO_SEPARATION')numeric_issues.push('TAX_SPLIT_UNKNOWN');
  }
  if(boundary.core_precision!=='EXACT')numeric_issues.push('CORE_PRECISION_'+boundary.core_precision);
  if(mapping.operation==='CREATE_NEW'&&!equal(original,proposed))numeric_issues.push('PROPOSED_AMOUNT_MISMATCH');
  if(!cash||cash.record.choice.kind!=='ROUND')numeric_issues.push('ORIGINAL_CURRENCY_ROUND_POLICY_REQUIRED');
  if(!equal(original,candidate)||!zero(delta))numeric_issues.push('ROUNDING_CHANGED_OR_UNKNOWN');
  if(cash&&(!same(cash.record.target,mapping)||cash.record.currency!==cost?.currency))numeric_issues.push('CASH_POLICY_TARGET_OR_CURRENCY_MISMATCH');
  if(!cost||!['SELLER','BUYER'].includes(cost.responsibility)||cost.payment_party!==cost.responsibility||cost.economic_bearer!==cost.responsibility)blockers.push('PAYER_BEARER_RESPONSIBILITY_NOT_ALIGNED');
  blockers.push(...numeric_issues);
  return{mapping:structuredClone(mapping),effect:'NO_WRITE' as const,reference_only:mapping.operation==='REFERENCE_EXISTING',
   source_identity:{business_id:null,bill_id:mapping.bill_id,line_id:mapping.line_id,consumption_status:'NOT_VERIFIED' as const},
   numeric_projection:{status:numeric_issues.length?'NOT_REPRESENTABLE_OR_UNKNOWN' as const:'MODEL_COMPATIBLE' as const,issues:numeric_issues,
    original_amount:proposal.original_amount,currency:cost?.currency??null,proposed_amount:proposal.proposed_cost?.amount??null,
    candidate,delta,channels,customs_flag:cost?.customs_value??null},
   preserved_issues:[...new Set(preserved_issues)],blockers:[...new Set(blockers)],
   existing_target:project.items.find(c=>c.cost_id===mapping.cost_id)?structuredClone(project.items.find(c=>c.cost_id===mapping.cost_id)!):null,
   field_comparison:{original_cash:proposal.original_amount,proposed_amount:proposal.proposed_cost?.amount??null,
    existing_amount:project.items.find(c=>c.cost_id===mapping.cost_id)?.amount??null,
    bill_currency:boundary.currency,cost_currency:cost?.currency??null,base_currency:project.base_currency,
    responsibility:cost?.responsibility??null,payment_party:cost?.payment_party??null,economic_bearer:cost?.economic_bearer??null,
    customs_flag:cost?.customs_value??null},
   component_record_id:component?.record_id??null,precision_record_ids:policies.map(r=>r.record.record_id)};
 });
 const fingerprints=Object.fromEntries(await Promise.all(slots.map(async k=>[k,sources[k]===null?null:await sha(sources[k])])));
 const context_sha256=await sha(canonical({contract:'fee-application-proposal-read-only-0.1',sources}));
 return{scope:'READ_ONLY_FEE_APPLICATION_PROPOSAL' as const,effect:'NO_WRITE' as const,financial_writes:0 as const,
  history_status:sources.history_json===null?'NOT_ESTABLISHED' as const:'UNSUPPORTED_FORMAT' as const,
  basis:{sources,fingerprints,context_sha256},issues:[...new Set(issues)],rows,
  reviews:{pair:pair_review,boundary:boundary_review,review_plan,attachment:attachment_review,precision:precision_review,current_proposal}};
}
