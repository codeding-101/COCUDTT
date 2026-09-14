import { describe, expect, it } from 'vitest';
import { INCOTERMS, type Incoterm } from '../src/domain/enums';
import {
  INCOTERMS_2020_RISK,
  applyRiskRelation,
  resolveRisk,
  riskRelationForNode,
  separatedCostIds,
} from '../src/engine/risk';
import { makeCostItem } from './helpers/factory';

describe('Risk Engine 风险转移', () => {
  it('11 个术语都有风险规则', () => {
    expect(INCOTERMS_2020_RISK).toHaveLength(11);
    expect(INCOTERMS_2020_RISK.map((rule) => rule.incoterm).sort()).toEqual([...INCOTERMS].sort());
  });

  it('各术语的风险转移点符合 Incoterms 2020', () => {
    const expected: Record<Incoterm, string> = {
      EXW: 'SELLER_PREMISES',
      FCA: 'CARRIER_HANDOVER',
      FAS: 'ORIGIN_TERMINAL',
      FOB: 'CARRIER_HANDOVER',
      CFR: 'CARRIER_HANDOVER',
      CIF: 'CARRIER_HANDOVER',
      CPT: 'CARRIER_HANDOVER',
      CIP: 'CARRIER_HANDOVER',
      DAP: 'FINAL_DELIVERY',
      DPU: 'FINAL_DELIVERY',
      DDP: 'FINAL_DELIVERY',
    };
    for (const incoterm of INCOTERMS) {
      expect(resolveRisk(incoterm).transfer_node).toBe(expected[incoterm]);
    }
  });

  it('风险与费用分离只在 CFR / CIF / CPT / CIP 成立', () => {
    const separated = INCOTERMS_2020_RISK.filter((rule) => rule.cost_risk_separated).map((rule) => rule.incoterm);
    expect(separated).toEqual(['CFR', 'CIF', 'CPT', 'CIP']);
    expect(resolveRisk('CIF').separation_note).toContain('风险与费用在此分离');
    expect(resolveRisk('FOB').separation_note).toBeNull();
  });

  it('交付点及其之前视为风险转移前', () => {
    const cif = resolveRisk('CIF');
    expect(riskRelationForNode(cif.transfer_node, 'SELLER_PREMISES')).toBe('BEFORE_TRANSFER');
    expect(riskRelationForNode(cif.transfer_node, 'ORIGIN_TERMINAL')).toBe('BEFORE_TRANSFER');
    expect(riskRelationForNode(cif.transfer_node, 'CARRIER_HANDOVER')).toBe('BEFORE_TRANSFER');
    expect(riskRelationForNode(cif.transfer_node, 'MAIN_CARRIAGE')).toBe('AFTER_TRANSFER');
    expect(riskRelationForNode(cif.transfer_node, 'DESTINATION_TERMINAL')).toBe('AFTER_TRANSFER');

    const exw = resolveRisk('EXW');
    expect(riskRelationForNode(exw.transfer_node, 'INLAND_TRANSPORT')).toBe('AFTER_TRANSFER');

    const dpu = resolveRisk('DPU');
    expect(riskRelationForNode(dpu.transfer_node, 'DESTINATION_TRANSPORT')).toBe('BEFORE_TRANSFER');
    expect(riskRelationForNode(dpu.transfer_node, 'FINAL_DELIVERY')).toBe('BEFORE_TRANSFER');
  });

  it('填充风险关系时不改动入参', () => {
    const items = [makeCostItem({ cost_id: 'freight', trade_node: 'MAIN_CARRIAGE' })];
    const filled = applyRiskRelation(items, resolveRisk('CIF').transfer_node);
    expect(filled[0]?.risk_relation).toBe('AFTER_TRANSFER');
    expect(items[0]?.risk_relation).toBeUndefined();
  });

  it('识别"风险已转移但费用仍由卖方承担"的费用项', () => {
    const items = [
      makeCostItem({ cost_id: 'goods', trade_node: 'SELLER_PREMISES' }),
      makeCostItem({ cost_id: 'freight', trade_node: 'MAIN_CARRIAGE' }),
      makeCostItem({ cost_id: 'insurance', trade_node: 'MAIN_CARRIAGE', cost_category: 'INSURANCE' }),
      makeCostItem({ cost_id: 'destination', trade_node: 'DESTINATION_TERMINAL' }),
    ];
    const responsibility: Record<string, string> = {
      goods: 'SELLER',
      freight: 'SELLER',
      insurance: 'SELLER',
      destination: 'BUYER',
    };
    const separated = separatedCostIds(items, resolveRisk('CIF').transfer_node, (id) => responsibility[id]);
    expect(separated).toEqual(['freight', 'insurance']);
  });
});
