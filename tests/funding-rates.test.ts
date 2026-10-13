import {describe,expect,it} from 'vitest';
import {enableFundingLedger,enableFundingRates,newSettlementPlan} from '../src/domain/settlement';
import {calculateFunding} from '../src/engine/funding';
import {calculateSettlement} from '../src/engine/settlement';
import {settlementBinding} from '../src/data/settlement-context';
import {parseSettlementPlan,serializeSettlementPlan} from '../src/data/settlement-file';
import {renderFundingFields,renderFundingResult} from '../src/ui/funding';
import {actualQuotesProject} from './fixtures/actual-quotes';
import {createInternalWorkbook,createCustomerWorkbook} from '../src/ui/workbook-export';
import {createProjectReport} from '../src/ui/project-report';
import {projectCustomerQuote} from '../src/ui/customer-quote';
import {emptyCustomerQuoteFields} from '../src/domain/customer-quote';
import {inspectRecoveryText} from '../src/data/recovery-review';
import {unzipSync,strFromU8} from 'fflate';
const event=(id:string,date:string,annual_rate:string)=>({id,date,annual_rate,reference:'PRIVATE_RATE_'+id});
function fixture(){
  const project=actualQuotesProject();project.incoterm='FOB';const binding=settlementBinding(project),plan=enableFundingRates(enableFundingLedger(newSettlementPlan(binding)));
  plan.method='TT';plan.bank_status='NO_FEES';plan.payments=[{id:'pay',basis:'PERCENT',value:'100',date:'2026-10-01',trigger:'合成计划'}];
  Object.assign(plan.funding!,{status:'PROVIDED',kind:'FINANCING',party:'SELLER',principal:'12000',currency:'USD',start_date:'2026-09-01',end_date:'2026-10-01',annual_rate:'6',day_basis:'ACT_360',reference:'PRIVATE_RATE_OPENING',
    events:[{id:'cut',date:'2026-09-11',direction:'DECREASE',amount:'4000',currency:'USD',reference:'本金合成'}, {id:'draw',date:'2026-09-21',direction:'INCREASE',amount:'2000',currency:'USD',reference:'本金合成'}],rate_events:[event('new','2026-09-11','9')]});
  return{project,binding,plan};
}
const bookText=(bytes:Uint8Array)=>Object.values(unzipSync(bytes)).map(v=>strFromU8(v)).join('\n');
describe('显式新年利率和本金事件合并日界',()=>{
 it('独立手算20+20+25=65；同日本金变化与新利率均在计息前生效',()=>{
  const{plan,binding}=fixture(),raw=JSON.stringify(plan),cash=calculateSettlement(plan,binding,null),r=calculateFunding(plan,binding)!;
  expect(r.cost).toBe('65');expect(r.formula).toBe('2340000 ÷ 100 ÷ 360');
  expect(r.ledger!.segments.map(s=>[s.principal,s.annual_rate,s.days,s.cost])).toEqual([['12000','6',10,'20'],['8000','9',10,'20'],['10000','9',10,'25']]);
  expect(r.rates).toMatchObject({closing_rate:'9',weighted_principal_rate_days:'2340000',events:[{before:'6',after:'9'}]});
  expect(JSON.stringify(plan)).toBe(raw);expect(calculateSettlement(plan,binding,null)).toEqual(cash);
 });
 it('新利率是绝对值不是增幅；起始日生效、截止日只记录，零利率合法',()=>{
  const{plan,binding}=fixture();plan.funding!.events=[];plan.funding!.rate_events=[event('start','2026-09-01','3'),event('zero','2026-09-11','0'),event('end','2026-10-01','12')];
  const r=calculateFunding(plan,binding)!;expect(r.cost).toBe('10');expect(r.rates!.closing_rate).toBe('12');expect(r.ledger!.segments.map(s=>s.annual_rate)).toEqual(['3','0']);
 });
 it('同日零天也检查利率与本金；先减过额不被同日增额抵消',()=>{
  const{plan,binding}=fixture();Object.assign(plan.funding!,{end_date:'2026-09-01',events:[],rate_events:[event('start','2026-09-01','0')]});
  expect(calculateFunding(plan,binding)).toMatchObject({cost:'0',days:0,ledger:{segments:[]},rates:{closing_rate:'0'}});
  plan.funding!.rate_events![0]!.annual_rate='';expect(()=>calculateFunding(plan,binding)).toThrow('年利率');plan.funding!.rate_events=[];
  plan.funding!.events=[{id:'cut',date:'2026-09-01',direction:'DECREASE',amount:'12001',currency:'USD',reference:'valid'},{id:'draw',date:'2026-09-01',direction:'INCREASE',amount:'12001',currency:'USD',reference:'valid'}];expect(()=>calculateFunding(plan,binding)).toThrow('超过当时本金');
 });
 it('恒定本金与变动利率可以独立使用，保留的本金坏业务输入不生效',()=>{
  const{plan,binding}=fixture();plan.funding!.balance_model='CONSTANT';plan.funding!.events![0]!.amount='';
  expect(calculateFunding(plan,binding)!.cost).toBe('80');expect(calculateFunding(plan,binding)!.ledger!.events).toEqual([]);
  plan.funding!.principal='0';expect(()=>calculateFunding(plan,binding)).toThrow('恒定本金');
 });
 it('固定利率模型沿用1.2结果，保留利率事件不启用；明确不测算不是零',()=>{
  const{plan,binding}=fixture();plan.funding!.rate_model='CONSTANT';plan.funding!.rate_events![0]!.annual_rate='';expect(calculateFunding(plan,binding)!.cost).toBe('50');expect(calculateFunding(plan,binding)!.rates).toBeUndefined();
  plan.funding!.balance_model='CONSTANT';expect(calculateFunding(plan,binding)!.cost).toBe('60');plan.funding!.status='NOT_MODELED';expect(calculateFunding(plan,binding)).toBeNull();plan.funding!.status='UNCONFIRMED';expect(()=>calculateFunding(plan,binding)).toThrow('空白当零');
 });
 it('独立逐日BigInt对照120组利率和余额，不复用分段算法',()=>{
  let seed=912;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed;};
  for(let c=0;c<120;c++){
    const{plan,binding}=fixture();let balance=BigInt(random()%10000),multiplier=BigInt(random()%5),daily=0n;
    Object.assign(plan.funding!,{principal:String(balance),annual_rate:String(multiplier*36n),events:[],rate_events:[]});
    for(let day=1;day<=30;day++){
      const date=`2026-09-${String(day).padStart(2,'0')}`;
      if(random()%3===0){const decrease=random()%2===0&&balance>0n,amount=decrease?1n+BigInt(random())%balance:1n+BigInt(random()%1000);plan.funding!.events!.push({id:'p'+day,date,direction:decrease?'DECREASE':'INCREASE',amount:String(amount),currency:'USD',reference:'oracle'});balance+=decrease?-amount:amount;}
      if(random()%4===0){multiplier=BigInt(random()%5);plan.funding!.rate_events!.push(event('r'+day,date,String(multiplier*36n)));}
      daily+=balance*multiplier;
    }
    const expected=`${daily/1000n}.${String(daily%1000n).padStart(3,'0')}`.replace(/0+$/,'').replace(/\.$/,'');
    const r=calculateFunding(plan,binding)!;expect(r.cost).toBe(expected);expect(r.rates!.weighted_principal_rate_days).toBe(String(daily*36n));expect(r.ledger!.closing_principal).toBe(String(balance));
  }
 });
 it('闰年跨日按实际天数、365固定；零余额仍保存非零利率区间',()=>{
  const{plan,binding}=fixture();Object.assign(plan.funding!,{principal:'36500',start_date:'2024-02-28',end_date:'2024-03-02',annual_rate:'10',day_basis:'ACT_365F',events:[],rate_events:[event('cut','2024-03-01','20')]});expect(calculateFunding(plan,binding)!.cost).toBe('40');
  plan.funding!.principal='0';const r=calculateFunding(plan,binding)!;expect(r.cost).toBe('0');expect(r.ledger!.segments).toHaveLength(2);expect(r.ledger!.segments[1]!.annual_rate).toBe('20');
 });
 it.each(['','-1','1e2','1,000','NaN','9'.repeat(81),'0.'+'0'.repeat(40)+'1'])('非法新利率%s不能补零',rate=>{const{plan,binding}=fixture();plan.funding!.rate_events![0]!.annual_rate=rate;expect(()=>calculateFunding(plan,binding)).toThrow();});
 it.each(['','2026-02-30','2026-08-31','2026-10-02'])('无效/区间外生效日%s不忽略',date=>{const{plan,binding}=fixture();plan.funding!.rate_events![0]!.date=date;expect(()=>calculateFunding(plan,binding)).toThrow();});
 it('逆序和同日重复利率拒绝，不自动挑选最后一条',()=>{
  const{plan,binding}=fixture();plan.funding!.rate_events!.push(event('second','2026-09-11','8'));expect(()=>calculateFunding(plan,binding)).toThrow('同日');plan.funding!.rate_events![1]!.date='2026-09-01';expect(()=>calculateFunding(plan,binding)).toThrow('升序');
 });
 it('未提供来源或期初利率不能由第一条事件替代；绑定变化阻断',()=>{
  const{plan,binding}=fixture();plan.funding!.rate_events![0]!.reference=' ';expect(()=>calculateFunding(plan,binding)).toThrow('依据');plan.funding!.rate_events![0]!.reference='valid';plan.funding!.annual_rate='';expect(()=>calculateFunding(plan,binding)).toThrow('期初年利率');plan.funding!.annual_rate='6';binding.amount='0';expect(()=>calculateFunding(plan,binding)).toThrow('重新绑定');
 });
 it('本金顺序、日期、币种、金额和依据继续严格检查',()=>{
  for(const key of ['date','currency','amount','reference']as const){const{plan,binding}=fixture();plan.funding!.events![0]![key]='';expect(()=>calculateFunding(plan,binding)).toThrow();}
  const{plan,binding}=fixture();plan.funding!.events!.reverse();expect(()=>calculateFunding(plan,binding)).toThrow('升序');
 });
 it('极小十进制精度保持；输出是未作货币舍入的值',()=>{
  const{plan,binding}=fixture();Object.assign(plan.funding!,{principal:'0.00000000000000000001',annual_rate:'36',events:[],rate_events:[event('r','2026-09-11','72')]});expect(calculateFunding(plan,binding)!.cost).toBe('0.0000000000000000000005');
 });
});
describe('1.3兼容、审计与隐私',()=>{
 it('显式升级保留本金付款和扩展、状态归待确认且不修改原文件',()=>{
  const{plan,binding}=fixture(),old=enableFundingLedger(newSettlementPlan(binding));Object.assign(old,{extra:{keep:'😀'}});old.funding!.status='PROVIDED';const raw=JSON.stringify(old),next=enableFundingRates(old);
  expect(JSON.stringify(old)).toBe(raw);expect(next).toMatchObject({version:'1.3',funding:{status:'UNCONFIRMED',rate_model:'EVENTS',rate_events:[]}});expect(next.payments).toEqual(old.payments);expect(next.funding!.events).toEqual(old.funding!.events);expect(parseSettlementPlan(serializeSettlementPlan(plan))).toEqual(plan);expect(()=>enableFundingRates(newSettlementPlan(binding))).toThrow('1.2');
 });
 it.each(['rate_model','rate_events'])('旧1.2重名扩展%s往返且不生效，升级不覆盖',key=>{
  const{plan,binding}=fixture();plan.version='1.2';delete plan.funding!.rate_model;delete plan.funding!.rate_events;Object.assign(plan.funding!,{[key]:'PRIVATE_LEGACY_EXTENSION'});
  expect(parseSettlementPlan(serializeSettlementPlan(plan))).toEqual(plan);expect(calculateFunding(plan,binding)!.cost).toBe('50');expect(()=>enableFundingRates(plan)).toThrow('重名');expect(renderFundingFields(plan)).not.toContain('data-settlement-row="funding-rate"');
 });
 it.each(['missing-events','bad-model','numeric-rate','duplicate-id','reserved-id','too-many','missing-reference','future'])('坏结构%s阻断，即使不测算仍检结构',kind=>{
  const{plan}=fixture(),raw=JSON.parse(serializeSettlementPlan(plan));raw.funding.status='NOT_MODELED';
  if(kind==='missing-events')delete raw.funding.rate_events;if(kind==='bad-model')raw.funding.rate_model='AUTO';if(kind==='numeric-rate')raw.funding.rate_events[0].annual_rate=9;if(kind==='duplicate-id')raw.funding.rate_events.push({...raw.funding.rate_events[0]});if(kind==='reserved-id')raw.funding.rate_events[0].id='__proto__';if(kind==='too-many')raw.funding.rate_events=Array.from({length:101},(_,i)=>event('r'+i,'2026-09-11','9'));if(kind==='missing-reference')delete raw.funding.rate_events[0].reference;if(kind==='future')raw.version='1.5';expect(()=>parseSettlementPlan(JSON.stringify(raw))).toThrow();
 });
 it('100个严格升序利率事件可计算，未完成输入仍可保存',()=>{
  const{plan,binding}=fixture();Object.assign(plan.funding!,{start_date:'2026-01-01',end_date:'2026-05-01',events:[],rate_events:Array.from({length:100},(_,i)=>event('r'+i,new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),'6'))});expect(calculateFunding(plan,binding)!.rates!.events).toHaveLength(100);plan.funding!.rate_events![0]!.annual_rate='';expect(parseSettlementPlan(serializeSettlementPlan(plan))).toEqual(plan);expect(()=>calculateFunding(plan,binding)).toThrow();
 });
 it('内部HTML/XLSX逐段含利率来源，总公式不误用期初率；公开白名单不含利率资料',()=>{
  const{plan,project,binding}=fixture();plan.funding!.rate_events![0]!.reference='<script>PRIVATE_RATE_993</script>';
  const raw=JSON.stringify({plan,project}),html=createProjectReport(project,undefined,undefined,plan),xlsx=bookText(createInternalWorkbook(project,undefined,undefined,plan));
  expect(html).toContain('data-funding-rates');expect(html).toContain('&lt;script&gt;PRIVATE_RATE_993');expect(html).toContain('年利率9%');expect(html).toContain('2340000 ÷ 100 ÷ 360');expect(xlsx).toContain('利率审计');expect(xlsx).toContain('期初年利率');expect(xlsx).toContain('PRIVATE_RATE_993');expect(xlsx).not.toContain('<f>');
  expect(renderFundingResult(plan,binding)).toContain('期初年利率 6%');const quote=projectCustomerQuote(project,emptyCustomerQuoteFields());Object.assign(quote,{funding:plan.funding,plan});expect(bookText(createCustomerWorkbook(quote))).not.toContain('PRIVATE_RATE');expect(JSON.stringify({plan,project})).toBe(raw);
 });
 it('坏业务输入不导出旧值或假定零；1.3文件可识别为付款计划',()=>{
  const{plan,project,binding}=fixture();plan.funding!.rate_events![0]!.annual_rate='';expect(renderFundingResult(plan,binding)).not.toContain('data-funding-result');expect(bookText(createInternalWorkbook(project,undefined,undefined,plan))).toContain('利率事件假设未完成');expect(parseSettlementPlan(serializeSettlementPlan(plan)).version).toBe('1.3');const report=inspectRecoveryText(JSON.stringify({kind:'INTERNAL_RECOVERY_SNAPSHOT',version:'1.0',stage:'RENDER',settlement_plan:plan}));expect(report.parts.find(p=>p.key==='settlement_plan')!.status).toBe('STRUCTURE_OK');expect(JSON.stringify(report)).not.toContain('PRIVATE_RATE');
 });
});

