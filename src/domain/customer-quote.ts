import type { Incoterm } from './enums.js';

/** 明确输入的公开条款，不接收内部备注、来源、采购成本或完整项目对象。 */
export interface CustomerQuoteFields {
  issuer: string;
  recipient: string;
  reference: string;
  goods_description: string;
  delivery_terms: string;
  payment_terms: string;
  included_scope: string;
  excluded_scope: string;
  insurance_terms: string;
  tax_terms: string;
  remarks: string;
}
export const CUSTOMER_QUOTE_FIELDS = ['issuer','recipient','reference','goods_description','delivery_terms','payment_terms','included_scope','excluded_scope','insurance_terms','tax_terms','remarks'] as const;
export const emptyCustomerQuoteFields = (): CustomerQuoteFields => ({issuer:'',recipient:'',reference:'',goods_description:'',delivery_terms:'',payment_terms:'',included_scope:'',excluded_scope:'',insurance_terms:'',tax_terms:'',remarks:''});

/** 客户文件的封闭白名单。所有金额仅为原币合同报价，不携带引擎结果或项目快照。 */
export interface CustomerQuote {
  version: '1.0';
  kind: 'CUSTOMER_QUOTE_DRAFT';
  issuer: string;
  recipient: string;
  reference: string;
  goods: { description: string; quantity: string; unit: string };
  quote: { amount: string; currency: string; incoterm: Incoterm; named_place: string; incoterms_version: '2020'; valid_from: string | null; valid_to: string | null };
  terms: { delivery: string; payment: string; included: string; excluded: string; insurance: string; tax: string; remarks: string };
  standard: { risk_point: string; risk_pending: boolean; freight_risk_separated: boolean; insurance_obligation: 'ICC_A'|'ICC_C'|null; import_cost_bearer: 'SELLER'|'BUYER' };
  pending: string[];
}
