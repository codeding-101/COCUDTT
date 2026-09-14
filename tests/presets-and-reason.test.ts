import { describe, expect, it } from 'vitest';
import { toStorage } from '../src/domain/decimal';
import { COST_PRESETS, customCostItem, findPresets, presetToCostItem, type CostPreset } from '../src/data/cost-presets';
import { analyze } from '../src/engine/analyze';
import { computeGrossAmount } from '../src/engine/pricing';
import { INCOTERMS_2020_RULESET } from '../src/engine/responsibility/rules-incoterms2020';
import { resolveItemResponsibility } from '../src/engine/responsibility/resolver';
import { TEST_TAX_PROFILE } from './fixtures/cif-108300';
import { makeScenario, makeTrade } from './helpers/factory';

function preset(key: string): CostPreset {
  const found = COST_PRESETS.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`缺少预设: ${key}`);
  return found;
}

function names(keyword: string): string[] {
  return findPresets(keyword).map((found) => found.name);
}

describe('费用预设字典', () => {
  it('覆盖用户提到的常见费用', () => {
    expect(names('报关')).toContain('出口报关费');
    expect(names('报关')).toContain('进口报关代理费');
    expect(names('订舱')).toContain('订舱费');
    expect(names('租船订舱')).toContain('订舱费');
    expect(names('检疫')).toContain('出口商检费');
    expect(names('熏蒸')).toContain('熏蒸费');
    expect(names('滞箱')).toContain('滞箱费 / 滞期费');
    expect(names('查验')).toContain('目的地海关查验费');
  });

  it('预设按关键字匹配别名', () => {
    expect(names('THC').length).toBeGreaterThanOrEqual(2);
    expect(names('中信保')).toContain('出口信用保险费');
  });

  it('空关键字不返回全部，避免无意义的整表弹出', () => {
    expect(findPresets('   ')).toHaveLength(0);
  });

  it('报关费落在出口清关节点', () => {
    const item = presetToCostItem(preset('export-customs-broker'), {
      cost_id: 'c1',
      currency: 'CNY',
      base_currency: 'CNY',
      amount: '800',
    });
    expect(item.trade_node).toBe('EXPORT_CLEARANCE');
    expect(item.cost_category).toBe('EXPORT_CLEARANCE');
    expect(item.is_custom).toBe(false);
  });

  it('生成的费用项可直接参与计价', () => {
    const item = presetToCostItem(preset('thc-origin'), {
      cost_id: 'c1',
      currency: 'CNY',
      base_currency: 'CNY',
      quantity: '2',
      rate: '950',
    });
    expect(item.unit).toBe('TEU');
    expect(toStorage(computeGrossAmount(item, { resolveBase: () => '0' }))).toBe('1900.000000');
  });

  it('滞箱费预设按天计费，并提示填写发生原因', () => {
    const item = presetToCostItem(preset('demurrage'), {
      cost_id: 'c1',
      currency: 'CNY',
      base_currency: 'CNY',
      days: '5',
      rate: '120',
    });
    expect(item.pricing_method).toBe('PER_DAY');
    expect(toStorage(computeGrossAmount(item, { resolveBase: () => '0' }))).toBe('600.000000');
    expect(preset('demurrage').hint).toContain('发生原因');
  });

  it('全包海运费预设带着"已含港杂费"标记', () => {
    const item = presetToCostItem(preset('ocean-freight-all-in'), {
      cost_id: 'c1',
      currency: 'CNY',
      base_currency: 'CNY',
      amount: '10000',
    });
    expect(item.includes_port_charges).toBe(true);
  });

  it('字典里没有的费用可以自由录入，节点与类别由用户指定', () => {
    const item = customCostItem({
      cost_id: 'c1',
      cost_name: '目的港卸货附加费（超重）',
      cost_category: 'DESTINATION_TERMINAL',
      trade_node: 'DESTINATION_TERMINAL',
      currency: 'CNY',
      base_currency: 'CNY',
      amount: '1500',
    });
    expect(item.is_custom).toBe(true);
    expect(item.cost_name).toBe('目的港卸货附加费（超重）');

    const decision = resolveItemResponsibility(item, {
      trade: makeTrade({ items: [item] }),
      scenario: makeScenario({ incoterm: 'FOB' }),
      ruleSet: INCOTERMS_2020_RULESET,
    });
    expect(decision.responsibility).toBe('BUYER');
    expect(decision.source).toBe('INCOTERM_RULE');
  });
});

describe('发生原因（过错责任）优先于术语的费用划分', () => {
  function decide(reason: 'SELLER_FAULT' | 'BUYER_FAULT' | 'CARRIER_FAULT' | undefined, incoterm: 'FOB' | 'DDP' = 'FOB') {
    const item = customCostItem({
      cost_id: 'demurrage',
      cost_name: '目的港滞箱费',
      cost_category: 'DESTINATION_TERMINAL',
      trade_node: 'DESTINATION_TERMINAL',
      currency: 'CNY',
      base_currency: 'CNY',
      amount: '3000',
      ...(reason !== undefined ? { occurrence_reason: reason } : {}),
    });
    return resolveItemResponsibility(item, {
      trade: makeTrade({ items: [item] }),
      scenario: makeScenario({ incoterm }),
      ruleSet: INCOTERMS_2020_RULESET,
    });
  }

  it('未填原因时按术语判定：FOB 下目的港费用归买方', () => {
    const decision = decide(undefined);
    expect(decision.responsibility).toBe('BUYER');
    expect(decision.source).toBe('INCOTERM_RULE');
  });

  it('因卖方原因产生时改归卖方，即使术语下该节点默认归买方', () => {
    const decision = decide('SELLER_FAULT');
    expect(decision.responsibility).toBe('SELLER');
    expect(decision.source).toBe('OCCURRENCE_REASON');
    expect(decision.rule_id).toBe('RR.SELLER_FAULT');
    expect(decision.note).toContain('不因贸易术语而改变');
  });

  it('因买方原因产生时归买方，即便在 DDP 下卖方义务延伸到目的地', () => {
    const decision = decide('BUYER_FAULT', 'DDP');
    expect(decision.responsibility).toBe('BUYER');
    expect(decision.source).toBe('OCCURRENCE_REASON');
  });

  it('承运人原因不改变归属，先按术语垫付，由引擎提示可索赔', () => {
    const decision = decide('CARRIER_FAULT');
    expect(decision.responsibility).toBe('BUYER');
    expect(decision.source).toBe('INCOTERM_RULE');

    const trade = makeTrade({
      items: [
        customCostItem({
          cost_id: 'cou',
          cost_name: '甩柜导致的仓储费',
          cost_category: 'DESTINATION_TERMINAL',
          trade_node: 'DESTINATION_TERMINAL',
          currency: 'CNY',
          base_currency: 'CNY',
          amount: '3000',
          occurrence_reason: 'CARRIER_FAULT',
        }),
      ],
    });
    const result = analyze({
      trade,
      scenario: makeScenario({ incoterm: 'FOB', quote: { amount: '0', currency: 'CNY', incoterm: 'FOB', included_cost_ids: [] } }),
      taxProfile: TEST_TAX_PROFILE,
      fxBooks: [],
    });
    expect(result.warnings.map((warning) => warning.code)).toContain('CARRIER_FAULT_CLAIMABLE');
  });
});
