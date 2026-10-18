/** Independent arithmetic assumptions. No project field, tax certification or fee application. */
export interface PrecisionFraction {numerator:string;denominator:string}
export const FEE_PRECISION_CHANNELS=['cash','net','tax','credit','economic','customs'] as const;
export type PrecisionChannel=typeof FEE_PRECISION_CHANNELS[number];
export type PrecisionAmount=string|PrecisionFraction|null;
export type PrecisionMode='HALF_UP'|'HALF_EVEN'|'DOWN';
export interface ExplicitPrecisionPolicy {kind:'EXPLICIT';unit:string;mode:PrecisionMode;basis:string}
export type PrecisionPolicy={kind:'UNRESOLVED'}|ExplicitPrecisionPolicy;
export interface FeeRoundingInput {currency:string;amount:PrecisionAmount;policy:PrecisionPolicy}
export interface FeePrecisionGroupInput {currency:string;rows:{line_id:string;currency:string;amount:PrecisionAmount}[];policy:ExplicitPrecisionPolicy;scope:'PER_LINE'|'TOTAL'}
export interface FeePrecisionSplitInput {currency:string;gross:PrecisionAmount;net:PrecisionAmount;tax:PrecisionAmount;credit:PrecisionAmount;customs:PrecisionAmount;policy:ExplicitPrecisionPolicy}
export interface FeePrecisionFxInput {
 amount:PrecisionAmount;from:string;to:string;purpose:'COMMERCIAL_REVIEW'|'CUSTOMS_COMPONENT_REVIEW';
 channel:PrecisionChannel;as_of:string;
 rate_source:{base:string;quote:string;rate:string;type:'CONTRACT'|'MARKET'|'CUSTOMS';rate_date:string;valid_from:string;valid_to:string;reference:string};
 policy:ExplicitPrecisionPolicy;
}
export interface FeePrecisionStageInput {amount:PrecisionAmount;rate:string;intermediate:ExplicitPrecisionPolicy;final:ExplicitPrecisionPolicy}
export type FeePrecisionIssue='AMOUNT_UNKNOWN'|'POLICY_UNRESOLVED'|'PRICE_TAX_ROUNDING_DIFFERENCE'|'ECONOMIC_ROUNDING_DIFFERENCE';
export interface PrecisionAuditStep {
 path:string;operation:'QUANTIZE'|'UNKNOWN'|'POLICY_UNRESOLVED'|'ADD'|'SUBTRACT'|'MULTIPLY'|'DIVIDE'|'RECORDED';
 operands:(PrecisionFraction|null)[];result:PrecisionFraction|null;
 /** Exact quotient/remainder in units, not a finite decimal approximation. */
 quantization?:{unit:PrecisionFraction;mode:PrecisionMode;floor_units:string;remainder:PrecisionFraction;increment:boolean};
}
export interface FeePrecisionReview<I,V> {
 kind:'FEE_PRECISION_REVIEW';version:'0.1';scope:'READ_ONLY_ASSUMPTIONS';
 operation:'ROUND'|'GROUP'|'SPLIT_AUDIT'|'FX'|'STAGE_ORDER';input:I;values:V;issues:FeePrecisionIssue[];audit:PrecisionAuditStep[];
}
export interface FeeRoundingValues {rounded:PrecisionFraction|null;delta:PrecisionFraction|null}
export interface FeePrecisionGroupValues {
 line_total:PrecisionFraction|null;aggregate_total:PrecisionFraction|null;selected:PrecisionFraction|null;delta:PrecisionFraction|null;
 scope_difference:PrecisionFraction|null;known_line_subtotal:PrecisionFraction;unknown_rows:number;
}
export interface FeePrecisionSplitValues {channels:Record<PrecisionChannel,PrecisionFraction|null>;price_tax_gap:PrecisionFraction;economic_gap:PrecisionFraction|null}
export interface FeePrecisionFxValues {direction:'DIRECT'|'INVERSE';unrounded:PrecisionFraction|null;rounded:PrecisionFraction|null;delta:PrecisionFraction|null}
export interface FeePrecisionStageValues {exact_then_target:PrecisionFraction;intermediate_then_target:PrecisionFraction;gap:PrecisionFraction}
export class FeePrecisionInputError extends Error {
 constructor(readonly path:string,reason:string){super(`费用精度假设无效（${path}）：${reason}`);this.name='FeePrecisionInputError';}
}
