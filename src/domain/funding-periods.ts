/** Standalone period inputs. Not part of any currently supported settlement file. */
export interface FundingPeriod {
  id: string;
  start_date: string;
  end_date: string;
  reference: string;
}
export interface FundingPeriodSchedule {
  status: 'UNCONFIRMED' | 'PROVIDED';
  reference: string;
  periods_confirmed: boolean;
  periods: FundingPeriod[];
}
export interface FundingPeriodRounding {
  status: 'UNCONFIRMED' | 'NOT_APPLIED' | 'APPLIED';
  scope: 'PERIODS';
  mode: 'UNCONFIRMED' | 'HALF_UP' | 'HALF_EVEN' | 'DOWN';
  unit: string;
  reference: string;
}
export const newFundingPeriodSchedule = (): FundingPeriodSchedule => ({status:'UNCONFIRMED',reference:'',periods_confirmed:false,periods:[]});
export const newFundingPeriodRounding = (): FundingPeriodRounding => ({status:'UNCONFIRMED',scope:'PERIODS',mode:'UNCONFIRMED',unit:'',reference:''});
export interface FundingPeriodFragment {
  /** Zero-based index in the original result's segment list, valid for this snapshot only. */
  segment_index: number;
  start_date: string;
  end_date: string;
  days: number;
  principal: string;
  annual_rate: string;
  principal_references: string[];
  rate_reference: string;
  unrounded_cost: string;
  unrounded_fraction: string;
}
export interface FundingPeriodAudit {
  scope: 'PERIODS';
  currency: string;
  mode: 'HALF_UP' | 'HALF_EVEN' | 'DOWN';
  unit: string;
  reference: string;
  schedule_reference: string;
  periods_confirmed: true;
  days: number;
  calculation_segment_count: number;
  unrounded_cost: string;
  unrounded_fraction: string;
  rounded_cost: string;
  total_rounded: string;
  scope_difference: string;
  adjustment: string;
  adjustment_fraction: string;
  periods: (FundingPeriod & {
    days: number;
    unrounded_cost: string;
    unrounded_fraction: string;
    rounded_cost: string;
    adjustment: string;
    adjustment_fraction: string;
    fragments: FundingPeriodFragment[];
  })[];
}
