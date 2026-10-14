import type {FundingPeriodSchedule} from './funding-periods.js';
/** Explicit simple interest; 1.2 principal events, 1.3 rate events, 1.4 rounding, 1.5 explicit periods. */
export interface FundingAssumption {
  status: 'UNCONFIRMED' | 'NOT_MODELED' | 'PROVIDED';
  kind: 'UNCONFIRMED' | 'FINANCING' | 'OPPORTUNITY';
  party: 'UNCONFIRMED' | 'BUYER' | 'SELLER';
  principal: string;
  currency: string;
  start_date: string;
  end_date: string;
  annual_rate: string;
  day_basis: 'UNCONFIRMED' | 'ACT_365F' | 'ACT_360';
  reference: string;
  /** Interpreted from settlement 1.2. Legacy 1.1 extensions remain inactive. */
  balance_model?: 'CONSTANT' | 'EVENTS';
  events?: FundingPrincipalEvent[];
  /** Interpreted from settlement 1.3. */
  rate_model?: 'CONSTANT' | 'EVENTS';
  rate_events?: FundingRateEvent[];
  /** Only interpreted by settlement format 1.4/1.5. */
  rounding?: FundingRoundingAssumption;
  /** Only interpreted by settlement 1.5; old same-name extensions remain inactive. */
  period_schedule?: FundingPeriodSchedule;
}
export interface FundingRoundingAssumption {
  status:'UNCONFIRMED'|'NOT_APPLIED'|'APPLIED';
  scope:'UNCONFIRMED'|'TOTAL'|'INTERVALS'|'PERIODS';
  mode:'UNCONFIRMED'|'HALF_UP'|'HALF_EVEN'|'DOWN';
  unit:string;
  reference:string;
  /** Explicit user assertion: computed intervals are the intended rounding boundaries. */
  intervals_confirmed:boolean;
}
export const newFundingRounding=():FundingRoundingAssumption=>({status:'UNCONFIRMED',scope:'UNCONFIRMED',mode:'UNCONFIRMED',unit:'',reference:'',intervals_confirmed:false});
export interface FundingRoundingAudit {
  scope:'TOTAL'|'INTERVALS';mode:'HALF_UP'|'HALF_EVEN'|'DOWN';unit:string;reference:string;
  rounded_cost:string;total_rounded:string;interval_rounded:string;scope_difference:string;
  unrounded_fraction:string;adjustment:string;adjustment_fraction:string;
  intervals:{start_date:string;end_date:string;unrounded_cost:string;unrounded_fraction:string;rounded_cost:string;adjustment:string;adjustment_fraction:string}[];
}
export interface FundingRateEvent { id:string; date:string; annual_rate:string; reference:string }
export const newFundingRateEvent=(id:string):FundingRateEvent=>({id,date:'',annual_rate:'',reference:''});
export interface FundingRateAudit {
  closing_rate:string;
  weighted_principal_rate_days:string;
  events:(FundingRateEvent & {before:string;after:string})[];
}
export interface FundingPrincipalEvent {
  id: string;
  direction: 'INCREASE' | 'DECREASE';
  amount: string;
  currency: string;
  date: string;
  reference: string;
}
export const newFundingPrincipalEvent = (id: string): FundingPrincipalEvent => ({id,direction:'INCREASE',amount:'',currency:'',date:'',reference:''});
export interface FundingLedgerAudit {
  closing_principal: string;
  principal_days: string;
  segments: {start_date:string;end_date:string;days:number;principal:string;principal_days:string;cost:string;formula:string;annual_rate?:string;rate_reference?:string}[];
  events: (FundingPrincipalEvent & {before:string;after:string})[];
}
export const newFundingAssumption = (): FundingAssumption => ({
  status: 'UNCONFIRMED', kind: 'UNCONFIRMED', party: 'UNCONFIRMED', principal: '', currency: '',
  start_date: '', end_date: '', annual_rate: '', day_basis: 'UNCONFIRMED', reference: '',
});
