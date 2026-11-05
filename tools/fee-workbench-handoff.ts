/** Selected committed-text copies. This owner never installs, closes or certifies a workbench. */
import {FEE_WORKBENCH_FILES,type FeeWorkbenchFile} from '../src/domain/fee-workbench';
import type {RuntimeFeeWorkbenchCapture} from '../src/ui/fee-workbench-preview';
import type {FeeWorkbenchBoundaryCheck} from './fee-workbench-boundaries';
import {feeBrowserNativeUtf8Bytes} from './fee-browser-native-codec';
import {feeEnvelopeSha256} from '../src/data/fee-envelope-json';
import {startLifecycleDownload} from './fee-session-lifecycle-dom';

export const HANDOFF_COPY_MAX_BYTES=64*1024*1024;
export const HANDOFF_INSTALLATION_GAPS=Object.freeze(['INITIAL_SAVE_EVIDENCE','DETACHED_AND_REJECTED_INPUTS','ARBITRARY_NESTED_REFLECTIVE_AND_SCRIPT_ABA','ALL_DOM_AND_SELECTED_FILES','EXTERNAL_AND_AUTOMATIC_RESOURCE_LIFETIMES','DIAGNOSTIC_RETENTION_BOUND','APPLICATION_CLEANUP_AND_NEW_ROOT_BINDING','SINGLE_ROOT_INSTALL_AND_FAILURE_RETENTION']as const);
type BoundaryReview=ReturnType<FeeWorkbenchBoundaryCheck['inspect']>;
export interface HandoffCopyFile {readonly name:string;readonly mime:'application/json';readonly text:string}
export async function downloadSelectedCommittedCopy(file:HandoffCopyFile){
  const bytes=feeBrowserNativeUtf8Bytes(file.text);if(bytes>HANDOFF_COPY_MAX_BYTES)fail('COPY_SIZE');
  return startLifecycleDownload({...file,bytes,sha256:await feeEnvelopeSha256(file.text)});
}
export interface HandoffEnvironment {
  readonly boundary:Pick<FeeWorkbenchBoundaryCheck,'inspect'|'matches'>;
  capture():RuntimeFeeWorkbenchCapture;
  write(file:HandoffCopyFile):Promise<'SAVED'|'DOWNLOAD_STARTED'>;
}
export class WorkbenchHandoffError extends Error {constructor(readonly code:string){super('WORKBENCH_HANDOFF_'+code);}}
function fail(code:string):never{throw new WorkbenchHandoffError(code);}
const isRole=(v:unknown):v is FeeWorkbenchFile=>typeof v==='string'&&(FEE_WORKBENCH_FILES as readonly string[]).includes(v);
const rawFor=(c:RuntimeFeeWorkbenchCapture,k:FeeWorkbenchFile)=>k==='envelope'?c.envelope_json:c.sources[(k+'_json')as keyof typeof c.sources];
interface Basis {role:FeeWorkbenchFile;raw:string;recorded:string|null;review:BoundaryReview;generation:number}
export interface HandoffChoice {readonly scope:'SELECTED_COMMITTED_FILE_COPY';readonly role:FeeWorkbenchFile;readonly bytes:number;readonly full_workbench_backup:false;readonly switch_enabled:false}
export interface HandoffReceipt {readonly scope:'SELECTED_COMMITTED_FILE_COPY_RESULT';readonly role:FeeWorkbenchFile;readonly bytes:number;readonly outcome:'SAVED'|'DOWNLOAD_STARTED';readonly context_current:boolean;readonly writer_reported_saved:boolean;readonly full_workbench_backup:false;readonly switch_enabled:false;readonly financial_writes:0}
interface Pending {choice:HandoffChoice;basis:Basis;acknowledged:boolean}
interface Delivered {receipt:HandoffReceipt;basis:Basis;checked:boolean}
export class FeeWorkbenchHandoffContract {
  private closed=false;private busy=false;private generation=0;
  private pending:Pending|null=null;private delivered:Delivered|null=null;
  private lastReceipt:HandoffReceipt|null=null;private lastFailure=false;
  private readonly waiters=new Set<()=>void>();
  constructor(private readonly env:HandoffEnvironment){}
  private open(){if(this.closed)fail('CLOSED');}
  private physical(c:RuntimeFeeWorkbenchCapture,r:BoundaryReview){
    const resources=r.legacy.resources;
    const unsettled=['timers','object_urls'].some(key=>{const d=Object.getOwnPropertyDescriptor(resources,key);return !d||!('value'in d)||!Number.isSafeInteger(d.value)||d.value<0||d.value>0;});
    return unsettled||Object.values(c.activity).some(Boolean)||c.blockers.some(s=>s.startsWith('ACTIVE_'))||r.legacy.legacy.rows.some(row=>row.group==='file_tasks'&&['ACTIVE','UNKNOWN'].includes(row.condition));
  }
  private capture(){const c=this.env.capture();if(c.scope!=='RUNTIME_FEE_WORKBENCH_CAPTURE')fail('CAPTURE');return c;}
  private current(b:Basis){
    if(this.closed||b.generation!==this.generation||!this.env.boundary.matches(b.review))return false;
    try{const c=this.capture();return rawFor(c,b.role)===b.raw&&c.files[b.role].saved_raw===b.recorded&&!this.physical(c,b.review);}catch{return false;}
  }
  inspect(){
    this.open();const review=this.env.boundary.inspect(),c=this.capture();
    if(!this.env.boundary.matches(review))fail('STALE');
    const physical=this.physical(c,review),rows=FEE_WORKBENCH_FILES.map(role=>{
      const raw=rawFor(c,role);if(raw!==null&&typeof raw!=='string')fail('SOURCE');
      const bytes=raw===null?0:feeBrowserNativeUtf8Bytes(raw),recorded=c.files[role].saved_raw;
      return Object.freeze({role,present:raw!==null,bytes,evidence:raw===null?'ABSENT':recorded===raw?'RECORDED_CURRENT_TEXT':recorded===null?'UNKNOWN':'RECORDED_DIFFERENT_TEXT',copy_available:raw!==null&&bytes<=HANDOFF_COPY_MAX_BYTES&&!physical&&!this.busy});
    });
    const blockers:string[]=[...HANDOFF_INSTALLATION_GAPS,...review.blockers];
    if(rows.some(r=>r.present&&r.evidence!=='RECORDED_CURRENT_TEXT'))blockers.push('SAVE_EVIDENCE_UNKNOWN');
    if(physical)blockers.push('APPLICATION_FILE_TASK_ACTIVE');
    if(this.busy)blockers.push('SELECTED_COPY_IN_PROGRESS');
    return Object.freeze({scope:'READ_ONLY_WORKBENCH_HANDOFF_CONTRACT',rows:Object.freeze(rows),installation_blockers:Object.freeze([...new Set(blockers)]),buffers:review.buffers,application_resources:review.legacy.resources,physical,copy_busy:this.busy,pending:this.pending?.choice??null,pending_current:!!this.pending&&this.current(this.pending.basis),receipt:this.lastReceipt,receipt_current:!!this.delivered&&this.current(this.delivered.basis),selected_copy_user_checked:!!this.delivered?.checked&&this.current(this.delivered.basis),last_failure:this.lastFailure,retained_selected_payloads:Number(!!this.pending)+Number(!!this.delivered)+Number(this.busy),selected_copy_limit_bytes:HANDOFF_COPY_MAX_BYTES,full_workbench_backup:false,full_freshness_verified:false,resource_cleanup_authority:false,root_installation_authority:false,import_authority:false,confirmation_authority:false,financial_writes:0,switch_enabled:false,production_integrated:false});
  }
  prepare(role:FeeWorkbenchFile):HandoffChoice {
    this.open();if(this.busy)fail('BUSY');if(!isRole(role))fail('ROLE');
    this.generation++;this.pending=null;this.delivered=null;this.lastReceipt=null;this.lastFailure=false;
    const review=this.env.boundary.inspect(),c=this.capture();if(!this.env.boundary.matches(review))fail('STALE');if(this.physical(c,review))fail('APPLICATION_TASK_ACTIVE');
    const raw=rawFor(c,role);if(raw===null)fail('SOURCE_ABSENT');if(typeof raw!=='string')fail('SOURCE');
    if(raw.length>HANDOFF_COPY_MAX_BYTES)fail('COPY_SIZE');const bytes=feeBrowserNativeUtf8Bytes(raw);if(bytes>HANDOFF_COPY_MAX_BYTES)fail('COPY_SIZE');
    const choice=Object.freeze({scope:'SELECTED_COMMITTED_FILE_COPY' as const,role,bytes,full_workbench_backup:false as const,switch_enabled:false as const});
    this.pending={choice,basis:{role,raw,recorded:c.files[role].saved_raw,review,generation:this.generation},acknowledged:false};return choice;
  }
  private ready(choice:HandoffChoice){this.open();const p=this.pending;if(!p||p.choice!==choice||!this.current(p.basis))fail('FOREIGN_OR_STALE');return p;}
  acknowledge(choice:HandoffChoice,checked:boolean){const p=this.ready(choice);if(typeof checked!=='boolean')fail('ACKNOWLEDGEMENT');p.acknowledged=checked;}
  async copy(choice:HandoffChoice):Promise<HandoffReceipt>{
    if(this.busy)fail('BUSY');const p=this.ready(choice);if(!p.acknowledged)fail('EXPLICIT_SCOPE_REQUIRED');
    this.pending=null;this.delivered=null;this.lastReceipt=null;this.busy=true;
    try{
      const outcome=await this.env.write(Object.freeze({name:'COCUDTT-'+p.basis.role+'-internal-selected.json',mime:'application/json',text:p.basis.raw}));
      if(outcome!=='SAVED'&&outcome!=='DOWNLOAD_STARTED')fail('WRITE_OUTCOME');
      const current=this.current(p.basis),receipt=Object.freeze({scope:'SELECTED_COMMITTED_FILE_COPY_RESULT' as const,role:p.basis.role,bytes:choice.bytes,outcome,context_current:current,writer_reported_saved:outcome==='SAVED',full_workbench_backup:false as const,switch_enabled:false as const,financial_writes:0 as const});
      this.lastReceipt=receipt;if(current)this.delivered={receipt,basis:p.basis,checked:false};return receipt;
    }catch(error){this.lastFailure=true;throw error;}
    finally{this.busy=false;for(const done of this.waiters)done();this.waiters.clear();}
  }
  checkCopy(receipt:HandoffReceipt,checked:boolean){
    this.open();if(typeof checked!=='boolean')fail('ACKNOWLEDGEMENT');const d=this.delivered;
    if(this.busy||!d||d.receipt!==receipt||!this.current(d.basis))fail('FOREIGN_OR_STALE');d.checked=checked;
    return Object.freeze({scope:'USER_CHECKED_SELECTED_COPY',role:receipt.role,checked,full_workbench_backup:false,original_save_state_written:false,root_installation_authority:false,financial_writes:0});
  }
  cancel(){this.open();this.generation++;this.pending=null;this.delivered=null;return Object.freeze({physical_task_continues:this.busy,original_inputs_discarded:false,financial_writes:0});}
  whenIdle(){return this.busy?new Promise<void>(resolve=>this.waiters.add(resolve)):Promise.resolve();}
  dispose(){if(this.closed)return;if(this.busy)fail('BUSY');this.cancel();this.lastReceipt=null;this.closed=true;}
}
