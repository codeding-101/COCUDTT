// Synthetic untrusted files, not a production transaction/receipt writer.
import{createHash}from'node:crypto';
import{completePair,source,lease as taxLease}from'./fee-tax-attachment';
import{createContainerCostPair,serializeContainerCostPair,enableContainerCostReview}from'../../src/data/container-cost-pair';
import{confirmContainerCostIntent}from'../../src/engine/container-cost-proposal';
import{confirmContainerBillCostReference}from'../../src/engine/container-bill-draft';
import{serializeProject}from'../../src/data/project-file';
import{serializeContainerBillDraft}from'../../src/data/container-bill-file';
import{createFeeTaxAttachment,setFeeTaxAttachmentRecord,acknowledgeFeeTaxAttachmentRecord,serializeFeeTaxAttachment}from'../../src/data/fee-tax-attachment';
import{createFeePrecisionSelection,addFeePrecisionSelectionRecord,acknowledgeFeePrecisionSelectionRecord,serializeFeePrecisionSelection}from'../../src/data/fee-precision-selection';
import type{FeeEnvelope,FeeEnvelopeSources,FeeEnvelopePayload,FeeEnvelopePlan,FeeEnvelopeReceipt,FeeEnvelopeLedger}from'../../src/domain/fee-envelope';
export const stable=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export const seal=(a:FeeEnvelope)=>{const{content_sha256:_,...body}=a;a.content_sha256=hash(stable(body));return a;};
export const entrySeal=(r:FeeEnvelopeReceipt)=>{const{entry_sha256:_,...body}=r;r.entry_sha256=hash(stable(body));return r;};
export const lease=(a:FeeEnvelope)=>({envelope_id:a.envelope_id,business_id:a.business_id,revision:a.revision,content_sha256:a.content_sha256});
export async function fullSources(amount='113',version:'1.0'|'1.1'='1.0',reference=false,node:'IMPORT_CLEARANCE'|'SELLER_PREMISES'='IMPORT_CLEARANCE'){
 let s=completePair(amount,version);
 const original=s.pair.selection.intents[0]!;if(original.operation!=='CREATE_NEW')throw Error();original.new_cost.trade_node=node;const{provenance:_,...evidence}=source(),confirmed=confirmContainerCostIntent(s.pair.project,s.pair.bill,original,{...evidence,status:'UNVERIFIED'});let prepared=createContainerCostPair(s.pair.project,s.pair.bill,{version:'0.1',intents:[confirmed]});if(version==='1.1')prepared=enableContainerCostReview(prepared,prepared.content_key);s={...s,pair:prepared,raw:serializeContainerCostPair(prepared),record:{...s.record,target:{...prepared.mapping.entries[0]!}}};
 if(reference){const intent=s.pair.selection.intents[0]!;if(intent.operation!=='CREATE_NEW')throw Error();s.pair.project.items.push(structuredClone(intent.new_cost));s.pair.bill.rows[0]!.cost_reference={cost_id:intent.new_cost.cost_id,note:'合成只读引用'};const{provenance:_,...evidence}=source(),bill=confirmContainerBillCostReference(s.pair.bill,intent.line_id,s.pair.project,{...evidence,status:'UNVERIFIED'}),pair=createContainerCostPair(s.pair.project,bill,{version:'0.1',intents:[{operation:'REFERENCE_EXISTING',line_id:intent.line_id,cost_id:intent.new_cost.cost_id,note:'只引用已有费用'}]});s={...s,pair,raw:serializeContainerCostPair(pair),record:{...s.record,target:{...pair.mapping.entries[0]!}}};}
 let attachment=await createFeeTaxAttachment(s.raw);attachment=await setFeeTaxAttachmentRecord(attachment,taxLease(attachment),s.record);
 for(const facet of['tax','credit','customs']as const)attachment=await acknowledgeFeeTaxAttachmentRecord(attachment,taxLease(attachment),s.raw,attachment.records[0]!.record_id,facet);
 const attachmentText=await serializeFeeTaxAttachment(attachment);let precision=await createFeePrecisionSelection(s.raw,attachmentText);
 const precisionLease=()=>({revision:precision.revision,content_sha256:precision.content_sha256});
 precision=await addFeePrecisionSelectionRecord(precision,precisionLease(),{component_record_id:attachment.records[0]!.record_id,channel:'cash',choice:{kind:'ROUND',policy:{kind:'EXPLICIT',unit:'0.01',mode:'HALF_UP',basis:'合成原额未改变'}}});
 precision=await acknowledgeFeePrecisionSelectionRecord(precision,precisionLease(),s.raw,attachmentText,precision.records[0]!.record_id);
 const sources:FeeEnvelopeSources={project_json:serializeProject(s.pair.project),bill_json:serializeContainerBillDraft(s.pair.bill),pair_json:s.raw,attachment_json:attachmentText,precision_json:await serializeFeePrecisionSelection(precision)};
 return{...s,sources};
}
export function empty(sources:FeeEnvelopeSources,origin:FeeEnvelope['history_origin']='NEW_DECLARED'){
 const a:FeeEnvelope={kind:'INTERNAL_FEE_APPLICATION_ENVELOPE',version:'1.0',envelope_id:'synthetic-envelope',business_id:'synthetic-business',revision:1,history_origin:origin,current_sources:structuredClone(sources),ledger_json:'',archives:[],content_sha256:''};
 const archive=(v:unknown)=>{const raw_json=typeof v==='string'?v:JSON.stringify(v),sha256=hash(raw_json);if(!a.archives.some(b=>b.sha256===sha256))a.archives.push({sha256,raw_json});return sha256;};
 const payload:FeeEnvelopePayload={kind:'INTERNAL_FEE_APPLICATION_PAYLOAD',version:'1.0',project_json:sources.project_json,bill_json:sources.bill_json},genesis_ref=archive(payload);
 const ledger:FeeEnvelopeLedger={kind:'INTERNAL_FEE_APPLICATION_LEDGER',version:'1.0',business_id:a.business_id,history_origin:origin,genesis_ref,receipt_refs:[],retired_cost_ids:[]};a.ledger_json=JSON.stringify(ledger);seal(a);return{a,archive,payload,ledger};
}
export async function historical(version:'1.0'|'1.1'='1.0',reference=false,node:'IMPORT_CLEARANCE'|'SELLER_PREMISES'='IMPORT_CLEARANCE'){
 const s=await fullSources('113',version,reference,node),{a,archive,payload,ledger}=empty(s.sources);
 const before_ledger_ref=archive(a.ledger_json),before_payload_ref=ledger.genesis_ref;
 const plan:FeeEnvelopePlan={kind:'INTERNAL_FEE_APPLICATION_PLAN',version:'1.0',business_id:a.business_id,transaction_id:'synthetic-transaction',sources:{project_ref:archive(s.sources.project_json),bill_ref:archive(s.sources.bill_json),pair_ref:archive(s.sources.pair_json!),attachment_ref:archive(s.sources.attachment_json!),precision_ref:archive(s.sources.precision_json!)},before_payload_ref,before_ledger_ref,rows:structuredClone(s.pair.mapping.entries)};
 const project=structuredClone(s.pair.project),intent=s.pair.selection.intents[0]!;if(intent.operation==='CREATE_NEW')project.items.push(structuredClone(intent.new_cost));
 const after:FeeEnvelopePayload={...payload,project_json:serializeProject(project)},after_payload_ref=archive(after);
 const receipt=entrySeal({kind:'INTERNAL_FEE_APPLICATION_RECEIPT',version:'1.0',business_id:a.business_id,transaction_id:plan.transaction_id,sequence:1,previous_sha256:ledger.genesis_ref,plan_ref:archive(plan),before_payload_ref,after_payload_ref,before_ledger_ref,rows:structuredClone(plan.rows),entry_sha256:''});
 const receipt_ref=archive(receipt);ledger.receipt_refs.push(receipt_ref);a.ledger_json=JSON.stringify(ledger);a.current_sources.project_json=after.project_json;a.revision=2;seal(a);
 return{...s,a,archive,ledger,plan,receipt,receipt_ref,after,payload,after_payload_ref};
}
/** Re-address an immutable fixture blob and all references, without production APIs. */
export function replaceBlob(a:FeeEnvelope,old:string,raw_json:string){
 const replacements=new Map([[old,hash(raw_json)]]);let blobs=a.archives.map(b=>b.sha256===old?{raw_json,sha256:hash(raw_json)}:{...b});
 for(let changed=true;changed;){changed=false;blobs=blobs.map(b=>{let text=b.raw_json;for(const[from,to]of replacements)text=text.replaceAll(from,to);if(text!==b.raw_json){const v=JSON.parse(text);if(v.kind==='INTERNAL_FEE_APPLICATION_RECEIPT')text=JSON.stringify(entrySeal(v));const sha256=hash(text);replacements.set(b.sha256,sha256);changed=true;return{raw_json:text,sha256};}return b;});}
 a.archives=blobs;for(const[from,to]of replacements)a.ledger_json=a.ledger_json.replaceAll(from,to);return seal(a);
}
