import {WorkbenchStateOwner} from '../src/ui/workbench-state';
import {ContainerBillController} from '../src/ui/container-bill-controller';
import {ContainerCostPairController} from '../src/ui/container-cost-pair-controller';
import {FeeTaxAttachmentWorkspace} from '../src/ui/fee-tax-attachment-workspace';
import {FeePrecisionSelectionWorkspace} from '../src/ui/fee-precision-selection-workspace';
import {FeeEnvelopeWorkspace} from '../src/ui/fee-envelope-workspace';
import {RuntimeFeeWorkbenchCandidatePreparer} from '../src/ui/fee-workbench-candidate';
import {captureRuntimeFeeWorkbench, type RuntimeFeeWorkbenchCapture} from '../src/ui/fee-workbench-preview';
import {booksToRows} from '../src/ui/fx-rows';
import {unknownFileEvidence} from '../src/ui/file-evidence';
import {parseProject, serializeProject} from '../src/data/project-file';
import {parseContainerBillDraft, serializeContainerBillDraft} from '../src/data/container-bill-file';
import {parseContainerCostPair, serializeContainerCostPair} from '../src/data/container-cost-pair';
import type {FeeEnvelopeSources} from '../src/domain/fee-envelope';

/** Real ten-participant controller harness. No DOM, global storage, renderer or application entry. */
export async function feePerformanceHarness(raw: string) {
  const source = JSON.parse(raw).current_sources as FeeEnvelopeSources, owner = new WorkbenchStateOwner();
  const project = parseProject(source.project_json);
  const app = {project, fxRows: booksToRows(project.fx_books), result: null, comparison: null, error: null, dirty: true, status: '', statusLevel: 'info', fileEvidence: unknownFileEvidence()};
  const workflow = {projectReadEpoch: 0, settlementEpoch: 0, recoveryReviewEpoch: 0, projectReadToken: null, pendingCalculation: false, editedControl: null,
    pairFxLease: {row_key: JSON.stringify(app.fxRows), books: project.fx_books}, customerReviewed: true, customerPreview: null, customerError: null,
    sensitivityAnalysis: null, sensitivityError: null, inputLocations: [], calculatedAt: '', workspaceNote: '', customerFields: {reference: 'SYNTHETIC_PERFORMANCE_ONLY'}, settlementPlan: null};
  owner.bind(app, 'app'); owner.bind(workflow, 'workflow');
  const data = new Map<string, string>(), storage = {getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => {data.set(key, value);}};
  const noop = () => {}, write = async () => {throw Error('PERFORMANCE_FILE_WRITE_FORBIDDEN');};
  const bill = new ContainerBillController({stateOwner: owner, project: () => app.project, blocked: () => false, render: noop, write});
  bill.installPrepared(parseContainerBillDraft(source.bill_json), source.bill_json);
  const pair = new ContainerCostPairController({stateOwner: owner, project: () => app.project, bill: () => bill.draft, blocked: () => false, render: noop, write, install: noop, afterInstall: noop, cancelOtherReads: noop});
  pair.pair = parseContainerCostPair(source.pair_json!);
  const pairText = () => serializeContainerCostPair(pair.pair!);
  const taxUi = new FeeTaxAttachmentWorkspace({stateOwner: owner, storage, currentPairText: pairText, blocked: () => false, write});
  await taxUi.controller.openFile({name: 'synthetic-tax.json', text: async () => source.attachment_json!});
  await taxUi.controller.adoptPreview(taxUi.controller.state().preview!.token);
  const precisionUi = new FeePrecisionSelectionWorkspace({stateOwner: owner, storage, currentSources: () => ({pair_json: pairText(), attachment_json: JSON.stringify(taxUi.controller.state().attachment, null, 2) + '\n'}), blocked: () => false, write});
  await precisionUi.controller.openFile({name: 'synthetic-precision.json', text: async () => source.precision_json!});
  await precisionUi.controller.adoptPreview(precisionUi.controller.state().preview!.token);
  const envelopeUi = new FeeEnvelopeWorkspace({stateOwner: owner, storage: {getItem: storage.getItem, compareAndSet: () => {throw Error('PERFORMANCE_CACHE_WRITE_FORBIDDEN');}}, cacheWritable: false, currentSources: () => sources(), blocked: () => false, write});
  await envelopeUi.controller.openFile({arrayBuffer: async () => new TextEncoder().encode(raw).buffer});
  await envelopeUi.controller.adoptIncoming(envelopeUi.controller.state().preview!.token, {acknowledge_unverifiable: true});
  function sources(): FeeEnvelopeSources {
    return {project_json: serializeProject(app.project), bill_json: serializeContainerBillDraft(bill.draft!), pair_json: pairText(), attachment_json: JSON.stringify(taxUi.controller.state().attachment, null, 2) + '\n', precision_json: JSON.stringify(precisionUi.controller.state().selection, null, 2) + '\n'};
  }
  function captureInput(): RuntimeFeeWorkbenchCapture {
    const b = bill.workbenchCapture(), p = pair.workbenchCapture(), tax = taxUi.controller.workbenchCapture(), precision = precisionUi.controller.workbenchCapture(), envelope = envelopeUi.controller.workbenchCapture();
    return {scope: 'RUNTIME_FEE_WORKBENCH_CAPTURE', envelope_json: envelope.current!.raw_json, sources: sources(),
      fx: {rows_json: JSON.stringify(app.fxRows), preserved_row_key: workflow.pairFxLease.row_key, preserved_books_json: JSON.stringify(workflow.pairFxLease.books)},
      files: {project: app.fileEvidence, bill: b.file_evidence, pair: p.file_evidence, attachment: tax.file_evidence, precision: precision.file_evidence, envelope: envelope.file_evidence},
      editors: {cost: null, review: null, attachment: null, precision: null, pending_input: null},
      activity: {project_read: false, bill_read: b.reading, pair_read: p.reading, attachment_mutation: tax.reading || tax.mutation_busy, precision_mutation: precision.reading || precision.mutation_busy, recovery: false},
      retained_json: JSON.stringify({harness: 'NODE_TEN_CONTROLLERS_NO_DOM', project_raw: app.project, bill: b, pair: p, tax, precision, envelope,
        tax_workspace: taxUi.workbenchCapture(), precision_workspace: precisionUi.workbenchCapture(), envelope_workspace: envelopeUi.workbenchCapture(), workflow, storage: Object.fromEntries(data)}), blockers: []};
  }
  const capture = () => captureRuntimeFeeWorkbench(captureInput());
  const preparer = new RuntimeFeeWorkbenchCandidatePreparer({owner, capture, targets: {app, workflow, bill, pair, tax: taxUi.controller, precision: precisionUi.controller, envelope: envelopeUi.controller, taxUi, precisionUi, envelopeUi}});
  /** Development-only explicit producer projections. No parsing of retained_json or runtime installation. */
  const sourceViewReaders = () => [
    {producer: 'project' as const, read: () => ({...app})},
    {producer: 'workflow' as const, read: () => ({...workflow, storage: Object.fromEntries(data)})},
    {producer: 'bill' as const, read: () => ({...bill.workbenchCapture(), draft: bill.draft})},
    {producer: 'pair' as const, read: () => ({...pair.workbenchCapture(), pair: pair.pair, editor: pair.editor, review_editor: pair.reviewEditor})},
    {producer: 'attachment' as const, read: () => taxUi.controller.workbenchCapture()},
    {producer: 'precision' as const, read: () => precisionUi.controller.workbenchCapture()},
    {producer: 'envelope' as const, read: () => envelopeUi.controller.workbenchCapture()},
    {producer: 'attachment_workspace' as const, read: () => taxUi.workbenchCapture()},
    {producer: 'precision_workspace' as const, read: () => precisionUi.workbenchCapture()},
    {producer: 'envelope_workspace' as const, read: () => envelopeUi.workbenchCapture()},
  ];
  return {owner, app, workflow, taxUi, precisionUi, envelopeUi, captureInput, capture, preparer, sourceViewReaders};
}
