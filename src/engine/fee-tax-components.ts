import {FEE_TAX_CHANNEL_KEYS,FeeTaxComponentsInputError,type ExactFeeTaxFraction,type FeeTaxChannels,type FeeTaxComponentInput,type FeeTaxComponentReview,type FeeTaxComponentSummary,type FeeTaxComponentAuditStep} from '../domain/fee-tax-components.js';
import {parseFeeTaxComponentInput,parseFeeTaxComponentBatch} from '../domain/fee-tax-components-validation.js';

interface Fraction {n:bigint;d:bigint}
function fraction(n:bigint,d=1n):Fraction{
 if(n<0n||d<=0n)throw new Error('Invalid internal nonnegative fraction');
 let a=n,b=d;while(b){const remainder=a%b;a=b;b=remainder;}return{n:n/a,d:d/a};
}
const ZERO=()=>fraction(0n),ONE=()=>fraction(1n);
const fromDecimal=(text:string):Fraction=>{const [integer='',part='']=text.split('.');return fraction(BigInt(integer+part),10n**BigInt(part.length))};
const add=(a:Fraction,b:Fraction)=>fraction(a.n*b.d+b.n*a.d,a.d*b.d);
const subtract=(a:Fraction,b:Fraction)=>fraction(a.n*b.d-b.n*a.d,a.d*b.d);
const divide=(a:Fraction,b:Fraction)=>fraction(a.n*b.d,a.d*b.n);
const lessOrEqual=(a:Fraction,b:Fraction)=>a.n*b.d<=b.n*a.d;
const equal=(a:Fraction,b:Fraction)=>a.n===b.n&&a.d===b.d;
const output=(value:Fraction|null):ExactFeeTaxFraction|null=>value===null?null:{numerator:String(value.n),denominator:String(value.d)};
const fail=(path:string,reason:string):never=>{throw new FeeTaxComponentsInputError(path,reason)};

/** Pure numeric review. Known results do not certify a tax treatment or enable any fee write. */
function review(input:FeeTaxComponentInput,path:string):FeeTaxComponentReview{
 const G=input.gross===null?null:fromDecimal(input.gross);
 let N:Fraction|null=null,T:Fraction|null=null,X:Fraction|null=null,C:Fraction|null=null;
 const issues:FeeTaxComponentReview['issues']=[],audit:FeeTaxComponentAuditStep[]=[];
 const step=(channel:FeeTaxComponentAuditStep['channel'],operation:FeeTaxComponentAuditStep['operation'],operands:Fraction[],result:Fraction|null)=>{audit.push({channel,operation,operands:operands.map(v=>output(v)!),result:output(result)})};
 step('cash',G===null?'UNKNOWN':'RECORDED',[],G);
 if(G===null)issues.push('CASH_AMOUNT_UNKNOWN');
 switch(input.tax.kind){
  case 'UNKNOWN':issues.push('TAX_COMPONENT_UNKNOWN');step('net','UNKNOWN',[],null);step('tax','UNKNOWN',[],null);break;
  case 'NO_SEPARATION':issues.push('TAX_NOT_SEPARATED');step('net','NOT_SEPARATED',[],null);step('tax','NOT_SEPARATED',[],null);break;
  case 'EXPLICIT':
   if(G===null)return fail(path+'.gross','核对显式价税成分须先明确应付总额');
   N=fromDecimal(input.tax.net);T=fromDecimal(input.tax.tax);
   if(!equal(add(N,T),G))return fail(path+'.tax','净额加税额须严格等于应付总额，不自动补差');
   step('net','RECORDED',[],N);step('tax','RECORDED',[],T);break;
  case 'GROSS_RATE':{
   if(G===null)return fail(path+'.gross','给定比例拆分须先明确应付总额');
   const rate=fromDecimal(input.tax.rate);
   if(!lessOrEqual(rate,ONE())||equal(rate,ONE()))return fail(path+'.tax.rate','首版给定比例须大于等于0且小于1');
   N=divide(G,add(ONE(),rate));T=subtract(G,N);
   step('net','GROSS_DIV_ONE_PLUS_RATE',[G,rate],N);step('tax','GROSS_MINUS_NET',[G,N],T);break;
  }
 }
 switch(input.credit.kind){
  case 'UNKNOWN':issues.push('CREDIT_UNDETERMINED');step('credit','UNKNOWN',[],null);break;
  case 'NONE':X=ZERO();step('credit','NO_CREDIT_ADJUSTMENT',[],X);break;
  case 'ASSUMED':
   if(G===null||T===null)return fail(path+'.credit','明确抵扣金额假设须先有应付额与税额');
   X=fromDecimal(input.credit.amount);if(!lessOrEqual(X,T))return fail(path+'.credit.amount','抵扣金额假设不能大于该行税额');
   step('credit','ASSUMED_CREDIT',[T,X],X);break;
 }
 switch(input.customs.kind){
  case 'UNKNOWN':issues.push('CUSTOMS_COMPONENT_UNDETERMINED');step('customs','UNKNOWN',[],null);break;
  case 'NOT_ADDED':C=ZERO();step('customs','NOT_ADDED',[],C);break;
  case 'ADD_COMPONENT':
   if(G===null)return fail(path+'.customs','单行账单成分加计须先有应付额');
   C=fromDecimal(input.customs.amount);if(!lessOrEqual(C,G))return fail(path+'.customs.amount','首版成分须不超过同币种账单应付额');
   step('customs','RECORDED_CUSTOMS_COMPONENT',[],C);break;
 }
 const E=G!==null&&X!==null?subtract(G,X):null;
 step('economic',E===null?'UNKNOWN':'GROSS_MINUS_CREDIT',G!==null&&X!==null?[G,X]:[],E);
 return{kind:'FEE_TAX_COMPONENT_REVIEW',version:'0.1',scope:'READ_ONLY_ASSUMPTIONS',input,channels:{cash:output(G),net:output(N),tax:output(T),credit:output(X),economic:output(E),customs:output(C)},issues,audit};
}
export function reviewFeeTaxComponent(value:unknown):FeeTaxComponentReview{return review(parseFeeTaxComponentInput(value),'line')}
export function summarizeFeeTaxComponents(value:unknown):FeeTaxComponentSummary{
 const batch=parseFeeTaxComponentBatch(value),rows=batch.rows.map((row,i)=>review(row,`batch.rows.${i}`));
 const totals={} as FeeTaxChannels,known_subtotals={} as FeeTaxComponentSummary['known_subtotals'],unknown_counts={} as FeeTaxComponentSummary['unknown_counts'];
 for(const key of FEE_TAX_CHANNEL_KEYS){
  let sum=ZERO(),missing=0;
  for(const row of rows){const amount=row.channels[key];if(amount===null)missing++;else sum=add(sum,{n:BigInt(amount.numerator),d:BigInt(amount.denominator)})}
  unknown_counts[key]=missing;known_subtotals[key]=output(sum)!;totals[key]=missing?null:output(sum);
 }
 return{kind:'FEE_TAX_COMPONENT_SUMMARY',version:'0.1',scope:'READ_ONLY_ASSUMPTIONS',currency:batch.currency,rows,totals,known_subtotals,unknown_counts};
}
