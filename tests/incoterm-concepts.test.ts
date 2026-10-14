import { describe, expect, it } from 'vitest';
import type { CostCategory, Incoterm, TradeNode } from '../src/domain/enums';
import { INCOTERMS, availableIncoterms, isSeaMode } from '../src/domain/enums';
import type { ScenarioFacts } from '../src/domain/rule';
import { INCOTERMS_2020_RULESET } from '../src/engine/responsibility/rules-incoterms2020';
import { resolveItemResponsibility } from '../src/engine/responsibility/resolver';
import { resolveRisk } from '../src/engine/risk';
import { incotermBasics } from '../src/domain/incoterm-basics';
import { makeCostItem, makeScenario, makeTrade } from './helpers/factory';

/**
 * 概念检测：把 Incoterms 2020 的术语定义逐条写成断言，核对引擎实现是否与之一致。
 *
 * 依据ICC Incoterms 2020 A2/A3/A5/A7/A9/B9正文核对，旧教学近似值已修正——
 * 只有这样，测试才能发现"实现与概念不符"，而不只是"实现与上次相同"。
 *
 * 每条断言后面标注了它对应概念里的哪句话。
 */

/** 空运、陆运、多式联运：这四种运输方式下可用的术语应当一致 */
const NON_SEA_MODES = ['AIR', 'RAIL', 'ROAD', 'MULTIMODAL'] as const;

function decide(
  incoterm: Incoterm,
  node: TradeNode,
  options: { category?: CostCategory; facts?: ScenarioFacts } = {},
) {
  const item = makeCostItem({
    cost_id: 'item',
    trade_node: node,
    cost_category: options.category ?? 'CUSTOM',
  });
  const scenario = makeScenario({
    incoterm,
    ...(options.facts !== undefined ? { facts: options.facts } : {}),
  });
  return resolveItemResponsibility(item, {
    trade: makeTrade({ items: [item] }),
    scenario,
    ruleSet: INCOTERMS_2020_RULESET,
  });
}

function responsibilityOf(
  incoterm: Incoterm,
  node: TradeNode,
  options: { category?: CostCategory; facts?: ScenarioFacts } = {},
): string {
  return decide(incoterm, node, options).responsibility;
}

describe('概念检测 · 适用运输方式的分类', () => {
  const SEA_ONLY: Incoterm[] = ['FAS', 'FOB', 'CFR', 'CIF'];
  const ANY_MODE: Incoterm[] = ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];

  it('11 种术语按适用运输方式分成 7 + 4', () => {
    expect(ANY_MODE.length + SEA_ONLY.length).toBe(11);
    expect([...ANY_MODE, ...SEA_ONLY].sort()).toEqual([...INCOTERMS].sort());
  });

  it('海运与内河运输下 11 种术语全部可用', () => {
    expect(availableIncoterms('SEA')).toHaveLength(11);
    expect(availableIncoterms('INLAND_WATERWAY')).toHaveLength(11);
    expect(isSeaMode('SEA')).toBe(true);
    expect(isSeaMode('INLAND_WATERWAY')).toBe(true);
  });

  it('空运、陆运、多式联运下只有 7 种可用，且正好是那 7 种', () => {
    for (const mode of NON_SEA_MODES) {
      const available = availableIncoterms(mode);
      expect(available, `${mode} 可用术语`).toEqual(ANY_MODE);
      for (const incoterm of SEA_ONLY) {
        expect(available, `${mode} 不应包含 ${incoterm}`).not.toContain(incoterm);
      }
    }
  });
});

describe('概念检测 · 适用于任何运输方式的 7 种', () => {
  it('EXW：指定地点不必为卖方场所，未装货交货；出口清关通常由买方办理', () => {
    // 装货由买方
    expect(responsibilityOf('EXW', 'SELLER_PREMISES', { category: 'CUSTOM' })).toBe('BUYER');
    // 出口清关由买方
    expect(responsibilityOf('EXW', 'EXPORT_CLEARANCE')).toBe('BUYER');
    // 装货之后的全部节点由买方承担
    const nodes: TradeNode[] = [
      'INLAND_TRANSPORT',
      'EXPORT_CLEARANCE',
      'ORIGIN_TERMINAL',
      'CARRIER_HANDOVER',
      'MAIN_CARRIAGE',
      'DESTINATION_TERMINAL',
      'IMPORT_CLEARANCE',
      'IMPORT_DUTIES',
      'DESTINATION_TRANSPORT',
      'FINAL_DELIVERY',
    ];
    for (const node of nodes) {
      expect(responsibilityOf('EXW', node), `EXW 在 ${node}`).toBe('BUYER');
    }
    // 货物与包装仍归卖方
    expect(responsibilityOf('EXW', 'SELLER_PREMISES', { category: 'GOODS_AND_PACKING' })).toBe('SELLER');
    // 风险：卖方所在地、尚未装货
    const risk = resolveRisk('EXW');
    expect(risk.transfer_node).toBe('SELLER_PREMISES');
    expect(risk.transfer_point).toContain('尚未装货');
  });

  it('FCA：交货地是卖方场所时装货归卖方，其他地点时卸货归买方', () => {
    // 出口清关由卖方办理
    expect(responsibilityOf('FCA', 'EXPORT_CLEARANCE')).toBe('SELLER');
    // 卖方场所交货：装货由卖方
    expect(
      responsibilityOf('FCA', 'CARRIER_HANDOVER', { facts: { delivery_place: 'SELLER_PREMISES' } }),
    ).toBe('SELLER');
    // 其他地点交货：卸货由买方
    expect(responsibilityOf('FCA', 'CARRIER_HANDOVER', { facts: { delivery_place: 'OTHER' } })).toBe('BUYER');
    // 未指明交货地点时不猜，要求用户补充事实
    expect(responsibilityOf('FCA', 'CARRIER_HANDOVER')).toBe('CONDITIONAL');
    // 风险：交给承运人时转移
    expect(resolveRisk('FCA').transfer_node).toBe('CARRIER_HANDOVER');
  });

  it('CPT：交给承运人即转移风险，但运费由卖方付至指定目的地', () => {
    expect(responsibilityOf('CPT', 'CARRIER_HANDOVER')).toBe('SELLER');
    expect(responsibilityOf('CPT', 'MAIN_CARRIAGE')).toBe('SELLER');
    expect(responsibilityOf('CPT', 'DESTINATION_TERMINAL')).toBe('CONDITIONAL');
    expect(responsibilityOf('CPT', 'DESTINATION_TRANSPORT')).toBe('CONDITIONAL');
    // 概念中未提到 CPT 卖方有投保义务
    expect(responsibilityOf('CPT', 'MAIN_CARRIAGE', { category: 'INSURANCE' })).toBe('CONDITIONAL');
    // 风险与费用分离：风险在承运人处转移，费用延伸到目的地
    const risk = resolveRisk('CPT');
    expect(risk.transfer_node).toBe('CARRIER_HANDOVER');
    expect(risk.separation).toBe(true);
  });

  it('CIP：责任划分与 CPT 相同，但卖方须额外投保', () => {
    expect(responsibilityOf('CIP', 'CARRIER_HANDOVER')).toBe('SELLER');
    expect(responsibilityOf('CIP', 'MAIN_CARRIAGE')).toBe('SELLER');
    expect(responsibilityOf('CIP', 'DESTINATION_TRANSPORT')).toBe('CONDITIONAL');
    // 与 CPT 的差别只在保险
    const insurance = decide('CIP', 'MAIN_CARRIAGE', { category: 'INSURANCE' });
    expect(insurance.responsibility).toBe('SELLER');
    // "CIP 要求的保险覆盖范围高于 CIF"
    expect(insurance.note).toMatch(/A\)|一切险/);
    expect(decide('CIF', 'MAIN_CARRIAGE', { category: 'INSURANCE' }).note).toMatch(/C\)/);
    expect(resolveRisk('CIP').separation).toBe(true);
  });

  it('DAP：在目的地（运输工具上、尚未卸货）交货，卖方不负责卸货与进口清关税费', () => {
    expect(responsibilityOf('DAP', 'MAIN_CARRIAGE')).toBe('SELLER');
    expect(responsibilityOf('DAP', 'DESTINATION_TERMINAL')).toBe('SELLER');
    expect(responsibilityOf('DAP', 'DESTINATION_TRANSPORT')).toBe('SELLER');
    // 不负责卸货
    expect(responsibilityOf('DAP', 'FINAL_DELIVERY')).toBe('CONDITIONAL');
    // 不负责进口清关与税费
    expect(responsibilityOf('DAP', 'IMPORT_CLEARANCE')).toBe('BUYER');
    expect(responsibilityOf('DAP', 'IMPORT_DUTIES')).toBe('BUYER');
    // 风险：目的地、尚未卸货
    const risk = resolveRisk('DAP');
    expect(risk.transfer_node).toBe('FINAL_DELIVERY');
    expect(risk.transfer_point).toContain('尚未卸货');
  });

  it('DPU：11 种术语中唯一要求卖方在目的地卸货的', () => {
    expect(responsibilityOf('DPU', 'FINAL_DELIVERY')).toBe('SELLER');
    expect(responsibilityOf('DPU', 'IMPORT_CLEARANCE')).toBe('BUYER');
    expect(responsibilityOf('DPU', 'IMPORT_DUTIES')).toBe('BUYER');
    // "唯一"：其余 10 种术语在目的地卸货节点都不归卖方
    const others = INCOTERMS.filter((incoterm) => incoterm !== 'DPU');
    for (const incoterm of others) {
      // FCA 在交货节点的归属取决于交货地，其余术语在此节点均非卖方
      if (incoterm === 'FCA') continue;
      expect(responsibilityOf(incoterm, 'FINAL_DELIVERY'), `${incoterm} 的卸货责任`).not.toBe('SELLER');
    }
    // 风险：目的地、卸货完成
    const risk = resolveRisk('DPU');
    expect(risk.transfer_node).toBe('FINAL_DELIVERY');
    expect(risk.transfer_point).toContain('卸货完成');
  });

  it('DDP：卖方完成进口清关并支付进口关税税费，是责任最大的术语', () => {
    expect(responsibilityOf('DDP', 'IMPORT_CLEARANCE')).toBe('SELLER');
    expect(responsibilityOf('DDP', 'IMPORT_DUTIES')).toBe('SELLER');
    expect(responsibilityOf('DDP', 'MAIN_CARRIAGE')).toBe('SELLER');
    // 仍然是"尚未卸货"交货
    expect(responsibilityOf('DDP', 'FINAL_DELIVERY')).toBe('CONDITIONAL');
    expect(resolveRisk('DDP').transfer_point).toContain('尚未卸货');
    // 费用节点数量不是法定责任大小指标；DDP仍未改变卸货作业义务。
  });
});

describe('概念检测 · 仅适用于海运和内河水运的 4 种', () => {
  it('FAS：在装运港船边交货，风险随后转移', () => {
    expect(responsibilityOf('FAS', 'INLAND_TRANSPORT')).toBe('SELLER');
    expect(responsibilityOf('FAS', 'EXPORT_CLEARANCE')).toBe('SELLER');
    expect(responsibilityOf('FAS', 'ORIGIN_TERMINAL')).toBe('SELLER');
    // 装船及之后由买方
    expect(responsibilityOf('FAS', 'CARRIER_HANDOVER')).toBe('BUYER');
    expect(responsibilityOf('FAS', 'MAIN_CARRIAGE')).toBe('BUYER');
    const risk = resolveRisk('FAS');
    expect(risk.transfer_node).toBe('ORIGIN_TERMINAL');
    expect(risk.transfer_point).toContain('船边');
  });

  it('FOB：卖方将货物装上船，装上船时风险转移', () => {
    expect(responsibilityOf('FOB', 'EXPORT_CLEARANCE')).toBe('SELLER');
    expect(responsibilityOf('FOB', 'ORIGIN_TERMINAL')).toBe('SELLER');
    // 基本含义下装船费由卖方承担
    expect(responsibilityOf('FOB', 'CARRIER_HANDOVER')).toBe('SELLER');
    // 买方自行投保
    expect(responsibilityOf('FOB', 'MAIN_CARRIAGE', { category: 'INSURANCE' })).toBe('CONDITIONAL');
    const risk = resolveRisk('FOB');
    expect(risk.transfer_node).toBe('CARRIER_HANDOVER');
    expect(risk.transfer_point).toContain('装上船');
  });

  it('CFR：装船交货风险转移，卖方付至目的港运费；双方均无相对投保义务', () => {
    expect(responsibilityOf('CFR', 'CARRIER_HANDOVER')).toBe('SELLER');
    expect(responsibilityOf('CFR', 'MAIN_CARRIAGE')).toBe('SELLER');
    expect(responsibilityOf('CFR', 'MAIN_CARRIAGE', { category: 'INSURANCE' })).toBe('CONDITIONAL');
    const risk = resolveRisk('CFR');
    expect(risk.transfer_node).toBe('CARRIER_HANDOVER');
    expect(risk.separation).toBe(true);
  });

  it('CIF：责任与 CFR 类似，但卖方须额外投保并支付保险费', () => {
    expect(responsibilityOf('CIF', 'CARRIER_HANDOVER')).toBe('SELLER');
    expect(responsibilityOf('CIF', 'MAIN_CARRIAGE')).toBe('SELLER');
    expect(responsibilityOf('CIF', 'MAIN_CARRIAGE', { category: 'INSURANCE' })).toBe('SELLER');
    const risk = resolveRisk('CIF');
    expect(risk.transfer_node).toBe('CARRIER_HANDOVER');
    expect(risk.separation).toBe(true);
    // 与 CFR 的差别只在保险
    const categoryDiffs = (['SELLER_PREMISES', 'MAIN_CARRIAGE', 'DESTINATION_TERMINAL'] as TradeNode[]).filter(
      (node) => responsibilityOf('CIF', node) !== responsibilityOf('CFR', node),
    );
    expect(categoryDiffs).toEqual([]);
  });
});

describe('概念检测 · 义务与费用分别判断', () => {
  it('只有CIF/CIP要求卖方相对投保；无义务不推出保费必归另一方', () => {
    for (const term of INCOTERMS) {
      const required = term === 'CIF' || term === 'CIP';
      expect(incotermBasics(term).required_seller_insurance !== null).toBe(required);
      expect(responsibilityOf(term, 'MAIN_CARRIAGE', { category: 'INSURANCE' })).toBe(required ? 'SELLER' : 'CONDITIONAL');
    }
  });
  it('DPU唯一要求卖方卸货完成后交货，其他术语仍可按运输合同承担卸货费', () => {
    for (const term of INCOTERMS) expect(incotermBasics(term).delivery_requires_destination_unloading).toBe(term === 'DPU');
    expect(resolveRisk('DPU').transfer_point).toContain('卸货完成');
    for (const term of ['DAP','DDP'] as const) expect(resolveRisk(term).transfer_point).toContain('尚未卸货');
  });
});
