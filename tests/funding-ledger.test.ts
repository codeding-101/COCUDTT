import {describe,expect,it} from 'vitest';
import {enableFundingLedger,newSettlementPlan} from '../src/domain/settlement';
import type {FundingPrincipalEvent} from '../src/domain/funding';
import {calculateFunding} from '../src/engine/funding';
import {calculateSettlement} from '../src/engine/settlement';
import {settlementBinding} from '../src/data/settlement-context';
import {parseSettlementPlan,serializeSettlementPlan} from '../src/data/settlement-file';
import {renderFundingFields,renderFundingResult} from '../src/ui/funding';
import {actualQuotesProject} from './fixtures/actual-quotes';
import {createInternalWorkbook,createCustomerWorkbook,internalWorkbookSnapshot} from '../src/ui/workbook-export';
import {createProjectReport} from '../src/ui/project-report';
import {projectCustomerQuote} from '../src/ui/customer-quote';
import {emptyCustomerQuoteFields} from '../src/domain/customer-quote';
import {inspectRecoveryText} from '../src/data/recovery-review';
import {unzipSync,strFromU8} from 'fflate';
function event(id:string,date:string,direction:'INCREASE'|'DECREASE',amount:string):FundingPrincipalEvent{return{id,date,direction,amount,currency:'USD',reference:'PRIVATE_EVENT_'+id};}
function fixture(){
 const project=actualQuotesProject();project.incoterm='FOB';const binding=settlementBinding(project),plan=enableFundingLedger(newSettlementPlan(binding));
 plan.method='TT';plan.bank_status='NO_FEES';plan.payments=[{id:'pay',basis:'PERCENT',value:'100',date:'2026-10-01',trigger:'合成计划'}];
 Object.assign(plan.funding!,{status:'PROVIDED',kind:'FINANCING',party:'SELLER',principal:'12000',currency:'USD',start_date:'2026-09-01',end_date:'2026-10-01',annual_rate:'6',day_basis:'ACT_360',reference:'PRIVATE_LEDGER_817',events:[event('repay','2026-09-11','DECREASE','4000'),event('draw','2026-09-21','INCREASE','2000')]});
 return{project,binding,plan};
}
const bookText=(bytes:Uint8Array)=>Object.values(unzipSync(bytes)).map(v=>strFromU8(v)).join('\n');
describe('显式本金事件，先本金×天数再计息',()=>{
 it('三段12000/8000/10000各10天，成本50，截止余额10000，不生成付款',()=>{
  const{plan,binding}=fixture(),before=JSON.stringify(plan),cash=calculateSettlement(plan,binding,null),result=calculateFunding(plan,binding)!;
  expect(result.cost).toBe('50');expect(result.ledger).toMatchObject({closing_principal:'10000',principal_days:'300000'});
  expect(result.ledger!.segments.map(s=>[s.principal,s.days])).toEqual([['12000',10],['8000',10],['10000',10]]);expect(result.ledger!.segments[0]!.cost).toBe('20');expect(result.ledger!.segments[1]!.cost).toMatch(/^13\.333333333333/);expect(result.ledger!.segments[2]!.cost).toMatch(/^16\.666666666666/);
  expect(result.ledger!.events.map(e=>[e.before,e.after])).toEqual([['12000','8000'],['8000','10000']]);expect(result.formula).toBe('300000 × 6 ÷ 100 ÷ 360');expect(calculateSettlement(plan,binding,null)).toEqual(cash);expect(JSON.stringify(plan)).toBe(before);
 });
 it('期初日变化在计息前生效，截止日还本只改变余额、不多计一天',()=>{
  const{plan,binding}=fixture();plan.funding!.events=[event('start','2026-09-01','DECREASE','2000'),event('end','2026-10-01','DECREASE','10000')];const r=calculateFunding(plan,binding)!;
  expect(r.cost).toBe('50');expect(r.ledger!.closing_principal).toBe('0');expect(r.ledger!.segments).toHaveLength(1);expect(r.ledger!.segments[0]).toMatchObject({days:30,principal:'10000'});
 });
 it('同日先增后减记录两笔，不制造零天利息；先减越界仍退出',()=>{
  const{plan,binding}=fixture();plan.funding!.principal='0';plan.funding!.events=[event('draw','2026-09-01','INCREASE','12000'),event('repay','2026-09-01','DECREASE','2000')];expect(calculateFunding(plan,binding)!.cost).toBe('50');expect(calculateFunding(plan,binding)!.ledger!.events).toHaveLength(2);
  plan.funding!.events.reverse();expect(()=>calculateFunding(plan,binding)).toThrow('超过当时本金');
 });
 it('余额降到零后的区间明确为零，后续增额从当日起计息',()=>{
  const{plan,binding}=fixture();plan.funding!.events=[event('all','2026-09-11','DECREASE','12000'),event('again','2026-09-21','INCREASE','6000')];const r=calculateFunding(plan,binding)!;expect(r.cost).toBe('30');expect(r.ledger!.segments[1]).toMatchObject({principal:'0',days:10,cost:'0'});
 });
 it('独立逐日整数对照96组已知账本，不使用分段公式作为测试预言',()=>{
  let seed=51;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed;};
  for(let c=0;c<96;c++){
   const{plan,binding}=fixture();let balance=BigInt(random()%10000),daily=0n;plan.funding!.principal=String(balance);plan.funding!.annual_rate='36';plan.funding!.events=[];
   for(let day=1;day<=30;day++){
    if(random()%3===0){const decrease=random()%2===0&&balance>0n,amount=decrease?1n+BigInt(random())%balance:1n+BigInt(random()%1000);plan.funding!.events.push(event('event-'+day,`2026-09-${String(day).padStart(2,'0')}`,decrease?'DECREASE':'INCREASE',String(amount)));balance+=decrease?-amount:amount;}
    daily+=balance;
   }
   const r=calculateFunding(plan,binding)!;expect(r.ledger!.principal_days).toBe(String(daily));expect(r.ledger!.closing_principal).toBe(String(balance));const expected=(daily/1000n).toString()+'.'+(daily%1000n).toString().padStart(3,'0');expect(Number(r.cost)).toBe(Number(expected));
  }
 });
 it('闰年两段真实天数且ACT/365F固定除365，不按30/360',()=>{
  const{plan,binding}=fixture();Object.assign(plan.funding!,{principal:'36500',annual_rate:'10',start_date:'2024-02-28',end_date:'2024-03-02',day_basis:'ACT_365F',events:[event('cut','2024-03-01','DECREASE','18250')]});
  const r=calculateFunding(plan,binding)!;expect(r.cost).toBe('25');expect(r.ledger!.segments.map(s=>s.days)).toEqual([2,1]);
 });
 it.each(['','0','-1','1e3','1,000','NaN','9'.repeat(81),'0.'+'0'.repeat(40)+'1'])('无效事件金额%s不补零或转数值',amount=>{const{plan,binding}=fixture();plan.funding!.events![0]!.amount=amount;expect(()=>calculateFunding(plan,binding)).toThrow();});
 it.each(['2026-08-31','2026-10-02','2026-02-30',''])('事件日期%s无效或区间外不静默忽略',date=>{const{plan,binding}=fixture();plan.funding!.events![0]!.date=date;expect(()=>calculateFunding(plan,binding)).toThrow();});
 it.each(['currency','reference'] as const)('缺失%s、币种冲突或无依据退出',field=>{const{plan,binding}=fixture();plan.funding!.events![0]![field]='';expect(()=>calculateFunding(plan,binding)).toThrow();if(field==='currency'){plan.funding!.events![0]!.currency='CNY';expect(()=>calculateFunding(plan,binding)).toThrow('币种');}});
 it('逆序和过额还本不自动排序、取绝对值或净额合并',()=>{const{plan,binding}=fixture();plan.funding!.events!.reverse();expect(()=>calculateFunding(plan,binding)).toThrow('升序');plan.funding!.events=[event('too-much','2026-09-01','DECREASE','12001')];expect(()=>calculateFunding(plan,binding)).toThrow('超过当时本金');});
 it('空本金/利率与明确零区分；同日事件仍校验，不用0天掩盖错误',()=>{
  const{plan,binding}=fixture();plan.funding!.principal='';expect(()=>calculateFunding(plan,binding)).toThrow('期初本金');plan.funding!.principal='0';plan.funding!.events=[];expect(calculateFunding(plan,binding)!.cost).toBe('0');plan.funding!.annual_rate='';expect(()=>calculateFunding(plan,binding)).toThrow('年利率');
  plan.funding!.annual_rate='0';plan.funding!.end_date=plan.funding!.start_date;plan.funding!.events=[event('end','2026-09-01','INCREASE','10')];expect(calculateFunding(plan,binding)).toMatchObject({cost:'0',days:0,ledger:{closing_principal:'10',segments:[]}});plan.funding!.events[0]!.reference='';expect(()=>calculateFunding(plan,binding)).toThrow('依据');
 });
 it('不测算与固定模型保留事件，但不激活未完成业务输入；结构仍须合法',()=>{
  const{plan,binding}=fixture();plan.funding!.events![0]!.amount='';plan.funding!.status='NOT_MODELED';expect(calculateFunding(plan,binding)).toBeNull();plan.funding!.status='PROVIDED';plan.funding!.balance_model='CONSTANT';expect(calculateFunding(plan,binding)).toMatchObject({cost:'60'});expect(calculateFunding(plan,binding)!.ledger).toBeUndefined();
  plan.funding!.balance_model='EVENTS';expect(()=>calculateFunding(plan,binding)).toThrow();binding.amount='20000';expect(()=>calculateFunding(plan,binding)).toThrow('重新绑定');
 });
 it('高精度期初和事件以原文保存，合计不按分段小数预先舍入',()=>{const{plan,binding}=fixture();Object.assign(plan.funding!,{principal:'0.00000000000000000001',annual_rate:'6',events:[],day_basis:'ACT_365F'});const r=calculateFunding(plan,binding)!;expect(r.ledger!.principal_days).toBe('0.0000000000000000003');expect(r.cost).toMatch(/^0\.0+4931506849/);expect(parseSettlementPlan(serializeSettlementPlan(plan)).funding!.principal).toBe('0.00000000000000000001');});
});
describe('1.2显式升级、旧文件及内部审计',()=>{
 it('升级保留付款和扩展、重新确认状态且不创造本金事件',()=>{const{plan,binding}=fixture(),legacy=newSettlementPlan(binding);Object.assign(legacy,{extra:{keep:'😀'}});legacy.funding!.status='PROVIDED';const raw=JSON.stringify(legacy),next=enableFundingLedger(legacy);expect(next.version).toBe('1.2');expect(next.funding).toMatchObject({status:'UNCONFIRMED',balance_model:'EVENTS',events:[]});expect(JSON.stringify(legacy)).toBe(raw);expect(next.payments).toEqual(legacy.payments);expect(parseSettlementPlan(serializeSettlementPlan(plan))).toEqual(plan);});
 it('旧1.1的重名扩展仍往返且不参与旧计算，显式升级拒绝覆盖',()=>{const{binding}=fixture(),legacy=newSettlementPlan(binding);Object.assign(legacy.funding!,{status:'PROVIDED',kind:'FINANCING',party:'SELLER',principal:'12000',currency:'USD',start_date:'2026-09-01',end_date:'2026-10-01',annual_rate:'6',day_basis:'ACT_360',reference:'legacy',balance_model:'EVENTS',events:'PRIVATE_LEGACY_EXTENSION'});expect(parseSettlementPlan(serializeSettlementPlan(legacy))).toEqual(legacy);expect(calculateFunding(legacy,binding)!.cost).toBe('60');expect(()=>enableFundingLedger(legacy)).toThrow('重名');expect(renderFundingFields(legacy)).not.toContain('data-settlement-row="funding-event"');});
 it.each(['missing-events','bad-model','numeric-amount','bad-direction','duplicate-id','reserved-id','too-many','future-version'])('坏结构%s不替换文件或静默清洗',kind=>{
  const{plan}=fixture(),raw=JSON.parse(serializeSettlementPlan(plan));if(kind==='missing-events')delete raw.funding.events;if(kind==='bad-model')raw.funding.balance_model='AUTO';if(kind==='numeric-amount')raw.funding.events[0].amount=5;if(kind==='bad-direction')raw.funding.events[0].direction='AUTO';if(kind==='duplicate-id')raw.funding.events[1].id=raw.funding.events[0].id;if(kind==='reserved-id')raw.funding.events[0].id='__proto__';if(kind==='too-many')raw.funding.events=Array.from({length:101},(_,i)=>event('e'+i,'2026-09-01','INCREASE','1'));if(kind==='future-version')raw.version='1.5';expect(()=>parseSettlementPlan(JSON.stringify(raw))).toThrow();
 });
 it('100条事件上限可以计算，时点同日不生成100个虚假计息区间',()=>{const{plan,binding}=fixture();plan.funding!.principal='0';plan.funding!.events=Array.from({length:100},(_,i)=>event('e'+i,'2026-09-01','INCREASE','1'));expect(calculateFunding(plan,binding)).toMatchObject({cost:'0.5',ledger:{closing_principal:'100'}});expect(calculateFunding(plan,binding)!.ledger!.segments).toHaveLength(1);});
 it('内部Excel和HTML记录输入、事件、区间并转义；客户文件不读取账本',()=>{
  const{plan,project}=fixture();plan.funding!.events![0]!.reference='<script>PRIVATE_EVENT_AUDIT</script>';const before=JSON.stringify({plan,project}),snapshot=internalWorkbookSnapshot(project,'2026-10-13T00:00:00Z',undefined,plan),text=bookText(createInternalWorkbook(project,undefined,undefined,plan));
  expect(snapshot.sheets).toHaveLength(8);expect(text).toContain('事件审计');expect(text).toContain('区间 2026-09-11');expect(text).toContain('300000 × 6');expect(text).not.toContain('<f>');const html=createProjectReport(project,undefined,undefined,plan);expect(html).toContain('data-funding-ledger');expect(html).toContain('&lt;script&gt;PRIVATE_EVENT_AUDIT');
  const client=bookText(createCustomerWorkbook(projectCustomerQuote(project,emptyCustomerQuoteFields())));expect(client).not.toContain('PRIVATE_LEDGER');expect(client).not.toContain('PRIVATE_EVENT');expect(JSON.stringify({plan,project})).toBe(before);plan.funding!.events![0]!.amount='99999';expect(JSON.stringify(snapshot)).toContain('300000 × 6');
 });
 it('损坏事件不出旧分段金额，内部文件仍保留原始事件和失败原因',()=>{const{plan,project,binding}=fixture();plan.funding!.events![0]!.amount='';expect(renderFundingResult(plan,binding)).not.toContain('data-funding-ledger');const text=bookText(createInternalWorkbook(project,undefined,undefined,plan));expect(text).toContain('PRIVATE_EVENT_repay');expect(text).toContain('非负十进制');expect(text).not.toContain('300000 × 6');});
 it('恢复快照只读检查识别新付款格式，不自动升级或导入账本',()=>{const{plan}=fixture();const report=inspectRecoveryText(JSON.stringify({kind:'INTERNAL_RECOVERY_SNAPSHOT',version:'1.0',stage:'RENDER',settlement_plan:plan}));expect(report.parts.find(p=>p.key==='settlement_plan')!.status).toBe('STRUCTURE_OK');expect(JSON.stringify(report)).not.toContain('PRIVATE_EVENT');});
});
