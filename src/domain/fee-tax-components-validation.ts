import {FeeTaxComponentsInputError,FEE_TAX_LINE_LIMIT,type FeeTaxComponentInput,type FeeTaxComponentBatch} from './fee-tax-components.js';
const fail=(path:string,reason:string):never=>{throw new FeeTaxComponentsInputError(path,reason)};
/** Copy plain own data fields without invoking accessors or retaining caller-owned objects. */
function fields(value:unknown,path:string,keys:readonly string[]):Record<string,unknown>{
 try{
  if(value===null||typeof value!=='object'||Array.isArray(value))return fail(path,'须为字段明确的对象');
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null)return fail(path,'只接受普通数据对象');
  const descriptors=Object.getOwnPropertyDescriptors(value),actual=Reflect.ownKeys(descriptors);
  if(actual.length!==keys.length||actual.some(k=>typeof k!=='string'||!keys.includes(k)))return fail(path,'缺少字段或包含未知字段');
  const result:Record<string,unknown>=Object.create(null);
  for(const key of keys){const descriptor=descriptors[key];if(!descriptor||!('value'in descriptor)||!descriptor.enumerable)return fail(path,'只接受可枚举的数据字段，不读取访问器');result[key]=descriptor.value;}
  return result;
 }catch(error){if(error instanceof FeeTaxComponentsInputError)throw error;return fail(path,'无法读取数据对象');}
}
function kind(value:unknown,path:string):unknown{
 if(value===null||typeof value!=='object')return fail(path,'须明确分支');
 try{const descriptor=Object.getOwnPropertyDescriptor(value,'kind');if(!descriptor||!('value'in descriptor))return fail(path,'须明确kind数据字段');return descriptor.value;}
 catch(error){if(error instanceof FeeTaxComponentsInputError)throw error;return fail(path,'无法读取分支');}
}
function decimal(value:unknown,path:string):string{
 if(typeof value!=='string'||value.length>43||!/^(0|[1-9]\d{0,23})(\.\d{1,18})?$/.test(value))return fail(path,'须为最多24位整数、18位小数的非负十进制文本');return value;
}
function reference(value:unknown,path:string):string{if(typeof value!=='string'||!value.trim()||value.length>200)return fail(path,'须填写不超过200个UTF-16代码单元的依据');return value;}
function currency(value:unknown,path:string):string{if(typeof value!=='string'||!/^[A-Z]{3}$/.test(value))return fail(path,'须为三位大写币种代码');return value;}
/** Structural parser only. Exact sum/range checks are performed by the independent calculator. */
export function parseFeeTaxComponentInput(value:unknown,path='line'):FeeTaxComponentInput{
 const v=fields(value,path,['line_id','currency','gross','tax','credit','customs']);
 if(typeof v.line_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(v.line_id))return fail(path+'.line_id','须为1至80位ASCII标识');
 const id=v.line_id,unit=currency(v.currency,path+'.currency'),gross=v.gross===null?null:decimal(v.gross,path+'.gross');
 let tax:FeeTaxComponentInput['tax'];
 switch(kind(v.tax,path+'.tax')){
  case 'UNKNOWN':fields(v.tax,path+'.tax',['kind']);tax={kind:'UNKNOWN'};break;
  case 'NO_SEPARATION':fields(v.tax,path+'.tax',['kind']);tax={kind:'NO_SEPARATION'};break;
  case 'EXPLICIT':{const x=fields(v.tax,path+'.tax',['kind','net','tax']);tax={kind:'EXPLICIT',net:decimal(x.net,path+'.tax.net'),tax:decimal(x.tax,path+'.tax.tax')};break;}
  case 'GROSS_RATE':{const x=fields(v.tax,path+'.tax',['kind','rate']);tax={kind:'GROSS_RATE',rate:decimal(x.rate,path+'.tax.rate')};break;}
  default:return fail(path+'.tax','未支持的价税分支');
 }
 let credit:FeeTaxComponentInput['credit'];
 switch(kind(v.credit,path+'.credit')){
  case 'UNKNOWN':fields(v.credit,path+'.credit',['kind']);credit={kind:'UNKNOWN'};break;
  case 'NONE':{const x=fields(v.credit,path+'.credit',['kind','basis']);credit={kind:'NONE',basis:reference(x.basis,path+'.credit.basis')};break;}
  case 'ASSUMED':{const x=fields(v.credit,path+'.credit',['kind','amount','basis','document_ref','eligibility_ref']);credit={kind:'ASSUMED',amount:decimal(x.amount,path+'.credit.amount'),basis:reference(x.basis,path+'.credit.basis'),document_ref:reference(x.document_ref,path+'.credit.document_ref'),eligibility_ref:reference(x.eligibility_ref,path+'.credit.eligibility_ref')};break;}
  default:return fail(path+'.credit','未支持的抵扣假设分支');
 }
 let customs:FeeTaxComponentInput['customs'];
 switch(kind(v.customs,path+'.customs')){
  case 'UNKNOWN':fields(v.customs,path+'.customs',['kind']);customs={kind:'UNKNOWN'};break;
  case 'NOT_ADDED':{const x=fields(v.customs,path+'.customs',['kind','basis']);customs={kind:'NOT_ADDED',basis:reference(x.basis,path+'.customs.basis')};break;}
  case 'ADD_COMPONENT':{const x=fields(v.customs,path+'.customs',['kind','amount','basis']);customs={kind:'ADD_COMPONENT',amount:decimal(x.amount,path+'.customs.amount'),basis:reference(x.basis,path+'.customs.basis')};break;}
  default:return fail(path+'.customs','未支持的海关成分分支');
 }
 return{line_id:id,currency:unit,gross,tax,credit,customs};
}
export function parseFeeTaxComponentBatch(value:unknown):FeeTaxComponentBatch{
 const v=fields(value,'batch',['currency','rows']),unit=currency(v.currency,'batch.currency');
 let elements:unknown[];
 try{
  if(!Array.isArray(v.rows))return fail('batch.rows','须为完整数据行数组');
  const descriptors=Object.getOwnPropertyDescriptors(v.rows) as unknown as Record<string,PropertyDescriptor>,length=descriptors['length']?.value;
  if(!Number.isInteger(length)||length<1||length>FEE_TAX_LINE_LIMIT||Reflect.ownKeys(descriptors).length!==length+1)return fail('batch.rows','须完整提供1至8行，不含额外字段或缺行');
  elements=[];
  for(let i=0;i<length;i++){const descriptor=descriptors[String(i)];if(!descriptor||!('value'in descriptor)||!descriptor.enumerable)return fail(`batch.rows.${i}`,'须为明确数据行');elements.push(descriptor.value);}
 }catch(error){if(error instanceof FeeTaxComponentsInputError)throw error;return fail('batch.rows','无法读取数据行');}
 // Sparse arrays and accessor elements cannot silently disappear in map().
 const rows:FeeTaxComponentInput[]=[],ids=new Set<string>();
 for(let i=0;i<elements.length;i++){
  const row=parseFeeTaxComponentInput(elements[i],`batch.rows.${i}`);
  if(row.currency!==unit)return fail(`batch.rows.${i}.currency`,'不同币种不能相加');
  if(ids.has(row.line_id))return fail(`batch.rows.${i}.line_id`,'同一集合内行标识不能重复');
  ids.add(row.line_id);rows.push(row);
 }
 return{currency:unit,rows};
}
