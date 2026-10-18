import {FeeEnvelopeError,FEE_ENVELOPE_BYTES,type FeeEnvelope,type FeeEnvelopeSources,type FeeEnvelopeLedger,type FeeEnvelopePayload,type FeeEnvelopePlan,type FeeEnvelopeReceipt,type FeeEnvelopeRow,type FeeEnvelopeLease} from '../domain/fee-envelope.js';
import {copyFeeEnvelopeJson as copy,parseFeeEnvelopeJson as json,canonicalFeeEnvelopeJson as canonical,feeEnvelopeSha256 as sha} from './fee-envelope-json.js';
import {parseProject,serializeProject,toTrade,toScenario,type ProjectFile} from './project-file.js';
import {resolveResponsibility} from '../engine/responsibility/resolver.js';
import {INCOTERMS_2020_RULESET} from '../engine/responsibility/rules-incoterms2020.js';
import {costsForTerm} from '../engine/scenario-costs.js';
import {parseContainerBillDraft,serializeContainerBillDraft} from './container-bill-file.js';
import {parseContainerCostPair,serializeContainerCostPair,reviewContainerCostPair} from './container-cost-pair.js';
import {copyContainerBusiness} from './container-business-copy.js';
import {parseFeeTaxAttachment,createFeeTaxAttachment,serializeFeeTaxAttachment,reviewFeeTaxAttachment} from './fee-tax-attachment.js';
import {parseFeePrecisionSelection,createFeePrecisionSelection,serializeFeePrecisionSelection,reviewFeePrecisionSelection} from './fee-precision-selection.js';
import {proposeFeeApplication} from './fee-application-proposal.js';

function fail(reason:string):never{throw new FeeEnvelopeError(reason);}
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
function fields(v:unknown,keys:string):asserts v is Record<string,any>{const k=keys.split(' ');if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==k.length||k.some(x=>!Object.hasOwn(v,x)))fail('FIELDS');}
function id(v:unknown):asserts v is string{if(typeof v!=='string'||!v.trim()||Array.from(v).length>200||['__proto__','constructor','prototype'].includes(v))fail('ID');}
function hash(v:unknown):asserts v is string{if(typeof v!=='string'||!/^[0-9a-f]{64}$/.test(v))fail('HASH');}
function list(v:unknown,max:number):asserts v is unknown[]{if(!Array.isArray(v)||v.length>max)fail('LIMIT');}
function version(v:Record<string,any>,kind:string){if(v.kind!==kind||v.version!=='1.0')fail('VERSION');}
function origin(v:unknown){if(v!=='NEW_DECLARED'&&v!=='UNKNOWN_IMPORTED')fail('ORIGIN');}
function ledgerShape(v:unknown):asserts v is FeeEnvelopeLedger{
 fields(v,'kind version business_id history_origin genesis_ref receipt_refs retired_cost_ids');version(v,'INTERNAL_FEE_APPLICATION_LEDGER');id(v.business_id);origin(v.history_origin);hash(v.genesis_ref);list(v.receipt_refs,64);v.receipt_refs.forEach(hash);list(v.retired_cost_ids,3200);v.retired_cost_ids.forEach(id);
 if(new Set(v.receipt_refs).size!==v.receipt_refs.length||new Set(v.retired_cost_ids).size!==v.retired_cost_ids.length)fail('DUPLICATE_LEDGER_ID');
}
function rowShape(rows:unknown):asserts rows is FeeEnvelopeRow[]{
 list(rows,50);if(!rows.length)fail('EMPTY_ROWS');const sources=new Set(),targets=new Set();
 for(const r of rows){fields(r,'mapping_id bill_id line_id cost_id operation');for(const k of ['mapping_id','bill_id','line_id','cost_id'])id(r[k]);if(!['CREATE_NEW','REFERENCE_EXISTING'].includes(r.operation))fail('OPERATION');const key=canonical([r.bill_id,r.line_id]);if(sources.has(key)||targets.has(r.cost_id))fail('DUPLICATE_BATCH');sources.add(key);targets.add(r.cost_id);}
}
const sourceSlots=['project_json','bill_json','pair_json','attachment_json','precision_json'] as const;
async function sources(v:unknown){
 fields(v,sourceSlots.join(' '));const s=v as FeeEnvelopeSources;
 json(s.project_json,10*1024*1024);const project=parseProject(s.project_json);json(s.bill_json,5*1024*1024);const bill=parseContainerBillDraft(s.bill_json);
 const pair=s.pair_json===null?null:(json(s.pair_json,10*1024*1024),parseContainerCostPair(s.pair_json));
 const attachment=s.attachment_json===null?null:await parseFeeTaxAttachment(s.attachment_json);
 const precision=s.precision_json===null?null:await parseFeePrecisionSelection(s.precision_json);
 return{sources:s,project,bill,pair,attachment,precision};
}
type Role='PROJECT'|'BILL'|'PAIR'|'ATTACHMENT'|'PRECISION'|'PAYLOAD'|'LEDGER'|'PLAN'|'RECEIPT';
const roleBytes:Record<Role,number>={PROJECT:10,BILL:5,PAIR:10,ATTACHMENT:24,PRECISION:64,PAYLOAD:32,LEDGER:5,PLAN:1,RECEIPT:1};
async function validateDetached(value:unknown){
 fields(value,'kind version envelope_id business_id revision history_origin current_sources ledger_json archives content_sha256');version(value,'INTERNAL_FEE_APPLICATION_ENVELOPE');id(value.envelope_id);id(value.business_id);origin(value.history_origin);
 if(!Number.isSafeInteger(value.revision)||value.revision<1||value.revision>1000000000)fail('REVISION');hash(value.content_sha256);list(value.archives,512);
 const a=value as FeeEnvelope,ledger=json(a.ledger_json,5*1024*1024);ledgerShape(ledger);
 if(ledger.business_id!==a.business_id||ledger.history_origin!==a.history_origin)fail('LEDGER_IDENTITY');
 if(a.revision<ledger.receipt_refs.length+1)fail('REVISION_BEHIND_HISTORY');
 if(a.history_origin==='UNKNOWN_IMPORTED'&&ledger.receipt_refs.length)fail('UNKNOWN_HISTORY_WITH_RECEIPTS');
 const raw=new Map<string,string>();for(const b of a.archives){fields(b,'sha256 raw_json');hash(b.sha256);if(typeof b.raw_json!=='string'||raw.has(b.sha256))fail('DUPLICATE_ARCHIVE');if(await sha(b.raw_json)!==b.sha256)fail('ARCHIVE_DIGEST');raw.set(b.sha256,b.raw_json);}
 const nodes=new Map<string,any>(),roles=new Map<string,Role>(),heights=new Map<string,number>(),visiting=new Set<string>();
 async function visit(ref:string,role:Role):Promise<number>{
  hash(ref);if(visiting.has(ref))fail('ARCHIVE_CYCLE');if(roles.has(ref)&&roles.get(ref)!==role)fail('ARCHIVE_ROLE');if(heights.has(ref))return heights.get(ref)!;
  const text=raw.get(ref);if(text===undefined)fail('ARCHIVE_MISSING');const v=json(text,roleBytes[role]*1024*1024);roles.set(ref,role);visiting.add(ref);nodes.set(ref,v);const edges:[string,Role][]=[];
  switch(role){
   case'PROJECT':parseProject(text);break;
   case'BILL':parseContainerBillDraft(text);break;
   case'PAIR':parseContainerCostPair(text);break;
   case'ATTACHMENT':await parseFeeTaxAttachment(text);break;
   case'PRECISION':await parseFeePrecisionSelection(text);break;
   case'PAYLOAD':fields(v,'kind version project_json bill_json');version(v,'INTERNAL_FEE_APPLICATION_PAYLOAD');await sources({project_json:v.project_json,bill_json:v.bill_json,pair_json:null,attachment_json:null,precision_json:null});break;
   case'LEDGER':ledgerShape(v);if(v.business_id!==a.business_id||v.history_origin!==a.history_origin)fail('ARCHIVED_LEDGER_IDENTITY');edges.push([v.genesis_ref,'PAYLOAD'],...v.receipt_refs.map(r=>[r,'RECEIPT'] as [string,Role]));break;
   case'PLAN':{
    fields(v,'kind version business_id transaction_id sources before_payload_ref before_ledger_ref rows');version(v,'INTERNAL_FEE_APPLICATION_PLAN');id(v.business_id);id(v.transaction_id);rowShape(v.rows);fields(v.sources,'project_ref bill_ref pair_ref attachment_ref precision_ref');
    for(const k of Object.keys(v.sources))hash(v.sources[k]);hash(v.before_payload_ref);hash(v.before_ledger_ref);
    edges.push([v.sources.project_ref,'PROJECT'],[v.sources.bill_ref,'BILL'],[v.sources.pair_ref,'PAIR'],[v.sources.attachment_ref,'ATTACHMENT'],[v.sources.precision_ref,'PRECISION'],[v.before_payload_ref,'PAYLOAD'],[v.before_ledger_ref,'LEDGER']);break;
   }
   case'RECEIPT':{
    fields(v,'kind version business_id transaction_id sequence previous_sha256 plan_ref before_payload_ref after_payload_ref before_ledger_ref rows entry_sha256');version(v,'INTERNAL_FEE_APPLICATION_RECEIPT');id(v.business_id);id(v.transaction_id);rowShape(v.rows);if(!Number.isSafeInteger(v.sequence)||v.sequence<1||v.sequence>64)fail('SEQUENCE');
    for(const k of ['previous_sha256','plan_ref','before_payload_ref','after_payload_ref','before_ledger_ref','entry_sha256'])hash(v[k]);
    const {entry_sha256:expected,...body}=v;if(await sha(canonical(body))!==expected)fail('ENTRY_DIGEST');
    edges.push([v.plan_ref,'PLAN'],[v.before_payload_ref,'PAYLOAD'],[v.after_payload_ref,'PAYLOAD'],[v.before_ledger_ref,'LEDGER']);break;
   }
  }
  let height=0;for(const [to,kind]of edges)height=Math.max(height,1+await visit(to,kind));if(height>32)fail('ARCHIVE_DEPTH');visiting.delete(ref);heights.set(ref,height);return height;
 }
 await visit(ledger.genesis_ref,'PAYLOAD');for(const ref of ledger.receipt_refs)await visit(ref,'RECEIPT');
 if(nodes.size!==raw.size)fail('UNREACHABLE_ARCHIVE');
 const consumed=new Map<string,{transaction_id:string;cost_id:string}>(),created=new Set<string>(),transactions=new Set<string>(),receipts:FeeEnvelopeReceipt[]=[];let retired:string[]=[];
 for(const [index,ref]of ledger.receipt_refs.entries()){
  const receipt=nodes.get(ref) as FeeEnvelopeReceipt,plan=nodes.get(receipt.plan_ref) as FeeEnvelopePlan,beforeLedger=nodes.get(receipt.before_ledger_ref) as FeeEnvelopeLedger;
  if(receipt.business_id!==a.business_id||plan.business_id!==a.business_id||receipt.transaction_id!==plan.transaction_id)fail('RECEIPT_IDENTITY');
  if(transactions.has(receipt.transaction_id))fail('TRANSACTION_ID_REUSED');transactions.add(receipt.transaction_id);
  if(receipt.sequence!==index+1||receipt.previous_sha256!==(index?ledger.receipt_refs[index-1]:ledger.genesis_ref))fail('HISTORY_CHAIN');
  if(plan.before_payload_ref!==receipt.before_payload_ref||plan.before_ledger_ref!==receipt.before_ledger_ref||!same(plan.rows,receipt.rows))fail('PLAN_RECEIPT_MISMATCH');
  if(beforeLedger.genesis_ref!==ledger.genesis_ref||!same(beforeLedger.receipt_refs,ledger.receipt_refs.slice(0,index))||retired.some(id=>!beforeLedger.retired_cost_ids.includes(id))||beforeLedger.retired_cost_ids.some(id=>!ledger.retired_cost_ids.includes(id)))fail('BEFORE_LEDGER_MISMATCH');retired=beforeLedger.retired_cost_ids;
  const before=nodes.get(receipt.before_payload_ref) as FeeEnvelopePayload,after=nodes.get(receipt.after_payload_ref) as FeeEnvelopePayload;
  if(raw.get(plan.sources.project_ref)!==before.project_json||raw.get(plan.sources.bill_ref)!==before.bill_json)fail('BEFORE_SOURCE_MISMATCH');
  const pairText=raw.get(plan.sources.pair_ref)!,attachmentText=raw.get(plan.sources.attachment_ref)!,precisionText=raw.get(plan.sources.precision_ref)!;
  const audit=await proposeFeeApplication({project_json:before.project_json,bill_json:before.bill_json,pair_json:pairText,attachment_json:attachmentText,precision_json:precisionText,history_json:null});
  const descriptive=new Set(['NO_FEE_APPLICATION','NO_GLOBAL_DUPLICATE_PROOF','BUSINESS_IDENTITY_NOT_ESTABLISHED','HISTORY_NOT_ESTABLISHED']);
  if(audit.issues.some(c=>!descriptive.has(c))||audit.rows.some(r=>r.blockers.length)||!same(plan.rows,audit.rows.map(r=>r.mapping)))fail('HISTORICAL_SOURCE_REVIEW');
  const project=parseProject(before.project_json),expected:ProjectFile=structuredClone(json(before.project_json,10*1024*1024) as ProjectFile),pair=parseContainerCostPair(pairText);
  for(const row of receipt.rows){
   const key=canonical([a.business_id,row.bill_id,row.line_id]);
   if(row.operation==='CREATE_NEW'){
    if(consumed.has(key)||created.has(row.cost_id)||beforeLedger.retired_cost_ids.includes(row.cost_id))fail('HISTORY_DUPLICATE_SOURCE_OR_TARGET');
    const intent=pair.selection.intents.find(r=>r.line_id===row.line_id);if(intent?.operation!=='CREATE_NEW')fail('PLAN_INTENT');expected.items.push(structuredClone(intent.new_cost));consumed.set(key,{transaction_id:receipt.transaction_id,cost_id:row.cost_id});created.add(row.cost_id);
   }else if(!project.items.some(c=>c.cost_id===row.cost_id))fail('REFERENCE_TARGET_MISSING');
  }
  parseProject(after.project_json);if(after.bill_json!==before.bill_json||!same(json(after.project_json,10*1024*1024),expected))fail('AFTER_PAYLOAD_MISMATCH');
  const decisions=resolveResponsibility({trade:costsForTerm(toTrade(expected),expected.incoterm).trade,scenario:toScenario(expected),ruleSet:INCOTERMS_2020_RULESET});
  for(const row of receipt.rows){const cost=expected.items.find(c=>c.cost_id===row.cost_id),decision=decisions.find(d=>d.cost_id===row.cost_id);if(!cost||!decision||decision.responsibility!==cost.responsibility)fail('EFFECTIVE_RESPONSIBILITY_MISMATCH');if(decision.payment_party!==null&&decision.payment_party!==cost.payment_party||decision.economic_bearer!==null&&decision.economic_bearer!==cost.economic_bearer)fail('EFFECTIVE_PARTIES_MISMATCH');}
  receipts.push(receipt);
 }
 const {content_sha256:expected,...body}=a;if(await sha(canonical(body))!==expected)fail('CONTENT_DIGEST');
 if(new TextEncoder().encode(JSON.stringify(a,null,2)+'\n').length>FEE_ENVELOPE_BYTES)fail('UTF8_SIZE');
 const current=await sources(a.current_sources);
 return{envelope:a,ledger,current,consumed,created,receipts,nodes,raw};
}
export async function parseFeeEnvelope(text:unknown):Promise<FeeEnvelope>{return(await validateDetached(json(text))).envelope;}
export async function validateFeeEnvelope(value:unknown):Promise<FeeEnvelope>{return(await validateDetached(copy(value))).envelope;}
export async function serializeFeeEnvelope(value:unknown):Promise<string>{return JSON.stringify(await validateFeeEnvelope(value),null,2)+'\n';}
async function seal(a:FeeEnvelope){const {content_sha256:_,...body}=a;a.content_sha256=await sha(canonical(body));return(await validateDetached(a)).envelope;}
async function candidate(s:FeeEnvelopeSources,history_origin:FeeEnvelope['history_origin']){
 const payload:FeeEnvelopePayload={kind:'INTERNAL_FEE_APPLICATION_PAYLOAD',version:'1.0',project_json:s.project_json,bill_json:s.bill_json},raw_json=JSON.stringify(payload),genesis_ref=await sha(raw_json),business_id='business-'+crypto.randomUUID();
 const ledger:FeeEnvelopeLedger={kind:'INTERNAL_FEE_APPLICATION_LEDGER',version:'1.0',business_id,history_origin,genesis_ref,receipt_refs:[],retired_cost_ids:[]};
 return seal({kind:'INTERNAL_FEE_APPLICATION_ENVELOPE',version:'1.0',envelope_id:'envelope-'+crypto.randomUUID(),business_id,revision:1,history_origin,current_sources:s,ledger_json:JSON.stringify(ledger),archives:[{sha256:genesis_ref,raw_json}],content_sha256:''});
}
/** Explicit legacy adoption candidate. Empty known history is never inferred. */
export async function adoptLegacyFeeEnvelope(value:unknown){const s=copy(value);const verified=await sources(s);return candidate(verified.sources,'UNKNOWN_IMPORTED');}
/** Explicit independent business candidate; real order uniqueness remains unverifiable. */
export async function createNewFeeEnvelopeFromPair(pair_json:string,name:string,metadata_time:string){
 json(pair_json,10*1024*1024);const original=parseContainerCostPair(pair_json),pair=copyContainerBusiness(original,original.content_key,name,metadata_time),text=serializeContainerCostPair(pair);
 const attachment=await createFeeTaxAttachment(text),attachmentText=await serializeFeeTaxAttachment(attachment),precision=await createFeePrecisionSelection(text,attachmentText);
 return candidate({project_json:serializeProject(pair.project),bill_json:serializeContainerBillDraft(pair.bill),pair_json:text,attachment_json:attachmentText,precision_json:await serializeFeePrecisionSelection(precision)},'NEW_DECLARED');
}
async function leased(value:unknown,lease:unknown){const snapshot=copy(value),l=copy(lease);fields(l,'envelope_id business_id revision content_sha256');const s=await validateDetached(snapshot);if(!same(l,{envelope_id:s.envelope.envelope_id,business_id:s.envelope.business_id,revision:s.envelope.revision,content_sha256:s.envelope.content_sha256}))fail('STALE_LEASE');return s;}
/** Updates source snapshots only, retaining every historical byte and identity. */
export async function updateFeeEnvelopeSources(value:unknown,lease:FeeEnvelopeLease,input:unknown){const captured=copy(input),s=await leased(value,lease),next=await sources(captured),a=s.envelope;if(same(a.current_sources,next.sources))return a;if(a.revision===1000000000)fail('REVISION_LIMIT');a.current_sources=next.sources;a.revision++;return seal(a);}
export async function copyFeeEnvelopeForNewBusiness(value:unknown,lease:FeeEnvelopeLease,name:string,metadata_time:string){const s=await leased(value,lease);if(!s.current.pair||!s.current.sources.pair_json||reviewContainerCostPair(s.current.pair,s.current.project,s.current.bill).issues.length)fail('CURRENT_PAIR_REQUIRED');return createNewFeeEnvelopeFromPair(s.current.sources.pair_json,name,metadata_time);}
export async function reviewFeeEnvelope(value:unknown){
 const s=await validateDetached(copy(value)),{envelope:a,current:c,ledger}=s,issues=['NO_FEE_APPLICATION','NO_GLOBAL_DUPLICATE_PROOF'];
 if(a.history_origin==='UNKNOWN_IMPORTED')issues.push('HISTORY_NOT_ESTABLISHED');
 const pair=c.pair?reviewContainerCostPair(c.pair,c.project,c.bill):null;if(!pair)issues.push('CURRENT_PAIR_MISSING');else issues.push(...pair.issues);
 const attachment=c.attachment&&c.sources.pair_json?await reviewFeeTaxAttachment(c.attachment,c.sources.pair_json):null;if(!attachment)issues.push('CURRENT_ATTACHMENT_OR_PAIR_MISSING');else if(!attachment.pair_is_current)issues.push('CURRENT_ATTACHMENT_PAIR_MISMATCH');
 const precision=c.precision&&c.sources.pair_json&&c.sources.attachment_json?await reviewFeePrecisionSelection(c.precision,c.sources.pair_json,c.sources.attachment_json):null;if(!precision)issues.push('CURRENT_PRECISION_OR_SOURCES_MISSING');else if(Object.values(precision.source_status).some(v=>!v))issues.push('CURRENT_PRECISION_SOURCE_MISMATCH');
 const last=ledger.receipt_refs.at(-1),payload=s.nodes.get(last?s.receipts.at(-1)!.after_payload_ref:ledger.genesis_ref) as FeeEnvelopePayload;
 const payload_is_current=payload.project_json===a.current_sources.project_json&&payload.bill_json===a.current_sources.bill_json;if(!payload_is_current)issues.push('HISTORICAL_PAYLOAD_DIFFERS_FROM_CURRENT');
 return{scope:'READ_ONLY_FEE_ENVELOPE' as const,financial_writes:0 as const,history_status:a.history_origin==='NEW_DECLARED'?'STRUCTURALLY_CHECKED_LOCAL_LINEAGE' as const:'NOT_ESTABLISHED' as const,issues,payload_is_current,ledger:structuredClone(ledger),consumed:[...s.consumed.entries()].map(([key,entry])=>({key,...entry})),receipts:structuredClone(s.receipts),reviews:{pair,attachment,precision}};
}
export async function inspectFeeEnvelopeConsumption(value:unknown,input:unknown){const request=copy(input);fields(request,'bill_id line_id');id(request.bill_id);id(request.line_id);const s=await validateDetached(copy(value)),match=s.consumed.get(canonical([s.envelope.business_id,request.bill_id,request.line_id]));return{scope:'READ_ONLY_CONSUMPTION_LOOKUP' as const,status:s.envelope.history_origin==='UNKNOWN_IMPORTED'?'UNKNOWN' as const:match?'RECORDED_IN_THIS_LINEAGE' as const:'NOT_RECORDED_IN_THIS_LINEAGE' as const,record:match?structuredClone(match):null,financial_writes:0 as const};}
/** Compare detached raw files; never installs, merges or replays the candidate. */
export async function compareFeeEnvelopeRecovery(current_json:string|null,incoming_json:string){
 const incomingSnapshot=incoming_json,currentSnapshot=current_json,incoming=await validateDetached(json(incomingSnapshot)),current=currentSnapshot===null?null:await validateDetached(json(currentSnapshot));
 let status:string;
 if(incoming.envelope.history_origin==='UNKNOWN_IMPORTED')status='INCOMING_HISTORY_UNKNOWN';
 else if(!current)status='PREVIEW_LATEST_UNVERIFIABLE';
 else if(current.envelope.history_origin==='UNKNOWN_IMPORTED')status='CURRENT_HISTORY_REQUIRES_REVIEW';
 else if(current.envelope.business_id!==incoming.envelope.business_id||current.envelope.envelope_id!==incoming.envelope.envelope_id)status='SEPARATE_BUSINESS_PREVIEW';
 else if(same(current.envelope,incoming.envelope))status='NO_CHANGE';
 else if(incoming.envelope.revision<current.envelope.revision)status='OLDER_REVISION_CONFLICT';
 else if(current.ledger.genesis_ref!==incoming.ledger.genesis_ref||current.ledger.receipt_refs.some((ref,i)=>incoming.ledger.receipt_refs[i]!==ref)||current.ledger.retired_cost_ids.some(id=>!incoming.ledger.retired_cost_ids.includes(id)))status='HISTORY_FORK_CONFLICT';
 else status=current.envelope.revision===incoming.envelope.revision?'SAME_REVISION_CONFLICT':'DESCENDANT_PREVIEW_EXPLICIT_ADOPTION';
 return{status,install:false as const,financial_writes:0 as const,latest_proven:false as const,current_json:currentSnapshot,incoming_json:incomingSnapshot,current_sha256:currentSnapshot===null?null:await sha(currentSnapshot),incoming_sha256:await sha(incomingSnapshot)};
}
