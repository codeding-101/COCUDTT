import type {FundingPeriodRounding,FundingPeriodSchedule} from './funding-periods.js';
const fail=(message:string):never=>{throw Error(`期间归集结构：${message}`);};
function object(value:unknown,label:string):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))return fail(`${label}须为对象`);
  return value as Record<string,unknown>;
}
function texts(row:Record<string,unknown>,keys:readonly string[],label:string):void{
  for(const key of keys)if(typeof row[key]!=='string'||(row[key] as string).length>4000)fail(`${label}.${key}须为不超过4000字符的文本`);
}
function choice(row:Record<string,unknown>,key:string,values:readonly string[]):void{
  if(typeof row[key]!=='string'||!values.includes(row[key] as string))fail(`${key}选项无效`);
}
/** Draft validation only; coverage, dates, references and confirmation are business checks. */
export function validateFundingPeriodSchedule(value:unknown):asserts value is FundingPeriodSchedule{
  const schedule=object(value,'期间表');choice(schedule,'status',['UNCONFIRMED','PROVIDED']);texts(schedule,['reference'],'期间表');
  if(typeof schedule.periods_confirmed!=='boolean')fail('期间边界确认须为布尔值');
  if(!Array.isArray(schedule.periods)||schedule.periods.length>100)fail('期间须为最多100行的数组');
  const ids=new Set<string>();
  (schedule.periods as unknown[]).forEach((entry,index)=>{
    const row=object(entry,`期间[${index}]`);texts(row,['id','start_date','end_date','reference'],'期间');
    const id=row.id as string;
    if(!id.trim()||['__proto__','constructor','prototype'].includes(id)||ids.has(id))fail('期间ID为空、保留名称或重复');ids.add(id);
  });
}
export function validateFundingPeriodRounding(value:unknown):asserts value is FundingPeriodRounding{
  const rounding=object(value,'期间舍入');choice(rounding,'status',['UNCONFIRMED','NOT_APPLIED','APPLIED']);choice(rounding,'scope',['PERIODS']);
  choice(rounding,'mode',['UNCONFIRMED','HALF_UP','HALF_EVEN','DOWN']);texts(rounding,['unit','reference'],'期间舍入');
}
