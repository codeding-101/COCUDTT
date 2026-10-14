import type {CostItem} from './cost-item.js';
import type {SourceEvidence} from './source-evidence.js';

export type ContainerCostIntent =
 | {line_id:string;operation:'REFERENCE_EXISTING';cost_id:string;note:string}
 | {line_id:string;operation:'CREATE_NEW';new_cost:CostItem;note:string;evidence?:SourceEvidence};
export interface ContainerCostProposalInput {version:'0.1';intents:ContainerCostIntent[]}
/** Review only. Neither the snapshot nor absence of issues authorizes financial writes. */
export interface ContainerCostProposal {
 version:'0.1';scope:'NO_WRITE_PROPOSAL';snapshot_key:string;issues:string[];
 rows:{line_id:string;operation:ContainerCostIntent['operation'];cost_id:string;original_amount:string|null;
  proposed_cost:CostItem|null;issues:string[];source_issues:string[]}[];
}
