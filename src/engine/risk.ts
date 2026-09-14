import { TRADE_NODES, type Incoterm, type RiskRelation, type TradeNode } from '../domain/enums.js';
import type { CostItem } from '../domain/cost-item.js';

const NODE_ORDER: Record<TradeNode, number> = TRADE_NODES.reduce(
  (acc, node, index) => {
    acc[node] = index;
    return acc;
  },
  {} as Record<TradeNode, number>,
);

export interface RiskRule {
  incoterm: Incoterm;
  /** 风险转移点描述，展示给用户 */
  transfer_point: string;
  transfer_node: TradeNode;
  /**
   * 风险转移后费用仍由卖方承担。CFR / CIF / CPT / CIP 四个术语成立，
   * 这也是"风险与费用必须分开看"的直接体现。
   */
  cost_risk_separated: boolean;
  separation_note: string | null;
}

export interface RiskResult {
  incoterm: Incoterm;
  transfer_point: string;
  transfer_node: TradeNode;
  separation: boolean;
  separation_note: string | null;
}

const FREIGHT_SEPARATION_NOTE =
  '风险在装运港装船时即转移给买方，但卖方仍须支付主运费（CIF 另含保险费）至指定目的港——风险与费用在此分离';
const CARRIAGE_SEPARATION_NOTE =
  '风险在货物交给承运人时即转移给买方，但卖方仍须支付运费（CIP 另含保险费）至指定目的地——风险与费用在此分离';

/** Incoterms 2020 风险转移表（设计文档第 7 节） */
export const INCOTERMS_2020_RISK: RiskRule[] = [
  {
    incoterm: 'EXW',
    transfer_point: '卖方在其场所将货物置于买方处置之下、尚未装货时',
    transfer_node: 'SELLER_PREMISES',
    cost_risk_separated: false,
    separation_note: null,
  },
  {
    incoterm: 'FCA',
    transfer_point: '卖方将货物交给买方指定的承运人时',
    transfer_node: 'CARRIER_HANDOVER',
    cost_risk_separated: false,
    separation_note: null,
  },
  {
    incoterm: 'FAS',
    transfer_point: '卖方将货物置于指定装运港船边时',
    transfer_node: 'ORIGIN_TERMINAL',
    cost_risk_separated: false,
    separation_note: null,
  },
  {
    incoterm: 'FOB',
    transfer_point: '货物在指定装运港装上船时',
    transfer_node: 'CARRIER_HANDOVER',
    cost_risk_separated: false,
    separation_note: null,
  },
  {
    incoterm: 'CFR',
    transfer_point: '货物在指定装运港装上船时',
    transfer_node: 'CARRIER_HANDOVER',
    cost_risk_separated: true,
    separation_note: FREIGHT_SEPARATION_NOTE,
  },
  {
    incoterm: 'CIF',
    transfer_point: '货物在指定装运港装上船时',
    transfer_node: 'CARRIER_HANDOVER',
    cost_risk_separated: true,
    separation_note: FREIGHT_SEPARATION_NOTE,
  },
  {
    incoterm: 'CPT',
    transfer_point: '卖方将货物交给承运人时',
    transfer_node: 'CARRIER_HANDOVER',
    cost_risk_separated: true,
    separation_note: CARRIAGE_SEPARATION_NOTE,
  },
  {
    incoterm: 'CIP',
    transfer_point: '卖方将货物交给承运人时',
    transfer_node: 'CARRIER_HANDOVER',
    cost_risk_separated: true,
    separation_note: CARRIAGE_SEPARATION_NOTE,
  },
  {
    incoterm: 'DAP',
    transfer_point: '卖方在指定目的地将货物置于买方处置之下、尚未卸货时',
    transfer_node: 'FINAL_DELIVERY',
    cost_risk_separated: false,
    separation_note: null,
  },
  {
    incoterm: 'DPU',
    transfer_point: '卖方在指定目的地卸货完成时',
    transfer_node: 'FINAL_DELIVERY',
    cost_risk_separated: false,
    separation_note: null,
  },
  {
    incoterm: 'DDP',
    transfer_point: '卖方在指定目的地将货物置于买方处置之下、尚未卸货时',
    transfer_node: 'FINAL_DELIVERY',
    cost_risk_separated: false,
    separation_note: null,
  },
];

export function resolveRisk(incoterm: Incoterm): RiskResult {
  const rule = INCOTERMS_2020_RISK.find((candidate) => candidate.incoterm === incoterm);
  if (rule === undefined) throw new Error(`缺少术语的风险规则: ${incoterm}`);
  return {
    incoterm: rule.incoterm,
    transfer_point: rule.transfer_point,
    transfer_node: rule.transfer_node,
    separation: rule.cost_risk_separated,
    separation_note: rule.separation_note,
  };
}

/** 交付点及其之前发生的费用视为风险转移前 */
export function riskRelationForNode(transferNode: TradeNode, node: TradeNode): RiskRelation {
  return NODE_ORDER[node] <= NODE_ORDER[transferNode] ? 'BEFORE_TRANSFER' : 'AFTER_TRANSFER';
}

/** 为每笔费用填上风险关系，不改动入参 */
export function applyRiskRelation(items: readonly CostItem[], transferNode: TradeNode): CostItem[] {
  return items.map((item) => ({ ...item, risk_relation: riskRelationForNode(transferNode, item.trade_node) }));
}

/**
 * 风险已转移给买方、但费用仍由卖方承担的费用项。
 * 这一列表是 CPT / CIP / CFR / CIF 四个术语最容易被误读的地方。
 */
export function separatedCostIds(
  items: readonly CostItem[],
  transferNode: TradeNode,
  responsibilityOf: (costId: string) => string | undefined,
): string[] {
  return items
    .filter(
      (item) =>
        riskRelationForNode(transferNode, item.trade_node) === 'AFTER_TRANSFER' &&
        responsibilityOf(item.cost_id) === 'SELLER',
    )
    .map((item) => item.cost_id);
}
