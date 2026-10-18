export const FEE_ENVELOPE_BYTES=128*1024*1024;
export type FeeEnvelopeOrigin='NEW_DECLARED'|'UNKNOWN_IMPORTED';
export interface FeeEnvelopeSources {project_json:string;bill_json:string;pair_json:string|null;attachment_json:string|null;precision_json:string|null}
export interface FeeEnvelopeArchive {sha256:string;raw_json:string}
export interface FeeEnvelopeLedger {kind:'INTERNAL_FEE_APPLICATION_LEDGER';version:'1.0';business_id:string;history_origin:FeeEnvelopeOrigin;genesis_ref:string;receipt_refs:string[];retired_cost_ids:string[]}
export interface FeeEnvelopePayload {kind:'INTERNAL_FEE_APPLICATION_PAYLOAD';version:'1.0';project_json:string;bill_json:string}
export interface FeeEnvelopeRow {mapping_id:string;bill_id:string;line_id:string;cost_id:string;operation:'CREATE_NEW'|'REFERENCE_EXISTING'}
export interface FeeEnvelopeSourceRefs {project_ref:string;bill_ref:string;pair_ref:string;attachment_ref:string;precision_ref:string}
export interface FeeEnvelopePlan {kind:'INTERNAL_FEE_APPLICATION_PLAN';version:'1.0';business_id:string;transaction_id:string;sources:FeeEnvelopeSourceRefs;before_payload_ref:string;before_ledger_ref:string;rows:FeeEnvelopeRow[]}
export interface FeeEnvelopeReceipt {kind:'INTERNAL_FEE_APPLICATION_RECEIPT';version:'1.0';business_id:string;transaction_id:string;sequence:number;previous_sha256:string;plan_ref:string;before_payload_ref:string;after_payload_ref:string;before_ledger_ref:string;rows:FeeEnvelopeRow[];entry_sha256:string}
/** Independent internal file. Parsing or constructing a candidate never installs it. */
export interface FeeEnvelope {kind:'INTERNAL_FEE_APPLICATION_ENVELOPE';version:'1.0';envelope_id:string;business_id:string;revision:number;history_origin:FeeEnvelopeOrigin;current_sources:FeeEnvelopeSources;ledger_json:string;archives:FeeEnvelopeArchive[];content_sha256:string}
export interface FeeEnvelopeLease {envelope_id:string;business_id:string;revision:number;content_sha256:string}
export class FeeEnvelopeError extends Error {constructor(readonly reason:string){super('FEE_ENVELOPE_INVALID:'+reason);this.name='FeeEnvelopeError';}}
