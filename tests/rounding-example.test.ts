import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createRoundingExample,roundingExampleRecord,ROUNDING_EXAMPLE_FILES} from '../src/data/rounding-example';
import {roundingExampleResource,renderRoundingExamplePanel} from '../src/ui/rounding-example';
import {fundingExampleResource} from '../src/ui/funding-example';
import {parseProject,serializeProject} from '../src/data/project-file';
import {parseSettlementPlan,serializeSettlementPlan} from '../src/data/settlement-file';
import {settlementBinding} from '../src/data/settlement-context';
import {calculateFunding} from '../src/engine/funding';
import {calculateSettlement} from '../src/engine/settlement';
import {createProjectReport} from '../src/ui/project-report';
import {createInternalWorkbook,createCustomerWorkbook} from '../src/ui/workbook-export';
import {emptyCustomerQuoteFields} from '../src/domain/customer-quote';
import {projectCustomerQuote} from '../src/ui/customer-quote';
import {unzipSync,strFromU8} from 'fflate';
const bookText=(bytes:Uint8Array)=>Object.values(unzipSync(bytes)).map(v=>strFromU8(v)).join('\n');
describe('舍入配套合成资源与独立预期',()=>{
 afterEach(()=>vi.unstubAllGlobals());
 it.each(['project','plan','record','guide'])('%s运行时导出与提交文件一致、可确定性复建',kind=>{
  const r=roundingExampleResource(kind);expect(r.name).toBe(ROUNDING_EXAMPLE_FILES[kind as keyof typeof ROUNDING_EXAMPLE_FILES]);expect(r.text).toBe(readFileSync(new URL('../templates/'+r.name,import.meta.url),'utf8'));expect(roundingExampleResource(kind)).toEqual(r);
 });
 it('生产工厂不读取浏览器/草稿，不共享可变业务对象或独立预期',()=>{
  vi.stubGlobal('localStorage',{getItem(){throw Error('must not read draft')}});vi.stubGlobal('window',new Proxy({},{get(){throw Error('must not read browser context')}}));
  const first=createRoundingExample(),before=JSON.stringify(first);first.project.name='PRIVATE_CHANGED';first.plan.funding!.rounding!.unit='100';expect(JSON.stringify(createRoundingExample())).toBe(before);
  const r=roundingExampleRecord();r.expected.rounded_cost='99999';r.expected.comparisons[0]!.total='99999';expect(roundingExampleRecord().expected.rounded_cost).toBe('0.02');expect(roundingExampleRecord().expected.comparisons[0]!.total).toBe('0.02');
 });
 it('项目0.8/付款1.4独立往返、绑定正确，不借测试夹具或引擎生成预期',()=>{
  const project=parseProject(roundingExampleResource('project').text),plan=parseSettlementPlan(roundingExampleResource('plan').text);expect(project.schema_version).toBe('0.8');expect(plan.version).toBe('1.4');expect(plan.binding).toEqual(settlementBinding(project));expect(serializeProject(project)).toBe(roundingExampleResource('project').text);expect(serializeSettlementPlan(plan)).toBe(roundingExampleResource('plan').text);expect(plan.funding!.principal).not.toBe(plan.binding.amount);
  const source=readFileSync(new URL('../src/data/rounding-example.ts',import.meta.url),'utf8');expect(source).not.toMatch(/calculateFunding|\/engine\/|tests\/fixtures|Date\.(?:now|parse)/);
 });
 it('独立手算3×0.006=9/500、两层级三方式以及正负差额与引擎对照',()=>{
  const{project,plan}=createRoundingExample(),binding=settlementBinding(project),record=roundingExampleRecord(),before=calculateSettlement(plan,binding,null);
  expect(6n*36n*3n*500n).toBe(9n*100n*360n);expect(record.expected.segments.reduce((s,r)=>s+Number(r.cost)*1000,0)).toBe(18);
  const r=calculateFunding(plan,binding)!;expect(r).toMatchObject({cost:'0.018',days:3,rounding:{rounded_cost:'0.02',unrounded_fraction:'9 / 500',adjustment:'0.002',adjustment_fraction:'1 / 500'}});expect(r.rounding!.intervals.map(s=>[s.start_date,s.end_date,s.unrounded_cost])).toEqual(record.expected.segments.map(s=>[s.start_date,s.end_date,s.cost]));
  for(const c of record.expected.comparisons){plan.funding!.rounding!.mode=c.mode as 'HALF_UP'|'HALF_EVEN'|'DOWN';let result=calculateFunding(plan,binding)!;expect(result.rounding).toMatchObject({total_rounded:c.total,interval_rounded:c.interval_sum,scope_difference:c.interval_minus_total});plan.funding!.rounding!.scope='INTERVALS';plan.funding!.rounding!.intervals_confirmed=true;result=calculateFunding(plan,binding)!;expect(result.rounding!.rounded_cost).toBe(c.interval_sum);expect(result.cost).toBe('0.018');plan.funding!.rounding!.scope='TOTAL';}
  expect(calculateSettlement(plan,binding,null)).toEqual(before);
 });
 it('默认不确认逐段边界，切换INTERVALS不能自动把计算区间当银行结息',()=>{
  const{project,plan}=createRoundingExample();expect(plan.funding!.rounding!.intervals_confirmed).toBe(false);plan.funding!.rounding!.scope='INTERVALS';expect(()=>calculateFunding(plan,settlementBinding(project))).toThrow('舍入边界');plan.funding!.rounding!.intervals_confirmed=true;expect(calculateFunding(plan,settlementBinding(project))!.rounding!.rounded_cost).toBe('0.03');
 });
 it('改输入使固定预期失效，原手算答案不会随引擎或状态自动更新',()=>{
  const{project,plan}=createRoundingExample();plan.funding!.principal='60';expect(calculateFunding(plan,settlementBinding(project))!.cost).not.toBe(roundingExampleRecord().expected.cost);expect(calculateFunding(plan,settlementBinding(project))!.rounding!.rounded_cost).not.toBe(roundingExampleRecord().expected.rounded_cost);expect(roundingExampleRecord().expected.cost).toBe('0.018');
 });
 it('来源仍EXAMPLE、仅CIF报价，合成计划就绪不授予真实业务核对',()=>{
  const{project,plan}=createRoundingExample();expect(Object.keys(project.term_scenarios!)).toEqual(['CIF']);expect(project.term_scenarios!.CIF!.quote_evidence!.status).toBe('EXAMPLE');expect(project.tax_profile.import.rateEvidence!.status).toBe('EXAMPLE');expect(JSON.stringify({project,plan})).not.toContain('USER_CONFIRMED');expect(plan.notes).toContain('不证明银行结息日');expect(calculateSettlement(plan,settlementBinding(project),null).allocated).toBe('108300');
 });
 it.each(['record','guide'])('%s不能导入为项目或付款文件',kind=>{const text=roundingExampleResource(kind).text;expect(()=>parseProject(text)).toThrow();expect(()=>parseSettlementPlan(text)).toThrow();});
 it.each(['','constructor','__proto__','../private','future'])('未知资源%s不回退为其他案例',kind=>expect(()=>roundingExampleResource(kind)).toThrow('请选择目录'));
 it('离线说明无脚本/远程资源，完整给出边界确认、原值/舍入、保存及公开边界',()=>{
  const html=roundingExampleResource('guide').text;expect(html).not.toMatch(/<script|https?:\/\/|<iframe|src=/i);for(const text of ['先分别保存','不要用重新绑定掩盖','逐区间比较0.03','重新选择','未确认该边界','0.005','恰半取偶数个步长','修改Excel单元格不会重跑引擎','修改例题后','客户文件'])expect(html).toContain(text);expect(renderRoundingExamplePanel(true)).toContain('data-rounding-kind="guide" disabled');expect(renderRoundingExamplePanel()).not.toContain('data-example-kind');
 });
 it('原四资源不改名或改变50预期，两个案例互不串用',()=>{
  for(const kind of ['project','plan','record','guide']){const old=fundingExampleResource(kind);expect(old.text).toBe(readFileSync(new URL('../templates/'+old.name,import.meta.url),'utf8'));expect(old.name).not.toBe(roundingExampleResource(kind).name);}
  const{plan,project}=createRoundingExample();expect(()=>calculateFunding(parseSettlementPlan(fundingExampleResource('plan').text),settlementBinding(project))).toThrow('重新绑定');expect(()=>calculateFunding(plan,settlementBinding(parseProject(fundingExampleResource('project').text)))).toThrow('重新绑定');
 });
 it('内部HTML/XLSX保留精确审计及合成依据；客户字段投影不读取计划',()=>{
  const{project,plan}=createRoundingExample();plan.funding!.rounding!.reference='PRIVATE_ROUNDING_EXAMPLE_142';const raw=JSON.stringify({project,plan}),html=createProjectReport(project,undefined,undefined,plan),internal=bookText(createInternalWorkbook(project,undefined,undefined,plan));expect(html).toContain('data-funding-rounding');expect(html).toContain('0.02 USD');expect(internal).toContain('9 / 500');expect(internal).toContain('PRIVATE_ROUNDING_EXAMPLE_142');expect(internal).not.toContain('<f>');const quote=projectCustomerQuote(project,emptyCustomerQuoteFields());Object.assign(quote,{plan});expect(bookText(createCustomerWorkbook(quote))).not.toContain('PRIVATE_ROUNDING');expect(JSON.stringify({project,plan})).toBe(raw);
 });
});
