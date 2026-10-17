import {FEE_TAX_ATTACHMENT_FACETS as FACETS,FEE_TAX_ATTACHMENT_PAIR_BYTES,FEE_TAX_ATTACHMENT_BYTES,FEE_TAX_ATTACHMENT_REVISION_LIMIT,FeeTaxAttachmentError,type FeeTaxAttachment,type FeeTaxAttachmentRecord,type FeeTaxAttachmentRecordInput,type FeeTaxAttachmentLease,type FeeTaxAttachmentFacet,type FeeTaxAttachmentSource} from '../domain/fee-tax-attachment.js';
import type {ContainerCostPair} from '../domain/container-cost-pair.js';
import type {JsonSchema} from './project-validation.js';
import {parseContainerCostPair} from './container-cost-pair.js';
import {reviewFeeTaxComponent} from '../engine/fee-tax-components.js';
import {proposeContainerCosts} from '../engine/container-cost-proposal.js';
import {isIsoDate} from '../engine/tax/china-import.js';
import {copyFeeTaxAttachmentJson as copy,parseFeeTaxAttachmentJson as json,canonicalFeeTaxAttachmentJson as canonical,feeTaxAttachmentSha256 as sha} from './fee-tax-attachment-json.js';

const fail=(reason:string):never=>{throw new FeeTaxAttachmentError(reason)};
function shape(v:unknown,keys:string):asserts v is Record<string,any>{const required=keys.split(' ');if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==required.length||required.some(k=>!Object.hasOwn(v,k)))fail('FIELDS');}
function id(v:unknown,short=false):asserts v is string {if(typeof v!=='string'||(short?!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(v):!v.trim()||Array.from(v).length>200||['__proto__','constructor','prototype'].includes(v)))fail('ID');}
function digest(v:unknown):asserts v is string{if(typeof v!=='string'||!/^[0-9a-f]{64}$/.test(v))fail('DIGEST');}
function source(v:unknown):asserts v is FeeTaxAttachmentSource {
 shape(v,'provenance reference valid_from valid_to checked_on');
 if(!['UNSPECIFIED','EXAMPLE','USER_SUPPLIED'].includes(v.provenance)||typeof v.reference!=='string'||v.reference.length>200)fail('SOURCE');
 for(const field of['valid_from','valid_to','checked_on'])if(typeof v[field]!=='string'||v[field]!==''&&!isIsoDate(v[field]))fail('SOURCE_DATE');
 if(v.valid_from&&v.valid_to&&v.valid_from>v.valid_to)fail('SOURCE_PERIOD');
}
function recordInput(v:unknown):asserts v is FeeTaxAttachmentRecordInput {
 shape(v,'target input sources');shape(v.target,'mapping_id bill_id line_id cost_id operation');
 for(const field of['mapping_id','bill_id','line_id','cost_id'])id(v.target[field]);if(!['CREATE_NEW','REFERENCE_EXISTING'].includes(v.target.operation))fail('OPERATION');
 try{reviewFeeTaxComponent(v.input);}catch{fail('COMPONENT_INPUT');}
 shape(v.sources,'tax credit customs');for(const f of FACETS)source(v.sources[f]);
}
function pairText(text:unknown):ContainerCostPair {
 json(text,FEE_TAX_ATTACHMENT_PAIR_BYTES);
 try{return parseContainerCostPair(text as string);}catch{ return fail('PAIR_SNAPSHOT');}
}
const emptyAcks=():FeeTaxAttachmentRecord['acknowledgements']=>({tax:null,credit:null,customs:null});
const bytes=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v,null,2)+'\n').length;
async function validateDetached(raw:unknown):Promise<FeeTaxAttachment>{
 shape(raw,'kind version attachment_id revision pair_snapshot_json pair_snapshot_sha256 records retired_record_ids content_sha256');
 if(raw.kind!=='INTERNAL_FEE_TAX_ATTACHMENT'||raw.version!=='1.0')fail('VERSION');id(raw.attachment_id,true);
 if(!Number.isSafeInteger(raw.revision)||raw.revision<1||raw.revision>FEE_TAX_ATTACHMENT_REVISION_LIMIT)fail('REVISION');
 pairText(raw.pair_snapshot_json);digest(raw.pair_snapshot_sha256);digest(raw.content_sha256);
 if(!Array.isArray(raw.records)||raw.records.length>8||!Array.isArray(raw.retired_record_ids)||raw.retired_record_ids.length>200)fail('RECORD_LIMIT');
 const ids=new Set<string>(),componentIds=new Set<string>(),mappings=new Set<string>();
 for(const r of raw.records){
  shape(r,'record_id target input sources acknowledgements');id(r.record_id,true);
  recordInput({target:r.target,input:r.input,sources:r.sources});
  if(ids.has(r.record_id)||componentIds.has(r.input.line_id)||mappings.has(r.target.mapping_id))fail('DUPLICATE_RECORD');
  ids.add(r.record_id);componentIds.add(r.input.line_id);mappings.add(r.target.mapping_id);
  shape(r.acknowledgements,'tax credit customs');for(const f of FACETS){const ack=r.acknowledgements[f];if(ack!==null){shape(ack,'basis_sha256');digest(ack.basis_sha256);}}
 }
 for(const retired of raw.retired_record_ids){id(retired,true);if(ids.has(retired))fail('RETIRED_ID');ids.add(retired);}
 if(bytes(raw)>FEE_TAX_ATTACHMENT_BYTES)fail('UTF8_SIZE');
 if(await sha(raw.pair_snapshot_json)!==raw.pair_snapshot_sha256)fail('PAIR_DIGEST');
 const {content_sha256:expected,...body}=raw;if(await sha(canonical(body))!==expected)fail('CONTENT_DIGEST');
 return raw as FeeTaxAttachment;
}
/** Snapshot first; callers cannot change the candidate during asynchronous hashing. */
export async function validateFeeTaxAttachment(value:unknown):Promise<FeeTaxAttachment>{return validateDetached(copy(value));}
export async function parseFeeTaxAttachment(text:unknown):Promise<FeeTaxAttachment>{return validateDetached(json(text));}
export async function serializeFeeTaxAttachment(value:unknown):Promise<string>{const a=await validateFeeTaxAttachment(value);return JSON.stringify(a,null,2)+'\n';}
async function seal(a:FeeTaxAttachment):Promise<FeeTaxAttachment>{const {content_sha256:_old,...body}=a;a.content_sha256=await sha(canonical(body));return validateDetached(a);}
export async function createFeeTaxAttachment(pair_snapshot_json:string):Promise<FeeTaxAttachment>{
 pairText(pair_snapshot_json);
 return seal({kind:'INTERNAL_FEE_TAX_ATTACHMENT',version:'1.0',attachment_id:'tax-attachment-'+crypto.randomUUID(),revision:1,pair_snapshot_json,pair_snapshot_sha256:await sha(pair_snapshot_json),records:[],retired_record_ids:[],content_sha256:''});
}
async function leased(value:unknown,expected:FeeTaxAttachmentLease):Promise<FeeTaxAttachment>{
 const snapshot=copy(value),lease=copy(expected);shape(lease,'revision content_sha256');const a=await validateDetached(snapshot);
 if(lease.revision!==a.revision||lease.content_sha256!==a.content_sha256)fail('STALE_LEASE');return a;
}
function next(a:FeeTaxAttachment):void{if(a.revision>=FEE_TAX_ATTACHMENT_REVISION_LIMIT)fail('REVISION_LIMIT');a.revision++;}
const find=(a:FeeTaxAttachment,id:string)=>a.records.find(r=>r.record_id===id)??fail('RECORD_MISSING');
export async function setFeeTaxAttachmentRecord(value:unknown,lease:FeeTaxAttachmentLease,input:unknown,record_id:string|null=null):Promise<FeeTaxAttachment>{
 const candidate=copy(input);recordInput(candidate);const a=await leased(value,lease),old=record_id===null?null:find(a,record_id);
 if(old){
  if(canonical(old.target)!==canonical(candidate.target))fail('IMMUTABLE_TARGET');
  if(canonical({target:old.target,input:old.input,sources:old.sources})===canonical(candidate))return a;
  for(const f of FACETS)if(old.sources[f].provenance==='EXAMPLE'&&candidate.sources[f].provenance==='USER_SUPPLIED'&&old.sources[f].reference.trim()===candidate.sources[f].reference.trim())fail('EXAMPLE_REPLACEMENT_REQUIRED');
  Object.assign(old,candidate,{acknowledgements:emptyAcks()});
 }else{if(a.records.length>=8)fail('RECORD_LIMIT');a.records.push({...candidate,record_id:'tax-record-'+crypto.randomUUID(),acknowledgements:emptyAcks()});}
 next(a);return seal(a);
}
export async function removeFeeTaxAttachmentRecord(value:unknown,lease:FeeTaxAttachmentLease,record_id:string):Promise<FeeTaxAttachment>{
 const a=await leased(value,lease);find(a,record_id);if(a.retired_record_ids.length>=200)fail('RETIRED_LIMIT');a.records=a.records.filter(r=>r.record_id!==record_id);a.retired_record_ids.push(record_id);next(a);return seal(a);
}
export async function rebindFeeTaxAttachment(value:unknown,lease:FeeTaxAttachmentLease,pair_snapshot_json:string):Promise<FeeTaxAttachment>{
 pairText(pair_snapshot_json);const a=await leased(value,lease);if(a.pair_snapshot_json===pair_snapshot_json)return a;
 a.pair_snapshot_json=pair_snapshot_json;a.pair_snapshot_sha256=await sha(pair_snapshot_json);for(const r of a.records)r.acknowledgements=emptyAcks();next(a);return seal(a);
}
/** New business is an empty independent attachment; no existing copy button is changed. */
export async function copyFeeTaxAttachmentForNewBusiness(value:unknown,lease:FeeTaxAttachmentLease,new_pair_snapshot_json:string):Promise<FeeTaxAttachment>{
 const newPair=pairText(new_pair_snapshot_json),a=await leased(value,lease),old=pairText(a.pair_snapshot_json);
 if(newPair.pair_id===old.pair_id||newPair.bill.id===old.bill.id)fail('NEW_BUSINESS_IDENTITY');return createFeeTaxAttachment(new_pair_snapshot_json);
}
async function basis(a:FeeTaxAttachment,r:FeeTaxAttachmentRecord):Promise<string>{return sha(canonical({contract:'fee-tax-attachment-1.0-review-0.1',attachment_id:a.attachment_id,record_id:r.record_id,pair_snapshot_sha256:a.pair_snapshot_sha256,target:r.target,input:r.input,sources:r.sources}));}
function sameAmount(a:string|null,b:unknown):boolean{
 const units=(s:unknown)=>{if(typeof s!=='string'||! /^(0|[1-9]\d{0,99})(\.\d{1,40})?$/.test(s))return null;const [n='',d='']=s.split('.');return{n:BigInt(n+d),d:10n**BigInt(d.length)};};
 const left=units(a),right=units(b);return!!left&&!!right&&left.n*right.d===right.n*left.d;
}
function bindingIssues(a:FeeTaxAttachment,r:FeeTaxAttachmentRecord,pair:ContainerCostPair,current:string):string[]{
 const issues:string[]=[];if(current!==a.pair_snapshot_json)issues.push('STALE_PAIR_SOURCE');
 const m=pair.mapping.entries.find(m=>m.mapping_id===r.target.mapping_id);
 if(!m||pair.retired_mappings.some(m=>m.mapping_id===r.target.mapping_id)||['mapping_id','bill_id','line_id','cost_id','operation'].some(k=>(m as any)?.[k]!==r.target[k as keyof typeof r.target]))return[...issues,'ORPHAN_TARGET'];
 const intent=pair.selection.intents.find(i=>i.line_id===m.line_id)!;
 const cost=intent.operation==='CREATE_NEW'?intent.new_cost:pair.project.items.find(c=>c.cost_id===intent.cost_id);
 if(!cost)return[...issues,'TARGET_COST_MISSING'];
 if(cost.source==='DERIVED'||cost.cost_category==='IMPORT_DUTIES'||cost.cost_category==='GOODS_AND_PACKING'||cost.is_goods_value)issues.push('SERVICE_FEE_TARGET_UNSUPPORTED');
 if(cost.applicable_incoterms!==undefined&&!cost.applicable_incoterms.includes(pair.project.incoterm))issues.push('TARGET_COST_NOT_ACTIVE');
 const proposal=proposeContainerCosts(pair.project,pair.bill,pair.selection),row=proposal.rows.find(x=>x.line_id===m.line_id)!;
 issues.push(...proposal.issues.map(x=>'PROPOSAL_'+x),...row.issues.map(x=>'PROPOSAL_'+x),...row.source_issues.map(x=>'PROPOSAL_SOURCE_'+x));
 const bill=pair.bill.rows.find(x=>x.input.line_id===m.line_id)!;
 if(r.input.currency!==bill.input.currency||r.input.currency!==cost.currency)issues.push('CURRENCY_MISMATCH');
 if(!sameAmount(r.input.gross,row.original_amount))issues.push('BILL_AMOUNT_MISMATCH_OR_UNKNOWN');
 if(cost.pricing_method!=='FIXED'||!sameAmount(r.input.gross,cost.amount))issues.push('TARGET_AMOUNT_MISMATCH_OR_UNKNOWN');
 return[...new Set(issues)];
}
function sourceIssues(s:FeeTaxAttachmentSource,day:string,known:boolean):string[]{
 const issues:string[]=[];if(!known)issues.push('COMPONENT_UNKNOWN');if(s.provenance!=='USER_SUPPLIED')issues.push('SOURCE_NOT_USER_SUPPLIED');if(!s.reference.trim())issues.push('SOURCE_REFERENCE_MISSING');
 if(!isIsoDate(day)||!s.valid_from||!s.valid_to||!s.checked_on)issues.push('SOURCE_DATES_INCOMPLETE');
 else{if(day<s.valid_from||day>s.valid_to)issues.push('SOURCE_OUTSIDE_PERIOD');if(s.checked_on>day)issues.push('SOURCE_CHECK_IN_FUTURE');}return issues;
}
export async function reviewFeeTaxAttachment(value:unknown,current_pair_snapshot_json:string){
 const currentPair=pairText(current_pair_snapshot_json),a=await validateFeeTaxAttachment(value),rows=[];
 for(const r of a.records){
  const issues=bindingIssues(a,r,currentPair,current_pair_snapshot_json),key=await basis(a,r),acknowledgements={} as Record<FeeTaxAttachmentFacet,{status:'NOT_RECORDED'|'NEEDS_REVIEW'|'RECORDED_ASSUMPTION';issues:string[]}>;
  for(const f of FACETS){const problems=[...issues,...sourceIssues(r.sources[f],currentPair.bill.review_date,r.input[f].kind!=='UNKNOWN')];const ack=r.acknowledgements[f];if(ack&&ack.basis_sha256!==key)problems.push('ACKNOWLEDGEMENT_BASIS_MISMATCH');acknowledgements[f]={status:!ack?'NOT_RECORDED':problems.length?'NEEDS_REVIEW':'RECORDED_ASSUMPTION',issues:problems};}
  rows.push({record_id:r.record_id,target:structuredClone(r.target),issues,calculation:reviewFeeTaxComponent(r.input),acknowledgements});
 }
 return{scope:'READ_ONLY_ATTACHMENT_ASSUMPTIONS' as const,attachment_id:a.attachment_id,revision:a.revision,content_sha256:a.content_sha256,pair_is_current:current_pair_snapshot_json===a.pair_snapshot_json,rows};
}
export async function acknowledgeFeeTaxAttachmentRecord(value:unknown,lease:FeeTaxAttachmentLease,current_pair_snapshot_json:string,record_id:string,facet:FeeTaxAttachmentFacet):Promise<FeeTaxAttachment>{
 if(!FACETS.includes(facet))fail('FACET');const current=pairText(current_pair_snapshot_json),a=await leased(value,lease),r=find(a,record_id);
 if(bindingIssues(a,r,current,current_pair_snapshot_json).length||sourceIssues(r.sources[facet],current.bill.review_date,r.input[facet].kind!=='UNKNOWN').length)fail('ACKNOWLEDGEMENT_NEEDS_REVIEW');
 const key=await basis(a,r);if(r.acknowledgements[facet]?.basis_sha256===key)return a;r.acknowledgements[facet]={basis_sha256:key};next(a);return seal(a);
}

/** Offline shape only; fingerprints, duplicate keys, UTF-8, references and arithmetic require runtime. */
export function feeTaxAttachmentSchema():JsonSchema{
 const obj=(properties:Record<string,unknown>)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
 const short={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'},ref={type:'string',maxLength:200,pattern:'\\S',not:{enum:['__proto__','constructor','prototype']}},text={type:'string',maxLength:200},reason={type:'string',maxLength:200,pattern:'\\S'},date={type:'string',pattern:'^(|[0-9]{4}-[0-9]{2}-[0-9]{2})$'},hash={type:'string',pattern:'^[0-9a-f]{64}$'},decimal={type:'string',pattern:'^(0|[1-9][0-9]{0,23})(\\.[0-9]{1,18})?$'};
 const branch=(kind:string,fields:Record<string,unknown>={})=>obj({kind:{const:kind},...fields});
 const input=obj({line_id:short,currency:{type:'string',pattern:'^[A-Z]{3}$'},gross:{anyOf:[decimal,{type:'null'}]},tax:{oneOf:[branch('UNKNOWN'),branch('NO_SEPARATION'),branch('EXPLICIT',{net:decimal,tax:decimal}),branch('GROSS_RATE',{rate:decimal})]},credit:{oneOf:[branch('UNKNOWN'),branch('NONE',{basis:reason}),branch('ASSUMED',{amount:decimal,basis:reason,document_ref:reason,eligibility_ref:reason})]},customs:{oneOf:[branch('UNKNOWN'),branch('NOT_ADDED',{basis:reason}),branch('ADD_COMPONENT',{amount:decimal,basis:reason})]}});
 const source=obj({provenance:{enum:['UNSPECIFIED','EXAMPLE','USER_SUPPLIED']},reference:text,valid_from:date,valid_to:date,checked_on:date}),ack={anyOf:[{type:'null'},obj({basis_sha256:hash})]};
 return{$schema:'http://json-schema.org/draft-07/schema#',$id:'urn:cocudtt:internal-fee-tax-attachment:1.0',title:'COCUDTT internal fee tax attachment 1.0',description:'Read-only assumptions only. Runtime additionally checks complete pair JSON, duplicate keys, SHA-256, exact amounts, UTF-8 and UTF-16 limits, calendar dates, identities and references. No fee application or tax eligibility certification.',...obj({kind:{const:'INTERNAL_FEE_TAX_ATTACHMENT'},version:{const:'1.0'},attachment_id:short,revision:{type:'integer',minimum:1,maximum:FEE_TAX_ATTACHMENT_REVISION_LIMIT},pair_snapshot_json:{type:'string'},pair_snapshot_sha256:hash,records:{type:'array',maxItems:8,items:obj({record_id:short,target:obj({mapping_id:ref,bill_id:ref,line_id:ref,cost_id:ref,operation:{enum:['CREATE_NEW','REFERENCE_EXISTING']}}),input,sources:obj({tax:source,credit:source,customs:source}),acknowledgements:obj({tax:ack,credit:ack,customs:ack})})},retired_record_ids:{type:'array',maxItems:200,uniqueItems:true,items:short},content_sha256:hash})};
}
