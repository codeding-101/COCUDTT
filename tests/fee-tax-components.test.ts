import {readFileSync} from 'node:fs';
import Decimal from 'decimal.js';
import {describe,expect,it} from 'vitest';
import {reviewFeeTaxComponent,summarizeFeeTaxComponents} from '../src/engine/fee-tax-components';
import {FeeTaxComponentsInputError,FEE_TAX_CHANNEL_KEYS,type FeeTaxComponentInput,type ExactFeeTaxFraction} from '../src/domain/fee-tax-components';

const fixture:{cases:{id:string;family:string;reject?:boolean;input:unknown;expected:Record<string,unknown>}[]}=JSON.parse(readFileSync(new URL('../docs/cases/fee-tax-components-design.json',import.meta.url),'utf8'));
const line=():FeeTaxComponentInput=>({line_id:'fee1',currency:'CNY',gross:'113',tax:{kind:'GROSS_RATE',rate:'0.13'},credit:{kind:'NONE',basis:'仅合成测算不调整'},customs:{kind:'NOT_ADDED',basis:'仅合成不加计假设'}});
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
const f=(n:bigint|number,d:bigint|number=1):ExactFeeTaxFraction=>({numerator:String(n),denominator:String(d)});
function sameRatio(actual:ExactFeeTaxFraction|null,n:bigint,d=1n){expect(actual).not.toBeNull();expect(BigInt(actual!.numerator)*d).toBe(n*BigInt(actual!.denominator));}

describe('费用税务成分：独立固定答案，不由实现生成预期',()=>{
 it.each(fixture.cases)('$id',c=>{
  const run=()=>c.family==='LINE'?reviewFeeTaxComponent(freeze(c.input)):summarizeFeeTaxComponents(freeze(c.input));
  if(c.reject){expect(run).toThrow(FeeTaxComponentsInputError);return;}
  const result=run();expect(result).toMatchObject(c.expected);expect(result.scope).toBe('READ_ONLY_ASSUMPTIONS');
  for(const key of ['ready','confirmed','apply','recommended','eligible'])expect(result).not.toHaveProperty(key);
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
 });
 it('原始金额与依据文本不归一化，返回快照与渠道/审计互不别名',()=>{
  const input=line();input.gross='113.000';input.credit={kind:'NONE',basis:'  合成依据  '};
  const result=reviewFeeTaxComponent(input),before=structuredClone(result);
  expect(result.input).toEqual(input);expect(result.input).not.toBe(input);expect(result.input.tax).not.toBe(input.tax);
  result.input.gross='1';result.input.tax={kind:'UNKNOWN'};result.audit[0]!.result!.numerator='0';
  expect(result.channels.cash).toEqual(f(113));expect(input.gross).toBe('113.000');expect(reviewFeeTaxComponent(input)).toEqual(before);
 });
 it('一除以1.13保留100/113，税额13/113，没有过早舍入',()=>{
  const input=line();input.gross='1';const result=reviewFeeTaxComponent(input);
  expect(result.channels.net).toEqual(f(100,113));expect(result.channels.tax).toEqual(f(13,113));
  expect(result.audit.find(x=>x.channel==='net')).toEqual({channel:'net',operation:'GROSS_DIV_ONE_PLUS_RATE',operands:[f(1),f(13,100)],result:f(100,113)});
  expect(result.audit.find(x=>x.channel==='economic')).toEqual({channel:'economic',operation:'GROSS_MINUS_CREDIT',operands:[f(1),f(0)],result:f(1)});
 });
 it('审计六渠道结果与输出一致，已知金额不消除业务核验责任',()=>{
  const result=reviewFeeTaxComponent(fixture.cases[0]!.input);expect(result.issues).toEqual([]);
  expect(result.audit).toHaveLength(6);for(const key of FEE_TAX_CHANNEL_KEYS)expect(result.audit.find(x=>x.channel===key)!.result).toEqual(result.channels[key]);
  expect(Object.keys(result).sort()).toEqual(['audit','channels','input','issues','kind','scope','version']);
 });
 it('批量结果冻结来源和汇总相互隔离，不使已知小计冒充完整合计',()=>{
  const a=line(),b=line();b.line_id='fee2';b.credit={kind:'UNKNOWN'};
  const result=summarizeFeeTaxComponents(freeze({currency:'CNY',rows:[a,b]}));
  expect(result.totals.economic).toBeNull();expect(result.known_subtotals.economic).toEqual(f(113));expect(result.unknown_counts.economic).toBe(1);
  result.rows[0]!.channels.cash!.numerator='0';result.known_subtotals.cash.numerator='1';expect(result.totals.cash).toEqual(f(226));
 });
 it('不修改Decimal全局精度/舍入，也不依赖其当前配置',()=>{
  const before={precision:Decimal.precision,rounding:Decimal.rounding,toExpNeg:Decimal.toExpNeg,toExpPos:Decimal.toExpPos};
  reviewFeeTaxComponent({...line(),gross:'999999999999999999999999.123456789012345678'});
  expect({precision:Decimal.precision,rounding:Decimal.rounding,toExpNeg:Decimal.toExpNeg,toExpPos:Decimal.toExpPos}).toEqual(before);
 });
});

describe('独立反向构造与渠道守恒',()=>{
 it.each(Array.from({length:200},(_,i)=>i+1))('整数反向构造 #%i',i=>{
  // Choose net and percentage first; multiplication constructs gross independently of the split formula.
  const net=BigInt(i*100),percent=BigInt(i%99),tax=BigInt(i)*percent,gross=net+tax,credit=tax/2n,customs=BigInt(i);
  const input:FeeTaxComponentInput={...line(),gross:String(gross),tax:{kind:'GROSS_RATE',rate:`0.${String(percent).padStart(2,'0')}`},credit:{kind:'ASSUMED',amount:String(credit),basis:'合成',document_ref:'合成非发票',eligibility_ref:'假设非认证'},customs:{kind:'ADD_COMPONENT',amount:String(customs),basis:'独立成分假设'}};
  const r=reviewFeeTaxComponent(freeze(input));expect(r.channels).toEqual({cash:f(gross),net:f(net),tax:f(tax),credit:f(credit),economic:f(gross-credit),customs:f(customs)});
 });
 it.each(Array.from({length:100},(_,i)=>i+1))('非整除比例交叉相乘 #%i',i=>{
  const r=reviewFeeTaxComponent({...line(),gross:`${i}.123456789012345678`,tax:{kind:'GROSS_RATE',rate:'0.123456789012345678'}});
  const scale=10n**18n,gross=BigInt(i)*scale+123456789012345678n,rate=123456789012345678n;
  sameRatio(r.channels.cash,gross,scale);sameRatio(r.channels.net,gross,scale+rate);sameRatio(r.channels.tax,gross*rate,scale*(scale+rate));
  const n=r.channels.net!,t=r.channels.tax!;expect((BigInt(n.numerator)*BigInt(t.denominator)+BigInt(t.numerator)*BigInt(n.denominator))*scale).toBe(gross*BigInt(n.denominator)*BigInt(t.denominator));
 });
 it.each(Array.from({length:32},(_,i)=>i))('每列独立传播未知 #%i',mask=>{
  const rows=Array.from({length:8},(_,i)=>({...line(),line_id:`fee${i}`,gross:String(i+1),tax:{kind:'UNKNOWN' as const},credit:mask&(1<<(i%5))?{kind:'UNKNOWN' as const}:{kind:'NONE' as const,basis:'合成'},customs:i%2?{kind:'UNKNOWN' as const}:{kind:'ADD_COMPONENT' as const,amount:String(i),basis:'独立成分'}}));
  const r=summarizeFeeTaxComponents({currency:'CNY',rows}),missing=rows.filter(x=>x.credit.kind==='UNKNOWN').length,known=rows.reduce((s,x,i)=>s+(x.credit.kind==='NONE'?i+1:0),0);
  expect(r.totals.cash).toEqual(f(36));expect(r.totals.net).toBeNull();expect(r.unknown_counts.net).toBe(8);expect(r.known_subtotals.net).toEqual(f(0));
  expect(r.unknown_counts.credit).toBe(missing);expect(r.unknown_counts.economic).toBe(missing);expect(r.known_subtotals.economic).toEqual(f(known));expect(r.totals.economic).toEqual(missing?null:f(36));
  expect(r.totals.customs).toBeNull();expect(r.known_subtotals.customs).toEqual(f(12));expect(r.unknown_counts.customs).toBe(4);
 });
});
