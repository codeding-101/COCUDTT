import type {ContainerBillOverlap} from './container-bill.js';
import type {ContainerCostMapping} from './container-cost-pair.js';
import type {ContainerCostProposal} from './container-cost-proposal.js';
import type {Incoterm} from './enums.js';

export interface ContainerCoverageReview {
 line_ids:[string,string];
 status:'DISJOINT_BOXES'|'DISJOINT_DAYS'|'BOX_DAY_INTERSECTION'|'UNSUPPORTED';
 container_ids:string[];
 start_date:string|null;end_date:string|null;shared_box_days:number|null;
 issues:string[];
}
export interface ContainerParentReview {
 cost_id:string;parent_cost_id:string;issues:string[];
}
/** Transient audit only; not a project/pair field, confirmation or application contract. */
export interface ContainerCostReview {
 version:'0.1';scope:'READ_ONLY_BOUNDARIES';
 pair_id:string;revision:number;pair_key:string;term:Incoterm;target_count:number;
 issues:string[];proposal:ContainerCostProposal;
 rows:{
  mapping:ContainerCostMapping;original_amount:string|null;currency:string|null;
  core_precision:'EXACT'|'LOSS'|'UNKNOWN';
  channels:{cash_amount:string|null;economic_cost:null;customs_adjustment:null;
   tax_included:boolean|null;tax_rate_ref:string|null;customs_value:'ADD'|'EXCLUDE'|null};
  quote_inclusion:{recorded:boolean|null;basis:'CURRENT_SCENARIO_DERIVATION'|'PROPOSED_ITEM_FLAG'|'UNAVAILABLE';effect:'BUYER_EXTRA_ONLY_REQUIRES_RESPONSIBILITY'|'NOT_RECORDED'|'UNKNOWN'};
  issues:string[];
 }[];
 legacy_overlaps:ContainerBillOverlap[];
 coverage:ContainerCoverageReview[];
 existing_cost_candidates:{line_id:string;cost_id:string;issues:string[]}[];
 parent_relationships:ContainerParentReview[];
}
