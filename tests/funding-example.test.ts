import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createFundingExample,fundingExampleRecord,FUNDING_EXAMPLE_FILES} from '../src/data/funding-example';
import {fundingExampleResource,renderFundingExamplePanel} from '../src/ui/funding-example';
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
describe('配套合成案例，可读文件与独立手算记录',()=>{
 afterEach(()=>vi.unstubAllGlobals());
 it.each(['project','plan','record','guide'])('%s资源可复建、独立且与提交文件一致',kind=>{
  const result=fundingExampleResource(kind);expect(result.name).toBe(FUNDING_EXAMPLE_FILES[kind as keyof typeof FUNDING_EXAMPLE_FILES]);expect(result.text).toBe(readFileSync(new URL('../templates/'+result.name,import.meta.url),'utf8'));expect(fundingExampleResource(kind)).toEqual(result);
 });
 it('工厂不读取草稿或浏览器上下文，不共享任何可变业务对象',()=>{
  vi.stubGlobal('localStorage',{getItem(){throw Error('must not read private draft')}});vi.stubGlobal('window',new Proxy({},{get(){throw Error('must not read browser context')}}));
  const first=createFundingExample(),before=JSON.stringify(first);first.project.goods.name='PRIVATE_CHANGE';first.plan.funding!.events![0]!.reference='PRIVATE_CHANGE';expect(JSON.stringify(createFundingExample())).toBe(before);
  const record=fundingExampleRecord();record.expected.cost='90000';record.files.plan='CHANGED' as typeof record.files.plan;expect(fundingExampleRecord().expected.cost).toBe('50');expect(fundingExampleRecord().files.plan).toBe(FUNDING_EXAMPLE_FILES.plan);
 });
 it('项目0.8和付款1.2独立往返并正确绑定，不借用测试夹具或用户资料',()=>{
  const project=parseProject(fundingExampleResource('project').text),plan=parseSettlementPlan(fundingExampleResource('plan').text);
  expect(project.schema_version).toBe('0.8');expect(plan.version).toBe('1.2');expect(plan.binding).toEqual(settlementBinding(project));expect(serializeProject(project)).toBe(fundingExampleResource('project').text);expect(serializeSettlementPlan(plan)).toBe(fundingExampleResource('plan').text);expect(plan.funding!.principal).not.toBe(plan.binding.amount);
 });
 it('手算预期来自固定独立值，区间本金×天数及分数合计可人工对照',()=>{
  const{project,plan}=createFundingExample(),record=fundingExampleRecord(),result=calculateFunding(plan,settlementBinding(project))!;
  expect(result).toMatchObject({cost:record.expected.cost,currency:'USD',days:30,ledger:{closing_principal:'10000',principal_days:'300000'}});
  expect(result.ledger!.segments.map(s=>[s.start_date,s.end_date,s.principal,s.days,s.principal_days])).toEqual(record.expected.segments.map(s=>[s.start_date,s.end_date,s.principal,s.days,s.principal_days]));
  const exposure=record.expected.segments.reduce((total,s)=>total+BigInt(s.principal)*BigInt(s.days),0n);expect(exposure).toBe(300000n);expect(60n+40n+50n).toBe(BigInt(record.expected.cost)*3n);
  plan.funding!.events![0]!.amount='3000';expect(calculateFunding(plan,settlementBinding(project))!.cost).not.toBe(record.expected.cost);expect(fundingExampleRecord().expected.cost).toBe('50');
 });
 it('只提供CIF合成报价、来源示例及日期，不自动授予业务确认或完整排名',()=>{
  const{project,plan}=createFundingExample();expect(Object.keys(project.term_scenarios!)).toEqual(['CIF']);expect(project.term_scenarios!.CIF!.quote_evidence!.status).toBe('EXAMPLE');expect(project.tax_profile.import.rateEvidence!.status).toBe('EXAMPLE');expect(JSON.stringify({project,plan})).not.toContain('USER_CONFIRMED');expect(project.name).toContain('非真实交易');
  expect(calculateSettlement(plan,settlementBinding(project),null).allocated).toBe('108300');expect(calculateFunding(plan,settlementBinding(project))!.cost).toBe('50');
 });
 it.each(['record','guide'])('%s不是项目/付款文件，不能被导入或静默解释',kind=>{const text=fundingExampleResource(kind).text;expect(()=>parseProject(text)).toThrow();expect(()=>parseSettlementPlan(text)).toThrow();});
 it.each(['','constructor','__proto__','../private','future'])('未知资源%s不作为默认案例导出',kind=>expect(()=>fundingExampleResource(kind)).toThrow('请选择目录'));
 it('说明页纯离线且无脚本，明确两种JSON、内部快照、客户白名单和绑定错误的处理',()=>{
  const text=fundingExampleResource('guide').text;expect(text).not.toMatch(/<script|https?:\/\/|<iframe|src=/i);expect(text).toContain('不直接点击重新绑定来掩盖错误');expect(text).toContain('先分别保存当前项目');expect(text).toContain('编辑Excel单元格不会重跑引擎');expect(text).toContain('40/3');expect(text).toContain('近似值标≈');
  expect(renderFundingExamplePanel(true)).toContain('data-example-kind="guide" disabled');
 });
 it('内部HTML/Excel可复查事件与总公式，客户文件不带内部本金依据',()=>{
  const{project,plan}=createFundingExample();plan.funding!.reference='PRIVATE_INTERNAL_EXAMPLE_736';const raw=JSON.stringify({project,plan});const html=createProjectReport(project,'2026-10-13T00:00:00Z',undefined,plan),internal=bookText(createInternalWorkbook(project,undefined,undefined,plan));expect(html).toContain('data-funding-ledger');expect(internal).toContain('300000 × 6');expect(internal).toContain('PRIVATE_INTERNAL_EXAMPLE_736');expect(internal).toContain('事件审计');
  const customer=bookText(createCustomerWorkbook(projectCustomerQuote(project,emptyCustomerQuoteFields())));expect(customer).not.toContain('PRIVATE_INTERNAL_EXAMPLE_736');expect(customer).not.toContain('synthetic-decrease');expect(JSON.stringify({project,plan})).toBe(raw);
 });
});
