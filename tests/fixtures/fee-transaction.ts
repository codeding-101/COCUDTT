import {fullSources, empty} from './fee-envelope';
import {source, lease} from './fee-tax-attachment';
import {createContainerCostPair, serializeContainerCostPair, enableContainerCostReview} from '../../src/data/container-cost-pair';
import {bindContainerBillDraft} from '../../src/data/container-bill-context';
import {confirmContainerBillLine, confirmContainerBillCostReference} from '../../src/engine/container-bill-draft';
import {confirmContainerCostIntent} from '../../src/engine/container-cost-proposal';
import {createFeeTaxAttachment, setFeeTaxAttachmentRecord, acknowledgeFeeTaxAttachmentRecord, serializeFeeTaxAttachment} from '../../src/data/fee-tax-attachment';
import {createFeePrecisionSelection, addFeePrecisionSelectionRecord, acknowledgeFeePrecisionSelectionRecord, serializeFeePrecisionSelection} from '../../src/data/fee-precision-selection';
import {serializeProject, type ProjectFile} from '../../src/data/project-file';
import {serializeContainerBillDraft} from '../../src/data/container-bill-file';
import type {ContainerBillDraft} from '../../src/domain/container-bill-draft';
import type {FeeEnvelopeSources} from '../../src/domain/fee-envelope';
import type {ContainerCostIntent} from '../../src/domain/container-cost-proposal';
import {FeeTaxAttachmentError, type FeeTaxAttachmentRecordInput} from '../../src/domain/fee-tax-attachment';
import type {FeeTaxComponentInput} from '../../src/domain/fee-tax-components';
import {FeePrecisionSelectionError} from '../../src/domain/fee-precision-selection';

async function complete(project: ProjectFile, bill: ContainerBillDraft, inputs: ContainerCostIntent[], template: FeeTaxAttachmentRecordInput, version: '1.0' | '1.1') {
  const {provenance: _, ...evidence} = source(), fields = {...evidence, status: 'UNVERIFIED' as const};
  bill = bindContainerBillDraft(bill, project);
  for (const row of bill.rows) bill = confirmContainerBillLine(bill, row.input.line_id, fields);
  for (const input of inputs) if (input.operation === 'REFERENCE_EXISTING') bill = confirmContainerBillCostReference(bill, input.line_id, project, fields);
  const intents = inputs.map(i => i.operation === 'CREATE_NEW' ? confirmContainerCostIntent(project, bill, i, fields) : i);
  let pair = createContainerCostPair(project, bill, {version: '0.1', intents}); if (version === '1.1') pair = enableContainerCostReview(pair, pair.content_key);
  const pair_json = serializeContainerCostPair(pair); let attachment = await createFeeTaxAttachment(pair_json);
  for (const [n, target] of pair.mapping.entries.entries()) {
    const input = inputs[n]!, cost = input.operation === 'CREATE_NEW' ? input.new_cost : project.items.find(c => c.cost_id === input.cost_id)!;
    attachment = await setFeeTaxAttachmentRecord(attachment, lease(attachment), {...structuredClone(template), target, input: {...structuredClone(template.input), line_id: 'component-' + n, gross: cost.amount!}});
  }
  for (const row of attachment.records) for (const facet of ['tax', 'credit', 'customs'] as const) {
    try { attachment = await acknowledgeFeeTaxAttachmentRecord(attachment, lease(attachment), pair_json, row.record_id, facet); }
    catch (error) { if (!(error instanceof FeeTaxAttachmentError && error.reason === 'ACKNOWLEDGEMENT_NEEDS_REVIEW')) throw error; }
  }
  const attachment_json = await serializeFeeTaxAttachment(attachment); let precision = await createFeePrecisionSelection(pair_json, attachment_json);
  for (const component of attachment.records) precision = await addFeePrecisionSelectionRecord(precision, {revision: precision.revision, content_sha256: precision.content_sha256}, {component_record_id: component.record_id, channel: 'cash', choice: {kind: 'ROUND', policy: {kind: 'EXPLICIT', unit: '0.01', mode: 'HALF_UP', basis: '合成原币不变'}}});
  for (const row of precision.records) {
    try { precision = await acknowledgeFeePrecisionSelectionRecord(precision, {revision: precision.revision, content_sha256: precision.content_sha256}, pair_json, attachment_json, row.record_id); }
    catch (error) { if (!(error instanceof FeePrecisionSelectionError && error.reason === 'POLICY_NEEDS_REVIEW')) throw error; }
  }
  const sources: FeeEnvelopeSources = {project_json: serializeProject(project), bill_json: serializeContainerBillDraft(bill), pair_json, attachment_json, precision_json: await serializeFeePrecisionSelection(precision)};
  const a = empty(sources).a; return {a, raw: JSON.stringify(a), pair, sources};
}
export async function transactionFixture(amount = '113', version: '1.0' | '1.1' = '1.0', reference = false) {
  const s = await fullSources('113', version, reference), project = structuredClone(s.pair.project), inputs = structuredClone(s.pair.selection.intents), bill = structuredClone(s.pair.bill);
  // Explicit original commercial conversion, not an FX-policy candidate or inferred market data.
  for (const input of inputs) { const cost = input.operation === 'CREATE_NEW' ? input.new_cost : project.items.find(c => c.cost_id === input.cost_id)!; cost.fx_rate = '7'; cost.amount = amount; }
  bill.rows[0]!.input.rate = amount;
  return complete(project, bill, inputs, s.record, version);
}
export async function componentFixture(patch: Partial<FeeTaxComponentInput>) {
  const s = await fullSources(), inputs = structuredClone(s.pair.selection.intents);
  if (inputs[0]!.operation === 'CREATE_NEW') inputs[0]!.new_cost.fx_rate = '7';
  return complete(structuredClone(s.pair.project), structuredClone(s.pair.bill), inputs, {...s.record, input: {...s.record.input, ...patch}}, '1.0');
}
/** Two complete real-source rows, not a reduced transaction model. */
export async function batchFixture(mixed = false, extension = false, sameCharge = false) {
  const s = await fullSources(), project = structuredClone(s.pair.project);
  if (extension) (project as unknown as Record<string, unknown>).opaque_future = {note: 'PRIVATE76_😀', amount: '123.123456789123'};
  const original = s.pair.selection.intents[0]!; if (original.operation !== 'CREATE_NEW') throw Error('fixture');
  const inputs: ContainerCostIntent[] = [0, 1].map(i => ({...structuredClone(original), line_id: 'line-' + i, new_cost: {...structuredClone(original.new_cost), cost_id: 'new-' + i, amount: i ? '20' : '113', fx_rate: '7', container_charge_scope: 'scope-' + i}}));
  const bill = structuredClone(s.pair.bill); bill.rows = inputs.map((i, n) => ({...structuredClone(bill.rows[0]!), input: {...structuredClone(bill.rows[0]!.input), line_id: i.line_id, scope_id: 'scope-' + n, container_ids: ['BOX-' + n], rate: n ? '20' : '113'}}));
  if (mixed && !sameCharge && inputs[1]!.operation === 'CREATE_NEW') { bill.rows[1]!.input.charge_kind = 'THC_DESTINATION'; inputs[1]!.new_cost.container_charge = 'THC_DESTINATION'; }
  if (mixed && inputs[0]!.operation === 'CREATE_NEW') {const cost = inputs[0]!.new_cost; project.items.push(structuredClone(cost)); bill.rows[0]!.cost_reference = {cost_id: cost.cost_id, note: '只读已有'}; inputs[0] = {operation: 'REFERENCE_EXISTING', line_id: inputs[0]!.line_id, cost_id: cost.cost_id, note: '只读已有'};}
  return complete(project, bill, inputs, s.record, '1.0');
}
