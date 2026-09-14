import { describe, expect, it } from 'vitest';
import type { CarriageMode, CostCategory, Incoterm, TradeNode } from '../src/domain/enums';
import type { ContractClause, IncotermsRuleSet, ScenarioFacts } from '../src/domain/rule';
import type { ResponsibilityOverride } from '../src/domain/scenario';
import { EngineError } from '../src/engine/errors';
import { INCOTERMS_2020_RULESET } from '../src/engine/responsibility/rules-incoterms2020';
import {
  CONDITIONAL_MESSAGE,
  resolveItemResponsibility,
  resolveResponsibility,
} from '../src/engine/responsibility/resolver';
import { makeCostItem, makeScenario, makeTrade } from './helpers/factory';

const emptyRuleSet: IncotermsRuleSet = {
  id: 'test-empty',
  version: '0',
  rules: [],
  special_facts: [],
  node_fallbacks: [],
};

const onlySpecialFacts: IncotermsRuleSet = {
  ...emptyRuleSet,
  special_facts: INCOTERMS_2020_RULESET.special_facts,
};

const onlyNodeFallbacks: IncotermsRuleSet = {
  ...emptyRuleSet,
  node_fallbacks: INCOTERMS_2020_RULESET.node_fallbacks,
};

interface DecideParams {
  incoterm: Incoterm;
  node?: TradeNode;
  category?: CostCategory;
  cost_id?: string;
  cost_name?: string;
  facts?: ScenarioFacts;
  carriage_mode?: CarriageMode;
  ruleSet?: IncotermsRuleSet;
  overrides?: Record<string, ResponsibilityOverride>;
  contract_clauses?: ContractClause[];
}

function decide(params: DecideParams) {
  const costId = params.cost_id ?? 'item-1';
  const item = makeCostItem({
    cost_id: costId,
    trade_node: params.node ?? 'SELLER_PREMISES',
    cost_category: params.category ?? 'CUSTOM',
    ...(params.cost_name !== undefined ? { cost_name: params.cost_name } : {}),
  });
  const trade = makeTrade({ items: [item], carriage_mode: params.carriage_mode ?? 'SEA' });
  const scenario = makeScenario({
    incoterm: params.incoterm,
    ...(params.facts !== undefined ? { facts: params.facts } : {}),
    ...(params.overrides !== undefined ? { responsibility_overrides: params.overrides } : {}),
  });
  const baseRuleSet = params.ruleSet ?? INCOTERMS_2020_RULESET;
  const ruleSet: IncotermsRuleSet =
    params.contract_clauses !== undefined ? { ...baseRuleSet, contract_clauses: params.contract_clauses } : baseRuleSet;

  return resolveItemResponsibility(item, { trade, scenario, ruleSet });
}

describe('Incoterms 责任判定', () => {
  describe('第一级：用户显式指定', () => {
    it('用户覆盖优先于 Incoterms 规则', () => {
      const decision = decide({
        incoterm: 'EXW',
        node: 'EXPORT_CLEARANCE',
        overrides: { 'item-1': { responsibility: 'SELLER', reason: '合同约定由卖方代办出口报关' } },
      });
      expect(decision.responsibility).toBe('SELLER');
      expect(decision.source).toBe('USER_OVERRIDE');
      expect(decision.note).toBe('合同约定由卖方代办出口报关');
      expect(decision.needs_confirmation).toBe(false);
    });
  });

  describe('第二级：合同条款', () => {
    it('合同条款优先于 Incoterms 规则', () => {
      const decision = decide({
        incoterm: 'FOB',
        node: 'MAIN_CARRIAGE',
        cost_name: '国际海运费',
        contract_clauses: [
          { id: 'C-1', cost_name_contains: '海运费', responsibility: 'SELLER', note: '合同约定运费由卖方承担' },
        ],
      });
      expect(decision.responsibility).toBe('SELLER');
      expect(decision.source).toBe('CONTRACT');
      expect(decision.rule_id).toBe('C-1');
    });

    it('没有任何匹配条件的条款会被拒绝，避免误伤全部费用', () => {
      expect(() =>
        decide({
          incoterm: 'FOB',
          contract_clauses: [{ id: 'C-BAD', responsibility: 'SELLER', note: '过于宽泛' }],
        }),
      ).toThrowError(EngineError);
    });
  });

  describe('第三级：Incoterms 规则', () => {
    it('EXW：商品与包装归卖方，出口清关与装车归买方', () => {
      const goods = decide({ incoterm: 'EXW', node: 'SELLER_PREMISES', category: 'GOODS_AND_PACKING' });
      expect(goods.responsibility).toBe('SELLER');
      expect(goods.rule_id).toBe('EXW.SELLER_PREMISES.GOODS');

      const clearance = decide({ incoterm: 'EXW', node: 'EXPORT_CLEARANCE' });
      expect(clearance.responsibility).toBe('BUYER');
      expect(clearance.rule_id).toBe('EXW.EXPORT_CLEARANCE');

      const loading = decide({ incoterm: 'EXW', node: 'SELLER_PREMISES', cost_name: '装车费' });
      expect(loading.responsibility).toBe('BUYER');
    });

    it('FCA：出口清关归卖方；交货地点决定装货与卸货的分界', () => {
      expect(decide({ incoterm: 'FCA', node: 'EXPORT_CLEARANCE' }).responsibility).toBe('SELLER');

      const unknown = decide({ incoterm: 'FCA', node: 'CARRIER_HANDOVER' });
      expect(unknown.responsibility).toBe('CONDITIONAL');
      expect(unknown.needs_confirmation).toBe(true);
      expect(unknown.rule_id).toBe('FCA.CARRIER_HANDOVER.DEFAULT');

      const sellerPlace = decide({
        incoterm: 'FCA',
        node: 'CARRIER_HANDOVER',
        facts: { delivery_place: 'SELLER_PREMISES' },
      });
      expect(sellerPlace.responsibility).toBe('SELLER');
      expect(sellerPlace.rule_id).toBe('FCA.CARRIER_HANDOVER.SELLER_PLACE');

      const otherPlace = decide({
        incoterm: 'FCA',
        node: 'CARRIER_HANDOVER',
        facts: { delivery_place: 'OTHER' },
      });
      expect(otherPlace.responsibility).toBe('BUYER');
      expect(otherPlace.rule_id).toBe('FCA.CARRIER_HANDOVER.OTHER_PLACE');
    });

    it('FOB：装船费随运输条款变形变化，事实缺失时按基本含义归卖方', () => {
      const base = decide({ incoterm: 'FOB', node: 'CARRIER_HANDOVER', cost_name: '装船费' });
      expect(base.responsibility).toBe('SELLER');
      expect(base.rule_id).toBe('FOB.CARRIER_HANDOVER.DEFAULT');

      const liner = decide({
        incoterm: 'FOB',
        node: 'CARRIER_HANDOVER',
        facts: { shipping_terms: 'LINER' },
      });
      expect(liner.responsibility).toBe('BUYER');
      expect(liner.rule_id).toBe('FOB.CARRIER_HANDOVER.LINER');

      const underTackle = decide({
        incoterm: 'FOB',
        node: 'CARRIER_HANDOVER',
        facts: { shipping_terms: 'UNDER_TACKLE' },
      });
      expect(underTackle.responsibility).toBe('BUYER');

      const stowed = decide({
        incoterm: 'FOB',
        node: 'CARRIER_HANDOVER',
        facts: { shipping_terms: 'STOWED' },
      });
      expect(stowed.responsibility).toBe('SELLER');
      expect(stowed.rule_id).toBe('FOB.CARRIER_HANDOVER.STOWED');
    });

    it('FOB：班轮条件下的起运港港杂费归买方，港杂费与装船费都能被覆盖', () => {
      const terminalDefault = decide({ incoterm: 'FOB', node: 'ORIGIN_TERMINAL' });
      expect(terminalDefault.responsibility).toBe('SELLER');

      const terminalLiner = decide({
        incoterm: 'FOB',
        node: 'ORIGIN_TERMINAL',
        facts: { shipping_terms: 'LINER' },
      });
      expect(terminalLiner.responsibility).toBe('BUYER');
      expect(terminalLiner.rule_id).toBe('FOB.ORIGIN_TERMINAL.LINER');
    });

    it('CIF 与 CFR 只差保险一项', () => {
      expect(decide({ incoterm: 'CIF', node: 'MAIN_CARRIAGE', category: 'INSURANCE' }).responsibility).toBe('SELLER');
      expect(decide({ incoterm: 'CFR', node: 'MAIN_CARRIAGE', category: 'INSURANCE' }).responsibility).toBe('BUYER');
      expect(decide({ incoterm: 'CIF', node: 'MAIN_CARRIAGE' }).responsibility).toBe('SELLER');
      expect(decide({ incoterm: 'CFR', node: 'MAIN_CARRIAGE' }).responsibility).toBe('SELLER');
    });

    it('CIF：卸货费随卸货变形变化', () => {
      expect(decide({ incoterm: 'CIF', node: 'DESTINATION_TERMINAL' }).responsibility).toBe('BUYER');
      expect(
        decide({ incoterm: 'CIF', node: 'DESTINATION_TERMINAL', facts: { shipping_terms: 'LINER' } }).responsibility,
      ).toBe('SELLER');
      expect(
        decide({ incoterm: 'CIF', node: 'DESTINATION_TERMINAL', facts: { shipping_terms: 'EX_SHIP_HOLD' } })
          .responsibility,
      ).toBe('BUYER');
    });

    it('CPT 与 CIP 只差保险一项，且主运费与目的地运输均归卖方', () => {
      expect(decide({ incoterm: 'CPT', node: 'MAIN_CARRIAGE' }).responsibility).toBe('SELLER');
      expect(decide({ incoterm: 'CPT', node: 'DESTINATION_TRANSPORT' }).responsibility).toBe('SELLER');
      expect(decide({ incoterm: 'CPT', node: 'MAIN_CARRIAGE', category: 'INSURANCE' }).responsibility).toBe('BUYER');
      expect(decide({ incoterm: 'CIP', node: 'MAIN_CARRIAGE', category: 'INSURANCE' }).responsibility).toBe('SELLER');
    });

    it('DAP 与 DPU 只差目的地卸货一项', () => {
      expect(decide({ incoterm: 'DAP', node: 'FINAL_DELIVERY' }).responsibility).toBe('BUYER');
      expect(decide({ incoterm: 'DPU', node: 'FINAL_DELIVERY' }).responsibility).toBe('SELLER');
      expect(decide({ incoterm: 'DPU', node: 'IMPORT_CLEARANCE' }).responsibility).toBe('BUYER');
    });

    it('DDP：进口清关与关税归卖方，卸货仍归买方', () => {
      expect(decide({ incoterm: 'DDP', node: 'IMPORT_CLEARANCE' }).responsibility).toBe('SELLER');
      expect(decide({ incoterm: 'DDP', node: 'IMPORT_DUTIES' }).responsibility).toBe('SELLER');
      expect(decide({ incoterm: 'DDP', node: 'FINAL_DELIVERY' }).responsibility).toBe('BUYER');
    });

    it('系统不认识的费用名称不影响判定：按节点与类别判定', () => {
      const fumigation = decide({
        incoterm: 'FOB',
        node: 'EXPORT_CLEARANCE',
        cost_name: '熏蒸费',
        cost_id: 'fumigation',
      });
      expect(fumigation.responsibility).toBe('SELLER');
      expect(fumigation.rule_id).toBe('FOB.EXPORT_CLEARANCE');

      const storage = decide({
        incoterm: 'DDP',
        node: 'DESTINATION_TERMINAL',
        cost_name: '目的港仓储费',
        cost_id: 'storage',
      });
      expect(storage.responsibility).toBe('SELLER');
    });
  });

  describe('第四级：特殊事实兜底', () => {
    it('规则表未覆盖时，由明确的事实兜底判定', () => {
      const decision = decide({
        incoterm: 'EXW',
        node: 'EXPORT_CLEARANCE',
        facts: { clearance_agent: 'SELLER_ACTS_FOR_BUYER' },
        ruleSet: onlySpecialFacts,
      });
      expect(decision.responsibility).toBe('SELLER');
      expect(decision.source).toBe('SPECIAL_CONDITION');
      expect(decision.rule_id).toBe('SF.EXPORT_CLEARANCE.SELLER_ACTS_FOR_BUYER');
      expect(decision.confidence).toBe('MEDIUM');
    });

    it('事实未提供时特殊事实层不命中', () => {
      const decision = decide({
        incoterm: 'EXW',
        node: 'INLAND_TRANSPORT',
        ruleSet: onlyNodeFallbacks,
      });
      expect(decision.source).toBe('TRADE_NODE');
    });
  });

  describe('第五级：贸易节点兜底', () => {
    it('依据节点推断，并标记为低置信度、需人工核对', () => {
      const decision = decide({
        incoterm: 'CIF',
        node: 'MAIN_CARRIAGE',
        ruleSet: onlyNodeFallbacks,
      });
      expect(decision.responsibility).toBe('SELLER');
      expect(decision.source).toBe('TRADE_NODE');
      expect(decision.confidence).toBe('LOW');
      expect(decision.needs_confirmation).toBe(true);
    });

    it('节点不在卖方范围内时推断归买方', () => {
      const decision = decide({
        incoterm: 'EXW',
        node: 'DESTINATION_TERMINAL',
        ruleSet: onlyNodeFallbacks,
      });
      expect(decision.responsibility).toBe('BUYER');
      expect(decision.source).toBe('TRADE_NODE');
    });
  });

  describe('第六级：无法判定', () => {
    it('输出 CONDITIONAL 与固定提示文案，不静默假设', () => {
      const decision = decide({ incoterm: 'FOB', node: 'MAIN_CARRIAGE', ruleSet: emptyRuleSet });
      expect(decision.responsibility).toBe('CONDITIONAL');
      expect(decision.source).toBe('UNRESOLVED');
      expect(decision.note).toBe(CONDITIONAL_MESSAGE);
      expect(decision.needs_confirmation).toBe(true);
    });
  });

  describe('术语与运输方式的兼容性', () => {
    it('海运专属术语配空运时报错', () => {
      const item = makeCostItem({ cost_id: 'item-1' });
      const trade = makeTrade({ items: [item], carriage_mode: 'AIR' });
      const scenario = makeScenario({ incoterm: 'FOB' });
      try {
        resolveResponsibility({ trade, scenario, ruleSet: INCOTERMS_2020_RULESET });
        throw new Error('预期抛出 INCOTERM_MODE_INCOMPATIBLE');
      } catch (error) {
        expect(error).toBeInstanceOf(EngineError);
        expect((error as EngineError).code).toBe('INCOTERM_MODE_INCOMPATIBLE');
      }
    });

    it('非海运术语配空运可以正常判定', () => {
      const decision = decide({ incoterm: 'CIP', node: 'MAIN_CARRIAGE', carriage_mode: 'AIR' });
      expect(decision.responsibility).toBe('SELLER');
    });
  });

  describe('批量判定', () => {
    it('一次判定全部费用项，顺序与入参一致', () => {
      const items = [
        makeCostItem({ cost_id: 'a', trade_node: 'SELLER_PREMISES', cost_category: 'GOODS_AND_PACKING' }),
        makeCostItem({ cost_id: 'b', trade_node: 'MAIN_CARRIAGE' }),
        makeCostItem({ cost_id: 'c', trade_node: 'DESTINATION_TERMINAL' }),
      ];
      const trade = makeTrade({ items });
      const scenario = makeScenario({ incoterm: 'CIF' });
      const decisions = resolveResponsibility({ trade, scenario, ruleSet: INCOTERMS_2020_RULESET });
      expect(decisions.map((decision) => decision.cost_id)).toEqual(['a', 'b', 'c']);
      expect(decisions.map((decision) => decision.responsibility)).toEqual(['SELLER', 'SELLER', 'BUYER']);
    });
  });
});
