import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {unzipSync,strFromU8} from 'fflate';
import {createRoundingExample} from '../src/data/rounding-example.js';
import {settlementBinding} from '../src/data/settlement-context.js';
import {parseSettlementPlan,serializeSettlementPlan} from '../src/data/settlement-file.js';
import {enableFundingPeriods,newSettlementPlan} from '../src/domain/settlement.js';
import {calculateFunding} from '../src/engine/funding.js';
import {calculateSettlement} from '../src/engine/settlement.js';
import {renderFundingFields,renderFundingResult} from '../src/ui/funding.js';
import {createProjectReport} from '../src/ui/project-report.js';
import {createCustomerWorkbook,createInternalWorkbook} from '../src/ui/workbook-export.js';
import {projectCustomerQuote,createCustomerQuoteDocument} from '../src/ui/customer-quote.js';
import {emptyCustomerQuoteFields} from '../src/domain/customer-quote.js';
import {inspectRecoveryText} from '../src/data/recovery-review.js';
const text=(data:Uint8Array)=>Object.values(unzipSync(data)).map(bytes=>strFromU8(bytes)).join('\n');
function fixture(){const{project,plan:old}=createRoundingExample(),plan=enableFundingPeriods(old);plan.funding!.status='PROVIDED';Object.assign(plan.funding!.rounding!,{status:'APPLIED',scope:'PERIODS'});Object.assign(plan.funding!.period_schedule!,{status:'PROVIDED',reference:'PRIVATE_PERIOD_SCHEDULE_1015',periods_confirmed:true,periods:[{id:'period-a',start_date:'2026-09-01',end_date:'2026-09-04',reference:'PRIVATE_PERIOD_REFERENCE_1015'}]});return{project,old,plan,binding:settlementBinding(project)};}
interface Case{ id:string;expected?:{raw_fraction:string;period_fractions:string[];period_rounded:string[];rounded_total:string};input:{funding:{principal:string;annual_rate:string;start_date:string;end_date:string;denominator:number;kind:string;party:string;currency:string;principal_events:Record<string,string>[];rate_events:Record<string,string>[]};schedule:unknown;rounding:{scope:string;mode:string;unit:string;reference:string}}}
const cases=(JSON.parse(readFileSync(new URL('../docs/cases/funding-period-design.json',import.meta.url),'utf8')) as {cases:Case[]}).cases;
describe('1.5显式接入及内部审计',()=>{
 it.each(cases.filter(c=>c.expected))('完整文件/计算手算 $id',c=>{
   const{plan,binding}=fixture(),f=c.input.funding;Object.assign(plan.funding!,{principal:f.principal,annual_rate:f.annual_rate,start_date:f.start_date,end_date:f.end_date,day_basis:f.denominator===360?'ACT_360':'ACT_365F',kind:f.kind,party:f.party,currency:f.currency,events:f.principal_events.map((e,i)=>({...e,id:'p'+i})),rate_events:f.rate_events.map((e,i)=>({...e,id:'r'+i})),period_schedule:c.input.schedule});Object.assign(plan.funding!.rounding!,c.input.rounding);
   const copy=parseSettlementPlan(serializeSettlementPlan(plan)),r=calculateFunding(copy,binding)!;expect(r.periods!.unrounded_fraction.replaceAll(' ','')).toBe(c.expected!.raw_fraction);expect(r.periods!.periods.map(p=>p.unrounded_fraction.replaceAll(' ',''))).toEqual(c.expected!.period_fractions);expect(r.periods!.periods.map(p=>p.rounded_cost)).toEqual(c.expected!.period_rounded);expect(r.periods!.rounded_cost).toBe(c.expected!.rounded_total);expect(r.rounding).toBeUndefined();
 });
 it('升级只克隆并撤销确认，保留旧输入/扩展，新建仍1.1，不能跨版本启用',()=>{
   const{old,binding}=fixture();Object.assign(old,{private_extension:{keep:'😀'}});const before=JSON.stringify(old),p=enableFundingPeriods(old);expect(JSON.stringify(old)).toBe(before);expect(p).toMatchObject({version:'1.5',private_extension:{keep:'😀'},funding:{status:'UNCONFIRMED',rounding:{status:'UNCONFIRMED',intervals_confirmed:false},period_schedule:{status:'UNCONFIRMED',reference:'',periods_confirmed:false,periods:[]}}});expect(p.payments).toEqual(old.payments);expect(newSettlementPlan(binding).version).toBe('1.1');const wrong=structuredClone(old);wrong.version='1.3';expect(()=>enableFundingPeriods(wrong)).toThrow('1.4');
 });
 it('旧1.4同名未知扩展往返且不激活，升级拒绝覆盖',()=>{
   const{old,binding}=fixture();Object.assign(old.funding!,{period_schedule:'PRIVATE_LEGACY_PERIODS'});const saved=serializeSettlementPlan(old),parsed=parseSettlementPlan(saved);expect(serializeSettlementPlan(parsed)).toBe(saved);expect(calculateFunding(parsed,binding)!.periods).toBeUndefined();expect(calculateFunding(parsed,binding)!.rounding!.rounded_cost).toBe('0.02');expect(()=>enableFundingPeriods(parsed)).toThrow('重名');expect(renderFundingFields(parsed)).not.toContain('PRIVATE_LEGACY_PERIODS');
 });
 it('同一1.5计划的TOTAL/INTERVALS沿旧语义，确认彼此独立，不应用/不测算保留输入',()=>{
   const{plan,binding}=fixture(),r=plan.funding!.rounding!,s=plan.funding!.period_schedule!;s.periods_confirmed=false;r.scope='TOTAL';expect(calculateFunding(plan,binding)!.rounding!.rounded_cost).toBe('0.02');r.scope='INTERVALS';r.intervals_confirmed=true;expect(calculateFunding(plan,binding)!.rounding!.rounded_cost).toBe('0.03');r.scope='PERIODS';expect(()=>calculateFunding(plan,binding)).toThrow('独立确认');s.periods_confirmed=true;expect(calculateFunding(plan,binding)!.periods!.rounded_cost).toBe('0.02');r.status='NOT_APPLIED';s.status='UNCONFIRMED';s.reference='';s.periods_confirmed=false;expect(calculateFunding(plan,binding)).toMatchObject({cost:'0.018'});expect(calculateFunding(plan,binding)!.periods).toBeUndefined();plan.funding!.status='NOT_MODELED';expect(calculateFunding(plan,binding)).toBeNull();expect(parseSettlementPlan(serializeSettlementPlan(plan))).toEqual(plan);
 });
 it('收付、原始单利和期间切点分开，不改变原分段/余额或付款',()=>{
   const{plan,old,binding}=fixture(),cash=calculateSettlement(old,binding,null),r=calculateFunding(plan,binding)!;expect(calculateSettlement(plan,binding,null)).toEqual(cash);expect(r.cost).toBe('0.018');expect(r.ledger!.segments).toHaveLength(3);expect(r.ledger!.closing_principal).toBe('6');plan.funding!.period_schedule!.periods=[{id:'a',start_date:'2026-09-01',end_date:'2026-09-02',reference:'a'},{id:'b',start_date:'2026-09-02',end_date:'2026-09-04',reference:'b'}];expect(calculateFunding(plan,binding)!.periods!.rounded_cost).toBe('0.02');expect(calculateSettlement(plan,binding,null)).toEqual(cash);
 });
 it.each(['missing-schedule','numeric-reference','bad-status','string-confirmation','bad-period-date-type','missing-rounding','old-scope','future'])('坏新文件%s即使不测算也拒绝',kind=>{
   const{plan}=fixture(),raw=JSON.parse(serializeSettlementPlan(plan));raw.funding.status='NOT_MODELED';if(kind==='missing-schedule')delete raw.funding.period_schedule;if(kind==='numeric-reference')raw.funding.period_schedule.reference=1;if(kind==='bad-status')raw.funding.period_schedule.status='AUTO';if(kind==='string-confirmation')raw.funding.period_schedule.periods_confirmed='true';if(kind==='bad-period-date-type')raw.funding.period_schedule.periods[0].start_date=1;if(kind==='missing-rounding')delete raw.funding.rounding;if(kind==='old-scope')raw.version='1.4';if(kind==='future')raw.version='1.6';expect(()=>parseSettlementPlan(JSON.stringify(raw))).toThrow();
 });
 it('内部HTML/XLSX含完整交集/依据/分数和原始输入，客户导出无内部字段，输入不改',()=>{
   const{plan,project}=fixture();plan.funding!.period_schedule!.reference='<script>PRIVATE_PERIOD_EXPORT</script>';plan.funding!.period_schedule!.periods[0]!.reference='=PRIVATE_FORMULA_PERIOD';const before=JSON.stringify({plan,project}),html=createProjectReport(project,undefined,undefined,plan),xlsx=text(createInternalWorkbook(project,undefined,undefined,plan));expect(html).toContain('data-funding-periods');expect(html).toContain('期间舍入假设金额：0.02 USD');expect(html).toContain('&lt;script&gt;PRIVATE_PERIOD_EXPORT');expect(html).toContain('9 / 500');expect(xlsx).toContain('原段交集');expect(xlsx).toContain('期间舍入假设金额');expect(xlsx).toContain('=PRIVATE_FORMULA_PERIOD');expect(xlsx).not.toContain('<f>');const quote=projectCustomerQuote(project,emptyCustomerQuoteFields());Object.assign(quote,{plan,period_schedule:plan.funding!.period_schedule});expect(text(createCustomerWorkbook(quote))+createCustomerQuoteDocument(quote)).not.toContain('PRIVATE_PERIOD');expect(JSON.stringify({plan,project})).toBe(before);
 });
 it('未完成1.5仍可保存/内部存档，恢复检查支持新结构，错误不保留旧结果',()=>{
   const{plan,project,binding}=fixture();plan.funding!.period_schedule!.periods_confirmed=false;const saved=serializeSettlementPlan(plan);expect(parseSettlementPlan(saved)).toEqual(plan);expect(renderFundingResult(plan,binding)).not.toContain('data-funding-result');expect(text(createInternalWorkbook(project,undefined,undefined,plan))).toContain('独立确认');const report=inspectRecoveryText(JSON.stringify({kind:'INTERNAL_RECOVERY_SNAPSHOT',version:'1.0',stage:'RENDER',settlement_plan:plan}));expect(report.parts.find(p=>p.key==='settlement_plan')!.status).toBe('STRUCTURE_OK');expect(JSON.stringify(report)).not.toContain('PRIVATE_PERIOD');
 });
});
