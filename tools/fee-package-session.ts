/** Local minimum committed-source session from package0.1. No editable business, fee or customer authority. */
import {parseRecoveredPackage,type RecoveredPackageReview,RECOVERED_PACKAGE_LIMITS} from './fee-recovery-package';
import {FeeRecoveryFormat,type FeeRecoveryData} from './fee-recovery-format';
import {FeeRecoveryReopen,type FeeReopenedSession,type FeeRecoveryManifest} from './fee-recovery-reopen';
import {freezeRecoveryData,type FeeRecoverySupplement} from './fee-recovery-supplement';
import {recoveredHandoffFile,type RecoveredHandoffFile} from './fee-recovery-business-files';
import {WorkbenchStateOwner,type WorkbenchCheckpoint} from '../src/ui/workbench-state';
import {parseProject} from '../src/data/project-file';
import {parseFeeEnvelope} from '../src/data/fee-envelope';
import {parseFeeTaxAttachment} from '../src/data/fee-tax-attachment';
import {parseFeePrecisionSelection} from '../src/data/fee-precision-selection';
import {parseFeeEnvelopeJson,canonicalFeeEnvelopeJson} from '../src/data/fee-envelope-json';
import {booksToRows} from '../src/ui/fx-rows';
import {unknownFileEvidence} from '../src/ui/file-evidence';
import {FEE_SOURCE_STORAGE_KEYS} from '../src/ui/fee-workbench-source-adapter';
import {emptyCustomerQuoteFields} from '../src/domain/customer-quote';
import type {FeeLayeredCaptureParts} from './fee-browser-native-codec';
import {feeBrowserNativeUtf8Bytes} from './fee-browser-native-codec';
import type {RecoveredPackageFileSource} from './fee-recovery-package-transfer';
import type {FeeRecoveredBusinessSession} from './fee-recovery-business';

export class PackageSessionError extends Error{constructor(readonly code:string){super('FEE_PACKAGE_SESSION_'+code);this.name='PackageSessionError';}}
function fail(code:string):never{throw new PackageSessionError(code);}
const bytes=feeBrowserNativeUtf8Bytes;
const same=(a:unknown,b:unknown)=>canonicalFeeEnvelopeJson(a)===canonicalFeeEnvelopeJson(b);
const continuationOwners=new WeakMap<object,(signal:AbortSignal)=>Promise<FeeRecoveredBusinessSession>>();
/** Internal continuation bridge; JSON/copies never qualify, and a new explicit editing choice is required. */
export async function preparePackageContinuationOwner(session:PackageCommittedSession,choice:'PREPARE_NEW_EDITING_OWNER',signal:AbortSignal=new AbortController().signal){const create=continuationOwners.get(session);if(!create||session.isClosed())fail('FOREIGN_OR_CLOSED_SESSION');if(choice!=='PREPARE_NEW_EDITING_OWNER')fail('EXPLICIT_EDITING_CHOICE_REQUIRED');return create(signal);}
type Parsed=Awaited<ReturnType<typeof parseRecoveredPackage>>;
const get=(p:Parsed,name:string)=>{const f=p.files.find(v=>v.name===name);if(!f)fail('FILE_SET');return f;};

/** Explicit neutral UI projection; no test fixtures or archived form values are installed. */
function neutralSupplement():FeeRecoverySupplement{
 const review=()=>({export_message:'',review_key:'',review_generation:0,review_html:''});
 return{scope:'FEE_WORKBENCH_RECOVERY_SUPPLEMENT',version:'0.1',workflow:{state_initialized:true,pending_calculation:false,restored_from_draft:false,draft_failure:null,draft_storage_unavailable:false,workspace_mode:'beginner',workspace_note:'仅从完整包重建已提交来源，原表单仍存档。',calculated_at:'',recovery_stage:null,recovery_review:null,recovery_review_error:null,recovery_review_epoch:0,recovery_review_busy:false,input_locations:[],sensitivity_error:null,customer_error:null,project_save_busy:false,project_resource_busy:false,settlement_busy:false,customer_summary_busy:false,customer_pdf_busy:false},
 app:{error:null,status:'独立已提交来源核对；不能继续编辑或应用费用。',status_level:'warn'},pair_ui:{review_page:0},tax_ui:review(),precision_ui:review(),envelope_ui:{message:'',business_name:'',choices:{},choice_token:-1,review_key:'',review_generation:0,review_html:'',workbench_result:null,workbench_candidate:null,workbench_confirmation:null,workbench_application:null,workbench_generation:0,workbench_busy:false,workbench_message:'',workbench_save_notice:null},view:{collapsed_sections:[],expanded_evidence_sections:[]},pending_present:false,pending_control:null,pending_other:null,extensions:{package_projection:'CURRENT_COMMITTED_SOURCES_ONLY'}};
}
async function currentParts(p:Parsed):Promise<FeeLayeredCaptureParts>{
 const raw=get(p,'recovered-envelope.json').text,envelope=await parseFeeEnvelope(raw),sources=envelope.current_sources,project=parseProject(sources.project_json),rows=JSON.stringify(booksToRows(project.fx_books));
 const [attachment,selection]=await Promise.all([sources.attachment_json===null?null:parseFeeTaxAttachment(sources.attachment_json),sources.precision_json===null?null:parseFeePrecisionSelection(sources.precision_json)]);
 const holder=()=>({file_evidence:unknownFileEvidence(),epoch:0,reading:false,write_busy:false});
 const root={project_raw:project,project_file:{name:null,saved_at:null,dirty:true,saved_raw_known:false},bill:holder(),pair:holder(),tax:{...holder(),attachment,editor:null,preview:null,recovery:null,read_token:0,mutation_busy:false,saved_content_sha256:null},precision:{...holder(),selection,editor:null,preview:null,recovery:null,read_token:0,mutation_busy:false,saved_content_sha256:null},
 envelope:{...holder(),current:{raw_json:raw,lease:{envelope_id:envelope.envelope_id,business_id:envelope.business_id,revision:envelope.revision,content_sha256:envelope.content_sha256},history_origin:envelope.history_origin},origin_raw:null,previous_raw:null,incoming_raw:null,incoming_error:null,saved_raw:null,preview:null,read_token:0,mutation_busy:false,cache_busy:false},tax_workspace:{pending:null,export_busy:false},precision_workspace:{pending:null,export_busy:false},envelope_workspace:{pending:null,choices:{},generation:0,busy:false,exporting:false},project_read_epoch:0,project_read_token:null,settlement_epoch:0,settlement_plan:null,sensitivity:{},customer_fields:emptyCustomerQuoteFields(),customer_view:'full',customer_reviewed:false,pending_control:null,
 storage:Object.fromEntries(FEE_SOURCE_STORAGE_KEYS.map(k=>[k,{raw:null,available:false}]))};
 return{retained_root:root,retained_format:'PRETTY_LF',capture_shell:{scope:'RUNTIME_FEE_WORKBENCH_CAPTURE',envelope_json:raw,sources:{...sources},fx:{rows_json:rows,preserved_row_key:rows,preserved_books_json:JSON.stringify(project.fx_books)},files:{project:unknownFileEvidence(),bill:unknownFileEvidence(),pair:unknownFileEvidence(),attachment:unknownFileEvidence(),precision:unknownFileEvidence(),envelope:unknownFileEvidence()},editors:{cost:null,review:null,attachment:null,precision:null,pending_input:null},activity:{project_read:false,bill_read:false,pair_read:false,attachment_mutation:false,precision_mutation:false,recovery:false},blockers:[]}};
}

export interface PackageCommittedCandidate{readonly scope:'PACKAGE_COMMITTED_SESSION_CANDIDATE';readonly review:RecoveredPackageReview;readonly package_sha256:string;readonly bytes:number;readonly participants:number;readonly notices:readonly string[];readonly required_choice:'OPEN_NEW_COMMITTED_PACKAGE_SESSION';readonly financial_writes:0;readonly editable:false;readonly full_live_workbench_reopen:false}
export interface PackageSessionPreservation{readonly package_file:RecoveredHandoffFile;readonly files:Parsed['files'];readonly original_archive:FeeRecoveryData;readonly source_audit_json:string;readonly application_backup_json:string|null}
export interface PackageCommittedSession{readonly scope:'SEPARATE_PACKAGE_COMMITTED_SESSION';capture():ReturnType<FeeReopenedSession['capture']>;diagnostics():Omit<ReturnType<FeeReopenedSession['diagnostics']>,'scope'>&{readonly scope:'SEPARATE_PACKAGE_COMMITTED_SESSION';readonly package_sha256:string;readonly source_updates:number;readonly archived_new_fee_applications:number;readonly editable:false;readonly archived_forms_installed:false;readonly component_save_confirmed:false;readonly original_drafts_present:boolean};preservation():PackageSessionPreservation;isClosed():boolean}
interface Ready{readonly token:PackageCommittedCandidate;readonly checkpoint:WorkbenchCheckpoint;readonly generation:number;readonly signal?:AbortSignal;readonly cleanup:()=>void;readonly file:RecoveredHandoffFile;readonly parsed:Parsed;readonly original:FeeRecoveryData;readonly store:FeeRecoveryReopen;readonly inner:FeeRecoveryManifest;acknowledged:boolean}
interface Operation{readonly reject:(e:Error)=>void;readonly cleanup:()=>void}

/** One physical slot. Underlying native work is allowed to settle before this instance can be reused. */
export class FeePackageSession{
 private readonly owner=new WorkbenchStateOwner();private readonly slot={session:null as PackageCommittedSession|null};private generation=0;private physical=false;private operation:Operation|null=null;private staged:Ready|null=null;private readonly issued=new WeakMap<object,Ready>();private readonly closers=new WeakMap<object,()=>void>();private closed=false;private idle:Promise<void>=Promise.resolve();
 constructor(private readonly afterPrepare:()=>Promise<void>=async()=>{}){this.owner.bind(this.slot,'package-committed-session-slot');}
 private available(){if(this.closed)fail('CLOSED');}
 private active(g:number,c:WorkbenchCheckpoint,s?:AbortSignal){return!this.closed&&g===this.generation&&!s?.aborted&&this.owner.isCurrent(c);}
 cancel(){this.generation++;const p=this.staged;this.staged=null;if(p){this.issued.delete(p.token);p.cleanup();p.store.dispose();}const op=this.operation;this.operation=null;if(op){op.cleanup();op.reject(new PackageSessionError('CANCELLED'));}}
 invalidate(){this.owner.touch();this.cancel();}
 current(){return this.slot.session;}
 pending(){const p=this.staged;if(p&&!this.active(p.generation,p.checkpoint,p.signal))this.cancel();return this.staged?.token??null;}
 busy(){return this.physical;}
 whenIdle(){return this.idle;}
 state(){const pending=this.pending();return Object.freeze({scope:'LOCAL_PACKAGE_COMMITTED_SESSION_MANAGER',phase:this.closed?'CLOSED':this.physical?this.operation?'PREPARING':'SETTLING':pending?'AWAITING_EXPLICIT_OPEN':this.current()?'OPEN':'EMPTY',pending:pending!==null,acknowledged:this.staged?.acknowledged??false,open:this.current()!==null,financial_writes:0,editable:false,production_integrated:false,full_live_workbench_reopen:false});}
 async stage(raw:string,signal?:AbortSignal){return this.start(async()=>{if(typeof raw!=='string'||raw.length>RECOVERED_PACKAGE_LIMITS.file_bytes||bytes(raw)>RECOVERED_PACKAGE_LIMITS.file_bytes)fail('FILE_SIZE');return recoveredHandoffFile('recovered-business-package.json',raw);},signal);}
 async stageFile(file:RecoveredPackageFileSource,signal?:AbortSignal){this.available();if(this.physical)fail('BUSY');const size=file.size,name=file.name??'recovered-business-package.json';
  return this.start(async()=>{if(!Number.isSafeInteger(size)||size<1||size>RECOVERED_PACKAGE_LIMITS.file_bytes||typeof name!=='string')fail('FILE_SIZE');const b=await file.arrayBuffer();if(!(b instanceof ArrayBuffer)||b.byteLength!==size)fail('FILE_BYTES');let raw:string;try{raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);}catch{return fail('FILE_UTF8');}return recoveredHandoffFile(name.slice(0,200),raw);},signal);}
 private async start(read:()=>Promise<RecoveredHandoffFile>,signal?:AbortSignal):Promise<PackageCommittedCandidate>{
  this.available();if(this.physical)fail('BUSY');if(signal?.aborted)fail('CANCELLED');this.cancel();const generation=this.generation,checkpoint=this.owner.checkpoint();this.physical=true;let reject!:(e:Error)=>void;const interrupted=new Promise<never>((_,no)=>{reject=no;});void interrupted.catch(()=>{});const abort=()=>this.cancel(),cleanup=()=>signal?.removeEventListener('abort',abort);signal?.addEventListener('abort',abort,{once:true});const op:Operation={reject,cleanup};this.operation=op;
  const current=()=>{if(!this.active(generation,checkpoint,signal))fail('CANCELLED_OR_STALE');};
  const work=(async()=>{let store:FeeRecoveryReopen|null=null;try{current();const file=await read();current();const parsed=await parseRecoveredPackage(file.text);current();const nativeSignal=new AbortController().signal,original=await new FeeRecoveryFormat().decode(get(parsed,'original-recovery.json').text,nativeSignal);current();const parts=await currentParts(parsed);current();
   // Native work is NOT interrupted through a racing legacy stage; the outer logical cancellation owns its physical slot.
   const wire=await new FeeRecoveryFormat().encode(parts,neutralSupplement(),nativeSignal,{captured_at:original.captured_at});current();store=new FeeRecoveryReopen();const inner=await store.stage(wire);current();if(!inner.can_open)fail('COMMITTED_INPUT_BLOCKED');await this.afterPrepare();current();
   const token:PackageCommittedCandidate=freezeRecoveryData({scope:'PACKAGE_COMMITTED_SESSION_CANDIDATE',review:parsed.review,package_sha256:file.sha256,bytes:file.bytes,participants:inner.participants.length,notices:['CURRENT_PACKAGE_SOURCES_ONLY','ORIGINAL_ARCHIVE_AND_ALL_HISTORY_PRESERVED','ARCHIVED_FORMS_REQUIRE_REENTRY','OLD_CONFIRMATIONS_NOT_EXECUTABLE','COMPONENT_SAVE_STATUS_UNKNOWN','INTEGRITY_NOT_AUTHENTICITY'],required_choice:'OPEN_NEW_COMMITTED_PACKAGE_SESSION',financial_writes:0,editable:false,full_live_workbench_reopen:false});const p:Ready={token,checkpoint,generation,signal,cleanup,file,parsed,original,store,inner,acknowledged:false};this.staged=p;this.issued.set(token,p);return token;
  }catch(error){store?.dispose();if(!this.active(generation,checkpoint,signal))fail('CANCELLED_OR_STALE');if(error instanceof PackageSessionError)throw error;throw new PackageSessionError('PREPARATION_FAILED');}finally{if(this.staged?.generation!==generation)cleanup();if(this.operation===op)this.operation=null;this.physical=false;}})();void work.catch(()=>{});this.idle=work.then(()=>{},()=>{});return Promise.race([work,interrupted]);
 }
 private ready(token:PackageCommittedCandidate){this.available();if(this.physical)fail('BUSY');const p=this.issued.get(token);if(!p||p!==this.staged||!this.active(p.generation,p.checkpoint,p.signal))fail('FOREIGN_CONSUMED_OR_STALE');return p;}
 acknowledge(token:PackageCommittedCandidate,checked:boolean){const p=this.ready(token);if(typeof checked!=='boolean')fail('ACKNOWLEDGEMENT');p.acknowledged=checked;}
 confirm(token:PackageCommittedCandidate,choice:'OPEN_NEW_COMMITTED_PACKAGE_SESSION'):PackageCommittedSession{
  const p=this.ready(token);if(choice!=='OPEN_NEW_COMMITTED_PACKAGE_SESSION'||!p.acknowledged)fail('EXPLICIT_REVIEW_REQUIRED');this.issued.delete(token);this.staged=null;let next:PackageCommittedSession|null=null;
  try{const inner=p.store.confirm(p.inner,'OPEN_SEPARATE_RECOVERY_SESSION'),capture=inner.capture(),expected=JSON.parse(get(p.parsed,'recovered-envelope.json').text).current_sources;
   if(!same(capture.sources,expected)||capture.envelope_json!==get(p.parsed,'recovered-envelope.json').text||inner.diagnostics().seller_profit!==p.parsed.review.seller_profit||inner.diagnostics().buyer_total!==p.parsed.review.buyer_total)fail('CURRENT_SOURCE_RECONSTRUCTION');
   const retained=parseFeeEnvelopeJson(capture.retained_json) as Record<string,unknown>;if(retained.settlement_plan!==null||!same(retained.sensitivity,{})||!same(retained.customer_fields,emptyCustomerQuoteFields())||retained.customer_reviewed!==false||Object.values(capture.files).some(v=>Object.values(v).some(x=>x!==null)))fail('ARCHIVED_STATE_INSTALLED');
   let closed=false;const preserved:PackageSessionPreservation=freezeRecoveryData({package_file:p.file,files:p.parsed.files,original_archive:p.original,source_audit_json:get(p.parsed,'source-update-audit.json').text,application_backup_json:p.parsed.files.find(f=>f.name==='new-application-backup.json')?.text??null});
   next=Object.freeze({scope:'SEPARATE_PACKAGE_COMMITTED_SESSION' as const,capture:()=>{if(closed)fail('SESSION_CLOSED');return inner.capture();},diagnostics:()=>freezeRecoveryData({...inner.diagnostics(),scope:'SEPARATE_PACKAGE_COMMITTED_SESSION' as const,package_sha256:p.file.sha256,source_updates:p.parsed.review.source_updates,archived_new_fee_applications:p.parsed.review.new_fee_applications,editable:false as const,archived_forms_installed:false as const,component_save_confirmed:false as const,original_drafts_present:p.parsed.review.original_drafts_present}),preservation:()=>preserved,isClosed:()=>closed});this.closers.set(next,()=>{closed=true;p.store.dispose();});
   continuationOwners.set(next,async signal=>{if(closed||signal.aborted)fail('SESSION_CLOSED');const business=await inner.newBusinessSession(signal);if(closed||signal.aborted){business.dispose();fail('SESSION_CLOSED');}return business;});
   const previous=this.current();if(!this.owner.commit(p.checkpoint,[{target:this.slot,values:{session:next}}]))fail('STALE_INSTALLATION');if(previous)this.closers.get(previous)?.();return next;
  }catch(error){if(next)this.closers.get(next)?.();p.store.dispose();if(error instanceof PackageSessionError)throw error;throw new PackageSessionError('INSTALLATION_FAILED');}finally{p.cleanup();}
 }
 dispose(){this.closed=true;this.cancel();const current=this.current();if(current)this.closers.get(current)?.();}
}
