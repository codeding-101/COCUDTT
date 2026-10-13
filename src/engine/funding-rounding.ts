import Decimal from 'decimal.js';
import type { FundingRoundingAssumption, FundingRoundingAudit } from '../domain/funding.js';
import type { FundingResult } from './funding.js';

const Money=Decimal.clone({precision:256,rounding:Decimal.ROUND_HALF_UP});
const fail=(message:string):never=>{throw Error(`金额舍入假设未完成：${message}`);};
interface Fraction {n:bigint;d:bigint}
function gcd(a:bigint,b:bigint):bigint {a=a<0n?-a:a;while(b){const r=a%b;a=b;b=r;}return a;}
function fraction(n:bigint,d:bigint):Fraction {const divisor=gcd(n,d);return{n:n/divisor,d:d/divisor};}
function add(a:Fraction,b:Fraction):Fraction {return fraction(a.n*b.d+b.n*a.d,a.d*b.d);}
function subtract(a:Fraction,b:Fraction):Fraction {return add(a,{n:-b.n,d:b.d});}
const exact=(f:Fraction):string=>`${f.n} / ${f.d}`;
const display=(f:Fraction):string=>new Money(f.n.toString()).div(f.d.toString()).toFixed();
function decimal(text:string):{coefficient:bigint;scale:number} {
  const [whole='',part='']=text.split('.');return{coefficient:BigInt(whole+part),scale:part.length};
}
function fixed(coefficient:bigint,scale:number):string {
  const sign=coefficient<0n?'-':'',digits=(coefficient<0n?-coefficient:coefficient).toString().padStart(scale+1,'0');
  return sign+(scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits);
}
function interest(principal:string,rate:string,days:number,denominator:number):Fraction {
  const p=decimal(principal),r=decimal(rate);
  return fraction(p.coefficient*r.coefficient*BigInt(days),10n**BigInt(p.scale+r.scale)*100n*BigInt(denominator));
}
function roundedUnits(value:Fraction,unit:{coefficient:bigint;scale:number},mode:FundingRoundingAudit['mode']):bigint {
  // Compare the exact rational remainder, never a pre-rounded recurring decimal.
  const n=value.n*10n**BigInt(unit.scale),d=value.d*unit.coefficient,q=n/d,remainder=n%d;
  if(mode==='DOWN')return q;
  const twice=remainder*2n;
  return q+(twice>d||twice===d&&(mode==='HALF_UP'||q%2n===1n)?1n:0n);
}
/** Post-process a validated unrounded result. No cash flow, cost/profit or bank-posting inference. */
export function applyFundingRounding(result:FundingResult,input:FundingRoundingAssumption):FundingResult {
  if(input.status==='NOT_APPLIED')return result;
  if(input.status!=='APPLIED'||input.scope==='UNCONFIRMED'||input.mode==='UNCONFIRMED')return fail('请明确是否应用、层级及舍入方式；未知不当作已舍入');
  if(!input.reference.trim())return fail('须记录金额步长、方式和舍入时点依据');
  if(input.scope==='INTERVALS'&&!input.intervals_confirmed)return fail('须确认计算区间就是本次拟采用的舍入边界；不自动视为银行结息日');
  const raw=input.unit.trim();
  if(raw.length>160||!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw))return fail('金额步长须为正十进制文本，不接受空白、指数、负数或千分位');
  const value=new Money(raw);
  if(!value.isFinite()||value.lte(0)||value.sd()>80||value.dp()>40)return fail('金额步长须大于0，最多80有效位与40小数位；不按币种推定');
  const unitText=value.toFixed(),unit=decimal(unitText),unitFraction=fraction(unit.coefficient,10n**BigInt(unit.scale));
  const segments=result.ledger?.segments??(result.days?[{start_date:result.start_date,end_date:result.end_date,days:result.days,principal:result.principal,annual_rate:result.annual_rate,cost:result.cost}]:[]);
  let total:Fraction={n:0n,d:1n},intervalUnits=0n;
  const intervals=segments.map(row=>{
    const original=interest(row.principal,row.annual_rate??result.annual_rate,row.days,result.denominator),count=roundedUnits(original,unit,input.mode as FundingRoundingAudit['mode']);
    total=add(total,original);intervalUnits+=count;
    const rounded=fraction(count*unitFraction.n,unitFraction.d),adjustment=subtract(rounded,original);
    return{start_date:row.start_date,end_date:row.end_date,unrounded_cost:row.cost,unrounded_fraction:exact(original),rounded_cost:fixed(count*unit.coefficient,unit.scale),adjustment:display(adjustment),adjustment_fraction:exact(adjustment)};
  });
  const totalUnits=roundedUnits(total,unit,input.mode),selected=input.scope==='TOTAL'?totalUnits:intervalUnits;
  const adjustment=subtract(fraction(selected*unitFraction.n,unitFraction.d),total);
  const rounding:FundingRoundingAudit={scope:input.scope,mode:input.mode,unit:unitText,reference:input.reference,
    rounded_cost:fixed(selected*unit.coefficient,unit.scale),total_rounded:fixed(totalUnits*unit.coefficient,unit.scale),interval_rounded:fixed(intervalUnits*unit.coefficient,unit.scale),scope_difference:fixed((intervalUnits-totalUnits)*unit.coefficient,unit.scale),
    unrounded_fraction:exact(total),adjustment:display(adjustment),adjustment_fraction:exact(adjustment),intervals};
  return{...result,rounding};
}
