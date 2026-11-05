/** Developer-only continuation of a confirmed recovery, in a SECOND independent set of real holders. */
import {RuntimeFeeWorkbenchCandidatePreparer,type RuntimeFeeCandidateEnvironment,type RuntimeFeeCandidateSummary,type RuntimeFeeApplicationRecord} from '../src/ui/fee-workbench-candidate';
import {previewRuntimeFeeWorkbench,type RuntimeFeeWorkbenchPreview} from '../src/ui/fee-workbench-preview';
import type {WorkbenchCheckpoint} from '../src/ui/workbench-state';
import {parseProject,type ProjectFile} from '../src/data/project-file';
import {parseFeeEnvelope} from '../src/data/fee-envelope';
import {copyFeeEnvelopeJson,feeEnvelopeSha256,canonicalFeeEnvelopeJson} from '../src/data/fee-envelope-json';
import {projectCustomerQuote} from '../src/data/customer-quote';
import type {CustomerQuoteFields,CustomerQuote} from '../src/domain/customer-quote';
import {createCustomerQuoteDocument} from '../src/ui/customer-quote';
import {requireCustomerQuoteView,type CustomerQuoteView} from '../src/data/customer-quote-view';
import type {FeeRecoveryData} from './fee-recovery-format';
import {freezeRecoveryData} from './fee-recovery-supplement';
import {originalFeeRecoveryFile,recoveredHandoffFile,type RecoveredHandoffFile} from './fee-recovery-business-files';
import type {FeeReopenedSession} from './fee-recovery-reopen';
import {FeeRecoveryTrade,type RecoveredTradeCalculation} from './fee-recovery-trade';
import {FeeRecoveryReconcile,type ReconcilePrepared,type ReconcileRecord} from './fee-recovery-reconcile';
import {createRecoveredPackage} from './fee-recovery-package';
import {FeeRecoveryContract} from './fee-recovery-contract';

export interface RecoveredBusinessEnvironment {readonly archive:FeeRecoveryData;readonly runtime:RuntimeFeeCandidateEnvironment;diagnostics():ReturnType<FeeReopenedSession['diagnostics']>;project():ProjectFile}
export interface RecoveredBusinessCandidate {readonly scope:'RECOVERED_BUSINESS_NEW_CANDIDATE';readonly summary:RuntimeFeeCandidateSummary;readonly rows:RuntimeFeeWorkbenchPreview['rows'];readonly financial_writes:0}
export interface RecoveredBusinessConfirmation {readonly scope:'RECOVERED_BUSINESS_NEW_CONFIRMATION';readonly transaction_id:string;readonly explicit_choice:'APPLY_NEW_RECOVERED_BATCH'}
export interface RecoveredCustomerPreview {readonly scope:'RECOVERED_BUSINESS_CUSTOMER_PREVIEW';readonly quote:CustomerQuote;readonly html:string;readonly view:CustomerQuoteView;readonly required_choice:'CONFIRM_PUBLIC_CONTENT'}
interface Prepared {readonly token:RecoveredBusinessCandidate;readonly runtime:RuntimeFeeCandidateSummary;readonly checkpoint:WorkbenchCheckpoint;readonly generation:number;readonly external?:AbortSignal;readonly cleanup:()=>void}
interface Armed {readonly token:RecoveredBusinessConfirmation;readonly prepared:Prepared;acknowledged:boolean}
interface Operation {generation:number;reject:(e:Error)=>void;cleanup:()=>void}
function fail(code:string):never{throw Error('RECOVERED_BUSINESS_'+code);}
/** No global storage, renderer, file picker or implicit reuse of an archived candidate/customer confirmation. */
export class FeeRecoveredBusinessSession {
 private readonly preparer;private generation=0;private inFlight=false;private applying=false;private exporting=false;private closed=false;private operation:Operation|null=null;
 private prepared:Prepared|null=null;private armed:Armed|null=null;private readonly issued=new WeakMap<object,Prepared>();
 private application:RuntimeFeeApplicationRecord|null=null;private writes=0;
 private customer: {token:RecoveredCustomerPreview;basis:string;approved:boolean}|null=null;
 private tradeEditor:FeeRecoveryTrade|null=null;
 private contractEditor:FeeRecoveryContract|null=null;
 private reconciliation:FeeRecoveryReconcile|null=null;
 private sourceHistoryGuard:((record:ReconcileRecord,previous:readonly ReconcileRecord[])=>void)|null=null;
 private packaging=false;private readonly handoffLeases=new WeakMap<object,{checkpoint:WorkbenchCheckpoint;generation:number}>();
 constructor(private readonly env:RecoveredBusinessEnvironment){this.preparer=new RuntimeFeeWorkbenchCandidatePreparer(env.runtime);}
 private available(){if(this.closed)fail('CLOSED');}
 private active(generation:number){return!this.closed&&generation===this.generation;}
 private current(p:Prepared){return this.active(p.generation)&&!p.external?.aborted&&this.prepared===p&&this.env.runtime.owner.isCurrent(p.checkpoint);}
 private revoke(){if(this.prepared){this.prepared.cleanup();this.preparer.discard(this.prepared.runtime);}this.prepared=null;this.armed=null;this.generation++;}
 cancel(){this.reconciliation?.cancel();this.revoke();const op=this.operation;this.operation=null;if(op){op.cleanup();op.reject(Error('RECOVERED_BUSINESS_CANCELLED'));}}
 invalidate(){this.cancel();this.customer=null;this.env.runtime.owner.touch();}
 dispose(){this.closed=true;this.cancel();this.tradeEditor?.dispose();this.contractEditor?.dispose();this.reconciliation?.dispose();}
 /** Trusted synchronous retention check, registered once before source review. Does not grant fee authority. */
 configureSourceHistoryGuard(guard:(record:ReconcileRecord,previous:readonly ReconcileRecord[])=>void){this.available();if(typeof guard!=='function'||this.sourceHistoryGuard||this.reconciliation||this.inFlight||this.applying||this.exporting||this.packaging)fail('HISTORY_GUARD_CONFIGURATION');this.sourceHistoryGuard=guard;}
 /** Source review uses only current holders; explicit confirmation changes the envelope, never the project or ledger. */
 reconcile(afterPrepare?:()=>Promise<void>){this.available();return this.reconciliation??=new FeeRecoveryReconcile({read:()=>{
  this.available();this.packageIdle();this.committedTradeRequired();if(this.inFlight||this.applying||this.exporting)fail('BUSY');const checkpoint=this.env.runtime.owner.checkpoint(),capture=this.capture();if(!this.env.runtime.owner.isCurrent(checkpoint))fail('STALE_SOURCE_REVIEW');return{checkpoint,capture};
 },current:checkpoint=>!this.closed&&!this.tradeEditor?.hasPending()&&!this.inFlight&&!this.applying&&!this.exporting&&!this.packaging&&this.env.runtime.owner.isCurrent(checkpoint),beforeInstall:(record,previous)=>this.sourceHistoryGuard?.(record,previous),install:(checkpoint,prepared)=>this.installSources(checkpoint,prepared)},afterPrepare);}
 private installSources(checkpoint:WorkbenchCheckpoint,prepared:ReconcilePrepared){
  this.available();this.packageIdle();this.committedTradeRequired();if(this.inFlight||this.applying||this.exporting||!this.env.runtime.owner.isCurrent(checkpoint))fail('STALE_SOURCE_REVIEW');
  const t=this.env.runtime.targets,previous=this.capture().envelope_json,plan=this.env.runtime.owner.prepareUpdates([
   {target:t.envelope,advance:['epoch','readToken'],values:{current:{raw:prepared.raw,envelope:prepared.envelope},previousRaw:previous,preview:null,reading:false}},
   {target:t.envelopeUi,advance:['generation','reviewGeneration','workbenchGeneration'],values:{pending:null,choices:{},choiceToken:-1,reviewKey:'',reviewHtml:'',workbenchResult:null,workbenchCandidate:null,workbenchConfirmation:null,workbenchBusy:false}},
   {target:t.workflow,advance:[],values:{customerReviewed:false,customerPreview:null,customerError:null}},
  ]);
  if(!this.env.runtime.owner.commit(checkpoint,plan.updates))fail('STALE_SOURCE_REVIEW');this.customer=null;this.revoke();
 }
 private sourceWorkIdle(){if(this.reconciliation?.busy())fail('BUSY');}
 /** Minimal real business form, scoped to this second owner. No archived input is copied into its buffer. */
 trade(){this.available();return this.tradeEditor??=new FeeRecoveryTrade({project:()=>this.env.project(),isCurrent:c=>this.env.runtime.owner.isCurrent(c),begin:()=>{
  this.available();if(this.contractEditor?.hasPending())fail('UNCOMMITTED_CONTRACT_INPUT');if(this.applying||this.exporting)fail('BUSY');this.cancel();this.customer=null;this.env.runtime.owner.touch();return this.env.runtime.owner.checkpoint();
 },install:(checkpoint,prepared)=>this.installTrade(checkpoint,prepared)});}
 /** The actual-quote editor shares original calculation and root installation, never the simulated quote field. */
 contract(){this.available();return this.contractEditor??=new FeeRecoveryContract({project:()=>this.env.project(),isCurrent:c=>this.env.runtime.owner.isCurrent(c),begin:()=>{this.available();this.packageIdle();this.sourceWorkIdle();if(this.tradeEditor?.hasPending())fail('UNCOMMITTED_TRADE_INPUT');if(this.inFlight||this.applying||this.exporting)fail('BUSY');this.cancel();this.customer=null;this.env.runtime.owner.touch();return this.env.runtime.owner.checkpoint();},install:(checkpoint,prepared)=>this.installTrade(checkpoint,prepared)});}
 hasUncommittedTrade(){return!!this.tradeEditor?.hasPending()||!!this.contractEditor?.hasPending();}
 private installTrade(checkpoint:WorkbenchCheckpoint,prepared:RecoveredTradeCalculation){
  this.available();this.packageIdle();this.sourceWorkIdle();if(this.inFlight||this.applying||this.exporting)fail('BUSY');if(!this.env.runtime.owner.isCurrent(checkpoint))fail('STALE_TRADE_INPUT');
  const t=this.env.runtime.targets,plan=this.env.runtime.owner.prepareUpdates([
   {target:t.app,advance:[],values:{project:prepared.project,result:prepared.result,comparison:prepared.comparison,error:null,dirty:true,status:'独立交易输入已通过原校验，请核对结果并另存。',statusLevel:'warn'}},
   {target:t.workflow,advance:['projectReadEpoch','settlementEpoch','recoveryReviewEpoch'],values:{projectReadToken:null,pendingCalculation:false,editedControl:null,customerReviewed:false,customerPreview:null,customerError:null,sensitivityAnalysis:null,sensitivityError:null,inputLocations:[],calculatedAt:'',workspaceNote:'独立交易已重新录入；客户报价仍须重新核对。'}},
  ]);
  if(!this.env.runtime.owner.commit(checkpoint,plan.updates))fail('STALE_TRADE_INPUT');this.customer=null;
 }
 private committedTradeRequired(){if(this.hasUncommittedTrade())fail('UNCOMMITTED_TRADE_INPUT');}
 state(){const d=this.env.diagnostics();return freezeRecoveryData({...d,scope:'SEPARATE_RECOVERED_BUSINESS_SESSION',phase:this.closed?'CLOSED':this.packaging?'PREPARING_PACKAGE':this.exporting?'PREPARING_HANDOFF':this.applying?'APPLYING':this.inFlight?this.operation?'PREPARING':'SETTLING':this.armed?'AWAITING_EXPLICIT_CHOICE':this.prepared?'CANDIDATE_READY':this.application?'APPLIED':'OPEN',
  base_currency:this.env.project().base_currency,financial_writes:this.writes,customer_reviewed:this.customer?.approved===true,new_application_present:this.application!==null,original_archive_preserved:true,pending_patch_replays:0,production_integrated:false,full_live_workbench_reopen:false});}
 capture(){return this.env.runtime.capture();}
 lastApplication(){return this.application;}
 /** Readonly freshness token; copied metadata does not restore it or grant financial authority. */
 handoffLease(){this.available();const token=Object.freeze({scope:'RECOVERED_HANDOFF_LEASE' as const});this.handoffLeases.set(token,{checkpoint:this.env.runtime.owner.checkpoint(),generation:this.generation});return token;}
 isHandoffLeaseCurrent(token:object){const p=this.handoffLeases.get(token);return!!p&&this.active(p.generation)&&this.env.runtime.owner.isCurrent(p.checkpoint);}
 private packageIdle(){if(this.packaging)fail('BUSY');}
 async handoffPackage():Promise<RecoveredHandoffFile>{
  this.available();this.packageIdle();this.committedTradeRequired();this.sourceWorkIdle();if(this.inFlight||this.applying||this.exporting)fail('BUSY');this.packaging=true;const checkpoint=this.env.runtime.owner.checkpoint(),generation=this.generation,records=this.reconciliation?.history()??[];
  try{const files=await this.collectHandoff(),file=await createRecoveredPackage(files,records);if(!this.active(generation)||!this.env.runtime.owner.isCurrent(checkpoint)||this.hasUncommittedTrade())fail('CANCELLED');return file;}finally{this.packaging=false;}
 }
 /** Logical cancellation is immediate; the physical preparation slot remains occupied until it settles. */
 async prepare(signal?:AbortSignal):Promise<RecoveredBusinessCandidate>{
  this.available();this.packageIdle();this.committedTradeRequired();this.sourceWorkIdle();if(this.inFlight||this.applying||this.exporting)fail('BUSY');if(signal?.aborted)fail('CANCELLED');this.cancel();const generation=this.generation;this.inFlight=true;
  let reject!:(e:Error)=>void;const interrupted=new Promise<never>((_,no)=>{reject=no;});void interrupted.catch(()=>{});
  const op:Operation={generation,reject,cleanup:()=>{}};this.operation=op;const abort=()=>{if(this.operation===op||this.prepared?.generation===generation)this.cancel();};signal?.addEventListener('abort',abort,{once:true});op.cleanup=()=>signal?.removeEventListener('abort',abort);
  const task=(async()=>{
   let runtime:RuntimeFeeCandidateSummary|null=null;
   try{const capture=this.env.runtime.capture(),preview=await previewRuntimeFeeWorkbench(capture,'recovered-'+crypto.randomUUID());if(!this.active(generation))fail('CANCELLED');if(preview.status!=='STAGED')fail('INPUT_OR_CONSUMPTION_REVIEW_REQUIRED');
    runtime=await this.preparer.prepare(preview);if(!this.active(generation))fail('CANCELLED');
    const token:RecoveredBusinessCandidate=freezeRecoveryData({scope:'RECOVERED_BUSINESS_NEW_CANDIDATE',summary:runtime,rows:preview.rows,financial_writes:0}),p:Prepared={token,runtime,checkpoint:this.env.runtime.owner.checkpoint(),generation,external:signal,cleanup:op.cleanup};this.prepared=p;this.issued.set(token,p);return token;
   }catch{if(runtime)this.preparer.discard(runtime);if(!this.active(generation))fail('CANCELLED');throw Error('RECOVERED_BUSINESS_PREPARATION_FAILED');}
   finally{if(this.prepared?.generation!==generation)op.cleanup();if(this.operation===op)this.operation=null;this.inFlight=false;}
  })();void task.catch(()=>{});return Promise.race([task,interrupted]);
 }
 arm(token:RecoveredBusinessCandidate):RecoveredBusinessConfirmation{
  this.available();this.packageIdle();const p=this.issued.get(token);if(!p||!this.current(p))fail('FOREIGN_OR_STALE_CANDIDATE');if(this.inFlight||this.applying||this.exporting)fail('BUSY');
  const confirmation:RecoveredBusinessConfirmation=Object.freeze({scope:'RECOVERED_BUSINESS_NEW_CONFIRMATION',transaction_id:p.runtime.transaction_id,explicit_choice:'APPLY_NEW_RECOVERED_BATCH'});this.armed={token:confirmation,prepared:p,acknowledged:false};return confirmation;
 }
 acknowledge(token:RecoveredBusinessConfirmation,checked:boolean){this.available();if(!this.armed||this.armed.token!==token||!this.current(this.armed.prepared))fail('FOREIGN_OR_STALE_CONFIRMATION');if(typeof checked!=='boolean')fail('ACKNOWLEDGEMENT');this.armed.acknowledged=checked;}
 async apply(token:RecoveredBusinessConfirmation,choice:'APPLY_NEW_RECOVERED_BATCH'):Promise<RuntimeFeeApplicationRecord>{
  this.available();this.packageIdle();this.sourceWorkIdle();const a=this.armed;if(!a||a.token!==token||!this.current(a.prepared))fail('FOREIGN_OR_STALE_CONFIRMATION');if(choice!=='APPLY_NEW_RECOVERED_BATCH'||!a.acknowledged)fail('EXPLICIT_CHOICE_REQUIRED');if(this.inFlight||this.applying||this.exporting)fail('BUSY');
  this.applying=true;this.issued.delete(a.prepared.token);const active=()=>this.armed===a&&this.current(a.prepared)&&a.acknowledged;
  try{const record=await this.preparer.apply(a.prepared.runtime,active);
   // The original preparer already committed the single root. Cancellation/display/export after this point is not a rollback.
   this.application=record;this.writes++;this.customer=null;this.revoke();return record;
  }catch{this.revoke();throw Error('RECOVERED_BUSINESS_APPLICATION_NOT_COMPLETED');}finally{this.applying=false;}
 }
 async handoff():Promise<readonly RecoveredHandoffFile[]>{
  this.available();this.packageIdle();return this.collectHandoff();
 }
 private async collectHandoff():Promise<readonly RecoveredHandoffFile[]>{
  this.available();this.committedTradeRequired();this.sourceWorkIdle();if(this.inFlight||this.applying||this.exporting)fail('BUSY');this.exporting=true;const generation=this.generation,application=this.application,writes=this.writes;
  try{const c=this.capture(),project=c.sources.project_json,envelope=c.envelope_json;if(project===null||envelope===null)fail('HANDOFF_INCOMPLETE');
  parseProject(project);const e=await parseFeeEnvelope(envelope);if(canonicalFeeEnvelopeJson(e.current_sources)!==canonicalFeeEnvelopeJson(c.sources))fail('HANDOFF_SOURCE_MISMATCH');
  const original=await originalFeeRecoveryFile(this.env.archive),files=[await recoveredHandoffFile('recovered-project.json',project),await recoveredHandoffFile('recovered-envelope.json',envelope),await recoveredHandoffFile('original-recovery.json',original)];
  if(application)files.push(await recoveredHandoffFile('new-application-backup.json',application.backup_json));
  const manifest=JSON.stringify({kind:'INTERNAL_RECOVERED_BUSINESS_HANDOFF',version:'0.1',original_captured_at:this.env.archive.captured_at,files:files.map(({name,bytes,sha256})=>({name,bytes,sha256})),new_financial_writes:writes,pending_patch_replays:0,import_authority:false,customer_document:false},null,2)+'\n';
  files.push(await recoveredHandoffFile('internal-handoff-manifest.json',manifest));if(!this.active(generation))fail('CANCELLED');return freezeRecoveryData(files);
  }finally{this.exporting=false;}
 }
 stageCustomer(fields:CustomerQuoteFields,view:CustomerQuoteView='full'):RecoveredCustomerPreview{
  this.available();this.packageIdle();this.committedTradeRequired();this.sourceWorkIdle();if(this.inFlight||this.applying||this.exporting)fail('BUSY');this.customer=null;const safe=copyFeeEnvelopeJson(fields) as CustomerQuoteFields,layout=requireCustomerQuoteView(view),quote=projectCustomerQuote(this.env.project(),safe),html=createCustomerQuoteDocument(quote,undefined,layout);
  const token:RecoveredCustomerPreview=freezeRecoveryData({scope:'RECOVERED_BUSINESS_CUSTOMER_PREVIEW',quote,html,view:layout,required_choice:'CONFIRM_PUBLIC_CONTENT'});this.customer={token,basis:JSON.stringify(this.capture()),approved:false};return token;
 }
 confirmCustomer(token:RecoveredCustomerPreview,choice:'CONFIRM_PUBLIC_CONTENT'){
  this.available();const c=this.customer;if(!c||c.token!==token||c.basis!==JSON.stringify(this.capture()))fail('FOREIGN_OR_STALE_CUSTOMER');if(choice!=='CONFIRM_PUBLIC_CONTENT')fail('PUBLIC_REVIEW_REQUIRED');c.approved=true;
 }
 clearCustomerReview(){this.customer=null;}
 exportCustomer(token:RecoveredCustomerPreview):string{
  this.available();const c=this.customer;if(!c||c.token!==token||!c.approved||c.basis!==JSON.stringify(this.capture()))fail('PUBLIC_REVIEW_REQUIRED');return c.token.html;
 }
 async originalArchiveDigests(){return Object.freeze({source_sha256:await feeEnvelopeSha256(this.env.archive.source_wire),supplement_sha256:await feeEnvelopeSha256(this.env.archive.supplement_json)});}
}
