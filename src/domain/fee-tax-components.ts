/** Independent arithmetic assumptions; not a project field, tax certification or fee application contract. */
export const FEE_TAX_CHANNEL_KEYS = ['cash','net','tax','credit','economic','customs'] as const;
export type FeeTaxChannel = typeof FEE_TAX_CHANNEL_KEYS[number];
export const FEE_TAX_LINE_LIMIT = 8;
export interface ExactFeeTaxFraction { numerator: string; denominator: string; }
export type FeeTaxChannels = Record<FeeTaxChannel, ExactFeeTaxFraction|null>;
export type FeeTaxSplit =
 | {kind:'UNKNOWN'}
 | {kind:'NO_SEPARATION'}
 | {kind:'EXPLICIT';net:string;tax:string}
 | {kind:'GROSS_RATE';rate:string};
export type FeeTaxCredit =
 | {kind:'UNKNOWN'}
 | {kind:'NONE';basis:string}
 | {kind:'ASSUMED';amount:string;basis:string;document_ref:string;eligibility_ref:string};
export type FeeTaxCustoms =
 | {kind:'UNKNOWN'}
 | {kind:'NOT_ADDED';basis:string}
 | {kind:'ADD_COMPONENT';amount:string;basis:string};
export interface FeeTaxComponentInput {
 line_id:string;currency:string;gross:string|null;
 tax:FeeTaxSplit;credit:FeeTaxCredit;customs:FeeTaxCustoms;
}
export interface FeeTaxComponentBatch { currency:string;rows:FeeTaxComponentInput[]; }
export type FeeTaxComponentIssue = 'CASH_AMOUNT_UNKNOWN'|'TAX_COMPONENT_UNKNOWN'|'TAX_NOT_SEPARATED'|'CREDIT_UNDETERMINED'|'CUSTOMS_COMPONENT_UNDETERMINED';
export interface FeeTaxComponentAuditStep {
 channel:FeeTaxChannel;
 operation:'RECORDED'|'UNKNOWN'|'NOT_SEPARATED'|'GROSS_DIV_ONE_PLUS_RATE'|'GROSS_MINUS_NET'|'NO_CREDIT_ADJUSTMENT'|'ASSUMED_CREDIT'|'GROSS_MINUS_CREDIT'|'NOT_ADDED'|'RECORDED_CUSTOMS_COMPONENT';
 operands:ExactFeeTaxFraction[];
 result:ExactFeeTaxFraction|null;
}
export interface FeeTaxComponentReview {
 kind:'FEE_TAX_COMPONENT_REVIEW';version:'0.1';scope:'READ_ONLY_ASSUMPTIONS';
 input:FeeTaxComponentInput;channels:FeeTaxChannels;issues:FeeTaxComponentIssue[];
 audit:FeeTaxComponentAuditStep[];
}
export interface FeeTaxComponentSummary {
 kind:'FEE_TAX_COMPONENT_SUMMARY';version:'0.1';scope:'READ_ONLY_ASSUMPTIONS';
 currency:string;rows:FeeTaxComponentReview[];
 totals:FeeTaxChannels;known_subtotals:Record<FeeTaxChannel,ExactFeeTaxFraction>;unknown_counts:Record<FeeTaxChannel,number>;
}
export class FeeTaxComponentsInputError extends Error {
 constructor(readonly path:string,reason:string){super(`费用税务成分假设无效（${path}）：${reason}`);this.name='FeeTaxComponentsInputError';}
}
