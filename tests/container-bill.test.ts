import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import type {ContainerBillDailyLine,ContainerBillInput,ContainerBillLineAudit} from '../src/domain/container-bill';
import {calculateContainerBill,validateContainerBillInput} from '../src/engine/container-bill';
import {logisticsProject} from './fixtures/logistics-project';
import {toScenario,toTrade,serializeProject} from '../src/data/project-file';
import {analyze} from '../src/engine/analyze';

const fixture=JSON.parse(readFileSync(new URL('../docs/cases/container-bill-design.json',import.meta.url),'utf8')) as {
 cases:{id:string;input:ContainerBillInput;expected:Partial<ContainerBillLineAudit>;hand:string}[];
};
const setup=()=>structuredClone(fixture.cases[0]!.input);
const line=(input:ContainerBillInput)=>input.lines[0] as ContainerBillDailyLine;
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function pair(){const input=setup();input.lines.push({...structuredClone(line(input)),line_id:'second'});return input;}

describe('集装箱独立假设：固定手算与逐日审计',()=>{
 it.each(fixture.cases)('$id：$hand',({input,expected})=>{
  const result=calculateContainerBill(freeze(input));expect(result).toMatchObject({version:'0.1',scope:'ASSUMPTION_ONLY',lines:[expected],potential_overlaps:[]});
  const audit=result.lines[0]!;
  expect(audit.input).toEqual(input.lines[0]);expect(audit.input).not.toBe(input.lines[0]);
  expect(audit.days.filter(d=>d.status==='CHARGED')).toHaveLength(audit.billable_days??0);
  expect(audit.days.filter(d=>d.status==='FREE')).toHaveLength(audit.consumed_free_days??0);
 });
 it('免费天和阶梯序号各自保留，阶汇总不反算末阶费率',()=>{
  const a=calculateContainerBill(fixture.cases.find(c=>c.id==='tiers-FROM_PERIOD_START')!.input).lines[0]!;
  expect(a.days[0]).toMatchObject({status:'FREE',billable_day:null,tier_day:null,rate:null,amount:'0'});
  expect(a.days[2]).toMatchObject({date:'2026-10-03',period_day:3,billable_day:1,tier_day:3,tier_index:1,rate:'20',amount:'40'});
  expect(a.tier_totals).toEqual([
   {tier_index:0,days:0,rate:'10',per_container_amount:'0',amount:'0'},
   {tier_index:1,days:2,rate:'20',per_container_amount:'40',amount:'80'},
   {tier_index:2,days:4,rate:'30',per_container_amount:'120',amount:'240'},
  ]);
 });
 it('空行表仅为空假设，没有总额、完整性或可推荐标志',()=>{
  expect(calculateContainerBill({version:'0.1',lines:[]})).toEqual({version:'0.1',scope:'ASSUMPTION_ONLY',lines:[],potential_overlaps:[]});
 });
 it('分行免费期独立，不合并箱数或免费天池，不汇兑不同币种',()=>{
  const input=pair(),second=input.lines[1] as ContainerBillDailyLine;second.container_ids=['OTHER'];second.currency='CNY';second.daily.free_days=4;
  const r=calculateContainerBill(input);expect(r.lines.map(l=>l.amount)).toEqual(['30','10']);expect(r.potential_overlaps).toEqual([]);expect(r).not.toHaveProperty('total');
 });
 it('源数据冻结、返回快照隔离，不改变已有报价包含、责任、风险和海关计算',()=>{
  const project=logisticsProject('CIF'),args={scenario:toScenario(project),trade:toTrade(project),taxProfile:project.tax_profile,fxBooks:project.fx_books},before=analyze(args),json=serializeProject(project);
  const input=setup(),raw=JSON.stringify(input),r=calculateContainerBill(freeze(input));r.lines[0]!.input.container_ids[0]='CHANGED';
  expect(JSON.stringify(input)).toBe(raw);expect(serializeProject(project)).toBe(json);expect(analyze(args)).toEqual(before);
 });
});

const invalid:[string,(input:any)=>void][]=[
 ['future-version',i=>i.version='0.2'],['unknown-root-field',i=>i.source='private'],['missing-root-version',i=>delete i.version],
 ['null-lines',i=>i.lines=null],['too-many-lines',i=>i.lines=Array.from({length:51},(_,n)=>({...i.lines[0],line_id:String(n)}))],
 ['duplicate-line-id',i=>i.lines.push(structuredClone(i.lines[0]))],['missing-scope',i=>delete i.lines[0].scope_id],['blank-source',i=>i.lines[0].reference=' '],
 ['long-source',i=>i.lines[0].reference='x'.repeat(4001)],['long-id',i=>i.lines[0].line_id='x'.repeat(201)],['bad-direction',i=>i.lines[0].direction='UNKNOWN'],
 ['currency-case',i=>i.lines[0].currency='usd'],['currency-newline',i=>i.lines[0].currency='USD\n'],['currency-empty',i=>i.lines[0].currency=''],['zero-containers',i=>i.lines[0].container_ids=[]],
 ['sparse-lines',i=>i.lines=Array(1)],['sparse-containers',i=>i.lines[0].container_ids=Array(1)],['sparse-tiers',i=>i.lines[0].daily.tiers=Array(1)],
 ['duplicate-container',i=>i.lines[0].container_ids=['A','A']],['too-many-containers',i=>i.lines[0].container_ids=Array.from({length:51},(_,n)=>String(n))],
 ['number-container',i=>i.lines[0].container_ids=[1]],['blank-container',i=>i.lines[0].container_ids=[' ']],['unknown-charge',i=>i.lines[0].charge_kind='STORAGE'],
 ['daily-THC',i=>i.lines[0].charge_kind='THC_ORIGIN'],['unknown-mode',i=>i.lines[0].mode='PER_SHIPMENT'],['missing-period',i=>delete i.lines[0].period],
 ['invalid-date',i=>i.lines[0].period.start_date='2026-02-30'],['non-leap',i=>i.lines[0].period.start_date='2026-02-29'],
 ['timestamp',i=>i.lines[0].period.start_date='2026-10-01T00:00:00Z'],['old-year',i=>i.lines[0].period.start_date='1899-12-31'],
 ['reverse-dates',i=>i.lines[0].period.end_date='2026-09-30'],['too-long-period',i=>i.lines[0].period.end_date='2037-01-01'],
 ['missing-inclusion',i=>delete i.lines[0].period.start_included],['string-inclusion',i=>i.lines[0].period.end_included='true'],
 ['blank-event',i=>i.lines[0].period.start_event=''],['negative-free',i=>i.lines[0].daily.free_days=-1],['fractional-free',i=>i.lines[0].daily.free_days=1.5],
 ['too-much-free',i=>i.lines[0].daily.free_days=3661],['nan-free',i=>i.lines[0].daily.free_days=NaN],['missing-free',i=>delete i.lines[0].daily.free_days],
 ['working-free',i=>i.lines[0].daily.free_day_basis='WORKING_DAYS'],['working-charge',i=>i.lines[0].daily.charge_day_basis='WORKING_DAYS'],
 ['retroactive-tier',i=>i.lines[0].daily.tier_mode='ALL_DAYS_AT_LAST_RATE'],['unknown-tier-basis',i=>i.lines[0].daily.tier_basis='UNKNOWN'],
 ['no-tiers',i=>i.lines[0].daily.tiers=[]],['too-many-tiers',i=>i.lines[0].daily.tiers=Array.from({length:21},(_,n)=>({through_day:n===20?null:n+1,rate:'1'}))],
 ['last-not-open',i=>i.lines[0].daily.tiers=[{through_day:10,rate:'1'}]],['early-open',i=>i.lines[0].daily.tiers=[{through_day:null,rate:'1'},{through_day:null,rate:'2'}]],
 ['duplicate-cut',i=>i.lines[0].daily.tiers=[{through_day:2,rate:'1'},{through_day:2,rate:'2'},{through_day:null,rate:'3'}]],
 ['descending-cut',i=>i.lines[0].daily.tiers=[{through_day:3,rate:'1'},{through_day:2,rate:'2'},{through_day:null,rate:'3'}]],
 ['zero-cut',i=>i.lines[0].daily.tiers=[{through_day:0,rate:'1'},{through_day:null,rate:'2'}]],
 ['fractional-cut',i=>i.lines[0].daily.tiers=[{through_day:1.5,rate:'1'},{through_day:null,rate:'2'}]],
 ['extra-tax',i=>i.lines[0].daily.tax_rate='0.13'],['extra-fixed-rate',i=>i.lines[0].rate='1'],['missing-tier-rate',i=>delete i.lines[0].daily.tiers[0].rate],
];
describe('坏/未支持输入整份拒绝，不把未知当默认值',()=>{
 it.each(invalid)('%s',(name,mutate)=>{const i=setup();mutate(i);expect(()=>calculateContainerBill(i)).toThrow(/^CONTAINER_BILL_INVALID:/);});
 it.each(['-1','1e2','NaN','Infinity','',' 1','1 ','1\n','1.2\n','01','.5','1.','0.1234567890123456789','1234567890123456789012345',1,NaN,null])('拒绝费率 %s',value=>{
  const i=setup();(line(i).daily.tiers[0] as any).rate=value;expect(()=>calculateContainerBill(i)).toThrow(/^CONTAINER_BILL_INVALID:/);
 });
 it.each([null,[],true,1,'{"version":"0.1"}',new Date()])('拒绝根结构 %s',value=>{expect(()=>validateContainerBillInput(value)).toThrow(/^CONTAINER_BILL_INVALID:/);});
 it('坏第二行不返回第一行金额，错误不回显来源或箱号',()=>{
  const i=pair();i.lines[1]!.reference='C:\\private\\secret-contract';i.lines[1]!.container_ids=['SECRET-BOX'];(i.lines[1] as any).daily.free_days=-1;
  expect(()=>calculateContainerBill(i)).toThrow('CONTAINER_BILL_INVALID:lines[1].daily.free_days');
 });
 it('固定项拒绝每日字段和固定计费D&D',()=>{
  const fixed=structuredClone(fixture.cases.find(c=>c.id==='fixed-THC_ORIGIN')!.input);
  (fixed.lines[0] as any).period=line(setup()).period;expect(()=>calculateContainerBill(fixed)).toThrow(/^CONTAINER_BILL_INVALID:/);
  delete (fixed.lines[0] as any).period;(fixed.lines[0] as any).charge_kind='DETENTION';expect(()=>calculateContainerBill(fixed)).toThrow(/^CONTAINER_BILL_INVALID:/);
 });
});

describe('收费范围候选：不去重、不改金额、不作法律结论',()=>{
 it.each(['DEMURRAGE','DETENTION','COMBINED_DD'] as const)('联合D&D与%s共享箱和期间列候选',kind=>{
  const i=pair();(i.lines[0] as ContainerBillDailyLine).charge_kind='COMBINED_DD';(i.lines[1] as ContainerBillDailyLine).charge_kind=kind;
  const r=calculateContainerBill(i);expect(r.potential_overlaps).toEqual([{line_ids:['basic','second'],container_ids:['BOX-A'],reason:kind==='COMBINED_DD'?'SAME_DAILY_SCOPE':'COMBINED_AND_SEPARATE',start_date:'2026-10-01',end_date:'2026-10-05'}]);expect(r.lines.map(l=>l.amount)).toEqual(['30','30']);
 });
 it('分开D&D在提箱同一天交集仍提示，不擅自减掉一天',()=>{
  const i=pair(),b=i.lines[1] as ContainerBillDailyLine;b.charge_kind='DETENTION';b.period.start_date='2026-10-05';b.period.end_date='2026-10-07';
  expect(calculateContainerBill(i).potential_overlaps[0]).toMatchObject({reason:'SEPARATE_DD_SHARED_DAYS',start_date:'2026-10-05',end_date:'2026-10-05'});
  b.period.start_included=false;expect(calculateContainerBill(i).potential_overlaps).toEqual([]);
 });
 it.each(['scope','direction','container','date','empty'] as const)('不同%s不产生本候选，但无通过标志',kind=>{
  const i=pair(),b=i.lines[1] as ContainerBillDailyLine;
  if(kind==='scope')b.scope_id='other';if(kind==='direction')b.direction='EXPORT';if(kind==='container')b.container_ids=['OTHER'];
  if(kind==='date'){b.period.start_date='2026-10-06';b.period.end_date='2026-10-08';}
  if(kind==='empty'){b.period.end_date=b.period.start_date;b.period.start_included=false;}
  const r=calculateContainerBill(i);expect(r.potential_overlaps).toEqual([]);expect(r).not.toHaveProperty('review_passed');
 });
 it('不同币种/箱型不掩盖同箱同范围候选，免费期间也不被删除',()=>{
  const i=pair(),b=i.lines[1] as ContainerBillDailyLine;b.currency='CNY';b.equipment_type='20GP';b.daily.free_days=10;
  const r=calculateContainerBill(i);expect(r.potential_overlaps).toHaveLength(1);expect(r.lines.map(l=>l.amount)).toEqual(['30','0']);
 });
 it('只列共同箱，不将整组箱量认作重复',()=>{
  const i=pair();i.lines[0]!.container_ids=['A','B'];i.lines[1]!.container_ids=['B','C'];expect(calculateContainerBill(i).potential_overlaps[0]!.container_ids).toEqual(['B']);
 });
 it('固定THC同范围候选保留金额，跨类别内含需另核',()=>{
  const i=structuredClone(fixture.cases.find(c=>c.id==='fixed-THC_ORIGIN')!.input);i.lines.push({...structuredClone(i.lines[0]!),line_id:'copy'});
  expect(calculateContainerBill(i).potential_overlaps[0]).toMatchObject({reason:'SAME_FIXED_SCOPE',start_date:null,end_date:null});
  (i.lines[1] as any).charge_kind='INSPECTION';expect(calculateContainerBill(i).potential_overlaps).toEqual([]);
 });
});

describe('独立逐日对照与资源边界',()=>{
 // Independent integer-cents oracle enumerates each date and each container, not engine tiers/results.
 it.each(Array.from({length:24},(_,n)=>n))('逐箱逐日整数分手算组合%s',n=>{
  const i=setup(),r=line(i),count=n%4+1,free=n%6,length=n%9+1;
  r.container_ids=Array.from({length:count},(_,j)=>'B'+j);r.period.end_date=`2026-10-${String(length).padStart(2,'0')}`;
  r.daily.free_days=free;r.daily.tier_basis=n%2?'FROM_PERIOD_START':'AFTER_FREE_TIME';
  r.daily.tiers=[{through_day:2,rate:'1.25'},{through_day:5,rate:'2.75'},{through_day:null,rate:'4.50'}];
  let cents=0;for(let box=0;box<count;box++)for(let day=1;day<=length;day++){
   if(day<=free)continue;const tariffDay=n%2?day:day-free;cents+=tariffDay<=2?125:tariffDay<=5?275:450;
  }
  const expected=(cents/100).toFixed(2).replace(/\.?0+$/,'');expect(calculateContainerBill(i).lines[0]!.amount).toBe(expected||'0');
 });
 it('最大50行×50箱×3660日期，1225对候选完整保留',()=>{
  const i=setup(),base=line(i);base.period.start_date='2020-01-01';base.period.end_date='2030-01-07';base.daily.free_days=0;base.daily.tiers=[{through_day:null,rate:'0.000000000000000001'}];base.container_ids=Array.from({length:50},(_,j)=>'B'+j);
  i.lines=Array.from({length:50},(_,n)=>({...structuredClone(base),line_id:'L'+n}));
  const r=calculateContainerBill(i);expect(r.lines).toHaveLength(50);expect(r.lines[0]!.selected_days).toBe(3660);expect(r.lines[0]!.amount).toBe('0.000000000000183');expect(r.potential_overlaps).toHaveLength(1225);
 });
 it('20个阶梯和4000字符来源有效，不自动更改原日率文字',()=>{
  const i=setup(),r=line(i);r.reference='x'.repeat(4000);r.daily.free_days=0;r.daily.tiers=Array.from({length:20},(_,n)=>({through_day:n===19?null:n+1,rate:'1.2500'}));
  const a=calculateContainerBill(i).lines[0]!;expect(a.amount).toBe('6.25');expect(a.days[0]!.rate).toBe('1.2500');expect(a.input.reference).toHaveLength(4000);
 });
 it.each(['1900-01-01','9999-12-31'])('日期边界%s精确一日，不做事件时区推断',value=>{
  const i=setup(),r=line(i);r.period.start_date=value;r.period.end_date=value;r.daily.free_days=0;
  expect(calculateContainerBill(i).lines[0]!.days).toMatchObject([{date:value,amount:'10'}]);
 });
});
