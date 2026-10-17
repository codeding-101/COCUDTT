import type {FeeTaxAttachmentRecordInput,FeeTaxAttachmentTarget} from '../domain/fee-tax-attachment.js';
import {parseFeeTaxAttachmentJson} from '../data/fee-tax-attachment-json.js';

const branches={tax:{UNKNOWN:[],NO_SEPARATION:[],EXPLICIT:['net','tax'],GROSS_RATE:['rate']},credit:{UNKNOWN:[],NONE:['basis'],ASSUMED:['amount','basis','document_ref','eligibility_ref']},customs:{UNKNOWN:[],NOT_ADDED:['basis'],ADD_COMPONENT:['amount','basis']}} as const;
const sourceFields=['provenance','reference','valid_from','valid_to','checked_on'];
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
/** Tolerant of unfinished strings, never of unknown structure. Opaque recovered text stays intact. */
export function readFeeTaxForm(text:string):FeeTaxAttachmentRecordInput|null {
 try{
  const v=parseFeeTaxAttachmentJson(text,64*1024);
  if(!exact(v,['target','input','sources'])||!exact(v.target,['mapping_id','bill_id','line_id','cost_id','operation'])||!Object.values(v.target).every(x=>typeof x==='string')||!['CREATE_NEW','REFERENCE_EXISTING'].includes(v.target.operation as string))return null;
  if(!exact(v.input,['line_id','currency','gross','tax','credit','customs'])||typeof v.input.line_id!=='string'||typeof v.input.currency!=='string'||v.input.gross!==null&&typeof v.input.gross!=='string'||!exact(v.sources,['tax','credit','customs']))return null;
  for(const facet of ['tax','credit','customs'] as const){
   const x=v.input[facet];if(!x||typeof x!=='object'||Array.isArray(x))return null;
   const kind=(x as Record<string,unknown>).kind,options=branches[facet] as Record<string,readonly string[]>;
   if(typeof kind!=='string'||!Object.hasOwn(options,kind)||!exact(x,['kind',...options[kind]!])||!Object.values(x).every(x=>typeof x==='string'))return null;
   const s=v.sources[facet];if(!exact(s,sourceFields)||!Object.values(s).every(x=>typeof x==='string')||!['UNSPECIFIED','EXAMPLE','USER_SUPPLIED'].includes(s.provenance as string))return null;
  }
  return v as unknown as FeeTaxAttachmentRecordInput;
 }catch{return null;}
}
export function newFeeTaxForm(target:FeeTaxAttachmentTarget,line_id:string):FeeTaxAttachmentRecordInput{
 const source=()=>({provenance:'UNSPECIFIED' as const,reference:'',valid_from:'',valid_to:'',checked_on:''});
 return{target:structuredClone(target),input:{line_id,currency:'',gross:null,tax:{kind:'UNKNOWN'},credit:{kind:'UNKNOWN'},customs:{kind:'UNKNOWN'}},sources:{tax:source(),credit:source(),customs:source()}};
}
/** Closed field paths; decimal strings are not coerced, rounded or given a default rate. */
export function changeFeeTaxForm(text:string,path:string,value:string):string|null{
 const record=readFeeTaxForm(text);if(!record)return null;
 const parts=path.split('.');
 if(parts[0]==='input'&&parts.length===2&&['currency','gross'].includes(parts[1]!)){
  if(parts[1]==='gross')record.input.gross=value===''?null:value;else record.input.currency=value;
 }else if(parts[0]==='input'&&parts.length===3&&['tax','credit','customs'].includes(parts[1]!)){
  const facet=parts[1] as keyof typeof branches,key=parts[2]!,options=branches[facet] as Record<string,readonly string[]>;
  if(key==='kind'){
   if(!Object.hasOwn(options,value))return null;
   // Changing a branch is explicit in the UI. Other facets and sources stay intact.
   (record.input as unknown as Record<string,unknown>)[facet]=Object.fromEntries([['kind',value],...options[value]!.map(k=>[k,''])]);
  }else{
   const branch=record.input[facet] as unknown as Record<string,string>;
   if(!options[branch.kind!]!.includes(key))return null;branch[key]=value;
  }
 }else if(parts[0]==='sources'&&parts.length===3&&['tax','credit','customs'].includes(parts[1]!)&&sourceFields.includes(parts[2]!)){
  if(parts[2]==='provenance'&&!['UNSPECIFIED','EXAMPLE','USER_SUPPLIED'].includes(value))return null;
  (record.sources[parts[1] as keyof typeof branches] as unknown as Record<string,string>)[parts[2]!]=value;
 }else return null;
 return JSON.stringify(record,null,2);
}
