/** Synthetic software fixture only. Never shipped to, imported by, or offered as a business template in the tool. */
import {fullSources, empty} from '../tests/fixtures/fee-envelope';
import {source} from '../tests/fixtures/fee-tax-attachment';
import {bindContainerBillDraft} from '../src/data/container-bill-context';
import {confirmContainerBillLine} from '../src/engine/container-bill-draft';
import {confirmContainerCostIntent} from '../src/engine/container-cost-proposal';
import {createContainerCostPair, serializeContainerCostPair} from '../src/data/container-cost-pair';
import {createFeeTaxAttachment, setFeeTaxAttachmentRecord, acknowledgeFeeTaxAttachmentRecord, serializeFeeTaxAttachment} from '../src/data/fee-tax-attachment';
import {createFeePrecisionSelection, addFeePrecisionSelectionRecord, acknowledgeFeePrecisionSelectionRecord, serializeFeePrecisionSelection} from '../src/data/fee-precision-selection';
import {serializeProject} from '../src/data/project-file';
import {serializeContainerBillDraft} from '../src/data/container-bill-file';
import type {ContainerCostIntent} from '../src/domain/container-cost-proposal';
import type {FeeEnvelopeSources} from '../src/domain/fee-envelope';

export async function feePerformanceFixture(count: number) {
  if (![1, 4, 8].includes(count)) throw Error('PERFORMANCE_FIXTURE_COUNT');
  const base = await fullSources(), project = structuredClone(base.pair.project);
  const original = base.pair.selection.intents[0]!;
  if (original.operation !== 'CREATE_NEW') throw Error('PERFORMANCE_FIXTURE_INTENT');
  const bill = structuredClone(base.pair.bill);
  bill.rows = Array.from({length: count}, (_, i) => ({
    ...structuredClone(base.pair.bill.rows[0]!),
    input: {...structuredClone(base.pair.bill.rows[0]!.input), line_id: 'perf-line-' + i, scope_id: 'perf-scope-' + i, container_ids: ['SYNTHETIC-PERF-' + i], rate: '113'},
  }));
  const {provenance: _, ...reference} = source(), evidence = {...reference, status: 'UNVERIFIED' as const};
  let bound = bindContainerBillDraft(bill, project);
  for (const row of bound.rows) bound = confirmContainerBillLine(bound, row.input.line_id, evidence);
  const intents: ContainerCostIntent[] = bound.rows.map((row, i) => confirmContainerCostIntent(project, bound, {
    ...structuredClone(original), line_id: row.input.line_id,
    new_cost: {...structuredClone(original.new_cost), cost_id: 'perf-cost-' + i, container_charge_scope: row.input.scope_id, amount: '113', fx_rate: '7'},
    note: 'SYNTHETIC_PERFORMANCE_ONLY: not a real bill or permission to apply fees',
  }, evidence));
  const pair = createContainerCostPair(project, bound, {version: '0.1', intents}), pair_json = serializeContainerCostPair(pair);
  let attachment = await createFeeTaxAttachment(pair_json);
  for (const [i, target] of pair.mapping.entries.entries()) {
    attachment = await setFeeTaxAttachmentRecord(attachment, {revision: attachment.revision, content_sha256: attachment.content_sha256}, {
      ...structuredClone(base.record), target, input: {...structuredClone(base.record.input), line_id: 'perf-component-' + i, gross: '113'},
    });
  }
  for (const row of attachment.records) for (const facet of ['tax', 'credit', 'customs'] as const) {
    attachment = await acknowledgeFeeTaxAttachmentRecord(attachment, {revision: attachment.revision, content_sha256: attachment.content_sha256}, pair_json, row.record_id, facet);
  }
  const attachment_json = await serializeFeeTaxAttachment(attachment);
  let precision = await createFeePrecisionSelection(pair_json, attachment_json);
  for (const component of attachment.records) precision = await addFeePrecisionSelectionRecord(precision, {revision: precision.revision, content_sha256: precision.content_sha256}, {
    component_record_id: component.record_id, channel: 'cash', choice: {kind: 'ROUND', policy: {kind: 'EXPLICIT', unit: '0.01', mode: 'HALF_UP', basis: 'Synthetic performance only; original amount unchanged'}},
  });
  for (const row of precision.records) precision = await acknowledgeFeePrecisionSelectionRecord(precision, {revision: precision.revision, content_sha256: precision.content_sha256}, pair_json, attachment_json, row.record_id);
  const sources: FeeEnvelopeSources = {project_json: serializeProject(project), bill_json: serializeContainerBillDraft(bound), pair_json, attachment_json, precision_json: await serializeFeePrecisionSelection(precision)};
  return {kind: 'SYNTHETIC_FEE_PERFORMANCE_FIXTURE' as const, count, pair, sources, raw: JSON.stringify(empty(sources).a)};
}
