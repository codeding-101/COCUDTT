import { chinaImportSampleProjectFile } from '../../src/data/sample-project';
import { toScenario, toTrade } from '../../src/data/project-file';
import { eligibilityValues } from '../../src/domain/import-context';
import { overrideEvidenceValues, quoteEvidenceValues } from '../../src/domain/contract-evidence';
import { evidenceKey, taxEvidenceValues, type SourceEvidence } from '../../src/domain/source-evidence';
import type { ProjectFile } from '../../src/data/project-file';
import type { Incoterm } from '../../src/domain/enums';
import { makeCostItem } from '../helpers/factory';

export function syntheticEvidence(values: unknown, changes: Partial<SourceEvidence> = {}): SourceEvidence {
  const evidence: SourceEvidence = { reference: '合成测试合同，非真实业务凭证', valid_from: '2026-09-01',
    valid_to: '2026-09-30', checked_on: '2026-10-11', status: 'USER_CONFIRMED', ...changes };
  evidence.values_key = evidenceKey(values, evidence);
  return evidence;
}

export function confirmQuote(p: ProjectFile, term: Incoterm, changes: Partial<SourceEvidence> = {}): void {
  p.term_scenarios![term]!.quote_evidence = syntheticEvidence(quoteEvidenceValues(toTrade(p), toScenario(p, term)), changes);
}
export function confirmOverride(p: ProjectFile, term: Incoterm, id: string, changes: Partial<SourceEvidence> = {}): void {
  p.term_scenarios![term]!.responsibility_overrides![id]!.evidence = syntheticEvidence(overrideEvidenceValues(toTrade(p), toScenario(p, term), id), changes);
}

/** 单商品、共同净价，FOB/CIF各自取得不同主运输报价；所有核对均为合成测试。 */
export function actualQuotesProject(): ProjectFile {
  const p = chinaImportSampleProjectFile();
  p.name = '独立FOB/CIF报价合成验收';
  p.goods.trade_value = { amount: '10000', currency: 'CNY' };
  p.goods.seller_goods_cost = { amount: '', currency: 'CNY' };
  p.fx_books = [];
  p.anchor = { kind: 'ACTUAL_QUOTES' };
  p.evaluation_date = '2026-09-10';
  p.term_scenarios = {
    FOB: { quote: { amount: '10000', currency: 'CNY', fx_type: 'CONTRACT', named_place: '汉堡港（合成）' } },
    CIF: { quote: { amount: '10700', currency: 'CNY', fx_type: 'CONTRACT', named_place: '上海港（合成）' } },
  };
  p.items = [
    makeCostItem({ cost_id: 'seller-freight', cost_name: '卖方运价', cost_category: 'MAIN_CARRIAGE', trade_node: 'MAIN_CARRIAGE', amount: '600', alternative_group: '主运输', applicable_incoterms: ['CIF'] }),
    makeCostItem({ cost_id: 'buyer-freight', cost_name: '买方运价', cost_category: 'MAIN_CARRIAGE', trade_node: 'MAIN_CARRIAGE', amount: '1000', alternative_group: '主运输', applicable_incoterms: ['FOB'] }),
    makeCostItem({ cost_id: 'insurance', cost_name: '保险费', cost_category: 'INSURANCE', trade_node: 'MAIN_CARRIAGE', amount: '100' }),
  ];
  const rules = p.tax_profile.import;
  rules.rateEvidence = syntheticEvidence(taxEvidenceValues(rules));
  rules.eligibility!.duty_evidence = syntheticEvidence(eligibilityValues('duty', p.route, p.goods.tax_key, rules));
  confirmQuote(p, 'FOB'); confirmQuote(p, 'CIF');
  return p;
}
