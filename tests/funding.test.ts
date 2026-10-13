import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { newSettlementPlan } from '../src/domain/settlement';
import { calculateFunding } from '../src/engine/funding';
import { calculateSettlement } from '../src/engine/settlement';
import { settlementBinding } from '../src/data/settlement-context';
import { serializeSettlementPlan, parseSettlementPlan } from '../src/data/settlement-file';
import { createInternalWorkbook, createCustomerWorkbook, internalWorkbookSnapshot } from '../src/ui/workbook-export';
import { customerWorkbook, internalWorkbook } from '../src/data/workbook-snapshot';
import { projectCustomerQuote } from '../src/ui/customer-quote';
import { emptyCustomerQuoteFields } from '../src/domain/customer-quote';
import { renderFundingResult } from '../src/ui/funding';
import { renderSettlementPanel } from '../src/ui/settlement';
import { createProjectReport } from '../src/ui/project-report';
import { actualQuotesProject } from './fixtures/actual-quotes';

function fixture() {
  const project = actualQuotesProject(); project.incoterm = 'FOB';
  const binding = settlementBinding(project), plan = newSettlementPlan(binding);
  plan.method = 'TT'; plan.bank_status = 'NO_FEES';
  plan.payments = [{id:'p1',basis:'PERCENT',value:'100',date:'2026-10-01',trigger:'合成合同，仅测试'}];
  Object.assign(plan.funding!,{status:'PROVIDED',kind:'FINANCING',party:'SELLER',principal:'12000',currency:'USD',start_date:'2026-09-01',end_date:'2026-10-01',annual_rate:'6',day_basis:'ACT_360',reference:'PRIVATE_FUNDING_736：合成本金及计息条件，不是真实报价'});
  return { project, binding, plan };
}
const xlsxText = (bytes: Uint8Array) => Object.values(unzipSync(bytes)).map(data => strFromU8(data)).join('\n');

describe('显式恒定本金单利，独立于贸易与计划收付',()=>{
  it('实际30天/360：12000×6%×30/360=60，本金不是额外费用',()=>{
    const {plan,binding}=fixture();const result=calculateFunding(plan,binding)!;
    expect(result).toMatchObject({days:30,denominator:360,cost:'60',currency:'USD',party:'SELLER',kind:'FINANCING'});
    expect(result.formula).toBe('12000 × 6 ÷ 100 × 30 ÷ 360');
  });
  it.each(['FINANCING','OPPORTUNITY'] as const)('%s只改变成本性质，不生成实际银行付款或改变利润',kind=>{
    const {plan,binding,project}=fixture();plan.funding!.kind=kind;
    const before=JSON.stringify({plan,project}),cash=calculateSettlement(plan,binding,null);
    expect(calculateFunding(plan,binding)!.kind).toBe(kind);expect(calculateSettlement(plan,binding,null)).toEqual(cash);
    expect(cash.totals).toHaveLength(1);expect(cash.totals[0]!.currency).toBe('CNY');expect(cash.totals[0]!.seller_net).toBe('10000');
    expect(JSON.stringify({plan,project})).toBe(before);
  });
  it.each([
    ['2024-02-28','2024-03-01',2],['2023-02-28','2023-03-01',1],['2100-02-28','2100-03-01',1],
    ['2000-02-28','2000-03-01',2],['2026-12-31','2027-01-01',1],['2026-03-07','2026-03-09',2],
    ['2026-10-01','2026-10-01',0],['2024-01-01','2025-01-01',366],
  ])('%s至%s实际%d天，算头不算尾，不按每月30天或时区', (start,end,days)=>{
    const {plan,binding}=fixture();plan.funding!.start_date=start;plan.funding!.end_date=end;
    expect(calculateFunding(plan,binding)!.days).toBe(days);
  });
  it('ACT/365 Fixed在闰年固定除365，区别于Actual/Actual',()=>{
    const {plan,binding}=fixture();Object.assign(plan.funding!,{principal:'36500',annual_rate:'10',start_date:'2024-01-01',end_date:'2025-01-01',day_basis:'ACT_365F'});
    expect(calculateFunding(plan,binding)).toMatchObject({days:366,denominator:365,cost:'3660'});
  });
  it('缺付款日或方式不补造，独立资金假设仍可计算，付款结果继续退出',()=>{
    const {plan,binding}=fixture();plan.method='UNCONFIRMED';plan.payments[0]!.date='';
    expect(calculateFunding(plan,binding)!.cost).toBe('60');expect(()=>calculateSettlement(plan,binding,null)).toThrow('请选择');
  });
  it('明确零利率及同日零天有效，空白本金/利率不当零',()=>{
    const {plan,binding}=fixture();plan.funding!.annual_rate='0';expect(calculateFunding(plan,binding)!.cost).toBe('0');
    plan.funding!.annual_rate='';expect(()=>calculateFunding(plan,binding)).toThrow('年利率');
    plan.funding!.annual_rate='6';plan.funding!.end_date=plan.funding!.start_date;expect(calculateFunding(plan,binding)!.cost).toBe('0');
    plan.funding!.principal='';expect(()=>calculateFunding(plan,binding)).toThrow('本金');
  });
  it.each(['','0','-1','1e4','1,000','NaN','Infinity','9'.repeat(81),'0.'+'0'.repeat(40)+'1'])('无效本金%s退出',value=>{
    const {plan,binding}=fixture();plan.funding!.principal=value;expect(()=>calculateFunding(plan,binding)).toThrow();
  });
  it.each(['-1','1e2','NaN','0.'+'0'.repeat(40)+'1'])('负数/异常/超精度利率%s不计算',value=>{
    const {plan,binding}=fixture();plan.funding!.annual_rate=value;expect(()=>calculateFunding(plan,binding)).toThrow();
  });
  it.each(['start_date','end_date'] as const)('%s缺失或无效不猜测，倒序退出不取绝对值',key=>{
    const {plan,binding}=fixture();plan.funding![key]='2026-02-30';expect(()=>calculateFunding(plan,binding)).toThrow('日期');
    plan.funding![key]='';expect(()=>calculateFunding(plan,binding)).toThrow('日期');
    plan.funding!.start_date='2026-10-02';plan.funding!.end_date='2026-10-01';expect(()=>calculateFunding(plan,binding)).toThrow('早于');
  });
  it('利率类型、测算方、年基数、来源和币种必须明确，不按TT/币种默认',()=>{
    const {plan,binding}=fixture();for(const key of ['kind','party','day_basis'] as const){const old=plan.funding![key];plan.funding![key]='UNCONFIRMED';expect(()=>calculateFunding(plan,binding)).toThrow();(plan.funding as unknown as Record<string,string>)[key]=old;}
    plan.funding!.currency='usd';expect(()=>calculateFunding(plan,binding)).toThrow('币种');plan.funding!.currency='USD';plan.funding!.reference=' ';expect(()=>calculateFunding(plan,binding)).toThrow('依据');
  });
  it('明确不测算保留输入但不出成本，未知状态不能当0',()=>{
    const {plan,binding}=fixture();plan.funding!.status='NOT_MODELED';plan.funding!.annual_rate='invalid';const before=JSON.stringify(plan);
    expect(calculateFunding(plan,binding)).toBeNull();expect(renderFundingResult(plan,binding)).toContain('不表示成本为零');expect(JSON.stringify(plan)).toBe(before);
    plan.funding!.status='UNCONFIRMED';expect(()=>calculateFunding(plan,binding)).toThrow('空白当零');
  });
  it('报价绑定变更也阻断资金假设，不能展示旧成本',()=>{
    const {plan,binding}=fixture();binding.amount='12000';expect(()=>calculateFunding(plan,binding)).toThrow('重新绑定');expect(renderFundingResult(plan,binding)).not.toContain('data-funding-result');
  });
  it('重复小数除法明确保留精度而非银行金额舍入',()=>{
    const {plan,binding}=fixture();Object.assign(plan.funding!,{principal:'0.01',annual_rate:'6',day_basis:'ACT_365F'});
    const result=calculateFunding(plan,binding)!;expect(result.cost).toMatch(/^0\.0000493150684931506849/);expect(result.cost.length).toBeGreaterThan(200);
  });
});

describe('计划格式1.1与内部快照的安全边界',()=>{
  it('新草稿1.1不填本金日期利率，原文及未知扩展可往返',()=>{
    const {binding}=fixture(),plan=newSettlementPlan(binding);expect(plan.version).toBe('1.1');expect(plan.funding!.annual_rate).toBe('');
    Object.assign(plan,{extra:{private:'未知😀'}});expect(parseSettlementPlan(serializeSettlementPlan(plan))).toEqual(plan);
  });
  it('旧1.0保持原格式，不静默赋予资金占用语义',()=>{
    const {plan,project,binding}=fixture();plan.version='1.0';delete plan.funding;const raw=serializeSettlementPlan(plan);
    expect(serializeSettlementPlan(parseSettlementPlan(raw))).toBe(raw);expect(()=>calculateFunding(plan,binding)).toThrow('尚未设置');
    expect(renderSettlementPanel(project,plan,null,false)).toContain('升级为1.1');
  });
  it('旧扩展与新字段重名须人工核对，未来版本、缺结构和数值类型不静默清洗',()=>{
    const {plan}=fixture();const bad=structuredClone(plan) as unknown as Record<string,unknown>;bad.version='1.0';expect(()=>parseSettlementPlan(JSON.stringify(bad))).toThrow('新语义冲突');
    bad.version='1.6';expect(()=>parseSettlementPlan(JSON.stringify(bad))).toThrow('不是受支持');bad.version='1.1';bad.funding={};expect(()=>parseSettlementPlan(JSON.stringify(bad))).toThrow('文本');
    bad.funding={...plan.funding,annual_rate:6};expect(()=>parseSettlementPlan(JSON.stringify(bad))).toThrow('文本');delete bad.funding;expect(()=>parseSettlementPlan(JSON.stringify(bad))).toThrow('对象');
  });
  it('内部Excel保留原6张表，付款/假设追加，所有数据是生成时脱离引用的快照',()=>{
    const {plan,project}=fixture(),before=JSON.stringify({plan,project});
    const snapshot=internalWorkbookSnapshot(project,'2026-10-13T00:00:00Z',undefined,plan);
    expect(snapshot.sheets.slice(0,6)).toEqual(internalWorkbook(project,'2026-10-13T00:00:00Z').sheets);expect(snapshot.sheets.slice(6).map(s=>s.name)).toEqual(['付款计划','资金占用假设']);
    const raw=JSON.stringify(snapshot);expect(raw).toContain('PRIVATE_FUNDING_736');expect(raw).toContain('12000 × 6');expect(JSON.stringify({plan,project})).toBe(before);
    plan.funding!.principal='99999';plan.notes='AFTER_CHANGE';expect(JSON.stringify(snapshot)).toBe(raw);
  });
  it('未完成付款及资金假设分别记录原因，不出旧合计或零成本，原始输入保留',()=>{
    const {plan,project}=fixture();plan.funding!.annual_rate='';plan.payments[0]!.value='99';
    const text=xlsxText(createInternalWorkbook(project,undefined,undefined,plan));expect(text).toContain('不一致');expect(text).toContain('年利率');expect(text).toContain('PRIVATE_FUNDING_736');expect(text).not.toContain('12000 × 6');
  });
  it('绑定过期分别阻断两张表结果，但完整原始计划仍进入内部工作表',()=>{
    const {plan,project}=fixture();project.term_scenarios!.FOB!.quote!.amount='12000';const text=xlsxText(createInternalWorkbook(project,undefined,undefined,plan));
    expect(text.match(/绑定报价或交易范围/g)).toHaveLength(2);expect(text).toContain('PRIVATE_FUNDING_736');expect(text).not.toContain('12000 × 6');
  });
  it('旧1.0内部Excel明确未设置，独立假设不会填零',()=>{
    const {plan,project}=fixture();plan.version='1.0';delete plan.funding;const text=xlsxText(createInternalWorkbook(project,undefined,undefined,plan));expect(text).toContain('尚未设置');expect(text).toContain('1.0未提供');
  });
  it('内部Excel高精度结果保留文本、银行金额可为数值，公式样文本不执行',()=>{
    const {plan,project}=fixture();plan.funding!.reference='=HYPERLINK("https://example.invalid","PRIVATE")';plan.funding!.day_basis='ACT_365F';
    const parts=unzipSync(createInternalWorkbook(project,undefined,undefined,plan));const funding=strFromU8(parts['xl/worksheets/sheet8.xml']!);
    expect(funding).toContain('12000 × 6');expect(funding).toContain('inlineStr');expect(funding).not.toContain('<f>');expect(strFromU8(parts['xl/worksheets/sheet7.xml']!)).toContain('<v>10000</v>');
  });
  it('内部HTML可查公式且转义，客户Excel不出现计划、融资输入或扩展',()=>{
    const {plan,project}=fixture();plan.funding!.reference='<script>PRIVATE_FUNDING_736</script>';
    const report=createProjectReport(project,undefined,undefined,plan);expect(report).toContain('12000 × 6');expect(report).toContain('&lt;script&gt;PRIVATE_FUNDING_736');
    const quote=projectCustomerQuote(project,emptyCustomerQuoteFields());Object.assign(quote,{funding:plan.funding,plan});
    expect(customerWorkbook(quote).sheets).toHaveLength(1);const text=xlsxText(createCustomerWorkbook(quote));expect(text).not.toContain('PRIVATE_FUNDING_736');expect(text).not.toContain('INTERNAL_SETTLEMENT_PLAN');expect(text).not.toContain('资金占用假设');
  });
});
