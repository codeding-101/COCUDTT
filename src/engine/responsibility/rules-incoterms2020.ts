import { TRADE_NODES, type CostCategory, type Incoterm, type Responsibility, type TradeNode } from '../../domain/enums.js';
import type {
  Condition,
  CostResponsibilityRule,
  IncotermRule,
  IncotermsRuleSet,
  NodeFallback,
  ReasonRule,
} from '../../domain/rule.js';

interface RuleSpec {
  id: string;
  incoterm: Incoterm;
  node?: TradeNode;
  category?: CostCategory;
  when?: Condition[];
  resp: Responsibility;
  note: string;
}

function r(spec: RuleSpec): IncotermRule {
  const rule: IncotermRule = {
    id: spec.id,
    incoterm: spec.incoterm,
    conditions: spec.when ?? [],
    responsibility: spec.resp,
    note: spec.note,
  };
  if (spec.node !== undefined) rule.trade_node = spec.node;
  if (spec.category !== undefined) rule.cost_category = spec.category;
  return rule;
}

/** 为全部 11 个节点生成同一条规则，作为该术语的兜底 */
function allNodes(incoterm: Incoterm, resp: Responsibility, note: string): IncotermRule[] {
  return TRADE_NODES.map((node) => ({
    id: `${incoterm}.${node}`,
    incoterm,
    trade_node: node,
    conditions: [],
    responsibility: resp,
    note,
  }));
}

const EXW: IncotermRule[] = [
  r({
    id: 'EXW.SELLER_PREMISES.GOODS',
    incoterm: 'EXW',
    node: 'SELLER_PREMISES',
    category: 'GOODS_AND_PACKING',
    resp: 'SELLER',
    note: '卖方在其场所备货、包装完毕，并将货物置于买方处置之下（Incoterms 2020 A2）',
  }),
  r({
    id: 'EXW.SELLER_PREMISES.LOADING',
    incoterm: 'EXW',
    node: 'SELLER_PREMISES',
    resp: 'BUYER',
    note: 'EXW 下货物在卖方场所未装货即完成交付，装车及此后一切作业由买方负担；若合同约定卖方负责装车，请使用责任覆盖——这是 EXW 最常见的偏离',
  }),
  r({
    id: 'EXW.EXPORT_CLEARANCE',
    incoterm: 'EXW',
    node: 'EXPORT_CLEARANCE',
    resp: 'BUYER',
    note: 'EXW 下出口清关手续由买方办理（A7/B7），这是实务中最易出错的一点；若由卖方代办，请使用责任覆盖',
  }),
  r({
    id: 'EXW.INSURANCE',
    incoterm: 'EXW',
    category: 'INSURANCE',
    resp: 'BUYER',
    note: 'EXW 下卖方无投保义务',
  }),
  ...allNodes('EXW', 'BUYER', 'EXW：卖方在卖方场所完成交付后，全部费用由买方负担'),
];

const FCA: IncotermRule[] = [
  r({
    id: 'FCA.SELLER_PREMISES.GOODS',
    incoterm: 'FCA',
    node: 'SELLER_PREMISES',
    category: 'GOODS_AND_PACKING',
    resp: 'SELLER',
    note: '卖方备货、包装完毕并负责装上买方指定的运输工具',
  }),
  r({
    id: 'FCA.SELLER_PREMISES.SELLER_PLACE',
    incoterm: 'FCA',
    node: 'SELLER_PREMISES',
    when: [{ kind: 'DELIVERY_PLACE', is: 'SELLER_PREMISES' }],
    resp: 'SELLER',
    note: '交货地点为卖方场所时，装货完成即完成交货，装货费用由卖方负担（Incoterms 2020 A2）',
  }),
  r({
    id: 'FCA.SELLER_PREMISES.DEFAULT',
    incoterm: 'FCA',
    node: 'SELLER_PREMISES',
    resp: 'SELLER',
    note: '卖方在场所内完成备货与装车，货物装上买方指定承运人的运输工具',
  }),
  r({
    id: 'FCA.INLAND_TRANSPORT',
    incoterm: 'FCA',
    node: 'INLAND_TRANSPORT',
    resp: 'SELLER',
    note: '卖方负责将货物运至指定交货地点（交货地点为卖方场所时由买方承运）',
  }),
  r({
    id: 'FCA.EXPORT_CLEARANCE',
    incoterm: 'FCA',
    node: 'EXPORT_CLEARANCE',
    resp: 'SELLER',
    note: 'FCA 下出口清关由卖方办理（与 EXW 的关键差别）',
  }),
  r({
    id: 'FCA.CARRIER_HANDOVER.OTHER_PLACE',
    incoterm: 'FCA',
    node: 'CARRIER_HANDOVER',
    when: [{ kind: 'DELIVERY_PLACE', is: 'OTHER' }],
    resp: 'BUYER',
    note: '交货地点非卖方场所时，卖方将货物运至该地点、在其运输工具上未卸货即完成交货，卸货及之后的费用由买方负担',
  }),
  r({
    id: 'FCA.CARRIER_HANDOVER.SELLER_PLACE',
    incoterm: 'FCA',
    node: 'CARRIER_HANDOVER',
    when: [{ kind: 'DELIVERY_PLACE', is: 'SELLER_PREMISES' }],
    resp: 'SELLER',
    note: '交货地点为卖方场所时，货物装上买方指定承运人的运输工具即完成交货，装货费用由卖方负担（Incoterms 2020 A2）',
  }),
  r({
    id: 'FCA.CARRIER_HANDOVER.DEFAULT',
    incoterm: 'FCA',
    node: 'CARRIER_HANDOVER',
    resp: 'CONDITIONAL',
    note: 'FCA 下交货地点的装货或卸货责任取决于指定交货地点是卖方场所还是其他地点：卖方场所交货时装货归卖方，其他地点交货时卸货归买方。请补充方案事实中的交货地点后重新计算',
  }),
  r({
    id: 'FCA.INSURANCE',
    incoterm: 'FCA',
    category: 'INSURANCE',
    resp: 'BUYER',
    note: 'FCA 下卖方无投保义务',
  }),
  ...allNodes('FCA', 'BUYER', 'FCA：货物交给买方指定承运人之后，费用由买方负担'),
];

const FAS: IncotermRule[] = [
  r({
    id: 'FAS.SELLER_PREMISES',
    incoterm: 'FAS',
    node: 'SELLER_PREMISES',
    resp: 'SELLER',
    note: '卖方备货、包装完毕',
  }),
  r({
    id: 'FAS.INLAND_TRANSPORT',
    incoterm: 'FAS',
    node: 'INLAND_TRANSPORT',
    resp: 'SELLER',
    note: '卖方负责将货物运至指定装运港',
  }),
  r({
    id: 'FAS.EXPORT_CLEARANCE',
    incoterm: 'FAS',
    node: 'EXPORT_CLEARANCE',
    resp: 'SELLER',
    note: 'FAS 下出口清关由卖方办理',
  }),
  r({
    id: 'FAS.ORIGIN_TERMINAL',
    incoterm: 'FAS',
    node: 'ORIGIN_TERMINAL',
    resp: 'SELLER',
    note: '卖方负责将货物运至指定装运港船边（码头或驳船），船边之前的费用由卖方负担',
  }),
  r({
    id: 'FAS.CARRIER_HANDOVER',
    incoterm: 'FAS',
    node: 'CARRIER_HANDOVER',
    resp: 'BUYER',
    note: 'FAS 下卖方在船边完成交货，装船及之后的费用（含装船费）由买方负担',
  }),
  r({
    id: 'FAS.INSURANCE',
    incoterm: 'FAS',
    category: 'INSURANCE',
    resp: 'BUYER',
    note: 'FAS 下卖方无投保义务',
  }),
  ...allNodes('FAS', 'BUYER', 'FAS：卖方在装运港船边完成交货，之后的费用由买方负担（仅适用海运及内河运输）'),
];

const FOB: IncotermRule[] = [
  r({
    id: 'FOB.SELLER_PREMISES',
    incoterm: 'FOB',
    node: 'SELLER_PREMISES',
    resp: 'SELLER',
    note: '卖方备货、包装完毕',
  }),
  r({
    id: 'FOB.INLAND_TRANSPORT',
    incoterm: 'FOB',
    node: 'INLAND_TRANSPORT',
    resp: 'SELLER',
    note: '卖方负责将货物运至指定装运港',
  }),
  r({
    id: 'FOB.EXPORT_CLEARANCE',
    incoterm: 'FOB',
    node: 'EXPORT_CLEARANCE',
    resp: 'SELLER',
    note: 'FOB 下出口清关由卖方办理',
  }),
  r({
    id: 'FOB.ORIGIN_TERMINAL',
    incoterm: 'FOB',
    node: 'ORIGIN_TERMINAL',
    resp: 'SELLER',
    note: '装运港装船之前的费用由卖方负担',
  }),
  r({
    id: 'FOB.ORIGIN_TERMINAL.LINER',
    incoterm: 'FOB',
    node: 'ORIGIN_TERMINAL',
    when: [{ kind: 'SHIPPING_TERMS', is: 'LINER' }],
    resp: 'BUYER',
    note: 'FOB 班轮条件下起运港港杂费（THC）通常已含在运费中，由买方负担',
  }),
  r({
    id: 'FOB.CARRIER_HANDOVER.DEFAULT',
    incoterm: 'FOB',
    node: 'CARRIER_HANDOVER',
    resp: 'SELLER',
    note: 'FOB 基本含义下卖方负责将货物装上船；若采用班轮条件或吊钩下交货，装船费转由买方负担',
  }),
  r({
    id: 'FOB.CARRIER_HANDOVER.LINER',
    incoterm: 'FOB',
    node: 'CARRIER_HANDOVER',
    when: [{ kind: 'SHIPPING_TERMS', is: 'LINER' }],
    resp: 'BUYER',
    note: 'FOB 班轮条件（Liner Terms）：卖方不负担装船费用，装船费已含在运费中',
  }),
  r({
    id: 'FOB.CARRIER_HANDOVER.UNDER_TACKLE',
    incoterm: 'FOB',
    node: 'CARRIER_HANDOVER',
    when: [{ kind: 'SHIPPING_TERMS', is: 'UNDER_TACKLE' }],
    resp: 'BUYER',
    note: 'FOB 吊钩下交货（Under Tackle）：卖方将货物交至船边吊钩所及之处，装船费由买方负担',
  }),
  r({
    id: 'FOB.CARRIER_HANDOVER.STOWED',
    incoterm: 'FOB',
    node: 'CARRIER_HANDOVER',
    when: [{ kind: 'SHIPPING_TERMS', is: 'STOWED' }],
    resp: 'SELLER',
    note: 'FOB 理舱费在内（Stowed）：卖方负担装船费与理舱费',
  }),
  r({
    id: 'FOB.CARRIER_HANDOVER.TRIMMED',
    incoterm: 'FOB',
    node: 'CARRIER_HANDOVER',
    when: [{ kind: 'SHIPPING_TERMS', is: 'TRIMMED' }],
    resp: 'SELLER',
    note: 'FOB 平舱费在内（Trimmed）：卖方负担装船费与平舱费',
  }),
  r({
    id: 'FOB.CARRIER_HANDOVER.STOWED_TRIMMED',
    incoterm: 'FOB',
    node: 'CARRIER_HANDOVER',
    when: [{ kind: 'SHIPPING_TERMS', is: 'STOWED_TRIMMED' }],
    resp: 'SELLER',
    note: 'FOBST：卖方负担装船费、理舱费与平舱费',
  }),
  r({
    id: 'FOB.CARRIER_HANDOVER.BULK',
    incoterm: 'FOB',
    node: 'CARRIER_HANDOVER',
    when: [{ kind: 'SHIPPING_TERMS', is: 'BULK' }],
    resp: 'SELLER',
    note: '散货 FOB：卖方负责装船',
  }),
  r({
    id: 'FOB.INSURANCE',
    incoterm: 'FOB',
    category: 'INSURANCE',
    resp: 'BUYER',
    note: 'FOB 下卖方无投保义务',
  }),
  ...allNodes('FOB', 'BUYER', 'FOB：货物装上船之后，费用由买方负担（仅适用海运及内河运输）'),
];

/** CFR 与 CIF 的主运费与卸货费规则相同，仅保险不同 */
function cfrLike(incoterm: 'CFR' | 'CIF'): IncotermRule[] {
  return [
    r({
      id: `${incoterm}.SELLER_PREMISES`,
      incoterm,
      node: 'SELLER_PREMISES',
      resp: 'SELLER',
      note: '卖方备货、包装完毕',
    }),
    r({
      id: `${incoterm}.INLAND_TRANSPORT`,
      incoterm,
      node: 'INLAND_TRANSPORT',
      resp: 'SELLER',
      note: '卖方负责将货物运至指定装运港',
    }),
    r({
      id: `${incoterm}.EXPORT_CLEARANCE`,
      incoterm,
      node: 'EXPORT_CLEARANCE',
      resp: 'SELLER',
      note: `${incoterm} 下出口清关由卖方办理`,
    }),
    r({
      id: `${incoterm}.ORIGIN_TERMINAL`,
      incoterm,
      node: 'ORIGIN_TERMINAL',
      resp: 'SELLER',
      note: '装运港装船之前的费用由卖方负担',
    }),
    r({
      id: `${incoterm}.CARRIER_HANDOVER`,
      incoterm,
      node: 'CARRIER_HANDOVER',
      resp: 'SELLER',
      note: `${incoterm} 下卖方负责将货物装上船，装船费由卖方负担（与 FOB 不同，运费由卖方支付）`,
    }),
    r({
      id: `${incoterm}.MAIN_CARRIAGE`,
      incoterm,
      node: 'MAIN_CARRIAGE',
      resp: 'SELLER',
      note: `${incoterm} 下卖方须自付费用订立运输合同，将货物运至指定目的港`,
    }),
    r({
      id: `${incoterm}.DESTINATION_TERMINAL`,
      incoterm,
      node: 'DESTINATION_TERMINAL',
      resp: 'BUYER',
      note: `${incoterm} 下卖方无卸货义务，目的港卸货费默认由买方负担`,
    }),
    r({
      id: `${incoterm}.DESTINATION_TERMINAL.LINER`,
      incoterm,
      node: 'DESTINATION_TERMINAL',
      when: [{ kind: 'SHIPPING_TERMS', is: 'LINER' }],
      resp: 'SELLER',
      note: `${incoterm} 班轮条件（Liner Terms）：卸货费已含在运费中，由卖方负担`,
    }),
    r({
      id: `${incoterm}.DESTINATION_TERMINAL.EX_SHIP_HOLD`,
      incoterm,
      node: 'DESTINATION_TERMINAL',
      when: [{ kind: 'SHIPPING_TERMS', is: 'EX_SHIP_HOLD' }],
      resp: 'BUYER',
      note: `${incoterm} 舱底交货（Ex Ship's Hold）：卖方将货物运至目的港舱底，买方负担卸货费`,
    }),
    r({
      id: `${incoterm}.DESTINATION_TRANSPORT`,
      incoterm,
      node: 'DESTINATION_TRANSPORT',
      resp: 'BUYER',
      note: '目的港之后的运输由买方安排',
    }),
    r({
      id: `${incoterm}.IMPORT_CLEARANCE`,
      incoterm,
      node: 'IMPORT_CLEARANCE',
      resp: 'BUYER',
      note: `${incoterm} 下进口清关由买方办理`,
    }),
    r({
      id: `${incoterm}.IMPORT_DUTIES`,
      incoterm,
      node: 'IMPORT_DUTIES',
      resp: 'BUYER',
      note: `${incoterm} 下进口关税及税费由买方承担`,
    }),
    r({
      id: `${incoterm}.FINAL_DELIVERY`,
      incoterm,
      node: 'FINAL_DELIVERY',
      resp: 'BUYER',
      note: '最终交付与卸货由买方负责',
    }),
    ...allNodes(incoterm, 'BUYER', `${incoterm}：目的港之后的费用由买方负担（仅适用海运及内河运输）`),
  ];
}

const CFR: IncotermRule[] = [
  r({
    id: 'CFR.INSURANCE',
    incoterm: 'CFR',
    category: 'INSURANCE',
    resp: 'BUYER',
    note: 'CFR 下卖方无投保义务，保险由买方自行安排',
  }),
  ...cfrLike('CFR'),
];

const CIF: IncotermRule[] = [
  r({
    id: 'CIF.INSURANCE',
    incoterm: 'CIF',
    category: 'INSURANCE',
    resp: 'SELLER',
    note: 'CIF 下卖方须自付费用投保，最低险别为协会货物条款(C)，保额不低于合同价 110%',
  }),
  ...cfrLike('CIF'),
];

/** CPT 与 CIP 的费用划分相同，仅保险不同 */
function cptLike(incoterm: 'CPT' | 'CIP'): IncotermRule[] {
  const deliveryNote = `${incoterm} 下卖方须承运至指定目的地，目的地之前的费用由卖方承担`;
  return [
    r({
      id: `${incoterm}.SELLER_PREMISES`,
      incoterm,
      node: 'SELLER_PREMISES',
      resp: 'SELLER',
      note: '卖方备货、包装完毕',
    }),
    r({
      id: `${incoterm}.INLAND_TRANSPORT`,
      incoterm,
      node: 'INLAND_TRANSPORT',
      resp: 'SELLER',
      note: '卖方负责将货物运至约定交货地点并交给承运人',
    }),
    r({
      id: `${incoterm}.EXPORT_CLEARANCE`,
      incoterm,
      node: 'EXPORT_CLEARANCE',
      resp: 'SELLER',
      note: `${incoterm} 下出口清关由卖方办理`,
    }),
    r({
      id: `${incoterm}.ORIGIN_TERMINAL`,
      incoterm,
      node: 'ORIGIN_TERMINAL',
      resp: 'SELLER',
      note: '交货之前的起运地费用由卖方负担',
    }),
    r({
      id: `${incoterm}.CARRIER_HANDOVER`,
      incoterm,
      node: 'CARRIER_HANDOVER',
      resp: 'SELLER',
      note: `${incoterm} 下风险在货物交给承运人时即转移给买方，但此处费用仍由卖方承担——这是风险与费用分离的典型情形`,
    }),
    r({
      id: `${incoterm}.MAIN_CARRIAGE`,
      incoterm,
      node: 'MAIN_CARRIAGE',
      resp: 'SELLER',
      note: `${incoterm} 下卖方须自付费用订立运输合同，将货物运至指定目的地（风险已转移，费用未转移）`,
    }),
    r({
      id: `${incoterm}.DESTINATION_TERMINAL`,
      incoterm,
      node: 'DESTINATION_TERMINAL',
      resp: 'SELLER',
      note: deliveryNote,
    }),
    r({
      id: `${incoterm}.DESTINATION_TRANSPORT`,
      incoterm,
      node: 'DESTINATION_TRANSPORT',
      resp: 'SELLER',
      note: `${incoterm} 下卖方须承运至指定目的地；若指定目的地为目的港，此段实际由买方发生，请使用责任覆盖`,
    }),
    r({
      id: `${incoterm}.FINAL_DELIVERY`,
      incoterm,
      node: 'FINAL_DELIVERY',
      resp: 'BUYER',
      note: `${incoterm} 下卖方无卸货义务，卸货费用除合同另有约定外由买方负担`,
    }),
    r({
      id: `${incoterm}.IMPORT_CLEARANCE`,
      incoterm,
      node: 'IMPORT_CLEARANCE',
      resp: 'BUYER',
      note: `${incoterm} 下进口清关由买方办理`,
    }),
    r({
      id: `${incoterm}.IMPORT_DUTIES`,
      incoterm,
      node: 'IMPORT_DUTIES',
      resp: 'BUYER',
      note: `${incoterm} 下进口关税及税费由买方承担`,
    }),
    ...allNodes(incoterm, 'BUYER', `${incoterm}：指定目的地交货之后的费用由买方负担`),
  ];
}

const CPT: IncotermRule[] = [
  r({
    id: 'CPT.INSURANCE',
    incoterm: 'CPT',
    category: 'INSURANCE',
    resp: 'BUYER',
    note: 'CPT 下卖方无投保义务，保险由买方自行安排',
  }),
  ...cptLike('CPT'),
];

const CIP: IncotermRule[] = [
  r({
    id: 'CIP.INSURANCE',
    incoterm: 'CIP',
    category: 'INSURANCE',
    resp: 'SELLER',
    note: 'CIP 2020 起卖方须投保协会货物条款(A)或类似一切险，保额不低于合同价 110%（比 CIF 要求更高）',
  }),
  ...cptLike('CIP'),
];

/** DAP 与 DPU 的费用划分仅差"目的地卸货"一项 */
function deliveredLike(incoterm: 'DAP' | 'DPU'): IncotermRule[] {
  return TRADE_NODES.map((node) => {
    if (node === 'IMPORT_CLEARANCE') {
      return r({
        id: `${incoterm}.IMPORT_CLEARANCE`,
        incoterm,
        node,
        resp: 'BUYER',
        note: `${incoterm} 下进口清关由买方办理`,
      });
    }
    if (node === 'IMPORT_DUTIES') {
      return r({
        id: `${incoterm}.IMPORT_DUTIES`,
        incoterm,
        node,
        resp: 'BUYER',
        note: `${incoterm} 下进口关税及税费由买方承担`,
      });
    }
    if (node === 'FINAL_DELIVERY') {
      return incoterm === 'DPU'
        ? r({
            id: 'DPU.FINAL_DELIVERY',
            incoterm,
            node,
            resp: 'SELLER',
            note: 'DPU 是 11 个术语中唯一要求卖方在目的地卸货的术语（2020 版由 DAT 更名而来）',
          })
        : r({
            id: 'DAP.FINAL_DELIVERY',
            incoterm,
            node,
            resp: 'BUYER',
            note: 'DAP 下卖方在目的地将货物置于买方处置之下、尚未卸货，卸货费用由买方负担',
          });
    }
    return r({
      id: `${incoterm}.${node}`,
      incoterm,
      node,
      resp: 'SELLER',
      note: `${incoterm} 下卖方须将货物运至指定目的地，此前的费用由卖方承担`,
    });
  });
}

const DAP_DPU_EXTRA: IncotermRule[] = [
  r({
    id: 'DAP.INSURANCE',
    incoterm: 'DAP',
    category: 'INSURANCE',
    resp: 'SELLER',
    note: 'DAP 下卖方无强制投保义务，但风险至目的地才转移，保险费通常由卖方负担',
  }),
  r({
    id: 'DPU.INSURANCE',
    incoterm: 'DPU',
    category: 'INSURANCE',
    resp: 'SELLER',
    note: 'DPU 下卖方无强制投保义务，但风险至目的地卸货完成才转移，保险费通常由卖方负担',
  }),
];

/** 把交货类术语的保险规则放在最前，其余节点规则紧随其后 */
function withInsuranceFirst(incoterm: 'DAP' | 'DPU'): IncotermRule[] {
  const insurance = DAP_DPU_EXTRA.filter((rule) => rule.incoterm === incoterm);
  return [...insurance, ...deliveredLike(incoterm)];
}

const DDP: IncotermRule[] = [
  r({
    id: 'DDP.IMPORT_CLEARANCE',
    incoterm: 'DDP',
    node: 'IMPORT_CLEARANCE',
    resp: 'SELLER',
    note: 'DDP 下进口清关由卖方办理；部分国家实操上卖方难以作为进口方，需确认可行性',
  }),
  r({
    id: 'DDP.IMPORT_DUTIES',
    incoterm: 'DDP',
    node: 'IMPORT_DUTIES',
    resp: 'SELLER',
    note: 'DDP 下进口关税及税费由卖方承担，这是 11 个术语中卖方义务最重的一个',
  }),
  r({
    id: 'DDP.FINAL_DELIVERY',
    incoterm: 'DDP',
    node: 'FINAL_DELIVERY',
    resp: 'BUYER',
    note: 'DDP 下卖方在目的地将货物置于买方处置之下、尚未卸货，卸货费用由买方负担',
  }),
  r({
    id: 'DDP.INSURANCE',
    incoterm: 'DDP',
    category: 'INSURANCE',
    resp: 'SELLER',
    note: 'DDP 下卖方无强制投保义务，但风险至目的地才转移，保险费通常由卖方负担',
  }),
  ...allNodes('DDP', 'SELLER', 'DDP：卖方承担至指定目的地的全部费用'),
];

/**
 * 发生原因规则（过错责任）。只列确有倾向的情形：因某一方自身原因产生的费用由该方承担，
 * 不因贸易术语而改变——即便术语是 FOB，因卖方单证错误导致的目的港滞箱费仍归卖方。
 *
 * 承运人原因与不可抗力**故意不列**：这类费用应先按术语归属（谁承担该段谁先垫），
 * 再由垫付方向承运人索赔或另行协商，引擎用告警提示可索赔，而不是替用户决定。
 * 海关查验与法定检验检疫同样不列：归属取决于查验发生在哪一侧的清关，由节点规则处理。
 */
const REASON_RULES: ReasonRule[] = [
  {
    id: 'RR.SELLER_FAULT',
    reason: 'SELLER_FAULT',
    responsibility: 'SELLER',
    note: '因卖方原因产生的费用（单证错误、包装不合格、迟延交货、申报不实等）由卖方承担，不因贸易术语而改变',
  },
  {
    id: 'RR.BUYER_FAULT',
    reason: 'BUYER_FAULT',
    responsibility: 'BUYER',
    note: '因买方原因产生的费用（未及时提货、未及时开证或付款、指定货代迟延等）由买方承担，不因贸易术语而改变',
  },
];

/**
 * 规则表未覆盖的事实兜底（设计文档 6.2 第 3 级）。
 * 这一层的存在意义是处理"术语规则太粗、而事实明确"的情形。
 */
const SPECIAL_FACTS: CostResponsibilityRule[] = [
  {
    id: 'SF.EXPORT_CLEARANCE.SELLER_ACTS_FOR_BUYER',
    trade_node: 'EXPORT_CLEARANCE',
    conditions: [{ kind: 'CLEARANCE_AGENT', is: 'SELLER_ACTS_FOR_BUYER' }],
    responsibility: 'SELLER',
    note: '方案事实表明卖方代买方办理出口清关，该费用与手续由卖方承担（EXW 下最常见的实务安排）',
  },
  {
    id: 'SF.ORIGIN_TERMINAL.FCL',
    trade_node: 'ORIGIN_TERMINAL',
    conditions: [{ kind: 'LOADING_MODE', is: 'FCL' }],
    responsibility: 'CONDITIONAL',
    note: '整箱（FCL）下起运港费用通常已并入运费报价，归属取决于主运输合同由谁订立，请确认是否重复计费',
  },
];

/** 贸易节点兜底：该术语下默认由卖方承担的节点（设计文档 6.2 第 4 级） */
const NODE_FALLBACKS: NodeFallback[] = [
  { incoterm: 'EXW', seller_nodes: ['SELLER_PREMISES'] },
  { incoterm: 'FCA', seller_nodes: ['SELLER_PREMISES', 'INLAND_TRANSPORT', 'EXPORT_CLEARANCE'] },
  { incoterm: 'FAS', seller_nodes: ['SELLER_PREMISES', 'INLAND_TRANSPORT', 'EXPORT_CLEARANCE', 'ORIGIN_TERMINAL'] },
  {
    incoterm: 'FOB',
    seller_nodes: ['SELLER_PREMISES', 'INLAND_TRANSPORT', 'EXPORT_CLEARANCE', 'ORIGIN_TERMINAL', 'CARRIER_HANDOVER'],
  },
  {
    incoterm: 'CFR',
    seller_nodes: [
      'SELLER_PREMISES',
      'INLAND_TRANSPORT',
      'EXPORT_CLEARANCE',
      'ORIGIN_TERMINAL',
      'CARRIER_HANDOVER',
      'MAIN_CARRIAGE',
    ],
  },
  {
    incoterm: 'CIF',
    seller_nodes: [
      'SELLER_PREMISES',
      'INLAND_TRANSPORT',
      'EXPORT_CLEARANCE',
      'ORIGIN_TERMINAL',
      'CARRIER_HANDOVER',
      'MAIN_CARRIAGE',
    ],
  },
  {
    incoterm: 'CPT',
    seller_nodes: [
      'SELLER_PREMISES',
      'INLAND_TRANSPORT',
      'EXPORT_CLEARANCE',
      'ORIGIN_TERMINAL',
      'CARRIER_HANDOVER',
      'MAIN_CARRIAGE',
      'DESTINATION_TERMINAL',
      'DESTINATION_TRANSPORT',
    ],
  },
  {
    incoterm: 'CIP',
    seller_nodes: [
      'SELLER_PREMISES',
      'INLAND_TRANSPORT',
      'EXPORT_CLEARANCE',
      'ORIGIN_TERMINAL',
      'CARRIER_HANDOVER',
      'MAIN_CARRIAGE',
      'DESTINATION_TERMINAL',
      'DESTINATION_TRANSPORT',
    ],
  },
  {
    incoterm: 'DAP',
    seller_nodes: [
      'SELLER_PREMISES',
      'INLAND_TRANSPORT',
      'EXPORT_CLEARANCE',
      'ORIGIN_TERMINAL',
      'CARRIER_HANDOVER',
      'MAIN_CARRIAGE',
      'DESTINATION_TERMINAL',
      'DESTINATION_TRANSPORT',
    ],
  },
  {
    incoterm: 'DPU',
    seller_nodes: [
      'SELLER_PREMISES',
      'INLAND_TRANSPORT',
      'EXPORT_CLEARANCE',
      'ORIGIN_TERMINAL',
      'CARRIER_HANDOVER',
      'MAIN_CARRIAGE',
      'DESTINATION_TERMINAL',
      'DESTINATION_TRANSPORT',
      'FINAL_DELIVERY',
    ],
  },
  {
    incoterm: 'DDP',
    seller_nodes: [
      'SELLER_PREMISES',
      'INLAND_TRANSPORT',
      'EXPORT_CLEARANCE',
      'ORIGIN_TERMINAL',
      'CARRIER_HANDOVER',
      'MAIN_CARRIAGE',
      'DESTINATION_TERMINAL',
      'IMPORT_CLEARANCE',
      'IMPORT_DUTIES',
      'DESTINATION_TRANSPORT',
    ],
  },
];

/** Incoterms 2020 规则表（种子数据）。规则顺序不影响判定结果，优先级由 specificity 决定。 */
export const INCOTERMS_2020_RULESET: IncotermsRuleSet = {
  id: 'incoterms2020',
  version: '1.0',
  rules: [
    ...EXW,
    ...FCA,
    ...FAS,
    ...FOB,
    ...CFR,
    ...CIF,
    ...CPT,
    ...CIP,
    ...withInsuranceFirst('DAP'),
    ...withInsuranceFirst('DPU'),
    ...DDP,
  ],
  special_facts: SPECIAL_FACTS,
  reason_rules: REASON_RULES,
  node_fallbacks: NODE_FALLBACKS,
};
