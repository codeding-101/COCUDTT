import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {unzipSync,strFromU8} from 'fflate';
import {createPeriodExample,periodExampleRecord,PERIOD_EXAMPLE_FILES} from '../src/data/period-example';
import {periodExampleResource,renderPeriodExamplePanel} from '../src/ui/period-example';
import {fundingExampleResource} from '../src/ui/funding-example';
import {roundingExampleResource} from '../src/ui/rounding-example';
import {parseProject,serializeProject} from '../src/data/project-file';
import {parseSettlementPlan,serializeSettlementPlan} from '../src/data/settlement-file';
import {settlementBinding} from '../src/data/settlement-context';
import {calculateFunding} from '../src/engine/funding';
import {calculateSettlement} from '../src/engine/settlement';
import {createProjectReport} from '../src/ui/project-report';
import {createInternalWorkbook,createCustomerWorkbook} from '../src/ui/workbook-export';
import {emptyCustomerQuoteFields} from '../src/domain/customer-quote';
import {projectCustomerQuote,createCustomerQuoteDocument} from '../src/ui/customer-quote';
const bookText=(bytes:Uint8Array)=>Object.values(unzipSync(bytes)).map(v=>strFromU8(v)).join('\n');
const compact=(text:string)=>text.replaceAll(' ','');
describe('明确期间配套合成资源与固定手算',()=>{
 afterEach(()=>vi.unstubAllGlobals());
 it.each(['project','plan','record','guide'])('%s与提交资源一致且可确定性复建',kind=>{
  const r=periodExampleResource(kind);expect(r.name).toBe(PERIOD_EXAMPLE_FILES[kind as keyof typeof PERIOD_EXAMPLE_FILES]);expect(r.text).toBe(readFileSync(new URL('../templates/'+r.name,import.meta.url),'utf8'));expect(periodExampleResource(kind)).toEqual(r);
 });
 it('工厂不读浏览器/草稿，不共享对象；预期不借引擎或测试夹具',()=>{
  vi.stubGlobal('localStorage',{getItem(){throw Error('no draft')}});vi.stubGlobal('window',new Proxy({},{get(){throw Error('no browser')}}));
  const first=createPeriodExample(),before=JSON.stringify(first);first.project.name='PRIVATE_CHANGED';first.plan.funding!.period_schedule!.periods[0]!.reference='PRIVATE_CHANGED';expect(JSON.stringify(createPeriodExample())).toBe(before);
  const r=periodExampleRecord();r.expected.periods[0]!.rounded='999';expect(periodExampleRecord().expected.periods[0]!.rounded).toBe('0.02');
  expect(readFileSync(new URL('../src/data/period-example.ts',import.meta.url),'utf8')).not.toMatch(/calculateFunding|\/engine\/|tests\/fixtures|Date\.(?:now|parse)/);
 });
 it('项目0.8/付款1.5配对往返，保留例题确认但不授予业务来源确认',()=>{
  const project=parseProject(periodExampleResource('project').text),plan=parseSettlementPlan(periodExampleResource('plan').text);
  expect(project.schema_version).toBe('0.8');expect(plan.version).toBe('1.5');expect(plan.binding).toEqual(settlementBinding(project));expect(serializeProject(project)).toBe(periodExampleResource('project').text);expect(serializeSettlementPlan(plan)).toBe(periodExampleResource('plan').text);
  expect(plan.funding!.period_schedule!.periods_confirmed).toBe(true);expect(plan.funding!.rounding!.intervals_confirmed).toBe(false);expect(project.term_scenarios!.CIF!.quote_evidence!.status).toBe('EXAMPLE');expect(project.tax_profile.import.rateEvidence!.status).toBe('EXAMPLE');expect(JSON.stringify({project,plan})).not.toContain('USER_CONFIRMED');expect(plan.funding!.principal).not.toBe(plan.binding.amount);
 });
 it('独立整数口算、原三段与四片交集及正负调整精确对应',()=>{
  const{project,plan}=createPeriodExample(),record=periodExampleRecord().expected,r=calculateFunding(plan,settlementBinding(project))!,a=r.periods!;
  expect((6n*36n+12n*36n+12n*18n*2n)*100n).toBe(3n*100n*360n);
  expect(r.cost).toBe(record.cost);expect(r.days).toBe(4);expect(r.ledger!.closing_principal).toBe('12');expect(r.ledger!.segments).toHaveLength(3);expect(r.rounding).toBeUndefined();
  expect(a).toMatchObject({calculation_segment_count:3,rounded_cost:'0.03',total_rounded:'0.03',scope_difference:'0.00',adjustment:'0'});expect(compact(a.unrounded_fraction)).toBe(record.cost_exact);expect(compact(a.adjustment_fraction)).toBe(record.adjustment_exact);
  expect(a.periods.flatMap(p=>p.fragments)).toHaveLength(4);
  a.periods.forEach((p,i)=>{const expected=record.periods[i]!;expect([p.start_date,p.end_date,p.days,p.unrounded_cost,p.rounded_cost,p.adjustment]).toEqual([expected.start_date,expected.end_date,expected.days,expected.cost,expected.rounded,expected.adjustment]);expect(compact(p.unrounded_fraction)).toBe(expected.cost_exact);expect(compact(p.adjustment_fraction)).toBe(expected.adjustment_exact);expect(p.fragments.map(f=>f.segment_index+1)).toEqual(expected.source_segments);expect(p.fragments.map(f=>f.unrounded_cost)).toEqual(expected.fragment_costs);expect(p.fragments.map(f=>compact(f.unrounded_fraction))).toEqual(expected.fragment_fractions);});
  expect(a.periods[0]!.fragments[2]!.rate_reference).toContain('18%');expect(a.periods[1]!.fragments[0]!.principal_references.join('|')).toContain('增加6 USD');
 });
 it.each(periodExampleRecord().expected.comparisons)('$mode下合计/原段/两期/四个人为期间分别核对，原值和收付不变',c=>{
  const{project,plan}=createPeriodExample(),binding=settlementBinding(project),before=calculateSettlement(plan,binding,null),f=plan.funding!,r=f.rounding!,s=f.period_schedule!;
  r.mode=c.mode as 'HALF_UP'|'HALF_EVEN'|'DOWN';let result=calculateFunding(plan,binding)!;expect(result.periods!.rounded_cost).toBe(c.explicit_periods);expect(result.periods!.scope_difference).toBe(c.period_minus_total);
  r.scope='TOTAL';expect(calculateFunding(plan,binding)!.rounding!.rounded_cost).toBe(c.total);r.scope='INTERVALS';r.intervals_confirmed=true;expect(calculateFunding(plan,binding)!.rounding!.rounded_cost).toBe(c.calculation_intervals);
  r.scope='PERIODS';s.periods=[1,2,3,4].map(n=>({id:'daily-'+n,start_date:`2026-09-0${n}`,end_date:`2026-09-0${n+1}`,reference:'合成内部每日应计假设，不是银行结息事实'}));result=calculateFunding(plan,binding)!;expect(result.periods!.periods.map(p=>p.unrounded_cost)).toEqual(periodExampleRecord().expected.daily_costs);expect(result.periods!.rounded_cost).toBe(c.daily_periods);expect(result.periods!.scope_difference).toBe(c.daily_minus_total);expect(result.cost).toBe('0.03');expect(calculateSettlement(plan,binding,null)).toEqual(before);
 });
 it('期间确认与旧区间确认独立，覆盖缺口不能靠确认或补零通过',()=>{
  const{project,plan}=createPeriodExample(),binding=settlementBinding(project),s=plan.funding!.period_schedule!;s.periods_confirmed=false;plan.funding!.rounding!.intervals_confirmed=true;expect(()=>calculateFunding(plan,binding)).toThrow('独立确认');s.periods_confirmed=true;s.periods[0]!.end_date='2026-09-03';expect(()=>calculateFunding(plan,binding)).toThrow('覆盖');
 });
 it('修改输入后固定答案不更新',()=>{const{project,plan}=createPeriodExample();plan.funding!.annual_rate='72';expect(calculateFunding(plan,settlementBinding(project))!.cost).not.toBe(periodExampleRecord().expected.cost);expect(periodExampleRecord().expected.cost).toBe('0.03');});
 it.each(['record','guide'])('%s不能导入为项目或付款',kind=>{const text=periodExampleResource(kind).text;expect(()=>parseProject(text)).toThrow();expect(()=>parseSettlementPlan(text)).toThrow();});
 it.each(['','constructor','__proto__','../private','future'])('未知资源%s不回退其他案例',kind=>expect(()=>periodExampleResource(kind)).toThrow('请选择目录'));
 it('旧两组资源保持字节、配对隔离',()=>{
  const{project,plan}=createPeriodExample();for(const resource of [fundingExampleResource,roundingExampleResource])for(const kind of ['project','plan','record','guide']){const r=resource(kind);expect(r.text).toBe(readFileSync(new URL('../templates/'+r.name,import.meta.url),'utf8'));expect(r.name).not.toBe(periodExampleResource(kind).name);if(kind==='plan')expect(()=>calculateFunding(parseSettlementPlan(r.text),settlementBinding(project))).toThrow('重新绑定');if(kind==='project')expect(()=>calculateFunding(plan,settlementBinding(parseProject(r.text)))).toThrow('重新绑定');}
 });
 it('内部HTML/Excel审计和原始输入，客户白名单隔离且输入不变',()=>{
  const{project,plan}=createPeriodExample();plan.funding!.period_schedule!.reference='PRIVATE_PERIOD_EXAMPLE';plan.funding!.period_schedule!.periods[0]!.reference='=PRIVATE_FORMULA_PERIOD';const raw=JSON.stringify({project,plan}),html=createProjectReport(project,undefined,undefined,plan),internal=bookText(createInternalWorkbook(project,undefined,undefined,plan));expect(html).toContain('期间舍入假设金额：0.03 USD');expect(html).toContain('PRIVATE_PERIOD_EXAMPLE');expect(internal).toContain('3 / 125');expect(internal).toContain('=PRIVATE_FORMULA_PERIOD');expect(internal).not.toContain('<f>');const quote=projectCustomerQuote(project,emptyCustomerQuoteFields());Object.assign(quote,{plan});expect(bookText(createCustomerWorkbook(quote))+createCustomerQuoteDocument(quote)).not.toContain('PRIVATE_');expect(JSON.stringify({project,plan})).toBe(raw);
 });
 it('离线说明覆盖边界、再确认、保存及短尾期，不加载脚本或外部资源',()=>{
  const html=periodExampleResource('guide').text;expect(html).not.toMatch(/<script|https?:\/\/|<iframe|src=/i);for(const text of ['先分别保存','不要用重新绑定掩盖','四个一天归集期','固定手算记录不会更新','短尾期不能称已结息','旧逐区间确认不能代替','修改Excel单元格不会重跑引擎','不构成法律或专业贸易建议'])expect(html).toContain(text);expect(renderPeriodExamplePanel(true)).toContain('data-period-kind="guide" disabled');expect(renderPeriodExamplePanel()).not.toContain('data-rounding-kind');
 });
});
