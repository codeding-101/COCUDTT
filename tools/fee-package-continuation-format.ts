/** Independent gzip carrier for exact parent input + an unchanged-format package0.1. No fee/confirmation authority. */
import {parseFeeEnvelopeJson as json,feeEnvelopeSha256 as sha,canonicalFeeEnvelopeJson as canonical} from '../src/data/fee-envelope-json';
import {parseFeeEnvelope} from '../src/data/fee-envelope';
import {parseRecoveredPackage,createRecoveredPackage,recoveredPackageTextTokenBytes,RECOVERED_PACKAGE_LIMITS,type ParsedRecoveredPackage} from './fee-recovery-package';
import {recoveredHandoffFile,type RecoveredHandoffFile} from './fee-recovery-business-files';
import {assertReconcileHistoryBudget,type ReconcileRecord} from './fee-recovery-reconcile';
import {freezeRecoveryData} from './fee-recovery-supplement';
import {feeBrowserNativeUtf8Bytes as bytes} from './fee-browser-native-codec';
export const CONTINUATION_LIMITS=Object.freeze({encoded_bytes:64*1024*1024,expanded_chain_bytes:256*1024*1024,depth:16});
export class ContinuationFormatError extends Error{constructor(readonly code:string){super('PACKAGE_CONTINUATION_'+code);this.name='ContinuationFormatError';}}
function fail(code:string):never{throw new ContinuationFormatError(code);}
type Data=Record<string,unknown>;
function fields(v:unknown,names:string):Data{if(!v||typeof v!=='object'||Array.isArray(v))fail('SHAPE');const d=v as Data,keys=names.split(' ');if(Object.keys(d).length!==keys.length||keys.some(k=>!Object.hasOwn(d,k)))fail('FIELDS');return d;}
const get=(p:ParsedRecoveredPackage,name:string)=>{const f=p.files.find(f=>f.name===name);if(!f)fail('FILE_SET');return f;};
export function packageAuditRecords(p:ParsedRecoveredPackage){return freezeRecoveryData((json(get(p,'source-update-audit.json').text) as {records:ReconcileRecord[]}).records);}
async function fileValue(v:unknown){const d=fields(v,'name text mime bytes sha256');if(typeof d.name!=='string'||d.name.length>200||typeof d.text!=='string'||d.mime!=='application/json'||d.bytes!==bytes(d.text)||(d.bytes as number)>CONTINUATION_LIMITS.encoded_bytes||await sha(d.text)!==d.sha256)fail('FILE_DIGEST');return Object.freeze({name:d.name,text:d.text,mime:'application/json' as const,bytes:d.bytes as number,sha256:d.sha256 as string});}
export interface ContinuationInput{readonly input_file:RecoveredHandoffFile;readonly current_package:RecoveredHandoffFile;readonly parsed:ParsedRecoveredPackage;readonly records:readonly ReconcileRecord[];readonly depth:number;readonly expanded_bytes:number}
function flags(d:Data){if(d.financial_writes!==0||d.import_authority!==false||d.confirmation_authority!==false||d.customer_document!==false)fail('AUTHORITY');}
function base64(v:Uint8Array){let s='';for(let i=0;i<v.length;i+=32768)s+=String.fromCharCode(...v.subarray(i,i+32768));return btoa(s);}
function unbase64(v:unknown){if(typeof v!=='string'||v.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(v))fail('BASE64');const s=atob(v);if(btoa(s)!==v)fail('BASE64');return Uint8Array.from(s,c=>c.charCodeAt(0));}
async function transform(input:Uint8Array<ArrayBuffer>,mode:'gzip'|'gunzip',maximum:number){
 if(mode==='gzip'&&typeof CompressionStream!=='function'||mode==='gunzip'&&typeof DecompressionStream!=='function')fail('NATIVE_COMPRESSION_UNAVAILABLE');
 const stream=new Blob([input]).stream().pipeThrough(mode==='gzip'?new CompressionStream('gzip'):new DecompressionStream('gzip')),reader=stream.getReader(),chunks:Uint8Array[]=[];let total=0,done=false;
 try{for(;;){const r=await reader.read();if(r.done){done=true;break;}total+=r.value.byteLength;if(total>maximum)fail(mode==='gzip'?'ENCODED_LIMIT':'EXPANSION_LIMIT');chunks.push(r.value);}const result=new Uint8Array(total);let at=0;for(const c of chunks){result.set(c,at);at+=c.byteLength;}return result;}finally{if(!done)await reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function relation(parent:ContinuationInput,current:ParsedRecoveredPackage,added:unknown,inherited:unknown){
 if(!Number.isSafeInteger(added)||(added as number)<1||current.review.source_updates!==parent.records.length+(added as number)||inherited!==parent.parsed.review.new_fee_applications||current.review.new_fee_applications!==inherited)fail('COUNTS');
 const records=packageAuditRecords(current);if(canonical(records.slice(0,parent.records.length))!==canonical(parent.records)||records[parent.records.length]?.before_envelope_json!==get(parent.parsed,'recovered-envelope.json').text)fail('AUDIT_PREFIX');
 for(const name of['original-recovery.json','new-application-backup.json'])if(current.files.find(f=>f.name===name)?.text!==parent.parsed.files.find(f=>f.name===name)?.text)fail('PRESERVED_FILE_CHANGED');
 const a=await parseFeeEnvelope(get(parent.parsed,'recovered-envelope.json').text),b=await parseFeeEnvelope(get(current,'recovered-envelope.json').text);if(a.envelope_id!==b.envelope_id||a.business_id!==b.business_id||a.history_origin!==b.history_origin||a.ledger_json!==b.ledger_json||JSON.stringify(a.archives)!==JSON.stringify(b.archives))fail('FEE_HISTORY_CHANGED');
 return records;
}
/** Cumulative expanded-byte/depth limits include all decoded parents, never just the outer archive. */
export async function readContinuationInput(file:RecoveredHandoffFile,maximumExpanded:number=CONTINUATION_LIMITS.expanded_chain_bytes,maximumDepth:number=CONTINUATION_LIMITS.depth):Promise<ContinuationInput>{
 if(!Number.isSafeInteger(maximumExpanded)||maximumExpanded<1||maximumExpanded>CONTINUATION_LIMITS.expanded_chain_bytes||!Number.isSafeInteger(maximumDepth)||maximumDepth<0||maximumDepth>CONTINUATION_LIMITS.depth)fail('RESTRICTED_BUDGET');
 const budget={total:0};
 async function read(f:RecoveredHandoffFile,depth:number):Promise<ContinuationInput>{
  if(depth>maximumDepth)fail('DEPTH_LIMIT');const checked=await fileValue(f),d=json(checked.text,CONTINUATION_LIMITS.encoded_bytes) as Data;
  if(d.kind==='INTERNAL_RECOVERED_BUSINESS_PACKAGE'){budget.total+=checked.bytes;if(budget.total>maximumExpanded)fail('CHAIN_LIMIT');const parsed=await parseRecoveredPackage(checked.text);return{input_file:checked,current_package:checked,parsed,records:packageAuditRecords(parsed),depth:0,expanded_bytes:budget.total};}
  fields(d,'kind version encoding raw_bytes sha256 data financial_writes import_authority confirmation_authority customer_document');flags(d);if(d.kind!=='INTERNAL_PACKAGE_CONTINUATION_ARCHIVE'||d.version!=='0.1'||d.encoding!=='GZIP_BASE64_UTF8'||!Number.isSafeInteger(d.raw_bytes)||(d.raw_bytes as number)<1||typeof d.sha256!=='string'||!/^[a-f0-9]{64}$/.test(d.sha256))fail('ARCHIVE_HEADER');
  if((d.raw_bytes as number)>maximumExpanded-budget.total)fail('CHAIN_LIMIT');budget.total+=d.raw_bytes as number;
  const rawBytes=await transform(unbase64(d.data),'gunzip',d.raw_bytes as number);if(rawBytes.length!==d.raw_bytes)fail('RAW_BYTES');const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(rawBytes);if(await sha(raw)!==d.sha256)fail('RAW_DIGEST');const body=fields(json(raw,CONTINUATION_LIMITS.expanded_chain_bytes),'kind version scope parent_file current_package added_source_updates inherited_fee_applications financial_writes import_authority confirmation_authority customer_document');flags(body);if(body.kind!=='INTERNAL_PACKAGE_CONTINUATION'||body.version!=='0.1'||body.scope!=='INTERNAL_CONTINUATION_ONLY')fail('BODY_HEADER');
  const parent=await read(await fileValue(body.parent_file),depth+1),currentFile=await fileValue(body.current_package),parsed=await parseRecoveredPackage(currentFile.text),records=await relation(parent,parsed,body.added_source_updates,body.inherited_fee_applications);
  return{input_file:checked,current_package:currentFile,parsed,records,depth:parent.depth+1,expanded_bytes:budget.total};
 }
 return freezeRecoveryData(await read(file,0));
}
const bodyValue=(parent:ContinuationInput,current:RecoveredHandoffFile,added:number)=>({kind:'INTERNAL_PACKAGE_CONTINUATION',version:'0.1',scope:'INTERNAL_CONTINUATION_ONLY',parent_file:parent.input_file,current_package:current,added_source_updates:added,inherited_fee_applications:parent.parsed.review.new_fee_applications,financial_writes:0,import_authority:false,confirmation_authority:false,customer_document:false});
export function assertContinuationBudget(parent:ContinuationInput,current:RecoveredHandoffFile,added:number){
 if(parent.depth>=CONTINUATION_LIMITS.depth)fail('DEPTH_LIMIT');const body=bodyValue(parent,current,added),skeleton={...body,parent_file:{...parent.input_file,text:''},current_package:{...current,text:''}};
 const size=bytes(JSON.stringify(skeleton))+recoveredPackageTextTokenBytes(parent.input_file.text)-2+recoveredPackageTextTokenBytes(current.text)-2;if(size>CONTINUATION_LIMITS.expanded_chain_bytes-parent.expanded_bytes)fail('CHAIN_LIMIT');return size;
}
export async function writeContinuationInput(parent:ContinuationInput,current:RecoveredHandoffFile):Promise<RecoveredHandoffFile>{
 if(current.text===parent.current_package.text)return recoveredHandoffFile('continued-business-session.json',parent.input_file.text);const parsed=await parseRecoveredPackage(current.text),added=parsed.review.source_updates-parent.records.length;await relation(parent,parsed,added,parent.parsed.review.new_fee_applications);const expected=assertContinuationBudget(parent,current,added),raw=JSON.stringify(bodyValue(parent,current,added));if(bytes(raw)!==expected)fail('SERIALIZATION_SIZE');
 const envelope={kind:'INTERNAL_PACKAGE_CONTINUATION_ARCHIVE',version:'0.1',encoding:'GZIP_BASE64_UTF8',raw_bytes:expected,sha256:await sha(raw),data:'',financial_writes:0,import_authority:false,confirmation_authority:false,customer_document:false},maximum=Math.floor((CONTINUATION_LIMITS.encoded_bytes-bytes(JSON.stringify(envelope)))/4)*3;
 envelope.data=base64(await transform(new TextEncoder().encode(raw),'gzip',maximum));return recoveredHandoffFile('continued-business-session.json',JSON.stringify(envelope));
}
function descriptor(name:string,text:string,sha256='0'.repeat(64)):RecoveredHandoffFile{return{name,text,mime:'application/json',bytes:bytes(text),sha256};}
/** Same old package0.1 file order and manifest. Fixed-length digest placeholders are used ONLY for synchronous size preflight. */
function packageFiles(parent:ContinuationInput,project:string,envelope:string){
 const files=[descriptor('recovered-project.json',project),descriptor('recovered-envelope.json',envelope)];for(const name of['original-recovery.json','new-application-backup.json']){const f=parent.parsed.files.find(f=>f.name===name);if(f)files.push(descriptor(f.name,f.text,f.sha256));}
 const old=json(get(parent.parsed,'internal-handoff-manifest.json').text) as Data,manifest=JSON.stringify({kind:'INTERNAL_RECOVERED_BUSINESS_HANDOFF',version:'0.1',original_captured_at:old.original_captured_at,files:files.map(({name,bytes,sha256})=>({name,bytes,sha256})),new_financial_writes:parent.parsed.review.new_fee_applications,pending_patch_replays:0,import_authority:false,customer_document:false},null,2)+'\n';files.push(descriptor('internal-handoff-manifest.json',manifest));return files;
}
export function plannedContinuedPackage(parent:ContinuationInput,project:string,envelope:string,records:readonly ReconcileRecord[]){
 assertReconcileHistoryBudget(records);const files=packageFiles(parent,project,envelope);files.push(descriptor('source-update-audit.json',JSON.stringify({kind:'INTERNAL_RECOVERED_SOURCE_AUDIT',version:'0.1',records,financial_writes:0,import_authority:false,customer_approval:false})));
 const body={kind:'INTERNAL_RECOVERED_BUSINESS_PACKAGE',version:'0.1',scope:'INTERNAL_HANDOFF_ONLY',files,source_updates:records.length,new_fee_applications:parent.parsed.review.new_fee_applications,financial_writes:0,import_authority:false,confirmation_authority:false,customer_document:false,content_sha256:'0'.repeat(64)},skeleton={...body,files:files.map(f=>({...f,text:''}))};let size=bytes(JSON.stringify(skeleton))+1;for(const f of files){size+=recoveredPackageTextTokenBytes(f.text)-2;if(size>RECOVERED_PACKAGE_LIMITS.file_bytes)fail('PACKAGE_LIMIT');}const raw=JSON.stringify(body)+'\n';if(bytes(raw)!==size)fail('SERIALIZATION_SIZE');return descriptor('recovered-business-package.json',raw);
}
export async function createContinuedPackage(parent:ContinuationInput,project:string,envelope:string,records:readonly ReconcileRecord[]){
 plannedContinuedPackage(parent,project,envelope,records);const files=packageFiles(parent,project,envelope);for(let i=0;i<2;i++){const f=files[i]!;files[i]=await recoveredHandoffFile(f.name,f.text);}const manifest=json(files.at(-1)!.text) as {files:{sha256:string}[]};for(let i=0;i<2;i++)manifest.files[i]!.sha256=files[i]!.sha256;files[files.length-1]=await recoveredHandoffFile('internal-handoff-manifest.json',JSON.stringify(manifest,null,2)+'\n');return createRecoveredPackage(files,records);
}
/** Internal bounded codec shared by the independent quote/payment carrier. */
export {transform as transformContinuationBytes};
