/** Local internal handoff format. Integrity and readonly inspection never grant installation, fee or customer authority. */
import {parseFeeEnvelopeJson as json,canonicalFeeEnvelopeJson as canonical,feeEnvelopeSha256 as sha,copyFeeEnvelopeJson as copy} from '../src/data/fee-envelope-json';
import {parseFeeEnvelope,serializeFeeEnvelope,updateFeeEnvelopeSources,reviewFeeEnvelope} from '../src/data/fee-envelope';
import type {FeeEnvelope,FeeEnvelopeSources} from '../src/domain/fee-envelope';
import {parseProject} from '../src/data/project-file';
import {FeeRecoveryFormat} from './fee-recovery-format';
import {recoveredHandoffFile,type RecoveredHandoffFile} from './fee-recovery-business-files';
import {assertReconcileHistoryBudget,RECONCILE_SLOTS,type ReconcileRecord} from './fee-recovery-reconcile';
import {calculateRecoveredTrade} from './fee-recovery-trade';
import {freezeRecoveryData} from './fee-recovery-supplement';

export const RECOVERED_PACKAGE_LIMITS=Object.freeze({file_bytes:64*1024*1024,backup_raw_bytes:256*1024*1024,files:6,source_updates:64});
const names=['recovered-project.json','recovered-envelope.json','original-recovery.json','new-application-backup.json','internal-handoff-manifest.json','source-update-audit.json'];
type Data=Record<string,unknown>;
export class RecoveryPackageError extends Error{constructor(readonly code:string){super('RECOVERED_PACKAGE_'+code);this.name='RecoveryPackageError';}}
function fail(code:string):never{throw new RecoveryPackageError(code);}
function record(v:unknown):Data{if(!v||typeof v!=='object'||Array.isArray(v))fail('SHAPE');return v as Data;}
function fields(v:unknown,keys:string):Data{const d=record(v),list=keys.split(' ');if(Object.keys(d).length!==list.length||list.some(k=>!Object.hasOwn(d,k)))fail('FIELDS');return d;}
const utf8=(s:string)=>new TextEncoder().encode(s).length;
const lease=(e:FeeEnvelope)=>({envelope_id:e.envelope_id,business_id:e.business_id,revision:e.revision,content_sha256:e.content_sha256});
function falseFields(v:Data,keys:string){if(keys.split(' ').some(k=>v[k]!==false))fail('AUTHORITY');}
/** Exact compact JSON string-token size, without constructing a potentially over-budget escaped string. */
export function recoveredPackageTextTokenBytes(text:string){let n=utf8(text)+2;for(const c of text){const k=c.charCodeAt(0);if(c==='"'||c==='\\'||k<32)n+=k<32&&![8,9,10,12,13].includes(k)?5:1;else if(c.length===1&&k>=0xd800&&k<=0xdfff)n+=3;}return n;}

export interface RecoveredPackageReview{
  readonly scope:'READ_ONLY_RECOVERED_PACKAGE';readonly version:'0.1';readonly files:readonly {name:string;bytes:number;sha256:string}[];
  readonly source_updates:number;readonly new_fee_applications:number;readonly historical_receipts:number;readonly retired_cost_ids:number;
  readonly project_name:string;readonly base_currency:string;readonly seller_profit:string|null;readonly buyer_total:string;readonly unresolved_issues:readonly string[];
  readonly original_source_sha256:string;readonly original_supplement_sha256:string;readonly original_drafts_present:boolean;
  readonly financial_writes:0;readonly import_authority:false;readonly confirmation_authority:false;readonly customer_reviewed:false;readonly full_live_workbench_reopen:false;
}
export interface ParsedRecoveredPackage{readonly review:RecoveredPackageReview;readonly files:readonly RecoveredHandoffFile[]}

async function verifySourceRecord(value:unknown,index:number){
  const d=fields(value,'scope before_envelope_json after_envelope_json rows unresolved_issues source_updates financial_writes customer_approval');
  if(d.scope!=='RECOVERED_SOURCE_RECONCILIATION_APPLIED'||typeof d.before_envelope_json!=='string'||typeof d.after_envelope_json!=='string'||d.source_updates!==index+1||d.financial_writes!==0||d.customer_approval!==false)fail('SOURCE_RECORD');
  const before=await parseFeeEnvelope(d.before_envelope_json),after=await parseFeeEnvelope(d.after_envelope_json);
  if(before.envelope_id!==after.envelope_id||before.business_id!==after.business_id||before.history_origin!==after.history_origin||after.revision!==before.revision+1||before.ledger_json!==after.ledger_json||JSON.stringify(before.archives)!==JSON.stringify(after.archives))fail('SOURCE_HISTORY_CHANGED');
  const expected=await updateFeeEnvelopeSources(before,lease(before),after.current_sources);if(await serializeFeeEnvelope(expected)!==d.after_envelope_json)fail('SOURCE_EVENT');
  const rows=[];for(const slot of RECONCILE_SLOTS){const a=before.current_sources[slot],b=after.current_sources[slot];rows.push({slot,changed:a!==b,before_bytes:a===null?0:utf8(a),after_bytes:b===null?0:utf8(b),before_sha256:a===null?null:await sha(a),after_sha256:b===null?null:await sha(b)});}
  if(!rows.some(r=>r.changed)||JSON.stringify(d.rows)!==JSON.stringify(rows)||JSON.stringify(d.unresolved_issues)!==JSON.stringify((await reviewFeeEnvelope(after)).issues))fail('SOURCE_REVIEW_MISMATCH');
  return{before:d.before_envelope_json,after:d.after_envelope_json};
}

/** Bounded native gzip inspection of the EXISTING backup carrier, not an executable recovery mechanism. */
export async function inspectRecoveredApplicationBackup(raw:string):Promise<Data>{
  let value=record(json(raw,RECOVERED_PACKAGE_LIMITS.file_bytes));if(value.kind==='INTERNAL_RUNTIME_FEE_BACKUP_ARCHIVE'){
    fields(value,'kind version encoding raw_bytes data import_authority');
    if(value.version!=='0.1'||value.encoding!=='GZIP_BASE64_UTF8'||value.import_authority!==false||!Number.isSafeInteger(value.raw_bytes)||(value.raw_bytes as number)<1||(value.raw_bytes as number)>RECOVERED_PACKAGE_LIMITS.backup_raw_bytes||typeof value.data!=='string'||value.data.length>RECOVERED_PACKAGE_LIMITS.file_bytes||value.data.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.data))fail('BACKUP_ARCHIVE');
    const binary=atob(value.data);if(btoa(binary)!==value.data)fail('BACKUP_BASE64');if(typeof DecompressionStream!=='function')fail('GZIP_UNAVAILABLE');
    const input=Uint8Array.from(binary,c=>c.charCodeAt(0)),stream=new Blob([input]).stream().pipeThrough(new DecompressionStream('gzip')),reader=stream.getReader(),chunks:Uint8Array[]=[];let total=0,done=false;
    try{for(;;){const next=await reader.read();if(next.done){done=true;break;}total+=next.value.byteLength;if(total>(value.raw_bytes as number)||total>RECOVERED_PACKAGE_LIMITS.backup_raw_bytes)fail('BACKUP_EXPANSION');chunks.push(next.value);}if(total!==value.raw_bytes)fail('BACKUP_EXPANSION');const bytes=new Uint8Array(total);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}value=record(json(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),RECOVERED_PACKAGE_LIMITS.backup_raw_bytes));}
    finally{if(!done)await reader.cancel().catch(()=>{});reader.releaseLock();}
  }
  if(value.kind!=='INTERNAL_RUNTIME_FEE_APPLICATION_BACKUP'||value.version!=='0.1'||value.financial_writes!==1||value.import_authority!==false)fail('APPLICATION_BACKUP');return value;
}
async function applicationEvent(raw:string){
  const b=await inspectRecoveredApplicationBackup(raw),capture=record(b.capture),prepared=record(b.prepared_candidate),candidate=record(prepared.candidate),input=record(candidate.input),facts=record(b.application);
  if(typeof capture.envelope_json!=='string'||typeof input.envelope_json!=='string'||facts.scope!=='RUNTIME_FEE_WORKBENCH_APPLICATION'||typeof facts.transaction_id!=='string'||facts.receipts_added!==1)fail('APPLICATION_BINDING');
  const before=await parseFeeEnvelope(capture.envelope_json),after=await parseFeeEnvelope(input.envelope_json),bl=record(json(before.ledger_json)),al=record(json(after.ledger_json));
  if(!Array.isArray(bl.receipt_refs)||!Array.isArray(al.receipt_refs))fail('APPLICATION_LINEAGE');const beforeRefs=bl.receipt_refs,afterRefs=al.receipt_refs;
  if(before.envelope_id!==after.envelope_id||before.business_id!==after.business_id||before.history_origin!=='NEW_DECLARED'||after.history_origin!==before.history_origin||after.revision!==before.revision+1||JSON.stringify(al.retired_cost_ids)!==JSON.stringify(bl.retired_cost_ids)||afterRefs.length!==beforeRefs.length+1||beforeRefs.some((ref,i)=>ref!==afterRefs[i]))fail('APPLICATION_LINEAGE');
  if(JSON.stringify(capture.sources)!==JSON.stringify(before.current_sources)||RECONCILE_SLOTS.some(s=>s!=='project_json'&&after.current_sources[s]!==before.current_sources[s])||before.archives.some(a=>!after.archives.some(v=>v.sha256===a.sha256&&v.raw_json===a.raw_json)))fail('APPLICATION_SOURCE');
  const receiptRaw=after.archives.find(a=>a.sha256===(al.receipt_refs as unknown[]).at(-1))?.raw_json;if(!receiptRaw)fail('APPLICATION_BINDING');const receipt=record(json(receiptRaw)),rows=receipt.rows as {operation:string}[];
  if(receipt.transaction_id!==facts.transaction_id||after.archives.find(a=>a.sha256===receipt.before_ledger_ref)?.raw_json!==before.ledger_json||facts.costs_added!==rows.filter(r=>r.operation==='CREATE_NEW').length||facts.references_recorded!==rows.filter(r=>r.operation==='REFERENCE_EXISTING').length)fail('APPLICATION_BINDING');
  const metrics=(s:FeeEnvelopeSources)=>{const r=calculateRecoveredTrade(parseProject(s.project_json)).result;return{seller_profit:r.seller.margin?.toString()??null,buyer_total:r.buyer.landed_cost_with_tax.toString()};};
  if(JSON.stringify(facts.before)!==JSON.stringify(metrics(before.current_sources))||JSON.stringify(facts.after)!==JSON.stringify(metrics(after.current_sources))||facts.base_currency!==parseProject(after.current_sources.project_json).base_currency)fail('APPLICATION_SUMMARY');
  return{before:capture.envelope_json,after:input.envelope_json};
}

export async function parseRecoveredPackage(raw:string):Promise<ParsedRecoveredPackage>{
  const d=fields(json(raw,RECOVERED_PACKAGE_LIMITS.file_bytes),'kind version scope files source_updates new_fee_applications financial_writes import_authority confirmation_authority customer_document content_sha256');
  if(d.kind!=='INTERNAL_RECOVERED_BUSINESS_PACKAGE'||d.version!=='0.1'||d.scope!=='INTERNAL_HANDOFF_ONLY'||d.financial_writes!==0||!Number.isSafeInteger(d.source_updates)||(d.source_updates as number)<0||(d.source_updates as number)>64||![0,1].includes(d.new_fee_applications as number))fail('VERSION_OR_COUNTS');falseFields(d,'import_authority confirmation_authority customer_document');
  const{content_sha256:expected,...body}=d;if(typeof expected!=='string'||await sha(canonical(body))!==expected)fail('CONTENT_DIGEST');
  if(!Array.isArray(d.files)||d.files.length!==5+(d.new_fee_applications as number)||d.files.length>6)fail('FILE_SET');const files:RecoveredHandoffFile[]=[],byName=new Map<string,RecoveredHandoffFile>();
  for(const value of d.files){const f=fields(value,'name text mime bytes sha256');if(typeof f.name!=='string'||!names.includes(f.name)||byName.has(f.name)||typeof f.text!=='string'||f.mime!=='application/json'||typeof f.bytes!=='number'||f.bytes!==utf8(f.text)||f.bytes>RECOVERED_PACKAGE_LIMITS.file_bytes||await sha(f.text)!==f.sha256)fail('FILE_DIGEST_OR_NAME');const item=f as unknown as RecoveredHandoffFile;files.push(item);byName.set(item.name,item);}
  const get=(name:string)=>{const f=byName.get(name);if(!f)fail('FILE_SET');return f;};if(byName.has('new-application-backup.json')!==(d.new_fee_applications===1))fail('FILE_SET');
  const project=get('recovered-project.json'),envelope=get('recovered-envelope.json'),original=get('original-recovery.json'),manifest=get('internal-handoff-manifest.json'),audit=get('source-update-audit.json');
  const current=await parseFeeEnvelope(envelope.text),p=parseProject(project.text);if(current.current_sources.project_json!==project.text)fail('CURRENT_PROJECT_MISMATCH');
  const m=fields(json(manifest.text),'kind version original_captured_at files new_financial_writes pending_patch_replays import_authority customer_document');
  const originalFiles=files.filter(f=>!['internal-handoff-manifest.json','source-update-audit.json'].includes(f.name));
  if(m.kind!=='INTERNAL_RECOVERED_BUSINESS_HANDOFF'||m.version!=='0.1'||m.new_financial_writes!==d.new_fee_applications||m.pending_patch_replays!==0||m.import_authority!==false||m.customer_document!==false||JSON.stringify(m.files)!==JSON.stringify(originalFiles.map(({name,bytes,sha256})=>({name,bytes,sha256}))))fail('LEGACY_MANIFEST');
  const origin=await new FeeRecoveryFormat().decode(original.text,new AbortController().signal);if(m.original_captured_at!==origin.captured_at||origin.restoration.capture.envelope_json===null)fail('ORIGINAL_ARCHIVE_BINDING');
  const a=fields(json(audit.text,RECOVERED_PACKAGE_LIMITS.file_bytes),'kind version records financial_writes import_authority customer_approval');
  if(a.kind!=='INTERNAL_RECOVERED_SOURCE_AUDIT'||a.version!=='0.1'||a.financial_writes!==0||a.import_authority!==false||a.customer_approval!==false||!Array.isArray(a.records)||a.records.length!==d.source_updates)fail('SOURCE_AUDIT');assertReconcileHistoryBudget(a.records as ReconcileRecord[]);
  const events=[];for(let i=0;i<a.records.length;i++)events.push(await verifySourceRecord(a.records[i],i));const fee=d.new_fee_applications===1?await applicationEvent(get('new-application-backup.json').text):null;let cursor=origin.restoration.capture.envelope_json,feeUsed=false;
  const bridge=()=>{if(!fee||feeUsed||fee.before!==cursor)fail('SOURCE_CHAIN');cursor=fee.after;feeUsed=true;};
  for(const event of events){if(event.before!==cursor)bridge();if(event.before!==cursor)fail('SOURCE_CHAIN');cursor=event.after;}if(cursor!==envelope.text)bridge();if(cursor!==envelope.text||fee!==null&&!feeUsed)fail('SOURCE_CHAIN');
  const result=calculateRecoveredTrade(p).result,review=await reviewFeeEnvelope(current),ledger=record(json(current.ledger_json));
  return freezeRecoveryData({files,review:{scope:'READ_ONLY_RECOVERED_PACKAGE',version:'0.1',files:files.map(({name,bytes,sha256})=>({name,bytes,sha256})),source_updates:d.source_updates as number,new_fee_applications:d.new_fee_applications as number,historical_receipts:(ledger.receipt_refs as unknown[]).length,retired_cost_ids:(ledger.retired_cost_ids as unknown[]).length,project_name:p.name,base_currency:p.base_currency,seller_profit:result.seller.margin?.toString()??null,buyer_total:result.buyer.landed_cost_with_tax.toString(),unresolved_issues:[...review.issues],original_source_sha256:await sha(origin.source_wire),original_supplement_sha256:await sha(origin.supplement_json),original_drafts_present:origin.supplement.pending_present||Object.values(origin.restoration.capture.editors).some(v=>v!==null),financial_writes:0,import_authority:false,confirmation_authority:false,customer_reviewed:false,full_live_workbench_reopen:false}});
}

export async function createRecoveredPackage(existingFiles:readonly RecoveredHandoffFile[],records:readonly ReconcileRecord[]):Promise<RecoveredHandoffFile>{
  const files=copy(existingFiles) as RecoveredHandoffFile[],history=copy(records) as ReconcileRecord[];assertReconcileHistoryBudget(history);if(files.some(f=>f.name==='source-update-audit.json'))fail('FILE_SET');
  const audit=JSON.stringify({kind:'INTERNAL_RECOVERED_SOURCE_AUDIT',version:'0.1',records:history,financial_writes:0,import_authority:false,customer_approval:false});files.push(await recoveredHandoffFile('source-update-audit.json',audit));
  const manifest=files.find(f=>f.name==='internal-handoff-manifest.json');if(!manifest)fail('FILE_SET');const m=record(json(manifest.text)),count=m.new_financial_writes;if(count!==0&&count!==1)fail('APPLICATION_COUNT_UNSUPPORTED');
  const body={kind:'INTERNAL_RECOVERED_BUSINESS_PACKAGE',version:'0.1',scope:'INTERNAL_HANDOFF_ONLY',files,source_updates:history.length,new_fee_applications:count,financial_writes:0,import_authority:false,confirmation_authority:false,customer_document:false};
  const skeleton={...body,files:files.map(f=>({...f,text:''})),content_sha256:'0'.repeat(64)};let length=utf8(JSON.stringify(skeleton))+1;for(const f of files){length+=recoveredPackageTextTokenBytes(f.text)-2;if(length>RECOVERED_PACKAGE_LIMITS.file_bytes)fail('FILE_LIMIT');}
  const content_sha256=await sha(canonical(body)),raw=JSON.stringify({...body,content_sha256})+'\n';if(utf8(raw)!==length)fail('SERIALIZATION_SIZE');await parseRecoveredPackage(raw);return recoveredHandoffFile('recovered-business-package.json',raw);
}
