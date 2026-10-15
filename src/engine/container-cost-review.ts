import type {ContainerCostPair} from '../domain/container-cost-pair.js';
import type {ContainerCostReview,ContainerCoverageReview,ContainerParentReview} from '../domain/container-cost-review.js';
import type {ContainerBillLine} from '../domain/container-bill.js';
import type {CostItem} from '../domain/cost-item.js';
import {emptyEvidence,evidenceKey} from '../domain/source-evidence.js';
import {validateContainerCostPair} from '../data/container-cost-pair.js';
import {toTrade,toScenario} from '../data/project-file.js';
import {proposeContainerCosts,validateContainerCostProposalJson} from './container-cost-proposal.js';
import {reviewContainerBillDraft} from './container-bill-draft.js';
import {costsForTerm} from './scenario-costs.js';
import {buildInclusionPredicate} from './inclusion.js';
import {scenarioWithDerivedInclusions} from './compare.js';

export const CONTAINER_REVIEW_TARGET_LIMIT=2000;
const DAY=86400000;
const dd=new Set(['DEMURRAGE','DETENTION','COMBINED_DD']);
const key=(value:unknown)=>evidenceKey(value,emptyEvidence());
function fail(reason:string):never {throw Error('CONTAINER_COST_REVIEW_INVALID:'+reason);}

/** Geometry only. Different scope labels/currencies and free days cannot erase coverage. */
function coverage(left:string,right:string,a:ContainerBillLine|undefined,b:ContainerBillLine|undefined):ContainerCoverageReview {
 const result:ContainerCoverageReview={line_ids:[left,right],status:'UNSUPPORTED',container_ids:[],start_date:null,end_date:null,shared_box_days:null,issues:[]};
 if(!a||!b){result.issues.push('BILL_COVERAGE_INCOMPLETE');return result;}
 result.container_ids=a.container_ids.filter(id=>b.container_ids.includes(id)).sort();
 if(!result.container_ids.length){result.status='DISJOINT_BOXES';result.shared_box_days=0;return result;}
 if(a.direction!==b.direction){result.issues.push('DIRECTION_CONTEXT_REVIEW_REQUIRED');return result;}
 if(a.mode!=='DAILY'||b.mode!=='DAILY'){result.issues.push('EVENT_OR_MIXED_MODE_REVIEW_REQUIRED');return result;}
 const bounds=(line:Extract<ContainerBillLine,{mode:'DAILY'}>)=>[
  Date.parse(line.period.start_date+'T00:00:00Z')/DAY+(line.period.start_included?0:1),
  Date.parse(line.period.end_date+'T00:00:00Z')/DAY-(line.period.end_included?0:1),
 ] as const;
 const [af,al]=bounds(a),[bf,bl]=bounds(b),start=Math.max(af,bf),end=Math.min(al,bl);
 if(start>end){result.status='DISJOINT_DAYS';result.shared_box_days=0;return result;}
 result.status='BOX_DAY_INTERSECTION';result.start_date=new Date(start*DAY).toISOString().slice(0,10);
 result.end_date=new Date(end*DAY).toISOString().slice(0,10);result.shared_box_days=result.container_ids.length*(end-start+1);
 result.issues.push('CHARGE_CONTENT_NOT_PROVEN');return result;
}

/** Check the complete active parent graph; do not infer that a relation covers the bill. */
function parents(active:CostItem[],all:CostItem[],existingIds:Set<string>):ContainerParentReview[] {
 const byId=new Map(active.map(c=>[c.cost_id,c]));
 return active.filter(c=>c.contained_in_cost_id!==undefined).map(c=>{
  const parent=c.contained_in_cost_id!,issues=['FULL_COVERAGE_EVIDENCE_REQUIRED'];
  const seen=new Set([c.cost_id]);let next:string|undefined=parent,child=c;
  while(next!==undefined){
   if(seen.has(next)){issues.push(next===c.cost_id&&next===parent?'SELF_PARENT':'PARENT_CYCLE');break;}seen.add(next);
   const p=byId.get(next);
   if(!p){issues.push(all.some(x=>x.cost_id===next)?'PARENT_NOT_ACTIVE':'PARENT_MISSING');break;}
   if(!existingIds.has(next))issues.push('PARENT_IS_UNAPPLIED_PROPOSAL');
   if(p.currency!==child.currency)issues.push('CROSS_CURRENCY_CONTAINMENT_UNSUPPORTED');
   child=p;next=p.contained_in_cost_id;
  }
  return{cost_id:c.cost_id,parent_cost_id:parent,issues:[...new Set(issues)]};
 });
}

/** No fee writes or readiness flag. Expected key must come from the caller's current pair. */
export function reviewContainerCostBoundaries(pair:ContainerCostPair,expected_key:string):ContainerCostReview {
 validateContainerCostPair(pair);if(expected_key!==pair.content_key)fail('stale_pair');
 const {project,bill,selection}=pair,issues=['NO_FEE_APPLICATION','NO_GLOBAL_DUPLICATE_PROOF'];
 // Preserve the selected set for diagnostics even if graph/alternative validation fails.
 const active=project.items.filter(c=>c.applicable_incoterms===undefined||c.applicable_incoterms.includes(project.incoterm));
 const selected=new Set(selection.intents.map(i=>i.line_id));
 const comparisons:[string,string][]=[];
 for(let i=0;i<bill.rows.length;i++)for(let j=i+1;j<bill.rows.length;j++){
  const a=bill.rows[i]!.input.line_id,b=bill.rows[j]!.input.line_id;
  if(selected.has(a)||selected.has(b))comparisons.push([a,b]);
 }
 const newCosts=selection.intents.flatMap(i=>i.operation==='CREATE_NEW'?[i.new_cost]:[]);
 // Count every inspected graph node, bill pair and row-to-active-cost target before calculation.
 const target_count=active.length+newCosts.length+comparisons.length+selection.intents.length*active.length;
 if(target_count>CONTAINER_REVIEW_TARGET_LIMIT)fail('target_limit');
 try{costsForTerm(toTrade(project),project.incoterm);}catch{issues.push('PROJECT_COST_SELECTION_INVALID');}
 const proposal=proposeContainerCosts(project,bill,selection),draft=reviewContainerBillDraft(bill,project);
 const calculations=new Map(draft.rows.map(r=>[r.line_id,r.calculation?.input]));
 const ranges=comparisons.map(([a,b])=>coverage(a,b,calculations.get(a),calculations.get(b)));
 const newActive=newCosts.filter(c=>(c.applicable_incoterms===undefined||c.applicable_incoterms.includes(project.incoterm))&&!project.items.some(p=>p.cost_id===c.cost_id));
 const graph=parents([...active,...newActive],[...project.items,...newCosts],new Set(active.map(c=>c.cost_id)));
 let included:((cost:CostItem)=>boolean)|null=null;
 try{included=buildInclusionPredicate(scenarioWithDerivedInclusions(toScenario(project),toTrade(project)).quote.included_cost_ids);}catch{issues.push('QUOTE_INCLUSION_CONTEXT_UNAVAILABLE');}
 const existing:ContainerCostReview['existing_cost_candidates']=[];
 const rows=selection.intents.map(intent=>{
  const mapping=pair.mapping.entries.find(e=>e.line_id===intent.line_id)!;
  const row=proposal.rows.find(r=>r.line_id===intent.line_id)!,cost=intent.operation==='CREATE_NEW'?intent.new_cost:project.items.find(c=>c.cost_id===intent.cost_id);
  const input=bill.rows.find(r=>r.input.line_id===intent.line_id)!.input;
  const problems=['CASH_PAYMENT_NOT_VERIFIED','ECONOMIC_COST_NOT_DETERMINED','CUSTOMS_COMPONENT_NOT_DETERMINED'];
  const exact=row.original_amount;
  const core_precision:ContainerCostReview['rows'][number]['core_precision']=exact===null?'UNKNOWN':(exact.split('.')[1]??'').replace(/0+$/,'').length>6?'LOSS':'EXACT';
  if(core_precision==='LOSS')problems.push('CORE_PRECISION_LOSS');
  if(core_precision==='UNKNOWN')problems.push('ORIGINAL_AMOUNT_UNKNOWN');
  if(!cost)problems.push('TARGET_COST_MISSING');
  if(cost?.applicable_incoterms!==undefined&&!cost.applicable_incoterms.includes(project.incoterm))problems.push('TARGET_COST_NOT_ACTIVE');
  if(cost?.tax_included)problems.push('TAX_INCLUSIVE_TREATMENT_UNSUPPORTED');
  if(cost?.tax_rate_ref!==undefined)problems.push('SERVICE_TAX_REFERENCE_NOT_INTERPRETED');
  if(cost?.source==='DERIVED')problems.push('DERIVED_TAX_OR_COST_REFERENCE_REVIEW_REQUIRED');
  const quoteAvailable=!!cost&&(intent.operation==='CREATE_NEW'||active.some(c=>c.cost_id===cost.cost_id)&&included!==null);
  const recorded=quoteAvailable&&cost?(intent.operation==='CREATE_NEW'?cost.included_in_quoted_price:included!(cost)):null;
  if(recorded)problems.push('QUOTE_INCLUSION_NOT_CUSTOMS_EXCLUSION');
  for(const relation of graph.filter(g=>g.cost_id===mapping.cost_id))problems.push(...relation.issues);
  for(const c of active){
   if(intent.operation==='REFERENCE_EXISTING'&&c.cost_id===intent.cost_id)continue;
   const reasons:string[]=[];
   if(c.container_charge&&input.charge_kind&&(c.container_charge===input.charge_kind||dd.has(c.container_charge)&&dd.has(input.charge_kind)))reasons.push('EXISTING_COST_HAS_NO_BOX_DAY_COVERAGE');
   if((input.charge_kind==='THC_ORIGIN'||input.charge_kind==='THC_DESTINATION')&&c.includes_port_charges)reasons.push('PORT_CHARGE_INCLUSION_REVIEW_REQUIRED');
   if(cost?.dedup_group&&cost.dedup_group===c.dedup_group)reasons.push('SAME_DEDUP_GROUP_REVIEW_REQUIRED');
   if(reasons.length){existing.push({line_id:intent.line_id,cost_id:c.cost_id,issues:reasons});problems.push('EXISTING_COST_COVERAGE_REVIEW_REQUIRED');}
  }
  for(const r of ranges.filter(r=>r.line_ids.includes(intent.line_id))){
   if(r.status==='BOX_DAY_INTERSECTION')problems.push('BOX_DAY_COVERAGE_REVIEW_REQUIRED');
   if(r.status==='UNSUPPORTED')problems.push('COVERAGE_UNSUPPORTED');
  }
  return{mapping:structuredClone(mapping),original_amount:exact,currency:input.currency??null,core_precision,
   channels:{cash_amount:exact,economic_cost:null,customs_adjustment:null,tax_included:cost?.tax_included??null,tax_rate_ref:cost?.tax_rate_ref??null,customs_value:cost?.customs_value??null},
   quote_inclusion:{recorded,basis:!quoteAvailable?'UNAVAILABLE' as const:intent.operation==='CREATE_NEW'?'PROPOSED_ITEM_FLAG' as const:'CURRENT_SCENARIO_DERIVATION' as const,effect:recorded===null?'UNKNOWN' as const:recorded?'BUYER_EXTRA_ONLY_REQUIRES_RESPONSIBILITY' as const:'NOT_RECORDED' as const},issues:[...new Set(problems)]};
 });
 const result:ContainerCostReview={version:'0.1',scope:'READ_ONLY_BOUNDARIES',pair_id:pair.pair_id,revision:pair.revision,pair_key:pair.content_key,term:project.incoterm,target_count,issues,proposal,
  rows,legacy_overlaps:structuredClone(draft.potential_overlaps),coverage:ranges,existing_cost_candidates:existing,parent_relationships:graph};
 validateContainerCostProposalJson(result);return result;
}

/** A complete recomputation detects edited results and changed source/mapping snapshots. */
export function containerCostBoundaryReviewIsCurrent(review:ContainerCostReview,pair:ContainerCostPair):boolean {
 try{validateContainerCostProposalJson(review);return key(review)===key(reviewContainerCostBoundaries(pair,pair.content_key));}catch{return false;}
}
