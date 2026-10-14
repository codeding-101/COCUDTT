import type {ContainerCharge} from './logistics.js';

/** Independent assumptions; no project field or responsibility/tax conclusion. */
interface ContainerBillLineBase {
 line_id:string;
 scope_id:string;
 direction:'IMPORT'|'EXPORT';
 equipment_type:string;
 container_ids:string[];
 currency:string;
 reference:string;
}
export interface ContainerBillTier {through_day:number|null;rate:string}
export interface ContainerBillPeriod {
 start_date:string;end_date:string;
 start_included:boolean;end_included:boolean;
 start_event:string;end_event:string;
}
export interface ContainerBillDailyLine extends ContainerBillLineBase {
 charge_kind:Extract<ContainerCharge,'DEMURRAGE'|'DETENTION'|'COMBINED_DD'>;
 mode:'DAILY';
 period:ContainerBillPeriod;
 daily:{free_day_basis:'CALENDAR_DAYS';charge_day_basis:'CALENDAR_DAYS';free_days:number;
  tier_mode:'MARGINAL';tier_basis:'AFTER_FREE_TIME'|'FROM_PERIOD_START';tiers:ContainerBillTier[]};
}
export interface ContainerBillFixedLine extends ContainerBillLineBase {
 charge_kind:Extract<ContainerCharge,'THC_ORIGIN'|'THC_DESTINATION'|'INSPECTION'>;
 mode:'PER_CONTAINER';rate:string;
}
export type ContainerBillLine=ContainerBillDailyLine|ContainerBillFixedLine;
export interface ContainerBillInput {version:'0.1';lines:ContainerBillLine[]}
export interface ContainerBillDay {
 date:string;period_day:number;billable_day:number|null;tier_day:number|null;
 status:'FREE'|'CHARGED';tier_index:number|null;rate:string|null;
 per_container_amount:string;amount:string;
}
export interface ContainerBillLineAudit {
 input:ContainerBillLine;container_count:number;amount:string;per_container_amount:string;
 selected_days:number|null;consumed_free_days:number|null;unused_free_days:number|null;billable_days:number|null;
 days:ContainerBillDay[];
 tier_totals:{tier_index:number;days:number;rate:string;per_container_amount:string;amount:string}[];
}
export interface ContainerBillOverlap {
 line_ids:[string,string];container_ids:string[];
 reason:'SAME_DAILY_SCOPE'|'COMBINED_AND_SEPARATE'|'SEPARATE_DD_SHARED_DAYS'|'SAME_FIXED_SCOPE';
 start_date:string|null;end_date:string|null;
}
export interface ContainerBillAudit {
 version:'0.1';scope:'ASSUMPTION_ONLY';lines:ContainerBillLineAudit[];
 potential_overlaps:ContainerBillOverlap[];
}
