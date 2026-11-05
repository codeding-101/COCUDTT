/** Local developer adapter: explicitly reconcile source snapshots; never replay fees or approve a customer document. */
import {parseFeeEnvelope,serializeFeeEnvelope,updateFeeEnvelopeSources,reviewFeeEnvelope} from '../src/data/fee-envelope';
import {parseFeeEnvelopeJson,feeEnvelopeSha256} from '../src/data/fee-envelope-json';
import type {FeeEnvelope,FeeEnvelopeSources} from '../src/domain/fee-envelope';
import type {WorkbenchCheckpoint} from '../src/ui/workbench-state';
import type {RuntimeFeeWorkbenchCapture} from '../src/ui/fee-workbench-preview';
import {projectFeeSemanticCapture} from '../src/ui/fee-workbench-semantic-capture';
import {freezeRecoveryData} from './fee-recovery-supplement';

export const RECONCILE_SLOTS=Object.freeze(['project_json','bill_json','pair_json','attachment_json','precision_json'] as const);
export const RECONCILE_HISTORY_LIMITS=Object.freeze({records:64,utf8_bytes:64*1024*1024});
export type ReconcileSlot=typeof RECONCILE_SLOTS[number];
export interface ReconcileBasis {readonly checkpoint:WorkbenchCheckpoint;readonly capture:RuntimeFeeWorkbenchCapture}
export interface ReconcileSourceRow {readonly slot:ReconcileSlot;readonly changed:boolean;readonly before_bytes:number;readonly after_bytes:number;readonly before_sha256:string|null;readonly after_sha256:string|null}
export interface ReconcileCandidate {readonly scope:'RECOVERED_SOURCE_RECONCILIATION';readonly rows:readonly ReconcileSourceRow[];readonly selected:readonly ReconcileSlot[];readonly revision_before:number;readonly revision_after:number;readonly receipt_count:number;readonly retired_count:number;readonly history_origin:FeeEnvelope['history_origin'];readonly unresolved_issues:readonly string[];readonly history_bytes_preserved:true;readonly financial_writes:0;readonly customer_approval:false;readonly required_choice:'UPDATE_CURRENT_SOURCES_KEEP_HISTORY'}
export interface ReconcilePrepared {readonly raw:string;readonly envelope:FeeEnvelope;readonly predicted:RuntimeFeeWorkbenchCapture;readonly candidate:ReconcileCandidate}
export interface ReconcileAccess {read():ReconcileBasis;current(checkpoint:WorkbenchCheckpoint):boolean;beforeInstall?(record:ReconcileRecord,previous:readonly ReconcileRecord[]):void;install(checkpoint:WorkbenchCheckpoint,prepared:ReconcilePrepared):void}
export interface ReconcileRecord {readonly scope:'RECOVERED_SOURCE_RECONCILIATION_APPLIED';readonly before_envelope_json:string;readonly after_envelope_json:string;readonly rows:readonly ReconcileSourceRow[];readonly unresolved_issues:readonly string[];readonly source_updates:number;readonly financial_writes:0;readonly customer_approval:false}
export class RecoveryReconcileError extends Error {constructor(readonly code:string){super('RECOVERED_RECONCILE_'+code);this.name='RecoveryReconcileError';}}
function fail(code:string):never{throw new RecoveryReconcileError(code);}
export function assertReconcileHistoryBudget(records:readonly ReconcileRecord[]){if(records.length>RECONCILE_HISTORY_LIMITS.records||new TextEncoder().encode(JSON.stringify(records)).length>RECONCILE_HISTORY_LIMITS.utf8_bytes)fail('SOURCE_HISTORY_LIMIT');}
const lease=(e:FeeEnvelope)=>({envelope_id:e.envelope_id,business_id:e.business_id,revision:e.revision,content_sha256:e.content_sha256});
const bytes=(raw:string|null)=>raw===null?0:new TextEncoder().encode(raw).length;
function selectedSlots(v:readonly ReconcileSlot[]):readonly ReconcileSlot[]{if(!Array.isArray(v)||v.length<1||v.length>5||new Set(v).size!==v.length||v.some(s=>!RECONCILE_SLOTS.includes(s)))fail('EXPLICIT_SOURCE_SELECTION');return Object.freeze([...v]);}
function sourceSet(c:RuntimeFeeWorkbenchCapture):FeeEnvelopeSources{if(c.sources.project_json===null||c.sources.bill_json===null)fail('REQUIRED_SOURCE_MISSING');return{...c.sources,project_json:c.sources.project_json,bill_json:c.sources.bill_json};}
function nextEpoch(value:unknown){if(!Number.isSafeInteger(value)||(value as number)<0||value===Number.MAX_SAFE_INTEGER)fail('CAPTURE_PREFLIGHT');return(value as number)+1;}
/** Exact public capture projection for the three target patches below. Original v0.2 budgets validate it before installation. */
export function predictReconciledCapture(c:RuntimeFeeWorkbenchCapture,raw:string,envelope:FeeEnvelope):RuntimeFeeWorkbenchCapture {
  const retained=parseFeeEnvelopeJson(c.retained_json) as Record<string,unknown>,old=retained.envelope as Record<string,unknown>,ui=retained.envelope_workspace as Record<string,unknown>;
  retained.envelope={...old,current:{raw_json:raw,lease:lease(envelope),history_origin:envelope.history_origin},previous_raw:c.envelope_json,epoch:nextEpoch(old.epoch),read_token:nextEpoch(old.read_token),reading:false,preview:null,dirty:old.saved_raw!==raw};
  retained.envelope_workspace={...ui,pending:null,generation:nextEpoch(ui.generation),choices:{}};retained.customer_reviewed=false;
  return projectFeeSemanticCapture({kind:'INTERNAL_FEE_WORKBENCH_SEMANTIC_CAPTURE',version:'0.2',financial_writes:0,import_authority:false,confirmation_authority:false,capture:{...c,envelope_json:raw,retained_json:JSON.stringify(retained,null,2)+'\n'}});
}
async function prepare(c:RuntimeFeeWorkbenchCapture,selection:readonly ReconcileSlot[]):Promise<ReconcilePrepared>{
  if(c.envelope_json===null)fail('ENVELOPE_MISSING');if(c.blockers.length||Object.values(c.editors).some(v=>v!==null)||Object.values(c.activity).some(Boolean))fail('ACTIVE_OR_UNCOMMITTED_INPUT');
  const before=await parseFeeEnvelope(c.envelope_json),sources=sourceSet(c),changed=RECONCILE_SLOTS.filter(s=>before.current_sources[s]!==sources[s]);
  if(changed.length===0)fail('NO_SOURCE_CHANGE');if(changed.some(s=>!selection.includes(s))||selection.some(s=>!changed.includes(s)))fail('CHANGED_SOURCES_NOT_REVIEWED');
  const next=await updateFeeEnvelopeSources(before,lease(before),sources),raw=await serializeFeeEnvelope(next),review=await reviewFeeEnvelope(next);
  if(next.envelope_id!==before.envelope_id||next.business_id!==before.business_id||next.history_origin!==before.history_origin||next.revision!==before.revision+1||next.ledger_json!==before.ledger_json||JSON.stringify(next.archives)!==JSON.stringify(before.archives))fail('HISTORY_CHANGED');
  const rows:ReconcileSourceRow[]=[];for(const slot of RECONCILE_SLOTS){const a=before.current_sources[slot],b=sources[slot];rows.push({slot,changed:a!==b,before_bytes:bytes(a),after_bytes:bytes(b),before_sha256:a===null?null:await feeEnvelopeSha256(a),after_sha256:b===null?null:await feeEnvelopeSha256(b)});}
  const ledger=JSON.parse(before.ledger_json) as {receipt_refs:string[];retired_cost_ids:string[]};
  const candidate:ReconcileCandidate=freezeRecoveryData({scope:'RECOVERED_SOURCE_RECONCILIATION',rows,selected:[...selection],revision_before:before.revision,revision_after:next.revision,receipt_count:ledger.receipt_refs.length,retired_count:ledger.retired_cost_ids.length,history_origin:before.history_origin,unresolved_issues:[...review.issues],history_bytes_preserved:true,financial_writes:0,customer_approval:false,required_choice:'UPDATE_CURRENT_SOURCES_KEEP_HISTORY'});
  return{raw,envelope:next,predicted:predictReconciledCapture(c,raw,next),candidate};
}
interface Pending {readonly token:ReconcileCandidate;readonly basis:ReconcileBasis;readonly prepared:ReconcilePrepared;readonly generation:number;readonly signal?:AbortSignal;readonly cleanup:()=>void;acknowledged:boolean}
interface Operation {readonly reject:(e:Error)=>void;readonly cleanup:()=>void}
/** One physical slot across prepare and final validation. Logical cancellation cannot stop underlying crypto. */
export class FeeRecoveryReconcile {
  private generation=0;private physical=false;private operation:Operation|null=null;private staged:Pending|null=null;private readonly issued=new WeakMap<object,Pending>();private closed=false;private confirming=false;private updates=0;private applied:ReconcileRecord|null=null;private readonly records:ReconcileRecord[]=[];private idle:Promise<unknown>=Promise.resolve();
  constructor(private readonly access:ReconcileAccess,private readonly afterPrepare:()=>Promise<void>=async()=>{}){}
  private available(){if(this.closed)fail('CLOSED');}
  private active(generation:number,checkpoint:WorkbenchCheckpoint,signal?:AbortSignal){return!this.closed&&this.generation===generation&&!signal?.aborted&&this.access.current(checkpoint);}
  private current(p:Pending){return this.staged===p&&this.active(p.generation,p.basis.checkpoint,p.signal);}
  cancel(){this.generation++;if(this.staged){this.issued.delete(this.staged.token);this.staged.cleanup();}this.staged=null;const op=this.operation;this.operation=null;if(op){op.cleanup();op.reject(new RecoveryReconcileError('CANCELLED'));}}
  lifecycleContext(){const generation=this.generation,updates=this.updates;return()=>!this.closed&&this.generation===generation&&this.updates===updates;}
  busy(){return this.physical;}
  whenIdle(){return this.idle;}
  pending(){if(this.staged&&!this.current(this.staged))this.cancel();return this.staged?.token??null;}
  state(){const p=this.pending();return Object.freeze({scope:'INDEPENDENT_SOURCE_RECONCILIATION' as const,phase:this.closed?'CLOSED':this.physical?this.operation?this.confirming?'CONFIRMING':'PREPARING':'SETTLING':p?'AWAITING_EXPLICIT_CONFIRMATION':this.applied?'APPLIED':'OPEN',acknowledged:this.staged?.acknowledged??false,source_updates:this.updates,financial_writes:0 as const,customer_approval:false as const,production_integrated:false as const,full_live_workbench_reopen:false as const});}
  /** Raw difference notice only; this does not verify the envelope or issue an executable choice. */
  overview(){this.available();const{capture:c}=this.access.read();if(c.envelope_json===null)return Object.freeze({available:false,rows:[],unvalidated:true});let before:FeeEnvelope;try{before=JSON.parse(c.envelope_json) as FeeEnvelope;}catch{return Object.freeze({available:false,rows:[],unvalidated:true});}
    return freezeRecoveryData({available:true,rows:RECONCILE_SLOTS.map(slot=>({slot,changed:before.current_sources?.[slot]!==c.sources[slot],before_bytes:bytes(before.current_sources?.[slot]??null),after_bytes:bytes(c.sources[slot])})),unvalidated:true});}
  async stage(selection:readonly ReconcileSlot[],signal?:AbortSignal):Promise<ReconcileCandidate>{
    this.available();if(this.physical)fail('BUSY');if(this.records.length>=RECONCILE_HISTORY_LIMITS.records)fail('SOURCE_HISTORY_LIMIT');const chosen=selectedSlots(selection);if(signal?.aborted)fail('CANCELLED');this.cancel();const basis=this.access.read(),generation=this.generation;this.physical=true;
    return this.run(generation,basis.checkpoint,signal,async cleanup=>{const prepared=await prepare(basis.capture,chosen);await this.afterPrepare();if(!this.active(generation,basis.checkpoint,signal))fail('CANCELLED_OR_STALE');const p:Pending={token:prepared.candidate,basis,prepared,generation,signal,cleanup,acknowledged:false};this.staged=p;this.issued.set(p.token,p);return p.token;});
  }
  acknowledge(token:ReconcileCandidate,checked:boolean){this.available();const p=this.issued.get(token);if(!p||!this.current(p))fail('FOREIGN_CONSUMED_OR_STALE');if(typeof checked!=='boolean')fail('ACKNOWLEDGEMENT');p.acknowledged=checked;}
  async confirm(token:ReconcileCandidate,choice:'UPDATE_CURRENT_SOURCES_KEEP_HISTORY',signal?:AbortSignal):Promise<ReconcileRecord>{
    this.available();if(this.physical)fail('BUSY');const p=this.issued.get(token);if(!p||!this.current(p))fail('FOREIGN_CONSUMED_OR_STALE');if(choice!=='UPDATE_CURRENT_SOURCES_KEEP_HISTORY'||!p.acknowledged)fail('EXPLICIT_REVIEW_REQUIRED');if(signal?.aborted)fail('CANCELLED');
    this.issued.delete(token);this.staged=null;this.physical=true;this.confirming=true;const generation=this.generation;
    try{return await this.run(generation,p.basis.checkpoint,signal,async()=>{const current=this.access.read();if(!this.active(generation,p.basis.checkpoint,signal)||JSON.stringify(current.capture)!==JSON.stringify(p.basis.capture))fail('CANCELLED_OR_STALE');const fresh=await prepare(current.capture,p.token.selected);await this.afterPrepare();if(!this.active(generation,p.basis.checkpoint,signal)||p.signal?.aborted||fresh.raw!==p.prepared.raw||JSON.stringify(fresh.candidate)!==JSON.stringify(p.token))fail('CANCELLED_OR_STALE');
      const record:ReconcileRecord=freezeRecoveryData({scope:'RECOVERED_SOURCE_RECONCILIATION_APPLIED',before_envelope_json:p.basis.capture.envelope_json!,after_envelope_json:fresh.raw,rows:fresh.candidate.rows,unresolved_issues:fresh.candidate.unresolved_issues,source_updates:this.updates+1,financial_writes:0,customer_approval:false});
      assertReconcileHistoryBudget([...this.records,record]);this.access.beforeInstall?.(record,this.history());if(!this.active(generation,p.basis.checkpoint,signal)||p.signal?.aborted)fail('CANCELLED_OR_STALE');this.access.install(p.basis.checkpoint,fresh);this.applied=record;this.records.push(record);this.updates++;return record;});}finally{p.cleanup();}
  }
  private run<T>(generation:number,checkpoint:WorkbenchCheckpoint,signal:AbortSignal|undefined,task:(cleanup:()=>void)=>Promise<T>):Promise<T>{
    let reject!:(e:Error)=>void;const interrupted=new Promise<never>((_,no)=>{reject=no;});void interrupted.catch(()=>{});const abort=()=>this.cancel(),cleanup=()=>signal?.removeEventListener('abort',abort);signal?.addEventListener('abort',abort,{once:true});const op:Operation={reject,cleanup};this.operation=op;
    const work=(async()=>{try{if(!this.active(generation,checkpoint,signal))fail('CANCELLED_OR_STALE');return await task(cleanup);}catch(error){if(!this.active(generation,checkpoint,signal))fail('CANCELLED_OR_STALE');if(error instanceof RecoveryReconcileError)throw error;throw new RecoveryReconcileError('PREPARATION_FAILED');}finally{if(this.staged?.generation!==generation)cleanup();if(this.operation===op)this.operation=null;this.physical=false;this.confirming=false;}})();void work.catch(()=>{});this.idle=work.then(()=>{},()=>{});return Promise.race([work,interrupted]);
  }
  lastApplied(){return this.applied;}
  history(){return Object.freeze([...this.records]);}
  dispose(){this.closed=true;this.cancel();}
}
