import type {ProjectFile} from '../data/project-file.js';
import type {ContainerBillDraft} from './container-bill-draft.js';
import type {ContainerCostProposalInput,ContainerCostIntent} from './container-cost-proposal.js';
import type {ContainerCostReviewPlan} from './container-cost-review-plan.js';

export interface ContainerCostMapping {
 mapping_id:string;bill_id:string;line_id:string;cost_id:string;operation:ContainerCostIntent['operation'];
}
/** Independent internal envelope. Mappings are proposals, never active project fees. */
export interface ContainerCostPair {
 kind:'INTERNAL_CONTAINER_COST_PAIR';version:'1.0'|'1.1';pair_id:string;revision:number;
 project:ProjectFile;bill:ContainerBillDraft;selection:ContainerCostProposalInput;
 mapping:{version:'0.1';entries:ContainerCostMapping[]};retired_mappings:ContainerCostMapping[];
 content_key:string;
 /** Active in 1.1 only; runtime requires exact version/field and business-basis matching. */
 review_plan?:ContainerCostReviewPlan;
}
