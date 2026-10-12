import type { Incoterm } from '../../src/domain/enums';
import { emptyTransportPlan, transportEvidenceValues } from '../../src/domain/logistics-evidence';
import type { ProjectFile } from '../../src/data/project-file';
import { toScenario } from '../../src/data/project-file';
import { actualQuotesProject, confirmInsurance, confirmQuote, syntheticEvidence } from './actual-quotes';

export function confirmTransport(project: ProjectFile, term = project.incoterm): void {
  project.term_scenarios![term]!.transport!.evidence = syntheticEvidence(transportEvidenceValues(toScenario(project, term)));
}
export function logisticsProject(term: Incoterm = 'CIP'): ProjectFile {
  const p = actualQuotesProject();
  p.incoterm = term; p.carriage_mode = ['CIP', 'CPT'].includes(term) ? 'MULTIMODAL' : 'SEA';
  const record = structuredClone(p.term_scenarios!.CIF!); p.term_scenarios![term] = record;
  p.items[0]!.applicable_incoterms = ['CIF', 'CIP', 'CPT'];
  record.quote!.named_place = term === 'CIF' ? '上海港' : '上海仓库';
  record.transport = { ...emptyTransportPlan(), segments: [
    { segment_id: 'road-origin', mode: 'ROAD', from: '汉堡工厂', to: '汉堡港', carrier: '合成公路承运人', contract_reference: '合成陆运001' },
    { segment_id: 'sea', mode: 'SEA', from: '汉堡港', to: '上海港', carrier: '合成海运承运人', contract_reference: '合成海运002' },
    { segment_id: 'road-destination', mode: 'ROAD', from: '上海港', to: '上海仓库', carrier: '合成目的地承运人', contract_reference: '合成短驳003' },
  ], delivery_segment_id: term === 'CIF' ? 'sea' : 'road-origin', delivery_location: term === 'CIF' ? '汉堡港' : '汉堡工厂',
    delivery_event: term === 'CIF' ? 'ON_BOARD' : 'CARRIER_HANDOVER', paid_to: record.quote!.named_place! };
  if (term === 'CPT') { delete record.insurance; record.quote!.amount = '10600'; }
  else {
    record.insurance!.cover = term === 'CIF' ? 'ICC_C' : 'ICC_A';
    record.insurance!.insured_from = record.transport.delivery_location; record.insurance!.insured_to = record.quote!.named_place!;
  }
  confirmQuote(p, term); confirmTransport(p, term); if (record.insurance) confirmInsurance(p, term);
  return p;
}
