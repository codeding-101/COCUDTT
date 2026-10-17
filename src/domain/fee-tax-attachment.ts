import type {FeeTaxComponentInput} from './fee-tax-components.js';

export const FEE_TAX_ATTACHMENT_BYTES=24*1024*1024;
export const FEE_TAX_ATTACHMENT_PAIR_BYTES=10*1024*1024;
export const FEE_TAX_ATTACHMENT_REVISION_LIMIT=1_000_000_000;
export const FEE_TAX_ATTACHMENT_FACETS=['tax','credit','customs'] as const;
export type FeeTaxAttachmentFacet=typeof FEE_TAX_ATTACHMENT_FACETS[number];
export interface FeeTaxAttachmentSource {
 provenance:'UNSPECIFIED'|'EXAMPLE'|'USER_SUPPLIED';
 reference:string;valid_from:string;valid_to:string;checked_on:string;
}
export interface FeeTaxAttachmentTarget {
 mapping_id:string;bill_id:string;line_id:string;cost_id:string;
 operation:'CREATE_NEW'|'REFERENCE_EXISTING';
}
export interface FeeTaxAttachmentRecordInput {
 target:FeeTaxAttachmentTarget;input:FeeTaxComponentInput;
 sources:Record<FeeTaxAttachmentFacet,FeeTaxAttachmentSource>;
}
export interface FeeTaxAttachmentRecord extends FeeTaxAttachmentRecordInput {
 record_id:string;
 acknowledgements:Record<FeeTaxAttachmentFacet,null|{basis_sha256:string}>;
}
/** Internal assumptions only. The embedded original pair is never installed or changed. */
export interface FeeTaxAttachment {
 kind:'INTERNAL_FEE_TAX_ATTACHMENT';version:'1.0';attachment_id:string;revision:number;
 pair_snapshot_json:string;pair_snapshot_sha256:string;
 records:FeeTaxAttachmentRecord[];retired_record_ids:string[];content_sha256:string;
}
export interface FeeTaxAttachmentLease {revision:number;content_sha256:string}
export class FeeTaxAttachmentError extends Error {
 constructor(readonly reason:string){super('FEE_TAX_ATTACHMENT_INVALID:'+reason);this.name='FeeTaxAttachmentError';}
}
