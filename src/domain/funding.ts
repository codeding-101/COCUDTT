/** Explicit simple-interest assumption; format 1.2 may add principal events. */
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
  /** Only interpreted by settlement format 1.2. Legacy extension fields remain inactive. */
  balance_model?: 'CONSTANT' | 'EVENTS';
  events?: FundingPrincipalEvent[];
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
  segments: {start_date:string;end_date:string;days:number;principal:string;principal_days:string;cost:string;formula:string}[];
  events: (FundingPrincipalEvent & {before:string;after:string})[];
}
export const newFundingAssumption = (): FundingAssumption => ({
  status: 'UNCONFIRMED', kind: 'UNCONFIRMED', party: 'UNCONFIRMED', principal: '', currency: '',
  start_date: '', end_date: '', annual_rate: '', day_basis: 'UNCONFIRMED', reference: '',
});
