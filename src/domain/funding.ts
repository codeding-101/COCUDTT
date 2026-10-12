/** A single, explicitly specified constant-principal simple-interest assumption. */
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
}
export const newFundingAssumption = (): FundingAssumption => ({
  status: 'UNCONFIRMED', kind: 'UNCONFIRMED', party: 'UNCONFIRMED', principal: '', currency: '',
  start_date: '', end_date: '', annual_rate: '', day_basis: 'UNCONFIRMED', reference: '',
});
