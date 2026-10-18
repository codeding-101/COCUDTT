import {FeePrecisionSelectionError,FEE_PRECISION_SELECTION_BYTES} from '../domain/fee-precision-selection.js';
const fail=():never=>{throw new FeePrecisionSelectionError('STRICT_JSON')};
const encoder=new TextEncoder();
/** Lone surrogates would lose identity when fingerprinted as UTF-8. */
function string(value:string):string {
 for(let i=0;i<value.length;i++){const n=value.charCodeAt(i);if(n>=0xd800&&n<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))fail();}else if(n>=0xdc00&&n<=0xdfff)fail();}
 return value;
}
/** Detached, bounded, lossless data snapshot, before any asynchronous hashing. */
export function copyFeePrecisionSelectionJson(value:unknown):unknown {
 let nodes=0;const parents=new Set<object>();
 function visit(v:unknown,depth:number):unknown{
  if(++nodes>300000||depth>32)fail();
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='string')return string(v);
  if(typeof v==='number'){if(!Number.isFinite(v))fail();return v;}
  if(!v||typeof v!=='object'||parents.has(v))return fail();parents.add(v);
  const descriptors=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(descriptors);
  if(keys.some(k=>typeof k!=='string'))fail();
  let result:unknown;
  if(Array.isArray(v)){
   const length=descriptors['length']?.value;
   if(Object.getPrototypeOf(v)!==Array.prototype||!Number.isInteger(length)||length<0||length>300000||keys.length!==length+1)fail();
   const rows=[];for(let i=0;i<length;i++){const d=descriptors[String(i)];if(!d?.enumerable||!('value'in d))return fail();rows.push(visit(d.value,depth+1));}result=rows;
  }else{
   if(![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail();
   result=Object.fromEntries(keys.map(k=>{const d=descriptors[k as string]!;if(!d.enumerable||!('value'in d))fail();return[string(k as string),visit(d.value,depth+1)];}));
  }
  parents.delete(v);return result;
 }
 try{const result=visit(value,0);if(encoder.encode(JSON.stringify(result)).length>FEE_PRECISION_SELECTION_BYTES)fail();return result;}
 catch(error){if(error instanceof FeePrecisionSelectionError)throw error;return fail();}
}
/** Preflight both JSON layers; JSON.parse alone silently discards duplicate keys. */
export function parseFeePrecisionSelectionJson(input:unknown,maxBytes=FEE_PRECISION_SELECTION_BYTES):unknown {
 if(typeof input!=='string'||input.length>maxBytes||encoder.encode(string(input)).length>maxBytes)throw new FeePrecisionSelectionError('UTF8_SIZE');
 const text=input;
 let at=0,nodes=0;
 const space=()=>{while(at<text.length&&/[ \t\r\n]/.test(text[at]!))at++;};
 const number=/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
 function quoted():string{
  if(text[at]!== '"')fail();const start=at++;
  while(at<text.length){const ch=text[at++]!;if(ch==='"'){try{return string(JSON.parse(text.slice(start,at)) as string);}catch{return fail();}}
   if(ch<' ')fail();if(ch==='\\'){const escape=text[at++];if(escape==='u'){if(!/^[0-9a-fA-F]{4}$/.test(text.slice(at,at+4)))fail();at+=4;}else if(!escape||!'"\\/bfnrt'.includes(escape))fail();}
  }return fail();
 }
 function value(depth:number):void {
  if(++nodes>300000||depth>32)fail();space();const ch=text[at];
  if(ch==='"'){quoted();return;}
  if(ch==='{'){
   at++;space();if(text[at]==='}'){at++;return;}const seen=new Set<string>();
   for(;;){space();const key=quoted();if(seen.has(key))fail();seen.add(key);space();if(text[at++]!==':')fail();value(depth+1);space();const end=text[at++];if(end==='}')return;if(end!==',')fail();}
  }
  if(ch==='['){at++;space();if(text[at]===']'){at++;return;}for(;;){value(depth+1);space();const end=text[at++];if(end===']')return;if(end!==',')fail();}}
  for(const literal of['true','false','null'])if(text.startsWith(literal,at)){at+=literal.length;return;}
  number.lastIndex=at;const match=number.exec(text);if(!match||!Number.isFinite(Number(match[0])))fail();at=number.lastIndex;
 }
 try{value(0);space();if(at!==text.length)fail();return JSON.parse(text);}
 catch(error){if(error instanceof FeePrecisionSelectionError)throw error;return fail();}
}
/** Call only on validated detached JSON; arrays retain their order. */
export function canonicalFeePrecisionSelectionJson(value:unknown):string {
 const sort=(v:unknown):unknown=>Array.isArray(v)?v.map(sort):v!==null&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort((v as Record<string,unknown>)[k])])):v;
 return JSON.stringify(sort(value));
}
export async function feePrecisionSelectionSha256(text:string):Promise<string>{
 if(!globalThis.crypto?.subtle)throw new FeePrecisionSelectionError('CRYPTO_UNAVAILABLE');
 const bytes=encoder.encode(string(text)),digest=await crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
}
