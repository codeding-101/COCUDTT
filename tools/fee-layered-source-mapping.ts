/** Borrowed, synchronous developer observation. Feed immediately to a checkpoint-bound diagnostic codec. */
import {copyFeeEnvelopeJson as copy} from '../src/data/fee-envelope-json';
import {serializeProject, type ProjectFile} from '../src/data/project-file';
import {serializeContainerBillDraft} from '../src/data/container-bill-file';
import {serializeContainerCostPair} from '../src/data/container-cost-pair';
import {FEE_SOURCE_STORAGE_KEYS, type FeeSourceReaders, type FeeSourceProject, type FeeSourceWorkflow} from '../src/ui/fee-workbench-source-readers';
import {rowsToBooks, type FxRow} from '../src/ui/fx-rows';
import {unknownFileEvidence, type FileEvidence} from '../src/ui/file-evidence';
import type {WorkbenchStateOwner} from '../src/ui/workbench-state';
import type {FeeLayeredCaptureParts} from './fee-layered-capture-prototype';

export class FeeLayeredSourceMappingError extends Error {constructor(readonly code: 'INVALID' | 'STALE') {super('FEE_LAYERED_SOURCE_MAPPING_' + code);}}
function fail(): never {throw new FeeLayeredSourceMappingError('INVALID');}
function stale(): never {throw new FeeLayeredSourceMappingError('STALE');}
type Data = Record<string, unknown>;
const workflowFields = ['stateInitialized','pendingCalculation','pairFxLease','projectReadEpoch','projectReadToken','settlementEpoch','settlementPlan','sensitivityControls','customerFields','customerView','customerReviewed','recoveryStage','recoveryReviewBusy','projectSaveBusy','projectResourceBusy','settlementBusy','customerSummaryBusy','customerPdfBusy'];
function own(value: unknown, required: readonly string[], exact = true): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const ds = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(ds);
  if (keys.some(k => typeof k !== 'string' || !ds[k]?.enumerable || !('value' in ds[k]!)) || required.some(k => !Object.hasOwn(ds, k)) || exact && keys.length !== required.length) fail();
  return Object.fromEntries(keys.map(k => [k, ds[k as string]!.value]));
}
const text = (v: unknown) => v === null || typeof v === 'string';
const record = (v: unknown) => v === null || !!v && typeof v === 'object' && !Array.isArray(v);
const epoch = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
function bool(value: Data, fields: readonly string[]) {if (fields.some(k => typeof value[k] !== 'boolean')) fail();}
function evidence(value: unknown): FileEvidence {const e = own(value, ['name','saved_raw','saved_at']); if (Object.values(e).some(v => !text(v))) fail(); return e as unknown as FileEvidence;}
function holder(value: unknown): Data {
  const h = own(value, ['file_evidence','epoch','reading','write_busy'], false); evidence(h.file_evidence); bool(h, ['reading','write_busy']); if (!epoch(h.epoch)) fail(); return h;
}
/** No full retained JSON is created here. Returned nested values are borrowed, not an issued immutable snapshot. */
export function readFeeLayeredWorkbenchRoots(owner: WorkbenchStateOwner, readers: FeeSourceReaders): FeeLayeredCaptureParts {
  const checkpoint = owner.checkpoint(), current = () => {if (!owner.isCurrent(checkpoint)) stale();};
  const observe = <T>(read: () => T): T => {current(); const value = read(); current(); return value;};
  const copied = <T>(value: T): T => observe(() => copy(value)) as T;
  const bill = own(observe(() => readers.bill()), ['capture','draft']), pair = own(observe(() => readers.pair()), ['capture','pair','editor','reviewEditor']);
  const tax = holder(observe(() => readers.attachment())), precision = holder(observe(() => readers.precision())), envelope = holder(observe(() => readers.envelope()));
  const taxUi = own(observe(() => readers.attachment_workspace()), ['pending','export_busy'], false), precisionUi = own(observe(() => readers.precision_workspace()), ['pending','export_busy'], false);
  const envelopeUi = own(observe(() => readers.envelope_workspace()), ['pending','busy','exporting'], false);
  const workflow = own(observe(() => readers.workflow()), workflowFields) as unknown as FeeSourceWorkflow;
  bool(workflow as unknown as Data, ['stateInitialized','pendingCalculation','customerReviewed','recoveryReviewBusy','projectSaveBusy','projectResourceBusy','settlementBusy','customerSummaryBusy','customerPdfBusy']);
  if (!epoch(workflow.projectReadEpoch) || !epoch(workflow.settlementEpoch) || workflow.projectReadToken !== null && !epoch(workflow.projectReadToken) || !text(workflow.recoveryStage) || typeof workflow.customerView !== 'string') fail();
  copied(workflow.recoveryStage);
  const app = workflow.stateInitialized ? own(observe(() => readers.project()), ['project','fxRows','fileEvidence','fileName','savedAt','dirty']) as unknown as FeeSourceProject : null;
  if (app && (!record(app.project) || app.project === null || !Array.isArray(app.fxRows) || !text(app.fileName) || !text(app.savedAt) || typeof app.dirty !== 'boolean')) fail();
  const projectFile = app ? evidence(copied(evidence(app.fileEvidence))) : unknownFileEvidence();
  const pending = own(observe(() => readers.pending()), ['present','control']); bool(pending, ['present']); if (pending.control !== null && !pending.present) fail();
  const storage = own(observe(() => readers.storage()), FEE_SOURCE_STORAGE_KEYS);
  const billCapture = holder(bill.capture), pairCapture = holder(pair.capture);
  for (const [h, source] of [[tax, 'attachment'], [precision, 'selection']] as const) {
    own(h, [source,'editor','mutation_busy','preview','recovery','read_token'], false); bool(h, ['mutation_busy']);
    if ([source,'editor','preview','recovery'].some(k => !record(h[k])) || !epoch(h.read_token)) fail();
  }
  own(envelope, ['current','mutation_busy','cache_busy','preview','read_token'], false); bool(envelope, ['mutation_busy','cache_busy']);
  if (!record(envelope.current) || !record(envelope.preview) || !epoch(envelope.read_token)) fail();
  const envelopeCurrent = envelope.current === null ? null : own(envelope.current, ['raw_json'], false);
  if (envelopeCurrent && typeof envelopeCurrent.raw_json !== 'string') fail();
  for (const ui of [taxUi, precisionUi]) {bool(ui, ['export_busy']); if (!record(ui.pending)) fail();}
  bool(envelopeUi, ['busy','exporting']); if (!record(envelopeUi.pending)) fail();
  if (pending.control !== null) {const c = own(pending.control, ['tag','id','type','value','dataset','connected']); bool(c, ['connected']); if (['tag','id','type','value'].some(k => typeof c[k] !== 'string') || Object.values(own(c.dataset, [], false)).some(v => typeof v !== 'string')) fail();}
  for (const value of Object.values(storage)) {const s = own(value, ['raw','available']); bool(s, ['available']); if (!text(s.raw) || !s.available && s.raw !== null) fail();}
  // Independent source roots are guarded before any serializer can encounter toJSON/accessors.
  const project = app ? copied(app.project) : null, draft = copied(bill.draft), currentPair = copied(pair.pair), editor = copied(pair.editor), review = copied(pair.reviewEditor), rows = copied(app?.fxRows ?? []) as FxRow[];
  const attachment = copied(tax.attachment), selection = copied(precision.selection), taxEditor = copied(tax.editor), precisionEditor = copied(precision.editor);
  if ([draft,currentPair,editor,review].some(v => !record(v))) fail();
  const lease = workflow.pairFxLease === null ? null : own(workflow.pairFxLease, ['row_key','books']);
  if (lease && (typeof lease.row_key !== 'string' || !Array.isArray(lease.books))) fail();
  const rowKey = lease ? copied(lease.row_key) as string : null, books = lease ? copied(lease.books) as ProjectFile['fx_books'] : null;
  const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n', blockers: string[] = []; let projectJson: string | null = null;
  if (project) {try {projectJson = serializeProject({...project, fx_books: rowKey === JSON.stringify(rows) ? books! : rowsToBooks(rows)});} catch {blockers.push('INVALID_FX_OR_PROJECT');}}
  if (envelope.reading || envelope.mutation_busy || envelope.write_busy || envelope.cache_busy || envelope.preview || envelopeUi.pending || envelopeUi.busy || envelopeUi.exporting) blockers.push('ACTIVE_ENVELOPE');
  if (workflow.projectSaveBusy || billCapture.write_busy || pairCapture.write_busy || workflow.projectResourceBusy || workflow.settlementBusy || workflow.customerSummaryBusy || workflow.customerPdfBusy) blockers.push('ACTIVE_FILE_WRITE');
  const retainedRoot = {project_raw: project, project_file: {name: app?.fileName ?? null, saved_at: app?.savedAt ?? null, dirty: app ? app.dirty : null, saved_raw_known: app !== null && projectFile.saved_raw !== null},
    bill: billCapture, pair: pairCapture, tax, precision, envelope, tax_workspace: taxUi, precision_workspace: precisionUi, envelope_workspace: envelopeUi,
    project_read_epoch: workflow.projectReadEpoch, project_read_token: workflow.projectReadToken, settlement_epoch: workflow.settlementEpoch, settlement_plan: workflow.settlementPlan, sensitivity: workflow.sensitivityControls,
    customer_fields: workflow.customerFields, customer_view: workflow.customerView, customer_reviewed: workflow.customerReviewed, pending_control: pending.control, storage};
  const captureShell: FeeLayeredCaptureParts['capture_shell'] = {scope: 'RUNTIME_FEE_WORKBENCH_CAPTURE', envelope_json: envelopeCurrent?.raw_json as string | null ?? null,
    sources: {project_json: projectJson, bill_json: draft ? serializeContainerBillDraft(draft as Parameters<typeof serializeContainerBillDraft>[0]) : null, pair_json: currentPair ? serializeContainerCostPair(currentPair as Parameters<typeof serializeContainerCostPair>[0]) : null, attachment_json: attachment ? json(attachment) : null, precision_json: selection ? json(selection) : null},
    fx: {rows_json: JSON.stringify(rows), preserved_row_key: rowKey, preserved_books_json: books ? JSON.stringify(books) : null},
    files: {project: projectFile, bill: evidence(billCapture.file_evidence), pair: evidence(pairCapture.file_evidence), attachment: evidence(tax.file_evidence), precision: evidence(precision.file_evidence), envelope: evidence(envelope.file_evidence)},
    editors: {cost: editor ? json(editor) : null, review: review ? json(review) : null, attachment: taxEditor ? json(taxEditor) : null, precision: precisionEditor ? json(precisionEditor) : null, pending_input: workflow.pendingCalculation || pending.present ? json({pending_calculation: workflow.pendingCalculation, control: pending.control}) : null},
    activity: {project_read: workflow.projectReadToken !== null && workflow.projectReadToken === workflow.projectReadEpoch, bill_read: billCapture.reading as boolean, pair_read: pairCapture.reading as boolean,
      attachment_mutation: !!(tax.reading || tax.mutation_busy || tax.write_busy || tax.preview !== null || tax.recovery !== null || taxUi.pending !== null || taxUi.export_busy),
      precision_mutation: !!(precision.reading || precision.mutation_busy || precision.write_busy || precision.preview !== null || precision.recovery !== null || precisionUi.pending !== null || precisionUi.export_busy), recovery: workflow.recoveryStage !== null || workflow.recoveryReviewBusy}, blockers};
  current(); return Object.freeze({retained_root: Object.freeze(retainedRoot), capture_shell: Object.freeze(captureShell), retained_format: 'PRETTY_LF'});
}
