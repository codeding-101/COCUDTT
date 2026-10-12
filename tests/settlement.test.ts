import { describe, expect, it } from 'vitest';
import { d } from '../src/domain/decimal';
import { newSettlementPlan, newBankFeeEntry, type SettlementPlan } from '../src/domain/settlement';
import { settlementBinding } from '../src/data/settlement-context';
import { parseSettlementPlan, serializeSettlementPlan } from '../src/data/settlement-file';
import { parseProject, serializeProject, toScenario, toTrade } from '../src/data/project-file';
import { calculateSettlement } from '../src/engine/settlement';
import { analyze } from '../src/engine/analyze';
import { scenarioWithDerivedInclusions } from '../src/engine/compare';
import { renderSettlementPanel } from '../src/ui/settlement';
import { createProjectReport } from '../src/ui/project-report';
import { actualQuotesProject, confirmOverride, confirmQuote } from './fixtures/actual-quotes';
import { makeCostItem } from './helpers/factory';

function fixture() {
  const project = actualQuotesProject(); project.incoterm = 'FOB';
  project.items.push(makeCostItem({cost_id:'bank',cost_name:'内部银行账单',amount:'30',fx_type:'CONTRACT'}));
  project.term_scenarios!.FOB!.responsibility_overrides!.bank={responsibility:'BUYER',reason:'合成银行合同：买方承担并支付'};
  confirmOverride(project,'FOB','bank'); confirmQuote(project,'FOB');
  const binding=settlementBinding(project),plan=newSettlementPlan(binding); plan.method='TT';plan.bank_status='NO_FEES';
  plan.payments=[{id:'p1',basis:'PERCENT',value:'30',date:'2026-09-01',trigger:'合成合同预付款'}, {id:'p2',basis:'PERCENT',value:'70',date:'2026-10-01',trigger:'合成合同尾款'}];
  const analysis=analyze({trade:toTrade(project),scenario:scenarioWithDerivedInclusions(toScenario(project),toTrade(project)),taxProfile:project.tax_profile,fxBooks:project.fx_books});
  return {project,binding,plan,analysis};
}
describe('独立付款计划的确定性金额与概念边界',()=>{
  it.each(['TT','LC','OA'] as const)('%s不会推定付款日、风险、保证收款或改变原测算',method=>{
    const {plan,binding,project,analysis}=fixture();plan.method=method;
    const before=JSON.stringify({project,plan,analysis}),result=calculateSettlement(plan,binding,analysis);
    expect(result.events.map(e=>[e.date,e.amount])).toEqual([['2026-09-01','3000'],['2026-10-01','7000']]);
    expect(result.totals).toEqual([{currency:'CNY',buyer_outflow:'10000',seller_inflow:'10000',seller_outflow:'0',seller_net:'10000',bank_fees:'0'}]);
    expect(JSON.stringify({project,plan,analysis})).toBe(before);expect(d(1).div(3).toString().length).toBeLessThan(45);
  });
  it('百分比和原币金额可混合，不把差額自动补作尾款',()=>{
    const {plan,binding,analysis}=fixture();plan.payments[1]!.basis='AMOUNT';plan.payments[1]!.value='7000';
    expect(calculateSettlement(plan,binding,analysis).difference).toBe('0');plan.payments[1]!.value='6999.99';
    expect(()=>calculateSettlement(plan,binding,analysis)).toThrow('差额-0.01');
  });
  it('保留小数精度，分配不猜最小货币单位或银行舍入',()=>{
    const {plan,binding,analysis}=fixture();plan.binding.amount=binding.amount='0.01';
    const r=calculateSettlement(plan,binding,analysis);expect(r.events.map(e=>e.amount)).toEqual(['0.003','0.007']);expect(r.allocated).toBe('0.01');
  });
  it('0.1加0.2精确对账，高精度合同原文保存不量化',()=>{
    const {plan,binding,analysis}=fixture();plan.binding.amount=binding.amount='0.3000000000000000000000000001';
    plan.payments[0]!.basis='AMOUNT';plan.payments[0]!.value='0.1';plan.payments[1]!.basis='AMOUNT';plan.payments[1]!.value='0.2000000000000000000000000001';
    expect(calculateSettlement(plan,binding,analysis).allocated).toBe(binding.amount);expect(parseSettlementPlan(serializeSettlementPlan(plan)).binding.amount).toBe(binding.amount);
  });
  it('同日与乱序输入按日期确定排序，不声明日内先后',()=>{
    const {plan,binding,analysis}=fixture();plan.payments.reverse();expect(calculateSettlement(plan,binding,analysis).events[0]!.id).toBe('p1');
  });
  it.each(['project_name','goods_name','quantity','unit','incoterm','named_place','amount','currency'] as const)('改变绑定%s后退出结果，原输入保留',key=>{
    const {plan,binding,analysis}=fixture(),before=JSON.stringify(plan);binding[key]+='changed';
    expect(()=>calculateSettlement(plan,binding,analysis)).toThrow('重新绑定');expect(JSON.stringify(plan)).toBe(before);
  });
  it.each(['','NaN','Infinity','1e3','1,000','-1','0','9'.repeat(81),'0.'+'0'.repeat(40)+'1'])('非法或超出精度的分期输入%s明确拒绝',value=>{
    const {plan,binding,analysis}=fixture();plan.payments[0]!.value=value;expect(()=>calculateSettlement(plan,binding,analysis)).toThrow();
  });
  it.each(['','2026-02-30','2026-13-01','2026-9-1'])('未知或非法日期%s不猜测',date=>{
    const {plan,binding,analysis}=fixture();plan.payments[0]!.date=date;expect(()=>calculateSettlement(plan,binding,analysis)).toThrow('日期');
  });
  it('比例超100、空条件、缺期数和未确认方式不计算',()=>{
    const {plan,binding,analysis}=fixture();plan.payments[0]!.value='101';expect(()=>calculateSettlement(plan,binding,analysis)).toThrow('100%');
    plan.payments[0]!.value='30';plan.payments[0]!.trigger='';expect(()=>calculateSettlement(plan,binding,analysis)).toThrow('触发');
    plan.payments=[];expect(()=>calculateSettlement(plan,binding,analysis)).toThrow('至少');
    plan.method='UNCONFIRMED';expect(()=>calculateSettlement(plan,binding,analysis)).toThrow('请选择');
  });
});
describe('银行费现金流不重复计入经营成本',()=>{
  function withFees(){const f=fixture();f.plan.bank_status='LISTED';f.plan.bank_fees=[{...newBankFeeEntry('b1'),cost_id:'bank',bearer:'BUYER',payer:'BUYER',date:'2026-09-02',reference:'合成收费凭证'}];return f;}
  it('关联已有费用只形成一次计划付款，经营测算和原对象保持',()=>{
    const {plan,binding,analysis}=withFees(),before=JSON.stringify(analysis);const result=calculateSettlement(plan,binding,analysis);
    expect(result.totals[0]!.buyer_outflow).toBe('10030');expect(result.events.filter(e=>e.kind==='BANK_FEE')).toHaveLength(1);expect(JSON.stringify(analysis)).toBe(before);
  });
  it('不同币种分别显示，不加总、不推定结算汇率，收付净额不是利润',()=>{
    const {plan,binding,analysis,project}=withFees();plan.bank_fees.push({...newBankFeeEntry('b2'),source:'EXTRA',amount:'50',currency:'USD',bearer:'SELLER',payer:'SELLER',not_in_project:true,date:'2026-10-01',reference:'合成新增费用'});
    const r=calculateSettlement(plan,binding,analysis);expect(r.totals.find(t=>t.currency==='USD')).toEqual({currency:'USD',buyer_outflow:'0',seller_inflow:'0',seller_outflow:'50',seller_net:'-50',bank_fees:'50'});
    expect(r.totals.find(t=>t.currency==='CNY')!.buyer_outflow).toBe('10030');expect(renderSettlementPanel(project,plan,analysis,false)).toContain('收付净额不是利润');
  });
  it('银行费用空清单未知不按0，无费用与已列清单冲突不删除输入',()=>{
    const {plan,binding,analysis}=withFees();plan.bank_status='NO_FEES';expect(()=>calculateSettlement(plan,binding,analysis)).toThrow('冲突');
    plan.bank_status='UNCONFIRMED';expect(()=>calculateSettlement(plan,binding,analysis)).toThrow('尚未核对');plan.bank_status='LISTED';plan.bank_fees=[];expect(()=>calculateSettlement(plan,binding,analysis)).toThrow('冲突');
  });
  it('重复关联、错承担方、未确认付款方与代付明确退出',()=>{
    const {plan,binding,analysis}=withFees();plan.bank_fees.push({...plan.bank_fees[0]!,id:'b2'});expect(()=>calculateSettlement(plan,binding,analysis)).toThrow('重复关联');plan.bank_fees.pop();
    plan.bank_fees[0]!.bearer=plan.bank_fees[0]!.payer='SELLER';expect(()=>calculateSettlement(plan,binding,analysis)).toThrow('未计入');
    plan.bank_fees[0]!.bearer='BUYER';expect(()=>calculateSettlement(plan,binding,analysis)).toThrow('代付');plan.bank_fees[0]!.payer='UNCONFIRMED';expect(()=>calculateSettlement(plan,binding,analysis)).toThrow('待确认');
  });
  it('已有付款/承担标记冲突、错方案、去重或缺分析不推造费用',()=>{
    const {plan,binding,analysis}=withFees(),bank=analysis.items.find(i=>i.item.cost_id==='bank')!;
    bank.item.payment_party='SELLER';expect(()=>calculateSettlement(plan,binding,analysis)).toThrow('冲突');delete bank.item.payment_party;
    bank.counts_to_buyer=false;expect(()=>calculateSettlement(plan,binding,analysis)).toThrow('已去重');bank.counts_to_buyer=true;
    analysis.incoterm='CIF';expect(()=>calculateSettlement(plan,binding,analysis)).toThrow('不属于');expect(()=>calculateSettlement(plan,binding,null)).toThrow('关联项');
  });
  it('新增费用须明确确认未重复录入，已有ID不可同时作为新增',()=>{
    const {plan,binding,analysis}=withFees();const fee=plan.bank_fees[0]!;fee.source='EXTRA';fee.amount='0';fee.currency='CNY';
    expect(()=>calculateSettlement(plan,binding,analysis)).toThrow('新增银行费用');fee.not_in_project=true;expect(()=>calculateSettlement(plan,binding,analysis)).toThrow('不能同时关联');
    fee.cost_id='';expect(calculateSettlement(plan,binding,analysis).totals[0]!.bank_fees).toBe('0');
    fee.currency='usd';expect(()=>calculateSettlement(plan,binding,analysis)).toThrow('币种');
  });
  it('本术语合同覆盖的付款方不能被原费用对象或现金计划忽略',()=>{
    const {plan,binding,analysis,project}=withFees();const overrides=project.term_scenarios!.FOB!.responsibility_overrides!;overrides.bank!.payment_party='SELLER';
    expect(()=>calculateSettlement(plan,binding,analysis,overrides)).toThrow('合同覆盖');expect(renderSettlementPanel(project,plan,analysis,false)).toContain('合同覆盖');
  });
});
describe('内部计划文件、报告与客户边界',()=>{
  it('未完成输入可往返，未知扩展保留，项目文件0.8不包含独立计划',()=>{
    const {project,binding}=fixture(),plan=newSettlementPlan(binding);Object.assign(plan,{future:{private:'内部扩展😀'}});
    expect(serializeSettlementPlan(parseSettlementPlan(serializeSettlementPlan(plan)))).toBe(serializeSettlementPlan(plan));
    expect(()=>parseProject(serializeSettlementPlan(plan))).toThrow('schema_version');expect(serializeProject(project)).not.toContain('INTERNAL_SETTLEMENT_PLAN');
  });
  it.each(['null','[]','{}','bad',JSON.stringify({kind:'INTERNAL_SETTLEMENT_PLAN',version:'2.0'})])('坏结构/未来版本不受支持：%s',text=>expect(()=>parseSettlementPlan(text)).toThrow());
  it('坏字段、重复行ID、超过100笔与数值类型非法不静默清洗',()=>{
    const {plan}=fixture();const bad=structuredClone(plan) as unknown as Record<string,unknown>;bad.payments=[{...plan.payments[0],value:30}];expect(()=>parseSettlementPlan(JSON.stringify(bad))).toThrow('文本');
    plan.payments[1]!.id=plan.payments[0]!.id;expect(()=>serializeSettlementPlan(plan)).toThrow('重复');plan.payments=Array.from({length:101},(_,i)=>({...plan.payments[0]!,id:String(i)}));expect(()=>serializeSettlementPlan(plan)).toThrow('100行');
  });
  it('模拟不能绑定，缺实际报价不回退',()=>{
    const {project}=fixture();project.anchor={kind:'FIXED_QUOTE'};expect(()=>settlementBinding(project)).toThrow('模拟');project.anchor={kind:'ACTUAL_QUOTES'};delete project.term_scenarios!.FOB!.quote;expect(()=>settlementBinding(project)).toThrow('缺少');
  });
  it('内部报告带快照和转义，未完成或旧绑定保留错误而非旧合计',()=>{
    const {project,plan}=fixture();plan.notes='<script>PRIVATE_PAYMENT_726</script>';
    const report=createProjectReport(project,'2026-09-10',undefined,plan);expect(report).toContain('付款计划快照');expect(report).toContain('&lt;script&gt;PRIVATE_PAYMENT_726');expect(report).not.toContain('<script>');
    plan.binding.amount='1';const bad=createProjectReport(project,'2026-09-10',undefined,plan);expect(bad).toContain('重新绑定');expect(bad).not.toContain('data-settlement-result');
  });
});
