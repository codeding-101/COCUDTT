import type { InsurancePlan, TransportPlan } from './logistics.js';
import type { Scenario } from './scenario.js';
import type { Goods } from './goods.js';

export function transportEvidenceValues(scenario: Scenario): unknown {
  const { evidence: _evidence, ...plan } = scenario.transport ?? {};
  return { incoterm: scenario.incoterm, facts: scenario.facts, named_place: (scenario.logistics_quote ?? scenario.quote).named_place, plan };
}
export function insuranceEvidenceValues(scenario: Scenario, goods: Goods): unknown {
  const { evidence: _evidence, ...policy } = scenario.insurance ?? {};
  const quote = scenario.logistics_quote ?? scenario.quote;
  return { incoterm: scenario.incoterm, contract_amount: quote.amount, contract_currency: quote.currency,
    goods: { name: goods.name, quantity: goods.quantity, unit: goods.unit, tax_key: goods.tax_key, trade_value: goods.trade_value },
    named_place: quote.named_place, policy, transport: scenario.transport ? transportEvidenceValues(scenario) : undefined };
}
export function emptyTransportPlan(): TransportPlan {
  return { segments: [], delivery_segment_id: '', delivery_location: '', delivery_at: 'ORIGIN',
    delivery_event: 'UNCONFIRMED', handover_basis: 'FIRST_CARRIER', agreement_note: '', paid_to: '' };
}
export function emptyInsurancePlan(currency: string): InsurancePlan {
  return { cover: 'UNCONFIRMED', clause_version: '', sum_insured: { amount: '', currency },
    insured_from: '', insured_to: '', scope_confirmed: false, direct_claim_confirmed: false,
    insurer: '', policy_reference: '', deductible: '', exclusions: '', agreed_cover_note: '' };
}
