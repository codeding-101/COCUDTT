import {FeePrecisionSelectionError,FEE_PRECISION_SELECTION_BYTES,FEE_PRECISION_SELECTION_REVISION_LIMIT,type FeePrecisionSelection,type FeePrecisionSelectionRecord,type FeePrecisionSelectionLease,type FeePrecisionChoice} from '../domain/fee-precision-selection.js';
import {FEE_PRECISION_CHANNELS,type PrecisionChannel} from '../domain/fee-precision.js';
import {FEE_TAX_ATTACHMENT_BYTES,FEE_TAX_ATTACHMENT_PAIR_BYTES,type FeeTaxAttachment} from '../domain/fee-tax-attachment.js';
import type {ContainerCostPair} from '../domain/container-cost-pair.js';
import {parseContainerCostPair} from './container-cost-pair.js';
import {parseFeeTaxAttachment,reviewFeeTaxAttachment} from './fee-tax-attachment.js';
import {reviewFeeTaxComponent} from '../engine/fee-tax-components.js';
import {reviewFeeRounding,reviewFeePrecisionFx} from '../engine/fee-precision.js';
import {copyFeePrecisionSelectionJson as copy,parseFeePrecisionSelectionJson as json,canonicalFeePrecisionSelectionJson as canonical,feePrecisionSelectionSha256 as sha} from './fee-precision-selection-json.js';
import type {JsonSchema} from './project-validation.js';

function fail(reason:string):never{throw new FeePrecisionSelectionError(reason);}
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
function fields(v:unknown,keys:string):asserts v is Record<string,any>{const k=keys.split(' ');if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==k.length||k.some(x=>!Object.hasOwn(v,x)))fail('FIELDS');}
function id(v:unknown,short=true):asserts v is string{if(typeof v!=='string'||(short?!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(v):!v.trim()||Array.from(v).length>200||['__proto__','constructor','prototype'].includes(v)))fail('ID');}
function digest(v:unknown):asserts v is string{if(typeof v!=='string'||!/^[0-9a-f]{64}$/.test(v))fail('DIGEST');}
function target(v:unknown):void{fields(v,'mapping_id bill_id line_id cost_id operation');for(const k of['mapping_id','bill_id','line_id','cost_id'])id(v[k],false);if(!['CREATE_NEW','REFERENCE_EXISTING'].includes(v.operation))fail('OPERATION');}
function calculation(r:Pick<FeePrecisionSelectionRecord,'currency'|'original'|'channel'|'choice'>){
 try{
  if(r.original!==null&&(typeof r.original!=='object'||Array.isArray(r.original)))fail('ORIGINAL');
  // Reuse the strict exact fraction boundary, without trusting any saved candidate.
  reviewFeeRounding({currency:r.currency,amount:r.original,policy:{kind:'UNRESOLVED'}});
  const c=r.choice;
  if(c?.kind==='UNRESOLVED'){fields(c,'kind');return reviewFeeRounding({currency:r.currency,amount:r.original,policy:c});}
  if(c?.kind==='ROUND'){fields(c,'kind policy');if(c.policy?.kind!=='EXPLICIT')fail('POLICY');return reviewFeeRounding({currency:r.currency,amount:r.original,policy:c.policy});}
  fields(c,'kind to purpose as_of rate_source policy');if(c.kind!=='FX'||c.policy?.kind!=='EXPLICIT')fail('CHOICE');
  return reviewFeePrecisionFx({amount:r.original,from:r.currency,channel:r.channel,to:c.to,purpose:c.purpose,as_of:c.as_of,rate_source:c.rate_source,policy:c.policy});
 }catch(e){if(e instanceof FeePrecisionSelectionError)throw e;return fail('PRECISION_INPUT');}
}
interface Sources {pair:ContainerCostPair;attachment:FeeTaxAttachment;pairText:string;attachmentText:string}
async function sources(pairText:unknown,attachmentText:unknown,coherent=true):Promise<Sources>{
 // All strings and the outer object are snapshotted before the first async digest.
 let pair:ContainerCostPair;
 try{json(pairText,FEE_TAX_ATTACHMENT_PAIR_BYTES);pair=parseContainerCostPair(pairText as string);}catch{return fail('PAIR_SNAPSHOT');}
 let attachment:FeeTaxAttachment;
 try{json(attachmentText,FEE_TAX_ATTACHMENT_BYTES);attachment=await parseFeeTaxAttachment(attachmentText);}catch{return fail('ATTACHMENT_SNAPSHOT');}
 if(coherent&&attachment.pair_snapshot_json!==pairText)fail('SOURCE_PAIR_MISMATCH');
 return{pair,attachment,pairText:pairText as string,attachmentText:attachmentText as string};
}
async function validateDetached(raw:unknown){
 fields(raw,'kind version selection_id revision pair_snapshot_json pair_snapshot_sha256 attachment_snapshot_json attachment_snapshot_sha256 records retired_record_ids content_sha256');
 if(raw.kind!=='INTERNAL_FEE_PRECISION_SELECTION'||raw.version!=='1.0')fail('VERSION');id(raw.selection_id);
 if(!Number.isSafeInteger(raw.revision)||raw.revision<1||raw.revision>FEE_PRECISION_SELECTION_REVISION_LIMIT)fail('REVISION');
 for(const k of['pair_snapshot_sha256','attachment_snapshot_sha256','content_sha256'])digest(raw[k]);
 if(!Array.isArray(raw.records)||raw.records.length>48||!Array.isArray(raw.retired_record_ids)||raw.retired_record_ids.length>500)fail('RECORD_LIMIT');
 const ids=new Set<string>(),slots=new Set<string>();
 for(const r of raw.records){
  fields(r,'record_id component_record_id target channel currency original choice acknowledgement');id(r.record_id);id(r.component_record_id);target(r.target);
  if(!FEE_PRECISION_CHANNELS.includes(r.channel))fail('CHANNEL');
  calculation(r as FeePrecisionSelectionRecord);
  const slot=canonical([r.component_record_id,r.channel]);if(ids.has(r.record_id)||slots.has(slot))fail('DUPLICATE_RECORD');ids.add(r.record_id);slots.add(slot);
  if(r.acknowledgement!==null){fields(r.acknowledgement,'basis_sha256');digest(r.acknowledgement.basis_sha256);}
 }
 for(const retired of raw.retired_record_ids){id(retired);if(ids.has(retired))fail('RETIRED_ID');ids.add(retired);}
 if(new TextEncoder().encode(JSON.stringify(raw,null,2)+'\n').length>FEE_PRECISION_SELECTION_BYTES)fail('UTF8_SIZE');
 const s=await sources(raw.pair_snapshot_json,raw.attachment_snapshot_json);
 if(await sha(raw.pair_snapshot_json)!==raw.pair_snapshot_sha256)fail('PAIR_DIGEST');
 if(await sha(raw.attachment_snapshot_json)!==raw.attachment_snapshot_sha256)fail('ATTACHMENT_DIGEST');
 const {content_sha256:expected,...body}=raw;if(await sha(canonical(body))!==expected)fail('CONTENT_DIGEST');
 return{selection:raw as FeePrecisionSelection,...s};
}
export async function validateFeePrecisionSelection(value:unknown):Promise<FeePrecisionSelection>{return(await validateDetached(copy(value))).selection;}
export async function parseFeePrecisionSelection(text:unknown):Promise<FeePrecisionSelection>{return(await validateDetached(json(text))).selection;}
export async function serializeFeePrecisionSelection(value:unknown):Promise<string>{return JSON.stringify(await validateFeePrecisionSelection(value),null,2)+'\n';}
async function seal(a:FeePrecisionSelection):Promise<FeePrecisionSelection>{const {content_sha256:_,...body}=a;a.content_sha256=await sha(canonical(body));return(await validateDetached(a)).selection;}
async function leased(value:unknown,expected:FeePrecisionSelectionLease){const a=copy(value),l=copy(expected);fields(l,'revision content_sha256');const ctx=await validateDetached(a);if(l.revision!==ctx.selection.revision||l.content_sha256!==ctx.selection.content_sha256)fail('STALE_LEASE');return ctx;}
function next(a:FeePrecisionSelection):void{if(a.revision>=FEE_PRECISION_SELECTION_REVISION_LIMIT)fail('REVISION_LIMIT');a.revision++;}
function find(a:FeePrecisionSelection,record_id:string){id(record_id);const r=a.records.find(r=>r.record_id===record_id);if(!r)fail('RECORD_MISSING');return r;}
function binding(s:Sources,r:FeePrecisionSelectionRecord){
 const issues:string[]=[],m=s.pair.mapping.entries.find(m=>m.mapping_id===r.target.mapping_id),source=s.attachment.records.find(x=>x.record_id===r.component_record_id);
 if(!m||!same(m,r.target)||s.pair.retired_mappings.some(m=>m.mapping_id===r.target.mapping_id))issues.push('ORPHAN_TARGET');
 if(!source)issues.push('ORPHAN_COMPONENT');
 else{
  if(!same(source.target,r.target))issues.push('COMPONENT_TARGET_MISMATCH');
  if(source.input.currency!==r.currency)issues.push('COMPONENT_CURRENCY_MISMATCH');
  if(!same(reviewFeeTaxComponent(source.input).channels[r.channel],r.original))issues.push('ORIGINAL_COMPONENT_MISMATCH');
 }
 if(m){const intent=s.pair.selection.intents.find(x=>x.line_id===m.line_id)!,cost=intent.operation==='CREATE_NEW'?intent.new_cost:s.pair.project.items.find(c=>c.cost_id===intent.cost_id);
  if(!cost||cost.source==='DERIVED'||cost.cost_category==='IMPORT_DUTIES'||cost.cost_category==='GOODS_AND_PACKING'||cost.is_goods_value)issues.push('TARGET_NOT_SERVICE_FEE');
  if(cost?.applicable_incoterms&&!cost.applicable_incoterms.includes(s.pair.project.incoterm))issues.push('TARGET_NOT_ACTIVE');
 }
 return issues;
}
async function basis(a:FeePrecisionSelection,r:FeePrecisionSelectionRecord){return sha(canonical({contract:'fee-precision-selection-1.0-policy-0.1',selection_id:a.selection_id,record_id:r.record_id,pair_snapshot_sha256:a.pair_snapshot_sha256,attachment_snapshot_sha256:a.attachment_snapshot_sha256,component_record_id:r.component_record_id,target:r.target,channel:r.channel,currency:r.currency,original:r.original,choice:r.choice}));}
function policyIssues(s:Sources,r:FeePrecisionSelectionRecord,current:Sources){
 const issues=binding(s,r);
 if(current.pairText!==s.pairText)issues.push('STALE_PAIR_SOURCE');if(current.attachmentText!==s.attachmentText)issues.push('STALE_ATTACHMENT_SOURCE');
 if(current.attachment.pair_snapshot_json!==current.pairText)issues.push('CURRENT_SOURCES_INCOHERENT');
 if(r.original===null)issues.push('ORIGINAL_UNKNOWN');if(r.choice.kind==='UNRESOLVED')issues.push('POLICY_UNRESOLVED');
 if(r.choice.kind==='FX'&&r.choice.as_of!==s.pair.bill.review_date)issues.push('FX_REVIEW_DATE_MISMATCH');return issues;
}
export async function createFeePrecisionSelection(pair_snapshot_json:string,attachment_snapshot_json:string):Promise<FeePrecisionSelection>{
 await sources(pair_snapshot_json,attachment_snapshot_json);
 return seal({kind:'INTERNAL_FEE_PRECISION_SELECTION',version:'1.0',selection_id:'precision-'+crypto.randomUUID(),revision:1,pair_snapshot_json,pair_snapshot_sha256:await sha(pair_snapshot_json),attachment_snapshot_json,attachment_snapshot_sha256:await sha(attachment_snapshot_json),records:[],retired_record_ids:[],content_sha256:''});
}
/** Capture from a validated original component, never from a caller's money/target fields. */
export async function addFeePrecisionSelectionRecord(value:unknown,lease:FeePrecisionSelectionLease,input:unknown):Promise<FeePrecisionSelection>{
 const captured=copy(input);fields(captured,'component_record_id channel choice');id(captured.component_record_id);
 if(!FEE_PRECISION_CHANNELS.includes(captured.channel))fail('CHANNEL');
 const s=await leased(value,lease),a=s.selection,source=s.attachment.records.find(r=>r.record_id===captured.component_record_id);if(!source)fail('COMPONENT_MISSING');
 const channel=captured.channel as PrecisionChannel;
 if(a.records.length>=48)fail('RECORD_LIMIT');if(a.records.some(r=>r.component_record_id===source.record_id&&r.channel===channel))fail('DUPLICATE_SLOT');
 const r:FeePrecisionSelectionRecord={record_id:'precision-record-'+crypto.randomUUID(),component_record_id:source.record_id,target:structuredClone(source.target),channel,currency:source.input.currency,original:reviewFeeTaxComponent(source.input).channels[channel],choice:captured.choice as FeePrecisionChoice,acknowledgement:null};
 calculation(r);if(binding(s,r).length)fail('RECORD_BINDING');a.records.push(r);next(a);return seal(a);
}
export async function setFeePrecisionSelectionChoice(value:unknown,lease:FeePrecisionSelectionLease,record_id:string,choice:unknown):Promise<FeePrecisionSelection>{
 const captured=copy(choice),s=await leased(value,lease),a=s.selection,r=find(a,record_id);calculation({...r,choice:captured as FeePrecisionChoice});
 if(same(r.choice,captured))return a;r.choice=captured as FeePrecisionChoice;r.acknowledgement=null;next(a);return seal(a);
}
export async function removeFeePrecisionSelectionRecord(value:unknown,lease:FeePrecisionSelectionLease,record_id:string):Promise<FeePrecisionSelection>{
 const {selection:a}=await leased(value,lease),r=find(a,record_id);if(a.retired_record_ids.length>=500)fail('RETIRED_LIMIT');a.records=a.records.filter(x=>x!==r);a.retired_record_ids.push(r.record_id);next(a);return seal(a);
}
export async function acknowledgeFeePrecisionSelectionRecord(value:unknown,lease:FeePrecisionSelectionLease,current_pair_json:string,current_attachment_json:string,record_id:string):Promise<FeePrecisionSelection>{
 const [s,current]=await Promise.all([leased(value,lease),sources(current_pair_json,current_attachment_json,false)]),a=s.selection,r=find(a,record_id);
 if(policyIssues(s,r,current).length)fail('POLICY_NEEDS_REVIEW');const key=await basis(a,r);if(r.acknowledgement?.basis_sha256===key)return a;r.acknowledgement={basis_sha256:key};next(a);return seal(a);
}
export async function rebindFeePrecisionSelection(value:unknown,lease:FeePrecisionSelectionLease,pair_snapshot_json:string,attachment_snapshot_json:string):Promise<FeePrecisionSelection>{
 const [s,n]=await Promise.all([leased(value,lease),sources(pair_snapshot_json,attachment_snapshot_json)]),a=s.selection;
 if(n.pair.pair_id!==s.pair.pair_id||n.attachment.attachment_id!==s.attachment.attachment_id)fail('SOURCE_IDENTITY');
 if(a.pair_snapshot_json===pair_snapshot_json&&a.attachment_snapshot_json===attachment_snapshot_json)return a;
 a.pair_snapshot_json=pair_snapshot_json;a.pair_snapshot_sha256=await sha(pair_snapshot_json);a.attachment_snapshot_json=attachment_snapshot_json;a.attachment_snapshot_sha256=await sha(attachment_snapshot_json);a.records.forEach(r=>r.acknowledgement=null);next(a);return seal(a);
}
export async function copyFeePrecisionSelectionForNewBusiness(value:unknown,lease:FeePrecisionSelectionLease,new_pair_json:string,new_attachment_json:string):Promise<FeePrecisionSelection>{
 const [s,n]=await Promise.all([leased(value,lease),sources(new_pair_json,new_attachment_json)]);
 if(n.pair.pair_id===s.pair.pair_id||n.attachment.attachment_id===s.attachment.attachment_id)fail('NEW_BUSINESS_IDENTITY');return createFeePrecisionSelection(new_pair_json,new_attachment_json);
}
export async function reviewFeePrecisionSelection(value:unknown,current_pair_json:string,current_attachment_json:string){
 const snapshot=copy(value),[s,current]=await Promise.all([validateDetached(snapshot),sources(current_pair_json,current_attachment_json,false)]),a=s.selection;
 const source_review=await reviewFeeTaxAttachment(s.attachment,current_pair_json),rows=[];
 for(const r of a.records){const issues=policyIssues(s,r,current),key=await basis(a,r);if(r.acknowledgement&&r.acknowledgement.basis_sha256!==key)issues.push('ACKNOWLEDGEMENT_BASIS_MISMATCH');
  rows.push({record:structuredClone(r),calculation:calculation(r),binding_issues:binding(s,r),business_issues:[...(source_review.rows.find(x=>x.record_id===r.component_record_id)?.issues??[])],policy:{status:!r.acknowledgement?'NOT_RECORDED':issues.length?'NEEDS_REVIEW':'RECORDED_POLICY_ASSUMPTION',issues}});
 }
 return{scope:'READ_ONLY_PRECISION_POLICY_ASSUMPTIONS' as const,selection_id:a.selection_id,revision:a.revision,content_sha256:a.content_sha256,source_status:{pair_current:current_pair_json===a.pair_snapshot_json,attachment_current:current_attachment_json===a.attachment_snapshot_json,coherent_current:current.attachment.pair_snapshot_json===current_pair_json},source_review,rows};
}

/** Offline structural shape only; strict JSON, hashes, fractions and source identity require runtime. */
export function feePrecisionSelectionSchema():JsonSchema{
 const obj=(properties:Record<string,unknown>)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
 const short={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'},ref={type:'string',maxLength:200,pattern:'\\S',not:{enum:['__proto__','constructor','prototype']}},hash={type:'string',pattern:'^[0-9a-f]{64}$'},code={type:'string',pattern:'^[A-Z]{3}$'},date={type:'string',pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'},reason={type:'string',maxLength:200,pattern:'\\S'},decimal={type:'string',pattern:'^(0|[1-9][0-9]{0,23})(\\.[0-9]{1,18})?$'};
 const policy=obj({kind:{const:'EXPLICIT'},unit:decimal,mode:{enum:['HALF_UP','HALF_EVEN','DOWN']},basis:reason});
 const choice={oneOf:[obj({kind:{const:'UNRESOLVED'}}),obj({kind:{const:'ROUND'},policy}),obj({kind:{const:'FX'},to:code,purpose:{enum:['COMMERCIAL_REVIEW','CUSTOMS_COMPONENT_REVIEW']},as_of:date,rate_source:obj({base:code,quote:code,rate:decimal,type:{enum:['CONTRACT','MARKET','CUSTOMS']},rate_date:date,valid_from:date,valid_to:date,reference:reason}),policy})]};
 return{$schema:'http://json-schema.org/draft-07/schema#',$id:'urn:cocudtt:internal-fee-precision-selection:1.0',title:'COCUDTT internal fee precision selection 1.0',description:'Read-only arithmetic policies; not tax certification or fee application. Runtime verifies nested duplicate keys, fingerprints, references, exact fractions, UTF-8 limits and dates.',...obj({kind:{const:'INTERNAL_FEE_PRECISION_SELECTION'},version:{const:'1.0'},selection_id:short,revision:{type:'integer',minimum:1,maximum:FEE_PRECISION_SELECTION_REVISION_LIMIT},pair_snapshot_json:{type:'string'},pair_snapshot_sha256:hash,attachment_snapshot_json:{type:'string'},attachment_snapshot_sha256:hash,records:{type:'array',maxItems:48,items:obj({record_id:short,component_record_id:short,target:obj({mapping_id:ref,bill_id:ref,line_id:ref,cost_id:ref,operation:{enum:['CREATE_NEW','REFERENCE_EXISTING']}}),channel:{enum:[...FEE_PRECISION_CHANNELS]},currency:code,original:{anyOf:[{type:'null'},obj({numerator:{type:'string',pattern:'^(0|[1-9][0-9]{0,79})$'},denominator:{type:'string',pattern:'^[1-9][0-9]{0,79}$'}})]},choice,acknowledgement:{anyOf:[{type:'null'},obj({basis_sha256:hash})]}})},retired_record_ids:{type:'array',maxItems:500,uniqueItems:true,items:short},content_sha256:hash})};
}
