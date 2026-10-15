import type {Incoterm} from './enums.js';
import type {SourceEvidence} from './source-evidence.js';

export interface ReviewRowTarget {kind:'ROW';mapping_id:string;line_id:string;cost_id:string}
export interface ReviewBillPairTarget {kind:'BILL_PAIR';line_ids:[string,string]}
export interface ReviewExistingCostTarget {kind:'EXISTING_COST';mapping_id:string;line_id:string;cost_id:string;target_cost_id:string}
export interface ReviewParentTarget {kind:'PARENT';mapping_id:string;line_id:string;cost_id:string;parent_cost_id:string}
interface RecordDetails {explanation:string;evidence:SourceEvidence}
export type ContainerReviewRecordInput=RecordDetails & (
 | {decision:'QUOTE_INCLUDED'|'KEEP_RECORDED_AMOUNT';target:ReviewRowTarget}
 | {decision:'FULL_PARENT_INCLUSION';target:ReviewParentTarget;coverage:'FULL'}
 | {decision:'DIFFERENT_CHARGE_CONTENT';target:ReviewBillPairTarget|ReviewExistingCostTarget;left_description:string;right_description:string}
 | {decision:'DISJOINT_COVERAGE';target:ReviewBillPairTarget}
);
export type ContainerReviewRecord=ContainerReviewRecordInput & {record_id:string};
/** Independent record layer. Confirmation records assumptions; it never resolves fee issues. */
export interface ContainerCostReviewPlan {
 kind:'INTERNAL_CONTAINER_COST_REVIEW_PLAN';version:'0.1';plan_id:string;revision:number;
 basis:{pair_id:string;pair_revision:number;pair_key:string;term:Incoterm;review_date:string};
 records:ContainerReviewRecord[];retired_record_ids:string[];content_key:string;
}
