import {parseFeePrecisionSelectionJson} from '../data/fee-precision-selection-json.js';
import {FEE_PRECISION_CHANNELS} from '../domain/fee-precision.js';

type Draft=Record<string,unknown>;
const exact=(v:unknown,keys:string[]):v is Draft=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const strings=(v:Draft)=>Object.values(v).every(x=>typeof x==='string');
const member=(v:unknown,values:readonly string[])=>typeof v==='string'&&['',...values].includes(v);
const rateKeys=['base','quote','rate','type','rate_date','valid_from','valid_to','reference'];
function choice(v:unknown):v is Draft{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;
 const c=v as Draft;
 if(c.kind==='UNRESOLVED')return exact(c,['kind']);
 if(c.kind!=='ROUND'&&c.kind!=='FX')return false;
 if(!exact(c,c.kind==='ROUND'?['kind','policy']:['kind','to','purpose','as_of','rate_source','policy']))return false;
 const p=c.policy;
 if(!exact(p,['kind','unit','mode','basis'])||!strings(p)||p.kind!=='EXPLICIT'||!member(p.mode,['HALF_UP','HALF_EVEN','DOWN']))return false;
 if(c.kind==='FX'){
  if(typeof c.to!=='string'||typeof c.as_of!=='string'||!member(c.purpose,['COMMERCIAL_REVIEW','CUSTOMS_COMPONENT_REVIEW']))return false;
  if(!exact(c.rate_source,rateKeys)||!strings(c.rate_source)||!member(c.rate_source.type,['CONTRACT','MARKET','CUSTOMS']))return false;
 }
 return true;
}
/** Projection accepts incomplete strings, never unknown keys or duplicate JSON keys. */
export function readFeePrecisionForm(text:string,isNew:boolean):Draft|null{
 try{
  const v=parseFeePrecisionSelectionJson(text,64*1024);
  if(!isNew)return choice(v)?v:null;
  if(!exact(v,['component_record_id','channel','choice'])||typeof v.component_record_id!=='string'||!member(v.channel,FEE_PRECISION_CHANNELS)||!choice(v.choice))return null;
  return v;
 }catch{return null;}
}
export function newFeePrecisionForm():string{return JSON.stringify({component_record_id:'',channel:'',choice:{kind:'UNRESOLVED'}},null,2);}
/** Closed field paths. No money capture, default unit, rate, mode, date or currency. */
export function changeFeePrecisionForm(text:string,isNew:boolean,path:string,value:string):string|null{
 const v=readFeePrecisionForm(text,isNew);if(!v)return null;
 const c=(isNew?v.choice:v) as Draft;
 if(isNew&&path==='component_record_id')v.component_record_id=value;
 else if(isNew&&path==='channel'){if(!member(value,FEE_PRECISION_CHANNELS))return null;v.channel=value;}
 else if(path==='choice.kind'){
  if(!['UNRESOLVED','ROUND','FX'].includes(value))return null;
  if(c.kind===value)return text;
  const policy={kind:'EXPLICIT',unit:'',mode:'',basis:''};
  const next=value==='UNRESOLVED'?{kind:value}:value==='ROUND'?{kind:value,policy}:{kind:value,to:'',purpose:'',as_of:'',rate_source:Object.fromEntries(rateKeys.map(k=>[k,''])),policy};
  if(isNew)v.choice=next;else return JSON.stringify(next,null,2);
 }else if(path.startsWith('policy.')&&c.kind!=='UNRESOLVED'){
  const key=path.slice(7);if(!['unit','mode','basis'].includes(key)||key==='mode'&&!member(value,['HALF_UP','HALF_EVEN','DOWN']))return null;
  (c.policy as Draft)[key]=value;
 }else if(c.kind==='FX'&&['to','purpose','as_of'].includes(path)){
  if(path==='purpose'&&!member(value,['COMMERCIAL_REVIEW','CUSTOMS_COMPONENT_REVIEW']))return null;c[path]=value;
 }else if(c.kind==='FX'&&path.startsWith('rate_source.')){
  const key=path.slice(12);if(!rateKeys.includes(key)||key==='type'&&!member(value,['CONTRACT','MARKET','CUSTOMS']))return null;(c.rate_source as Draft)[key]=value;
 }else return null;
 return JSON.stringify(v,null,2);
}
