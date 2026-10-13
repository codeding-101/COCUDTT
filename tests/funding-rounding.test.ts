import {describe,expect,it} from 'vitest';
import {enableFundingLedger,enableFundingRates,enableFundingRounding,newSettlementPlan} from '../src/domain/settlement';
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
function fixture(){
 const project=actualQuotesProject();project.incoterm='FOB';const binding=settlementBinding(project),plan=enableFundingRounding(enableFundingRates(enableFundingLedger(newSettlementPlan(binding))));
 plan.method='TT';plan.bank_status='NO_FEES';plan.payments=[{id:'pay',basis:'PERCENT',value:'100',date:'2026-09-04',trigger:'synthetic'}];
 Object.assign(plan.funding!,{status:'PROVIDED',kind:'FINANCING',party:'SELLER',principal:'6',currency:'USD',start_date:'2026-09-01',end_date:'2026-09-04',annual_rate:'36',day_basis:'ACT_360',reference:'PRIVATE_ROUNDING_PRINCIPAL',events:[],rate_events:[{id:'r1',date:'2026-09-02',annual_rate:'36',reference:'synthetic reset'},{id:'r2',date:'2026-09-03',annual_rate:'36',reference:'synthetic reset'}]});
 Object.assign(plan.funding!.rounding!,{status:'APPLIED',scope:'TOTAL',mode:'HALF_UP',unit:'0.01',reference:'PRIVATE_ROUNDING_1014'});
 return{project,binding,plan};
}
const bookText=(bytes:Uint8Array)=>Object.values(unzipSync(bytes)).map(v=>strFromU8(v)).join('\n');
describe('明确金额步长、方式、层级的精确舍入',()=>{
 it('独立手算每段0.006；合计0.018→0.02，逐段0.01×3=0.03；原值及现金不变',()=>{
  const{plan,binding}=fixture(),before=JSON.stringify(plan),cash=calculateSettlement(plan,binding,null),r=calculateFunding(plan,binding)!;
  expect(r.cost).toBe('0.018');expect(r.rounding).toMatchObject({rounded_cost:'0.02',total_rounded:'0.02',interval_rounded:'0.03',scope_difference:'0.01',unrounded_fraction:'9 / 500',adjustment:'0.002',adjustment_fraction:'1 / 500'});expect(r.rounding!.intervals.map(s=>[s.unrounded_cost,s.rounded_cost])).toEqual([['0.006','0.01'],['0.006','0.01'],['0.006','0.01']]);expect(calculateSettlement(plan,binding,null)).toEqual(cash);expect(JSON.stringify(plan)).toBe(before);
  plan.funding!.rounding!.scope='INTERVALS';expect(()=>calculateFunding(plan,binding)).toThrow('舍入边界');plan.funding!.rounding!.intervals_confirmed=true;expect(calculateFunding(plan,binding)).toMatchObject({cost:'0.018',rounding:{rounded_cost:'0.03',adjustment:'0.012'}});
 });
 it.each([['3','HALF_UP','0.01'],['3','HALF_EVEN','0.00'],['3','DOWN','0.00'],['9','HALF_UP','0.02'],['9','HALF_EVEN','0.02'],['15','HALF_UP','0.03'],['15','HALF_EVEN','0.02']])('恰半本金%s方式%s得到%s，不使用JS浮点', (principal,mode,expected)=>{
  const{plan,binding}=fixture();Object.assign(plan.funding!,{principal,annual_rate:'60',end_date:'2026-09-02',rate_events:[]});Object.assign(plan.funding!.rounding!,{mode});expect(calculateFunding(plan,binding)!.rounding!.rounded_cost).toBe(expected);
 });
 it('恰半上下一个微小十进制分别舍入，不预先截短再判断',()=>{
  const{plan,binding}=fixture();Object.assign(plan.funding!,{annual_rate:'100',end_date:'2026-09-02',rate_events:[]});
  plan.funding!.principal='1.7999999999999999999999999999999999999999';expect(calculateFunding(plan,binding)!.rounding!.rounded_cost).toBe('0.00');plan.funding!.principal='1.8000000000000000000000000000000000000001';expect(calculateFunding(plan,binding)!.rounding!.rounded_cost).toBe('0.01');
 });
 it('非十进制幂步长0.05可用，取偶按步长个数；不按币种推定两位',()=>{
  const{plan,binding}=fixture();Object.assign(plan.funding!,{principal:'75',annual_rate:'60',end_date:'2026-09-02',rate_events:[]});Object.assign(plan.funding!.rounding!,{unit:'0.0500',mode:'HALF_EVEN'});expect(calculateFunding(plan,binding)!.rounding).toMatchObject({unit:'0.05',rounded_cost:'0.10'});plan.funding!.rounding!.mode='HALF_UP';expect(calculateFunding(plan,binding)!.rounding!.rounded_cost).toBe('0.15');plan.funding!.rounding!.unit='1';expect(calculateFunding(plan,binding)!.rounding!.rounded_cost).toBe('0');plan.funding!.rounding!.unit='0.001';expect(calculateFunding(plan,binding)!.rounding!.rounded_cost).toBe('0.125');
 });
 it('向零截断有负的层级差额，循环小数保留精确分数审计',()=>{
  const{plan,binding}=fixture();plan.funding!.rounding!.mode='DOWN';expect(calculateFunding(plan,binding)!.rounding).toMatchObject({total_rounded:'0.01',interval_rounded:'0.00',scope_difference:'-0.01',adjustment:'-0.008'});
  Object.assign(plan.funding!,{principal:'1',annual_rate:'60',end_date:'2026-09-02',rate_events:[]});plan.funding!.rounding!.mode='HALF_UP';const r=calculateFunding(plan,binding)!;expect(r.rounding).toMatchObject({rounded_cost:'0.00',unrounded_fraction:'1 / 600',adjustment_fraction:'-1 / 600'});expect(r.rounding!.adjustment).toMatch(/^-0\.00166666666/);
 });
 it('零利率/零天数/零余额不制造负零或虚假区间；截止事件不增加舍入段',()=>{
  const{plan,binding}=fixture();Object.assign(plan.funding!,{annual_rate:'0',rate_events:[]});expect(calculateFunding(plan,binding)!.rounding!.rounded_cost).toBe('0.00');plan.funding!.end_date=plan.funding!.start_date;expect(calculateFunding(plan,binding)!.rounding!.intervals).toEqual([]);
  Object.assign(plan.funding!,{annual_rate:'36',principal:'0',end_date:'2026-09-04',events:[{id:'end',date:'2026-09-04',direction:'INCREASE',amount:'100',currency:'USD',reference:'end'}]});const r=calculateFunding(plan,binding)!;expect(r.rounding).toMatchObject({rounded_cost:'0.00',adjustment_fraction:'0 / 1'});expect(r.rounding!.intervals).toHaveLength(1);expect(r.ledger!.closing_principal).toBe('100');
 });
 it('恒定本金/固定率复用原算法，只生成一个舍入区间；更小步长和高精度不转Number',()=>{
  const{plan,binding}=fixture();Object.assign(plan.funding!,{balance_model:'CONSTANT',rate_model:'CONSTANT',principal:'12345678901234567890.125',annual_rate:'36000',end_date:'2026-09-02'});plan.funding!.rounding!.unit='0.01';expect(calculateFunding(plan,binding)!.rounding!.rounded_cost).toBe('12345678901234567890.13');expect(calculateFunding(plan,binding)!.rounding!.intervals).toHaveLength(1);
  Object.assign(plan.funding!,{principal:'0.00000000000000000001',annual_rate:'36000'});plan.funding!.rounding!.unit='0.0000000000000000000001';expect(calculateFunding(plan,binding)!.rounding!.rounded_cost).toBe('0.0000000000000000000100');
 });
 it('独立安全整数余数逐日核对96组合成账本，两种层级三种方式',()=>{
  let seed=73;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed;};
  const round=(n:number,mode:string)=>{const q=Math.floor(n/360),rem=n%360;return q+(mode!=='DOWN'&&(rem>180||rem===180&&(mode==='HALF_UP'||q%2===1))?1:0);};
  const cents=(n:number)=>`${Math.floor(n/100)}.${String(n%100).padStart(2,'0')}`;
  for(let c=0;c<96;c++){
   const{plan,binding}=fixture();let balance=random()%1000,rate=1+random()%20,dailyTotal=0,intervalWeight=0;const weights:number[]=[];
   Object.assign(plan.funding!,{principal:String(balance),annual_rate:String(rate),end_date:'2026-09-08',events:[],rate_events:[]});
   for(let day=1;day<=7;day++){
    const date=`2026-09-${String(day).padStart(2,'0')}`,change=day>1&&random()%3===0;
    if(change){weights.push(intervalWeight);intervalWeight=0;const amount=1+random()%100;balance+=amount;plan.funding!.events!.push({id:'p'+day,date,direction:'INCREASE',amount:String(amount),currency:'USD',reference:'oracle'});rate=1+random()%20;plan.funding!.rate_events!.push({id:'r'+day,date,annual_rate:String(rate),reference:'oracle'});}
    dailyTotal+=balance*rate;intervalWeight+=balance*rate;
   }
   weights.push(intervalWeight);
   for(const mode of['HALF_UP','HALF_EVEN','DOWN']as const){Object.assign(plan.funding!.rounding!,{mode,intervals_confirmed:true});for(const scope of['TOTAL','INTERVALS']as const){plan.funding!.rounding!.scope=scope;const r=calculateFunding(plan,binding)!;expect(r.rounding!.total_rounded).toBe(cents(round(dailyTotal,mode)));expect(r.rounding!.interval_rounded).toBe(cents(weights.reduce((s,w)=>s+round(w,mode),0)));expect(r.rounding!.rounded_cost).toBe(scope==='TOTAL'?r.rounding!.total_rounded:r.rounding!.interval_rounded);}}
  }
 });
 it.each(['','0','-0.01','1e-2','1,000','1/3','NaN','9'.repeat(81),'0.'+'0'.repeat(40)+'1'])('无效金额步长%s不猜测',unit=>{const{plan,binding}=fixture();plan.funding!.rounding!.unit=unit;expect(()=>calculateFunding(plan,binding)).toThrow('金额步长');});
 it('不应用保留未完成业务字段；待确认、缺方式或依据不假定已舍入',()=>{
  const{plan,binding}=fixture();const f=plan.funding!.rounding!;f.unit='';f.status='NOT_APPLIED';expect(calculateFunding(plan,binding)!.rounding).toBeUndefined();f.status='APPLIED';f.unit='0.01';f.reference=' ';expect(()=>calculateFunding(plan,binding)).toThrow('依据');f.reference='valid';f.mode='UNCONFIRMED';expect(()=>calculateFunding(plan,binding)).toThrow('明确');f.status='UNCONFIRMED';expect(()=>calculateFunding(plan,binding)).toThrow('未知');plan.funding!.status='NOT_MODELED';expect(calculateFunding(plan,binding)).toBeNull();
 });
 it('报价变更继续阻断，舍入不能绕过本金/利率原校验',()=>{
  const{plan,binding}=fixture();plan.funding!.rate_events![0]!.reference='';expect(()=>calculateFunding(plan,binding)).toThrow('新利率依据');plan.funding!.rate_events![0]!.reference='valid';binding.amount='0';expect(()=>calculateFunding(plan,binding)).toThrow('重新绑定');
 });
});
describe('1.4旧文件保护与审计隔离',()=>{
 it('显式升级完整保留输入和扩展，原对象不改，舍入不填默认事实',()=>{
  const{plan,binding}=fixture(),old=enableFundingRates(enableFundingLedger(newSettlementPlan(binding)));old.funding!.status='PROVIDED';Object.assign(old,{extension:{keep:'😀'}});const raw=JSON.stringify(old),next=enableFundingRounding(old);expect(JSON.stringify(old)).toBe(raw);expect(next).toMatchObject({version:'1.4',funding:{status:'UNCONFIRMED',rounding:{status:'UNCONFIRMED',scope:'UNCONFIRMED',mode:'UNCONFIRMED',unit:'',reference:'',intervals_confirmed:false}}});expect(next.payments).toEqual(old.payments);expect(parseSettlementPlan(serializeSettlementPlan(plan))).toEqual(plan);expect(()=>enableFundingRounding(newSettlementPlan(binding))).toThrow('1.3');
 });
 it('旧1.3重名扩展原文往返，不解释或覆盖；旧版计算结果保持',()=>{
  const{plan,binding}=fixture();plan.version='1.3';Object.assign(plan.funding!,{rounding:'PRIVATE_LEGACY_ROUNDING'});expect(parseSettlementPlan(serializeSettlementPlan(plan))).toEqual(plan);expect(calculateFunding(plan,binding)).toMatchObject({cost:'0.018'});expect(calculateFunding(plan,binding)!.rounding).toBeUndefined();expect(()=>enableFundingRounding(plan)).toThrow('重名');expect(renderFundingFields(plan)).not.toContain('data-settlement-row="funding-rounding"');
 });
 it.each(['missing','numeric-unit','bad-status','bad-scope','bad-mode','numeric-reference','not-boolean','future'])('坏结构%s即使不应用也拒绝',kind=>{
  const{plan}=fixture(),raw=JSON.parse(serializeSettlementPlan(plan));raw.funding.status='NOT_MODELED';if(kind==='missing')delete raw.funding.rounding;if(kind==='numeric-unit')raw.funding.rounding.unit=0.01;if(kind==='bad-status')raw.funding.rounding.status='AUTO';if(kind==='bad-scope')raw.funding.rounding.scope='DAILY';if(kind==='bad-mode')raw.funding.rounding.mode='AUTO';if(kind==='numeric-reference')raw.funding.rounding.reference=5;if(kind==='not-boolean')raw.funding.rounding.intervals_confirmed='true';if(kind==='future')raw.version='1.5';expect(()=>parseSettlementPlan(JSON.stringify(raw))).toThrow();
 });
 it('内部HTML/XLSX分开保留原值/舍入值/精确分数及来源，公开白名单不读取',()=>{
  const{plan,project,binding}=fixture();plan.funding!.rounding!.reference='<script>PRIVATE_ROUNDING_1014</script>';const raw=JSON.stringify({plan,project}),html=createProjectReport(project,undefined,undefined,plan),xlsx=bookText(createInternalWorkbook(project,undefined,undefined,plan));expect(html).toContain('data-funding-rounding');expect(html).toContain('舍入假设金额：0.02 USD');expect(html).toContain('&lt;script&gt;PRIVATE_ROUNDING');expect(html).toContain('9 / 500');expect(xlsx).toContain('逐区间减合计差额');expect(xlsx).toContain('原始单利精确分数');expect(xlsx).not.toContain('<f>');const quote=projectCustomerQuote(project,emptyCustomerQuoteFields());Object.assign(quote,{plan,rounding:plan.funding!.rounding});expect(bookText(createCustomerWorkbook(quote))).not.toContain('PRIVATE_ROUNDING');expect(JSON.stringify({plan,project})).toBe(raw);expect(renderFundingResult(plan,binding)).toContain('0.018 USD');
 });
 it('未完成文件仍可保存，内部导出记录原因；恢复只读检查识别1.4结构',()=>{
  const{plan,project,binding}=fixture();plan.funding!.rounding!.unit='';expect(parseSettlementPlan(serializeSettlementPlan(plan))).toEqual(plan);expect(renderFundingResult(plan,binding)).not.toContain('data-funding-result');expect(bookText(createInternalWorkbook(project,undefined,undefined,plan))).toContain('金额舍入假设未完成');const report=inspectRecoveryText(JSON.stringify({kind:'INTERNAL_RECOVERY_SNAPSHOT',version:'1.0',stage:'RENDER',settlement_plan:plan}));expect(report.parts.find(p=>p.key==='settlement_plan')!.status).toBe('STRUCTURE_OK');expect(JSON.stringify(report)).not.toContain('PRIVATE_ROUNDING');
 });
});
