import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {createFundingExample} from '../src/data/funding-example.js';
import {settlementBinding} from '../src/data/settlement-context.js';
import {parseSettlementPlan,serializeSettlementPlan} from '../src/data/settlement-file.js';
import {enableFundingRates,enableFundingRounding,type SettlementPlan} from '../src/domain/settlement.js';
import {newFundingPeriodRounding,newFundingPeriodSchedule,type FundingPeriodRounding,type FundingPeriodSchedule} from '../src/domain/funding-periods.js';
import {validateFundingPeriodRounding,validateFundingPeriodSchedule} from '../src/domain/funding-periods-validation.js';
import {calculateFunding} from '../src/engine/funding.js';
import {calculateFundingPeriods} from '../src/engine/funding-periods.js';
interface DesignInput {
  funding:{kind:'FINANCING'|'OPPORTUNITY';party:'BUYER'|'SELLER';currency:string;principal:string;annual_rate:string;denominator:number;start_date:string;end_date:string;
    principal_events:{date:string;direction:'INCREASE'|'DECREASE';amount:string;currency:string;reference:string}[];rate_events:{date:string;annual_rate:string;reference:string}[]};
  schedule:FundingPeriodSchedule;
  rounding:Omit<FundingPeriodRounding,'status'>;
}
interface DesignCase {id:string;input:DesignInput;expected_error?:string;expected?:{raw_fraction:string;period_fractions:string[];period_rounded:string[];rounded_total:string;calculation_segments:number;closing_principal_scaled:string;closing_rate_scaled:string}}
const cases=(JSON.parse(readFileSync(new URL('../docs/cases/funding-period-design.json',import.meta.url),'utf8')) as {cases:DesignCase[]}).cases;
function context(input:DesignInput=cases[0]!.input){
  const {project,plan:seed}=createFundingExample(),plan=enableFundingRates(seed),f=input.funding;
  Object.assign(plan.funding!,{status:'PROVIDED',kind:f.kind,party:f.party,currency:f.currency,principal:f.principal,annual_rate:f.annual_rate,start_date:f.start_date,end_date:f.end_date,day_basis:f.denominator===360?'ACT_360':'ACT_365F',reference:'合成资金依据',
    balance_model:'EVENTS',events:f.principal_events.map((e,i)=>({...e,id:'p'+i})),rate_model:'EVENTS',rate_events:f.rate_events.map((e,i)=>({...e,id:'r'+i}))});
  return{plan,binding:settlementBinding(project),schedule:structuredClone(input.schedule),rounding:{...input.rounding,status:'APPLIED'} as FundingPeriodRounding};
}
function audit(c:ReturnType<typeof context>){return calculateFundingPeriods(calculateFunding(c.plan,c.binding)!,c.schedule,c.rounding)!;}
const compact=(s:string)=>s.replaceAll(' ','');
function scaleSix(text:string):string{const [w,p='']=text.split('.');return(BigInt(w!)*1000000n+BigInt(p.padEnd(6,'0'))).toString();}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

describe('独立期间归集：固定手算与原模型边界',()=>{
  it.each(cases.filter(c=>c.expected))('手算 $id',c=>{
    const ctx=context(c.input),result=calculateFunding(ctx.plan,ctx.binding)!,expected=c.expected!,a=calculateFundingPeriods(result,ctx.schedule,ctx.rounding)!;
    expect(compact(a.unrounded_fraction)).toBe(expected.raw_fraction);expect(a.periods.map(p=>compact(p.unrounded_fraction))).toEqual(expected.period_fractions);
    expect(a.periods.map(p=>p.rounded_cost)).toEqual(expected.period_rounded);expect(a.rounded_cost).toBe(expected.rounded_total);expect(a.calculation_segment_count).toBe(expected.calculation_segments);
    expect(scaleSix(result.ledger!.closing_principal)).toBe(expected.closing_principal_scaled);expect(scaleSix(result.rates!.closing_rate)).toBe(expected.closing_rate_scaled);
    expect(a.periods.reduce((n,p)=>n+p.days,0)).toBe(result.days);expect(a.periods.flatMap(p=>p.fragments).reduce((n,f)=>n+f.days,0)).toBe(result.days);
    if(c.id==='half-even-period-ties')expect(a).toMatchObject({total_rounded:'0.01',scope_difference:'-0.01',adjustment_fraction:'-1 / 100'});
    if(c.id==='zero-rate-with-positive-days')expect(a).toMatchObject({scope_difference:'0.00',adjustment_fraction:'0 / 1'});
  });
  it.each(cases.filter(c=>c.expected_error))('原条件或期间阻断 $id',c=>{const ctx=context(c.input);expect(()=>audit(ctx)).toThrow();});
  it('冻结输入仍可生成独立审计，原分段/付款不变且结果不共享可变数组',()=>{
    const ctx=context(cases.find(c=>c.id==='principal-segments-cross-period-cut')!.input),result=calculateFunding(ctx.plan,ctx.binding)!;
    Object.assign(ctx.schedule.periods[0]!,{unknown_extension:{private:'keep'}});
    const before=JSON.stringify({ctx,result});freeze(ctx);freeze(result);const a=calculateFundingPeriods(result,ctx.schedule,ctx.rounding)!;
    expect(JSON.stringify({ctx,result})).toBe(before);a.periods[0]!.reference='changed';a.periods[0]!.fragments[0]!.principal_references.push('changed');
    expect(a.periods[0]).not.toHaveProperty('unknown_extension');
    expect(JSON.stringify({ctx,result})).toBe(before);expect(a.periods[0]!.fragments.map(f=>f.segment_index)).toEqual([0,1]);
    expect(a.periods[1]!.fragments.map(f=>f.segment_index)).toEqual([1,2]);expect(a.periods[1]!.fragments[0]!.principal_references).toContain(ctx.plan.funding!.events![0]!.reference);
    expect(a.scope_difference).toBe('0.00');
  });
  it('不使用已有近似原值、片段成本或舍入值作为输入，也不按比例分摊',()=>{
    const ctx=context(cases.find(c=>c.id==='period-cut-inside-calculation-segment')!.input),r=calculateFunding(ctx.plan,ctx.binding)!;
    r.cost='999999';r.ledger!.segments[0]!.cost='888888';const a=calculateFundingPeriods(r,ctx.schedule,ctx.rounding)!;
    expect(a.unrounded_cost).toBe('0.018');expect(a.periods.map(p=>p.unrounded_cost)).toEqual(['0.006','0.012']);expect(r.cost).toBe('999999');
  });
  it('原1.4已舍入结果独立保留，按新期间重新归集原始输入',()=>{
    const ctx=context(),plan=enableFundingRounding(ctx.plan);plan.funding!.status='PROVIDED';Object.assign(plan.funding!.rounding!,{status:'APPLIED',scope:'INTERVALS',mode:'HALF_UP',unit:'0.01',reference:'旧区间独立依据',intervals_confirmed:true});
    const result=calculateFunding(plan,ctx.binding)!;expect(result.rounding!.rounded_cost).toBe('0.03');const before=JSON.stringify(result);
    expect(calculateFundingPeriods(result,ctx.schedule,ctx.rounding)!.rounded_cost).toBe('0.02');expect(JSON.stringify(result)).toBe(before);
  });
  it('未应用是null，未确认是阻断；未应用也检查结构，不能补零或沿用旧确认',()=>{
    const ctx=context(),result=calculateFunding(ctx.plan,ctx.binding)!;ctx.schedule=newFundingPeriodSchedule();ctx.rounding=newFundingPeriodRounding();
    expect(()=>calculateFundingPeriods(result,ctx.schedule,ctx.rounding)).toThrow('未知');ctx.rounding.status='NOT_APPLIED';expect(calculateFundingPeriods(result,ctx.schedule,ctx.rounding)).toBeNull();
    (ctx.schedule as unknown as Record<string,unknown>).periods_confirmed='true';expect(()=>calculateFundingPeriods(result,ctx.schedule,ctx.rounding)).toThrow('布尔值');
  });
  it('恒定本金/利率无账本也支持显式期间，机会成本不生成收付',()=>{
    const ctx=context();Object.assign(ctx.plan.funding!,{balance_model:'CONSTANT',rate_model:'CONSTANT',kind:'OPPORTUNITY',party:'BUYER'});
    ctx.schedule.periods=[{id:'a',start_date:'2026-09-01',end_date:'2026-09-02',reference:'明确假设'},{id:'b',start_date:'2026-09-02',end_date:'2026-09-04',reference:'明确假设'}];
    const result=calculateFunding(ctx.plan,ctx.binding)!;expect(result.ledger).toBeUndefined();const before=JSON.stringify(ctx.plan);expect(calculateFundingPeriods(result,ctx.schedule,ctx.rounding)!.rounded_cost).toBe('0.02');expect(JSON.stringify(ctx.plan)).toBe(before);
  });
  it('任意正步长0.05按步长个数取偶；恰半上下40位十进制不复用显示近似',()=>{
    const ctx=context();Object.assign(ctx.plan.funding!,{principal:'75',annual_rate:'60',end_date:'2026-09-02',rate_events:[]});ctx.schedule.periods[0]!.end_date='2026-09-02';ctx.rounding.unit='0.0500';ctx.rounding.mode='HALF_EVEN';
    expect(audit(ctx)).toMatchObject({unit:'0.05',rounded_cost:'0.10',unrounded_fraction:'1 / 8'});ctx.rounding.mode='HALF_UP';expect(audit(ctx).rounded_cost).toBe('0.15');
    ctx.rounding.unit='0.01';ctx.plan.funding!.annual_rate='100';ctx.plan.funding!.principal='1.7999999999999999999999999999999999999999';expect(audit(ctx).rounded_cost).toBe('0.00');
    ctx.plan.funding!.principal='1.8000000000000000000000000000000000000001';expect(audit(ctx).rounded_cost).toBe('0.01');
  });
  it('20位本金、微额及长期期间按原输入精确计算，不转JS金额或逐日迭代',()=>{
    const ctx=context();Object.assign(ctx.plan.funding!,{principal:'12345678901234567890.125',annual_rate:'36000',end_date:'2026-09-02',rate_events:[]});ctx.schedule.periods[0]!.end_date='2026-09-02';
    expect(audit(ctx).rounded_cost).toBe('12345678901234567890.13');ctx.plan.funding!.principal='0.00000000000000000001';ctx.rounding.unit='0.0000000000000000000001';expect(audit(ctx).rounded_cost).toBe('0.0000000000000000000100');
    Object.assign(ctx.plan.funding!,{principal:'1',annual_rate:'36000',start_date:'1000-01-01',end_date:'9999-01-01'});ctx.schedule.periods=[{id:'long',start_date:'1000-01-01',end_date:'9999-01-01',reference:'长期合成假设'}];ctx.rounding.unit='1';
    const result=calculateFunding(ctx.plan,ctx.binding)!;expect(calculateFundingPeriods(result,ctx.schedule,ctx.rounding)!.rounded_cost).toBe(String(result.days));
  });
  it.each(['','0','-0.01','1e-2','1,000','1/3','NaN','9'.repeat(81),'0.'+'0'.repeat(40)+'1'])('坏金额步长%s阻断',unit=>{const ctx=context();ctx.rounding.unit=unit;expect(()=>audit(ctx)).toThrow('金额步长');});
  it.each(['rounding-reference','period-reference','mode'])('缺必要业务依据%s不应用',kind=>{const ctx=context();if(kind==='rounding-reference')ctx.rounding.reference=' ';if(kind==='period-reference')ctx.schedule.periods[0]!.reference=' ';if(kind==='mode')ctx.rounding.mode='UNCONFIRMED';expect(()=>audit(ctx)).toThrow('期间归集');});
  it.each(['days','gap','overlap','negative','bad-rate','zero-segment','bad-currency','bad-basis','bad-source'])('原分段/条件不一致%s不修补',kind=>{
    const ctx=context(),r=calculateFunding(ctx.plan,ctx.binding)!;
    if(kind==='days')r.days++;if(kind==='gap')r.ledger!.segments.splice(0,1);if(kind==='overlap')r.ledger!.segments[1]!.start_date='2026-09-01';if(kind==='negative')r.ledger!.segments[0]!.principal='-1';
    if(kind==='bad-rate')r.ledger!.segments[0]!.annual_rate='NaN';if(kind==='zero-segment')r.ledger!.segments[0]!.end_date=r.start_date;if(kind==='bad-currency')r.currency='';if(kind==='bad-basis')(r as unknown as Record<string,unknown>).denominator=366;if(kind==='bad-source')r.ledger!.segments[0]!.rate_reference='';
    expect(()=>calculateFundingPeriods(r,ctx.schedule,ctx.rounding)).toThrow('期间归集');
  });
  it('120组独立逐日整数账本、三种方式及0.01/0.05步长，不复用生产求交集或分数算法',()=>{
    let seed=991;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed;};
    const round=(weight:number,denominator:number,unit:number,mode:string)=>{const base=denominator*unit,q=Math.floor(weight/base),rem=weight%base;return(q+(mode!=='DOWN'&&(rem*2>base||rem*2===base&&(mode==='HALF_UP'||q%2===1))?1:0))*unit;};
    const cents=(n:number)=>`${Math.floor(n/100)}.${String(n%100).padStart(2,'0')}`;
    const rational=(n:bigint,d:bigint)=>{let a=n,b=d;while(b){const c=a%b;a=b;b=c;}return`${n/a}/${d/a}`;};
    for(let c=0;c<120;c++){
      const ctx=context(),f=ctx.plan.funding!,denominator=random()%2?360:365,unit=random()%2?1:5;let balance=random()%500,rate=random()%21,total=0,periodWeight=0,start=1;
      const weights:number[]=[];Object.assign(f,{principal:String(balance),annual_rate:String(rate),day_basis:denominator===360?'ACT_360':'ACT_365F',end_date:'2026-09-11',events:[],rate_events:[]});ctx.schedule.periods=[];ctx.rounding.unit=unit===1?'0.01':'0.05';
      for(let day=1;day<=10;day++){
        const date=`2026-09-${String(day).padStart(2,'0')}`;
        if(random()%3===0){const amount=1+random()%50,direction=balance>=amount&&random()%2?'DECREASE':'INCREASE';balance+=direction==='INCREASE'?amount:-amount;f.events!.push({id:'p'+day,date,direction,amount:String(amount),currency:'USD',reference:'独立逐日本金'});}
        if(random()%3===0){rate=random()%21;f.rate_events!.push({id:'r'+day,date,annual_rate:String(rate),reference:'独立逐日新率'});}
        total+=balance*rate;periodWeight+=balance*rate;
        if(day===10||random()%3===0){weights.push(periodWeight);periodWeight=0;ctx.schedule.periods.push({id:'period'+day,start_date:`2026-09-${String(start).padStart(2,'0')}`,end_date:`2026-09-${String(day+1).padStart(2,'0')}`,reference:'独立明确期间'});start=day+1;}
      }
      const result=calculateFunding(ctx.plan,ctx.binding)!,before=JSON.stringify(result);
      for(const mode of ['HALF_UP','HALF_EVEN','DOWN'] as const){ctx.rounding.mode=mode;const a=calculateFundingPeriods(result,ctx.schedule,ctx.rounding)!;
        expect(compact(a.unrounded_fraction)).toBe(rational(BigInt(total),BigInt(100*denominator)));expect(a.periods.map(p=>compact(p.unrounded_fraction))).toEqual(weights.map(w=>rational(BigInt(w),BigInt(100*denominator))));
        expect(a.periods.map(p=>p.rounded_cost)).toEqual(weights.map(w=>cents(round(w,denominator,unit,mode))));expect(a.rounded_cost).toBe(cents(weights.reduce((sum,w)=>sum+round(w,denominator,unit,mode),0)));expect(a.total_rounded).toBe(cents(round(total,denominator,unit,mode)));expect(JSON.stringify(result)).toBe(before);
      }
    }
  });
  it('100期与各100个本金/利率事件的201个原分段完整覆盖，无漏日或重复计入',()=>{
    const ctx=context(),f=ctx.plan.funding!,iso=(day:number)=>new Date(Date.UTC(2026,8,1+day)).toISOString().slice(0,10);
    Object.assign(f,{principal:'1',annual_rate:'1',end_date:iso(201),events:[],rate_events:[]});ctx.schedule.periods=[];
    for(let i=0;i<100;i++){
      f.events!.push({id:'p'+i,date:iso(i*2+1),direction:'INCREASE',amount:'1',currency:'USD',reference:'最大事件组'});
      f.rate_events!.push({id:'r'+i,date:iso(i*2+2),annual_rate:String((i+1)%21),reference:'最大事件组'});
      ctx.schedule.periods.push({id:'s'+i,start_date:iso(i*2),end_date:iso(i===99?201:(i+1)*2),reference:'100期显式划分'});
    }
    let balance=1,rate=1,weight=0;for(let day=0;day<201;day++){if(day%2===1)balance++;if(day>0&&day%2===0)rate=(day/2)%21;weight+=balance*rate;}
    const a=audit(ctx);expect(a.periods).toHaveLength(100);expect(a.calculation_segment_count).toBe(201);expect(a.periods.flatMap(p=>p.fragments).reduce((n,f)=>n+f.days,0)).toBe(201);
    const [numerator,denominator]=a.unrounded_fraction.split(' / ').map(BigInt);expect(numerator!*36000n).toBe(BigInt(weight)*denominator!);
  });
});

describe('独立结构校验及旧文件不激活新字段',()=>{
  it('默认对象无事实确认，草稿空白可保留，工厂对象互不共享',()=>{
    const s=newFundingPeriodSchedule(),r=newFundingPeriodRounding();expect(()=>validateFundingPeriodSchedule(s)).not.toThrow();expect(()=>validateFundingPeriodRounding(r)).not.toThrow();
    expect(s).toMatchObject({status:'UNCONFIRMED',reference:'',periods_confirmed:false,periods:[]});s.periods.push({id:'p',start_date:'',end_date:'',reference:''});expect(()=>validateFundingPeriodSchedule(s)).not.toThrow();expect(newFundingPeriodSchedule().periods).toEqual([]);
  });
  it.each(['missing','numeric-reference','bad-status','string-confirmation','not-array','too-many','numeric-id','reserved-id','long-text'])('坏结构%s不能当草稿',kind=>{
    const s=structuredClone(cases[0]!.input.schedule) as unknown as Record<string,unknown>;
    if(kind==='missing')delete s.periods;if(kind==='numeric-reference')s.reference=1;if(kind==='bad-status')s.status='AUTO';if(kind==='string-confirmation')s.periods_confirmed='true';if(kind==='not-array')s.periods={};if(kind==='too-many')s.periods=Array.from({length:101},(_,i)=>({id:String(i),start_date:'',end_date:'',reference:''}));
    if(kind==='numeric-id')(s.periods as Record<string,unknown>[])[0]!.id=1;if(kind==='reserved-id')(s.periods as Record<string,unknown>[])[0]!.id='constructor';if(kind==='long-text')s.reference='x'.repeat(4001);expect(()=>validateFundingPeriodSchedule(s)).toThrow('结构');
  });
  it.each(['numeric-unit','bad-status','bad-scope','bad-mode','numeric-reference'])('坏舍入结构%s不接受',kind=>{
    const r={...cases[0]!.input.rounding,status:'NOT_APPLIED'} as Record<string,unknown>;if(kind==='numeric-unit')r.unit=0.01;if(kind==='bad-status')r.status='AUTO';if(kind==='bad-scope')r.scope='TOTAL';if(kind==='bad-mode')r.mode='AUTO';if(kind==='numeric-reference')r.reference=0;expect(()=>validateFundingPeriodRounding(r)).toThrow('结构');
  });
  it.each(['1.0','1.1','1.2','1.3','1.4'] as const)('旧%s同名扩展原文往返，既有计算和文件版本保持',version=>{
    const ctx=context();let plan: SettlementPlan=version==='1.4'?enableFundingRounding(ctx.plan):structuredClone(ctx.plan);plan.version=version;
    if(version==='1.0')delete plan.funding;else{
      plan.funding!.status='PROVIDED';if(version==='1.4')plan.funding!.rounding!.status='NOT_APPLIED';
      Object.assign(plan.funding!,{period_schedule:'PRIVATE_LEGACY_PERIOD_EXTENSION'});
    }
    Object.assign(plan,{period_schedule:{keep:'😀'}});const before=serializeSettlementPlan(plan),parsed=parseSettlementPlan(before);expect(serializeSettlementPlan(parsed)).toBe(before);expect(parsed.version).toBe(version);
    if(version==='1.0'){expect(()=>calculateFunding(parsed,ctx.binding)).toThrow('尚未设置');}else{const a=calculateFunding(parsed,ctx.binding)!;expect(a).not.toHaveProperty('periods');expect(a).not.toHaveProperty('period_schedule');expect(a.cost).toBe('0.018');}
  });
  it('未来1.6和旧1.4新层级仍拒绝，不把独立类型当已启用文件格式',()=>{
    const ctx=context(),plan=enableFundingRounding(ctx.plan),future=JSON.parse(serializeSettlementPlan(plan));future.version='1.6';expect(()=>parseSettlementPlan(JSON.stringify(future))).toThrow('受支持');future.version='1.4';future.funding.rounding.scope='PERIODS';expect(()=>parseSettlementPlan(JSON.stringify(future))).toThrow('scope');
  });
});
