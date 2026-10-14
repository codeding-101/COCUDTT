import type { SourceEvidence } from './source-evidence.js';
import type { ImportTaxRules } from './tax-profile.js';

/** 国家或地区名称由用户录入，出口地与原产地分别保存。 */
export interface TradeRoute {
  export_country: string;
  import_country: string;
  origin_country: string;
  customs_regime: 'UNCONFIRMED' | 'GENERAL_TRADE' | 'OTHER';
}

/** 人工核对的适用条件，不自动推断原产地或抵扣资格。 */
export interface ImportEligibility {
  agreement_name: string;
  vat_taxpayer: 'UNCONFIRMED' | 'GENERAL' | 'OTHER';
  vat_use: 'UNCONFIRMED' | 'TAXABLE_BUSINESS' | 'OTHER';
  duty_evidence?: SourceEvidence;
  vat_evidence?: SourceEvidence;
}

export function emptyRoute(): TradeRoute {
  return { export_country: '', import_country: '', origin_country: '', customs_regime: 'UNCONFIRMED' };
}

export function emptyEligibility(): ImportEligibility {
  return { agreement_name: '', vat_taxpayer: 'UNCONFIRMED', vat_use: 'UNCONFIRMED' };
}

export function eligibilityValues(kind: 'duty' | 'vat', route: TradeRoute | undefined, taxKey: string | undefined, rules: ImportTaxRules): unknown {
  const common = { route: route ?? null, tax_key: taxKey ?? '', declaration_date: rules.declarationDate ?? '', calculation_mode: rules.calculationMode };
  return kind === 'duty'
    ? { ...common, basis: rules.hsTable?.basis ?? 'MFN', agreement_name: rules.eligibility?.agreement_name ?? '' }
    : { ...common, deductible: rules.vatDeductibleForBuyer, taxpayer: rules.eligibility?.vat_taxpayer, use: rules.eligibility?.vat_use };
}
