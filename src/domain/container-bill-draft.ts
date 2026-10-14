import type {SourceEvidence} from './source-evidence.js';

/** Editable conditions: absence/null/text are retained, never converted to financial defaults. */
export interface ContainerBillDraftLine {
 line_id:string;scope_id?:string;direction?:string;equipment_type?:string;container_ids?:string[];
 currency?:string;reference?:string;charge_kind?:string;mode?:string;rate?:string;
 period?:{start_date?:string;end_date?:string;start_included?:boolean|null;end_included?:boolean|null;start_event?:string;end_event?:string}|null;
 daily?:{free_day_basis?:string;charge_day_basis?:string;free_days?:number|null;tier_mode?:string;tier_basis?:string;tiers?:{through_day?:number|null;rate?:string}[]}|null;
}
export interface ContainerBillBinding {term:string;context_key:string}
export interface ContainerBillCostReference {cost_id:string;note:string;evidence?:SourceEvidence}
export interface ContainerBillDraftRow {input:ContainerBillDraftLine;evidence?:SourceEvidence;cost_reference?:ContainerBillCostReference}
export type BillJson=null|boolean|number|string|BillJson[]|{[key:string]:BillJson};
export interface ContainerBillDraft {
 kind:'INTERNAL_CONTAINER_BILL';version:'1.0';id:string;name:string;review_date:string;
 binding:ContainerBillBinding|null;notes:string;rows:ContainerBillDraftRow[];
 extensions?:{[key:string]:BillJson};
}
export function containerBillSourceValues(file:ContainerBillDraft,row:ContainerBillDraftRow):unknown {
 return{draft_id:file.id,binding:file.binding,review_date:file.review_date,input:row.input};
}
/** No currency, dates, rates, free time or endpoint defaults. */
export function emptyContainerBillDraft(id:string):ContainerBillDraft {
 return{kind:'INTERNAL_CONTAINER_BILL',version:'1.0',id,name:'',review_date:'',binding:null,notes:'',rows:[]};
}
