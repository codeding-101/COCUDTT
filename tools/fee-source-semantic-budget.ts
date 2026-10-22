/** Developer-only v0.2 prototype. Semantic roots retain the original guards; no application authority. */
import {copyFeeEnvelopeJson as copy, parseFeeEnvelopeJson as parse} from '../src/data/fee-envelope-json';
import {serializeProject} from '../src/data/project-file';
import {serializeContainerBillDraft} from '../src/data/container-bill-file';
import {serializeContainerCostPair} from '../src/data/container-cost-pair';
import {captureRuntimeFeeWorkbench, type RuntimeFeeWorkbenchCapture} from '../src/ui/fee-workbench-preview';
import {FEE_SOURCE_STORAGE_KEYS, type FeeSourceReaders, type FeeSourceProject, type FeeSourceWorkflow} from '../src/ui/fee-workbench-source-adapter';
import {rowsToBooks, type FxRow} from '../src/ui/fx-rows';
import {unknownFileEvidence, type FileEvidence} from '../src/ui/file-evidence';
import type {WorkbenchStateOwner} from '../src/ui/workbench-state';

export interface FeeSemanticCapture {
  kind: 'INTERNAL_FEE_WORKBENCH_SEMANTIC_CAPTURE'; version: '0.2';
  financial_writes: 0; import_authority: false; confirmation_authority: false;
  capture: RuntimeFeeWorkbenchCapture;
}
const fail = (): never => {throw Error('FEE_SEMANTIC_BUDGET_INVALID');};
const stale = (): never => {throw Error('FEE_SEMANTIC_BUDGET_STALE');};
const workflowKeys = ['stateInitialized','pendingCalculation','pairFxLease','projectReadEpoch','projectReadToken','settlementEpoch','settlementPlan','sensitivityControls','customerFields','customerView','customerReviewed','recoveryStage','recoveryReviewBusy','projectSaveBusy','projectResourceBusy','settlementBusy','customerSummaryBusy','customerPdfBusy'];
type Data = Record<string, unknown>;
/** Fixed wrappers only. Never spread or read an uninspected accessor, toJSON, symbol or prototype. */
function own(value: unknown, fields: readonly string[], exact = true): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.some(k => typeof k !== 'string' || !descriptors[k]?.enumerable || !('value' in descriptors[k]!)) || fields.some(k => !Object.hasOwn(descriptors,k)) || exact && keys.length !== fields.length) return fail();
  return Object.fromEntries(keys.map(k => [k,descriptors[k as string]!.value]));
}
const text = (v: unknown) => v === null || typeof v === 'string';
const record = (v: unknown) => v === null || !!v && typeof v === 'object' && !Array.isArray(v);
const bool = (d: object, keys: readonly string[]) => {if (keys.some(k => typeof (d as Data)[k] !== 'boolean')) fail();};
const epoch = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
function evidence(value: unknown): FileEvidence {
  const d = own(value,['name','saved_raw','saved_at']); if (Object.values(d).some(v => !text(v))) fail();
  return d as unknown as FileEvidence;
}
function validateRetained(r: Data) {
  for (const value of [r.bill,r.pair,r.tax,r.precision,r.envelope]) {
    const c=own(value,['file_evidence','epoch','reading','write_busy'],false); evidence(c.file_evidence); bool(c,['reading','write_busy']); if (!epoch(c.epoch)) fail();
  }
  for (const [value,source] of [[r.tax,'attachment'],[r.precision,'selection']] as const) {
    const c=own(value,[source,'editor','mutation_busy','preview','recovery','read_token'],false); bool(c,['mutation_busy']);
    if ([source,'editor','preview','recovery'].some(k => !record(c[k])) || !epoch(c.read_token)) fail();
  }
  const e = own(r.envelope,['current','mutation_busy','cache_busy','preview','read_token'],false); bool(e,['mutation_busy','cache_busy']);
  if (!record(e.current) || !record(e.preview) || !epoch(e.read_token)) fail();
  if (e.current !== null) {const current=own(e.current,['raw_json'],false); if (typeof current.raw_json !== 'string') fail();}
  for (const value of [r.tax_workspace,r.precision_workspace]) {const c=own(value,['pending','export_busy'],false); bool(c,['export_busy']); if (!record(c.pending)) fail();}
  const ui=own(r.envelope_workspace,['pending','busy','exporting'],false); bool(ui,['busy','exporting']); if (!record(ui.pending)) fail();
  if (r.pending_control !== null) {
    const c = own(r.pending_control,['tag','id','type','value','dataset','connected']); bool(c,['connected']);
    if (['tag','id','type','value'].some(k => typeof c[k] !== 'string')) fail();
    const ds = own(c.dataset,[],false); if (Object.values(ds).some(v => typeof v !== 'string')) fail();
  }
  const storage=own(r.storage,FEE_SOURCE_STORAGE_KEYS);
  for (const value of Object.values(storage)) {const v=own(value,['raw','available']); bool(v,['available']); if (!text(v.raw) || !v.available && v.raw !== null) fail();}
}
/** This root is the original complete capture, not a new enlarged global budget. */
function validatedCapture(value: unknown): RuntimeFeeWorkbenchCapture {
  const c = captureRuntimeFeeWorkbench(value as RuntimeFeeWorkbenchCapture);
  own(c,['scope','envelope_json','sources','fx','files','editors','activity','retained_json','blockers']);
  if (!text(c.envelope_json) || typeof c.retained_json !== 'string') fail();
  own(c.sources,['project_json','bill_json','pair_json','attachment_json','precision_json']);
  own(c.fx,['rows_json','preserved_row_key','preserved_books_json']);
  own(c.files,['project','bill','pair','attachment','precision','envelope']); Object.values(c.files).forEach(evidence);
  own(c.editors,['cost','review','attachment','precision','pending_input']);
  own(c.activity,['project_read','bill_read','pair_read','attachment_mutation','precision_mutation','recovery']);
  if ([...Object.values(c.sources),...Object.values(c.editors),c.fx.preserved_row_key,c.fx.preserved_books_json].some(v => !text(v)) || typeof c.fx.rows_json !== 'string' || Object.values(c.activity).some(v => typeof v !== 'boolean')) fail();
  // Outer acceptance alone never means that retained JSON or a business transaction is ready.
  parse(c.retained_json); return c;
}
function wrap(capture: RuntimeFeeWorkbenchCapture): Readonly<FeeSemanticCapture> {
  return Object.freeze({kind:'INTERNAL_FEE_WORKBENCH_SEMANTIC_CAPTURE',version:'0.2',financial_writes:0,import_authority:false,confirmation_authority:false,capture});
}
/** Serialized v0.2 data has no freshness, import, confirmation or candidate authority. */
export function projectFeeSemanticCapture(value: unknown): RuntimeFeeWorkbenchCapture {
  const d = own(value,['kind','version','financial_writes','import_authority','confirmation_authority','capture']);
  if (d.kind !== 'INTERNAL_FEE_WORKBENCH_SEMANTIC_CAPTURE' || d.version !== '0.2' || d.financial_writes !== 0 || d.import_authority !== false || d.confirmation_authority !== false) return fail();
  return validatedCapture(d.capture);
}
/** Trusted synchronous readers; their side effects cannot be rolled back. Nested edits still require touch(). */
export function captureFeeSemanticBudget(owner: WorkbenchStateOwner, readers: FeeSourceReaders): Readonly<FeeSemanticCapture> {
  const checkpoint = owner.checkpoint(), read = <T>(fn: () => T): T => {if (!owner.isCurrent(checkpoint)) return stale(); const v = fn(); if (!owner.isCurrent(checkpoint)) return stale(); return v;};
  const b = own(read(() => readers.bill()),['capture','draft']) as unknown as ReturnType<FeeSourceReaders['bill']>, p = own(read(() => readers.pair()),['capture','pair','editor','reviewEditor']) as unknown as ReturnType<FeeSourceReaders['pair']>;
  const tax = read(() => readers.attachment()), precision = read(() => readers.precision()), envelope = read(() => readers.envelope());
  const taxUi = read(() => readers.attachment_workspace()), precisionUi = read(() => readers.precision_workspace()), envelopeUi = read(() => readers.envelope_workspace());
  const w = own(read(() => readers.workflow()),workflowKeys) as unknown as FeeSourceWorkflow;
  bool(w,['stateInitialized','pendingCalculation','customerReviewed','recoveryReviewBusy','projectSaveBusy','projectResourceBusy','settlementBusy','customerSummaryBusy','customerPdfBusy']);
  if (!epoch(w.projectReadEpoch) || !epoch(w.settlementEpoch) || w.projectReadToken !== null && !epoch(w.projectReadToken) || !text(w.recoveryStage) || typeof w.customerView !== 'string') fail();
  copy(w.recoveryStage);
  const app = w.stateInitialized ? own(read(() => readers.project()),['project','fxRows','fileEvidence','fileName','savedAt','dirty']) as unknown as FeeSourceProject : null;
  if (app && (!record(app.project) || app.project === null || !Array.isArray(app.fxRows) || !text(app.fileName) || !text(app.savedAt) || typeof app.dirty !== 'boolean')) fail();
  const file = app ? evidence(copy(evidence(app.fileEvidence))) : unknownFileEvidence();
  const pending = own(read(() => readers.pending()),['present','control']); bool(pending,['present']); if (pending.control !== null && !pending.present) fail();
  const storage = read(() => readers.storage());
  // Explicit canonical mapping BEFORE any protocol wrapper: same depth and node positions as legacy retained_json.
  const raw = {project_raw:app?.project??null,project_file:{name:app?.fileName??null,saved_at:app?.savedAt??null,dirty:app?app.dirty:null,saved_raw_known:app!==null&&file.saved_raw!==null},bill:b.capture,pair:p.capture,tax,precision,envelope,tax_workspace:taxUi,precision_workspace:precisionUi,envelope_workspace:envelopeUi,
    project_read_epoch:w.projectReadEpoch,project_read_token:w.projectReadToken,settlement_epoch:w.settlementEpoch,settlement_plan:w.settlementPlan,sensitivity:w.sensitivityControls,customer_fields:w.customerFields,customer_view:w.customerView,customer_reviewed:w.customerReviewed,pending_control:pending.control,storage};
  const r = copy(raw) as typeof raw;
  validateRetained(r);
  // These source documents are not all in retained_json. Validate each at its own original JSON root.
  const draft = copy(b.draft) as Parameters<typeof serializeContainerBillDraft>[0] | null;
  const pair = copy(p.pair) as Parameters<typeof serializeContainerCostPair>[0] | null;
  const editor = copy(p.editor), reviewEditor = copy(p.reviewEditor), rows = copy(app?.fxRows??[]) as FxRow[];
  if ([draft,pair,editor,reviewEditor].some(v => !record(v))) fail();
  const lease = w.pairFxLease === null ? null : own(w.pairFxLease,['row_key','books']);
  if (lease && (typeof lease.row_key !== 'string' || !Array.isArray(lease.books))) fail();
  const rowKey = lease ? copy(lease.row_key) as string : null, books = lease ? copy(lease.books) as Parameters<typeof serializeProject>[0]['fx_books'] : null;
  const json = (v: unknown) => JSON.stringify(v,null,2)+'\n', blockers: string[] = [];
  let project_json: string | null = null;
  if (app) {try {project_json=serializeProject({...r.project_raw!,fx_books:rowKey===JSON.stringify(rows)?books!:rowsToBooks(rows)});} catch {blockers.push('INVALID_FX_OR_PROJECT');}}
  const e = r.envelope;
  if (e.reading||e.mutation_busy||e.write_busy||e.cache_busy||e.preview||r.envelope_workspace.pending||r.envelope_workspace.busy||r.envelope_workspace.exporting) blockers.push('ACTIVE_ENVELOPE');
  if (w.projectSaveBusy||r.bill.write_busy||r.pair.write_busy||w.projectResourceBusy||w.settlementBusy||w.customerSummaryBusy||w.customerPdfBusy) blockers.push('ACTIVE_FILE_WRITE');
  const capture = validatedCapture({scope:'RUNTIME_FEE_WORKBENCH_CAPTURE',envelope_json:e.current?.raw_json??null,
    sources:{project_json,bill_json:draft?serializeContainerBillDraft(draft):null,pair_json:pair?serializeContainerCostPair(pair):null,attachment_json:r.tax.attachment?json(r.tax.attachment):null,precision_json:r.precision.selection?json(r.precision.selection):null},
    fx:{rows_json:JSON.stringify(rows),preserved_row_key:rowKey,preserved_books_json:books?JSON.stringify(books):null},
    files:{project:file,bill:{...r.bill.file_evidence},pair:{...r.pair.file_evidence},attachment:{...r.tax.file_evidence},precision:{...r.precision.file_evidence},envelope:{...e.file_evidence}},
    editors:{cost:editor?json(editor):null,review:reviewEditor?json(reviewEditor):null,attachment:r.tax.editor?json(r.tax.editor):null,precision:r.precision.editor?json(r.precision.editor):null,pending_input:w.pendingCalculation||pending.present?json({pending_calculation:w.pendingCalculation,control:r.pending_control}):null},
    activity:{project_read:w.projectReadToken!==null&&w.projectReadToken===w.projectReadEpoch,bill_read:r.bill.reading,pair_read:r.pair.reading,attachment_mutation:r.tax.reading||r.tax.mutation_busy||r.tax.write_busy||r.tax.preview!==null||r.tax.recovery!==null||r.tax_workspace.pending!==null||r.tax_workspace.export_busy,precision_mutation:r.precision.reading||r.precision.mutation_busy||r.precision.write_busy||r.precision.preview!==null||r.precision.recovery!==null||r.precision_workspace.pending!==null||r.precision_workspace.export_busy,recovery:w.recoveryStage!==null||w.recoveryReviewBusy},retained_json:json(r),blockers});
  if (!owner.isCurrent(checkpoint)) return stale(); return wrap(capture);
}
