import { newFundingAssumption, type FundingAssumption } from './funding.js';
/** Internal payment worksheet, separate from the project 0.8 container. */
export const SETTLEMENT_METHODS = ['UNCONFIRMED', 'TT', 'LC', 'OA'] as const;
export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number];
export interface SettlementBinding {
  project_name: string;
  goods_name: string;
  quantity: string;
  unit: string;
  incoterm: string;
  named_place: string;
  amount: string;
  currency: string;
}
export interface PaymentEntry {
  id: string;
  basis: 'AMOUNT' | 'PERCENT';
  value: string;
  date: string;
  trigger: string;
}
export interface BankFeeEntry {
  id: string;
  source: 'EXISTING' | 'EXTRA';
  cost_id: string;
  amount: string;
  currency: string;
  bearer: 'UNCONFIRMED' | 'BUYER' | 'SELLER';
  payer: 'UNCONFIRMED' | 'BUYER' | 'SELLER';
  date: string;
  reference: string;
  /** An explicit user assertion; the program cannot identify duplicate invoices. */
  not_in_project: boolean;
}
export interface SettlementPlan {
  version: '1.0' | '1.1' | '1.2';
  kind: 'INTERNAL_SETTLEMENT_PLAN';
  binding: SettlementBinding;
  method: SettlementMethod;
  bank_status: 'UNCONFIRMED' | 'NO_FEES' | 'LISTED';
  payments: PaymentEntry[];
  bank_fees: BankFeeEntry[];
  notes: string;
  /** Required in 1.1/1.2; 1.2 additionally requires an explicit balance model and events. */
  funding?: FundingAssumption;
}
/** Explicit upgrade; unknown legacy extensions must not be overwritten or activated. */
export function enableFundingLedger(plan: SettlementPlan): SettlementPlan {
  if (plan.version !== '1.1' || !plan.funding) throw Error('请先启用1.1资金占用字段，再单独启用变动本金');
  if (Object.hasOwn(plan.funding,'balance_model') || Object.hasOwn(plan.funding,'events')) throw Error('旧1.1资金扩展与变动本金字段重名，请保留原文件并人工核对；未升级或覆盖');
  const copy = structuredClone(plan);
  copy.version = '1.2';
  Object.assign(copy.funding!,{balance_model:'EVENTS',events:[],status:'UNCONFIRMED'});
  return copy;
}
export const newPaymentEntry = (id: string): PaymentEntry => ({ id, basis: 'AMOUNT', value: '', date: '', trigger: '' });
export const newBankFeeEntry = (id: string): BankFeeEntry => ({
  id, source: 'EXISTING', cost_id: '', amount: '', currency: '', bearer: 'UNCONFIRMED', payer: 'UNCONFIRMED', date: '', reference: '', not_in_project: false,
});
export function newSettlementPlan(binding: SettlementBinding): SettlementPlan {
  return { version: '1.1', kind: 'INTERNAL_SETTLEMENT_PLAN', binding: { ...binding }, method: 'UNCONFIRMED',
    bank_status: 'UNCONFIRMED', payments: [newPaymentEntry('payment-1')], bank_fees: [], notes: '', funding: newFundingAssumption() };
}
