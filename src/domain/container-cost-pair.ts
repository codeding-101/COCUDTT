import type {ProjectFile} from '../data/project-file.js';
import type {ContainerBillDraft} from './container-bill-draft.js';
import type {ContainerCostProposalInput,ContainerCostIntent} from './container-cost-proposal.js';

export interface ContainerCostMapping {
 mapping_id:string;bill_id:string;line_id:string;cost_id:string;operation:ContainerCostIntent['operation'];
}
/** Independent internal envelope. Mappings are proposals, never active project fees. */
export interface ContainerCostPair {
 kind:'INTERNAL_CONTAINER_COST_PAIR';version:'1.0';pair_id:string;revision:number;
 project:ProjectFile;bill:ContainerBillDraft;selection:ContainerCostProposalInput;
 mapping:{version:'0.1';entries:ContainerCostMapping[]};retired_mappings:ContainerCostMapping[];
 content_key:string;
}
