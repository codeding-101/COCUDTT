/** Shared strict-JSON comparisons; never a business, import or saved-file authority. */
import * as current from '../src/data/fee-envelope-json';
import * as original from './fee-json-stability-oracle';

export const JSON_STABILITY_TEXTS = [
 {id:'empty',text:''},
 {id:'ascii-large',text:'a'.repeat(65536)},
 {id:'controls-escapes',text:'\u0000\b\t\n\f\r"\\\u001f'},
 {id:'bmp-limits',text:'\u007f\u0080\u07ff\u0800\ud7ff\ue000\uffff'},
 {id:'pair-limits',text:'\ud800\udc00\ud800\udfff\udbff\udc00\udbff\udfff😀𠀀'},
 {id:'normalization-preserved',text:'é|e\u0301|汉字|  原文\n'},
 {id:'shared-1023',text:'x'.repeat(1023)},
 {id:'shared-1024',text:'x'.repeat(1024)},
 {id:'shared-1025',text:'x'.repeat(1025)},
] as const;

function outcome(run:()=>unknown){try{return{ok:true,value:run()};}catch(error){return{ok:false,code:(error as {code?:string}).code??'UNKNOWN'};}}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export async function probeJsonStability(){
 const cases:{id:string;checks:Record<string,boolean>}[]=[],wires:{id:string;json:string;sha256:string}[]=[];
 for(const {id,text} of JSON_STABILITY_TEXTS){
  const json=JSON.stringify({text}),copy=current.copyFeeEnvelopeJson({text});
  const hash=await current.feeEnvelopeSha256(json);
  cases.push({id,checks:{copy:same(copy,original.copyFeeEnvelopeJson({text})),parse:same(current.parseFeeEnvelopeJson(json),original.parseFeeEnvelopeJson(json)),digest:hash===await original.feeEnvelopeSha256(json),raw:(copy as {text:string}).text===text}});
  wires.push({id,json,sha256:hash});
 }
 for(const [id,text] of [
  ['duplicate','{"a":1,"a":2}'],['escaped-duplicate','{"a":1,"\\u0061":2}'],
  ['overflow','1e999'],['trailing-comma','[0,]'],['escaped-high','"\\uD800"'],['escaped-low','"\\uDC00"'],
 ] as const){const a=outcome(()=>current.parseFeeEnvelopeJson(text)),b=outcome(()=>original.parseFeeEnvelopeJson(text));cases.push({id,checks:{same_error:same(a,b),rejected:!a.ok}});}
 for(const [id,text] of [['raw-high','\ud800'],['raw-low','\udfff'],['broken-pair','\ud800x\udc00']] as const){
  const a=outcome(()=>current.copyFeeEnvelopeJson(text)),b=outcome(()=>original.copyFeeEnvelopeJson(text));cases.push({id,checks:{same_error:same(a,b),rejected:!a.ok}});
 }
 const value={zero:-0,nested:[null,true,3,{literal:'unchanged'}]},copy=current.copyFeeEnvelopeJson(value) as typeof value;
 cases.push({id:'structure-and-negative-zero',checks:{negative_zero:Object.is(copy.zero,-0),detached:copy!==value&&copy.nested!==value.nested,canonical:current.canonicalFeeEnvelopeJson(copy)===original.canonicalFeeEnvelopeJson(original.copyFeeEnvelopeJson(value))}});
 const at=current.parseFeeEnvelopeJson('"汉"',5),over=outcome(()=>current.parseFeeEnvelopeJson('"汉"',4));
 cases.push({id:'exact-utf8-limit',checks:{at:at==='汉',over:!over.ok,same_error:same(over,outcome(()=>original.parseFeeEnvelopeJson('"汉"',4)))}});
 return{scope:'STRICT_JSON_NODE_FASTPATH_COMPARISON',ssr:import.meta.env.SSR,cases,wires,financial_writes:0,confirmation_authority:false,save_authority:false};
}
