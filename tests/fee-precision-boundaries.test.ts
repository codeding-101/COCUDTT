import {describe,it,expect} from 'vitest';
import {reviewFeeRounding,reviewFeePrecisionGroup,reviewFeePrecisionFx,reviewFeePrecisionSplit} from '../src/engine/fee-precision';
import {FeePrecisionInputError} from '../src/domain/fee-precision';
import {sampleProjectFile,chinaImportSampleProjectFile} from '../src/data/sample-project';
import {parseProject,serializeProject,toTrade,toScenario} from '../src/data/project-file';
import {analyze} from '../src/engine/analyze';
const p=()=>({kind:'EXPLICIT',unit:'0.01',mode:'HALF_UP',basis:'SYNTHETIC policy'});
const input=()=>({currency:'USD',amount:'1.005',policy:p()});
const group=()=>({currency:'USD',rows:[{line_id:'row',currency:'USD',amount:'1'}],policy:p(),scope:'TOTAL'});
function errorPath(action:()=>unknown,path:string){try{action();throw Error('not rejected');}catch(error){expect(error).toBeInstanceOf(FeePrecisionInputError);expect((error as FeePrecisionInputError).path).toBe(path);}}
describe('closed plain-data boundary without getter execution',()=>{
 it.each(['currency','amount','policy'])('does not invoke root getter %s',field=>{
  let calls=0;const v=input();Object.defineProperty(v,field,{enumerable:true,get(){calls++;throw Error('PRIVATE_GETTER');}});errorPath(()=>reviewFeeRounding(v),'round.'+field);expect(calls).toBe(0);
 });
 it.each(['kind','unit','mode','basis'])('does not invoke policy getter %s',field=>{
  let calls=0;const v=input();Object.defineProperty(v.policy,field,{enumerable:true,get(){calls++;return 'value';}});errorPath(()=>reviewFeeRounding(v),'round.policy.'+field);expect(calls).toBe(0);
 });
 it.each(['numerator','denominator'])('does not invoke fraction getter %s',field=>{
  let calls=0;const amount={numerator:'1',denominator:'3'};Object.defineProperty(amount,field,{enumerable:true,get(){calls++;return '1';}});errorPath(()=>reviewFeeRounding({...input(),amount}),'round.amount.'+field);expect(calls).toBe(0);
 });
 it('does not invoke array or row accessors',()=>{
  let calls=0;const rows=group().rows;Object.defineProperty(rows,'0',{enumerable:true,get(){calls++;return group().rows[0];}});errorPath(()=>reviewFeePrecisionGroup({...group(),rows}),'group.rows.0');expect(calls).toBe(0);
  const row=group().rows[0]!;Object.defineProperty(row,'amount',{enumerable:true,get(){calls++;return '1';}});errorPath(()=>reviewFeePrecisionGroup({...group(),rows:[row]}),'group.rows.0.amount');expect(calls).toBe(0);
 });
 it.each(['symbol','nonEnumerable','inherited','class','extra','missing','null','array','cycle','throwingProxy'])('rejects malformed root %s with a typed error',kind=>{
  let v:unknown=input();if(kind==='symbol')(v as any)[Symbol('private')]='x';
  if(kind==='nonEnumerable')Object.defineProperty(v,'currency',{value:'USD',enumerable:false});
  if(kind==='inherited')v=Object.assign(Object.create({private:'x'}),input());
  if(kind==='class')v=new(class {currency='USD';amount='1';policy=p();})();
  if(kind==='extra')(v as any).apply=true;if(kind==='missing')delete (v as any).amount;
  if(kind==='null')v=null;if(kind==='array')v=[];if(kind==='cycle')(v as any).amount=v;
  if(kind==='throwingProxy')v=new Proxy(input(),{ownKeys(){throw Error('PRIVATE_PROXY');}});
  expect(()=>reviewFeeRounding(v)).toThrow(FeePrecisionInputError);try{reviewFeeRounding(v);}catch(e){expect((e as Error).message).not.toMatch(/PRIVATE_PROXY|PRIVATE_GETTER/);}
 });
 it.each(['hole','extra','symbol','subclass'])('rejects malformed rows %s',kind=>{
  let rows:any=group().rows;if(kind==='hole')rows=new Array(1);if(kind==='extra')rows.private=true;if(kind==='symbol')rows[Symbol('x')]='x';if(kind==='subclass')rows=new(class extends Array{})(...rows);
  errorPath(()=>reviewFeePrecisionGroup({...group(),rows}),'group.rows');
 });
 it('accepts null-prototype records but detaches them into ordinary result data',()=>{
  const v=Object.assign(Object.create(null),input()),r=reviewFeeRounding(v);expect(r.values.rounded).toEqual({numerator:'101',denominator:'100'});expect(Object.getPrototypeOf(r.input)).toBe(Object.prototype);expect(r.input).not.toBe(v);
 });
});
describe('scalar bounds, exact paths and unknowns',()=>{
 it.each(['-1','-0','+1',' 1','1 ','1e0','1,000','NaN','Infinity','','.1','1.','01','0.0000000000000000001','1'.repeat(25)])('rejects decimal %s',amount=>errorPath(()=>reviewFeeRounding({...input(),amount}),'round.amount'));
 it.each([0,1,NaN,Infinity,-Infinity,1n,new Number(1)])('does not coerce number-like values %s',amount=>expect(()=>reviewFeeRounding({...input(),amount})).toThrow(FeePrecisionInputError));
 it('retains trailing zeros and explicit zero without replacing unknowns',()=>{
  const r=reviewFeeRounding({...input(),amount:'0.000000000000000000',policy:{...p(),unit:'0.010000000000000000',basis:'  evidence  '}});expect(r.input.amount).toBe('0.000000000000000000');expect(r.input.policy).toEqual({...p(),unit:'0.010000000000000000',basis:'  evidence  '});expect(r.values.delta).toEqual({numerator:'0',denominator:'1'});
  expect(reviewFeeRounding({...input(),amount:null}).values.rounded).toBeNull();expect(reviewFeeRounding({...input(),policy:{kind:'UNRESOLVED'}}).issues).toEqual(['POLICY_UNRESOLVED']);
 });
 it('accepts exact input ceilings and rejects overlong fractions without huge integer parsing',()=>{
  expect(reviewFeeRounding({...input(),amount:{numerator:'9'.repeat(80),denominator:'1'}}).values.rounded!.numerator.length).toBe(80);
  expect(reviewFeeRounding({...input(),amount:{numerator:'1',denominator:'1'+'0'.repeat(79)}}).values.rounded).toEqual({numerator:'0',denominator:'1'});
  errorPath(()=>reviewFeeRounding({...input(),amount:{numerator:'1'.repeat(81),denominator:'1'}}),'round.amount.numerator');errorPath(()=>reviewFeeRounding({...input(),amount:{numerator:'1',denominator:'1'.repeat(81)}}),'round.amount.denominator');
  expect(()=>reviewFeeRounding({...input(),amount:'1'.repeat(100000)})).toThrow(FeePrecisionInputError);
 });
 it('uses UTF-16 source limits and does not trim or default a missing basis',()=>{
  expect(reviewFeeRounding({...input(),policy:{...p(),basis:'😀'.repeat(100)}}).input.policy).toEqual({...p(),basis:'😀'.repeat(100)});
  errorPath(()=>reviewFeeRounding({...input(),policy:{...p(),basis:'😀'.repeat(100)+'x'}}),'round.policy.basis');errorPath(()=>reviewFeeRounding({...input(),policy:{...p(),basis:' '}}),'round.policy.basis');
 });
 it('reports original source arithmetic errors at their exact paths',()=>{
  const split={currency:'USD',gross:'1',net:'0.88',tax:'0.12',credit:null,customs:null,policy:p()};errorPath(()=>reviewFeePrecisionSplit({...split,gross:'2'}),'split.tax');errorPath(()=>reviewFeePrecisionSplit({...split,credit:'0.13'}),'split.credit');errorPath(()=>reviewFeePrecisionSplit({...split,customs:'1.01'}),'split.customs');
 });
 it('does not validate away incomplete policies or missing FX facts',()=>{
  const fx={amount:'1',from:'USD',to:'CNY',purpose:'COMMERCIAL_REVIEW',channel:'cash',as_of:'2026-10-18',policy:p(),rate_source:{base:'USD',quote:'CNY',rate:'7',type:'CONTRACT',rate_date:'2026-10-01',valid_from:'2026-10-01',valid_to:'2026-10-31',reference:'source'}};
  errorPath(()=>reviewFeePrecisionFx({...fx,policy:{kind:'UNRESOLVED'}}),'fx.policy');const {rate:_,...source}=fx.rate_source;errorPath(()=>reviewFeePrecisionFx({...fx,rate_source:source}),'fx.rate_source');errorPath(()=>reviewFeePrecisionFx({...fx,rate_source:{...fx.rate_source,rate:'0'}}),'fx.rate_source.rate');errorPath(()=>reviewFeePrecisionFx({...fx,rate_source:{...fx.rate_source,rate_date:'2026-02-30'}}),'fx.rate_source.rate_date');
 });
});
describe('existing business data and calculations stay independent',()=>{
 it.each(['generic','china-import'])('%s project unknown extensions remain inert and existing results match',kind=>{
  const project=kind==='generic'?sampleProjectFile():chinaImportSampleProjectFile();(project as unknown as Record<string,unknown>).fee_precision={version:'future',amount:'PRIVATE_LEGACY_AMOUNT',unit:'0.01'};const text=serializeProject(project),calculate=()=>analyze({trade:toTrade(project),scenario:toScenario(project),taxProfile:project.tax_profile,fxBooks:project.fx_books}),baseline=calculate();
  reviewFeeRounding(input());reviewFeePrecisionGroup(group());expect(serializeProject(project)).toBe(text);expect(calculate()).toEqual(baseline);expect((parseProject(text) as unknown as Record<string,unknown>).fee_precision).toEqual({version:'future',amount:'PRIVATE_LEGACY_AMOUNT',unit:'0.01'});
 });
});
