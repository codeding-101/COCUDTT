import {fullSources, empty} from './fee-envelope';
import {source, lease} from './fee-tax-attachment';
import {createContainerCostPair, serializeContainerCostPair} from '../../src/data/container-cost-pair';
import {bindContainerBillDraft} from '../../src/data/container-bill-context';
import {confirmContainerBillLine, confirmContainerBillCostReference} from '../../src/engine/container-bill-draft';
import {confirmContainerCostIntent} from '../../src/engine/container-cost-proposal';
import {createFeeTaxAttachment, setFeeTaxAttachmentRecord, acknowledgeFeeTaxAttachmentRecord, serializeFeeTaxAttachment} from '../../src/data/fee-tax-attachment';
import {createFeePrecisionSelection, addFeePrecisionSelectionRecord, acknowledgeFeePrecisionSelectionRecord, serializeFeePrecisionSelection} from '../../src/data/fee-precision-selection';
import {serializeProject} from '../../src/data/project-file';
import {serializeContainerBillDraft} from '../../src/data/container-bill-file';
import type {FeeEnvelopeSources} from '../../src/domain/fee-envelope';
import type {ContainerCostIntent} from '../../src/domain/container-cost-proposal';

export async function transactionFixture(amount = '113', version: '1.0' | '1.1' = '1.0', reference = false) {
  const s = await fullSources(amount, version, reference);
  const a = empty(s.sources).a;
  return {...s, a, raw: JSON.stringify(a)};
}
/** Two complete real-source rows, not a reduced transaction model. */
export async function batchFixture(mixed = false, extension = false) {
  const s = await fullSources(), project = structuredClone(s.pair.project);
  if (extension) (project as unknown as Record<string, unknown>).opaque_future = {note: 'PRIVATE76_😀', amount: '123.123456789123'};
  const original = s.pair.selection.intents[0]!; if (original.operation !== 'CREATE_NEW') throw Error('fixture');
  const inputs = [0, 1].map(i => ({...structuredClone(original), line_id: 'line-' + i, new_cost: {...structuredClone(original.new_cost), cost_id: 'new-' + i, amount: i ? '20' : '113', container_charge_scope: 'scope-' + i}}));
  let bill = structuredClone(s.pair.bill);
  bill.rows = inputs.map((i, n) => ({...structuredClone(bill.rows[0]!), input: {...structuredClone(bill.rows[0]!.input), line_id: i.line_id, scope_id: 'scope-' + n, container_ids: ['BOX-' + n], rate: i.new_cost.amount!}}));
  const {provenance: _, ...evidence} = source(), fields = {...evidence, status: 'UNVERIFIED' as const};
  if (mixed) { project.items.push(structuredClone(inputs[0]!.new_cost)); bill.rows[0]!.cost_reference = {cost_id: inputs[0]!.new_cost.cost_id, note: '只读已有'}; }
  bill = bindContainerBillDraft(bill, project);
  for (const row of bill.rows) bill = confirmContainerBillLine(bill, row.input.line_id, fields);
  if (mixed) bill = confirmContainerBillCostReference(bill, inputs[0]!.line_id, project, fields);
  const intents: ContainerCostIntent[] = inputs.map((i, n) => mixed && n === 0 ? {operation: 'REFERENCE_EXISTING', line_id: i.line_id, cost_id: i.new_cost.cost_id, note: '只读已有'} : confirmContainerCostIntent(project, bill, i, fields));
  const pair = createContainerCostPair(project, bill, {version: '0.1', intents}), pair_json = serializeContainerCostPair(pair);
  let attachment = await createFeeTaxAttachment(pair_json);
  for (const [n, target] of pair.mapping.entries.entries()) attachment = await setFeeTaxAttachmentRecord(attachment, lease(attachment), {...structuredClone(s.record), target, input: {...structuredClone(s.record.input), line_id: 'component-' + n, gross: inputs[n]!.new_cost.amount!}});
  for (const row of attachment.records) for (const facet of ['tax', 'credit', 'customs'] as const) attachment = await acknowledgeFeeTaxAttachmentRecord(attachment, lease(attachment), pair_json, row.record_id, facet);
  const attachment_json = await serializeFeeTaxAttachment(attachment); let precision = await createFeePrecisionSelection(pair_json, attachment_json);
  for (const component of attachment.records) precision = await addFeePrecisionSelectionRecord(precision, {revision: precision.revision, content_sha256: precision.content_sha256}, {component_record_id: component.record_id, channel: 'cash', choice: {kind: 'ROUND', policy: {kind: 'EXPLICIT', unit: '0.01', mode: 'HALF_UP', basis: '合成原币不变'}}});
  for (const row of precision.records) precision = await acknowledgeFeePrecisionSelectionRecord(precision, {revision: precision.revision, content_sha256: precision.content_sha256}, pair_json, attachment_json, row.record_id);
  const sources: FeeEnvelopeSources = {project_json: serializeProject(project), bill_json: serializeContainerBillDraft(bill), pair_json, attachment_json, precision_json: await serializeFeePrecisionSelection(precision)};
  const a = empty(sources).a; return {a, raw: JSON.stringify(a), pair, sources};
}
