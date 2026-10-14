import type {CostItem} from './cost-item.js';
import type {Scenario} from './scenario.js';
import type {SourceEvidence} from './source-evidence.js';
import {transportEvidenceValues} from './logistics-evidence.js';

export const TRANSPORT_CHARGE_KINDS=['UNCONFIRMED','CARRIAGE','HANDLING','DELAY','INSPECTION','OTHER'] as const;
export type TransportChargeKind=typeof TRANSPORT_CHARGE_KINDS[number];
/** Independent API input, not a field in project 0.8 or settlement 1.5. */
export interface TransportCostLink {
 cost_id:string;
 state:'UNCONFIRMED'|'LINKED'|'NOT_APPLICABLE';
 /** Explicit continuous route range in original order; never auto-completed or sorted. */
 segment_ids:string[];
 charge_kind:TransportChargeKind;
 /** User-declared billable service scope; a matching label is only a review candidate. */
 scope_id:string;
 evidence?:SourceEvidence;
}
export interface TransportCostLinkInput {
 /** Explicit review scope; no inference from charge names or categories. */
 target_cost_ids:string[];
 links:TransportCostLink[];
}
/** Snapshot, not a signature. Changing cost, route, quote, term or basis requires review. */
export function transportCostLinkEvidenceValues(item:CostItem,scenario:Scenario,link:TransportCostLink):unknown{
 const {base_amount:_derived,...cost}=item;
 return{scenario_id:scenario.id,trade_id:scenario.trade_id,incoterm:scenario.incoterm,evaluation_date:scenario.contract_review?.evaluation_date,quote:scenario.quote,logistics_quote:scenario.logistics_quote,
  transport:transportEvidenceValues(scenario),cost,link:{cost_id:link.cost_id,state:link.state,segment_ids:[...link.segment_ids],charge_kind:link.charge_kind,scope_id:link.scope_id}};
}
