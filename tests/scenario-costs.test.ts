import { describe, expect, it } from 'vitest';
import { chinaImportSampleProjectFile } from '../src/data/sample-project';
import { parseProject, serializeProject, toTrade, toScenario } from '../src/data/project-file';
import { INCOTERMS, type Incoterm } from '../src/domain/enums';
import { eligibilityValues } from '../src/domain/import-context';
import { evidenceKey, taxEvidenceValues } from '../src/domain/source-evidence';
import { analyze } from '../src/engine/analyze';
import { compare, scenarioWithDerivedInclusions } from '../src/engine/compare';
import { costsForTerm } from '../src/engine/scenario-costs';
import { createProjectReport } from '../src/ui/project-report';
import { renderOutputColumn } from '../src/ui/views-output';
import { makeCostItem } from './helpers/factory';

function project() {
  const p = chinaImportSampleProjectFile();
  p.goods.trade_value = { amount: '10000', currency: 'CNY' };
  p.goods.seller_goods_cost = { amount: '', currency: 'CNY' };
  p.quote = { amount: '10700', currency: 'CNY', fx_type: 'CONTRACT' };
  p.fx_books = [];
  p.items = [
    makeCostItem({ cost_id: 'seller-freight', cost_name: '卖方取得的运价', cost_category: 'MAIN_CARRIAGE', trade_node: 'MAIN_CARRIAGE', amount: '600', alternative_group: '国际主运输', applicable_incoterms: ['CFR','CIF','CPT','CIP','DAP','DPU','DDP'] }),
    makeCostItem({ cost_id: 'buyer-freight', cost_name: '买方取得的运价', cost_category: 'MAIN_CARRIAGE', trade_node: 'MAIN_CARRIAGE', amount: '1000', alternative_group: '国际主运输', applicable_incoterms: ['EXW','FCA','FAS','FOB'] }),
    makeCostItem({ cost_id: 'insurance', cost_name: '保险费', cost_category: 'INSURANCE', trade_node: 'MAIN_CARRIAGE', amount: '100' }),
  ];
  const rules = p.tax_profile.import;
  for(const [record, values] of [[rules.rateEvidence!,taxEvidenceValues(rules)], [rules.eligibility!.duty_evidence!,eligibilityValues('duty',p.route,p.goods.tax_key,rules)]] as const) {
    record.reference='合成测试核对'; record.checked_on='2026-10-11'; record.status='USER_CONFIRMED'; record.values_key=evidenceKey(values,record);
  }
  return p;
}
function input(p = project()) { return { trade: toTrade(p), template: toScenario(p), taxProfile:p.tax_profile, fxBooks:p.fx_books }; }
function run(p = project(), term: Incoterm = p.incoterm) {
  const i=input(p); const template={...i.template, incoterm:term, quote:{...i.template.quote,incoterm:term}};
  return analyze({...i,scenario:scenarioWithDerivedInclusions(template,i.trade)});
}

describe('按方案启用费用与替代运价',()=>{
  it('CIF只采用卖方运价，FOB只采用买方运价；两笔运价不相加，税额按实际运费改变',()=>{
    const p=project(); const before=JSON.stringify(p);
    const cif=run(p,'CIF'); const fob=run(p,'FOB');
    expect(cif.dutiable_value.value.toFixed(2)).toBe('10700.00');
    expect(cif.import_tax.duty.toFixed(2)).toBe('535.00');
    expect(cif.import_tax.vat.toFixed(2)).toBe('1460.55');
    expect(cif.buyer.landed_cost_with_tax.toFixed(2)).toBe('12695.55');
    expect(fob.dutiable_value.value.toFixed(2)).toBe('11100.00');
    expect(fob.import_tax.duty.toFixed(2)).toBe('555.00');
    expect(fob.import_tax.vat.toFixed(2)).toBe('1515.15');
    expect(fob.buyer.landed_cost_with_tax.toFixed(2)).toBe('13870.15');
    expect(cif.inactive_items.map(x=>x.cost_id)).toEqual(['buyer-freight']);
    expect(fob.inactive_items.map(x=>x.cost_id)).toEqual(['seller-freight']);
    expect(cif.seller.margin).toBeNull(); expect(JSON.stringify(p)).toBe(before);
  });
  it('已核对前提下买方独立排名；改变运价改变税额和成本，不能沿用固定税额解释',()=>{
    const p=project(); p.facts={delivery_place:'SELLER_PREMISES'}; const c=compare(input(p));
    expect(c.uses_scenario_costs).toBe(true);
    expect(c.columns.filter(x=>!x.feasible||!x.decision_ready).map(x=>({term:x.incoterm,issues:x.decision_issues}))).toEqual([]);
    expect(c.best_seller_margin).toBeNull(); expect(c.best_buyer_landed).not.toBeNull();
    expect(c.columns.find(x=>x.incoterm==='CIF')!.import_tax_total.toFixed(2)).toBe('1995.55');
    expect(c.columns.find(x=>x.incoterm==='FOB')!.import_tax_total.toFixed(2)).toBe('2070.15');
    p.items[0]!.amount='800'; expect(run(p).dutiable_value.value.toFixed(2)).toBe('10900.00');
    const html=renderOutputColumn({result:run(p),comparison:compare(input(p)),error:null});
    expect(html).toContain('运价差异会影响进口税费'); expect(html).not.toContain('各术语进口税费相同');
  });
  it('未启用项可留空或使用缺失汇率币种，不解析其金额与来源；只阻止启用它的比较列',()=>{
    const p=project(); p.items[1]!.amount=''; p.items[1]!.currency='GBP';
    expect(run(p).buyer.landed_cost_with_tax.toFixed(2)).toBe('12695.55');
    const c=compare(input(p)); expect(c.columns.find(x=>x.incoterm==='CIF')!.feasible).toBe(true);
    expect(c.columns.find(x=>x.incoterm==='FOB')!.feasible).toBe(false);
    expect(c.columns.find(x=>x.incoterm==='FOB')!.infeasible_reason).toMatch(/汇率|未填写/);
    expect(run(p).decision.sources.some(s=>s.label.includes('GBP'))).toBe(false);
  });
  it('替代报价适用范围重叠时阻断对应方案，保留没有冲突的其他列',()=>{
    const p=project(); p.items[1]!.applicable_incoterms!.push('CIF');
    expect(()=>run(p)).toThrow(/替代报价组.*同时启用/);
    const c=compare(input(p)); expect(c.columns.find(x=>x.incoterm==='CIF')!.feasible).toBe(false);
    expect(c.columns.find(x=>x.incoterm==='FOB')!.feasible).toBe(true);
    expect(renderOutputColumn({result:null,comparison:c,error:'替代报价冲突'})).toContain('11 术语横向对比');
  });
  it('默认所有术语保持原逻辑；明确空选表示不启用且暴露未启用费用',()=>{
    const p=project(); p.items[1]!.applicable_incoterms=[];
    const all=makeCostItem({cost_id:'other',amount:'20'}); p.items.push(all);
    expect(INCOTERMS.every(t=>costsForTerm(toTrade(p),t).trade.items.some(x=>x.cost_id==='other'))).toBe(true);
    const result=run(p); expect(result.inactive_items[0]!.cost_id).toBe('buyer-freight');
    expect(createProjectReport(p)).toContain('本方案未启用 1 项费用');
    expect(createProjectReport(p)).toContain('未解析金额，未计入税基与汇总');
  });
  it.each(['base','parent'])('启用项不能引用未启用的%s项，避免静默使用另一方案的金额或漏算',kind=>{
    const p=project(); const fee=makeCostItem({cost_id:'related',amount:'10'});
    if(kind==='base'){fee.pricing_method='PERCENT';fee.rate='0.1';fee.calculation_base={kind:'COST_ITEMS',ids:['buyer-freight']};}
    else fee.contained_in_cost_id='buyer-freight';
    p.items.push(fee); expect(()=>run(p)).toThrow(/引用了未启用费用/);
  });
  it('没有互斥组的运输分段可以同时启用，不将所有主运输项误认为替代报价',()=>{
    const p=project(); p.items.push(makeCostItem({cost_id:'segment',cost_category:'MAIN_CARRIAGE',trade_node:'MAIN_CARRIAGE',amount:'200'}));
    expect(run(p).dutiable_value.value.toFixed(2)).toBe('10900.00');
  });
  it('固定买方总支付逐方案反推报价，目标金额保持一致',()=>{
    const p=project(); const c=compare({...input(p),anchor:{kind:'FIXED_MARKET_PRICE',buyer_total:'13000',currency:'CNY'}});
    expect(c.columns.every(x=>x.feasible&&x.buyer.landed_cost_with_tax.toFixed(2)==='13000.00')).toBe(true);
    expect(c.columns.find(x=>x.incoterm==='CIF')!.quote_amount.toFixed(2)).toBe('11004.45');
    expect(c.columns.find(x=>x.incoterm==='FOB')!.quote_amount.toFixed(2)).toBe('9829.85');
  });
  it('已知采购成本的固定目标利润率仍按各方案费用求解',()=>{
    const p=project(); p.goods.seller_goods_cost.amount='8000';
    const c=compare({...input(p),anchor:{kind:'FIXED_MARGIN_RATE',margin_rate:'0.2'}});
    expect(c.columns.find(x=>x.incoterm==='CIF')!.quote_amount.toFixed(2)).toBe('10875.00');
    expect(c.columns.find(x=>x.incoterm==='FOB')!.quote_amount.toFixed(2)).toBe('10000.00');
  });
  it('0.6文件保存适用术语与替代组；0.5旧文件未设置时仍适用全部术语',()=>{
    const p=project(); const restored=parseProject(serializeProject(p));
    expect(restored.schema_version).toBe('0.8'); expect(restored.items).toEqual(p.items);
    const raw=JSON.parse(serializeProject(p));raw.schema_version='0.5';for(const item of raw.items){delete item.applicable_incoterms;delete item.alternative_group;}
    const old=parseProject(JSON.stringify(raw)); expect(costsForTerm(toTrade(old),'CIF').trade.items.length).toBe(3);
  });
  it.each([['INVALID'],['CIF','CIF'],null,'CIF'])('拒绝错误的适用术语结构 %j',terms=>{
    const raw=JSON.parse(serializeProject(project()));raw.items[0].applicable_incoterms=terms;
    expect(()=>parseProject(JSON.stringify(raw))).toThrow(/applicable_incoterms/);
  });
});
