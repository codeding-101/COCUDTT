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

/** 无相对投保义务不等于某一方必付所有自愿保险；须逐笔记录合同或实际承担。 */
function voluntaryInsurance(incoterm: Incoterm): IncotermRule {
  return r({ id: `${incoterm}.INSURANCE`, incoterm, category: 'INSURANCE', resp: 'CONDITIONAL',
    note: `${incoterm}不要求任何一方向另一方订立保险合同；不能据此推定保费承担或强制购买保险。已录入保费请按实际投保/合同约定逐项确认，风险承担不自动决定全部保费归属。` });
}

const EXW: IncotermRule[] = [
  r({
    id: 'EXW.SELLER_PREMISES.GOODS',
    incoterm: 'EXW',
    node: 'SELLER_PREMISES',
    category: 'GOODS_AND_PACKING',
    resp: 'SELLER',
    note: '卖方在指定交货地点将货物置于买方处置之下并完成必要包装；指定地点不必为卖方自有场所（Incoterms 2020 A2/A8）',
  }),
  r({
    id: 'EXW.SELLER_PREMISES.LOADING',
    incoterm: 'EXW',
    node: 'SELLER_PREMISES',
    resp: 'BUYER',
    note: 'EXW在指定交货地点未装货即完成交货；收货车辆装货通常由买方承担，合同另有约定需逐项记录，装货费用覆盖不自动改变风险。指定地点不必为卖方自有场所',
  }),
  r({
    id: 'EXW.EXPORT_CLEARANCE',
    incoterm: 'EXW',
    node: 'EXPORT_CLEARANCE',
    resp: 'BUYER',
    note: 'EXW 下出口清关手续由买方办理（A7/B7），这是实务中最易出错的一点；若由卖方代办，请使用责任覆盖',
  }),
  voluntaryInsurance('EXW'),
  ...allNodes('EXW', 'BUYER', 'EXW：指定地点交货后费用原则上由买方承担；包装、合同例外及明确发生原因另核'),
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
    resp: 'CONDITIONAL',
    note: '除已明确的货物/包装外，该地点作业须先核对FCA交货地点，不能在地点缺失时认定装车义务',
  }),
  r({
    id: 'FCA.SELLER_PREMISES.OTHER_PLACE', incoterm: 'FCA', node: 'SELLER_PREMISES',
    when: [{ kind: 'DELIVERY_PLACE', is: 'OTHER' }], resp: 'SELLER',
    note: 'FCA其他指定地点交货时，卖方承担运抵该交货点前必要作业；交货点卸货另核',
  }),
  r({
    id: 'FCA.INLAND_TRANSPORT',
    incoterm: 'FCA',
    node: 'INLAND_TRANSPORT',
    when: [{ kind: 'DELIVERY_PLACE', is: 'OTHER' }],
    resp: 'SELLER',
    note: 'FCA其他指定地点交货：此项为运抵该交货点前的内陆运输，由卖方承担；交货点之后的费用须另行记录',
  }),
  r({
    id: 'FCA.INLAND_TRANSPORT.SELLER_PLACE', incoterm: 'FCA', node: 'INLAND_TRANSPORT',
    when: [{ kind: 'DELIVERY_PLACE', is: 'SELLER_PREMISES' }], resp: 'BUYER',
    note: 'FCA卖方场所交货：装上买方安排车辆后已交货，后续出口国内陆运输由买方承担；卖方代办不自动改变经济承担',
  }),
  r({
    id: 'FCA.INLAND_TRANSPORT.DEFAULT', incoterm: 'FCA', node: 'INLAND_TRANSPORT', resp: 'CONDITIONAL',
    note: 'FCA内陆运费归属取决于指定交货地点；地点未录入，不默认归卖方',
  }),
  r({
    id: 'FCA.ORIGIN_TERMINAL.SELLER_PLACE', incoterm: 'FCA', node: 'ORIGIN_TERMINAL',
    when: [{ kind: 'DELIVERY_PLACE', is: 'SELLER_PREMISES' }], resp: 'BUYER',
    note: 'FCA卖方场所装货交货后，起运港/机场正常作业由买方承担；合同/发生原因例外另核',
  }),
  r({
    id: 'FCA.ORIGIN_TERMINAL.DEFAULT', incoterm: 'FCA', node: 'ORIGIN_TERMINAL', resp: 'CONDITIONAL',
    note: 'FCA其他或未确认交货点的港杂费须区分交货点前后与具体作业，不能把整项THC仅凭节点全归一方',
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
  voluntaryInsurance('FCA'),
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
  voluntaryInsurance('FAS'),
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
    resp: 'CONDITIONAL',
    note: 'FOB班轮条件不能确定全部起运港港杂费的承担方；请拆分费用，核对合同和运费已含范围后逐项确认',
  }),
  r({
    id: 'FOB.CARRIER_HANDOVER.DEFAULT',
    incoterm: 'FOB',
    node: 'CARRIER_HANDOVER',
    resp: 'SELLER',
    note: '标准FOB下卖方负责将货物装上船；补充条款的费用与风险影响应分别核对合同',
  }),
  r({
    id: 'FOB.CARRIER_HANDOVER.LINER',
    incoterm: 'FOB',
    node: 'CARRIER_HANDOVER',
    when: [{ kind: 'SHIPPING_TERMS', is: 'LINER' }],
    resp: 'CONDITIONAL',
    note: 'FOB班轮条件下装船费是否已含运费及其承担方需核对原合同；不能只凭条款名称确定，也不自动改变风险转移点',
  }),
  r({
    id: 'FOB.CARRIER_HANDOVER.UNDER_TACKLE',
    incoterm: 'FOB',
    node: 'CARRIER_HANDOVER',
    when: [{ kind: 'SHIPPING_TERMS', is: 'UNDER_TACKLE' }],
    resp: 'CONDITIONAL',
    note: 'FOB吊钩下条款需核对装船费用、交货及风险的具体约定；当前仅标为待确认，不凭名称认定由买方承担',
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
  voluntaryInsurance('FOB'),
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
      resp: 'CONDITIONAL',
      note: `${incoterm}无目的港卸货作业义务，但卸货/港杂费承担取决于运输合同及具体费用范围；运输合同已由卖方负担的部分不能另向买方收取，未确认时不默认归买方`,
    }),
    r({
      id: `${incoterm}.DESTINATION_TERMINAL.LINER`,
      incoterm,
      node: 'DESTINATION_TERMINAL',
      when: [{ kind: 'SHIPPING_TERMS', is: 'LINER' }],
      resp: 'CONDITIONAL',
      note: `${incoterm}班轮条件名称不能证明整项港杂费已含运费；请核对运输合同、具体范围及父项包含，逐项确认承担方`,
    }),
    r({
      id: `${incoterm}.DESTINATION_TERMINAL.EX_SHIP_HOLD`,
      incoterm,
      node: 'DESTINATION_TERMINAL',
      when: [{ kind: 'SHIPPING_TERMS', is: 'EX_SHIP_HOLD' }],
      resp: 'CONDITIONAL',
      note: `${incoterm}舱底条款须核对实际费用约定，不凭名称分配整项港杂费；C类标准风险仍在装运港装船时转移，不变成目的港交货`,
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
      resp: 'CONDITIONAL',
      note: '最终卸货费用需核对是否由卖方运输合同负担、是否已含或另有买卖合同约定；费用承担不改变装运港交货风险',
    }),
    ...allNodes(incoterm, 'BUYER', `${incoterm}：目的港之后的费用由买方负担（仅适用海运及内河运输）`),
  ];
}

const CFR: IncotermRule[] = [
  voluntaryInsurance('CFR'),
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
  const deliveryNote = `${incoterm}交货在承运人接管处，运费支付至指定目的地；该港杂费须核对是否在运输合同范围内及交货/支付终点位置，不能因风险或地点名称直接判定`;
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
      resp: 'CONDITIONAL',
      note: deliveryNote,
    }),
    r({
      id: `${incoterm}.DESTINATION_TRANSPORT`,
      incoterm,
      node: 'DESTINATION_TRANSPORT',
      resp: 'CONDITIONAL',
      note: `${incoterm}须核对本段是在指定运费终点之前还是之后，以及运输合同含费范围；指定目的地为港口时，之后的短驳不能默认由卖方承担`,
    }),
    r({
      id: `${incoterm}.FINAL_DELIVERY`,
      incoterm,
      node: 'FINAL_DELIVERY',
      resp: 'CONDITIONAL',
      note: `${incoterm}不要求卖方执行最终卸货；已发生卸货费用须另核运输合同是否由卖方负担及买卖合同约定，不自动归买方`,
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
    ...allNodes(incoterm, 'BUYER', `${incoterm}交货在承运人接管处；指定目的地为运费终点，其他费用按合同另核`),
  ];
}

const CPT: IncotermRule[] = [
  voluntaryInsurance('CPT'),
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
            resp: 'CONDITIONAL',
            note: 'DAP在到达运输工具上准备卸货时交货，卖方无卸货作业义务；卸货费用若由其运输合同负担，不得另向买方收取（除非另有约定），需逐项核对',
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
  voluntaryInsurance('DAP'),
  voluntaryInsurance('DPU'),
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
    resp: 'CONDITIONAL',
    note: 'DDP在到达运输工具上准备卸货时交货，卖方无卸货作业义务；卸货费用须核对是否已由卖方运输合同负担及买卖合同另约，不自动归买方',
  }),
  voluntaryInsurance('DDP'),
  ...allNodes('DDP', 'SELLER', 'DDP：卖方承担至指定目的地的全部费用'),
];

/**
 * 发生原因规则（过错责任）。只列确有倾向的情形：因某一方自身原因产生的费用由该方承担，
 * 不因贸易术语而改变——即便术语是 FOB，因卖方单证错误导致的目的港滞箱费仍归卖方。
 *
 * 承运人原因与不可抗力不预设过错承担：先核对术语及合同的费用责任，
 * 垫付安排与追偿须另查运输合同和适用法律，不能保证可索赔或自动转移费用。
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
    responsibility: 'CONDITIONAL',
    note: '卖方代买方办理出口清关仅说明办理人，不能推出费用承担；术语规则缺失时须另核合同约定',
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

/** Incoterms 2020 费用实现；按具体度优先，同分保留声明顺序。 */
export const INCOTERMS_2020_RULESET: IncotermsRuleSet = {
  id: 'incoterms2020',
  version: '1.2',
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
