/** Explicit simple-interest assumption; 1.2 adds principal events, 1.3 explicit rate events. */
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
  /** Interpreted by settlement 1.2/1.3. Legacy 1.1 extensions remain inactive. */
  balance_model?: 'CONSTANT' | 'EVENTS';
  events?: FundingPrincipalEvent[];
  /** Only interpreted by settlement format 1.3. */
  rate_model?: 'CONSTANT' | 'EVENTS';
  rate_events?: FundingRateEvent[];
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
