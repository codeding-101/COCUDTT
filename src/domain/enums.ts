/** 11 个贸易节点（设计文档 3.1） */
export const TRADE_NODES = [
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
  'FINAL_DELIVERY',
] as const;
export type TradeNode = (typeof TRADE_NODES)[number];

export const TRADE_NODE_LABELS: Record<TradeNode, string> = {
  SELLER_PREMISES: '卖方场所',
  INLAND_TRANSPORT: '出口国内陆运输',
  EXPORT_CLEARANCE: '出口清关',
  ORIGIN_TERMINAL: '起运地港口/机场',
  CARRIER_HANDOVER: '承运人接管',
  MAIN_CARRIAGE: '国际主运输',
  DESTINATION_TERMINAL: '目的地港口/机场',
  IMPORT_CLEARANCE: '进口清关',
  IMPORT_DUTIES: '进口关税及税费',
  DESTINATION_TRANSPORT: '目的地运输',
  FINAL_DELIVERY: '最终交付',
};

/** Incoterms 2020 十一个术语 */
export const INCOTERMS = [
  'EXW',
  'FCA',
  'FAS',
  'FOB',
  'CFR',
  'CIF',
  'CPT',
  'CIP',
  'DAP',
  'DPU',
  'DDP',
] as const;
export type Incoterm = (typeof INCOTERMS)[number];

/** 仅适用海运及内河运输的四个术语（设计文档 6.4 第 8 条） */
export const SEA_ONLY_INCOTERMS: readonly Incoterm[] = ['FAS', 'FOB', 'CFR', 'CIF'];

export const CARRIAGE_MODES = ['SEA', 'INLAND_WATERWAY', 'AIR', 'RAIL', 'ROAD', 'MULTIMODAL'] as const;
export type CarriageMode = (typeof CARRIAGE_MODES)[number];

export const CARRIAGE_MODE_LABELS: Record<CarriageMode, string> = {
  SEA: '海运',
  INLAND_WATERWAY: '内河',
  AIR: '空运',
  RAIL: '铁路',
  ROAD: '公路',
  MULTIMODAL: '多式联运',
};

export function isSeaMode(mode: CarriageMode): boolean {
  return mode === 'SEA' || mode === 'INLAND_WATERWAY';
}

/** 当前运输方式下可用的术语：海运为 11 个，其余为 7 个（设计文档 11.5） */
export function availableIncoterms(mode: CarriageMode): readonly Incoterm[] {
  if (isSeaMode(mode)) return INCOTERMS;
  return INCOTERMS.filter((incoterm) => !SEA_ONLY_INCOTERMS.includes(incoterm));
}

export function isIncotermAvailable(mode: CarriageMode, incoterm: Incoterm): boolean {
  return !SEA_ONLY_INCOTERMS.includes(incoterm) || isSeaMode(mode);
}

export const COST_CATEGORIES = [
  'GOODS_AND_PACKING',
  'INLAND_TRANSPORT',
  'EXPORT_CLEARANCE',
  'ORIGIN_TERMINAL',
  'MAIN_CARRIAGE',
  'INSURANCE',
  'DESTINATION_TERMINAL',
  'IMPORT_CLEARANCE',
  'IMPORT_DUTIES',
  'DESTINATION_TRANSPORT',
  'CUSTOM',
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  GOODS_AND_PACKING: '商品及包装',
  INLAND_TRANSPORT: '出口国内运输',
  EXPORT_CLEARANCE: '出口手续',
  ORIGIN_TERMINAL: '起运地港口/机场费用',
  MAIN_CARRIAGE: '国际主运输',
  INSURANCE: '保险',
  DESTINATION_TERMINAL: '目的地费用',
  IMPORT_CLEARANCE: '进口清关',
  IMPORT_DUTIES: '进口关税及税费',
  DESTINATION_TRANSPORT: '目的地运输',
  CUSTOM: '特殊/自定义费用',
};

export const PRICING_METHODS = [
  'FIXED',
  'QTY_X_UNIT',
  'PERCENT',
  'PER_DAY',
  'ACTUAL',
  'TIERED',
] as const;
export type PricingMethod = (typeof PRICING_METHODS)[number];

/**
 * 计费方式的中文名。放在领域层而不是界面层：
 * 引擎的报错信息也要用它，用户看到的文案不能出现 QTY_X_UNIT 这类内部标识符。
 */
export const PRICING_METHOD_LABELS: Record<PricingMethod, string> = {
  FIXED: '固定金额',
  QTY_X_UNIT: '数量 × 单价',
  PERCENT: '百分比',
  PER_DAY: '按天计费',
  ACTUAL: '实际金额',
  TIERED: '阶梯计费',
};

/**
 * 阶梯计费方式：
 * - MARGINAL 累进：每一档的费率只作用于落在该档内的那部分数量（像个人所得税）
 * - FLAT 分档：由计费量所在的档决定一个费率，整个数量都按这个费率算（如空运重量等级运价）
 */
export const TIER_MODES = ['MARGINAL', 'FLAT'] as const;
export type TierMode = (typeof TIER_MODES)[number];

export const TIER_MODE_LABELS: Record<TierMode, string> = {
  MARGINAL: '累进（每档各算各的）',
  FLAT: '分档（全量按所在档费率）',
};

/** 用于分档的计费量 */
export const TIER_BASES = ['QUANTITY', 'DAYS'] as const;
export type TierBasis = (typeof TIER_BASES)[number];

export const TIER_BASIS_LABELS: Record<TierBasis, string> = {
  QUANTITY: '按数量',
  DAYS: '按天数',
};

/** 汇率类型，四类汇率互不替代（设计文档 3.4、5.3） */
export const FX_TYPES = ['MANUAL', 'CONTRACT', 'MARKET', 'CUSTOMS'] as const;
export type FxType = (typeof FX_TYPES)[number];

export const FX_TYPE_LABELS: Record<FxType, string> = {
  MANUAL: '用户手动输入',
  CONTRACT: '合同约定汇率',
  MARKET: '市场汇率',
  CUSTOMS: '海关适用汇率',
};

export const RESPONSIBILITIES = ['SELLER', 'BUYER', 'SHARED', 'CONDITIONAL'] as const;
export type Responsibility = (typeof RESPONSIBILITIES)[number];

export const RESPONSIBILITY_SOURCES = [
  'USER_OVERRIDE',
  'CONTRACT',
  'OCCURRENCE_REASON',
  'INCOTERM_RULE',
  'SPECIAL_CONDITION',
  'TRADE_NODE',
  'UNRESOLVED',
] as const;
export type ResponsibilitySource = (typeof RESPONSIBILITY_SOURCES)[number];

/**
 * 费用发生原因。用于那些"单看节点判断不出归属"的费用：
 * 滞箱费、滞期费、仓储费、查验费——同一节点、同一名称，
 * 因谁的原因产生，归属完全不同。
 */
export const OCCURRENCE_REASONS = [
  'NORMAL_OPERATION',
  'SELLER_FAULT',
  'BUYER_FAULT',
  'CARRIER_FAULT',
  'CUSTOMS_INSPECTION',
  'REGULATORY_REQUIREMENT',
  'FORCE_MAJEURE',
] as const;
export type OccurrenceReason = (typeof OCCURRENCE_REASONS)[number];

export const OCCURRENCE_REASON_LABELS: Record<OccurrenceReason, string> = {
  NORMAL_OPERATION: '正常作业',
  SELLER_FAULT: '卖方原因',
  BUYER_FAULT: '买方原因',
  CARRIER_FAULT: '承运人原因',
  CUSTOMS_INSPECTION: '海关查验',
  REGULATORY_REQUIREMENT: '法定检验检疫或认证要求',
  FORCE_MAJEURE: '不可抗力',
};

export type Party = 'SELLER' | 'BUYER';

export type RiskRelation = 'BEFORE_TRANSFER' | 'AFTER_TRANSFER' | 'NOT_APPLICABLE';

export type DayBasis = 'CALENDAR' | 'WORKING';

export type RebateEntityType = 'TRADING' | 'MANUFACTURER';

export type DateStr = string;

export type CurrencyCode = string;
