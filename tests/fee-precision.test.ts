import {readFileSync} from 'node:fs';
import Decimal from 'decimal.js';
import {describe,it,expect} from 'vitest';
import {reviewFeeRounding,reviewFeePrecisionGroup,reviewFeePrecisionSplit,reviewFeePrecisionFx,reviewFeePrecisionStageOrder} from '../src/engine/fee-precision';
import {FeePrecisionInputError,FEE_PRECISION_CHANNELS,type PrecisionFraction,type ExplicitPrecisionPolicy,type PrecisionMode} from '../src/domain/fee-precision';

const fixture=JSON.parse(readFileSync(new URL('../docs/cases/fee-precision-design.json',import.meta.url),'utf8')) as {cases:{id:string;family:string;input:unknown;expected?:Record<string,unknown>;reject?:boolean}[]};
const functions={ROUND:reviewFeeRounding,GROUP:reviewFeePrecisionGroup,SPLIT_AUDIT:reviewFeePrecisionSplit,FX:reviewFeePrecisionFx,STAGE_ORDER:reviewFeePrecisionStageOrder};
const run=(family:string,input:unknown)=>functions[family as keyof typeof functions](input);
const f=(numerator:string|number|bigint,denominator:string|number|bigint=1):PrecisionFraction=>({numerator:String(numerator),denominator:String(denominator)});
const policy=(mode:PrecisionMode='HALF_UP',unit='0.01'):ExplicitPrecisionPolicy=>({kind:'EXPLICIT',unit,mode,basis:'SYNTHETIC not an invoice'});
const freeze=<T>(v:T):T=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
function ratio(value:PrecisionFraction|null,n:bigint,d=1n){expect(value).not.toBeNull();expect(BigInt(value!.numerator)*d).toBe(n*BigInt(value!.denominator));}
function preservesDifference(original:PrecisionFraction,candidate:PrecisionFraction,delta:PrecisionFraction){
 const o=BigInt(original.numerator),od=BigInt(original.denominator),c=BigInt(candidate.numerator),cd=BigInt(candidate.denominator),a=BigInt(delta.numerator),ad=BigInt(delta.denominator);
 expect((o*ad+a*od)*cd).toBe(c*od*ad);
}
describe('fixed independent precision design vectors',()=>{
 it.each(fixture.cases.filter(c=>!c.reject))('$family / $id',c=>{
  const before=JSON.stringify(c.input),r=run(c.family,freeze(c.input));
  // The historical oracle is a reduced design protocol, not a production review envelope.
  const numeric=c.family==='SPLIT_AUDIT'?{...r.values,channels:FEE_PRECISION_CHANNELS.map(k=>(r as ReturnType<typeof reviewFeePrecisionSplit>).values.channels[k])}:r.values;
  const projected=c.family==='ROUND'||c.family==='SPLIT_AUDIT'?{...numeric,issues:r.issues}:c.family==='FX'?{...numeric,scope:'DESIGN_FX_REVIEW_ONLY'}:numeric;
  expect(projected).toEqual(c.expected);expect(JSON.stringify(c.input)).toBe(before);expect(r.input).toEqual(c.input);expect(r.input).not.toBe(c.input);
  expect(r.scope).toBe('READ_ONLY_ASSUMPTIONS');expect(r.kind).toBe('FEE_PRECISION_REVIEW');expect(JSON.parse(JSON.stringify(r))).toEqual(r);expect(r.audit.length).toBeGreaterThan(0);
 });
 it.each(fixture.cases.filter(c=>c.reject))('rejects $family / $id',c=>{
  const before=JSON.stringify(c.input);expect(()=>run(c.family,freeze(c.input))).toThrow(FeePrecisionInputError);expect(JSON.stringify(c.input)).toBe(before);
 });
});
describe('independent remainder constructions and audits',()=>{
 it.each(['HALF_UP','HALF_EVEN','DOWN'] as const)('%s: 1620 integer constructions, signed differences and idempotence',mode=>{
  for(const d of[2n,3n,7n,10n,113n])for(let integer=0n;integer<12n;integer++)for(let remainder=0n;remainder<d;remainder++){
   const n=integer*d+remainder;let a=n,b=d*100n;while(b)[a,b]=[b,a%b];const original=f(n/a,d*100n/a);
   const r=reviewFeeRounding({currency:'ZZZ',amount:original,policy:policy(mode)});let expected=integer;
   if(mode==='HALF_UP'&&remainder>=d-remainder||mode==='HALF_EVEN'&&(remainder>d-remainder||remainder===d-remainder&&integer%2n===1n))expected++;
   ratio(r.values.rounded,expected,100n);preservesDifference(original,r.values.rounded!,r.values.delta!);
   expect(reviewFeeRounding({currency:'ZZZ',amount:r.values.rounded,policy:policy(mode)}).values.rounded).toEqual(r.values.rounded);
   const audit=r.audit.find(s=>s.operation==='QUANTIZE')!;expect(audit.result).toEqual(r.values.rounded);expect(audit.quantization!.floor_units).toBe(String(integer));ratio(audit.quantization!.remainder,remainder,d);
  }
 });
 it('audits exact inverse rates and preserves policy/source text',()=>{
  const raw=fixture.cases.find(c=>c.id==='customs-inverse-no-pre-round')!.input,r=reviewFeePrecisionFx(raw);
  expect(r.audit.find(s=>s.path==='effective_rate')).toEqual({path:'effective_rate',operation:'DIVIDE',operands:[f(1),f(3)],result:f(1,3)});
  expect(r.audit.find(s=>s.path==='unrounded')!.result).toEqual(f(1,3));expect(r.input).toEqual(raw);
  const {scope:_,...values}=fixture.cases.find(c=>c.id==='customs-inverse-no-pre-round')!.expected!;expect(r.values).toEqual(values);
 });
 it('124 explicit rate pairs restore the exact original through the real FX API',()=>{
  for(let integer=0n;integer<=30n;integer++)for(const coefficient of[3n,7n,113n,1000000000001n]){
   let a=integer,b=7n;while(b)[a,b]=[b,a%b];const original=f(integer/a,7n/a),rate=String(coefficient/100n)+'.'+String(coefficient%100n).padStart(2,'0');
   const source=structuredClone(fixture.cases.find(c=>c.id==='commercial-direct')!.input) as Record<string,any>;source.amount=original;source.rate_source.rate=rate;
   const forward=reviewFeePrecisionFx(source),reverse=reviewFeePrecisionFx({...source,amount:forward.values.unrounded,from:'CNY',to:'USD'});
   expect(forward.values.direction).toBe('DIRECT');expect(reverse.values.direction).toBe('INVERSE');expect(reverse.values.unrounded).toEqual(original);
   ratio(forward.values.unrounded,integer*coefficient,700n);
  }
 });
 it('matches audit results and outputs without mutable aliases',()=>{
  const input={currency:'USD',amount:f(100,113),policy:policy()},r=reviewFeeRounding(input),original=reviewFeeRounding(input);
  r.audit.find(s=>s.path==='rounded')!.result!.numerator='0';r.audit.find(s=>s.path==='rounded')!.quantization!.unit.numerator='0';r.input.policy={kind:'UNRESOLVED'};if(typeof r.input.amount==='object'&&r.input.amount)r.input.amount.numerator='0';
  expect(r.values).toEqual(original.values);expect(input.amount).toEqual(f(100,113));expect(reviewFeeRounding(input)).toEqual(original);
  const group=reviewFeePrecisionGroup({currency:'USD',rows:[{line_id:'a',currency:'USD',amount:'1'}],policy:policy(),scope:'PER_LINE'});group.values.selected!.numerator='9';group.audit.find(s=>s.path==='line_total')!.result!.numerator='8';expect(group.values.line_total).toEqual(f(1));expect(group.values.aggregate_total).toEqual(f(1));
 });
 it('exposes the conservation operands without moving price/tax or credit tails',()=>{
  const raw=fixture.cases.find(c=>c.id==='two-different-gaps')!.input,r=reviewFeePrecisionSplit(raw);
  expect(r.audit.find(s=>s.path==='price_tax_gap')).toEqual({path:'price_tax_gap',operation:'SUBTRACT',operands:[f(1,50),f(3,100)],result:f(-1,100)});
  expect(r.audit.find(s=>s.path==='economic_gap')).toEqual({path:'economic_gap',operation:'SUBTRACT',operands:[f(3,100),f(1,50)],result:f(1,100)});expect(r.input).toEqual(raw);
  const unknown=reviewFeePrecisionSplit(fixture.cases.find(c=>c.id==='price-tax-negative-gap')!.input);expect(unknown.values.channels.economic).toBeNull();expect(unknown.values.economic_gap).toBeNull();
 });
 it('retains unknown totals and known subtotals as distinct audit paths',()=>{
  const r=reviewFeePrecisionGroup(fixture.cases.find(c=>c.id==='unknown-total-not-subtotal')!.input);expect(r.issues).toEqual(['AMOUNT_UNKNOWN']);expect(r.audit.find(s=>s.path==='original_total')!.result).toBeNull();expect(r.audit.find(s=>s.path==='known_line_subtotal')!.result).toEqual(f(1,100));expect(r.values.selected).toBeNull();
 });
 it('does not depend on or change Decimal global configuration',()=>{
  const config={precision:Decimal.precision,rounding:Decimal.rounding,toExpNeg:Decimal.toExpNeg,toExpPos:Decimal.toExpPos},raw=fixture.cases.find(c=>c.id==='recurring-net')!.input,expected=reviewFeeRounding(raw);
  try{Decimal.set({precision:2,rounding:Decimal.ROUND_DOWN});expect(reviewFeeRounding(raw)).toEqual(expected);expect(Decimal.precision).toBe(2);expect(Decimal.rounding).toBe(Decimal.ROUND_DOWN);}finally{Decimal.set(config);}
 });
});
describe('derived fractions never inherit the input digit ceiling',()=>{
 it('keeps eight pairwise-coprime 80-digit denominators and their signed aggregate difference',()=>{
  const gcd=(a:bigint,b:bigint):bigint=>{while(b)[a,b]=[b,a%b];return a;},denominators:bigint[]=[];let candidate=10n**79n+1n;
  while(denominators.length<8){if(denominators.every(d=>gcd(d,candidate)===1n))denominators.push(candidate);candidate+=2n;}
  const rows=denominators.map((d,i)=>({line_id:'line-'+i,currency:'USD',amount:f(1,d)})),r=reviewFeePrecisionGroup(freeze({currency:'USD',rows,policy:policy(),scope:'TOTAL'}));
  const product=denominators.reduce((a,b)=>a*b,1n),sum=denominators.reduce((n,d)=>n+product/d,0n),exact=r.audit.find(s=>s.path==='original_total')!.result!;
  expect(exact.denominator.length).toBeGreaterThan(600);ratio(exact,sum,product);ratio(r.values.delta,-sum,product);expect(r.values.selected).toEqual(f(0));expect(JSON.parse(JSON.stringify(r))).toEqual(r);
 });
 it('keeps a rounded numerator over 80 digits and a 104-digit converted amount',()=>{
  const original=f('9'.repeat(80),7),r=reviewFeeRounding({currency:'USD',amount:original,policy:policy('HALF_UP','0.000001')});expect(r.values.rounded!.numerator.length).toBeGreaterThan(80);preservesDifference(original,r.values.rounded!,r.values.delta!);
  const input=structuredClone(fixture.cases.find(c=>c.id==='commercial-direct')!.input) as Record<string,any>;input.amount=f('9'.repeat(80));input.rate_source.rate='9'.repeat(24);const fx=reviewFeePrecisionFx(input);expect(fx.values.unrounded!.numerator.length).toBe(104);expect(fx.values.rounded).toEqual(fx.values.unrounded);expect(fx.values.delta).toEqual(f(0));
 });
});
