/** Independent browser-compatible adapter. Not connected to app.ts or a financial write entry. */
import {copyFeeEnvelopeJson} from '../data/fee-envelope-json.js';
import {serializeProject, type ProjectFile} from '../data/project-file.js';
import {serializeContainerBillDraft} from '../data/container-bill-file.js';
import {serializeContainerCostPair} from '../data/container-cost-pair.js';
import {COST_EDITOR_STORAGE_KEY} from '../data/container-cost-editor.js';
import {REVIEW_EDITOR_STORAGE_KEY} from '../data/container-review-editor.js';
import {BILL_STORAGE_KEY, type ContainerBillController} from './container-bill-controller.js';
import {PAIR_STORAGE_KEY, type ContainerCostPairController} from './container-cost-pair-controller.js';
import {FEE_TAX_ATTACHMENT_STORAGE_KEYS, type FeeTaxAttachmentController} from './fee-tax-attachment-controller.js';
import {FEE_PRECISION_SELECTION_STORAGE_KEYS, type FeePrecisionSelectionController} from './fee-precision-selection-controller.js';
import {FEE_ENVELOPE_STORAGE_KEY, type FeeEnvelopeController} from './fee-envelope-controller.js';
import type {FeeTaxAttachmentWorkspace} from './fee-tax-attachment-workspace.js';
import type {FeePrecisionSelectionWorkspace} from './fee-precision-selection-workspace.js';
import type {FeeEnvelopeWorkspace} from './fee-envelope-workspace.js';
import {captureRuntimeFeeWorkbench, type RuntimeFeeWorkbenchCapture} from './fee-workbench-preview.js';
import type {WorkbenchStateOwner} from './workbench-state.js';
import {rowsToBooks, type FxRow} from './fx-rows.js';
import {unknownFileEvidence, type FileEvidence} from './file-evidence.js';

export const FEE_SOURCE_STORAGE_KEYS = Object.freeze(['trade-cost-engine:draft-v1', BILL_STORAGE_KEY, PAIR_STORAGE_KEY, COST_EDITOR_STORAGE_KEY,
  REVIEW_EDITOR_STORAGE_KEY, ...Object.values(FEE_TAX_ATTACHMENT_STORAGE_KEYS), ...Object.values(FEE_PRECISION_SELECTION_STORAGE_KEYS), FEE_ENVELOPE_STORAGE_KEY]);
export interface FeeSourcePending {present: boolean; control: {tag: string; id: string; type: string; value: string; dataset: DOMStringMap; connected: boolean} | null}
export type FeeSourceStorage = Record<string, {raw: string | null; available: boolean}>;
export interface FeeSourceProject {project: ProjectFile; fxRows: FxRow[]; fileEvidence: FileEvidence; fileName: string | null; savedAt: string | null; dirty: boolean}
export interface FeeSourceWorkflow {
  stateInitialized: boolean; pendingCalculation: boolean; pairFxLease: {row_key: string; books: ProjectFile['fx_books']} | null;
  projectReadEpoch: number; projectReadToken: number | null; settlementEpoch: number; settlementPlan: unknown;
  sensitivityControls: unknown; customerFields: unknown; customerView: string; customerReviewed: boolean;
  recoveryStage: string | null; recoveryReviewBusy: boolean; projectSaveBusy: boolean; projectResourceBusy: boolean;
  settlementBusy: boolean; customerSummaryBusy: boolean; customerPdfBusy: boolean;
}
interface Producers {
  project: FeeSourceProject | null; workflow: FeeSourceWorkflow;
  bill: {capture: ReturnType<ContainerBillController['workbenchCapture']>; draft: ContainerBillController['draft']};
  pair: {capture: ReturnType<ContainerCostPairController['workbenchCapture']>; pair: ContainerCostPairController['pair']; editor: ContainerCostPairController['editor']; reviewEditor: ContainerCostPairController['reviewEditor']};
  attachment: ReturnType<FeeTaxAttachmentController['workbenchCapture']>; precision: ReturnType<FeePrecisionSelectionController['workbenchCapture']>;
  envelope: ReturnType<FeeEnvelopeController['workbenchCapture']>;
  attachment_workspace: ReturnType<FeeTaxAttachmentWorkspace['workbenchCapture']>;
  precision_workspace: ReturnType<FeePrecisionSelectionWorkspace['workbenchCapture']>;
  envelope_workspace: ReturnType<FeeEnvelopeWorkspace['workbenchCapture']>;
}
/** Trusted synchronous producers. DOM and storage are observed explicitly, never spread from workflow. */
export interface FeeSourceReaders {
  project(): FeeSourceProject; workflow(): FeeSourceWorkflow; bill(): Producers['bill']; pair(): Producers['pair'];
  attachment(): Producers['attachment']; precision(): Producers['precision']; envelope(): Producers['envelope'];
  attachment_workspace(): Producers['attachment_workspace']; precision_workspace(): Producers['precision_workspace']; envelope_workspace(): Producers['envelope_workspace'];
  pending(): FeeSourcePending; storage(): FeeSourceStorage;
}
export interface FeeWorkbenchSourceFrame {
  kind: 'INTERNAL_FEE_WORKBENCH_SOURCE_FRAME'; version: '0.1'; financial_writes: 0; import_authority: false; confirmation_authority: false;
  producers: Producers; pending: FeeSourcePending; storage: FeeSourceStorage;
}
const fail = (code: string): never => {throw Error('FEE_SOURCE_ADAPTER_' + code);};
function freeze<T>(v: T): T {if (v && typeof v === 'object') {Object.values(v).forEach(freeze); Object.freeze(v);} return v;}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function keys(v: unknown, fields: readonly string[], exact = true): asserts v is Record<string, unknown> {
  if (!record(v) || fields.some(k => !Object.hasOwn(v, k)) || exact && Object.keys(v).length !== fields.length) fail('SHAPE');
}
function bools(v: Record<string, unknown>, fields: readonly string[]) {if (fields.some(k => typeof v[k] !== 'boolean')) fail('BOOLEAN');}
const nullableText = (v: unknown) => v === null || typeof v === 'string';
const nullableRecord = (v: unknown) => v === null || record(v);
function evidence(v: unknown) {keys(v, ['name', 'saved_raw', 'saved_at']); if (Object.values(v).some(x => !nullableText(x))) fail('FILE_EVIDENCE');}
const workflowFields = ['stateInitialized','pendingCalculation','pairFxLease','projectReadEpoch','projectReadToken','settlementEpoch','settlementPlan','sensitivityControls','customerFields','customerView','customerReviewed','recoveryStage','recoveryReviewBusy','projectSaveBusy','projectResourceBusy','settlementBusy','customerSummaryBusy','customerPdfBusy'];
/** A frame is diagnostic JSON, not an owned checkpoint or a trusted project import. */
function validated(value: unknown): FeeWorkbenchSourceFrame {
  const d = copyFeeEnvelopeJson(value); keys(d, ['kind','version','financial_writes','import_authority','confirmation_authority','producers','pending','storage']);
  if (d.kind !== 'INTERNAL_FEE_WORKBENCH_SOURCE_FRAME' || d.version !== '0.1' || d.financial_writes !== 0 || d.import_authority !== false || d.confirmation_authority !== false) fail('HEADER');
  const p = d.producers; keys(p, ['project','workflow','bill','pair','attachment','precision','envelope','attachment_workspace','precision_workspace','envelope_workspace']);
  const w = p.workflow; keys(w, workflowFields);
  bools(w, ['stateInitialized','pendingCalculation','customerReviewed','recoveryReviewBusy','projectSaveBusy','projectResourceBusy','settlementBusy','customerSummaryBusy','customerPdfBusy']);
  if (['projectReadEpoch','settlementEpoch'].some(k => !Number.isSafeInteger(w[k]) || (w[k] as number) < 0) || w.projectReadToken !== null && (!Number.isSafeInteger(w.projectReadToken) || (w.projectReadToken as number) < 0) || !nullableText(w.recoveryStage) || typeof w.customerView !== 'string') fail('WORKFLOW');
  if (w.pairFxLease !== null) {keys(w.pairFxLease, ['row_key','books']); if (typeof w.pairFxLease.row_key !== 'string' || !Array.isArray(w.pairFxLease.books)) fail('FX_LEASE');}
  if (w.stateInitialized) {
    keys(p.project, ['project','fxRows','fileEvidence','fileName','savedAt','dirty']); const app = p.project;
    if (!record(app.project) || !Array.isArray(app.fxRows) || !nullableText(app.fileName) || !nullableText(app.savedAt) || typeof app.dirty !== 'boolean') fail('PROJECT'); evidence(app.fileEvidence);
  } else if (p.project !== null) fail('UNINITIALIZED_PROJECT');
  keys(p.bill, ['capture','draft']); keys(p.pair, ['capture','pair','editor','reviewEditor']);
  if (!nullableRecord(p.bill.draft) || ['pair','editor','reviewEditor'].some(k => !nullableRecord((p.pair as Record<string,unknown>)[k]))) fail('SOURCE');
  const captures = [(p.bill as Record<string,unknown>).capture,(p.pair as Record<string,unknown>).capture,p.attachment,p.precision,p.envelope];
  for (const c of captures) {keys(c, ['file_evidence','epoch','reading','write_busy'], false); evidence(c.file_evidence); bools(c, ['reading','write_busy']); if (!Number.isSafeInteger(c.epoch) || (c.epoch as number) < 0) fail('EPOCH');}
  for (const [c, source] of [[p.attachment,'attachment'],[p.precision,'selection']] as const) {
    keys(c, [source,'editor','mutation_busy','preview','recovery','read_token'], false); bools(c, ['mutation_busy']);
    if ([source,'editor','preview','recovery'].some(k => !nullableRecord(c[k])) || !Number.isSafeInteger(c.read_token) || (c.read_token as number) < 0) fail('CONTROLLER');
  }
  keys(p.envelope, ['current','mutation_busy','cache_busy','preview','read_token'], false); bools(p.envelope, ['mutation_busy','cache_busy']);
  if (!nullableRecord(p.envelope.current) || !nullableRecord(p.envelope.preview) || !Number.isSafeInteger(p.envelope.read_token) || (p.envelope.read_token as number) < 0) fail('ENVELOPE');
  if (p.envelope.current !== null) {keys(p.envelope.current, ['raw_json'], false); if (typeof p.envelope.current.raw_json !== 'string') fail('ENVELOPE');}
  for (const c of [p.attachment_workspace,p.precision_workspace]) {keys(c, ['pending','export_busy'], false); bools(c, ['export_busy']); if (!nullableRecord(c.pending)) fail('WORKSPACE');}
  keys(p.envelope_workspace, ['pending','busy','exporting'], false); bools(p.envelope_workspace, ['busy','exporting']); if (!nullableRecord(p.envelope_workspace.pending)) fail('WORKSPACE');
  keys(d.pending, ['present','control']); bools(d.pending, ['present']);
  if (d.pending.control !== null) {
    keys(d.pending.control, ['tag','id','type','value','dataset','connected']); const control = d.pending.control;
    if (['tag','id','type','value'].some(k => typeof control[k] !== 'string') || typeof control.connected !== 'boolean' || !record(control.dataset) || Object.values(control.dataset).some(v => typeof v !== 'string') || !d.pending.present) fail('PENDING_CONTROL');
  }
  keys(d.storage, FEE_SOURCE_STORAGE_KEYS);
  for (const value of Object.values(d.storage)) {keys(value, ['raw','available']); bools(value, ['available']); if (!nullableText(value.raw) || value.available === false && value.raw !== null) fail('STORAGE');}
  return freeze(d as unknown as FeeWorkbenchSourceFrame);
}
export function observeFeeSourcePending(control: HTMLElement | null): FeeSourcePending {
  const form = typeof HTMLInputElement !== 'undefined' && control instanceof HTMLInputElement || typeof HTMLSelectElement !== 'undefined' && control instanceof HTMLSelectElement || typeof HTMLTextAreaElement !== 'undefined' && control instanceof HTMLTextAreaElement;
  return {present: control !== null, control: form ? {tag: control!.tagName, id: control!.id, type: (control as HTMLInputElement).type, value: (control as HTMLInputElement).value, dataset: {...control!.dataset}, connected: control!.isConnected} : null};
}
export function observeFeeSourceStorage(getItem: (key: string) => string | null): FeeSourceStorage {
  return Object.fromEntries(FEE_SOURCE_STORAGE_KEYS.map(key => {let raw: string | null; try {raw = getItem(key);} catch {return [key, {raw: null, available: false}];} if (!nullableText(raw)) return fail('STORAGE_VALUE'); return [key, {raw, available: true}];}));
}
/** Checks consistency during synchronous capture only. Returned JSON carries no future freshness or confirmation authority. */
export function captureFeeWorkbenchSourceFrame(owner: WorkbenchStateOwner, readers: FeeSourceReaders): FeeWorkbenchSourceFrame {
  const token = owner.checkpoint(), read = <T>(fn: () => T): T => {if (!owner.isCurrent(token)) return fail('STALE'); const value = fn(); if (!owner.isCurrent(token)) return fail('STALE'); return value;};
  const bill = read(() => readers.bill()), pair = read(() => readers.pair()), attachment = read(() => readers.attachment()), precision = read(() => readers.precision()), envelope = read(() => readers.envelope());
  const attachment_workspace = read(() => readers.attachment_workspace()), precision_workspace = read(() => readers.precision_workspace()), envelope_workspace = read(() => readers.envelope_workspace());
  const workflow = read(() => readers.workflow()), project = workflow.stateInitialized ? read(() => readers.project()) : null;
  const pending = read(() => readers.pending()), storage = read(() => readers.storage());
  const frame = validated({kind:'INTERNAL_FEE_WORKBENCH_SOURCE_FRAME',version:'0.1',financial_writes:0,import_authority:false,confirmation_authority:false,
    producers:{project,workflow,bill,pair,attachment,precision,envelope,attachment_workspace,precision_workspace,envelope_workspace},pending,storage});
  if (!owner.isCurrent(token)) return fail('STALE'); return frame;
}
/** Compatibility projection only. Original complete-capture128MiB guard still applies after reconstruction. */
export function projectFeeSourceFrameToLegacy(value: unknown): RuntimeFeeWorkbenchCapture {
  const f = validated(value), p = f.producers, w = p.workflow, app = p.project, bill = p.bill.capture, pair = p.pair.capture, tax = p.attachment, precision = p.precision, envelope = p.envelope;
  const taxUi = p.attachment_workspace, precisionUi = p.precision_workspace, envelopeUi = p.envelope_workspace, json = (v: unknown) => JSON.stringify(v,null,2)+'\n', blockers: string[] = [];
  let project_json: string | null = null;
  if (app) {try {project_json = serializeProject({...app.project,fx_books:w.pairFxLease?.row_key===JSON.stringify(app.fxRows)?w.pairFxLease.books:rowsToBooks(app.fxRows)});} catch {blockers.push('INVALID_FX_OR_PROJECT');}}
  if (envelope.reading||envelope.mutation_busy||envelope.write_busy||envelope.cache_busy||envelope.preview||envelopeUi.pending||envelopeUi.busy||envelopeUi.exporting) blockers.push('ACTIVE_ENVELOPE');
  if (w.projectSaveBusy||bill.write_busy||pair.write_busy||w.projectResourceBusy||w.settlementBusy||w.customerSummaryBusy||w.customerPdfBusy) blockers.push('ACTIVE_FILE_WRITE');
  return captureRuntimeFeeWorkbench({scope:'RUNTIME_FEE_WORKBENCH_CAPTURE',envelope_json:envelope.current?.raw_json??null,
    sources:{project_json,bill_json:p.bill.draft?serializeContainerBillDraft(p.bill.draft):null,pair_json:p.pair.pair?serializeContainerCostPair(p.pair.pair):null,attachment_json:tax.attachment?json(tax.attachment):null,precision_json:precision.selection?json(precision.selection):null},
    fx:{rows_json:JSON.stringify(app?.fxRows??[]),preserved_row_key:w.pairFxLease?.row_key??null,preserved_books_json:w.pairFxLease?JSON.stringify(w.pairFxLease.books):null},
    files:{project:app?{...app.fileEvidence}:unknownFileEvidence(),bill:{...bill.file_evidence},pair:{...pair.file_evidence},attachment:{...tax.file_evidence},precision:{...precision.file_evidence},envelope:{...envelope.file_evidence}},
    editors:{cost:p.pair.editor?json(p.pair.editor):null,review:p.pair.reviewEditor?json(p.pair.reviewEditor):null,attachment:tax.editor?json(tax.editor):null,precision:precision.editor?json(precision.editor):null,pending_input:w.pendingCalculation||f.pending.present?json({pending_calculation:w.pendingCalculation,control:f.pending.control}):null},
    activity:{project_read:w.projectReadToken!==null&&w.projectReadToken===w.projectReadEpoch,bill_read:bill.reading,pair_read:pair.reading,attachment_mutation:tax.reading||tax.mutation_busy||tax.write_busy||tax.preview!==null||tax.recovery!==null||taxUi.pending!==null||taxUi.export_busy,precision_mutation:precision.reading||precision.mutation_busy||precision.write_busy||precision.preview!==null||precision.recovery!==null||precisionUi.pending!==null||precisionUi.export_busy,recovery:w.recoveryStage!==null||w.recoveryReviewBusy},
    retained_json:json({project_raw:app?.project??null,project_file:{name:app?.fileName??null,saved_at:app?.savedAt??null,dirty:app?app.dirty:null,saved_raw_known:app!==null&&app.fileEvidence.saved_raw!==null},bill,pair,tax,precision,envelope,tax_workspace:taxUi,precision_workspace:precisionUi,envelope_workspace:envelopeUi,
      project_read_epoch:w.projectReadEpoch,project_read_token:w.projectReadToken,settlement_epoch:w.settlementEpoch,settlement_plan:w.settlementPlan,sensitivity:w.sensitivityControls,customer_fields:w.customerFields,customer_view:w.customerView,customer_reviewed:w.customerReviewed,pending_control:f.pending.control,storage:f.storage}),blockers});
}
