/** Independent supplementary-data representation experiment. Never a recovery archive or runtime installer. */
import {parseFeeEnvelopeJson} from '../src/data/fee-envelope-json';
import {feeBrowserNativeUtf8Bytes as utf8} from './fee-browser-native-codec';
import {FEE_RECOVERY_SUPPLEMENT_FIELDS,validateFeeRecoverySupplement,freezeRecoveryData,type FeeRecoverySupplement} from './fee-recovery-supplement';

export const FEE_RECOVERY_SHARING_LIMITS=Object.freeze({expanded_bytes:128*1024*1024,raw_body_bytes:256*1024*1024,final_file_bytes:64*1024*1024,nodes:300000,depth:32,texts:4096,text_min_bytes:1024,chunk_nodes:512});
type Node=['z']|['null']|['b',boolean]|['n',number]|['s',string]|['r',number]|['a',number]|['o',string];
type Summary={nodes:number;root_zero_depth:number;expanded_utf8_bytes:number};
type Packet={kind:'INTERNAL_FEE_RECOVERY_SHARED_SUPPLEMENT_PROTOTYPE';version:'0.1';texts:string[];chunks:string[];summary:Summary;financial_writes:0;import_authority:false;confirmation_authority:false;runtime_integrated:false;recovery_archive:false};
export class FeeRecoverySharingError extends Error {constructor(readonly code:string){super('FEE_RECOVERY_SHARING_'+code);}}
function fail(code:string):never{throw new FeeRecoverySharingError(code);}
const count=(v:unknown,max:number):v is number=>Number.isSafeInteger(v)&&!Object.is(v,-0)&&(v as number)>=0&&(v as number)<=max;
/** A smaller representation never changes the existing expanded aggregate limit or grants readiness. */
export function assessFeeRecoverySharing(sourceBytes:number,supplementBytes:number,sharedBytes:number){
 if(!count(sourceBytes,128*1024*1024)||!count(supplementBytes,128*1024*1024)||!count(sharedBytes,256*1024*1024))fail('BUDGET_INPUT');
 const total=sourceBytes+supplementBytes;return Object.freeze({source_capture_utf8_bytes:sourceBytes,supplement_expanded_utf8_bytes:supplementBytes,aggregate_utf8_bytes:total,aggregate_limit_bytes:128*1024*1024,shared_supplement_body_utf8_bytes:sharedBytes,raw_body_limit_bytes:256*1024*1024,final_file_limit_bytes:64*1024*1024,within_aggregate_limit:total<=128*1024*1024,capacity_decision:total>128*1024*1024?'NO_GO_EXPANDED_LIMIT' as const:'WITHIN_EXISTING_AGGREGATE_ONLY' as const,production_action:'KEEP_CURRENT_RECOVERY' as const,recovery_archive:false as const,capacity_changed:false as const,financial_writes:0 as const});
}
function own(v:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))return fail('HEADER');
 const ds=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(ds);if(names.length!==keys.length||keys.some(k=>!ds[k]?.enumerable||!('value'in ds[k]!)))fail('HEADER');
 return Object.fromEntries(keys.map(k=>[k,ds[k]!.value]));
}
function tokenBytes(s:string){let bytes=utf8(s)+2;for(let i=0;i<s.length;i++){const n=s.charCodeAt(i);if(n===34||n===92)bytes++;else if(n<32)bytes+=[8,9,10,12,13].includes(n)?1:5;}return bytes;}
/** Call only with already validated JSON. Keeps legal -0 and exact string contents. */
export function serializeFeeSharingSupplement(v:FeeRecoverySupplement):string {
 function json(x:unknown):string{if(typeof x==='number'&&Object.is(x,-0))return '-0';if(Array.isArray(x))return '['+x.map(json).join(',')+']';if(x&&typeof x==='object')return '{'+Object.entries(x).map(([k,value])=>JSON.stringify(k)+':'+json(value)).join(',')+'}';return JSON.stringify(x);}
 return json(v);
}
interface SharedTextFact{entry:number;token_utf8_bytes:number;occurrences:number;scopes:Record<string,number>}
export interface FeeSharingEncoding{readonly wire:string;readonly expanded_json:string;readonly summary:Summary;readonly wire_utf8_bytes:number;readonly representation_saved_bytes:number;readonly dictionary_entries:number;readonly duplicate_occurrences:number;readonly largest_repeated_texts:readonly SharedTextFact[];readonly envelope_field_utf8_bytes:Readonly<Record<string,number>>;readonly recovery_archive:false;readonly financial_writes:0}
export function encodeFeeRecoverySharing(value:unknown):FeeSharingEncoding {
 const data=validateFeeRecoverySupplement(value),nodes:Node[]=[],texts:string[]=[],ids=new Map<string,number>(),facts:SharedTextFact[]=[],fieldBytes:Record<string,number>={};let deepest=0;
 function visit(v:unknown,depth:number,scope:string):number{
  if(nodes.length>=FEE_RECOVERY_SHARING_LIMITS.nodes||depth>32)fail('SEMANTIC_LIMIT');deepest=Math.max(deepest,depth);
  if(v===null){nodes.push(['null']);return 4;}if(typeof v==='boolean'){nodes.push(['b',v]);return v?4:5;}
  if(typeof v==='number'){nodes.push(Object.is(v,-0)?['z']:['n',v]);return Object.is(v,-0)?2:JSON.stringify(v).length;}
  if(typeof v==='string'){
   const bytes=tokenBytes(v);if(utf8(v)<1024)nodes.push(['s',v]);else{let id=ids.get(v);if(id===undefined){if(texts.length>=4096)fail('TEXT_LIMIT');id=texts.length;ids.set(v,id);texts.push(v);facts.push({entry:id,token_utf8_bytes:bytes,occurrences:0,scopes:{}});}nodes.push(['r',id]);facts[id]!.occurrences++;facts[id]!.scopes[scope]=(facts[id]!.scopes[scope]??0)+1;}return bytes;
  }
  if(Array.isArray(v)){nodes.push(['a',v.length]);let bytes=2+Math.max(0,v.length-1);for(const child of v)bytes+=visit(child,depth+1,scope);if(bytes>128*1024*1024)fail('EXPANDED_LIMIT');return bytes;}
  const fields=v as Record<string,unknown>,names=Object.keys(fields);nodes.push(['o',JSON.stringify(names)]);let bytes=2+Math.max(0,names.length-1);
  for(const key of names){let childScope=scope;if(depth===0)childScope=key;if(depth===1&&Object.hasOwn(FEE_RECOVERY_SUPPLEMENT_FIELDS,scope)){const declared=FEE_RECOVERY_SUPPLEMENT_FIELDS[scope as keyof typeof FEE_RECOVERY_SUPPLEMENT_FIELDS] as readonly string[];childScope=scope+'.'+(declared.includes(key)?key:'(extension)');}
   const size=visit(fields[key],depth+1,childScope);bytes+=tokenBytes(key)+1+size;if(depth===1&&scope==='envelope_ui'&&childScope!=='envelope_ui.(extension)')fieldBytes[key]=size;
  }if(bytes>128*1024*1024)fail('EXPANDED_LIMIT');return bytes;
 }
 const expanded=visit(data,0,'root'),summary={nodes:nodes.length,root_zero_depth:deepest,expanded_utf8_bytes:expanded},chunks:string[]=[];
 for(let at=0;at<nodes.length;at+=512)chunks.push(JSON.stringify(nodes.slice(at,at+512)));
 const packet:Packet={kind:'INTERNAL_FEE_RECOVERY_SHARED_SUPPLEMENT_PROTOTYPE',version:'0.1',texts,chunks,summary,financial_writes:0,import_authority:false,confirmation_authority:false,runtime_integrated:false,recovery_archive:false};
 // This is an internal uncompressed body, not the final64MiB recovery file. Both published caps stay unchanged.
 const bodyBytes=utf8(JSON.stringify({...packet,texts:[],chunks:[]}))+texts.reduce((n,t)=>n+tokenBytes(t),Math.max(0,texts.length-1))+chunks.reduce((n,c)=>n+tokenBytes(c),Math.max(0,chunks.length-1));
 if(bodyBytes>256*1024*1024)fail('RAW_BODY_LIMIT');const wire=JSON.stringify(packet),wireBytes=utf8(wire);if(wireBytes!==bodyBytes)fail('SIZE_MISMATCH');const expanded_json=serializeFeeSharingSupplement(data);if(utf8(expanded_json)!==expanded)fail('SIZE_MISMATCH');
 return freezeRecoveryData({wire,expanded_json,summary,wire_utf8_bytes:wireBytes,representation_saved_bytes:expanded-wireBytes,dictionary_entries:texts.length,duplicate_occurrences:facts.reduce((n,f)=>n+f.occurrences-1,0),largest_repeated_texts:facts.filter(f=>f.occurrences>1).sort((a,b)=>b.token_utf8_bytes*(b.occurrences-1)-a.token_utf8_bytes*(a.occurrences-1)).slice(0,12),envelope_field_utf8_bytes:fieldBytes,recovery_archive:false,financial_writes:0});
}

/** Verifies expanded size/depth/nodes before constructing the expanded supplementary object. */
function preflight(input:unknown){
 if(typeof input!=='string')return fail('WIRE');const raw=own(parseFeeEnvelopeJson(input,256*1024*1024),['kind','version','texts','chunks','summary','financial_writes','import_authority','confirmation_authority','runtime_integrated','recovery_archive']);
 if(raw.kind!=='INTERNAL_FEE_RECOVERY_SHARED_SUPPLEMENT_PROTOTYPE'||raw.version!=='0.1'||raw.financial_writes!==0||raw.import_authority!==false||raw.confirmation_authority!==false||raw.runtime_integrated!==false||raw.recovery_archive!==false||!Array.isArray(raw.texts)||raw.texts.length>4096||!Array.isArray(raw.chunks)||!raw.chunks.length||raw.chunks.length>Math.ceil(300000/512))fail('HEADER');
 const texts:string[]=[],unique=new Set<string>();for(const value of raw.texts){if(typeof value!=='string'||utf8(value)<1024||unique.has(value))fail('TEXT_TABLE');unique.add(value);texts.push(value);}
 const nodes:unknown[]=[];for(const[index,chunk]of raw.chunks.entries()){if(typeof chunk!=='string')fail('CHUNKS');const parsed=parseFeeEnvelopeJson(chunk);if(!Array.isArray(parsed)||parsed.length<1||parsed.length>512||index<raw.chunks.length-1&&parsed.length!==512||JSON.stringify(parsed)!==chunk)fail('CHUNKS');nodes.push(...parsed);if(nodes.length>300000)fail('SEMANTIC_LIMIT');}
 const names=new Map<number,string[]>(),used=new Set<number>(),metrics=new Map<string,number>();let at=0,deepest=0;
 const textSize=(s:string)=>{let m=metrics.get(s);if(m===undefined){m=tokenBytes(s);if(s.length>=512&&metrics.size<4096)metrics.set(s,m);}return m;};
 function walk(depth:number):number{
  if(depth>32||at>=nodes.length)fail('SEMANTIC_LIMIT');deepest=Math.max(deepest,depth);const id=at++,node=nodes[id];if(!Array.isArray(node)||!node.length)fail('NODE');const tag=node[0];
  if(tag==='null'||tag==='z'){if(node.length!==1)fail('NODE');return tag==='null'?4:2;}
  if(node.length!==2)fail('NODE');const value=node[1];
  if(tag==='b'){if(typeof value!=='boolean')fail('NODE');return value?4:5;}
  if(tag==='n'){if(typeof value!=='number'||!Number.isFinite(value)||Object.is(value,-0))fail('NODE');return JSON.stringify(value).length;}
  if(tag==='s'){if(typeof value!=='string'||utf8(value)>=1024)fail('NODE');return textSize(value);}
  if(tag==='r'){if(!count(value,texts.length-1)||!used.has(value)&&value!==used.size)fail('REFERENCE');used.add(value);return textSize(texts[value]!);}
  let length:number,keys:string[]|null=null;
  if(tag==='a'){if(!count(value,300000))fail('NODE');length=value;}
  else if(tag==='o'){
   if(typeof value!=='string')fail('NODE');const parsed=parseFeeEnvelopeJson(value);if(!Array.isArray(parsed)||parsed.some(k=>typeof k!=='string')||new Set(parsed).size!==parsed.length||JSON.stringify(parsed)!==value)fail('KEYS');
   keys=parsed as string[];if(JSON.stringify(Object.keys(Object.fromEntries(keys.map(k=>[k,null]))))!==value)fail('KEYS');names.set(id,keys);length=keys.length;
  }else return fail('NODE');
  let bytes=2+Math.max(0,length-1);for(let i=0;i<length;i++){if(keys)bytes+=textSize(keys[i]!)+1;bytes+=walk(depth+1);if(bytes>128*1024*1024)fail('EXPANDED_LIMIT');}return bytes;
 }
 const expanded=walk(0);if(at!==nodes.length||used.size!==texts.length)fail('UNUSED_DATA');const summary=own(raw.summary,['nodes','root_zero_depth','expanded_utf8_bytes']);
 if(!count(summary.nodes,300000)||!count(summary.root_zero_depth,32)||!count(summary.expanded_utf8_bytes,128*1024*1024)||summary.nodes!==nodes.length||summary.root_zero_depth!==deepest||summary.expanded_utf8_bytes!==expanded)fail('SUMMARY');
 return{nodes,texts,names,summary:{nodes:nodes.length,root_zero_depth:deepest,expanded_utf8_bytes:expanded}};
}
export function inspectFeeRecoverySharing(input:unknown){return freezeRecoveryData(preflight(input).summary);}
export function decodeFeeRecoverySharing(input:unknown):FeeRecoverySupplement {
 const checked=preflight(input);let at=0;
 function restore():unknown{const id=at++,node=checked.nodes[id] as Node;switch(node[0]){case'null':return null;case'z':return -0;case'b':case'n':case's':return node[1];case'r':return checked.texts[node[1]];case'a':return Array.from({length:node[1]},restore);case'o':return Object.fromEntries(checked.names.get(id)!.map(k=>[k,restore()]));}}
 const result=validateFeeRecoverySupplement(restore());if(utf8(serializeFeeSharingSupplement(result))!==checked.summary.expanded_utf8_bytes)fail('SIZE_MISMATCH');return result;
}

/** Counts a gzip text body, not a recovery file. Native buffering and peak memory are not measured. */
export async function countFeeSharingGzipBytes(text:string,signal:AbortSignal):Promise<number>{
 const current=()=>{if(signal.aborted)fail('CANCELLED');};current();if(typeof CompressionStream!=='function')fail('COMPRESSION_UNAVAILABLE');if(utf8(text)>128*1024*1024)fail('EXPANDED_LIMIT');
 let at=0;const encoder=new TextEncoder(),stream=new ReadableStream<Uint8Array<ArrayBuffer>>({pull(c){current();if(at===text.length){c.close();return;}let end=Math.min(at+32768,text.length);const code=text.charCodeAt(end-1);if(end<text.length&&code>=0xd800&&code<=0xdbff)end--;c.enqueue(encoder.encode(text.slice(at,end)));at=end;}},{highWaterMark:0}).pipeThrough(new CompressionStream('gzip')),reader=stream.getReader();let total=0,done=false;
 const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{for(;;){current();const part=await reader.read();current();if(part.done)break;total+=part.value.byteLength;if(total>64*1024*1024)fail('GZIP_LIMIT');}done=true;return total;}
 finally{signal.removeEventListener('abort',abort);if(!done)void reader.cancel().catch(()=>{});reader.releaseLock();}
}
