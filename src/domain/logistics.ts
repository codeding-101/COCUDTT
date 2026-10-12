import type { CarriageMode } from './enums.js';
import type { SourceEvidence } from './source-evidence.js';

export const DELIVERY_EVENTS = ['UNCONFIRMED', 'AVAILABLE', 'LOADED', 'READY_UNLOAD', 'ALONGSIDE', 'ON_BOARD', 'CARRIER_HANDOVER', 'UNLOADED'] as const;
export type DeliveryEvent = typeof DELIVERY_EVENTS[number];
export const DELIVERY_EVENT_LABELS: Record<DeliveryEvent, string> = {
  UNCONFIRMED: '交货事件待确认', AVAILABLE: '置于买方处置，未装货', LOADED: '装上买方安排的车辆，装货完成',
  READY_UNLOAD: '到达指定地点，准备卸货', ALONGSIDE: '置于指定船舶旁', ON_BOARD: '装上指定船舶',
  CARRIER_HANDOVER: '交给卖方签约承运人', UNLOADED: '指定目的地卸货完成',
};
export interface TransportSegment {
  segment_id: string;
  mode: Exclude<CarriageMode, 'MULTIMODAL'>;
  from: string;
  to: string;
  carrier: string;
  contract_reference: string;
}
export interface TransportPlan {
  segments: TransportSegment[];
  delivery_segment_id: string;
  delivery_location: string;
  delivery_at: 'ORIGIN' | 'DESTINATION';
  delivery_event: DeliveryEvent;
  handover_basis: 'FIRST_CARRIER' | 'AGREED_POINT';
  agreement_note: string;
  /** 卖方运输义务的支付终点，独立于风险点。 */
  paid_to: string;
  evidence?: SourceEvidence;
}
export const INSURANCE_COVERS = ['UNCONFIRMED', 'ICC_A', 'ICC_B', 'ICC_C', 'EQUIVALENT', 'OTHER'] as const;
export type InsuranceCover = typeof INSURANCE_COVERS[number];
export interface InsurancePlan {
  cover: InsuranceCover;
  clause_version: string;
  sum_insured: { amount: string; currency: string };
  insured_from: string;
  insured_to: string;
  scope_confirmed: boolean;
  direct_claim_confirmed: boolean;
  insurer: string;
  policy_reference: string;
  deductible: string;
  exclusions: string;
  /** 偏离默认险别时记录双方约定；不自动免除最低保额及保障区间检查。 */
  agreed_cover_note: string;
  evidence?: SourceEvidence;
}
export const CONTAINER_CHARGES = ['THC_ORIGIN', 'THC_DESTINATION', 'DEMURRAGE', 'DETENTION', 'COMBINED_DD', 'INSPECTION'] as const;
export type ContainerCharge = typeof CONTAINER_CHARGES[number];
