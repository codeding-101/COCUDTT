import {FeePrecisionInputError,type PrecisionAmount,type PrecisionPolicy,type ExplicitPrecisionPolicy,type FeeRoundingInput,type FeePrecisionGroupInput,type FeePrecisionSplitInput,type FeePrecisionFxInput,type FeePrecisionStageInput} from './fee-precision.js';
const fail=(path:string,reason:string):never=>{throw new FeePrecisionInputError(path,reason);};
function fields(value:unknown,path:string,keys:readonly string[]):Record<string,unknown>{
 try{
  if(!value||typeof value!=='object'||Array.isArray(value))return fail(path,'须为普通数据对象');
  const proto=Object.getPrototypeOf(value);if(proto!==Object.prototype&&proto!==null)return fail(path,'不接受类实例或自定义原型');
  const descriptors=Object.getOwnPropertyDescriptors(value),actual=Reflect.ownKeys(descriptors);
  if(actual.length!==keys.length||actual.some(k=>typeof k!=='string'||!keys.includes(k)))return fail(path,'缺少字段或存在未知字段');
  const out:Record<string,unknown>=Object.create(null);
  for(const key of keys){const d=descriptors[key];if(!d||!('value'in d)||!d.enumerable)return fail(path+'.'+key,'只读取可枚举数据字段，不读取访问器');out[key]=d.value;}
  return out;
 }catch(error){if(error instanceof FeePrecisionInputError)throw error;return fail(path,'无法读取数据对象');}
}
function branch(value:unknown,path:string):unknown{
 try{if(!value||typeof value!=='object')return fail(path,'须明确kind分支');const d=Object.getOwnPropertyDescriptor(value,'kind');if(!d||!('value'in d))return fail(path+'.kind','须为数据字段');return d.value;}
 catch(error){if(error instanceof FeePrecisionInputError)throw error;return fail(path,'无法读取分支');}
}
const decimal=(v:unknown,path:string):string=>{if(typeof v!=='string'||v.length>43||!/^(0|[1-9]\d{0,23})(\.\d{1,18})?$/.test(v))return fail(path,'须为最多24位整数、18位小数的非负十进制文本');return v;};
const currency=(v:unknown,path:string):string=>{if(typeof v!=='string'||!/^[A-Z]{3}$/.test(v))return fail(path,'须为三位大写代码；代码本身不证明币种可用或金额步长');return v;};
const reference=(v:unknown,path:string):string=>{if(typeof v!=='string'||v.length>200||!v.trim())return fail(path,'须有不超过200个UTF-16代码单元的依据');return v;};
function amount(v:unknown,path:string):PrecisionAmount{
 if(v===null)return null;if(typeof v==='string')return decimal(v,path);
 const f=fields(v,path,['numerator','denominator']);
 if(typeof f.numerator!=='string'||f.numerator.length>80||!/^(0|[1-9]\d*)$/.test(f.numerator))return fail(path+'.numerator','须为最多80位的非负整数字符串');
 if(typeof f.denominator!=='string'||f.denominator.length>80||!/^[1-9]\d*$/.test(f.denominator))return fail(path+'.denominator','须为最多80位的正整数字符串');
 let a=BigInt(f.numerator),b=BigInt(f.denominator);while(b)[a,b]=[b,a%b];if(a!==1n)return fail(path,'分数须既约，零须为0/1');
 return{numerator:f.numerator,denominator:f.denominator};
}
function policy(v:unknown,path:string,required:true):ExplicitPrecisionPolicy;
function policy(v:unknown,path:string,required?:false):PrecisionPolicy;
function policy(v:unknown,path:string,required=false):PrecisionPolicy{
 const kind=branch(v,path);if(kind==='UNRESOLVED'){fields(v,path,['kind']);if(required)return fail(path,'此核对须明确舍入政策');return{kind:'UNRESOLVED'};}
 if(kind!=='EXPLICIT')return fail(path+'.kind','未支持的政策分支');
 const p=fields(v,path,['kind','unit','mode','basis']),unit=decimal(p.unit,path+'.unit'),[whole,part='']=unit.split('.');
 if(!['HALF_UP','HALF_EVEN','DOWN'].includes(p.mode as string))return fail(path+'.mode','须明确HALF_UP/HALF_EVEN/DOWN');
 if(!/[1-9]/.test(unit)||BigInt(whole!)>1n||whole==='1'&&/[1-9]/.test(part)||part.replace(/0+$/,'').length>6)return fail(path+'.unit','步长须大于0、不超过1，去尾零后最多6位小数；不按币种推定');
 return{kind:'EXPLICIT',unit,mode:p.mode as ExplicitPrecisionPolicy['mode'],basis:reference(p.basis,path+'.basis')};
}
function date(v:unknown,path:string):string{
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return fail(path,'须为YYYY-MM-DD');
 const d=new Date(v+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==v)return fail(path,'日期不存在');return v;
}
export function parseFeeRoundingInput(value:unknown):FeeRoundingInput{
 const v=fields(value,'round',['currency','amount','policy']);return{currency:currency(v.currency,'round.currency'),amount:amount(v.amount,'round.amount'),policy:policy(v.policy,'round.policy')};
}
export function parseFeePrecisionGroupInput(value:unknown):FeePrecisionGroupInput{
 const v=fields(value,'group',['currency','rows','policy','scope']),unit=currency(v.currency,'group.currency');let elements:unknown[];
 try{
  if(!Array.isArray(v.rows)||Object.getPrototypeOf(v.rows)!==Array.prototype)return fail('group.rows','须为普通完整数组');
  const descriptors=Object.getOwnPropertyDescriptors(v.rows) as unknown as Record<string,PropertyDescriptor>,length=descriptors.length?.value;
  if(!Number.isInteger(length)||length<1||length>8||Reflect.ownKeys(descriptors).length!==length+1)return fail('group.rows','须完整提供1至8行，无缺行或额外字段');
  elements=[];for(let i=0;i<length;i++){const d=descriptors[String(i)];if(!d||!('value'in d)||!d.enumerable)return fail('group.rows.'+i,'须为明确数据行');elements.push(d.value);}
 }catch(error){if(error instanceof FeePrecisionInputError)throw error;return fail('group.rows','无法读取数据行');}
 const ids=new Set<string>(),rows=elements.map((raw,i)=>{
  const path='group.rows.'+i,r=fields(raw,path,['line_id','currency','amount']);
  if(typeof r.line_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(r.line_id)||ids.has(r.line_id))return fail(path+'.line_id','须为不重复的1至80位ASCII标识');ids.add(r.line_id);
  const code=currency(r.currency,path+'.currency');if(code!==unit)return fail(path+'.currency','不同币种不能合计');
  return{line_id:r.line_id,currency:code,amount:amount(r.amount,path+'.amount')};
 });
 if(v.scope!=='PER_LINE'&&v.scope!=='TOTAL')return fail('group.scope','须明确逐行或汇总层级');
 return{currency:unit,rows,policy:policy(v.policy,'group.policy',true),scope:v.scope};
}
export function parseFeePrecisionSplitInput(value:unknown):FeePrecisionSplitInput{
 const v=fields(value,'split',['currency','gross','net','tax','credit','customs','policy']);
 return{currency:currency(v.currency,'split.currency'),gross:amount(v.gross,'split.gross'),net:amount(v.net,'split.net'),tax:amount(v.tax,'split.tax'),credit:amount(v.credit,'split.credit'),customs:amount(v.customs,'split.customs'),policy:policy(v.policy,'split.policy',true)};
}
export function parseFeePrecisionFxInput(value:unknown):FeePrecisionFxInput{
 const v=fields(value,'fx',['amount','from','to','purpose','channel','as_of','rate_source','policy']),path='fx.rate_source',r=fields(v.rate_source,path,['base','quote','rate','type','rate_date','valid_from','valid_to','reference']);
 if(v.purpose!=='COMMERCIAL_REVIEW'&&v.purpose!=='CUSTOMS_COMPONENT_REVIEW')return fail('fx.purpose','未支持的换算目的');
 if(!['cash','net','tax','credit','economic','customs'].includes(v.channel as string))return fail('fx.channel','未支持的成分通道');
 if(!['CONTRACT','MARKET','CUSTOMS'].includes(r.type as string))return fail(path+'.type','未支持的来源类型');
 return{amount:amount(v.amount,'fx.amount'),from:currency(v.from,'fx.from'),to:currency(v.to,'fx.to'),purpose:v.purpose,channel:v.channel as FeePrecisionFxInput['channel'],as_of:date(v.as_of,'fx.as_of'),policy:policy(v.policy,'fx.policy',true),rate_source:{base:currency(r.base,path+'.base'),quote:currency(r.quote,path+'.quote'),rate:decimal(r.rate,path+'.rate'),type:r.type as FeePrecisionFxInput['rate_source']['type'],rate_date:date(r.rate_date,path+'.rate_date'),valid_from:date(r.valid_from,path+'.valid_from'),valid_to:date(r.valid_to,path+'.valid_to'),reference:reference(r.reference,path+'.reference')}};
}
export function parseFeePrecisionStageInput(value:unknown):FeePrecisionStageInput{
 const v=fields(value,'stages',['amount','rate','intermediate','final']);return{amount:amount(v.amount,'stages.amount'),rate:decimal(v.rate,'stages.rate'),intermediate:policy(v.intermediate,'stages.intermediate',true),final:policy(v.final,'stages.final',true)};
}
