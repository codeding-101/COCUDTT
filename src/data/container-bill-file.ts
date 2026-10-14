import type {ContainerBillDraft} from '../domain/container-bill-draft.js';
import type {SourceEvidence} from '../domain/source-evidence.js';

export const CONTAINER_BILL_FILE_BYTES=5*1024*1024;
const encoder=new TextEncoder(),RESERVED=['__proto__','constructor','prototype'];
function fail(path:string):never {throw Error(`CONTAINER_BILL_FILE_INVALID:${path}`);}
function object(value:unknown,path:string,required:string[],optional:string[]=[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail(path);
 const obj=value as Record<string,unknown>;
 if(required.some(k=>!Object.hasOwn(obj,k))||Object.keys(obj).some(k=>!required.includes(k)&&!optional.includes(k)))fail(path);
 return obj;
}
function text(value:unknown,path:string,max=200,id=false):asserts value is string {
 if(typeof value!=='string'||Array.from(value).length>max||id&&(!value.trim()||RESERVED.includes(value)))fail(path);
}
/** Reject lossy JSON serialization before JSON.stringify can drop or coerce data. */
function json(value:unknown,maxDepth:number,maxNodes:number):void {
 let nodes=0;const parents=new Set<object>();
 const visit=(v:unknown,depth:number):void=>{
  if(++nodes>maxNodes||depth>maxDepth)fail('JSON_CONTENT');
  if(v===null||typeof v==='string'||typeof v==='boolean')return;
  if(typeof v==='number'){if(!Number.isFinite(v))fail('JSON_CONTENT');return;}
  if(!v||typeof v!=='object'||parents.has(v)||Object.getOwnPropertySymbols(v).length)fail('JSON_CONTENT');
  parents.add(v);
  if(Array.isArray(v)){
   if(Object.getPrototypeOf(v)!==Array.prototype||Object.keys(v).length!==v.length)fail('JSON_CONTENT');
   for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail('JSON_CONTENT');visit(d.value,depth+1);}
  }else{
   if(![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('JSON_CONTENT');
   const descriptors=Object.getOwnPropertyDescriptors(v);for(const d of Object.values(descriptors)){if(!d.enumerable||!Object.hasOwn(d,'value'))fail('JSON_CONTENT');visit(d.value,depth+1);}
  }
  parents.delete(v);
 };visit(value,0);
}
function evidence(value:unknown,path:string):void {
 const e=object(value,path,['reference','valid_from','valid_to','checked_on','status'],['values_key']);
 for(const key of ['reference','valid_from','valid_to','checked_on'])text(e[key],path+'.'+key,4000);
 if(!['EXAMPLE','UNVERIFIED','USER_CONFIRMED'].includes(e.status as string))fail(path+'.status');
 if(Object.hasOwn(e,'values_key'))text(e.values_key,path+'.values_key',1048576);
}
export function validateContainerBillEvidence(value:unknown):asserts value is SourceEvidence {
 json(value,32,200000);evidence(value,'evidence');
}
export function validateContainerBillDraft(value:unknown):asserts value is ContainerBillDraft {
 json(value,32,200000);
 const file=object(value,'root',['kind','version','id','name','review_date','binding','notes','rows'],['extensions']);
 if(file.kind!=='INTERNAL_CONTAINER_BILL'||file.version!=='1.0')fail('kind/version');
 text(file.id,'id',200,true);text(file.name,'name',4000);text(file.review_date,'review_date');text(file.notes,'notes',4000);
 if(file.binding!==null){const b=object(file.binding,'binding',['term','context_key']);text(b.term,'binding.term');text(b.context_key,'binding.context_key',1048576);}
 if(!Array.isArray(file.rows)||file.rows.length>50)fail('rows');
 const ids=new Set<string>();
 for(const[index,raw]of file.rows.entries()){
  const p=`rows[${index}]`,row=object(raw,p,['input'],['evidence','cost_reference']);
  const input=object(row.input,p+'.input',['line_id'],['scope_id','direction','equipment_type','container_ids','currency','reference','charge_kind','mode','rate','period','daily']);
  text(input.line_id,p+'.input.line_id',200,true);if(ids.has(input.line_id))fail(p+'.input.line_id');ids.add(input.line_id);
  for(const key of ['scope_id','direction','equipment_type','currency','charge_kind','mode','rate'])if(Object.hasOwn(input,key))text(input[key],p+'.input.'+key);
  if(Object.hasOwn(input,'reference'))text(input.reference,p+'.input.reference',4000);
  if(Object.hasOwn(input,'container_ids')){if(!Array.isArray(input.container_ids)||input.container_ids.length>50)fail(p+'.input.container_ids');for(const id of input.container_ids)text(id,p+'.input.container_ids');}
  if(Object.hasOwn(input,'period')&&input.period!==null){
   const q=p+'.input.period',period=object(input.period,q,[],['start_date','end_date','start_included','end_included','start_event','end_event']);
   for(const key of ['start_date','end_date','start_event','end_event'])if(Object.hasOwn(period,key))text(period[key],q+'.'+key);
   for(const key of ['start_included','end_included'])if(Object.hasOwn(period,key)&&period[key]!==null&&typeof period[key]!=='boolean')fail(q+'.'+key);
  }
  if(Object.hasOwn(input,'daily')&&input.daily!==null){
   const q=p+'.input.daily',daily=object(input.daily,q,[],['free_day_basis','charge_day_basis','free_days','tier_mode','tier_basis','tiers']);
   for(const key of ['free_day_basis','charge_day_basis','tier_mode','tier_basis'])if(Object.hasOwn(daily,key))text(daily[key],q+'.'+key);
   if(Object.hasOwn(daily,'free_days')&&daily.free_days!==null&&(!Number.isSafeInteger(daily.free_days)||typeof daily.free_days!=='number'))fail(q+'.free_days');
   if(Object.hasOwn(daily,'tiers')){
    if(!Array.isArray(daily.tiers)||daily.tiers.length>20)fail(q+'.tiers');
    for(const[index,t]of daily.tiers.entries()){
     const tp=q+`.tiers[${index}]`,tier=object(t,tp,[],['through_day','rate']);
     if(Object.hasOwn(tier,'rate'))text(tier.rate,tp+'.rate');
     if(Object.hasOwn(tier,'through_day')&&tier.through_day!==null&&(!Number.isSafeInteger(tier.through_day)||typeof tier.through_day!=='number'))fail(tp+'.through_day');
    }
   }
  }
  if(Object.hasOwn(row,'evidence'))evidence(row.evidence,p+'.evidence');
  if(Object.hasOwn(row,'cost_reference')){
   const r=object(row.cost_reference,p+'.cost_reference',['cost_id','note'],['evidence']);text(r.cost_id,p+'.cost_reference.cost_id');text(r.note,p+'.cost_reference.note',4000);
   if(Object.hasOwn(r,'evidence'))evidence(r.evidence,p+'.cost_reference.evidence');
  }
 }
 if(Object.hasOwn(file,'extensions')){
  if(!file.extensions||typeof file.extensions!=='object'||Array.isArray(file.extensions))fail('extensions');
  json(file.extensions,8,10000);if(encoder.encode(JSON.stringify(file.extensions)).length>256*1024)fail('extensions.size');
 }
 if(encoder.encode(JSON.stringify(value,null,2)+'\n').length>CONTAINER_BILL_FILE_BYTES)fail('size');
}
export function parseContainerBillDraft(source:string):ContainerBillDraft {
 if(typeof source!=='string'||source.length>CONTAINER_BILL_FILE_BYTES||encoder.encode(source).length>CONTAINER_BILL_FILE_BYTES)fail('size');
 let value:unknown;try{value=JSON.parse(source);}catch{fail('JSON');}
 validateContainerBillDraft(value);return value;
}
export function serializeContainerBillDraft(file:ContainerBillDraft):string {
 validateContainerBillDraft(file);return JSON.stringify(file,null,2)+'\n';
}

/** Offline structural schema; cross-row IDs and byte/depth bounds remain runtime checks. */
export function containerBillDraftSchema():Record<string,unknown>{
 const string=(maxLength=200)=>({type:'string',maxLength}),id={...string(),pattern:'\\S',not:{enum:RESERVED}};
 const obj=(properties:Record<string,unknown>,required:string[]=[])=>({type:'object',properties,required,additionalProperties:false});
 const nullable=(schema:unknown)=>({anyOf:[{type:'null'},schema]}),integer=nullable({type:'integer',minimum:Number.MIN_SAFE_INTEGER,maximum:Number.MAX_SAFE_INTEGER});
 const e=obj({reference:string(4000),valid_from:string(4000),valid_to:string(4000),checked_on:string(4000),status:{enum:['EXAMPLE','UNVERIFIED','USER_CONFIRMED']},values_key:string(1048576)},['reference','valid_from','valid_to','checked_on','status']);
 const input=obj({line_id:id,scope_id:string(),direction:string(),equipment_type:string(),container_ids:{type:'array',maxItems:50,items:string()},currency:string(),reference:string(4000),charge_kind:string(),mode:string(),rate:string(),
  period:nullable(obj({start_date:string(),end_date:string(),start_event:string(),end_event:string(),start_included:nullable({type:'boolean'}),end_included:nullable({type:'boolean'})})),
  daily:nullable(obj({free_day_basis:string(),charge_day_basis:string(),free_days:integer,tier_mode:string(),tier_basis:string(),tiers:{type:'array',maxItems:20,items:obj({through_day:integer,rate:string()})}}))},['line_id']);
 return{$schema:'http://json-schema.org/draft-07/schema#',$id:'urn:cocudtt:internal-container-bill:1.0',title:'COCUDTT internal container bill draft 1.0',description:'Draft shape only; unique line_id, JSON limits, byte bounds and supported calculations/sources/references require runtime review. No project costs are written.',
  ...obj({kind:{const:'INTERNAL_CONTAINER_BILL'},version:{const:'1.0'},id,name:string(4000),review_date:string(),binding:nullable(obj({term:string(),context_key:string(1048576)},['term','context_key'])),notes:string(4000),rows:{type:'array',maxItems:50,items:obj({input,evidence:e,cost_reference:obj({cost_id:string(),note:string(4000),evidence:e},['cost_id','note'])},['input'])},extensions:{type:'object'}},['kind','version','id','name','review_date','binding','notes','rows'])};
}
