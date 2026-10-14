import { describe, expect, it } from 'vitest';
import { INCOTERMS, availableIncoterms, type Incoterm, type TradeNode } from '../src/domain/enums';
import { incotermBasics } from '../src/domain/incoterm-basics';
import { analyze } from '../src/engine/analyze';
import { compare, scenarioWithDerivedInclusions } from '../src/engine/compare';
import { resolveRisk } from '../src/engine/risk';
import { resolveItemResponsibility } from '../src/engine/responsibility/resolver';
import { INCOTERMS_2020_RULESET } from '../src/engine/responsibility/rules-incoterms2020';
import { toScenario, toTrade, parseProject, serializeProject, toScenarios } from '../src/data/project-file';
import { actualQuotesProject, confirmOverride } from './fixtures/actual-quotes';
import { makeCostItem, makeTrade, makeScenario } from './helpers/factory';
import { TEST_TAX_PROFILE } from './fixtures/cif-108300';
import { createProjectReport } from '../src/ui/project-report';

/** 与ICC A2/A3/A5/A7独立对照的期望表，不由引擎规则反生成。 */
const oracle: [Incoterm, TradeNode, 'C' | 'A' | null, boolean, 'BUYER' | 'SELLER', 'BUYER' | 'SELLER'][] = [
  ['EXW','SELLER_PREMISES',null,false,'BUYER','BUYER'],
  ['FCA','CARRIER_HANDOVER',null,false,'SELLER','BUYER'],
  ['FAS','ORIGIN_TERMINAL',null,false,'SELLER','BUYER'],
  ['FOB','CARRIER_HANDOVER',null,false,'SELLER','BUYER'],
  ['CFR','CARRIER_HANDOVER',null,false,'SELLER','BUYER'],
  ['CIF','CARRIER_HANDOVER','C',false,'SELLER','BUYER'],
  ['CPT','CARRIER_HANDOVER',null,false,'SELLER','BUYER'],
  ['CIP','CARRIER_HANDOVER','A',false,'SELLER','BUYER'],
  ['DAP','FINAL_DELIVERY',null,false,'SELLER','BUYER'],
  ['DPU','FINAL_DELIVERY',null,true,'SELLER','BUYER'],
  ['DDP','FINAL_DELIVERY',null,false,'SELLER','SELLER'],
];
function decide(term: Incoterm, node: TradeNode, category: ReturnType<typeof makeCostItem>['cost_category'] = 'CUSTOM', facts?: ReturnType<typeof makeScenario>['facts']) {
  const item = makeCostItem({ cost_id: 'fee', trade_node: node, cost_category: category, amount: '100' });
  return resolveItemResponsibility(item, { trade: makeTrade({ items: [item] }), scenario: makeScenario({ incoterm: term, facts }), ruleSet: INCOTERMS_2020_RULESET });
}
function run(p = actualQuotesProject()) {
  const trade = toTrade(p);
  return analyze({ trade, scenario: scenarioWithDerivedInclusions(toScenario(p), trade), taxProfile: p.tax_profile, fxBooks: p.fx_books });
}

describe('基础概念独立核验', () => {
  it.each(oracle)('%s：交货风险、投保义务、卸货义务与清关费用分别核对', (term, node, cover, unload, exp, imp) => {
    const basics = incotermBasics(term);
    expect(resolveRisk(term).transfer_node).toBe(node);
    expect(basics.required_seller_insurance).toBe(cover === null ? null : cover === 'A' ? 'ICC_A' : 'ICC_C');
    expect(basics.delivery_requires_destination_unloading).toBe(unload);
    expect(decide(term, 'EXPORT_CLEARANCE').responsibility).toBe(exp);
    expect(decide(term, 'IMPORT_CLEARANCE').responsibility).toBe(imp);
    expect(decide(term, 'IMPORT_DUTIES').responsibility).toBe(imp);
  });
  it.each(INCOTERMS)('%s保险费用不被装卸地点或班轮条件错误覆盖', term => {
    for (const node of ['SELLER_PREMISES','CARRIER_HANDOVER','DESTINATION_TERMINAL','FINAL_DELIVERY'] as const) {
      const r = decide(term, node, 'INSURANCE', { delivery_place: 'SELLER_PREMISES', shipping_terms: 'LINER' });
      expect(r.responsibility).toBe(['CIF','CIP'].includes(term) ? 'SELLER' : 'CONDITIONAL');
      expect(r.rule_id).toBe(`${term}.INSURANCE`);
    }
  });
  it('海运专用4术语与其他7术语分别核验，不将FCA/CPT/CIP限制为非海运', () => {
    for (const mode of ['AIR','RAIL','ROAD','MULTIMODAL'] as const) expect(availableIncoterms(mode)).toEqual(['EXW','FCA','CPT','CIP','DAP','DPU','DDP']);
    for (const mode of ['SEA','INLAND_WATERWAY'] as const) expect(availableIncoterms(mode)).toEqual(INCOTERMS);
  });
  it.each(['CFR','CIF','CPT','CIP'] as const)('%s付运费不意味着目的地交货，合同费用覆盖不改变交货风险', term => {
    expect(resolveRisk(term).separation).toBe(true); expect(resolveRisk(term).transfer_node).toBe('CARRIER_HANDOVER');
    const item = makeCostItem({ cost_id: 'fee', trade_node: 'FINAL_DELIVERY', amount: '100' });
    const r = resolveItemResponsibility(item, { trade: makeTrade({ items: [item] }), scenario: makeScenario({ incoterm: term, responsibility_overrides: { fee: { responsibility: 'SELLER', reason: '合成运输合同明确本项卸货费由卖方负担' } } }), ruleSet: INCOTERMS_2020_RULESET });
    expect(r.responsibility).toBe('SELLER'); expect(r.source).toBe('USER_OVERRIDE');
    expect(incotermBasics(term).delivery_requires_destination_unloading).toBe(false);
    expect(resolveRisk(term).transfer_node).toBe('CARRIER_HANDOVER');
  });
});

describe('FCA和卸货费用边界', () => {
  it('EXW报关代办人不改变默认费用责任；另约付费只覆盖费用而非交货风险', () => {
    expect(decide('EXW','EXPORT_CLEARANCE','EXPORT_CLEARANCE',{clearance_agent:'SELLER_ACTS_FOR_BUYER'}).responsibility).toBe('BUYER');
    const item=makeCostItem({cost_id:'clearance',trade_node:'EXPORT_CLEARANCE',cost_category:'EXPORT_CLEARANCE',amount:'80'});
    const r=resolveItemResponsibility(item,{trade:makeTrade({items:[item]}),scenario:makeScenario({incoterm:'EXW',facts:{clearance_agent:'SELLER_ACTS_FOR_BUYER'},responsibility_overrides:{clearance:{responsibility:'SELLER',reason:'合成合同另约卖方承担本项报关费'}}}),ruleSet:INCOTERMS_2020_RULESET});
    expect(r.responsibility).toBe('SELLER');expect(r.source).toBe('USER_OVERRIDE');expect(resolveRisk('EXW').transfer_node).toBe('SELLER_PREMISES');
  });
  it.each(['SELLER_PREMISES','OTHER',undefined] as const)('FCA交货地点%s决定内陆运输归属，缺失不猜', place => {
    const r = decide('FCA','INLAND_TRANSPORT','INLAND_TRANSPORT',place ? {delivery_place:place} : undefined);
    expect(r.responsibility).toBe(place === 'SELLER_PREMISES' ? 'BUYER' : place === 'OTHER' ? 'SELLER' : 'CONDITIONAL');
  });
  it('FCA其他地点THC不凭整项节点判定前后作业，卖方场所交货后THC归买方', () => {
    expect(decide('FCA','ORIGIN_TERMINAL','ORIGIN_TERMINAL',{delivery_place:'OTHER'}).responsibility).toBe('CONDITIONAL');
    expect(decide('FCA','ORIGIN_TERMINAL','ORIGIN_TERMINAL',{delivery_place:'SELLER_PREMISES'}).responsibility).toBe('BUYER');
  });
  it.each(['CFR','CIF','CPT','CIP','DAP','DDP'] as const)('%s无卸货作业义务不能推定全部卸货费归买方', term => {
    expect(decide(term,'FINAL_DELIVERY').responsibility).toBe('CONDITIONAL');
    expect(incotermBasics(term).delivery_requires_destination_unloading).toBe(false);
  });
  it.each(['CFR','CIF'] as const)('%s班轮/舱底条款名称不替代运输合同，也不改变上船交货', term => {
    for (const shipping_terms of ['LINER','EX_SHIP_HOLD'] as const) expect(decide(term,'DESTINATION_TERMINAL','DESTINATION_TERMINAL',{shipping_terms}).responsibility).toBe('CONDITIONAL');
    expect(resolveRisk(term).transfer_point).toContain('装上船');
  });
  it.each(['CPT','CIP'] as const)('%s指定运费终点可能为港口，不能默认随后短驳归卖方', term => {
    expect(decide(term,'DESTINATION_TRANSPORT').responsibility).toBe('CONDITIONAL');
  });
});

describe('测算基础与文件不补造事实', () => {
  it.each(['0','-1','-0.01'])('商品数量%s阻断单商品货物测算', quantity => {
    const trade = makeTrade({ items: [] }); trade.goods.quantity = quantity;
    expect(() => analyze({trade,scenario:makeScenario({incoterm:'FOB'}),taxProfile:TEST_TAX_PROFILE,fxBooks:[]})).toThrow(/商品数量必须大于零/);
  });
  it('报价术语错配在单方案入口阻断；零计费量和商业退款不被当成非法商品数量', () => {
    const trade = makeTrade({items:[makeCostItem({cost_id:'free',pricing_method:'QTY_X_UNIT',quantity:'0',rate:'10'}),makeCostItem({cost_id:'refund',amount:'-10',trade_node:'IMPORT_CLEARANCE'})]});
    const scenario = makeScenario({incoterm:'FOB'}); scenario.quote.incoterm='CIF';
    expect(()=>analyze({trade,scenario,taxProfile:TEST_TAX_PROFILE,fxBooks:[]})).toThrow(/报价术语.*不一致/);
    scenario.quote.incoterm='FOB';const r=analyze({trade,scenario,taxProfile:TEST_TAX_PROFILE,fxBooks:[]});
    expect(r.items.find(i=>i.item.cost_id==='free')!.base_amount.isZero()).toBe(true);expect(r.items.find(i=>i.item.cost_id==='refund')!.base_amount.toString()).toBe('-10');
  });
  it('旧文件无自愿保险承担资料不补造确认，保费仍进税基，完整成本不参与确定排名', () => {
    const p=actualQuotesProject();delete p.term_scenarios!.FOB!.responsibility_overrides;p.incoterm='FOB';
    const before=JSON.stringify(p),r=run(parseProject(serializeProject(p)));
    expect(JSON.stringify(p)).toBe(before);expect(r.decision.ready).toBe(false);
    expect(r.items.find(i=>i.item.cost_id==='insurance')!.exclusion).toBe('CONDITIONAL_UNRESOLVED');
    expect(r.dutiable_value.value.toString()).toBe('11100');expect(r.import_tax.duty.toString()).toBe('555');
    expect(r.buyer.landed_cost_with_tax.toString()).toBe('13070.15');
    p.term_scenarios!.FOB!.responsibility_overrides={insurance:{responsibility:'BUYER',reason:'合成合同明确买方自愿投保及付费'}};
    confirmOverride(p,'FOB','insurance');expect(run(p).decision.ready).toBe(true);expect(run(p).buyer.landed_cost_with_tax.toString()).toBe('13170.15');
  });
  it('非法商品数量阻断共享该交易的全部报价，不生成最优推荐', () => {
    const p=actualQuotesProject();p.goods.quantity='0'; const c=compare({trade:toTrade(p),template:toScenario(p),scenarios:toScenarios(p),anchor:p.anchor,taxProfile:p.tax_profile,fxBooks:p.fx_books});
    expect(c.columns.every(col=>!col.feasible)).toBe(true);expect(c.best_buyer_landed).toBeNull();
  });
  it('DDP的税费归属不产生买方抵扣；义务边界进入离线报告且不包含可执行内容', () => {
    const p=actualQuotesProject();p.incoterm='DDP';p.anchor={kind:'FIXED_QUOTE'};p.quote={amount:'10700',currency:'CNY',fx_type:'CONTRACT'};p.tax_profile.import.vatDeductibleForBuyer=true;
    const r=run(p);expect(r.buyer.vat_total.isZero()).toBe(true);expect(r.buyer.deductible_vat.isZero()).toBe(true);
    const report=createProjectReport(p);expect(report).toContain('Incoterms不规定货物所有权转移');expect(report).toContain('卸货费用仍须另查运输合同');
    expect(report).not.toMatch(/<script|<iframe|<form/i);
  });
});
