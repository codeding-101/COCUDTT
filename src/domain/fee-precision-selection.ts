import type {ExplicitPrecisionPolicy,FeePrecisionFxInput,PrecisionChannel,PrecisionFraction} from './fee-precision.js';
import type {FeeTaxAttachmentTarget} from './fee-tax-attachment.js';

export const FEE_PRECISION_SELECTION_BYTES=64*1024*1024;
export const FEE_PRECISION_SELECTION_REVISION_LIMIT=1_000_000_000;
export type FeePrecisionChoice=
 | {kind:'UNRESOLVED'}
 | {kind:'ROUND';policy:ExplicitPrecisionPolicy}
 | {kind:'FX';to:string;purpose:FeePrecisionFxInput['purpose'];as_of:string;rate_source:FeePrecisionFxInput['rate_source'];policy:ExplicitPrecisionPolicy};
export interface FeePrecisionSelectionRecord {
 record_id:string;component_record_id:string;target:FeeTaxAttachmentTarget;channel:PrecisionChannel;
 currency:string;original:PrecisionFraction|null;choice:FeePrecisionChoice;
 acknowledgement:null|{basis_sha256:string};
}
/** Independent internal assumptions. No project mutation or fee-application authorization. */
export interface FeePrecisionSelection {
 kind:'INTERNAL_FEE_PRECISION_SELECTION';version:'1.0';selection_id:string;revision:number;
 pair_snapshot_json:string;pair_snapshot_sha256:string;
 attachment_snapshot_json:string;attachment_snapshot_sha256:string;
 records:FeePrecisionSelectionRecord[];retired_record_ids:string[];content_sha256:string;
}
export interface FeePrecisionSelectionLease {revision:number;content_sha256:string}
export class FeePrecisionSelectionError extends Error {
 constructor(readonly reason:string){super('FEE_PRECISION_SELECTION_INVALID:'+reason);this.name='FeePrecisionSelectionError';}
}
