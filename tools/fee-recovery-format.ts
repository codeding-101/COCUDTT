/** Independent recovery DATA format. No live app installation, storage, file writing or financial authority. */
import {copyFeeEnvelopeJson,parseFeeEnvelopeJson,feeEnvelopeSha256} from '../src/data/fee-envelope-json';
import {FeeBrowserNativeCodec,FeeBrowserNativeCodecError,inspectFeeBrowserNativeCaptureBudget,feeBrowserNativeUtf8Bytes as utf8} from './fee-browser-native-codec';
import type {FeeLayeredCaptureParts,FeeLayeredCaptureRestoration} from './fee-layered-capture-prototype';
import {validateFeeRecoverySupplement,checkFeeRecoveryConsistency,freezeRecoveryData,type FeeRecoverySupplement} from './fee-recovery-supplement';
export const FEE_RECOVERY_LIMITS = Object.freeze({logical_bytes:128*1024*1024,raw_bytes:256*1024*1024,plain_bytes:48*1024*1024,encoded_bytes:64*1024*1024});
export class FeeRecoveryFormatError extends Error {constructor(readonly code:string){super('FEE_RECOVERY_FORMAT_'+code);}}
function fail(code:string):never {throw new FeeRecoveryFormatError(code);}
const current = (s:AbortSignal) => {if(s.aborted)fail('CANCELLED');};
function own(v:unknown,keys:readonly string[]):Record<string,unknown>{
  if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))return fail('HEADER');
  const ds=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(ds);
  if(names.length!==keys.length||keys.some(k=>!ds[k]?.enumerable||!('value'in ds[k]!))||names.some(k=>typeof k!=='string'))fail('HEADER');
  return Object.fromEntries(keys.map(k=>[k,ds[k]!.value]));
}
async function digest(text:string,s:AbortSignal){current(s);const result=await feeEnvelopeSha256(text);current(s);return result;}
const shaText=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
function date(v:unknown):v is string {if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v))return false;try{return new Date(v).toISOString()===v;}catch{return false;}}
/** Exact JSON token size for a previously validated Unicode string. */
function tokenBytes(text:string){let n=utf8(text)+2;for(const c of text){const code=c.charCodeAt(0);if(c==='"'||c==='\\'||code<32)n+=code<32&&![8,9,10,12,13].includes(code)?5:1;}return n;}
/** Validated data only. JSON's legal -0 spelling keeps negative zero in unknown supplemental extensions. */
function preservedJson(v:unknown):string {
  if(typeof v==='number'&&Object.is(v,-0))return '-0';
  if(Array.isArray(v))return '['+v.map(preservedJson).join(',')+']';
  if(v&&typeof v==='object')return '{'+Object.entries(v).map(([k,value])=>JSON.stringify(k)+':'+preservedJson(value)).join(',')+'}';
  return JSON.stringify(v);
}
function base64(bytes:Uint8Array){let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);}
function unbase64(value:unknown):Uint8Array<ArrayBuffer>{
  if(typeof value!=='string'||value.length%4!==0)return fail('BASE64');
  const padding=value.endsWith('==')?2:value.endsWith('=')?1:0;
  for(let i=0;i<value.length-padding;i++){const n=value.charCodeAt(i);if(!(n>=65&&n<=90||n>=97&&n<=122||n>=48&&n<=57||n===43||n===47))fail('BASE64');}
  let binary:string;try{binary=atob(value);}catch{return fail('BASE64');}
  if(value.length&&btoa(binary.slice(-(3-padding)))!==value.slice(-4))fail('BASE64');
  return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
/** Fixed-size output blocks bound JS chunk bookkeeping; native transform buffering is not measured. */
async function transform(bytes:Uint8Array<ArrayBuffer>,mode:'GZIP'|'GUNZIP',maximum:number,s:AbortSignal):Promise<Uint8Array<ArrayBuffer>>{
  current(s);if(mode==='GZIP'&&typeof CompressionStream!=='function'||mode==='GUNZIP'&&typeof DecompressionStream!=='function')fail('COMPRESSION_UNAVAILABLE');
  let at=0;const input=new ReadableStream<Uint8Array<ArrayBuffer>>({pull(c){current(s);if(at===bytes.length)c.close();else{const end=Math.min(at+16384,bytes.length);c.enqueue(bytes.slice(at,end));at=end;}}},{highWaterMark:0});
  const stream=input.pipeThrough(mode==='GZIP'?new CompressionStream('gzip'):new DecompressionStream('gzip')),reader=stream.getReader();
  const blocks:Uint8Array<ArrayBuffer>[]=[],blockSize=65536;let total=0,used=0,block=new Uint8Array(blockSize),complete=false;
  const abort=()=>{void reader.cancel().catch(()=>{});};s.addEventListener('abort',abort,{once:true});
  try{
    for(;;){current(s);const r=await reader.read();current(s);if(r.done)break;
      if(r.value.byteLength>maximum-total)fail(mode==='GUNZIP'?'EXPANSION_LIMIT':'ENCODED_SIZE');total+=r.value.byteLength;
      for(let i=0;i<r.value.length;){const take=Math.min(blockSize-used,r.value.length-i);block.set(r.value.subarray(i,i+take),used);used+=take;i+=take;if(used===blockSize){blocks.push(block);block=new Uint8Array(blockSize);used=0;}}
    }
    if(used)blocks.push(block.subarray(0,used));const result=new Uint8Array(total);let offset=0;for(const b of blocks){result.set(b,offset);offset+=b.length;}complete=true;return result;
  }finally{s.removeEventListener('abort',abort);if(!complete)void reader.cancel().catch(()=>{});reader.releaseLock();}
}
export interface FeeRecoveryData {
  readonly kind:'INTERNAL_FEE_WORKBENCH_RECOVERED_DATA';readonly version:'0.1';readonly captured_at:string;
  readonly source_wire:string;readonly supplement_json:string;readonly restoration:FeeLayeredCaptureRestoration;readonly supplement:FeeRecoverySupplement;
  readonly logical_utf8_bytes:number;readonly financial_writes:0;readonly import_authority:false;readonly confirmation_authority:false;readonly runtime_installed:false;
}
/** One format operation per instance; no queued decode, hidden fallback or budget option. */
export class FeeRecoveryFormat {
  private busy=false;private readonly codec=new FeeBrowserNativeCodec();
  state(){return this.busy?'WORKING' as const:'IDLE' as const;}
  private async run<T>(signal:AbortSignal,task:()=>Promise<T>):Promise<T>{
    current(signal);if(this.busy)fail('BUSY');this.busy=true;
    try{const result=await task();current(signal);return result;}catch(error){current(signal);if(error instanceof FeeRecoveryFormatError)throw error;
      if(error instanceof FeeBrowserNativeCodecError){const code=Object.getOwnPropertyDescriptor(error,'code')?.value;if(typeof code==='string'&&['ROOT_BYTES','CAPTURE_BYTES','RETAINED_TEXT_BYTES','SEMANTIC_LIMIT','ENCODED_BYTES'].includes(code))return fail('SOURCE_'+code);}
      return fail('INVALID_DATA');}finally{this.busy=false;}
  }
  encode(parts:FeeLayeredCaptureParts,extra:unknown,signal:AbortSignal,options:{compression?:'AUTO'|'NONE'|'GZIP';captured_at?:string}={}):Promise<string>{
    return this.run(signal,async()=>{
      const supplied=copyFeeEnvelopeJson(options);if(!supplied||typeof supplied!=='object'||Array.isArray(supplied)||Object.keys(supplied).some(k=>!['compression','captured_at'].includes(k)))fail('OPTIONS');
      const suppliedOptions=supplied as Record<string,unknown>,o={compression:Object.hasOwn(suppliedOptions,'compression')?suppliedOptions.compression:'AUTO',captured_at:Object.hasOwn(suppliedOptions,'captured_at')?suppliedOptions.captured_at:new Date().toISOString()};
      if(!['AUTO','NONE','GZIP'].includes(o.compression as string)||!date(o.captured_at))fail('OPTIONS');
      // Extra data is validated/detached before native encode reaches its first asynchronous boundary.
      const supplement=validateFeeRecoverySupplement(extra),supplement_json=preservedJson(supplement),budget=inspectFeeBrowserNativeCaptureBudget(parts);
      if(budget.capture.compact_utf8_bytes+utf8(supplement_json)>FEE_RECOVERY_LIMITS.logical_bytes)fail('LOGICAL_SIZE');
      const borrowed=own(parts,['retained_root','capture_shell','retained_format']);if(borrowed.retained_format!=='COMPACT'&&borrowed.retained_format!=='PRETTY_LF')fail('DATA_HEADER');
      const detached:FeeLayeredCaptureParts={retained_root:copyFeeEnvelopeJson(borrowed.retained_root),capture_shell:copyFeeEnvelopeJson(borrowed.capture_shell) as FeeLayeredCaptureParts['capture_shell'],retained_format:borrowed.retained_format};
      checkFeeRecoveryConsistency(detached.retained_root,detached.capture_shell,supplement);
      const pending=this.codec.encode(detached,signal),source_wire=await pending;current(signal);
      const source_sha256=await digest(source_wire,signal),supplement_sha256=await digest(supplement_json,signal);
      const payload={kind:'INTERNAL_FEE_WORKBENCH_RECOVERY_DATA',version:'0.1',captured_at:o.captured_at,source_wire,supplement_json,source_sha256,supplement_sha256,financial_writes:0,import_authority:false,confirmation_authority:false};
      const fixed=utf8(JSON.stringify({...payload,source_wire:'',supplement_json:''}))-4;
      if(fixed+tokenBytes(source_wire)+tokenBytes(supplement_json)>FEE_RECOVERY_LIMITS.raw_bytes)fail('RAW_SIZE');
      const raw=JSON.stringify(payload),rawBytes=utf8(raw);current(signal);
      if(o.compression!=='GZIP'&&rawBytes<=FEE_RECOVERY_LIMITS.plain_bytes)return raw;
      if(o.compression==='NONE')fail('PLAIN_SIZE');
      const sha256=await digest(raw,signal),outer={kind:'INTERNAL_FEE_WORKBENCH_RECOVERY_ARCHIVE',version:'0.1',encoding:'GZIP_BASE64_UTF8',raw_bytes:rawBytes,sha256,data:'',financial_writes:0,import_authority:false,confirmation_authority:false};
      const maximum=Math.floor((FEE_RECOVERY_LIMITS.encoded_bytes-utf8(JSON.stringify(outer)))/4)*3;
      const compressed=await transform(new TextEncoder().encode(raw),'GZIP',maximum,signal);outer.data=base64(compressed);current(signal);
      const result=JSON.stringify(outer);if(utf8(result)>FEE_RECOVERY_LIMITS.encoded_bytes)fail('ENCODED_SIZE');return result;
    });
  }
  decode(input:unknown,signal:AbortSignal):Promise<FeeRecoveryData>{return this.run(signal,async()=>{
    current(signal);if(typeof input!=='string'||input.length>FEE_RECOVERY_LIMITS.encoded_bytes)fail('ENCODED_SIZE');
    let value=parseFeeEnvelopeJson(input,FEE_RECOVERY_LIMITS.encoded_bytes) as Record<string,unknown>;
    if(value?.kind==='INTERNAL_FEE_WORKBENCH_RECOVERY_ARCHIVE'){
      const a=own(value,['kind','version','encoding','raw_bytes','sha256','data','financial_writes','import_authority','confirmation_authority']);
      if(a.version!=='0.1'||a.encoding!=='GZIP_BASE64_UTF8'||a.financial_writes!==0||a.import_authority!==false||a.confirmation_authority!==false||!Number.isSafeInteger(a.raw_bytes)||Object.is(a.raw_bytes,-0)||(a.raw_bytes as number)<1||(a.raw_bytes as number)>FEE_RECOVERY_LIMITS.raw_bytes||!shaText(a.sha256))fail('ARCHIVE_HEADER');
      const bytes=await transform(unbase64(a.data),'GUNZIP',a.raw_bytes as number,signal);if(bytes.length!==a.raw_bytes)fail('RAW_SIZE');
      const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);if(await digest(raw,signal)!==a.sha256)fail('ARCHIVE_DIGEST');
      value=parseFeeEnvelopeJson(raw,FEE_RECOVERY_LIMITS.raw_bytes) as Record<string,unknown>;
    }else if(utf8(input)>FEE_RECOVERY_LIMITS.plain_bytes)fail('PLAIN_SIZE');
    const d=own(value,['kind','version','captured_at','source_wire','supplement_json','source_sha256','supplement_sha256','financial_writes','import_authority','confirmation_authority']);
    if(d.kind!=='INTERNAL_FEE_WORKBENCH_RECOVERY_DATA'||d.version!=='0.1'||!date(d.captured_at)||typeof d.source_wire!=='string'||typeof d.supplement_json!=='string'||!shaText(d.source_sha256)||!shaText(d.supplement_sha256)||d.financial_writes!==0||d.import_authority!==false||d.confirmation_authority!==false)fail('DATA_HEADER');
    if(await digest(d.source_wire,signal)!==d.source_sha256||await digest(d.supplement_json,signal)!==d.supplement_sha256)fail('DATA_DIGEST');
    const supplement=validateFeeRecoverySupplement(parseFeeEnvelopeJson(d.supplement_json)),restoration=await this.codec.decode(d.source_wire,signal);current(signal);
    checkFeeRecoveryConsistency(restoration.retained_root,restoration.capture,supplement);
    const logical_utf8_bytes=utf8(JSON.stringify(restoration.capture))+utf8(d.supplement_json);if(logical_utf8_bytes>FEE_RECOVERY_LIMITS.logical_bytes)fail('LOGICAL_SIZE');
    return freezeRecoveryData({kind:'INTERNAL_FEE_WORKBENCH_RECOVERED_DATA',version:'0.1',captured_at:d.captured_at,source_wire:d.source_wire,supplement_json:d.supplement_json,restoration,supplement,logical_utf8_bytes,financial_writes:0,import_authority:false,confirmation_authority:false,runtime_installed:false});
  });}
}
