import type { BaseRef, CostItem, Tier } from '../domain/cost-item.js';
import type { Numeric } from '../domain/decimal.js';
import type {
  CostCategory,
  CurrencyCode,
  FxType,
  OccurrenceReason,
  PricingMethod,
  TierBasis,
  TierMode,
  TradeNode,
} from '../domain/enums.js';

/**
 * 费用预设。**这是录入辅助，不是判定规则。**
 *
 * 预设只负责把常见费用的名称、节点、类别、计费方式填好，省去用户重复打字；
 * 归属仍然完全由规则引擎按"术语 + 节点 + 类别 + 发生原因"判定。
 * 字典里没有的费用，用户可以自由录入任意名称（`is_custom = true`），引擎照算不误。
 */
export interface CostPreset {
  key: string;
  name: string;
  aliases?: string[];
  cost_category: CostCategory;
  trade_node: TradeNode;
  pricing_method: PricingMethod;
  /** 建议计量单位 */
  unit?: string;
  /** 常见发生原因；省略视为正常作业 */
  occurrence_reason?: OccurrenceReason;
  /** 百分比计费的基数 */
  calculation_base?: BaseRef;
  /** 阶梯计费的档位（配合 pricing_method: 'TIERED'） */
  tiers?: Tier[];
  tier_mode?: TierMode;
  tier_basis?: TierBasis;
  /** 分档计费时按空运规则与高一档择低 */
  tier_charge_lower?: boolean;
  /** 该项代表货物本身的价值 */
  is_goods_value?: boolean;
  /** 报价通常已含起运港/目的港操作费（如班轮条款） */
  includes_port_charges?: boolean;
  /** 界面提示，说明录入口径 */
  hint?: string;
}

export const COST_PRESETS: CostPreset[] = [
  // ---------- 商品与出口前 ----------
  {
    key: 'goods-value',
    name: '商品货值',
    aliases: ['货值', '货物价值', '发票金额'],
    cost_category: 'GOODS_AND_PACKING',
    trade_node: 'SELLER_PREMISES',
    pricing_method: 'ACTUAL',
    is_goods_value: true,
    hint: '代表货物本身的价值：用于报价构成与海关完税价格，不计入卖方成本（卖方成本由采购成本代表）',
  },
  {
    key: 'packing',
    name: '包装费',
    aliases: ['包装材料', '纸箱', '托盘'],
    cost_category: 'GOODS_AND_PACKING',
    trade_node: 'SELLER_PREMISES',
    pricing_method: 'ACTUAL',
  },
  {
    key: 'inland-freight',
    name: '出口国内陆运费',
    aliases: ['内陆运费', '省际运费', '工厂到港口'],
    cost_category: 'INLAND_TRANSPORT',
    trade_node: 'INLAND_TRANSPORT',
    pricing_method: 'QTY_X_UNIT',
    unit: '车',
  },
  {
    key: 'inland-trucking',
    name: '拖车短驳费',
    aliases: ['拖车费', '短驳费', '进港费'],
    cost_category: 'INLAND_TRANSPORT',
    trade_node: 'INLAND_TRANSPORT',
    pricing_method: 'FIXED',
  },
  {
    key: 'lashing',
    name: '加固费',
    aliases: ['绑扎费', '木架费'],
    cost_category: 'INLAND_TRANSPORT',
    trade_node: 'INLAND_TRANSPORT',
    pricing_method: 'FIXED',
  },

  // ---------- 出口手续 ----------
  {
    key: 'export-customs-broker',
    name: '出口报关费',
    aliases: ['报关费', '报关代理费', '出口报关代理费'],
    cost_category: 'EXPORT_CLEARANCE',
    trade_node: 'EXPORT_CLEARANCE',
    pricing_method: 'FIXED',
    hint: 'EXW 下出口清关名义上由买方办理，若实际由卖方代办请用责任覆盖',
  },
  {
    key: 'commodity-inspection',
    name: '出口商检费',
    aliases: ['商检费', '检验检疫费', '法定检验费'],
    cost_category: 'EXPORT_CLEARANCE',
    trade_node: 'EXPORT_CLEARANCE',
    pricing_method: 'FIXED',
    occurrence_reason: 'REGULATORY_REQUIREMENT',
  },
  {
    key: 'fumigation',
    name: '熏蒸费',
    aliases: ['熏蒸', '木质包装处理', 'IPPC'],
    cost_category: 'EXPORT_CLEARANCE',
    trade_node: 'EXPORT_CLEARANCE',
    pricing_method: 'FIXED',
    occurrence_reason: 'REGULATORY_REQUIREMENT',
    hint: '出口国要求填出口清关节点；目的地要求（如 ISPM 15 木质包装）应填目的地节点',
  },
  {
    key: 'certificate-of-origin',
    name: '产地证费',
    aliases: ['原产地证', 'FORM A', 'CO', 'FTA 产地证'],
    cost_category: 'EXPORT_CLEARANCE',
    trade_node: 'EXPORT_CLEARANCE',
    pricing_method: 'FIXED',
  },
  {
    key: 'certification',
    name: '产品认证费',
    aliases: ['认证费', 'CE', 'FDA', 'REACH', '检测费'],
    cost_category: 'EXPORT_CLEARANCE',
    trade_node: 'EXPORT_CLEARANCE',
    pricing_method: 'FIXED',
    occurrence_reason: 'REGULATORY_REQUIREMENT',
  },
  {
    key: 'export-license',
    name: '出口许可证费',
    aliases: ['许可证', '配额费'],
    cost_category: 'EXPORT_CLEARANCE',
    trade_node: 'EXPORT_CLEARANCE',
    pricing_method: 'FIXED',
    occurrence_reason: 'REGULATORY_REQUIREMENT',
  },
  {
    key: 'third-party-inspection',
    name: '第三方验货费',
    aliases: ['验货费', 'SGS', 'BV', '验厂费'],
    cost_category: 'EXPORT_CLEARANCE',
    trade_node: 'EXPORT_CLEARANCE',
    pricing_method: 'FIXED',
  },
  {
    key: 'export-documentation',
    name: '出口单证费',
    aliases: ['单证费', '报关资料费'],
    cost_category: 'EXPORT_CLEARANCE',
    trade_node: 'EXPORT_CLEARANCE',
    pricing_method: 'FIXED',
  },

  // ---------- 起运地港口/机场 ----------
  {
    key: 'booking',
    name: '订舱费',
    aliases: ['租船订舱', '订舱代理费', '舱位费'],
    cost_category: 'ORIGIN_TERMINAL',
    trade_node: 'ORIGIN_TERMINAL',
    pricing_method: 'FIXED',
    hint: '谁负责主运输谁订舱：FOB/FAS/EXW/FCA 由买方订舱，其余术语由卖方订舱',
  },
  {
    key: 'thc-origin',
    name: '起运港港杂费',
    aliases: ['THC', '港杂费', '码头操作费', '起运港费用'],
    cost_category: 'ORIGIN_TERMINAL',
    trade_node: 'ORIGIN_TERMINAL',
    pricing_method: 'QTY_X_UNIT',
    unit: 'TEU',
    hint: '集装箱班轮条款下 THC 常已含在海运费报价中，若已含请标记为"已含在运费内"以免重复计费',
  },
  {
    key: 'seal',
    name: '铅封费',
    aliases: ['封志费', '封条费'],
    cost_category: 'ORIGIN_TERMINAL',
    trade_node: 'ORIGIN_TERMINAL',
    pricing_method: 'FIXED',
  },
  {
    key: 'bl-fee',
    name: '提单文件费',
    aliases: ['文件费', '提单费', '电放费', 'DOC'],
    cost_category: 'ORIGIN_TERMINAL',
    trade_node: 'ORIGIN_TERMINAL',
    pricing_method: 'FIXED',
  },
  {
    key: 'vgm',
    name: 'VGM 申报费',
    aliases: ['VGM', '重量申报费'],
    cost_category: 'ORIGIN_TERMINAL',
    trade_node: 'ORIGIN_TERMINAL',
    pricing_method: 'FIXED',
  },
  {
    key: 'ams-isf',
    name: '美线申报费',
    aliases: ['AMS', 'ISF', 'ENS', 'AFR'],
    cost_category: 'ORIGIN_TERMINAL',
    trade_node: 'ORIGIN_TERMINAL',
    pricing_method: 'FIXED',
  },
  {
    key: 'container-stuffing',
    name: '装箱场站费',
    aliases: ['装箱费', '场站费', 'CFS 费', '拼箱费'],
    cost_category: 'ORIGIN_TERMINAL',
    trade_node: 'ORIGIN_TERMINAL',
    pricing_method: 'QTY_X_UNIT',
    unit: 'CBM',
  },
  {
    key: 'origin-storage',
    name: '起运港仓储费',
    aliases: ['仓储费', '堆存费', '仓库费'],
    cost_category: 'ORIGIN_TERMINAL',
    trade_node: 'ORIGIN_TERMINAL',
    pricing_method: 'PER_DAY',
    unit: 'DAY',
    hint: '按天计费需填写天数或起止日期',
  },
  {
    key: 'origin-customs-inspection',
    name: '出口海关查验费',
    aliases: ['查验费', '查柜费', '开箱查验费'],
    cost_category: 'ORIGIN_TERMINAL',
    trade_node: 'ORIGIN_TERMINAL',
    pricing_method: 'FIXED',
    occurrence_reason: 'CUSTOMS_INSPECTION',
  },

  // ---------- 国际主运输 ----------
  {
    key: 'ocean-freight',
    name: '国际海运费',
    aliases: ['海运费', '海运运费', 'O/F'],
    cost_category: 'MAIN_CARRIAGE',
    trade_node: 'MAIN_CARRIAGE',
    pricing_method: 'FIXED',
  },
  {
    key: 'ocean-freight-all-in',
    name: '海运费（全包价，含起运港港杂费）',
    aliases: ['全包海运价', 'ALL IN 运费'],
    cost_category: 'MAIN_CARRIAGE',
    trade_node: 'MAIN_CARRIAGE',
    pricing_method: 'FIXED',
    includes_port_charges: true,
    hint: '标记后若另有独立的起运港港杂费，引擎会提示可能重复计费',
  },
  {
    key: 'air-freight',
    name: '国际空运费',
    aliases: ['空运费', '空运运费'],
    cost_category: 'MAIN_CARRIAGE',
    trade_node: 'MAIN_CARRIAGE',
    pricing_method: 'QTY_X_UNIT',
    unit: 'KG',
  },
  {
    key: 'air-freight-tiered',
    name: '空运运费（重量等级运价）',
    aliases: ['空运等级运价', '重量分界点', 'N 运价', '45 公斤分界'],
    cost_category: 'MAIN_CARRIAGE',
    trade_node: 'MAIN_CARRIAGE',
    pricing_method: 'TIERED',
    tier_mode: 'FLAT',
    tier_basis: 'QUANTITY',
    tier_charge_lower: true,
    unit: 'KG',
    // 行业通用的重量分界点，费率需按航线填写
    tiers: [
      { up_to: '45', rate: '0' },
      { up_to: '100', rate: '0' },
      { up_to: '300', rate: '0' },
      { up_to: '500', rate: '0' },
      { up_to: '1000', rate: '0' },
      { up_to: null, rate: '0' },
    ],
    hint: '分界点已按行业惯例填好（45/100/300/500/1000），费率请按航线填写；已默认勾选"按高一档择低"，符合空运计费规则',
  },
  {
    key: 'surcharge',
    name: '海运附加费',
    aliases: ['BAF', 'CAF', 'PSS', '旺季附加费', 'GRI'],
    cost_category: 'MAIN_CARRIAGE',
    trade_node: 'MAIN_CARRIAGE',
    pricing_method: 'FIXED',
  },
  {
    key: 'fuel-surcharge',
    name: '燃油附加费',
    aliases: ['燃油费', 'FSC', 'MYC'],
    cost_category: 'MAIN_CARRIAGE',
    trade_node: 'MAIN_CARRIAGE',
    pricing_method: 'FIXED',
  },
  {
    key: 'rail-freight',
    name: '国际铁路运费',
    aliases: ['班列运费', '中欧班列'],
    cost_category: 'MAIN_CARRIAGE',
    trade_node: 'MAIN_CARRIAGE',
    pricing_method: 'FIXED',
  },

  // ---------- 保险 ----------
  {
    key: 'cargo-insurance',
    name: '货物运输保险费',
    aliases: ['保险费', '货运险', '海运险'],
    cost_category: 'INSURANCE',
    trade_node: 'MAIN_CARRIAGE',
    pricing_method: 'PERCENT',
    calculation_base: { kind: 'QUOTE_AMOUNT' },
    hint: 'CIF/CIP 下卖方有投保义务，保额不得低于合同价 110%；按合同价百分比填费率时请乘以 1.1',
  },
  {
    key: 'war-risk',
    name: '战争险附加费',
    aliases: ['战争险', '罢工险'],
    cost_category: 'INSURANCE',
    trade_node: 'MAIN_CARRIAGE',
    pricing_method: 'PERCENT',
    calculation_base: { kind: 'QUOTE_AMOUNT' },
  },

  // ---------- 目的地 ----------
  {
    key: 'thc-destination',
    name: '目的港港杂费',
    aliases: ['目的港 THC', '目的港费用', 'DTHC'],
    cost_category: 'DESTINATION_TERMINAL',
    trade_node: 'DESTINATION_TERMINAL',
    pricing_method: 'QTY_X_UNIT',
    unit: 'TEU',
  },
  {
    key: 'destination-agent',
    name: '目的港代理费',
    aliases: ['换单费', '提货手续费', '目的港代理'],
    cost_category: 'DESTINATION_TERMINAL',
    trade_node: 'DESTINATION_TERMINAL',
    pricing_method: 'FIXED',
  },
  {
    key: 'demurrage',
    name: '滞箱费 / 滞期费',
    aliases: ['滞箱费', '滞期费', 'Demurrage', 'Detention'],
    cost_category: 'DESTINATION_TERMINAL',
    trade_node: 'DESTINATION_TERMINAL',
    pricing_method: 'PER_DAY',
    unit: 'DAY',
    hint: '归属取决于发生原因：因买方未及时提货归买方，因卖方单证错误归卖方——请填写发生原因。按档位计费（如前 7 天免费）时请改用「阶梯」方式',
  },
  {
    key: 'destination-storage',
    name: '目的地仓储费',
    aliases: ['目的港仓储', '海外仓费'],
    cost_category: 'DESTINATION_TERMINAL',
    trade_node: 'DESTINATION_TERMINAL',
    pricing_method: 'PER_DAY',
    unit: 'DAY',
  },
  {
    key: 'destination-customs-inspection',
    name: '目的地海关查验费',
    aliases: ['目的港查验费', '查验费'],
    cost_category: 'DESTINATION_TERMINAL',
    trade_node: 'DESTINATION_TERMINAL',
    pricing_method: 'FIXED',
    occurrence_reason: 'CUSTOMS_INSPECTION',
  },
  {
    key: 'import-customs-broker',
    name: '进口报关代理费',
    aliases: ['进口清关费', '目的国报关费', '清关代理费'],
    cost_category: 'IMPORT_CLEARANCE',
    trade_node: 'IMPORT_CLEARANCE',
    pricing_method: 'FIXED',
    hint: 'DDP 下进口清关由卖方办理，其余术语由买方办理',
  },
  {
    key: 'import-documentation',
    name: '进口单证费',
    aliases: ['进口文件费', '清关单证费'],
    cost_category: 'IMPORT_CLEARANCE',
    trade_node: 'IMPORT_CLEARANCE',
    pricing_method: 'FIXED',
  },
  {
    key: 'destination-transport',
    name: '目的地内陆运输费',
    aliases: ['目的国内陆运费', '派送运费'],
    cost_category: 'DESTINATION_TRANSPORT',
    trade_node: 'DESTINATION_TRANSPORT',
    pricing_method: 'FIXED',
  },
  {
    key: 'final-delivery',
    name: '送货上门费',
    aliases: ['到门费', '末端配送费'],
    cost_category: 'DESTINATION_TRANSPORT',
    trade_node: 'FINAL_DELIVERY',
    pricing_method: 'FIXED',
  },
  {
    key: 'unloading',
    name: '目的地卸货费',
    aliases: ['卸货费', '卸车费'],
    cost_category: 'DESTINATION_TRANSPORT',
    trade_node: 'FINAL_DELIVERY',
    pricing_method: 'QTY_X_UNIT',
    hint: 'DPU 下卸货由卖方负责，DAP/DDP 下由买方负责',
  },

  // ---------- 其他商务费用 ----------
  {
    key: 'commission',
    name: '代理佣金',
    aliases: ['佣金', '中间商佣金'],
    cost_category: 'CUSTOM',
    trade_node: 'SELLER_PREMISES',
    pricing_method: 'PERCENT',
    calculation_base: { kind: 'QUOTE_AMOUNT' },
  },
  {
    key: 'bank-charges',
    name: '银行费用',
    aliases: ['信用证费', '开证费', '议付费', '电报费'],
    cost_category: 'CUSTOM',
    trade_node: 'SELLER_PREMISES',
    pricing_method: 'FIXED',
  },
  {
    key: 'credit-insurance',
    name: '出口信用保险费',
    aliases: ['信用险', '中信保'],
    cost_category: 'CUSTOM',
    trade_node: 'SELLER_PREMISES',
    pricing_method: 'PERCENT',
    calculation_base: { kind: 'QUOTE_AMOUNT' },
    hint: '信用险不是货物运输保险，不进入海关完税价格，因此归入自定义类别',
  },
];

/** 按关键字搜索预设：匹配名称、key 与别名 */
export function findPresets(keyword: string): CostPreset[] {
  const needle = keyword.trim().toLowerCase();
  if (needle === '') return [];
  return COST_PRESETS.filter(
    (preset) =>
      preset.name.toLowerCase().includes(needle) ||
      preset.key.toLowerCase().includes(needle) ||
      (preset.aliases ?? []).some((alias) => alias.toLowerCase().includes(needle)),
  );
}

export interface MaterializeInput {
  cost_id: string;
  currency: CurrencyCode;
  base_currency: CurrencyCode;
  fx_type?: FxType;
  amount?: Numeric;
  quantity?: Numeric;
  rate?: Numeric;
  days?: Numeric;
  unit?: string;
  /** 覆盖预设的默认值 */
  overrides?: Partial<CostItem>;
}

/**
 * 把预设落成一条费用项。归属字段留为待判定，由规则引擎填充；
 * `is_custom = false` 表示这是系统已知的费用名称。
 */
export function presetToCostItem(preset: CostPreset, input: MaterializeInput): CostItem {
  const unit = input.unit ?? preset.unit;
  const item: CostItem = {
    cost_id: input.cost_id,
    cost_name: preset.name,
    cost_category: preset.cost_category,
    trade_node: preset.trade_node,
    pricing_method: preset.pricing_method,
    currency: input.currency,
    base_currency: input.base_currency,
    fx_type: input.fx_type ?? 'MARKET',
    tax_included: false,
    responsibility: 'CONDITIONAL',
    responsibility_source: 'UNRESOLVED',
    included_in_quoted_price: false,
    is_custom: false,
    source: 'USER',
    ...(unit !== undefined ? { unit } : {}),
    ...(preset.occurrence_reason !== undefined ? { occurrence_reason: preset.occurrence_reason } : {}),
    ...(preset.calculation_base !== undefined ? { calculation_base: preset.calculation_base } : {}),
    ...(preset.tiers !== undefined ? { tiers: preset.tiers.map((tier) => ({ ...tier })) } : {}),
    ...(preset.tier_mode !== undefined ? { tier_mode: preset.tier_mode } : {}),
    ...(preset.tier_basis !== undefined ? { tier_basis: preset.tier_basis } : {}),
    ...(preset.tier_charge_lower !== undefined ? { tier_charge_lower: preset.tier_charge_lower } : {}),
    ...(preset.is_goods_value !== undefined ? { is_goods_value: preset.is_goods_value } : {}),
    ...(preset.includes_port_charges !== undefined
      ? { includes_port_charges: preset.includes_port_charges }
      : {}),
    ...(input.amount !== undefined ? { amount: input.amount } : {}),
    ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
    ...(input.rate !== undefined ? { rate: input.rate } : {}),
    ...(input.days !== undefined ? { days: input.days } : {}),
    ...(input.overrides ?? {}),
  };
  return item;
}

/**
 * 自由录入一条字典里没有的费用。节点与类别必须由用户指定，
 * 因为归属判定完全依赖这两项——名称不参与判定。
 */
export function customCostItem(input: {
  cost_id: string;
  cost_name: string;
  cost_category: CostCategory;
  trade_node: TradeNode;
  currency: CurrencyCode;
  base_currency: CurrencyCode;
  pricing_method?: PricingMethod;
  fx_type?: FxType;
  occurrence_reason?: OccurrenceReason;
  unit?: string;
  amount?: Numeric;
  quantity?: Numeric;
  rate?: Numeric;
  days?: Numeric;
  tiers?: Tier[];
  tier_mode?: TierMode;
  tier_basis?: TierBasis;
  tier_charge_lower?: boolean;
  overrides?: Partial<CostItem>;
}): CostItem {
  return {
    cost_id: input.cost_id,
    cost_name: input.cost_name,
    cost_category: input.cost_category,
    trade_node: input.trade_node,
    pricing_method: input.pricing_method ?? 'ACTUAL',
    currency: input.currency,
    base_currency: input.base_currency,
    fx_type: input.fx_type ?? 'MARKET',
    tax_included: false,
    responsibility: 'CONDITIONAL',
    responsibility_source: 'UNRESOLVED',
    included_in_quoted_price: false,
    is_custom: true,
    source: 'USER',
    ...(input.unit !== undefined ? { unit: input.unit } : {}),
    ...(input.occurrence_reason !== undefined ? { occurrence_reason: input.occurrence_reason } : {}),
    ...(input.amount !== undefined ? { amount: input.amount } : {}),
    ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
    ...(input.rate !== undefined ? { rate: input.rate } : {}),
    ...(input.days !== undefined ? { days: input.days } : {}),
    ...(input.tiers !== undefined ? { tiers: input.tiers.map((tier) => ({ ...tier })) } : {}),
    ...(input.tier_mode !== undefined ? { tier_mode: input.tier_mode } : {}),
    ...(input.tier_basis !== undefined ? { tier_basis: input.tier_basis } : {}),
    ...(input.tier_charge_lower !== undefined ? { tier_charge_lower: input.tier_charge_lower } : {}),
    ...(input.overrides ?? {}),
  };
}
