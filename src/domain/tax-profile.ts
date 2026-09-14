import type { RebateProfile } from './rebate.js';
import type { TaxRateTable } from './rate-table.js';
import type { HsRateTable } from './hs-rate.js';
import type { Numeric } from './decimal.js';

/** 进口环节税费规则（设计文档 9.1、9.2） */
export interface ImportTaxRules {
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
