import {FeePrecisionInputError,FEE_PRECISION_CHANNELS,type PrecisionAmount,type PrecisionFraction,type PrecisionPolicy,type PrecisionAuditStep,type FeePrecisionIssue,type FeePrecisionReview,type FeeRoundingInput,type FeeRoundingValues,type FeePrecisionGroupInput,type FeePrecisionGroupValues,type FeePrecisionSplitInput,type FeePrecisionSplitValues,type FeePrecisionFxInput,type FeePrecisionFxValues,type FeePrecisionStageInput,type FeePrecisionStageValues} from '../domain/fee-precision.js';
import {parseFeeRoundingInput,parseFeePrecisionGroupInput,parseFeePrecisionSplitInput,parseFeePrecisionFxInput,parseFeePrecisionStageInput} from '../domain/fee-precision-validation.js';

interface Fraction {n:bigint;d:bigint}
const fail=(path:string,reason:string):never=>{throw new FeePrecisionInputError(path,reason);};
function fraction(n:bigint,d=1n):Fraction{
 if(d<=0n)throw Error('Invalid internal denominator');let a=n<0n?-n:n,b=d;while(b)[a,b]=[b,a%b];return{n:n/a,d:d/a};
}
function decimal(text:string):Fraction{const [whole='',part='']=text.split('.');return fraction(BigInt(whole+part),10n**BigInt(part.length));}
const read=(a:PrecisionAmount):Fraction|null=>a===null?null:typeof a==='string'?decimal(a):{n:BigInt(a.numerator),d:BigInt(a.denominator)};
const serial=(a:Fraction|null):PrecisionFraction|null=>a===null?null:{numerator:String(a.n),denominator:String(a.d)};
const add=(a:Fraction,b:Fraction)=>fraction(a.n*b.d+b.n*a.d,a.d*b.d);
const sub=(a:Fraction,b:Fraction)=>fraction(a.n*b.d-b.n*a.d,a.d*b.d);
const mul=(a:Fraction,b:Fraction)=>fraction(a.n*b.n,a.d*b.d);
const div=(a:Fraction,b:Fraction)=>fraction(a.n*b.d,a.d*b.n);
const equal=(a:Fraction,b:Fraction)=>a.n*b.d===b.n*a.d;
const lte=(a:Fraction,b:Fraction)=>a.n*b.d<=b.n*a.d;
function record(audit:PrecisionAuditStep[],path:string,operation:PrecisionAuditStep['operation'],operands:(Fraction|null)[],result:Fraction|null):void{
 audit.push({path,operation,operands:operands.map(serial),result:serial(result)});
}
function quantize(value:Fraction|null,policy:PrecisionPolicy,audit:PrecisionAuditStep[],path:string):Fraction|null{
 if(value===null||policy.kind==='UNRESOLVED'){record(audit,path,value===null?'UNKNOWN':'POLICY_UNRESOLVED',[value],null);return null;}
 const unit=decimal(policy.unit),scaled=div(value,unit),whole=scaled.n/scaled.d,remainder=scaled.n%scaled.d;
 // Compare integer remainders against half a quantum, without a decimal approximation.
 const comparison=remainder*2n-scaled.d;
 const increment=policy.mode!=='DOWN'&&(comparison>0n||comparison===0n&&(policy.mode==='HALF_UP'||whole%2n!==0n));
 const result=mul(fraction(whole+(increment?1n:0n)),unit);
 audit.push({path,operation:'QUANTIZE',operands:[serial(value),serial(unit)],result:serial(result),quantization:{unit:serial(unit)!,mode:policy.mode,floor_units:String(whole),remainder:serial(fraction(remainder,scaled.d))!,increment}});
 return result;
}
function delta(a:Fraction|null,b:Fraction|null,audit:PrecisionAuditStep[],path:string):Fraction|null{
 const value=a===null||b===null?null:sub(a,b);record(audit,path,'SUBTRACT',[a,b],value);return value;
}
function result<I,V>(operation:FeePrecisionReview<I,V>['operation'],input:I,values:V,issues:FeePrecisionIssue[],audit:PrecisionAuditStep[]):FeePrecisionReview<I,V>{
 return{kind:'FEE_PRECISION_REVIEW',version:'0.1',scope:'READ_ONLY_ASSUMPTIONS',operation,input,values,issues,audit};
}

/** Pure, detached numeric review. Never writes original amounts or clears proposal blockers. */
export function reviewFeeRounding(value:unknown):FeePrecisionReview<FeeRoundingInput,FeeRoundingValues>{
 const input=parseFeeRoundingInput(value),a=read(input.amount),audit:PrecisionAuditStep[]=[],issues:FeePrecisionIssue[]=[];
 record(audit,'original','RECORDED',[],a);const rounded=quantize(a,input.policy,audit,'rounded'),difference=delta(rounded,a,audit,'delta');
 if(a===null)issues.push('AMOUNT_UNKNOWN');if(input.policy.kind==='UNRESOLVED')issues.push('POLICY_UNRESOLVED');
 return result('ROUND',input,{rounded:serial(rounded),delta:serial(difference)},issues,audit);
}
export function reviewFeePrecisionGroup(value:unknown):FeePrecisionReview<FeePrecisionGroupInput,FeePrecisionGroupValues>{
 const input=parseFeePrecisionGroupInput(value),audit:PrecisionAuditStep[]=[],values=input.rows.map(row=>read(row.amount));
 let originalKnown=fraction(0n),roundedKnown=fraction(0n),unknown=0;
 const rounded=values.map((a,i)=>{
  record(audit,`rows.${i}.original`,'RECORDED',[],a);const q=quantize(a,input.policy,audit,`rows.${i}.rounded`);delta(q,a,audit,`rows.${i}.delta`);
  if(a===null)unknown++;else{originalKnown=add(originalKnown,a);roundedKnown=add(roundedKnown,q!);}return q;
 });
 const originalTotal=unknown?null:originalKnown,lineTotal=unknown?null:roundedKnown;
 record(audit,'known_original_subtotal','ADD',values.filter(x=>x!==null),originalKnown);
 record(audit,'known_line_subtotal','ADD',rounded.filter(x=>x!==null),roundedKnown);
 record(audit,'original_total','ADD',values,originalTotal);record(audit,'line_total','ADD',rounded,lineTotal);
 const aggregate=quantize(originalTotal,input.policy,audit,'aggregate_total'),selected=input.scope==='PER_LINE'?lineTotal:aggregate;
 record(audit,'selected','RECORDED',[selected],selected);
 const difference=delta(selected,originalTotal,audit,'delta'),scopeDifference=delta(lineTotal,aggregate,audit,'scope_difference');
 return result('GROUP',input,{line_total:serial(lineTotal),aggregate_total:serial(aggregate),selected:serial(selected),delta:serial(difference),scope_difference:serial(scopeDifference),known_line_subtotal:serial(roundedKnown)!,unknown_rows:unknown},unknown?['AMOUNT_UNKNOWN']:[],audit);
}
export function reviewFeePrecisionSplit(value:unknown):FeePrecisionReview<FeePrecisionSplitInput,FeePrecisionSplitValues>{
 const input=parseFeePrecisionSplitInput(value),G=read(input.gross),N=read(input.net),T=read(input.tax),X=read(input.credit),C=read(input.customs);
 if(G===null)return fail('split.gross','成分守恒核对须明确原应付额');if(N===null)return fail('split.net','须明确原净额');if(T===null)return fail('split.tax','须明确原税额');
 if(!equal(add(N,T),G))return fail('split.tax','原净额加原税额须严格等于原应付额，不自动补差');
 if(X!==null&&!lte(X,T))return fail('split.credit','原抵扣假设不能超过原税额');if(C!==null&&!lte(C,G))return fail('split.customs','原海关成分不能超过原应付额');
 const audit:PrecisionAuditStep[]=[],E=delta(G,X,audit,'original.economic'),names=FEE_PRECISION_CHANNELS;
 const originals=[G,N,T,X,E,C],rounded=originals.map((a,i)=>{
  record(audit,`channels.${names[i]}.original`,'RECORDED',[],a);const q=quantize(a,input.policy,audit,`channels.${names[i]}.rounded`);delta(q,a,audit,`channels.${names[i]}.delta`);return q;
 });
 const [g,n,t,x,e]=rounded,[qG,qN,qT]=[g!,n!,t!];
 const grossMinusNet=delta(qG,qN,audit,'price_tax.gross_minus_net'),priceGap=delta(grossMinusNet,qT,audit,'price_tax_gap')!;
 const grossMinusCredit=delta(qG,x??null,audit,'economic.gross_minus_credit'),economicGap=delta(e??null,grossMinusCredit,audit,'economic_gap'),issues:FeePrecisionIssue[]=[];
 if(priceGap.n!==0n)issues.push('PRICE_TAX_ROUNDING_DIFFERENCE');if(economicGap!==null&&economicGap.n!==0n)issues.push('ECONOMIC_ROUNDING_DIFFERENCE');
 const channels:FeePrecisionSplitValues['channels']={cash:serial(qG),net:serial(qN),tax:serial(qT),credit:serial(x??null),economic:serial(e??null),customs:serial(rounded[5]??null)};
 return result('SPLIT_AUDIT',input,{channels,price_tax_gap:serial(priceGap)!,economic_gap:serial(economicGap)},issues,audit);
}
export function reviewFeePrecisionFx(value:unknown):FeePrecisionReview<FeePrecisionFxInput,FeePrecisionFxValues>{
 const input=parseFeePrecisionFxInput(value),r=input.rate_source,p=input.policy,audit:PrecisionAuditStep[]=[];
 if(input.from===input.to)return fail('fx.to','同币种不使用换算核对；不能用1补汇率');
 if(r.base===r.quote)return fail('fx.rate_source.quote','汇率币种对须不同');
 if(r.valid_from>r.valid_to||input.as_of<r.valid_from||input.as_of>r.valid_to)return fail('fx.rate_source.valid_from','有效期须覆盖本次核对日');
 if(r.rate_date>input.as_of)return fail('fx.rate_source.rate_date','来源发布日期不能晚于核对日');
 if(input.purpose==='COMMERCIAL_REVIEW'){
  if(input.channel==='customs')return fail('fx.channel','海关成分不能按商业换算目的处理');
  if(r.type==='CUSTOMS')return fail('fx.rate_source.type','商业诊断须使用明确商业来源类型');
 }else{
  if(input.channel!=='customs')return fail('fx.channel','海关诊断仅限customs通道');
  if(r.type!=='CUSTOMS')return fail('fx.rate_source.type','海关诊断须明确CUSTOMS来源');
  if(input.to!=='CNY')return fail('fx.to','海关诊断目标须为CNY');
  if(input.as_of<'2024-12-01')return fail('fx.as_of','本诊断不支持2024-12-01之前日期');
  if(!equal(decimal(p.unit),fraction(1n,100n))||p.mode!=='HALF_UP')return fail('fx.policy','海关诊断使用0.01/HALF_UP，不由商业选项覆盖');
 }
 const rate=decimal(r.rate);if(rate.n===0n)return fail('fx.rate_source.rate','汇率须大于0');let direction:'DIRECT'|'INVERSE';
 if(input.from===r.base&&input.to===r.quote)direction='DIRECT';else if(input.from===r.quote&&input.to===r.base)direction='INVERSE';else return fail('fx.rate_source','币种对不匹配，不进行三角换汇');
 const a=read(input.amount);record(audit,'original','RECORDED',[],a);record(audit,'rate','RECORDED',[],rate);
 const effective=direction==='DIRECT'?rate:div(fraction(1n),rate);
 if(direction==='INVERSE')record(audit,'effective_rate','DIVIDE',[fraction(1n),rate],effective);
 const exact=a===null?null:mul(a,effective);record(audit,'unrounded','MULTIPLY',[a,effective],exact);
 const rounded=quantize(exact,p,audit,'rounded'),difference=delta(rounded,exact,audit,'delta');
 return result('FX',input,{direction,unrounded:serial(exact),rounded:serial(rounded),delta:serial(difference)},a===null?['AMOUNT_UNKNOWN']:[],audit);
}
export function reviewFeePrecisionStageOrder(value:unknown):FeePrecisionReview<FeePrecisionStageInput,FeePrecisionStageValues>{
 const input=parseFeePrecisionStageInput(value),a=read(input.amount),rate=decimal(input.rate),audit:PrecisionAuditStep[]=[];
 if(a===null)return fail('stages.amount','阶段顺序对照须明确金额');if(rate.n===0n)return fail('stages.rate','汇率须大于0');
 record(audit,'original','RECORDED',[],a);record(audit,'rate','RECORDED',[],rate);
 const exactFx=mul(a,rate);record(audit,'exact_fx','MULTIPLY',[a,rate],exactFx);
 const direct=quantize(exactFx,input.final,audit,'exact_then_target')!,intermediate=quantize(a,input.intermediate,audit,'intermediate')!;
 const earlyFx=mul(intermediate,rate);record(audit,'intermediate_fx','MULTIPLY',[intermediate,rate],earlyFx);
 const double=quantize(earlyFx,input.final,audit,'intermediate_then_target')!,gap=delta(double,direct,audit,'gap')!;
 return result('STAGE_ORDER',input,{exact_then_target:serial(direct)!,intermediate_then_target:serial(double)!,gap:serial(gap)!},[],audit);
}
