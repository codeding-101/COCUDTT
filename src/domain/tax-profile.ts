import type { RebateProfile } from './rebate.js';
import type { TaxRateTable } from './rate-table.js';
import type { HsRateTable } from './hs-rate.js';
import type { Numeric } from './decimal.js';
import type { DateStr } from './enums.js';
import type { SourceEvidence } from './source-evidence.js';
import type { ImportEligibility } from './import-context.js';

/** 进口环节税费规则（设计文档 9.1、9.2） */
export interface ImportTaxRules {
  /** 缺省保持历史测算口径；中国模式限定一般贸易、单商品，人民币核算。 */
  calculationMode?: 'LEGACY' | 'CN_GENERAL_TRADE';
  /** 一般贸易完成申报日期；不使用报价日期或出口日期替代。 */
  declarationDate?: DateStr;
  /** 兜底关税、VAT、消费税（含不适用的判断）的联合核对记录。HS字段覆盖时用该HS记录。 */
  rateEvidence?: SourceEvidence;
  eligibility?: ImportEligibility;
  /** 完税价格以到岸价为基础 */
  dutiableValueBasis: 'CIF';
  /** 无法确定保险费时，按（货价 + 运费）× 该比率计提 */
  insuranceFallbackRate?: Numeric;
  dutyRates: TaxRateTable;
  /**
   * HS 税率表（设计文档 9.6）。命中时优先于 dutyRates / vatRate 使用，
   * 未命中则回退到 dutyRates，并给出提示。
   */
  hsTable?: HsRateTable;
  /** 关税税额低于该额度免征 */
  dutyExemptionThreshold?: Numeric;
  consumptionTax?: {
    rate: Numeric;
    basis: 'DUTIABLE_PLUS_DUTY';
  } | null;
  vatRate: Numeric;
  /** 买方可抵扣增值税，决定 landed cost 双口径（D2） */
  vatDeductibleForBuyer: boolean;
}

/** 出口环节税费规则 */
export interface ExportTaxRules {
  dutiableValueBasis: 'FOB';
  /** 出口关税，多数商品为 0 */
  dutyRates: TaxRateTable;
  /** 出口退税（设计文档 9.5） */
  rebate: RebateProfile;
}

export interface TaxProfile {
  id: string;
  version: string;
  import: ImportTaxRules;
  export: ExportTaxRules;
  customsFx: {
    bookType: 'CUSTOMS';
    lockPeriod: 'MONTHLY';
  };
}
