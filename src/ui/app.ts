import { COST_PRESETS, customCostItem, presetToCostItem } from '../data/cost-presets.js';
import {
  parseProject,
  serializeProject,
  toScenario,
  toScenarios,
  toTrade,
  touchProject,
  type ProjectFile,
} from '../data/project-file.js';
import { chinaImportSampleProjectFile, newChinaImportProjectFile, sampleProjectFile } from '../data/sample-project.js';
import { validateDraftFxRows } from '../data/project-validation.js';
import { projectJsonSchema } from '../data/project-validation.js';
import { projectTemplateText, PROJECT_TEMPLATES } from '../data/project-templates.js';
import { renderProjectTemplatePanel } from './project-templates.js';
import { settlementBinding } from '../data/settlement-context.js';
import { parseSettlementPlan, serializeSettlementPlan } from '../data/settlement-file.js';
import { newSettlementPlan, newPaymentEntry, newBankFeeEntry, enableFundingLedger, enableFundingRates, enableFundingRounding, enableFundingPeriods, type SettlementPlan } from '../domain/settlement.js';
import { renderSettlementPanel } from './settlement.js';
import { newFundingAssumption, newFundingPrincipalEvent, newFundingRateEvent } from '../domain/funding.js';
import { emptyEvidence, evidenceKey, fxEvidenceValues, hsEvidenceValues, invalidateEvidence, taxEvidenceValues, type SourceEvidence } from '../domain/source-evidence.js';
import { eligibilityValues, emptyEligibility, emptyRoute } from '../domain/import-context.js';
import type { BaseRef, CostItem } from '../domain/cost-item.js';
import { INCOTERMS, type Incoterm } from '../domain/enums.js';
import type { DutyType, HsRateTable } from '../domain/hs-rate.js';
import type {
  CostCategory,
  FxType,
  OccurrenceReason,
  PricingMethod,
  TierBasis,
  TierMode,
  TradeNode,
} from '../domain/enums.js';
import type { ComparisonAnchor } from '../domain/scenario.js';
import { overrideEvidenceValues, quoteEvidenceValues } from '../domain/contract-evidence.js';
import { emptyContractQuote } from './contracts-input.js';
import { emptyInsurancePlan, emptyTransportPlan, insuranceEvidenceValues, transportEvidenceValues } from '../domain/logistics-evidence.js';
import type { ContainerCharge } from '../domain/logistics.js';
import { analyze, type AnalysisResult } from '../engine/analyze.js';
import { compare, scenarioWithDerivedInclusions, type Comparison } from '../engine/compare.js';
import { isEngineError } from '../engine/errors.js';
import { booksToRows, rowsToBooks, type FxRow } from './fx-rows.js';
import { escapeHtml } from './format.js';
import { nextCostId, renderFormsRow, renderAdvancedTradeFields, renderFxPanel, renderHsPanel, renderImportTaxPanel, renderItemsPanel, type ItemEnrichment } from './views-input.js';
import { loadWorkspaceMode, saveWorkspaceMode, renderModeSwitch, renderQuickStart, renderCalculationStatus, renderWorkspaceSummary, workspaceIssues, focusWorkspaceIssue, workspaceIssueElement, revealWorkspaceElement, type WorkspaceMode, type WorkspaceResult } from './workspace.js';
import {renderCalculationLearning,focusLearningTarget} from './calculation-learning.js';
import {QuickCostsController} from './quick-costs.js';
import {FieldHelpController} from './field-help.js';
import {MobileSettingsController} from './mobile-settings.js';
import { createProjectReport } from './project-report.js';
import { renderKpis, renderOutputColumn } from './views-output.js';
import { newSensitivityControls, projectSensitivity, renderSensitivityPanel, sensitivityOptions } from './sensitivity.js';
import type { SensitivityResult } from '../engine/sensitivity.js';
import { emptyCustomerQuoteFields, CUSTOMER_QUOTE_FIELDS, type CustomerQuote } from '../domain/customer-quote.js';
import { createCustomerQuoteDocument, customerQuoteFileName, projectCustomerQuote, renderCustomerQuotePanel } from './customer-quote.js';
import { createBilingualSummaryDocument } from './bilingual-summary.js';
import { createCustomerWorkbook, createInternalWorkbook } from './workbook-export.js';
import { XLSX_MIME } from '../data/xlsx-file.js';
import fontLicense from '../assets/fonts/LICENSE-OFL.txt?raw';
import fontProvenance from '../assets/fonts/provenance.json?raw';
import { inputFailure } from './ui-failure.js';
import { showRecoveryView, clearRecoveryView, type FailureStage } from './recovery.js';
import { inspectRecoveryText, RECOVERY_REVIEW_MAX_BYTES, type RecoveryReview } from '../data/recovery-review.js';
import { renderRecoveryReviewPanel } from './recovery-review.js';
import { inputSections, focusInputSection, inputSectionElement, type InputSection } from './input-location.js';
import { renderRoundingExamplePanel, roundingExampleResource } from './rounding-example.js';
import { renderPeriodExamplePanel, periodExampleResource } from './period-example.js';
import {enableTransportCostLinks,invalidateTransportCostLinks} from '../data/transport-cost-links.js';
import {transportCostLinkEvidenceValues,transportOverlapEvidenceValues,type TransportChargeKind} from '../domain/transport-cost-links.js';
import {renderTransportLinkControls} from './transport-cost-links.js';
import {transportProjectSchema} from '../data/transport-project-schema.js';
import { renderFundingExamplePanel, fundingExampleResource } from './funding-example.js';
import {ContainerBillController,BILL_STORAGE_KEY} from './container-bill-controller.js';
import {renderContainerBillPanel} from './container-bill.js';
import {ContainerCostPairController,PAIR_STORAGE_KEY} from './container-cost-pair-controller.js';
import {REVIEW_EDITOR_STORAGE_KEY} from '../data/container-review-editor.js';
import {COST_EDITOR_STORAGE_KEY} from '../data/container-cost-editor.js';
import {renderContainerCostPairPanel} from './container-cost-pair.js';
import type {ContainerCostPair} from '../domain/container-cost-pair.js';
import {serializeContainerBillDraft} from '../data/container-bill-file.js';

const DRAFT_KEY = 'trade-cost-engine:draft-v1';

interface AppState {
  project: ProjectFile;
  fxRows: FxRow[];
  result: AnalysisResult | null;
  comparison: Comparison | null;
  error: string | null;
  status: string;
  statusLevel: 'info' | 'warn' | 'error';
  fileName: string | null;
  savedAt: string | null;
  dirty: boolean;
}

interface DraftPayload {
  project: ProjectFile;
  fxRows: FxRow[];
  pair_fx_row_key?:string;
}
let pairFxLease:{row_key:string;books:ProjectFile['fx_books']}|null=null;

/** 折叠的面板；跨渲染保留 */
const collapsedSections = new Set<string>();
const expandedEvidenceSections = new Set<string>();

interface DraftLoad {
  payload: DraftPayload | null;
  /** 草稿存在但读不出来时的说明；有值就必须告诉用户 */
  failure: string | null;
}

/**
 * 读取草稿。两种失败要分清：
 * - 浏览器禁用了本地存储 → 草稿功能不可用，与用户数据无关，静默跳过
 * - 草稿存在但解析失败 → 用户的未保存内容丢了，必须明说，不能装作无事发生
 */
function loadDraft(): DraftLoad {
  let raw: string | null;
  try {
    raw = localStorage.getItem(DRAFT_KEY);
  } catch {
    return { payload: null, failure: null };
  }
  if (raw === null) return { payload: null, failure: null };

  try {
    const parsed = JSON.parse(raw) as DraftPayload;
    validateDraftFxRows(parsed.fxRows);
    if(parsed.pair_fx_row_key!==undefined&&typeof parsed.pair_fx_row_key!=='string')throw Error('paired FX draft');
    return { payload: { project: parseProject(JSON.stringify(parsed.project)), fxRows: parsed.fxRows,...(parsed.pair_fx_row_key===undefined?{}:{pair_fx_row_key:parsed.pair_fx_row_key}) }, failure: null };
  } catch (error) {
    const detail = isEngineError(error) ? `（${error.code}）` : '';
    return { payload: null, failure: `上次的草稿无法读取${detail}，已载入示例数据；原草稿暂未覆盖，请先备份浏览器本地存储。继续编辑或打开其他项目将更新草稿` };
  }
}

function saveDraft(project: ProjectFile, fxRows: readonly FxRow[]): boolean {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ project, fxRows,...(pairFxLease?.row_key===JSON.stringify(fxRows)?{pair_fx_row_key:pairFxLease.row_key}:{}) }));
    return true;
  } catch {
    return false;
  }
}

/** 启动时是否从草稿恢复，必须在 initialState() 之前声明 */
let restoredFromDraft = false;
/** 草稿读取失败的说明，启动时展示 */
let draftFailure: string | null = null;
let draftStorageUnavailable = false;
let workspaceMode: WorkspaceMode = 'beginner';
let workspaceNote = '当前为 CIF 合成示例：货值、运保费、汇率与税率仅用于演示。';
let calculatedAt = '';
let pendingCalculation = false;
const quickCosts=new QuickCostsController();
const fieldHelp=new FieldHelpController();
const mobileSettings=new MobileSettingsController();
let editedControl:HTMLElement|null=null;

function initialState(): AppState {
  const draft = loadDraft();
  const project = draft.payload?.project ?? sampleProjectFile();
  const fxRows = draft.payload?.fxRows ?? booksToRows(project.fx_books);
  pairFxLease=draft.payload?.pair_fx_row_key===JSON.stringify(fxRows)&&draft.payload.pair_fx_row_key===JSON.stringify(booksToRows(project.fx_books))?{row_key:draft.payload.pair_fx_row_key,books:project.fx_books}:null;
  restoredFromDraft = draft.payload !== null;
  workspaceMode = loadWorkspaceMode();
  if (restoredFromDraft) workspaceNote = '已恢复本机草稿；按保存的报价、费用与假设继续核对。';
  draftFailure = draft.failure;
  return {
    project,
    fxRows,
    result: null,
    comparison: null,
    error: null,
    status: '',
    statusLevel: 'info',
    fileName: null,
    savedAt: null,
    dirty: draft.payload !== null,
  };
}

let state: AppState;
let stateInitialized = false;
let recoveryStage: FailureStage | null = null;
let boundRoot: HTMLDivElement | null = null;
const boundEvents = new Set<string>();
let sensitivityControls = newSensitivityControls();
let sensitivityAnalysis: SensitivityResult | null = null;
let sensitivityError: string | null = null;
let customerFields = emptyCustomerQuoteFields();
let customerReviewed = false;
let projectResourceBusy = false;
let customerSummaryBusy = false;
let customerPreview: CustomerQuote | null = null;
let customerError: string | null = null;
let customerPdfBusy = false;
let settlementPlan: SettlementPlan | null = null;
let settlementBusy = false;
let settlementEpoch = 0;
let inputLocations: InputSection[] = [];
let recoveryReview: RecoveryReview | null = null;
let recoveryReviewError: string | null = null;
let recoveryReviewBusy = false;
let recoveryReviewEpoch = 0;
let projectReadEpoch=0;
const containerBill=new ContainerBillController({project:()=>currentProject(),render:()=>render(),blocked:()=>recoveryStage!==null,write:writeBillFile,onChange:()=>containerPair.cancelReads()});
const containerPair=new ContainerCostPairController({project:()=>currentProject(),bill:()=>containerBill.draft,render:()=>runUi('RENDER',()=>render()),blocked:()=>recoveryStage!==null,write:writeBillFile,
 inputIssues:pairedFxDraftIssues,
 install:installPair,cancelOtherReads:()=>{projectReadEpoch++;containerBill.cancelReads();settlementEpoch++;},afterInstall:()=>runUi('RENDER',()=>{recompute();render();})});
function installPair(pair:ContainerCostPair):void {
 // Prepare every potentially failing conversion before replacing either in-memory half.
 const project=structuredClone(pair.project),bill=structuredClone(pair.bill),fxRows=booksToRows(project.fx_books),billText=serializeContainerBillDraft(bill),row_key=JSON.stringify(fxRows);
 const controls=newSensitivityControls(),publicFields=emptyCustomerQuoteFields();
 projectReadEpoch++;settlementEpoch++;recoveryReviewEpoch++;
 state.project=project;state.fxRows=fxRows;pairFxLease={row_key,books:project.fx_books};
  workspaceNote='当前来自完整配对文件；账单与核对记录不自动应用为项目费用。';
 containerBill.installPrepared(bill,billText);
 settlementPlan=null;sensitivityControls=controls;customerFields=publicFields;customerReviewed=false;customerPreview=null;
 state.result=null;state.comparison=null;state.fileName=null;state.savedAt=null;state.dirty=true;
 expandedEvidenceSections.add('container-cost-pair');expandedEvidenceSections.add('container-bill');
}
async function writeBillFile(name:string,text:string,mime:string):Promise<'SAVED'|'DOWNLOAD_STARTED'> {
 const picker=(window as SaveFilePickerWindow).showSaveFilePicker;
 if(!picker){downloadText(name,text);return 'DOWNLOAD_STARTED';}
 const handle=await picker.call(window,{suggestedName:name,types:[{description:name.endsWith('container-cost-pair.json')?'项目账单配对文件':'独立账单文件',accept:{[mime]:['.json']}}]});
 const writable=await handle.createWritable();await writable.write(text);await writable.close();return 'SAVED';
}

function showFatalFailure(stage: FailureStage): void {
  fieldHelp.dismiss(false);
  mobileSettings.dismiss(false);editedControl=null;
  projectReadEpoch++;
  recoveryStage = stage;
  containerBill.cancelReads();
  containerPair.cancelReads();
  settlementEpoch++;
  recoveryReviewEpoch++; recoveryReviewBusy = false; inputLocations = [];
  if (stateInitialized) { state.result = null; state.comparison = null; }
  customerReviewed = false; customerPreview = null; sensitivityAnalysis = null;
  showRecoveryView(stage,{retry:retryInterface,backup:backupRecovery});
}
function runUi(stage: FailureStage, operation: () => void): void {
  try { operation(); } catch { showFatalFailure(stage); }
}
function retryInterface(): void {
  const initializing = !stateInitialized;
  const startupWarning = stateInitialized && state.status === draftFailure ? draftFailure : null;
  recoveryStage = null;
  runUi('STARTUP',()=>{
    if (!stateInitialized) { state = initialState(); stateInitialized = true; }
    containerBill.loadLocal();
    containerPair.loadLocal();
    bind(); recompute(false);
    if ((initializing && draftFailure) || startupWarning) { state.status = startupWarning ?? draftFailure!; state.statusLevel = 'warn'; }
    render();
  });
}
function backupRecovery(): void {
  if (!recoveryStage) return;
  let draft: string | null = null;
  let billDraftText:string|null=null;
  let pairDraftText:string|null=null;
  let editorDraftText:string|null=null;
  let reviewDraftText:string|null=null;
  try { draft = localStorage.getItem(DRAFT_KEY); } catch { /* Memory backup remains available. */ }
  try{billDraftText=localStorage.getItem(BILL_STORAGE_KEY);}catch{/* Raw memory bill remains available. */}
  try{pairDraftText=localStorage.getItem(PAIR_STORAGE_KEY);}catch{/* Raw pair remains in memory. */}
  try{editorDraftText=localStorage.getItem(COST_EDITOR_STORAGE_KEY);}catch{/* Raw editor remains in memory. */}
  try{reviewDraftText=localStorage.getItem(REVIEW_EDITOR_STORAGE_KEY);}catch{/* Raw review editor remains in memory. */}
  try {
    // Raw inputs, including uncommitted FX rows, without running any calculation/validator.
    const text = JSON.stringify({kind:'INTERNAL_RECOVERY_SNAPSHOT',version:'1.0',stage:recoveryStage,
      project:stateInitialized ? state.project : null,fx_rows:stateInitialized ? state.fxRows : null,
      settlement_plan:settlementPlan,sensitivity:sensitivityControls,customer_fields:customerFields,
      browser_draft_text:draft,container_bill:containerBill.draft,container_bill_draft_text:billDraftText,container_cost_pair:containerPair.pair,container_cost_pair_draft_text:pairDraftText,
      ...(containerPair.editor?{container_cost_editor:containerPair.editor}:{}),
      ...(containerPair.reviewEditor?{container_review_editor:containerPair.reviewEditor}:{}),
      ...(reviewDraftText&&reviewDraftText!=='null'?{container_review_editor_draft_text:reviewDraftText}:{}),
      ...(containerPair.copyCandidate?{container_business_copy:containerPair.copyCandidate.pair}:{}),
      ...(editorDraftText&&editorDraftText!=='null'?{container_cost_editor_draft_text:editorDraftText}:{})},null,2) + '\n';
    downloadText('internal-recovery-snapshot.json',text);
    showRecoveryView(recoveryStage,{retry:retryInterface,backup:backupRecovery},'已发起内部恢复备份下载，请确认文件已保存；原项目与草稿未改写');
  } catch {
    showRecoveryView(recoveryStage,{retry:retryInterface,backup:backupRecovery},'恢复备份下载失败，当前内存输入仍保留；请不要刷新，检查浏览器下载权限后重试');
  }
}

function onSettlementField(target: HTMLInputElement | HTMLSelectElement): void {
  if (!settlementPlan) return;
  const field = target.dataset.settlementField;
  const kind = target.dataset.settlementRow;
  const index = Number(target.dataset.settlementIndex);
  if (kind === 'payment') {
    const row = settlementPlan.payments[index];
    if (row && field === 'basis' && ['AMOUNT','PERCENT'].includes(target.value)) row.basis = target.value as typeof row.basis;
    else if (row && (field === 'value' || field === 'date' || field === 'trigger')) row[field] = target.value;
  } else if (kind === 'fee') {
    const row = settlementPlan.bank_fees[index];
    if (row && field === 'source' && ['EXISTING','EXTRA'].includes(target.value)) {
      row.source = target.value as typeof row.source;
      // Preserve old values; incompatible associations must be cleared explicitly.
      row.not_in_project = false;
    } else if (row && (field === 'bearer' || field === 'payer') && ['UNCONFIRMED','BUYER','SELLER'].includes(target.value)) row[field] = target.value as typeof row.bearer;
    else if (row && field === 'not_in_project') row.not_in_project = target instanceof HTMLInputElement && target.checked;
    else if (row && (field === 'cost_id' || field === 'amount' || field === 'currency' || field === 'date' || field === 'reference')) row[field] = target.value;
  } else if (kind === 'funding-event' && (['1.2','1.3','1.4','1.5'].includes(settlementPlan.version))) {
    const row = settlementPlan.funding?.events?.[index];
    if (row && field === 'direction' && ['INCREASE','DECREASE'].includes(target.value)) row.direction = target.value as typeof row.direction;
    else if (row && (field === 'amount' || field === 'currency' || field === 'date' || field === 'reference')) row[field] = target.value;
  } else if(kind==='funding-rate'&&(settlementPlan.version==='1.3'||settlementPlan.version==='1.4'||settlementPlan.version==='1.5')){
    const row=settlementPlan.funding?.rate_events?.[index];
    if(row&&(field==='date'||field==='annual_rate'||field==='reference'))row[field]=target.value;
  } else if(kind==='funding-rounding'&&(settlementPlan.version==='1.4'||settlementPlan.version==='1.5')){
    const row=settlementPlan.funding!.rounding!;
    if(field === 'status'&&['UNCONFIRMED','NOT_APPLIED','APPLIED'].includes(target.value))row.status=target.value as typeof row.status;
    else if(field === 'scope'&&(settlementPlan.version==='1.5'?['UNCONFIRMED','TOTAL','INTERVALS','PERIODS']:['UNCONFIRMED','TOTAL','INTERVALS']).includes(target.value)){row.scope=target.value as typeof row.scope;row.status='UNCONFIRMED';row.intervals_confirmed=false;}
    else if(field === 'mode'&&['UNCONFIRMED','HALF_UP','HALF_EVEN','DOWN'].includes(target.value))row.mode=target.value as typeof row.mode;
    else if(field === 'unit'||field === 'reference')row[field]=target.value;
    else if(field === 'intervals_confirmed')row.intervals_confirmed=target instanceof HTMLInputElement&&target.checked;
  } else if(kind==='funding-period-schedule'&&settlementPlan.version==='1.5'){
    const row=settlementPlan.funding!.period_schedule!;
    if(field==='status'&&['UNCONFIRMED','PROVIDED'].includes(target.value))row.status=target.value as typeof row.status;
    else if(field==='reference')row.reference=target.value;
    else if(field === 'periods_confirmed')row.periods_confirmed=target instanceof HTMLInputElement&&target.checked;
  } else if(kind==='funding-period'&&settlementPlan.version==='1.5'){
    const row=settlementPlan.funding!.period_schedule!.periods[index];
    if(row&&(field==='start_date'||field==='end_date'||field==='reference'))row[field]=target.value;
  } else if (kind === 'funding' && settlementPlan.version !== '1.0' && settlementPlan.funding) {
    const row = settlementPlan.funding;
    if (field === 'status' && ['UNCONFIRMED','NOT_MODELED','PROVIDED'].includes(target.value)) row.status = target.value as typeof row.status;
    else if (field === 'kind' && ['UNCONFIRMED','FINANCING','OPPORTUNITY'].includes(target.value)) row.kind = target.value as typeof row.kind;
    else if (field === 'party' && ['UNCONFIRMED','BUYER','SELLER'].includes(target.value)) row.party = target.value as typeof row.party;
    else if (field === 'day_basis' && ['UNCONFIRMED','ACT_365F','ACT_360'].includes(target.value)) row.day_basis = target.value as typeof row.day_basis;
    else if (field === 'balance_model' && (['1.2','1.3','1.4','1.5'].includes(settlementPlan.version)) && ['CONSTANT','EVENTS'].includes(target.value)) { row.balance_model = target.value as typeof row.balance_model; row.status = 'UNCONFIRMED'; }
    else if(field === 'rate_model'&&(settlementPlan.version==='1.3'||settlementPlan.version==='1.4'||settlementPlan.version==='1.5')&&['CONSTANT','EVENTS'].includes(target.value)){row.rate_model=target.value as typeof row.rate_model;row.status='UNCONFIRMED';}
    else if (field === 'principal' || field === 'currency' || field === 'start_date' || field === 'end_date' || field === 'annual_rate' || field === 'reference') row[field] = target.value;
  } else if (field === 'method' && ['UNCONFIRMED','TT','LC','OA'].includes(target.value)) settlementPlan.method = target.value as typeof settlementPlan.method;
  else if (field === 'bank_status' && ['UNCONFIRMED','NO_FEES','LISTED'].includes(target.value)) settlementPlan.bank_status = target.value as typeof settlementPlan.bank_status;
  else if (field === 'notes') settlementPlan.notes = target.value;
  if((settlementPlan.version==='1.4'||settlementPlan.version==='1.5')&&((kind==='funding-event'||kind==='funding-rate')&&field==='date'||kind==='funding'&&['start_date','end_date','balance_model','rate_model'].includes(field??'')))settlementPlan.funding!.rounding!.intervals_confirmed=false;
  if(settlementPlan.version==='1.5'){
    const f=settlementPlan.funding!;
    if(['funding','funding-event','funding-rate','funding-period','funding-rounding'].includes(kind??'')||kind==='funding-period-schedule'&&field!=='periods_confirmed')f.period_schedule!.periods_confirmed=false;
    if(kind==='funding-rounding'&&['mode','unit','reference'].includes(field??''))f.rounding!.status='UNCONFIRMED';
  }
  settlementEpoch++;
  render();
}

async function saveSettlement(): Promise<void> {
  if (settlementBusy) return;
  let writing=false;
  try {
    if (!settlementPlan) throw Error('请先创建内部付款计划');
    const text = serializeSettlementPlan(settlementPlan);
    writing=true;
    settlementBusy = true;
    render();
    const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
    if (picker) {
      const handle = await picker.call(window, { suggestedName: 'internal-settlement-plan.json', types: [{ description: '内部付款计划', accept: { 'application/json': ['.json'] } }] });
      const writable = await handle.createWritable(); await writable.write(text); await writable.close();
      state.status = '已保存内部付款计划快照；项目保存状态未改变，后续付款编辑须再次单独保存';
    } else { downloadText('internal-settlement-plan.json', text); state.status = '已发起内部付款计划下载，请确认已保存；项目文件不包含付款计划'; }
    state.statusLevel = 'warn';
  } catch (error) {
    state.status = error instanceof Error && error.name === 'AbortError' ? '已取消付款计划保存，输入保留' : writing?'付款计划保存失败，请检查浏览器保存权限或存储空间后重试；输入保留':`付款计划保存失败：${error instanceof Error ? error.message : String(error)}`;
    state.statusLevel = 'warn';
  } finally { settlementBusy = false; render(); }
}

function recomputeCustomerPreview(): void {
  customerPreview = null;
  customerError = null;
  try { customerPreview = projectCustomerQuote(currentProject(), customerFields); }
  catch (error) { customerError = error instanceof Error ? error.message : '公开报价数据未完成，请核对'; }
}

function recomputeSensitivity(): void {
  sensitivityAnalysis = null;
  sensitivityError = null;
  if (!sensitivityControls.enabled) return;
  try { sensitivityAnalysis = projectSensitivity(currentProject(), sensitivityControls); }
  catch (error) { sensitivityError = error instanceof Error ? error.message : String(error); }
}

function currentProject(): ProjectFile {
  return { ...state.project, fx_books: pairFxLease?.row_key===JSON.stringify(state.fxRows)?pairFxLease.books:rowsToBooks(state.fxRows) };
}
function pairedFxDraftIssues():string[]{
 if(pairFxLease?.row_key===JSON.stringify(state.fxRows))return[];
 if(state.fxRows.some(r=>!r.from.trim()||!r.to.trim()||!r.rate.trim()))return['汇率行尚未填写完整，请先修正再捕获或另存配对；原行仍在草稿和恢复备份中'];
 const keys=state.fxRows.map(r=>JSON.stringify([r.type,r.date,r.valid_from??'',r.valid_to??'',r.from,r.to]));
 return new Set(keys).size!==keys.length?['汇率行有重复币种对和适用期，请先核对；配对不会静默覆盖其中一行']:[];
}

function recompute(persistDraft = true): void {
  pendingCalculation = false;
  inputLocations = [];
  const project = currentProject();
  try {
    const trade = toTrade(project);
    const template = toScenario(project);
    const scenario = scenarioWithDerivedInclusions(template, trade);
    state.result = analyze({
      trade,
      scenario,
      taxProfile: project.tax_profile,
      fxBooks: project.fx_books,
      ...(project.export_date !== undefined ? { today: project.export_date } : {}),
    });
    state.comparison = compare({
      trade,
      template,
      scenarios: toScenarios(project),
      anchor: project.anchor,
      taxProfile: project.tax_profile,
      fxBooks: project.fx_books,
      ...(project.export_date !== undefined ? { today: project.export_date } : {}),
    });
    state.error = null;
    const errors = state.result.warnings.filter((warning) => warning.level === 'ERROR').length;
    const warns = state.result.warnings.filter((warning) => warning.level === 'WARN').length;
    const infos = state.result.warnings.filter((warning) => warning.level === 'INFO').length;
    state.status =
      errors > 0 ? `${errors} 条错误级提示` : `${warns} 条提示 · ${infos} 条说明`;
    state.statusLevel = errors > 0 ? 'error' : 'info';
  } catch (error) {
    state.result = null;
    state.comparison = null;
    if (!isEngineError(error)) throw error;
    const failure = inputFailure(error);
    inputLocations = inputSections(error);
    state.error = `${failure.message}\n${failure.hint}`;
    if (isEngineError(error) && (project.anchor.kind === 'ACTUAL_QUOTES' || project.term_scenarios !== undefined || project.items.some(item => item.applicable_incoterms !== undefined || item.alternative_group?.trim()))) {
      try {
        state.comparison = compare({ trade: toTrade(project), template: toScenario(project), anchor: project.anchor,
          scenarios: toScenarios(project),
          taxProfile: project.tax_profile, fxBooks: project.fx_books,
          ...(project.export_date !== undefined ? { today: project.export_date } : {}) });
      } catch { /* 公共输入不完整时仍显示错误，不沿用旧结果。 */ }
    }
    state.status = `输入不足以完成计算：${failure.hint}`;
    state.statusLevel = 'error';
  }
  if (persistDraft) draftStorageUnavailable = !saveDraft(state.project, state.fxRows);
  calculatedAt = new Date().toLocaleTimeString('zh-CN',{hour12:false});
  recomputeSensitivity();
  recomputeCustomerPreview();
}

/** 把计算结果回填到录入区：金额与归属，让用户边录边看到结果 */
function enrichmentMap(): Map<string, ItemEnrichment> {
  const map = new Map<string, ItemEnrichment>();
  if (state.result === null) return map;
  for (const enriched of state.result.items) {
    map.set(enriched.item.cost_id, {
      base_amount: enriched.base_amount,
      responsibility: enriched.responsibility,
      exclusion: enriched.exclusion,
      rule_id: enriched.rule_id,
      note: enriched.note,
    });
  }
  return map;
}

// ---------- 输入绑定 ----------

function focusKeyOf(element: Element): string | null {
  const dataset = (element as HTMLElement).dataset;
  if(dataset.quickCostField!==undefined)return `quick-cost:${dataset.quickCostKind}:${dataset.quickCostField}`;
  if(dataset.pairEditorField!==undefined)return `pair-editor:${dataset.pairEditorField}`;
  if(dataset.pairCopyField!==undefined)return `pair-copy:${dataset.pairCopyField}`;
  if(dataset.pairReviewField!==undefined)return `pair-review:${dataset.pairReviewField}`;
  if(dataset.billField!==undefined)return `bill:${dataset.billRow??''}:${dataset.billTier??''}:${dataset.billField}`;
  if (dataset.sensitivityField !== undefined) return `sensitivity:${dataset.sensitivityField}`;
  if (dataset.customerField !== undefined) return `customer:${dataset.customerField}`;
  if (dataset.evidenceOwner !== undefined && dataset.evidenceField !== undefined) {
    return `evidence:${dataset.evidenceOwner}:${dataset.evidenceId ?? ''}:${dataset.evidenceField}`;
  }
  if (dataset.path !== undefined) return `path:${dataset.path}`;
  if (dataset.logisticsKind !== undefined) return `logistics:${dataset.logisticsKind}:${dataset.logisticsField}:${dataset.segmentIndex ?? ''}`;
  if (dataset.contractCost !== undefined) return `contract:${dataset.contractCost}:${dataset.contractField}`;
  if (dataset.item !== undefined && dataset.itemField !== undefined) {
    return `item:${dataset.item}:${dataset.itemField}${dataset.term === undefined ? '' : `:${dataset.term}`}`;
  }
  if (dataset.fx !== undefined && dataset.fxField !== undefined) {
    return `fx:${dataset.fx}:${dataset.fxField}`;
  }
  return null;
}

function restoreFocus(key: string | null): void {
  if (key === null) return;
  const element = Array.from(document.querySelectorAll<HTMLElement>('[data-path],[data-item],[data-fx],[data-evidence-owner],[data-contract-cost],[data-logistics-kind],[data-sensitivity-field],[data-customer-field],[data-bill-field],[data-pair-editor-field],[data-pair-copy-field],[data-pair-review-field],[data-quick-cost-field]')).find(
    (candidate) => focusKeyOf(candidate) === key,
  );
  element?.focus();
}

function setPath(path: string, raw: string): void {
  const parts = path.split('.');
  let cursor = state.project as unknown as Record<string, unknown>;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (key === undefined) return;
    const next = cursor[key];
    if (typeof next !== 'object' || next === null) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  if (last === undefined) return;
  const trimmed = raw.trim();
  const optional =
    path.startsWith('facts.') || path.endsWith('_date') || path === 'goods.tax_key' || path === 'export_date';
  cursor[last] = optional && trimmed === '' ? undefined : trimmed;
}

function onProjectField(path: string, target: HTMLInputElement | HTMLSelectElement): void {
  if (path.startsWith('term_scenarios.')) {
    const term = path.split('.')[1] as Incoterm;
    if (!INCOTERMS.includes(term)) return;
    const record = (state.project.term_scenarios ??= {})[term] ??= {};
    record.quote ??= emptyContractQuote(state.project);
    invalidateEvidence(record.quote_evidence);
    invalidateEvidence(record.insurance?.evidence);
    if (path.endsWith('.named_place')) invalidateEvidence(record.transport?.evidence);
  }
  if (path.startsWith('goods.') || path.startsWith('facts.') || path === 'base_currency') {
    for (const record of Object.values(state.project.term_scenarios ?? {})) {
      invalidateEvidence(record.quote_evidence);
      invalidateEvidence(record.insurance?.evidence);
      invalidateEvidence(record.transport?.evidence);
      if (path.startsWith('facts.') || path === 'base_currency') Object.values(record.responsibility_overrides ?? {}).forEach(override => invalidateEvidence(override.evidence));
    }
  }
  const rules = state.project.tax_profile.import;
  if (path.startsWith('route.')) state.project.route ??= emptyRoute();
  if (path.startsWith('tax_profile.import.eligibility.')) rules.eligibility ??= emptyEligibility();
  if (path.startsWith('route.') || ['goods.tax_key', 'tax_profile.import.declarationDate', 'tax_profile.import.calculationMode'].includes(path)) {
    invalidateEvidence(rules.eligibility?.duty_evidence);
    invalidateEvidence(rules.eligibility?.vat_evidence);
  }
  if (['tax_profile.import.hsTable.basis', 'tax_profile.import.eligibility.agreement_name'].includes(path)) invalidateEvidence(rules.eligibility?.duty_evidence);
  if (['tax_profile.import.vatDeductibleForBuyer', 'tax_profile.import.eligibility.vat_taxpayer', 'tax_profile.import.eligibility.vat_use'].includes(path)) invalidateEvidence(rules.eligibility?.vat_evidence);
  if (['tax_profile.import.dutyRates.fallback', 'tax_profile.import.vatRate', 'tax_profile.import.consumptionTax.rate'].includes(path)) {
    invalidateEvidence(state.project.tax_profile.import.rateEvidence);
  }
  if (path === 'tax_profile.import.hsTable.basis') {
    ensureHsTable(state.project).entries.forEach((entry) => invalidateEvidence(entry.evidence));
  }
  if (path === 'tax_profile.import.consumptionTax.rate') {
    state.project.tax_profile.import.consumptionTax = target.value.trim() === '' ? null : {
      rate: target.value.trim(), basis: 'DUTIABLE_PLUS_DUTY',
    };
    return;
  }
  if (path === 'tax_profile.import.vatDeductibleForBuyer' && target instanceof HTMLInputElement) {
    state.project.tax_profile.import.vatDeductibleForBuyer = target.checked;
    return;
  }
  if (path === 'anchor.kind') {
    const kind = target.value as ComparisonAnchor['kind'];
    const fallbackTotal = state.result?.buyer.landed_cost_with_tax.toFixed(2) ?? '900000.00';
    state.project.anchor =
      kind === 'FIXED_MARKET_PRICE'
        ? { kind, buyer_total: fallbackTotal, currency: state.project.base_currency }
        : kind === 'FIXED_MARGIN_RATE'
          ? { kind, margin_rate: '0.2' }
          : kind === 'ACTUAL_QUOTES' ? { kind } : { kind: 'FIXED_QUOTE' };
    return;
  }
  setPath(path, target.value);
}

function onItemField(costId: string, field: string, target: HTMLInputElement | HTMLSelectElement): void {
  const item = state.project.items.find((candidate) => candidate.cost_id === costId);
  if (item === undefined) return;
  for (const record of Object.values(state.project.term_scenarios ?? {})) invalidateEvidence(record.responsibility_overrides?.[costId]?.evidence);
  const value = target.value;
  if (['currency', 'fx_type', 'fx_date'].includes(field)) invalidateEvidence(item.fx_evidence);
  const isCheckbox = target instanceof HTMLInputElement && target.type === 'checkbox';
  switch (field) {
    case 'container_charge': item.container_charge = value.trim() ? value as ContainerCharge : undefined; break;
    case 'container_charge_scope': item.container_charge_scope = value.trim() || undefined; break;
    case 'applicability':
      item.applicable_incoterms = value === 'ALL' ? undefined : value === 'NONE' ? []
        : value === 'SELLER' ? ['CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP']
        : value === 'BUYER' ? ['EXW', 'FCA', 'FAS', 'FOB'] : [state.project.incoterm];
      break;
    case 'applicable_term': {
      if (!(target instanceof HTMLInputElement)) break;
      const term = target.dataset.term as Incoterm;
      if (!INCOTERMS.includes(term)) break;
      const terms = new Set(item.applicable_incoterms ?? INCOTERMS);
      if (target.checked) terms.add(term); else terms.delete(term);
      item.applicable_incoterms = INCOTERMS.filter(t => terms.has(t));
      break;
    }
    case 'alternative_group':
      item.alternative_group = value.trim() || undefined;
      break;
    case 'cost_name':
      item.cost_name = value;
      break;
    case 'trade_node':
      item.trade_node = value as TradeNode;
      break;
    case 'cost_category':
      item.cost_category = value as CostCategory;
      break;
    case 'customs_value':
      item.customs_value = value === '' ? undefined : value as CostItem['customs_value'];
      break;
    case 'pricing_method':
      item.pricing_method = value as PricingMethod;
      if (item.pricing_method === 'PERCENT' && item.calculation_base === undefined) {
        item.calculation_base = { kind: 'QUOTE_AMOUNT' };
      }
      if (item.pricing_method === 'TIERED') {
        item.tier_mode ??= 'MARGINAL';
        item.tier_basis ??= 'QUANTITY';
        ensureTiers(item);
      }
      break;
    case 'tier_mode':
      item.tier_mode = value as TierMode;
      break;
    case 'tier_basis':
      item.tier_basis = value as TierBasis;
      break;
    case 'tier_charge_lower':
      item.tier_charge_lower = isCheckbox ? target.checked : value === 'true';
      break;
    case 'tier-up':
    case 'tier-rate': {
      const index = Number(target.dataset.tierIndex ?? '-1');
      const tier = item.tiers?.[index];
      if (tier === undefined) break;
      if (field === 'tier-up') {
        const trimmed = value.trim();
        tier.up_to = trimmed === '' ? null : trimmed;
      } else {
        tier.rate = value.trim();
      }
      break;
    }
    case 'amount':
      item.amount = value.trim();
      break;
    case 'quantity':
      item.quantity = value.trim();
      break;
    case 'rate':
      item.rate = value.trim();
      break;
    case 'days':
      item.days = value.trim();
      break;
    case 'unit':
      item.unit = value.trim();
      break;
    case 'currency':
      item.currency = value.trim();
      break;
    case 'fx_type':
      item.fx_type = value as FxType;
      break;
    case 'fx_date':
      item.fx_date = value.trim() === '' ? undefined : value.trim();
      break;
    case 'occurrence_reason':
      item.occurrence_reason = value === '' ? undefined : (value as OccurrenceReason);
      break;
    case 'contained_in':
      item.contained_in_cost_id = value === '' ? undefined : value;
      break;
    case 'base':
      switch (value) {
        case 'GOODS_VALUE':
          item.calculation_base = { kind: 'GOODS_VALUE' };
          break;
        case 'QUOTE_AMOUNT':
          item.calculation_base = { kind: 'QUOTE_AMOUNT' };
          break;
        case 'CUSTOMS_DUTIABLE_VALUE':
          item.calculation_base = { kind: 'CUSTOMS_DUTIABLE_VALUE' };
          break;
        default:
          break;
      }
      break;
    case 'included_in_quoted_price':
      item.included_in_quoted_price = isCheckbox ? target.checked : value === 'true';
      break;
    case 'is_goods_value':
      item.is_goods_value = isCheckbox ? target.checked : false;
      break;
    case 'includes_port_charges':
      item.includes_port_charges = isCheckbox ? target.checked : false;
      break;
    default:
      break;
  }
}

/** HS 税率表：没有表结构时按需创建，避免用户先手动建一层空壳 */
function ensureHsTable(project: ProjectFile): HsRateTable {
  const rules = project.tax_profile.import;
  rules.hsTable ??= { basis: 'MFN', entries: [] };
  return rules.hsTable;
}

function onHsField(index: number, field: string, target: HTMLInputElement | HTMLSelectElement): void {
  const table = ensureHsTable(state.project);
  const entry = table.entries[index];
  if (entry === undefined) return;
  const value = target.value;
  const trimmed = value.trim();
  invalidateEvidence(entry.evidence);
  switch (field) {
    case 'code':
      entry.code = trimmed;
      break;
    case 'description':
      entry.description = value;
      break;
    case 'duty_type':
      entry.duty_type = value as DutyType;
      break;
    case 'duty_rate': {
      // 只维护当前口径的税率，避免让用户在一个单元格里填四个口径
      entry.duty_rates ??= {};
      if (trimmed === '') delete entry.duty_rates[table.basis];
      else entry.duty_rates[table.basis] = trimmed;
      break;
    }
    case 'vat_rate':
      entry.vat_rate = trimmed === '' ? undefined : trimmed;
      break;
    case 'consumption_tax_rate':
      entry.consumption_tax_rate = trimmed === '' ? undefined : trimmed;
      break;
    case 'specific_amount':
      entry.specific_amount = trimmed === '' ? undefined : trimmed;
      break;
    case 'specific_unit':
      entry.specific_unit = trimmed === '' ? undefined : trimmed;
      break;
    default:
      break;
  }
}

function onFxField(rowId: string, field: string, target: HTMLInputElement | HTMLSelectElement): void {
  const row = state.fxRows.find((candidate) => candidate.row_id === rowId);
  if (row === undefined) return;
  const value = target.value;
  invalidateEvidence(row.evidence);
  switch (field) {
    case 'type':
      row.type = value as FxType;
      break;
    case 'date':
      row.date = value.trim();
      break;
    case 'valid_from':
      row.valid_from = value.trim() === '' ? undefined : value.trim();
      break;
    case 'valid_to':
      row.valid_to = value.trim() === '' ? undefined : value.trim();
      break;
    case 'from':
      row.from = value.trim().toUpperCase();
      break;
    case 'to':
      row.to = value.trim().toUpperCase();
      break;
    case 'rate':
      row.rate = value.trim();
      break;
    default:
      break;
  }
}

function onEvidenceField(owner: string, id: string, field: string, value: string): void {
  if((owner==='transport-link'||owner==='transport-overlap')&&field!=='status'&&value.length>4000){state.status='关联依据字段超过4000字符，未替换原记录';state.statusLevel='warn';return;}
  let evidence: SourceEvidence;
  let values: unknown;
  if(owner==='transport-overlap'){
    if(state.project.schema_version!=='0.9')return;
    const [term,index]=JSON.parse(id) as [Incoterm,number],input=state.project.term_scenarios?.[term]?.transport_cost_links,r=input?.overlap_resolutions?.[index];if(!input||!r)return;
    evidence=r.evidence??=emptyEvidence();values=transportOverlapEvidenceValues(toTrade(state.project),toScenario(state.project,term),input,r);
  }else if(owner==='transport-link'){
    if(state.project.schema_version!=='0.9')return;
    const [term,costId]=JSON.parse(id) as [Incoterm,string];
    const link=state.project.term_scenarios?.[term]?.transport_cost_links?.links.find(l=>l.cost_id===costId),item=state.project.items.find(c=>c.cost_id===costId);if(!link||!item)return;
    evidence=link.evidence??=emptyEvidence();values=transportCostLinkEvidenceValues(item,toScenario(state.project,term),link);
  }else if (owner === 'transport' || owner === 'insurance') {
    const term = id as Incoterm;
    if (!INCOTERMS.includes(term)) return;
    const record = state.project.term_scenarios?.[term];
    if (!record?.[owner]) return;
    evidence = record[owner]!.evidence ??= emptyEvidence();
    const scenario = toScenario(state.project, term);
    values = owner === 'transport' ? transportEvidenceValues(scenario) : insuranceEvidenceValues(scenario, state.project.goods);
  } else if (owner === 'quote') {
    const term = id as Incoterm;
    if (!INCOTERMS.includes(term)) return;
    const record = (state.project.term_scenarios ??= {})[term] ??= {};
    record.quote ??= emptyContractQuote(state.project);
    evidence = record.quote_evidence ??= emptyEvidence();
    values = quoteEvidenceValues(toTrade(state.project), toScenario(state.project, term));
  } else if (owner === 'contract-cost') {
    const [term, costId] = JSON.parse(id) as [Incoterm, string];
    const override = state.project.term_scenarios?.[term]?.responsibility_overrides?.[costId];
    if (!override) return;
    evidence = override.evidence ??= emptyEvidence();
    values = overrideEvidenceValues(toTrade(state.project), toScenario(state.project, term), costId);
  } else if (owner === 'tax') {
    evidence = state.project.tax_profile.import.rateEvidence ??= emptyEvidence();
    values = taxEvidenceValues(state.project.tax_profile.import);
  }
  else if (owner === 'duty-eligibility' || owner === 'vat-eligibility') {
    const rules = state.project.tax_profile.import;
    const eligibility = rules.eligibility ??= emptyEligibility();
    const kind = owner === 'duty-eligibility' ? 'duty' : 'vat';
    evidence = kind === 'duty' ? eligibility.duty_evidence ??= emptyEvidence() : eligibility.vat_evidence ??= emptyEvidence();
    values = eligibilityValues(kind, state.project.route, state.project.goods.tax_key, rules);
  }
  else if (owner === 'fx') {
    const row = state.fxRows.find((candidate) => candidate.row_id === id);
    if (row === undefined) return;
    evidence = row.evidence ??= emptyEvidence();
    values = fxEvidenceValues(row);
  } else if (owner === 'hs') {
    const entry = state.project.tax_profile.import.hsTable?.entries[Number(id)];
    if (entry === undefined) return;
    evidence = entry.evidence ??= emptyEvidence();
    values = hsEvidenceValues(entry, state.project.tax_profile.import.hsTable?.basis);
  } else if (owner === 'cost') {
    const item = state.project.items.find((candidate) => candidate.cost_id === id);
    if (item === undefined) return;
    evidence = item.fx_evidence ??= emptyEvidence();
    values = { from: item.currency, to: state.project.base_currency, rate: item.fx_rate, type: item.fx_type, date: item.fx_date };
  } else return;
  if (field !== 'status') invalidateEvidence(evidence);
  switch (field) {
    case 'reference': evidence.reference = value.trim(); break;
    case 'valid_from': evidence.valid_from = value.trim(); break;
    case 'valid_to': evidence.valid_to = value.trim(); break;
    case 'checked_on': evidence.checked_on = value.trim(); break;
    case 'status':
      evidence.status = value === 'EXAMPLE' || value === 'USER_CONFIRMED' ? value : 'UNVERIFIED';
      if (evidence.status === 'USER_CONFIRMED') {const key=evidenceKey(values,evidence);if((owner==='transport-link'||owner==='transport-overlap')&&key.length>1048576){evidence.status='UNVERIFIED';state.status='关联依据快照过大，不能确认；输入保留，请精简范围后重新核对';state.statusLevel='warn';return;}evidence.values_key=key;}
      break;
  }
}

// ---------- 动作 ----------

function onLogisticsField(kind: string, field: string, target: HTMLInputElement | HTMLSelectElement): void {
  const record = (state.project.term_scenarios ??= {})[state.project.incoterm] ??= {};
  if (kind === 'transport') {
    const plan = record.transport ??= emptyTransportPlan();
    invalidateEvidence(plan.evidence); invalidateEvidence(record.insurance?.evidence);
    if (target.dataset.segmentIndex !== undefined) {
      const segment = plan.segments[Number(target.dataset.segmentIndex)];
      if (segment && ['mode', 'from', 'to', 'carrier', 'contract_reference'].includes(field)) (segment as unknown as Record<string, unknown>)[field] = target.value.trim();
    } else if (['delivery_segment_id', 'delivery_location', 'delivery_at', 'delivery_event', 'handover_basis', 'agreement_note', 'paid_to'].includes(field)) (plan as unknown as Record<string, unknown>)[field] = target.value.trim();
  } else if (kind === 'insurance') {
    const policy = record.insurance ??= emptyInsurancePlan((record.quote ?? state.project.quote).currency);
    invalidateEvidence(policy.evidence);
    if (field === 'sum_insured.amount' || field === 'sum_insured.currency') policy.sum_insured[field === 'sum_insured.amount' ? 'amount' : 'currency'] = target.value.trim();
    else if (['scope_confirmed', 'direct_claim_confirmed'].includes(field) && target instanceof HTMLInputElement) (policy as unknown as Record<string, unknown>)[field] = target.checked;
    else if (['cover', 'clause_version', 'insured_from', 'insured_to', 'insurer', 'policy_reference', 'deductible', 'exclusions', 'agreed_cover_note'].includes(field)) (policy as unknown as Record<string, unknown>)[field] = target.value.trim();
  }
}

function addTransportSegment(): void {
  const record = (state.project.term_scenarios ??= {})[state.project.incoterm] ??= {};
  const plan = record.transport ??= emptyTransportPlan();
  let number = 1; while (plan.segments.some(segment => segment.segment_id === `leg-${number}`)) number++;
  plan.segments.push({ segment_id: `leg-${number}`, mode: 'ROAD', from: plan.segments[plan.segments.length - 1]?.to ?? '', to: '', carrier: '', contract_reference: '' });
  invalidateEvidence(plan.evidence); invalidateEvidence(record.insurance?.evidence);
}

function onContractField(costId: string, field: string, value: string): void {
  if (!state.project.items.some(item => item.cost_id === costId) && value !== 'DEFAULT') return;
  const record = (state.project.term_scenarios ??= {})[state.project.incoterm] ??= {};
  const overrides = record.responsibility_overrides ??= {};
  if (field === 'responsibility' && value === 'DEFAULT') { delete overrides[costId]; return; }
  if (field === 'responsibility' && (value === 'SELLER' || value === 'BUYER')) {
    overrides[costId] = { ...overrides[costId], responsibility: value };
  } else if (field === 'reason' && overrides[costId]) overrides[costId]!.reason = value.trim();
  invalidateEvidence(overrides[costId]?.evidence);
}

function addPresetItem(presetKey: string): void {
  const preset = COST_PRESETS.find((candidate) => candidate.key === presetKey);
  if (preset === undefined) return;
  const costId = nextCostId(state.project, preset.key);
  const isGoods = preset.cost_category === 'GOODS_AND_PACKING';
  const currency = isGoods ? state.project.quote.currency : state.project.base_currency;
  state.project.items.push(
    presetToCostItem(preset, {
      cost_id: costId,
      currency,
      base_currency: state.project.base_currency,
      fx_type: currency === state.project.base_currency ? 'MARKET' : 'CONTRACT',
      ...(preset.pricing_method === 'FIXED' || preset.pricing_method === 'ACTUAL' ? { amount: '' } : {}),
      ...(preset.pricing_method === 'QTY_X_UNIT' ? { quantity: '', rate: '' } : {}),
      ...(preset.pricing_method === 'PER_DAY' ? { days: '', rate: '' } : {}),
      ...(preset.pricing_method === 'PERCENT' ? { rate: '' } : {}),
    }),
  );
  state.status = `已添加：${preset.name}`;
}

function addCustomItem(): void {
  const costId = nextCostId(state.project, 'custom');
  state.project.items.push(
    customCostItem({
      cost_id: costId,
      cost_name: '新自定义费用',
      cost_category: 'CUSTOM',
      trade_node: 'SELLER_PREMISES',
      currency: state.project.base_currency,
      base_currency: state.project.base_currency,
      pricing_method: 'ACTUAL',
      amount: '',
    }),
  );
  state.status = '已添加自定义费用：请填写名称、节点与类别';
}

/** 阶梯档位：没有任何档位时给一个可直接编辑的初始结构 */
function ensureTiers(item: CostItem): NonNullable<CostItem['tiers']> {
  if (item.tiers === undefined || item.tiers.length === 0) {
    item.tiers = [
      { up_to: '100', rate: '0' },
      { up_to: null, rate: '0' },
    ];
  }
  return item.tiers;
}

function addTier(item: CostItem): void {
  const tiers = ensureTiers(item);
  const last = tiers[tiers.length - 1];
  // 只能有一个无上界的档位：追加前先把原来的"以上"档补一个上界
  if (last !== undefined && last.up_to === null) {
    const previous = tiers[tiers.length - 2]?.up_to ?? null;
    last.up_to = previous === null ? '200' : String(Number(previous) * 2);
  }
  tiers.push({ up_to: null, rate: last?.rate ?? '0' });
}

function removeTier(item: CostItem, index: number): void {
  if (item.tiers === undefined) return;
  item.tiers.splice(index, 1);
  // 删掉无上界的那一档后，把最后一档改为无上界，避免计费量落在所有档位之外
  if (item.tiers.length > 0 && !item.tiers.some((tier) => tier.up_to === null)) {
    const last = item.tiers[item.tiers.length - 1];
    if (last !== undefined) last.up_to = null;
  }
}

function removeItem(costId: string): void {
  for (const record of Object.values(state.project.term_scenarios ?? {})) {
    if (record.responsibility_overrides) delete record.responsibility_overrides[costId];
  }
  state.project.items = state.project.items.filter((item) => item.cost_id !== costId);
  state.project.items.forEach((item) => {
    if (item.contained_in_cost_id === costId) item.contained_in_cost_id = undefined;
  });
}

function addFxRow(): void {
  state.fxRows.push({
    row_id: `fx-row-${Date.now()}`,
    type: 'MARKET',
    date: new Date().toISOString().slice(0, 10),
    from: state.project.quote.currency,
    to: state.project.base_currency,
    rate: '',
  });
}

function addHsEntry(): void {
  ensureHsTable(state.project).entries.push({
    code: '',
    description: '新编码',
    duty_type: 'AD_VALOREM',
    duty_rates: {},
  });
}

function downloadText(fileName: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** 去掉在 Windows 上非法的文件名字符，避免建议文件名被浏览器截断 */
function safeFileName(name: string, extension = 'json'): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '-').trim();
  return `${cleaned === '' ? 'trade-cost' : cleaned}.${extension}`;
}

interface SaveFilePickerWindow extends Window {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{
    name: string;
    createWritable: () => Promise<{ write: (data: string | Blob) => Promise<void>; close: () => Promise<void> }>;
  }>;
}

async function saveProject(): Promise<void> {
  let text: string, suggested: string;
  const saveEpoch=projectReadEpoch;
  let saveKey:string;
  try {
    saveKey=JSON.stringify({project:currentProject(),fxRows:state.fxRows});
    const project = touchProject(currentProject());
    text = serializeProject(project); suggested = safeFileName(project.name);
  } catch (error) {
    const failure = inputFailure(error);
    state.status = `保存失败，当前改动尚未写入项目文件：${failure.message}；${failure.hint}`;
    state.statusLevel = 'error'; render(); return;
  }
  const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (picker !== undefined) {
    try {
      const handle = await picker.call(window, {
        suggestedName: suggested,
        types: [{ description: '项目文件', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      if(saveEpoch!==projectReadEpoch||saveKey!==JSON.stringify({project:currentProject(),fxRows:state.fxRows})){
        state.status='已保存点击时的项目快照；当前资料已变更，本次保存未改变当前文件与保存状态。';state.statusLevel='warn';render();return;
      }
      state.fileName = handle.name;
      state.savedAt = new Date().toLocaleTimeString();
      state.dirty = false;
      state.status = `已保存到 ${handle.name}`;
      state.statusLevel = 'info';
      render();
      return;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        state.status = '已取消保存，当前改动尚未写入项目文件';
        state.statusLevel = 'warn';
      } else {
        state.status = '保存失败，当前改动尚未写入项目文件；请检查保存权限或存储空间后重试';
        state.statusLevel = 'error';
      }
      render();
      return;
    }
  }
  try {
    downloadText(suggested, text);
  } catch (error) {
    state.status = `下载项目文件失败：${String(error)}`;
    state.statusLevel = 'error';
    render();
    return;
  }
  if(saveEpoch!==projectReadEpoch||saveKey!==JSON.stringify({project:currentProject(),fxRows:state.fxRows})){
    state.status='已发起点击时项目快照下载；当前资料的文件与保存状态保持。';state.statusLevel='warn';render();return;
  }
  state.savedAt = new Date().toLocaleTimeString();
  state.dirty = false;
  state.status = '当前浏览器不支持直接写盘，已改为下载项目文件';
  state.statusLevel = 'info';
  render();
}

async function exportProjectResource(templateId?:string,schemaKind?:string,exampleKind?:string,exampleFamily:'funding'|'rounding'|'period'='funding'):Promise<void> {
  if(projectResourceBusy)return;
  const label=exampleKind===undefined?'模板或结构文件':'合成案例文件';
  try {
    let text:string,name:string,mime='application/json';
    if(exampleKind!==undefined&&templateId===undefined&&schemaKind===undefined){
      const resource=exampleFamily==='period'?periodExampleResource(exampleKind):exampleFamily==='rounding'?roundingExampleResource(exampleKind):fundingExampleResource(exampleKind);text=resource.text;name=resource.name;mime=resource.mime;
    }else if(templateId!==undefined&&schemaKind===undefined&&exampleKind===undefined){
      if(!PROJECT_TEMPLATES.some(t=>t.id===templateId))throw Error('请选择目录中的模板');
      text=projectTemplateText(templateId);name=templateId+'.json';
    }else if(templateId===undefined&&exampleKind===undefined&&(schemaKind==='current'||schemaKind==='legacy'||schemaKind==='transport')){
      text=JSON.stringify(schemaKind==='transport'?transportProjectSchema():projectJsonSchema(schemaKind==='legacy'),null,2)+'\n';
      name=schemaKind==='transport'?'project-0.9.schema.json':schemaKind==='legacy'?'project-import-0.1-0.8.schema.json':'project-0.8.schema.json';
    }else throw Error('请选择有效的模板或结构文件');
    projectResourceBusy=true;render();
    const picker=(window as SaveFilePickerWindow).showSaveFilePicker;
    if(picker){const handle=await picker.call(window,{suggestedName:name,types:[{description:label,accept:{[mime]:[mime==='text/html'?'.html':'.json']}}]});const writable=await handle.createWritable();await writable.write(text);await writable.close();state.status=`已导出${label} ${handle.name}；当前项目未替换，项目文件仍需单独保存`;}
    else{downloadText(name,text,mime);state.status=`已发起${label}下载；当前项目未替换，请确认文件已保存`;}
    state.statusLevel='warn';
  }catch(error){if(error instanceof Error&&error.name==='AbortError'){state.status=`已取消${label}导出，当前项目未改变`;state.statusLevel='warn';}else{state.status=`${label}导出失败：${exampleKind!==undefined?'文件未写入，请核对案例类型及保存权限':error instanceof Error?error.message:'文件未写入'}`;state.statusLevel='error';}}
  finally{projectResourceBusy=false;render();}
}

async function exportReport(): Promise<void> {
  try {
    const project = currentProject();
    const html = createProjectReport(project, undefined, sensitivityControls.enabled ? sensitivityControls : undefined, settlementPlan ?? undefined,containerBill.draft??undefined,containerPair.pair??undefined);
    const name = safeFileName(`${project.name || 'trade-cost'}-内部测算报告`, 'html');
    const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
    if (picker !== undefined) {
      const handle = await picker.call(window, { suggestedName: name, types: [{ description: '内部测算报告', accept: { 'text/html': ['.html'] } }] });
      const writable = await handle.createWritable(); await writable.write(html); await writable.close();
      state.status = `已导出报告 ${handle.name}；项目文件仍需单独保存${state.dirty ? '；有未保存改动' : ''}`;
    } else {
      downloadText(name, html, 'text/html');
      state.status = `已发起报告下载，请确认文件已保存；项目文件仍需单独保存${state.dirty ? '；有未保存改动' : ''}`;
    }
    state.statusLevel = 'warn';
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      state.status = '已取消报告导出，项目保存状态未改变'; state.statusLevel = 'warn';
    } else {
      state.status = `报告导出失败：${isEngineError(error) ? error.message : String(error)}`; state.statusLevel = 'error';
    }
  }
  // 报告导出不是项目保存，不更改dirty、fileName、savedAt或草稿。
  render();
}

async function exportWorkbook(customer: boolean): Promise<void> {
  const label = customer ? '客户报价 Excel 草稿' : '内部成本 Excel';
  try {
    if (customer && !customerReviewed) throw new Error('请先检查客户预览中的公开内容');
    const project = currentProject();
    const quote = customer ? projectCustomerQuote(project, customerFields) : null;
    const bytes = quote ? createCustomerWorkbook(quote) : createInternalWorkbook(project, undefined, sensitivityControls.enabled ? sensitivityControls : undefined, settlementPlan ?? undefined,containerBill.draft??undefined,containerPair.pair??undefined);
    const name = quote ? customerQuoteFileName(quote).replace(/\.html$/, '.xlsx') : safeFileName(`${project.name || 'trade-cost'}-内部成本`, 'xlsx');
    const blob = new Blob([bytes], { type: XLSX_MIME });
    const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
    if (picker !== undefined) {
      const handle = await picker.call(window, { suggestedName: name, types: [{ description: label, accept: { [XLSX_MIME]: ['.xlsx'] } }] });
      const writable = await handle.createWritable(); await writable.write(blob); await writable.close();
      state.status = `已导出${label} ${handle.name}；项目文件仍需单独保存${state.dirty ? '；有未保存改动' : ''}`;
    } else {
      const url = URL.createObjectURL(blob);
      try { const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); }
      finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
      state.status = `已发起${label}下载，请确认文件已保存；项目保存状态未改变`;
    }
    state.statusLevel = 'warn';
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      state.status = `已取消${label}导出，项目保存状态未改变`; state.statusLevel = 'warn';
    } else {
      state.status = `${label}导出失败：${isEngineError(error) ? error.message : String(error)}`; state.statusLevel = 'error';
    }
  }
  render();
}

async function exportCustomerPdf(): Promise<void> {
  if (customerPdfBusy) return;
  try {
    if (!customerReviewed) throw new Error('请先检查客户预览中的公开内容');
    const quote = projectCustomerQuote(currentProject(), customerFields);
    const generatedAt = new Date().toISOString();
    const name = customerQuoteFileName(quote).replace(/\.html$/, '.pdf').replace(/[\u0000-\u001F]/g, '-');
    customerPdfBusy = true; render();
    // Open the picker while the click still has user activation; generation starts only after selection.
    const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
    const handle = picker === undefined ? null : await picker.call(window, { suggestedName: name, types: [{ description: '客户报价 PDF 草稿', accept: { 'application/pdf': ['.pdf'] } }] });
    const { createCustomerPdf } = await import('./customer-pdf.js');
    const bytes = await createCustomerPdf(quote, generatedAt);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    if (handle) {
      const writable = await handle.createWritable(); await writable.write(blob); await writable.close();
      state.status = `已导出客户报价 PDF 草稿 ${handle.name}；项目文件仍需单独保存${state.dirty ? '；有未保存改动' : ''}`;
    } else {
      const url = URL.createObjectURL(blob);
      try { const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); }
      finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
      state.status = '已发起客户报价 PDF 草稿下载，请确认文件已保存；项目保存状态未改变';
    }
    state.statusLevel = 'warn';
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') { state.status = '已取消客户报价 PDF 导出，项目保存状态未改变'; state.statusLevel = 'warn'; }
    else { state.status = `客户报价 PDF 导出失败：${error instanceof Error ? error.message : '文件未写入'}`; state.statusLevel = 'error'; }
  } finally { customerPdfBusy = false; render(); }
}

async function exportCustomerQuote(bilingual=false): Promise<void> {
  if(bilingual&&customerSummaryBusy)return;
  const label=bilingual?'中英文条款摘要':'客户报价';
  try {
    if (!customerReviewed) throw new Error('请先检查客户预览中的公开内容');
    const quote = projectCustomerQuote(currentProject(), customerFields);
    const html = bilingual?createBilingualSummaryDocument(quote):createCustomerQuoteDocument(quote);
    const name = bilingual?customerQuoteFileName(quote).replace('-客户报价草稿.html','-中英文条款摘要草稿.html').replace(/[\u0000-\u001F]/g,'-'):customerQuoteFileName(quote);
    if(bilingual){customerSummaryBusy=true;render();}
    const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
    if (picker !== undefined) {
      const handle = await picker.call(window, { suggestedName: name, types: [{ description: bilingual?'中英文条款摘要草稿':'客户报价说明草稿', accept: { 'text/html': ['.html'] } }] });
      const writable = await handle.createWritable(); await writable.write(html); await writable.close();
      state.status = `已导出${label}草稿 ${handle.name}；项目文件仍需单独保存${state.dirty ? '；有未保存改动' : ''}`;
    } else {
      downloadText(name, html, 'text/html');
      state.status = `已发起${label}草稿下载，请确认文件已保存；项目保存状态未改变`;
    }
    state.statusLevel = 'warn';
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') { state.status = `已取消${label}导出，项目保存状态未改变`; state.statusLevel = 'warn'; }
    else { state.status = `${label}导出失败：${error instanceof Error ? error.message : '文件未写入'}`; state.statusLevel = 'error'; }
  }finally{if(bilingual)customerSummaryBusy=false;}
  render();
}

function showFileError(error: unknown): void {
  const failure = inputFailure(error);
  state.status = isEngineError(error) ? `${failure.message}；${failure.hint}` : `打开失败：${error instanceof Error ? error.message : '文件无法读取，请核对文件内容与读取权限'}`;
  state.statusLevel = 'error';
  render();
}

function openProjectFromText(text: string, fileName: string): void {
  try {
    const project = parseProject(text);
    // 所有可能失败的准备步骤完成后，才替换当前编辑内容。
    const fxRows = booksToRows(project.fx_books);
    pairFxLease=null;containerPair.cancelReads();
    state.project = project;
    workspaceNote = '已打开本地项目；按文件中保存的费用、报价与适用条件核对。';
    containerBill.projectChanged();
    settlementPlan = null;
    settlementEpoch++;
    sensitivityControls = newSensitivityControls();
    customerFields = emptyCustomerQuoteFields();
    customerReviewed = false;
    state.fxRows = fxRows;
    state.fileName = fileName;
    state.savedAt = null;
    state.dirty = false;
  } catch (error) {
    showFileError(error);
    return;
  }
  recompute();
  render();
}

function newProject(mode: 'sample' | 'china-sample' | 'china-blank' = 'sample'): void {
  pairFxLease=null;containerPair.cancelReads();
  projectReadEpoch++;
  settlementPlan = null;
  settlementEpoch++;
  sensitivityControls = newSensitivityControls();
  customerFields = emptyCustomerQuoteFields();
  customerReviewed = false;
  state.project = mode === 'china-blank' ? newChinaImportProjectFile() : mode === 'china-sample' ? chinaImportSampleProjectFile() : sampleProjectFile();
  workspaceNote = mode==='china-blank'?'空白中国进口交易：金额、费用、日期、税率与资格均需填写，不自动补造。':mode==='china-sample'?'中国进口合成示例：虚构税率与汇率，仅用于公式核对。':'CIF 合成示例：货值100,000、运费8,000、保险300 USD；另有虚构汇率及税务假设。';
  state.fxRows = booksToRows(state.project.fx_books);
  containerBill.projectChanged();
  state.fileName = null;
  state.savedAt = null;
  state.dirty = true;
  state.status = mode === 'china-blank' ? '已新建空白中国进口交易，请按录入提示填写' : '已载入示例数据';
  state.statusLevel = 'info';
  recompute();
  render();
}

// ---------- 渲染 ----------

function saveStateText(): { text: string; className: string } {
  if (state.statusLevel === 'error') return { text: state.status, className: 'save-state error' };
  if (state.statusLevel === 'warn') return { text: state.status, className: 'save-state dirty' };
  const target = state.fileName ?? '尚未保存为文件';
  const when = state.savedAt !== null ? ` · 上次保存 ${state.savedAt}` : '';
  const dirtyMark = state.dirty ? ' · 有未保存改动' : '';
  if (draftStorageUnavailable) {
    return { text: `${target}${dirtyMark} · 自动草稿保存失败，请保存项目文件`, className: 'save-state dirty' };
  }
  return {
    text: `${target}${when}${dirtyMark}`,
    className: `save-state${state.dirty ? ' dirty' : ''}`,
  };
}

function render(): void {
  if (recoveryStage) return;
  runUi('RENDER',()=>{ renderApp(); clearRecoveryView(); });
}
function renderApp(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (app === null) return;
  const focused = focusKeyOf(document.activeElement ?? document.body);
  const mobileReset=mobileSettings.beforeRender(state.project);
  const saveState = saveStateText();
  const workspace: WorkspaceResult = {project:currentProject(),result:state.result,comparison:state.comparison,error:state.error,
    issues:state.error===null?[]:workspaceIssues(currentProject(),state.fxRows),calculatedAt,mode:workspaceMode};

  app.innerHTML = `
    <div class="workspace" data-workspace-mode="${workspaceMode}" data-calculation-pending="${pendingCalculation}">
    <header class="app-bar">
      <div class="brand">国际贸易成本<span class="sub">COCUDTT · 本地工作台</span></div>
      ${renderModeSwitch(workspaceMode)}
      <div class="file-actions workspace-file-actions">
        <button class="primary" data-action="save">保存项目</button>
        <details class="workspace-export" data-evidence-section="file-menu"><summary data-action="toggle-file-menu">项目与导出</summary><div>
        <button data-action="open">打开项目 JSON</button>
        <button data-action="export-report"${state.result === null || state.comparison === null ? ' disabled' : ''}>导出内部测算报告</button>
        <button data-action="export-internal-xlsx"${state.comparison === null ? ' disabled' : ''}>导出内部成本 Excel</button>
        <button data-action="preview-customer-quote">客户报价预览</button>
        </div></details>
        <input type="file" id="file-input" accept=".json,application/json" style="display:none" />
      </div>
      ${renderKpis({ result: state.result, comparison: state.comparison, error: state.error })}
      ${renderCalculationStatus(workspace)}
    </header>
    <main class="layout">
      <div class="workspace-file-state"><span class="${saveState.className}" role="status" aria-live="polite">${escapeHtml(saveState.text)}</span><span>仅供学习与内部测算。数据仅在本机浏览器；清除存储会丢失草稿，请另存项目 JSON。</span></div>
      ${renderQuickStart(state.project,workspaceNote)}
      ${renderFormsRow(state.project,workspaceMode==='beginner')}
      <div class="mobile-settings-entry"><button type="button" data-action="show-mobile-settings">高级设置 · 费用、汇率与税务 →</button></div>
      ${quickCosts.render(state.project,state.result)}
      ${renderWorkspaceSummary(workspace)}
      ${renderCalculationLearning(state.result,state.error)}
      <details class="panel workspace-results" data-evidence-section="full-results"${workspaceMode==='professional'&&!collapsedSections.has('full-results')?' open':''}><summary><span class="panel-title">完整计算过程与方案对比</span><span class="hint">公式、费用归属、税基、风险与来源</span></summary><div class="panel-body">
      ${renderOutputColumn({ result: state.result, comparison: state.comparison, error: state.error, inputLocations })}
      ${renderSensitivityPanel(currentProject(), state.result, sensitivityControls, sensitivityAnalysis, sensitivityError)}
      </div></details>
      <details class="panel workspace-advanced" data-evidence-section="advanced-settings"${workspaceMode==='professional'&&!collapsedSections.has('advanced-settings')?' open':''}><summary><span class="panel-title">高级设置</span><span class="hint">运保费、汇率、税务与合同依据</span></summary><div class="panel-body">
      <p class="hint block">适用场景：录入实际费用、进口计税、商业和海关汇率，或核对合同费用约定。收起只改变显示，原字段仍参与计算；没有录入的费用不会自动视为已核实的零费用。</p>
      ${workspaceMode==='beginner'?renderAdvancedTradeFields(state.project):''}
      ${renderItemsPanel(state.project, enrichmentMap())}
      ${renderFxPanel(state.fxRows)}
      ${renderImportTaxPanel(state.project)}
      ${renderHsPanel(state.project)}
      ${renderTransportLinkControls(state.project)}
      </div></details>
      <div class="workspace-section-label"><h2>业务资料与交接</h2><p>按实际需要展开。独立账单、付款计划与核对记录不自动写入交易成本。</p></div>
      ${renderSettlementPanel(currentProject(), settlementPlan, state.result, settlementBusy)}
      ${renderContainerBillPanel(containerBill.draft,currentProject(),containerBill.busy,containerBill.message)}
      ${renderContainerCostPairPanel(containerPair)}
      ${renderCustomerQuotePanel(currentProject(), customerFields, customerReviewed, customerPreview, customerError, customerPdfBusy,customerSummaryBusy)}
      <details class="panel" data-evidence-section="workspace-help"${workspaceMode==='professional'&&!collapsedSections.has('workspace-help')?' open':''}><summary><span class="panel-title">帮助、示例与文件模板</span><span class="hint">适用范围、假设说明及恢复检查</span></summary><div class="panel-body">
      <aside class="responsibility-notice" aria-label="责任声明">本工具仅供学习与内部测算参考，不构成法律或专业贸易建议。实际合同请以 Incoterms® 官方文本及当地法规为准。</aside>
      <details class="panel" data-evidence-section="project-introduction">
        <summary><span class="panel-title">项目说明 · 适用范围与使用方法</span></summary>
        <div class="panel-body">
          <p>面向外贸业务人员的本地成本测算工具，当前重点是中国一般贸易进口、单商品一票。录入货物净价与费用，记录税率、汇率及业务条件，再比较贸易术语下的买方支付和费用承担。</p>
          <p>项目以标准 JSON 保存，带版本号；计算、项目文件与内部 HTML 报告均在本机处理。请先打开“中国进口示例”理解口径，再用“新建中国进口”录入自己的数据。</p>
          <p>结果中的费用依据可展开查看归属规则、候选条件与汇总去重；计算过程保留真实操作数、税款舍入和免征前后值。四张费用与税基图使用本次测算，内部报告同步保留解释。</p>
          <p>来源未核对、条件未确认和未知卖方成本会明确提示。客户HTML、Excel、PDF与中英文摘要、内部报告及项目模板均在本机生成。内部付款计划独立保存、按原币逐笔对账，银行费用不重复写回成本；资金占用按明确本金、日期、利率和年基数独立测算。多商品、其他国家专用税制和复杂资金安排仍属后续范围；专业与真实单据验收暂缓。</p>
          <p>工程采用严格 TypeScript、decimal.js、Vite 与 Vitest，分开维护领域类型、规则与计算、文件校验和界面。<a href="project-introduction.html">完整项目介绍</a>介绍设计取舍及验证证据；该独立页面与工具放在同一目录时可打开，本说明无需额外文件。</p>
          <details><summary>PDF 字体许可与来源</summary><pre class="font-license">${escapeHtml(fontProvenance)}\n${escapeHtml(fontLicense)}</pre></details>
        </div>
      </details>
      ${renderProjectTemplatePanel(projectResourceBusy)}
      ${renderFundingExamplePanel(projectResourceBusy)}
      ${renderRoundingExamplePanel(projectResourceBusy)}
      ${renderPeriodExamplePanel(projectResourceBusy)}
      ${renderRecoveryReviewPanel(recoveryReview,recoveryReviewBusy,recoveryReviewError)}
      </div></details>
      <footer class="app-footer">
        <span>费用 ${state.project.items.length} 项 · 11 术语对比 · 核算币种 ${escapeHtml(state.project.base_currency)}</span>
        <span>数据保存在本机，不上传任何服务器</span>
        <span>仅供学习与内部测算，不构成法律或专业贸易建议</span>
        <a href="project-introduction.html">项目说明与开发记录</a>
      </footer>
    </main>
    ${fieldHelp.render()}
    ${mobileSettings.render(saveState.text,state.status)}
    </div>
  `;

  document.querySelectorAll<HTMLDetailsElement>('details.panel').forEach((element) => {
    const key = element.dataset.section;
    if (key !== undefined && collapsedSections.has(key)) element.open = false;
  });
  document.querySelectorAll<HTMLDetailsElement>('details[data-evidence-section]').forEach((element) => {
    if (element.dataset.evidenceSection !== undefined && expandedEvidenceSections.has(element.dataset.evidenceSection)) element.open = true;
  });
  mobileSettings.afterRender();
  if(!mobileReset)restoreFocus(focused);
  fieldHelp.afterRender();
}

function commit(): void {
  containerPair.cancelReads();
  invalidateTransportCostLinks(state.project);
  containerBill.projectChanged();
  projectReadEpoch++;
  customerReviewed = false;
  state.dirty = true;
  recompute();
  render();
}

/**
 * 补全"已含于"下拉的候选列表。
 *
 * 费用项可能有几百笔，若在渲染时为每一笔都列出其余全部费用项，
 * 就变成 O(n²) 个 option（300 笔约 9 万个），界面会卡到无法使用。
 * 因此渲染时只放当前值，用户真正要选的时候才把候选填进去。
 */
function populateContainedIn(select: HTMLSelectElement, costId: string): void {
  if (select.dataset.populated === '1') return;
  const current = select.value;
  const fragment = document.createDocumentFragment();
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '未含于他项';
  fragment.append(none);
  for (const candidate of state.project.items) {
    if (candidate.cost_id === costId) continue;
    const option = document.createElement('option');
    option.value = candidate.cost_id;
    option.textContent = candidate.cost_name;
    fragment.append(option);
  }
  select.replaceChildren(fragment);
  select.value = current;
  select.dataset.populated = '1';
}

function bind(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (app === null) return;
  if (boundRoot !== app) { boundRoot = app; boundEvents.clear(); }
  const listen = (type: string, listener: (event: Event) => void, capture = false): void => {
    if (boundEvents.has(type)) return;
    app.addEventListener(type,event=>{ if (!recoveryStage) runUi('INTERACTION',()=>listener(event)); },capture);
    boundEvents.add(type);
  };

  const calculationInput = (target: HTMLInputElement): boolean => target.type!=='file' &&
    (target.dataset.quickCostField==='amount'||['path','itemField','fxField','hsField','contractField','logisticsField'].some(key=>target.dataset[key]!==undefined));
  const commitsInput=(action:string):boolean=>['save','open','toggle-file-menu','show-field-help','show-quick-costs','show-cost-settings','show-full-results','show-calculation-learning','learning-target','show-mobile-settings','close-mobile-settings','locate-workspace-issue','locate-input'].includes(action)||action.startsWith('mode-');
  const flushInput=():void=>{
    const active=document.activeElement;
    if(active instanceof HTMLInputElement&&(pendingCalculation&&calculationInput(active)||editedControl===active))active.dispatchEvent(new Event('change',{bubbles:true}));
  };
  mobileSettings.onReturn=()=>runUi('INTERACTION',()=>{flushInput();if(!pendingCalculation)mobileSettings.dismiss();});
  if(typeof window.addEventListener==='function'&&!boundEvents.has('mobile-resize')){window.addEventListener('resize',()=>runUi('INTERACTION',()=>mobileSettings.resize()));boundEvents.add('mobile-resize');}
  listen('input',event=>{
    const target=event.target;if(target instanceof HTMLInputElement&&target.type!=='file')editedControl=target;
    if(!(target instanceof HTMLInputElement)||!calculationInput(target))return;
    pendingCalculation=true;
    const workspace=document.querySelector<HTMLElement>('[data-workspace-mode]');if(workspace)workspace.dataset.calculationPending='true';
    const status=document.querySelector<HTMLElement>('[data-calculation-status]');if(status)status.textContent='输入已变更 · 待更新';
    document.querySelectorAll<HTMLButtonElement>('[data-action^="export-"],[data-action="preview-customer-quote"]').forEach(button=>button.disabled=true);
  });
  // Keep the active input until a toolbar click can commit it. Otherwise blur
  // replaces the clicked DOM node before mouseup, swallowing the first click.
  listen('mousedown',event=>{
    const target=event.target;if(!(pendingCalculation||editedControl===document.activeElement)||!(target instanceof HTMLElement)||(event as MouseEvent).button!==0)return;
    const action=target.dataset.action;if(action&&commitsInput(action))event.preventDefault();
  });
  listen('keydown',event=>{
    const key=event as KeyboardEvent,target=event.target;
    if(key.key!=='Enter'||key.isComposing||!(target instanceof HTMLInputElement)||!calculationInput(target))return;
    event.preventDefault();target.dispatchEvent(new Event('change',{bubbles:true}));
  });

  listen('focusin', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.dataset.lazyOptions !== 'contained-in') return;
    const costId = target.dataset.item;
    if (costId !== undefined) populateContainedIn(target, costId);
  });

  // details 的 toggle 不冒泡，用捕获阶段监听
  listen(
    'toggle',
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLDetailsElement)) return;
      const evidenceSection = target.dataset.evidenceSection;
      if (evidenceSection !== undefined) {
        if (target.open) expandedEvidenceSections.add(evidenceSection);
        else expandedEvidenceSections.delete(evidenceSection);
        if(['advanced-settings','full-results','workspace-help'].includes(evidenceSection)){
          if(target.open)collapsedSections.delete(evidenceSection);else collapsedSections.add(evidenceSection);
        }
        return;
      }
      const key = target.dataset.section;
      if (key === undefined) return;
      if (target.open) collapsedSections.delete(key);
      else collapsedSections.add(key);
    },
    true,
  );

  listen('change', (event) => {
    const target = event.target;
    if(editedControl===target)editedControl=null;
    if(target instanceof HTMLInputElement&&target.id==='pair-file-input'){const file=target.files?.[0];if(file)void containerPair.open(file);return;}
    containerPair.cancelReads();
    if((target instanceof HTMLInputElement||target instanceof HTMLSelectElement)&&target.dataset.quickCostField!==undefined){
      const {quickCostKind,quickCostField,quickCostLease,quickCostId}=target.dataset;
      if(quickCostField==='choose'){if(quickCosts.choose(state.project,quickCostKind,target.value,quickCostLease)){expandedEvidenceSections.add('quick-costs');render();}return;}
      if(quickCostField==='amount'&&target instanceof HTMLInputElement){const id=quickCosts.editTarget(state.project,quickCostKind,quickCostId,quickCostLease);if(id){onItemField(id,'amount',target);commit();}else render();}return;
    }
    if(target instanceof HTMLInputElement&&target.dataset.pairCopyField!==undefined){containerPair.editCopy(target.dataset,target.value,target.checked);return;}
    if((target instanceof HTMLInputElement||target instanceof HTMLSelectElement||target instanceof HTMLTextAreaElement)&&target.dataset.pairReviewField!==undefined){containerPair.editReview(target.dataset,target.value);return;}
    if((target instanceof HTMLInputElement||target instanceof HTMLSelectElement||target instanceof HTMLTextAreaElement)&&target.dataset.pairEditorField!==undefined){containerPair.edit(target.dataset,target.value);return;}
    if(target instanceof HTMLInputElement&&target.id==='bill-file-input'){
     const file=target.files?.[0];if(file)void containerBill.open(file);return;
    }
    if((target instanceof HTMLInputElement||target instanceof HTMLSelectElement||target instanceof HTMLTextAreaElement)&&target.dataset.billField!==undefined){containerBill.edit(target.dataset,target.value);return;}

    if (target instanceof HTMLInputElement && target.id === 'recovery-review-input') {
      const file = target.files?.[0];
      if (!file) return;
      const epoch = ++recoveryReviewEpoch;
      recoveryReview = null; recoveryReviewError = null; recoveryReviewBusy = true;
      expandedEvidenceSections.add('recovery-review'); render();
      const read = async (): Promise<void> => {
        let review: RecoveryReview | null = null, error: string | null = null;
        try {
          if (file.size > RECOVERY_REVIEW_MAX_BYTES) throw Error('恢复文件超过5 MiB检查上限；请保留原文件，分开人工核对');
          const text = await file.text();
          if (epoch !== recoveryReviewEpoch) return;
          // Inspector errors are controlled messages; file API errors may contain private paths.
          try { review = inspectRecoveryText(text); } catch (failure) { error = failure instanceof Error ? failure.message : '恢复文件无法检查，请保留原文'; }
        } catch { error = file.size > RECOVERY_REVIEW_MAX_BYTES ? '恢复文件超过5 MiB检查上限；请保留原文件，分开人工核对' : '恢复文件读取失败；请保留原文件并核对读取权限'; }
        if (epoch !== recoveryReviewEpoch || recoveryStage) return;
        runUi('INTERACTION',()=>{ recoveryReview = review; recoveryReviewError = error; recoveryReviewBusy = false; render(); });
      };
      void read();
      return;
    }

    if (target instanceof HTMLInputElement && target.id === 'settlement-file-input') {
      const file = target.files?.[0];
      if (!file) return;
      const epoch = ++settlementEpoch;
      void file.text().then(text => {
        if (epoch !== settlementEpoch) return;
        const parsed = parseSettlementPlan(text);
        settlementPlan = parsed;
        state.status = '已打开内部付款计划；当前交易未改变，绑定和费用仍按当前项目重新核对';
        state.statusLevel = 'warn';
        expandedEvidenceSections.add('settlement'); render();
      }).catch(error => { if (epoch === settlementEpoch) showFileError(error); });
      return;
    }

    if (target instanceof HTMLInputElement && target.id === 'file-input') {
      containerPair.cancelReads();
      const file = target.files?.[0];
      if (file === undefined) return;
      const epoch=++projectReadEpoch;
      void file.text().then((text) => { if (epoch===projectReadEpoch&&!recoveryStage) runUi('INTERACTION',()=>openProjectFromText(text,file.name)); }).catch(error=>{if(epoch===projectReadEpoch)showFileError(error)});
      return;
    }

    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;

    if (target.dataset.settlementField !== undefined && (target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      onSettlementField(target); return;
    }

    if (target.dataset.customerField !== undefined) {
      const field = target.dataset.customerField;
      if (field === 'reviewed') customerReviewed = target instanceof HTMLInputElement && target.checked && customerPreview !== null;
      else if (CUSTOMER_QUOTE_FIELDS.some(key => key === field)) {
        customerFields[field as keyof typeof customerFields] = target.value;
        customerReviewed = false;
        recomputeCustomerPreview();
      }
      render();
      return;
    }

    // 客户公开文字使用textarea；其余既有录入仍只接受input/select。
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;

    if (target.dataset.sensitivityField !== undefined) {
      const field = target.dataset.sensitivityField;
      if (field === 'enabled') sensitivityControls.enabled = target instanceof HTMLInputElement && target.checked;
      else if (field === 'kind' && ['FREIGHT', 'FX', 'RESPONSIBILITY'].includes(target.value)) {
        sensitivityControls.kind = target.value as typeof sensitivityControls.kind;
        sensitivityControls.target = sensitivityOptions(currentProject(), state.result, sensitivityControls.kind)[0]?.value ?? '';
      } else if (field === 'target' || field === 'from' || field === 'to' || field === 'step') sensitivityControls[field] = target.value;
      recomputeSensitivity();
      render();
      return;
    }

    if (target.dataset.evidenceOwner !== undefined && target.dataset.evidenceField !== undefined) {
      onEvidenceField(target.dataset.evidenceOwner, target.dataset.evidenceId ?? '', target.dataset.evidenceField, target.value);
      commit();
      return;
    }
    if(target.dataset.overlapField!==undefined&&state.project.schema_version==='0.9'){
      const r=state.project.term_scenarios?.[state.project.incoterm]?.transport_cost_links?.overlap_resolutions?.[Number(target.dataset.overlapIndex)];if(!r)return;
      const field=target.dataset.overlapField;if(field==='first'&&target.value.length<=200)r.cost_ids[0]=target.value;if(field==='second'&&target.value.length<=200)r.cost_ids[1]=target.value;if(field==='note'&&target.value.length<=4000)r.note=target.value;if(field==='basis'&&(target.value==='EXISTING_CONTAINMENT'||target.value==='DISTINCT_BILLING'))r.basis=target.value;commit();return;
    }
    if(target.dataset.linkField!==undefined&&state.project.schema_version==='0.9'){
      const input=state.project.term_scenarios?.[state.project.incoterm]?.transport_cost_links;if(!input)return;
      const field=target.dataset.linkField,id=target.dataset.linkCost,link=input.links.find(l=>l.cost_id===id);
      if(field==='add'&&target.value&&target.value.length<=200&&input.target_cost_ids.length<100&&!input.target_cost_ids.includes(target.value)&&state.project.items.some(c=>c.cost_id===target.value)){input.target_cost_ids.push(target.value);input.links.push({cost_id:target.value,state:'UNCONFIRMED',segment_ids:[],charge_kind:'UNCONFIRMED',scope_id:''});}
      if(link){if(field==='state'&&['UNCONFIRMED','LINKED','NOT_APPLICABLE'].includes(target.value))link.state=target.value as typeof link.state;
       if(field==='charge_kind'&&['UNCONFIRMED','CARRIAGE','HANDLING','DELAY','INSPECTION','OTHER'].includes(target.value))link.charge_kind=target.value as TransportChargeKind;
       if(field==='scope_id'&&target.value.length<=200)link.scope_id=target.value;
       if(field==='segment'&&target instanceof HTMLInputElement){const segment=target.dataset.linkSegment;if(segment){if(target.checked&&!link.segment_ids.includes(segment)&&link.segment_ids.length<100)link.segment_ids.push(segment);if(!target.checked)link.segment_ids=link.segment_ids.filter(s=>s!==segment);}}
      }commit();return;
    }
    if (target.dataset.contractCost !== undefined && target.dataset.contractField !== undefined) {
      onContractField(target.dataset.contractCost, target.dataset.contractField, target.value);
      commit();
      return;
    }
    if (target.dataset.logisticsKind !== undefined && target.dataset.logisticsField !== undefined) {
      onLogisticsField(target.dataset.logisticsKind, target.dataset.logisticsField, target);
      commit();
      return;
    }

    if (target.dataset.action === 'add-preset') {
      if (target.value !== '') addPresetItem(target.value);
      commit();
      return;
    }

    const path = target.dataset.path;
    const itemId = target.dataset.item;
    const itemField = target.dataset.itemField;
    const fxId = target.dataset.fx;
    const fxField = target.dataset.fxField;
    const hsIndex = target.dataset.hs;
    const hsField = target.dataset.hsField;

    if (path !== undefined) onProjectField(path, target);
    else if (itemId !== undefined && itemField !== undefined) onItemField(itemId, itemField, target);
    else if (fxId !== undefined && fxField !== undefined) onFxField(fxId, fxField, target);
    else if (hsIndex !== undefined && hsField !== undefined) onHsField(Number(hsIndex), hsField, target);
    else return;
    commit();
  });

  listen('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;
    if (action === undefined) return;
    if(['show-mobile-settings','show-cost-settings','locate-workspace-issue','locate-input'].includes(action))mobileSettings.remember(target);
    if(commitsInput(action))flushInput();
    if(pendingCalculation&&(action==='save'||action.startsWith('export-')||action==='preview-customer-quote'||action.startsWith('mode-')||action==='show-calculation-learning'||action==='learning-target'))return;
    if(!action.startsWith('pair-'))containerPair.cancelReads();
    switch (action) {
      case 'show-mobile-settings':
        if(!mobileSettings.open(target)){expandedEvidenceSections.add('advanced-settings');collapsedSections.delete('advanced-settings');render();focusInputSection('items');}break;
      case 'close-mobile-settings':
        if(!pendingCalculation)mobileSettings.dismiss();break;
      case 'show-calculation-learning': {
        expandedEvidenceSections.add('calculation-learning');render();
        const summary=document.querySelector<HTMLElement>('[data-evidence-section="calculation-learning"] > summary');if(summary)revealWorkspaceElement(summary);break;
      }
      case 'learning-target':
        mobileSettings.dismiss(false);
        if(state.error===null)focusLearningTarget(state.result,target.dataset.learningKind,target.dataset.learningId);break;
      case 'show-field-help':
        event.preventDefault();fieldHelp.open(target.dataset.helpTopic,target.dataset.helpAnchor);break;
      case 'close-field-help':fieldHelp.dismiss();break;
      case 'show-quick-costs': {
        mobileSettings.dismiss(false);
        expandedEvidenceSections.add('quick-costs');render();
        const select=document.querySelector<HTMLElement>('[data-quick-cost-field="choose"]');if(select)revealWorkspaceElement(select);break;
      }
      case 'toggle-file-menu':
        event.preventDefault();
        if(expandedEvidenceSections.has('file-menu'))expandedEvidenceSections.delete('file-menu');else expandedEvidenceSections.add('file-menu');
        render();break;
      case 'mode-beginner':
      case 'mode-professional':
        mobileSettings.dismiss(false);
        workspaceMode=action==='mode-professional'?'professional':'beginner';
        for(const section of ['advanced-settings','full-results','workspace-help']) {
          if(workspaceMode==='professional'){expandedEvidenceSections.add(section);collapsedSections.delete(section);}
          else{expandedEvidenceSections.delete(section);collapsedSections.add(section);}
        }
        if(!saveWorkspaceMode(workspaceMode)){state.status='本次模式切换有效；浏览器存储不可用，刷新后会回到新手模式';state.statusLevel='warn';}
        render();break;
      case 'show-full-results': {
        mobileSettings.dismiss(false);
        expandedEvidenceSections.add('full-results');render();
        const summary=document.querySelector<HTMLElement>('[data-evidence-section="full-results"] > summary');if(summary)revealWorkspaceElement(summary);
        break;
      }
      case 'show-cost-settings':
        expandedEvidenceSections.add('advanced-settings');collapsedSections.delete('advanced-settings');render();mobileSettings.open(target);focusInputSection('items');break;
      case 'locate-workspace-issue': {
        const index=Number(target.dataset.issueIndex);
        const issue=state.error!==null&&Number.isInteger(index)?workspaceIssues(currentProject(),state.fxRows)[index]:undefined;
        if(issue){mobileSettings.route(workspaceIssueElement(issue),target);focusWorkspaceIssue(issue);}break;
      }
      case 'pair-review-example':
      case 'pair-review-enable':
      case 'pair-review-start':
      case 'pair-review-edit':
      case 'pair-review-submit':
      case 'pair-review-discard':
      case 'pair-review-confirm':
      case 'pair-review-remove':
      case 'pair-review-next':
      case 'pair-review-prev':
      case 'pair-copy-prepare':
      case 'pair-copy-save':
      case 'pair-copy-discard':
      case 'pair-editor-start':
      case 'pair-editor-facts':
      case 'pair-editor-submit':
      case 'pair-editor-discard':
      case 'pair-confirm-selection':
      case 'pair-new':
      case 'pair-capture':
      case 'pair-add-references':
      case 'pair-remove-selection':
      case 'pair-clear':
      case 'pair-save':
        expandedEvidenceSections.add('container-cost-pair');containerPair.action(action,target.dataset);break;
      case 'pair-open':containerPair.cancelReads();document.querySelector<HTMLInputElement>('#pair-file-input')?.click();break;
      case 'bill-new':
      case 'bill-example':
      case 'bill-clear':
      case 'bill-save':
      case 'bill-rebind':
      case 'bill-schema':
      case 'bill-empty-template':
      case 'bill-example-template':
      case 'bill-add-line':
      case 'bill-remove-line':
      case 'bill-add-tier':
      case 'bill-remove-tier':
      case 'bill-clean-mode':
      case 'bill-confirm-source':
      case 'bill-confirm-reference':
      case 'bill-clear-reference':
        expandedEvidenceSections.add('container-bill');containerBill.action(action,target.dataset);break;
      case 'bill-open':document.querySelector<HTMLInputElement>('#bill-file-input')?.click();break;
      case 'inspect-recovery':
        document.querySelector<HTMLInputElement>('#recovery-review-input')?.click();
        break;
      case 'clear-recovery-review':
        recoveryReviewEpoch++; recoveryReview = null; recoveryReviewError = null; recoveryReviewBusy = false; render();
        break;
      case 'locate-input': {
        const section = target.dataset.inputSection;
        const valid = inputLocations.find(key => key === section);
        if(valid){mobileSettings.route(inputSectionElement(valid),target);if(focusInputSection(valid))collapsedSections.delete(valid);}
        break;
      }
      case 'settlement-enable-funding':
        if (settlementPlan?.version === '1.0') {
          settlementPlan.version = '1.1'; settlementPlan.funding = newFundingAssumption();
          settlementEpoch++; render();
        }
        break;
      case 'settlement-enable-ledger':
        if (settlementPlan) {
          try { settlementPlan = enableFundingLedger(settlementPlan); settlementEpoch++; state.status = '已升级付款计划1.2；保留原输入，请重新确认资金测算范围'; state.statusLevel = 'warn'; render(); }
          catch (error) { showFileError(error); }
        }
        break;
      case 'settlement-enable-rounding':
        if(settlementPlan){try{settlementPlan=enableFundingRounding(settlementPlan);settlementEpoch++;state.status='已升级付款计划1.4；请重新确认资金范围与金额舍入依据';state.statusLevel='warn';render();}catch(error){showFileError(error);}}
        break;
      case 'settlement-enable-periods':
        if(settlementPlan){try{settlementPlan=enableFundingPeriods(settlementPlan);settlementEpoch++;state.status='已升级付款计划1.5；请重新核对资金、舍入与明确期间边界';state.statusLevel='warn';render();}catch(error){showFileError(error);}}
        break;
      case 'settlement-add-period':
      case 'settlement-remove-period': {
        if(settlementPlan?.version==='1.5'){
          const f=settlementPlan.funding!,rows=f.period_schedule!.periods;
          if(action==='settlement-add-period'&&rows.length<100){let id=1;while(rows.some(row=>row.id===`period-${id}`))id++;rows.push({id:`period-${id}`,start_date:'',end_date:'',reference:''});}
          else if(action==='settlement-remove-period'){const index=Number(target.dataset.settlementIndex);if(Number.isInteger(index)&&index>=0&&index<rows.length)rows.splice(index,1);}
          f.period_schedule!.periods_confirmed=false;settlementEpoch++;render();
        }break;
      }
      case 'settlement-enable-rates':
        if(settlementPlan){try{settlementPlan=enableFundingRates(settlementPlan);settlementEpoch++;state.status='已升级付款计划1.3；请重新确认利率及资金测算范围';state.statusLevel='warn';render();}catch(error){showFileError(error);}}
        break;
      case 'settlement-add-rate-event': {
        if((settlementPlan?.version==='1.3'||settlementPlan?.version==='1.4'||settlementPlan?.version==='1.5')){const rows=settlementPlan.funding!.rate_events!;if(rows.length<100){let id=1;while(rows.some(row=>row.id===`rate-${id}`))id++;rows.push(newFundingRateEvent(`rate-${id}`));if(settlementPlan.version==='1.4'||settlementPlan.version==='1.5')settlementPlan.funding!.rounding!.intervals_confirmed=false;if(settlementPlan.version==='1.5')settlementPlan.funding!.period_schedule!.periods_confirmed=false;settlementEpoch++;render();}}
        break;
      }
      case 'settlement-remove-rate-event': {
        const index=Number(target.dataset.settlementIndex),rows=(settlementPlan?.version==='1.3'||settlementPlan?.version==='1.4'||settlementPlan?.version==='1.5')?settlementPlan.funding?.rate_events:null;
        if(rows&&Number.isInteger(index)&&index>=0&&index<rows.length){rows.splice(index,1);if(settlementPlan?.version==='1.4'||settlementPlan?.version==='1.5')settlementPlan.funding!.rounding!.intervals_confirmed=false;if(settlementPlan?.version==='1.5')settlementPlan.funding!.period_schedule!.periods_confirmed=false;settlementEpoch++;render();}break;
      }
      case 'settlement-add-funding-event': {
        if (settlementPlan && ['1.2','1.3','1.4','1.5'].includes(settlementPlan.version)) {
          const rows = settlementPlan.funding!.events!;
          if (rows.length < 100) { let id=1; while(rows.some(row=>row.id===`funding-${id}`))id++; rows.push(newFundingPrincipalEvent(`funding-${id}`)); if(settlementPlan.version==='1.4'||settlementPlan.version==='1.5')settlementPlan.funding!.rounding!.intervals_confirmed=false;if(settlementPlan.version==='1.5')settlementPlan.funding!.period_schedule!.periods_confirmed=false; settlementEpoch++; render(); }
        }
        break;
      }
      case 'settlement-remove-funding-event': {
        const index=Number(target.dataset.settlementIndex),rows=(['1.2','1.3','1.4','1.5'].includes(settlementPlan?.version??''))?settlementPlan?.funding?.events:null;
        if(rows&&Number.isInteger(index)&&index>=0&&index<rows.length){rows.splice(index,1);if(settlementPlan?.version==='1.4'||settlementPlan?.version==='1.5')settlementPlan.funding!.rounding!.intervals_confirmed=false;if(settlementPlan?.version==='1.5')settlementPlan.funding!.period_schedule!.periods_confirmed=false;settlementEpoch++;render();}
        break;
      }
      case 'settlement-create':
      case 'settlement-rebind':
        try {
          const binding = settlementBinding(currentProject());
          if (action === 'settlement-rebind' && settlementPlan){settlementPlan.binding=binding;if(settlementPlan.version==='1.5'){settlementPlan.funding!.status='UNCONFIRMED';settlementPlan.funding!.rounding!.status='UNCONFIRMED';settlementPlan.funding!.rounding!.intervals_confirmed=false;settlementPlan.funding!.period_schedule!.periods_confirmed=false;}}
          else settlementPlan = newSettlementPlan(binding);
          settlementEpoch++; expandedEvidenceSections.add('settlement'); render();
        } catch (error) { showFileError(error); }
        break;
      case 'settlement-add-payment':
      case 'settlement-add-fee': {
        if (settlementPlan) {
          const rows = action === 'settlement-add-payment' ? settlementPlan.payments : settlementPlan.bank_fees;
          if (rows.length < 100) {
            const prefix = action === 'settlement-add-payment' ? 'payment' : 'fee';
            let id = 1; while (rows.some(row => row.id === `${prefix}-${id}`)) id++;
            if (action === 'settlement-add-payment') settlementPlan.payments.push(newPaymentEntry(`${prefix}-${id}`));
            else settlementPlan.bank_fees.push(newBankFeeEntry(`${prefix}-${id}`));
          }
          settlementEpoch++; render();
        }
        break;
      }
      case 'settlement-remove-payment':
      case 'settlement-remove-fee': {
        const index = Number(target.dataset.settlementIndex);
        const rows = action === 'settlement-remove-payment' ? settlementPlan?.payments : settlementPlan?.bank_fees;
        if (rows && Number.isInteger(index) && index >= 0 && index < rows.length) { rows.splice(index, 1); settlementEpoch++; render(); }
        break;
      }
      case 'settlement-save': void saveSettlement(); break;
      case 'settlement-open': document.querySelector<HTMLInputElement>('#settlement-file-input')?.click(); break;
      case 'download-project-template': void exportProjectResource(target.dataset.templateId); break;
      case 'download-funding-example': void exportProjectResource(undefined,undefined,target.dataset.exampleKind ?? ''); break;
      case 'download-rounding-example': void exportProjectResource(undefined,undefined,target.dataset.roundingKind ?? '','rounding'); break;
      case 'download-period-example': void exportProjectResource(undefined,undefined,target.dataset.periodKind ?? '','period'); break;
      case 'download-project-schema': void exportProjectResource(undefined,target.dataset.schemaKind); break;
      case 'preview-customer-quote':
        expandedEvidenceSections.add('customer-quote'); render();
        document.querySelector('[data-evidence-section="customer-quote"]')?.scrollIntoView({ block: 'start' });
        break;
      case 'export-customer-quote': void exportCustomerQuote(); break;
      case 'export-bilingual-summary': void exportCustomerQuote(true); break;
      case 'export-customer-xlsx': void exportWorkbook(true); break;
      case 'export-customer-pdf': void exportCustomerPdf(); break;
      case 'export-internal-xlsx': void exportWorkbook(false); break;
      case 'add-transport-segment': addTransportSegment(); commit(); break;
      case 'enable-transport-links':
        try{state.project=enableTransportCostLinks(state.project);state.status='已显式启用项目0.9；请明确本方案核对范围，旧工具将拒绝读取';state.statusLevel='warn';commit();}catch{state.status='无法启用：旧同名扩展须先保留并核对，未覆盖原输入';state.statusLevel='error';render();}break;
      case 'remove-transport-link':{const input=state.project.schema_version==='0.9'?state.project.term_scenarios?.[state.project.incoterm]?.transport_cost_links:undefined;if(input){input.target_cost_ids=input.target_cost_ids.filter(id=>id!==target.dataset.linkCost);input.links=input.links.filter(l=>l.cost_id!==target.dataset.linkCost);}commit();break;}
      case 'clear-transport-links':{if(state.project.schema_version==='0.9'){const record=state.project.term_scenarios?.[state.project.incoterm];if(record)delete record.transport_cost_links;}commit();break;}
      case 'add-transport-resolution':{const input=state.project.schema_version==='0.9'?state.project.term_scenarios?.[state.project.incoterm]?.transport_cost_links:undefined;if(input){const rows=input.overlap_resolutions??=[];if(rows.length<100)rows.push({cost_ids:['',''],basis:'EXISTING_CONTAINMENT',note:''});}commit();break;}
      case 'remove-transport-resolution':{const rows=state.project.schema_version==='0.9'?state.project.term_scenarios?.[state.project.incoterm]?.transport_cost_links?.overlap_resolutions:undefined;const i=Number(target.dataset.overlapIndex);if(rows&&Number.isInteger(i)&&i>=0&&i<rows.length)rows.splice(i,1);commit();break;}
      case 'remove-transport-segment': {
        const record = state.project.term_scenarios?.[state.project.incoterm]; const plan = record?.transport;
        const index = Number(target.dataset.segmentIndex);
        if (plan && Number.isInteger(index) && index >= 0 && index < plan.segments.length) {
          plan.segments.splice(index, 1); invalidateEvidence(plan.evidence); invalidateEvidence(record?.insurance?.evidence);
        }
        commit(); break;
      }
      case 'clear-transport-plan': {
        const record = state.project.term_scenarios?.[state.project.incoterm];
        if (record) { delete record.transport; invalidateEvidence(record.insurance?.evidence); }
        commit(); break;
      }
      case 'create-insurance-plan': {
        const record = (state.project.term_scenarios ??= {})[state.project.incoterm] ??= {};
        record.insurance ??= emptyInsurancePlan((record.quote ?? state.project.quote).currency);
        commit(); break;
      }
      case 'clear-insurance-plan': {
        const record = state.project.term_scenarios?.[state.project.incoterm]; if (record) delete record.insurance;
        commit(); break;
      }
      case 'add-container-preset': {
        const before = state.project.items.length;
        addPresetItem(target.dataset.preset ?? '');
        if (state.project.items.length > before) state.project.items[state.project.items.length - 1]!.applicable_incoterms = [state.project.incoterm];
        commit(); break;
      }
      case 'remove-contract-override': {
        if (target.dataset.contractCost) onContractField(target.dataset.contractCost, 'responsibility', 'DEFAULT');
        commit();
        break;
      }
      case 'clear-contract-quote': {
        const record = state.project.term_scenarios?.[state.project.incoterm];
        if (record) { delete record.quote; delete record.quote_evidence; }
        commit();
        break;
      }
      case 'add-custom':
        addCustomItem();
        commit();
        break;
      case 'remove-item': {
        const costId = target.dataset.item;
        if (costId !== undefined) removeItem(costId);
        commit();
        break;
      }
      case 'add-tier': {
        const costId = target.dataset.item;
        const item = costId === undefined ? undefined : state.project.items.find((c) => c.cost_id === costId);
        if (item !== undefined) addTier(item);
        commit();
        break;
      }
      case 'remove-tier': {
        const costId = target.dataset.item;
        const index = Number(target.dataset.tierIndex ?? '-1');
        const item = costId === undefined ? undefined : state.project.items.find((c) => c.cost_id === costId);
        if (item !== undefined && index >= 0) removeTier(item, index);
        commit();
        break;
      }
      case 'add-fx':
        addFxRow();
        commit();
        break;
      case 'remove-fx': {
        const rowId = target.dataset.fx;
        if (rowId !== undefined) state.fxRows = state.fxRows.filter((row) => row.row_id !== rowId);
        commit();
        break;
      }
      case 'add-hs':
        addHsEntry();
        commit();
        break;
      case 'remove-hs': {
        const index = Number(target.dataset.hs ?? '-1');
        const table = ensureHsTable(state.project);
        if (index >= 0) table.entries.splice(index, 1);
        commit();
        break;
      }
      case 'save':
        void saveProject();
        break;
      case 'export-report':
        void exportReport();
        break;
      case 'open':
        document.querySelector<HTMLInputElement>('#file-input')?.click();
        break;
      case 'new':
        newProject();
        break;
      case 'new-china-import':
        newProject('china-sample');
        break;
      case 'new-china-blank':
        newProject('china-blank');
        break;
      default:
        break;
    }
  });
}

export function start(): void {
  runUi('STARTUP',startApplication);
}
function startApplication(): void {
  if (!stateInitialized) { state = initialState(); stateInitialized = true; }
  containerBill.loadLocal();
  containerPair.loadLocal();
  bind();
  recompute(draftFailure === null);
  if (draftFailure !== null) {
    state.status = draftFailure;
    state.statusLevel = 'warn';
  } else if (restoredFromDraft) {
    state.status = `已恢复草稿 · ${state.status}`;
  }
  render();
}
