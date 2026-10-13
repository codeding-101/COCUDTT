import Decimal from 'decimal.js';
import type {FundingResult} from './funding.js';
import type {FundingPeriodAudit,FundingPeriodRounding,FundingPeriodSchedule} from '../domain/funding-periods.js';
import {validateFundingPeriodRounding,validateFundingPeriodSchedule} from '../domain/funding-periods-validation.js';
import {isIsoDate} from './tax/china-import.js';

const Money=Decimal.clone({precision:256,rounding:Decimal.ROUND_HALF_UP});
const fail=(message:string):never=>{throw Error(`期间归集假设未完成：${message}`);};
interface Fraction {n:bigint;d:bigint}
function gcd(a:bigint,b:bigint):bigint{a=a<0n?-a:a;while(b){const c=a%b;a=b;b=c;}return a;}
function fraction(n:bigint,d:bigint):Fraction{const g=gcd(n,d);return{n:n/g,d:d/g};}
function add(a:Fraction,b:Fraction):Fraction{return fraction(a.n*b.d+b.n*a.d,a.d*b.d);}
function subtract(a:Fraction,b:Fraction):Fraction{return add(a,{n:-b.n,d:b.d});}
const exact=(f:Fraction):string=>`${f.n} / ${f.d}`;
const display=(f:Fraction):string=>new Money(f.n.toString()).div(f.d.toString()).toFixed();
function number(text:string,label:string,positive=false):string{
  if(typeof text!=='string')return fail(`${label}须为十进制文本`);
  const raw=text.trim();
  if(raw.length>160||!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw))return fail(`${label}须为非负十进制文本，不接受指数、负数或千分位`);
  const value=new Money(raw);
  if(!value.isFinite()||value.sd()>80||value.dp()>40||(positive?value.lte(0):value.lt(0)))return fail(`${label}须${positive?'大于0':'非负'}，最多80有效位与40小数位`);
  return value.toFixed();
}
function decimal(text:string):{coefficient:bigint;scale:number}{
  const [whole='',part='']=text.split('.');return{coefficient:BigInt(whole+part),scale:part.length};
}
function fixed(coefficient:bigint,scale:number):string{
  const sign=coefficient<0n?'-':'',digits=(coefficient<0n?-coefficient:coefficient).toString().padStart(scale+1,'0');
  return sign+(scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits);
}
function interest(principal:string,rate:string,days:number,denominator:number):Fraction{
  const p=decimal(principal),r=decimal(rate);
  return fraction(p.coefficient*r.coefficient*BigInt(days),10n**BigInt(p.scale+r.scale)*100n*BigInt(denominator));
}
function roundedUnits(value:Fraction,unit:{coefficient:bigint;scale:number},mode:FundingPeriodAudit['mode']):bigint{
  const n=value.n*10n**BigInt(unit.scale),d=value.d*unit.coefficient,q=n/d,remainder=n%d;
  if(mode==='DOWN')return q;
  return q+(remainder*2n>d||remainder*2n===d&&(mode==='HALF_UP'||q%2n===1n)?1n:0n);
}
function day(date:string):number{
  if(typeof date!=='string'||!isIsoDate(date))return fail('日期须为真实有效的YYYY-MM-DD');
  return Date.parse(date+'T00:00:00Z')/86400000;
}
function reference(text:string,label:string):string{
  if(typeof text!=='string'||text.length>4000||!text.trim())return fail(`${label}须记录依据`);return text;
}
/** Explicit audit over a validated UNROUNDED result; isolated from cash flow and trade/tax cost.
 * Rebuild exact interest from original segment inputs; never apportion rounded cost strings.
 * Null means explicitly not applied, not zero interest. All inputs remain untouched.
 */
export function calculateFundingPeriods(result:FundingResult,schedule:FundingPeriodSchedule,rounding:FundingPeriodRounding):FundingPeriodAudit|null{
  validateFundingPeriodSchedule(schedule);validateFundingPeriodRounding(rounding);
  if(rounding.status==='NOT_APPLIED')return null;
  if(rounding.status!=='APPLIED'||rounding.mode==='UNCONFIRMED')return fail('请明确是否应用及舍入方式，未知不当作已应用');
  if(schedule.status!=='PROVIDED'||!schedule.periods_confirmed)return fail('须明确期间表并独立确认边界，不沿用旧逐区间确认');
  reference(schedule.reference,'整体期间');reference(rounding.reference,'金额步长、方式和时点');
  if(!['FINANCING','OPPORTUNITY'].includes(result.kind)||!['BUYER','SELLER'].includes(result.party)||! /^[A-Z]{3}$/.test(result.currency)||![360,365].includes(result.denominator))return fail('原资金结果的主体、性质、币种或年基数无效');
  reference(result.reference,'原资金');number(result.principal,'原期初本金');number(result.annual_rate,'原期初年利率');
  const start=day(result.start_date),end=day(result.end_date);
  if(end<start||result.days!==end-start)return fail('原测算起止日或天数不一致');
  let previous=start;
  const periods=schedule.periods.map(row=>{
    const from=day(row.start_date),to=day(row.end_date);reference(row.reference,`期间${row.id}`);
    if(to<=from)return fail('归集期须为正长度；零天数总期间须明确空表');
    if(from!==previous||from<start||to>end)return fail('期间须按原列表连续、无重叠并完整覆盖测算范围');previous=to;
    return{row,from,to};
  });
  if(previous!==end||start===end&&periods.length!==0)return fail('期间须完整覆盖起止日，不自动补首期或尾期');
  const source=result.ledger?.segments??(result.days?[{start_date:result.start_date,end_date:result.end_date,days:result.days,principal:result.principal,annual_rate:result.annual_rate,rate_reference:result.reference}]:[]);
  if(!Array.isArray(source))return fail('原计算分段须为数组');
  previous=start;
  const segments=source.map((row,index)=>{
    const from=day(row.start_date),to=day(row.end_date);
    if(to<=from||from!==previous||to>end||row.days!==to-from)return fail('原计算分段的范围、顺序或天数不一致');previous=to;
    const principal=number(row.principal,'分段本金'),rate=number(row.annual_rate??result.annual_rate,'分段年利率');
    const principalReferences=[result.reference,...(result.ledger?.events??[]).filter(event=>day(event.date)<=from).map(event=>reference(event.reference,'本金事件'))];
    return{index,from,to,principal,rate,principalReferences,rateReference:reference(row.rate_reference??result.reference,'分段利率')};
  });
  if(previous!==end||start===end&&segments.length!==0)return fail('原计算分段未完整覆盖测算范围');
  const unitText=number(rounding.unit,'金额步长',true),unit=decimal(unitText),unitFraction=fraction(unit.coefficient,10n**BigInt(unit.scale));
  const mode=rounding.mode;
  let total:Fraction={n:0n,d:1n},periodUnits=0n;
  const rows=periods.map(({row,from,to})=>{
    let value:Fraction={n:0n,d:1n};
    const fragments=segments.flatMap(segment=>{
      const a=Math.max(from,segment.from),b=Math.min(to,segment.to);if(b<=a)return[];
      const amount=interest(segment.principal,segment.rate,b-a,result.denominator);value=add(value,amount);
      return[{segment_index:segment.index,start_date:new Date(a*86400000).toISOString().slice(0,10),end_date:new Date(b*86400000).toISOString().slice(0,10),days:b-a,
        principal:segment.principal,annual_rate:segment.rate,principal_references:[...segment.principalReferences],rate_reference:segment.rateReference,unrounded_cost:display(amount),unrounded_fraction:exact(amount)}];
    });
    total=add(total,value);
    const count=roundedUnits(value,unit,mode),adjustment=subtract(fraction(count*unitFraction.n,unitFraction.d),value);periodUnits+=count;
    return{id:row.id,start_date:row.start_date,end_date:row.end_date,reference:row.reference,days:to-from,unrounded_cost:display(value),unrounded_fraction:exact(value),rounded_cost:fixed(count*unit.coefficient,unit.scale),adjustment:display(adjustment),adjustment_fraction:exact(adjustment),fragments};
  });
  const original=segments.reduce((sum,row)=>add(sum,interest(row.principal,row.rate,row.to-row.from,result.denominator)),{n:0n,d:1n});
  if(total.n!==original.n||total.d!==original.d)return fail('期间汇总与原分段精确原值不一致');
  const totalUnits=roundedUnits(total,unit,mode),adjustment=subtract(fraction(periodUnits*unitFraction.n,unitFraction.d),total);
  return{scope:'PERIODS',currency:result.currency,mode,unit:unitText,reference:rounding.reference,schedule_reference:schedule.reference,periods_confirmed:true,days:result.days,calculation_segment_count:segments.length,
    unrounded_cost:display(total),unrounded_fraction:exact(total),rounded_cost:fixed(periodUnits*unit.coefficient,unit.scale),total_rounded:fixed(totalUnits*unit.coefficient,unit.scale),scope_difference:fixed((periodUnits-totalUnits)*unit.coefficient,unit.scale),
    adjustment:display(adjustment),adjustment_fraction:exact(adjustment),periods:rows};
}
