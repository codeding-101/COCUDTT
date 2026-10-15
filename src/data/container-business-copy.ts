import type {ContainerCostPair} from '../domain/container-cost-pair.js';
import type {CostItem} from '../domain/cost-item.js';
import type {SourceEvidence} from '../domain/source-evidence.js';
import {INCOTERMS} from '../domain/enums.js';
import {createContainerCostPair,validateContainerCostPair,serializeContainerCostPair} from './container-cost-pair.js';

function fail(reason:string):never {throw Error('CONTAINER_BUSINESS_COPY_INVALID:'+reason);}
/** Known active source records only; unknown extensions must remain inert and unchanged. */
function unconfirm(evidence:SourceEvidence|undefined):void {
 if(!evidence)return;if(evidence.status==='USER_CONFIRMED')evidence.status='UNVERIFIED';delete evidence.values_key;
}
/** Independent file candidate. Never installs data, calculates money or writes a fee. */
export function copyContainerBusiness(source:ContainerCostPair,expected_key:string,name:string,metadata_time:string):ContainerCostPair {
 validateContainerCostPair(source);if(source.content_key!==expected_key)fail('STALE_SOURCE');
 if(typeof name!=='string'||!name.trim()||name!==name.trim()||Array.from(name).length>200||/[\u0000-\u001f\u007f]/.test(name)||name.normalize('NFC')===source.project.name.trim().normalize('NFC'))fail('NAME');
 if(typeof metadata_time!=='string'||metadata_time.length>40||!Number.isFinite(Date.parse(metadata_time))||new Date(metadata_time).toISOString()!==metadata_time)fail('METADATA_TIME');
 const projectIds=new Set(source.project.items.map(c=>c.cost_id));
 const targetIds=source.selection.intents.flatMap(i=>i.operation==='CREATE_NEW'?[i.new_cost.cost_id]:[]);
 if(targetIds.some(id=>projectIds.has(id)))fail('AMBIGUOUS_TARGET');
 const retired=new Set(source.retired_mappings.filter(m=>m.operation==='CREATE_NEW').map(m=>m.cost_id));
 const used=new Set([source.pair_id,source.bill.id,...projectIds,...targetIds,...source.bill.rows.map(r=>r.input.line_id),...source.mapping.entries.flatMap(m=>[m.mapping_id,m.cost_id]),...source.retired_mappings.flatMap(m=>[m.mapping_id,m.bill_id,m.line_id,m.cost_id])]);
 // Opaque strings are collision exclusions only, not interpreted or rewritten as references.
 const exclude=(value:unknown):void=>{if(typeof value==='string')used.add(value);else if(value&&typeof value==='object')for(const[k,v]of Object.entries(value)){used.add(k);exclude(v);}};exclude(source);
 const reserve=(id:string):string=>{if(used.has(id))fail('ID_COLLISION');used.add(id);return id;};
 const fresh=(prefix:string)=>reserve(prefix+'-'+crypto.randomUUID());
 const replacements=new Map(targetIds.map(id=>[id,fresh('container-cost')]));
 const costId=(id:string):string=>{if(retired.has(id)&&!projectIds.has(id)&&!replacements.has(id))fail('RETIRED_TARGET_REFERENCE');return replacements.get(id)??id;};
 const pair=structuredClone(source),project=pair.project,bill=pair.bill;
 project.name=name;project.updated_at=metadata_time;
 function cost(item:CostItem):void {
  if(item.contained_in_cost_id!==undefined)item.contained_in_cost_id=costId(item.contained_in_cost_id);
  if(item.calculation_base?.kind==='COST_ITEMS')item.calculation_base.ids=item.calculation_base.ids.map(costId);
  unconfirm(item.fx_evidence);
 }
 project.items.forEach(cost);
 for(const book of project.fx_books)for(const evidence of Object.values(book.evidence??{}))unconfirm(evidence);
 const rules=project.tax_profile.import;unconfirm(rules.rateEvidence);unconfirm(rules.eligibility?.duty_evidence);unconfirm(rules.eligibility?.vat_evidence);
 for(const entry of rules.hsTable?.entries??[])unconfirm(entry.evidence);
 for(const term of INCOTERMS){
  const record=project.term_scenarios?.[term];if(!record)continue;
  unconfirm(record.quote_evidence);unconfirm(record.transport?.evidence);unconfirm(record.insurance?.evidence);
  if(record.insurance){record.insurance.scope_confirmed=false;record.insurance.direct_claim_confirmed=false;}
  if(record.responsibility_overrides)record.responsibility_overrides=Object.fromEntries(Object.entries(record.responsibility_overrides).map(([id,override])=>{unconfirm(override.evidence);return[costId(id),override];}));
  // Same-name 0.8 data is an inert extension, never interpreted while copying.
  if(project.schema_version==='0.9'&&record.transport_cost_links){
   const input=record.transport_cost_links;input.target_cost_ids=input.target_cost_ids.map(costId);
   for(const link of input.links){link.cost_id=costId(link.cost_id);link.state='UNCONFIRMED';unconfirm(link.evidence);}
   for(const resolution of input.overlap_resolutions??[]){resolution.cost_ids=resolution.cost_ids.map(costId) as [string,string];unconfirm(resolution.evidence);}
  }
 }
 bill.id=fresh('bill');bill.binding=null;const lines=new Map<string,string>();
 for(const row of bill.rows){const id=fresh('line');lines.set(row.input.line_id,id);row.input.line_id=id;unconfirm(row.evidence);if(row.cost_reference){row.cost_reference.cost_id=costId(row.cost_reference.cost_id);unconfirm(row.cost_reference.evidence);}}
 for(const intent of pair.selection.intents){
  intent.line_id=lines.get(intent.line_id)!;
  if(intent.operation==='REFERENCE_EXISTING')intent.cost_id=costId(intent.cost_id);
  else{intent.new_cost.cost_id=replacements.get(intent.new_cost.cost_id)!;cost(intent.new_cost);unconfirm(intent.evidence);}
 }
 const result=createContainerCostPair(project,bill,pair.selection);
 reserve(result.pair_id);for(const entry of result.mapping.entries)reserve(entry.mapping_id);
 serializeContainerCostPair(result);return result;
}
