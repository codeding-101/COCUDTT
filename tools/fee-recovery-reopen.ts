/** Phase100 developer prototype. Opens committed sources in separate real controllers; never installs app.ts. */
import {WorkbenchStateOwner,type WorkbenchCheckpoint} from '../src/ui/workbench-state';
import {ContainerBillController} from '../src/ui/container-bill-controller';
import {ContainerCostPairController} from '../src/ui/container-cost-pair-controller';
import {FeeTaxAttachmentWorkspace} from '../src/ui/fee-tax-attachment-workspace';
import {FeePrecisionSelectionWorkspace} from '../src/ui/fee-precision-selection-workspace';
import {FeeEnvelopeWorkspace} from '../src/ui/fee-envelope-workspace';
import {captureFeeSemanticBudget} from '../src/ui/fee-workbench-semantic-capture';
import {previewRuntimeFeeWorkbench} from '../src/ui/fee-workbench-preview';
import {parseProject,serializeProject,toTrade,toScenario,toScenarios} from '../src/data/project-file';
import {parseContainerBillDraft} from '../src/data/container-bill-file';
import {parseContainerCostPair,serializeContainerCostPair,reviewContainerCostPair} from '../src/data/container-cost-pair';
import {parseFeeTaxAttachment} from '../src/data/fee-tax-attachment';
import {parseFeePrecisionSelection} from '../src/data/fee-precision-selection';
import {parseFeeEnvelope} from '../src/data/fee-envelope';
import {parseFeeEnvelopeJson,canonicalFeeEnvelopeJson} from '../src/data/fee-envelope-json';
import {analyze} from '../src/engine/analyze';
import {compare,scenarioWithDerivedInclusions} from '../src/engine/compare';
import {rowsToBooks,booksToRows,type FxRow} from '../src/ui/fx-rows';
import type {FeeSourceStorage} from '../src/ui/fee-workbench-source-adapter';
import {FeeRecoveryFormat,type FeeRecoveryData} from './fee-recovery-format';
import {freezeRecoveryData} from './fee-recovery-supplement';

type Data=Record<string,unknown>;
function fail(code:string):never{throw Error('FEE_RECOVERY_REOPEN_'+code);}
const copy=<T>(v:T):T=>structuredClone(v);
const participants=Object.freeze(['app','workflow','bill','pair','tax-controller','precision-controller','envelope-controller','tax-workspace','precision-workspace','envelope-workspace']);
export interface FeeRecoveryManifest {
 readonly scope:'SEPARATE_COMMITTED_RECOVERY_MANIFEST';readonly version:'0.1';readonly captured_at:string;readonly logical_utf8_bytes:number;
 readonly sources:readonly {name:string;present:boolean;utf8_bytes:number}[];readonly participants:readonly string[];
 readonly blockers:readonly string[];readonly notices:readonly string[];readonly can_open:boolean;
 readonly historical_application_present:boolean;readonly historical_candidate_present:boolean;readonly unread_files:number;
 readonly required_choice:'OPEN_SEPARATE_RECOVERY_SESSION';readonly financial_writes:0;readonly full_live_workbench_reopen:false;readonly production_integrated:false;
}
function verified(v:FeeRecoveryData):boolean{
 if(!v||typeof v!=='object'||!Object.isFrozen(v))return false;
 const d=Object.getOwnPropertyDescriptors(v),keys=['kind','version','captured_at','source_wire','supplement_json','restoration','supplement','logical_utf8_bytes','financial_writes','import_authority','confirmation_authority','runtime_installed'];
 return Reflect.ownKeys(d).length===keys.length&&keys.every(k=>d[k]?.enumerable&&'value'in d[k]!)&&d.kind!.value==='INTERNAL_FEE_WORKBENCH_RECOVERED_DATA'&&d.version!.value==='0.1'&&d.financial_writes!.value===0&&d.import_authority!.value===false&&d.confirmation_authority!.value===false&&d.runtime_installed!.value===false&&Object.isFrozen(d.restoration!.value)&&Object.isFrozen(d.supplement!.value);
}
function manifest(a:FeeRecoveryData):FeeRecoveryManifest {
 const c=a.restoration.capture,s=a.supplement,r=a.restoration.retained_root as Data,blockers:string[]=[],notices=['ARCHIVE_PRESERVED','OLD_AUTHORITY_RESET','NO_STORAGE_OR_FILE_WRITE','SEPARATE_SESSION_ONLY'];
 if(c.sources.project_json===null)blockers.push('PROJECT_NOT_AVAILABLE');
 if(Object.values(c.editors).some(v=>v!==null)||s.pending_present||s.workflow.pending_calculation===true)blockers.push('UNCOMMITTED_INPUT_REVIEW_REQUIRED');
 if(c.blockers.some(v=>v!=='ACTIVE_ENVELOPE'&&v!=='ACTIVE_FILE_WRITE'))blockers.push('CAPTURE_INPUT_REVIEW_REQUIRED');
 const files=s.pending_control?.files,unread_files=Array.isArray(files)?files.length:0;
 if(s.pending_control?.bad_input===true)blockers.push('BROWSER_NUMBER_REENTRY_REQUIRED');
 if(unread_files)blockers.push('FILE_RESELECTION_REQUIRED');
 if(Object.values(c.activity).some(Boolean)||['project_save_busy','project_resource_busy','settlement_busy','customer_summary_busy','customer_pdf_busy'].some(k=>s.workflow[k]===true)||s.envelope_ui.workbench_busy===true)notices.push('HISTORICAL_ACTIVITY_NOT_RESUMED');
 if(r.customer_reviewed===true)notices.push('CUSTOMER_REVIEW_MUST_BE_REPEATED');
 if(s.envelope_ui.workbench_candidate!==null||s.envelope_ui.workbench_confirmation!==null)notices.push('HISTORICAL_CANDIDATE_NOT_EXECUTABLE');
 if(Object.keys(s.extensions).length)notices.push('UNKNOWN_EXTENSIONS_ARCHIVED_ONLY');
 return freezeRecoveryData({scope:'SEPARATE_COMMITTED_RECOVERY_MANIFEST',version:'0.1',captured_at:a.captured_at,logical_utf8_bytes:a.logical_utf8_bytes,
  sources:Object.entries({...c.sources,envelope_json:c.envelope_json}).map(([name,raw])=>({name,present:raw!==null,utf8_bytes:raw===null?0:new TextEncoder().encode(raw).length})),participants:[...participants],blockers,notices,can_open:blockers.length===0,
  historical_application_present:s.envelope_ui.workbench_application!==null,historical_candidate_present:s.envelope_ui.workbench_candidate!==null,unread_files,
  required_choice:'OPEN_SEPARATE_RECOVERY_SESSION',financial_writes:0,full_live_workbench_reopen:false,production_integrated:false});
}
/** All environments are closed: constructors and installation cannot read/write global storage, emit events or export. */
class ReopenedSession {
 private readonly owner=new WorkbenchStateOwner();
 private readonly effects={storage_reads:0,storage_writes:0,file_writes:0,notifications:0};
 private readonly app;private readonly workflow;private readonly bill;private readonly pair;private readonly tax;private readonly precision;private readonly envelope;
 constructor(readonly archive:FeeRecoveryData,prepared:{project:ReturnType<typeof parseProject>;bill:ReturnType<typeof parseContainerBillDraft>|null;pair:ReturnType<typeof parseContainerCostPair>|null;attachment:Awaited<ReturnType<typeof parseFeeTaxAttachment>>|null;selection:Awaited<ReturnType<typeof parseFeePrecisionSelection>>|null;envelope:Awaited<ReturnType<typeof parseFeeEnvelope>>|null;rows:FxRow[]}){
  const a=archive,c=a.restoration.capture,r=a.restoration.retained_root as Data,s=a.supplement,pf=r.project_file as Data;
  const trade=toTrade(prepared.project),template=toScenario(prepared.project),today=prepared.project.export_date===undefined?{}:{today:prepared.project.export_date};
  const result=analyze({trade,scenario:scenarioWithDerivedInclusions(template,trade),taxProfile:prepared.project.tax_profile,fxBooks:prepared.project.fx_books,...today});
  const comparison=compare({trade,template,scenarios:toScenarios(prepared.project),anchor:prepared.project.anchor,taxProfile:prepared.project.tax_profile,fxBooks:prepared.project.fx_books,...today});
  if(result.warnings.some(w=>w.level==='ERROR'))fail('CALCULATION_UNAVAILABLE');
  this.app={project:prepared.project,fxRows:prepared.rows,result,comparison,error:null,status:'已在独立核对会话载入已提交资料；正式工作台未替换。',statusLevel:'warn',fileEvidence:copy(c.files.project),fileName:pf.name as string|null,savedAt:pf.saved_at as string|null,dirty:pf.dirty as boolean};
  this.workflow={stateInitialized:true,pendingCalculation:false,pairFxLease:c.fx.preserved_row_key===null?null:{row_key:c.fx.preserved_row_key,books:parseFeeEnvelopeJson(c.fx.preserved_books_json!) as ReturnType<typeof parseProject>['fx_books']},
   projectReadEpoch:0,projectReadToken:null,settlementEpoch:0,settlementPlan:copy(r.settlement_plan),sensitivityControls:copy(r.sensitivity),customerFields:copy(r.customer_fields),customerView:r.customer_view as string,customerReviewed:false,
   recoveryStage:null,recoveryReviewBusy:false,projectSaveBusy:false,projectResourceBusy:false,settlementBusy:false,customerSummaryBusy:false,customerPdfBusy:false,recoveryReviewEpoch:0,editedControl:null,customerPreview:null,customerError:null,sensitivityAnalysis:null,sensitivityError:null,inputLocations:[],calculatedAt:'',workspaceNote:'独立恢复核对；旧确认不生效。'};
  this.owner.bind(this.app,'app');this.owner.bind(this.workflow,'workflow');
  const blocked=()=>true,notify=()=>{this.effects.notifications++;fail('UNEXPECTED_NOTIFICATION');},write=async()=>{this.effects.file_writes++;return fail('FILE_WRITE_DISABLED');};
  const storage={getItem:(_key:string):string|null=>{this.effects.storage_reads++;return fail('STORAGE_READ_DISABLED');},setItem:(_key:string,_value:string)=>{this.effects.storage_writes++;fail('STORAGE_WRITE_DISABLED');}};
  this.bill=new ContainerBillController({stateOwner:this.owner,project:()=>this.app.project,blocked,render:notify,write});
  this.pair=new ContainerCostPairController({stateOwner:this.owner,project:()=>this.app.project,bill:()=>this.bill.draft,blocked,render:notify,write,install:notify,afterInstall:notify,cancelOtherReads:notify});
  const pairText=()=>this.pair.pair?serializeContainerCostPair(this.pair.pair):null;
  this.tax=new FeeTaxAttachmentWorkspace({stateOwner:this.owner,storage,currentPairText:pairText,blocked,write,onChange:notify});
  this.precision=new FeePrecisionSelectionWorkspace({stateOwner:this.owner,storage,currentSources:()=>{const pair_json=pairText(),attachment=this.tax.controller.state().attachment;return pair_json&&attachment?{pair_json,attachment_json:JSON.stringify(attachment,null,2)+'\n'}:null;},blocked,write,onChange:notify});
  this.envelope=new FeeEnvelopeWorkspace({stateOwner:this.owner,storage:{getItem:storage.getItem,compareAndSet:async()=>{this.effects.storage_writes++;return fail('STORAGE_WRITE_DISABLED');}},cacheWritable:false,currentSources:()=>null,blocked,write});
  const ui={pending:null,typing:false,reviewKey:'',reviewHtml:''};
  const plan=this.owner.prepareUpdates([
   {target:this.bill,advance:[],values:{draft:prepared.bill,fileEvidence:copy(c.files.bill),loaded:true,epoch:0,readingToken:null,busy:false}},
   {target:this.pair,advance:[],values:{pair:prepared.pair,review:prepared.pair?reviewContainerCostPair(prepared.pair):null,fileEvidence:copy(c.files.pair),loaded:true,epoch:0,readingToken:null,busy:false,reviewPage:s.pair_ui.review_page}},
   {target:this.tax.controller,advance:[],values:{attachment:prepared.attachment,fileEvidence:copy(c.files.attachment),editor:null,preview:null,recovery:null,epoch:0,readToken:0,readingToken:null,mutationBusy:false,writeBusy:false,savedKey:(r.tax as Data).saved_content_sha256??null}},
   {target:this.precision.controller,advance:[],values:{selection:prepared.selection,fileEvidence:copy(c.files.precision),editor:null,preview:null,recovery:null,epoch:0,readToken:0,readingToken:null,mutationBusy:false,writeBusy:false,savedKey:(r.precision as Data).saved_content_sha256??null}},
   {target:this.envelope.controller,advance:[],values:{current:prepared.envelope?{raw:c.envelope_json!,envelope:prepared.envelope}:null,fileEvidence:copy(c.files.envelope),originRaw:(r.envelope as Data).origin_raw??null,previousRaw:(r.envelope as Data).previous_raw??null,incomingRaw:(r.envelope as Data).incoming_raw??null,incomingError:(r.envelope as Data).incoming_error??null,savedRaw:(r.envelope as Data).saved_raw??null,epoch:0,readToken:0,reading:false,preview:null,mutationBusy:false,writeBusy:false,cacheBusy:false}},
   {target:this.tax,advance:[],values:{...ui,exportBusy:false}},
   {target:this.precision,advance:[],values:{...ui,exportBusy:false}},
   {target:this.envelope,advance:[],values:{pending:null,choices:{},choiceToken:-1,reviewKey:'',reviewHtml:'',workbenchResult:null,workbenchCandidate:null,workbenchConfirmation:null,workbenchApplication:null,workbenchBusy:false,busy:false,exporting:false}},
  ]);
  const checkpoint=this.owner.checkpoint();if(!this.owner.commit(checkpoint,plan.updates))fail('INSTALLATION_FAILED');
  const reopened=this.capture();if(canonicalFeeEnvelopeJson(reopened.sources)!==canonicalFeeEnvelopeJson(c.sources)||reopened.envelope_json!==c.envelope_json||canonicalFeeEnvelopeJson(reopened.fx)!==canonicalFeeEnvelopeJson(c.fx)||canonicalFeeEnvelopeJson(reopened.files)!==canonicalFeeEnvelopeJson(c.files))fail('SOURCE_RECONSTRUCTION_MISMATCH');
  if(Object.values(this.effects).some(Boolean)||this.owner.status().participants.length!==10)fail('NOT_QUIET');
 }
 capture(){return captureFeeSemanticBudget(this.owner,{
  project:()=>({project:this.app.project,fxRows:this.app.fxRows,fileEvidence:this.app.fileEvidence,fileName:this.app.fileName,savedAt:this.app.savedAt,dirty:this.app.dirty}),
  workflow:()=>({stateInitialized:this.workflow.stateInitialized,pendingCalculation:this.workflow.pendingCalculation,pairFxLease:this.workflow.pairFxLease,projectReadEpoch:this.workflow.projectReadEpoch,projectReadToken:this.workflow.projectReadToken,settlementEpoch:this.workflow.settlementEpoch,settlementPlan:this.workflow.settlementPlan,sensitivityControls:this.workflow.sensitivityControls,customerFields:this.workflow.customerFields,customerView:this.workflow.customerView,customerReviewed:this.workflow.customerReviewed,recoveryStage:this.workflow.recoveryStage,recoveryReviewBusy:this.workflow.recoveryReviewBusy,projectSaveBusy:this.workflow.projectSaveBusy,projectResourceBusy:this.workflow.projectResourceBusy,settlementBusy:this.workflow.settlementBusy,customerSummaryBusy:this.workflow.customerSummaryBusy,customerPdfBusy:this.workflow.customerPdfBusy}),
  bill:()=>({capture:this.bill.workbenchCapture(),draft:this.bill.draft}),pair:()=>({capture:this.pair.workbenchCapture(),pair:this.pair.pair,editor:this.pair.editor,reviewEditor:this.pair.reviewEditor}),
  attachment:()=>this.tax.controller.workbenchCapture(),precision:()=>this.precision.controller.workbenchCapture(),envelope:()=>this.envelope.controller.workbenchCapture(),attachment_workspace:()=>this.tax.workbenchCapture(),precision_workspace:()=>this.precision.workbenchCapture(),envelope_workspace:()=>this.envelope.workbenchCapture(),pending:()=>({present:false,control:null}),storage:()=>copy((this.archive.restoration.retained_root as Data).storage) as FeeSourceStorage,
 }).capture;}
 diagnostics(){return freezeRecoveryData({scope:'SEPARATE_COMMITTED_RECOVERY_SESSION',owner:this.owner.status(),controller_types:[this.bill.constructor.name,this.pair.constructor.name,this.tax.controller.constructor.name,this.precision.controller.constructor.name,this.envelope.controller.constructor.name],
  seller_profit:this.app.result.seller.margin?.toString()??null,buyer_total:this.app.result.buyer.landed_cost_with_tax.toString(),cost_count:this.app.project.items.length,comparison_count:this.app.comparison.columns.length,
  customer_reviewed:this.workflow.customerReviewed,active_reads:0,pending_patch_replays:0,financial_writes:0,...this.effects,full_live_workbench_reopen:false,production_integrated:false});}
 preview(){return previewRuntimeFeeWorkbench(this.capture(),'separate-recovery-review');}
}
export type FeeReopenedSession=ReopenedSession;
async function prepare(a:FeeRecoveryData,signal:AbortSignal):Promise<ReopenedSession>{
 const c=a.restoration.capture,r=a.restoration.retained_root as Data,s=c.sources,project=parseProject(s.project_json!),rows=parseFeeEnvelopeJson(c.fx.rows_json) as FxRow[];rowsToBooks(rows);
 if(serializeProject({...r.project_raw as ReturnType<typeof parseProject>,fx_books:project.fx_books})!==s.project_json)fail('PROJECT_ROOT_MISMATCH');
 if((c.fx.preserved_row_key===null)!==(c.fx.preserved_books_json===null)||c.fx.preserved_row_key!==null&&c.fx.preserved_row_key!==c.fx.rows_json)fail('FX_LEASE_MISMATCH');
 if(c.fx.preserved_books_json!==null){const books=parseFeeEnvelopeJson(c.fx.preserved_books_json) as ReturnType<typeof parseProject>['fx_books'];if(JSON.stringify(booksToRows(books))!==c.fx.rows_json||canonicalFeeEnvelopeJson(books)!==canonicalFeeEnvelopeJson(project.fx_books))fail('FX_LEASE_MISMATCH');}
 const bill=s.bill_json===null?null:parseContainerBillDraft(s.bill_json),pair=s.pair_json===null?null:parseContainerCostPair(s.pair_json);
 const [attachment,selection,envelope]=await Promise.all([s.attachment_json===null?null:parseFeeTaxAttachment(s.attachment_json),s.precision_json===null?null:parseFeePrecisionSelection(s.precision_json),c.envelope_json===null?null:parseFeeEnvelope(c.envelope_json)]);
 if(signal.aborted)fail('CANCELLED');
 for(const[key,parsed,member]of[['tax',attachment,'attachment'],['precision',selection,'selection']] as const)if(canonicalFeeEnvelopeJson((r[key] as Data)[member])!==canonicalFeeEnvelopeJson(parsed))fail('RETAINED_SOURCE_MISMATCH');
 if(((r.envelope as Data).current as Data|null)?.raw_json!==c.envelope_json&&!(c.envelope_json===null&&(r.envelope as Data).current===null))fail('ENVELOPE_ROOT_MISMATCH');
 return new ReopenedSession(a,{project,bill,pair,attachment,selection,envelope,rows});
}
interface Operation{checkpoint:WorkbenchCheckpoint;abort:AbortController;external?:AbortSignal;interrupted:Promise<never>;reject:(e:Error)=>void;phase:'READING'|'READY';cleanup:()=>void}
/** Private, one-use explicit choice. A failed/cancelled/stale preparation never replaces the previous session. */
export class FeeRecoveryReopen {
 private readonly owner=new WorkbenchStateOwner();private readonly slot={session:null as ReopenedSession|null};private readonly issued=new WeakMap<object,{op:Operation;session:ReopenedSession|null}>();
 private operation:Operation|null=null;private closed=false;
 constructor(private readonly format:Pick<FeeRecoveryFormat,'decode'>=new FeeRecoveryFormat()){this.owner.bind(this.slot,'separate-recovery');}
 current(){return this.slot.session;}
 status(){return this.closed?'CLOSED':this.operation?this.owner.isCurrent(this.operation.checkpoint)?this.operation.phase:'STALE':this.current()?'OPEN':'EMPTY';}
 invalidate(){this.owner.touch();}
 private check(op:Operation){if(this.closed)fail('CLOSED');if(op.abort.signal.aborted||op.external?.aborted)fail('CANCELLED');if(this.operation!==op||!this.owner.isCurrent(op.checkpoint))fail('STALE');}
 private stop(op:Operation){op.cleanup();op.reject(Error('FEE_RECOVERY_REOPEN_CANCELLED'));op.abort.abort();}
 cancel(){const old=this.operation;this.operation=null;if(old)this.stop(old);}
 dispose(){this.closed=true;this.cancel();}
 async stage(raw:unknown,external?:AbortSignal):Promise<FeeRecoveryManifest>{
  if(this.closed)fail('CLOSED');let reject!:(e:Error)=>void;const interrupted=new Promise<never>((_,no)=>{reject=no;});void interrupted.catch(()=>{});
  const op:Operation={checkpoint:this.owner.checkpoint(),abort:new AbortController(),external,interrupted,reject,phase:'READING',cleanup:()=>{}};
  const previous=this.operation;this.operation=op;if(previous)this.stop(previous);
  const cancel=()=>{if(this.operation===op)this.operation=null;this.stop(op);};external?.addEventListener('abort',cancel,{once:true});op.cleanup=()=>external?.removeEventListener('abort',cancel);
  try{
   this.check(op);const a=await Promise.race([this.format.decode(raw,op.abort.signal),interrupted]);this.check(op);if(!verified(a))fail('UNVERIFIED_DATA');this.check(op);
   const summary=manifest(a);this.check(op);const session=summary.can_open?await Promise.race([prepare(a,op.abort.signal),interrupted]):null;this.check(op);
   op.phase='READY';this.issued.set(summary,{op,session});return summary;
  }catch{this.check(op);throw Error('FEE_RECOVERY_REOPEN_PREPARATION_FAILED');}
  finally{if(op.phase!=='READY'){op.cleanup();if(this.operation===op)this.operation=null;}}
 }
 confirm(summary:FeeRecoveryManifest,choice:'OPEN_SEPARATE_RECOVERY_SESSION'):ReopenedSession{
  const candidate=this.issued.get(summary);if(!candidate)fail('FOREIGN_OR_CONSUMED');this.check(candidate.op);if(choice!=='OPEN_SEPARATE_RECOVERY_SESSION')fail('CHOICE_REQUIRED');if(!candidate.session||!summary.can_open)fail('INPUT_REVIEW_REQUIRED');
  if(!this.owner.commit(candidate.op.checkpoint,[{target:this.slot,values:{session:candidate.session}}]))fail('STALE');this.issued.delete(summary);candidate.op.cleanup();this.operation=null;return candidate.session;
 }
}
