/** Explicit replacement of an independent data quarantine. Never installs live controllers or financial patches. */
import {WorkbenchStateOwner,type WorkbenchCheckpoint} from '../src/ui/workbench-state';
import {parseProject,toTrade,toScenario,toScenarios} from '../src/data/project-file';
import {analyze} from '../src/engine/analyze';
import {compare,scenarioWithDerivedInclusions} from '../src/engine/compare';
import {FeeRecoveryFormat,type FeeRecoveryData} from './fee-recovery-format';
import {freezeRecoveryData} from './fee-recovery-supplement';
export interface FeeRecoveryCalculation {
  readonly status:'CALCULATED_FOR_REVIEW'|'MISSING_PROJECT'|'CALCULATION_UNAVAILABLE';
  readonly base_currency:string|null;readonly seller_profit:string|null;readonly buyer_total:string|null;readonly cost_count:number|null;
  readonly compared_scenarios:number|null;readonly warnings:readonly string[];readonly financial_writes:0;readonly business_approval:false;
}
function calculate(data:FeeRecoveryData):FeeRecoveryCalculation {
  const raw=data.restoration.capture.sources.project_json;
  const empty={base_currency:null,seller_profit:null,buyer_total:null,cost_count:null,compared_scenarios:null,warnings:[],financial_writes:0 as const,business_approval:false as const};
  if(raw===null)return freezeRecoveryData({status:'MISSING_PROJECT',...empty});
  try{
    const project=parseProject(raw),trade=toTrade(project),template=toScenario(project),today=project.export_date===undefined?{}:{today:project.export_date};
    const result=analyze({trade,scenario:scenarioWithDerivedInclusions(template,trade),taxProfile:project.tax_profile,fxBooks:project.fx_books,...today});
    const comparison=compare({trade,template,scenarios:toScenarios(project),anchor:project.anchor,taxProfile:project.tax_profile,fxBooks:project.fx_books,...today});
    if(result.warnings.some(w=>w.level==='ERROR'))return freezeRecoveryData({status:'CALCULATION_UNAVAILABLE',...empty,warnings:result.warnings.filter(w=>w.level==='ERROR').map(w=>w.code)});
    return freezeRecoveryData({status:'CALCULATED_FOR_REVIEW',base_currency:project.base_currency,seller_profit:result.seller.margin?.toString()??null,buyer_total:result.buyer.landed_cost_with_tax.toString(),cost_count:project.items.length,compared_scenarios:comparison.columns.length,warnings:result.warnings.map(w=>w.code),financial_writes:0,business_approval:false});
  }catch{return freezeRecoveryData({status:'CALCULATION_UNAVAILABLE',...empty});}
}
export interface FeeRecoveryQuarantine {
  readonly scope:'INDEPENDENT_FEE_RECOVERY_DATA_QUARANTINE';readonly archive:FeeRecoveryData;readonly calculation:FeeRecoveryCalculation;
  readonly fresh_owner:true;readonly active_reads:0;readonly pending_patch_replays:0;readonly financial_writes:0;readonly runtime_installed:false;
  readonly customer_reviewed:false;readonly recomputed_cache_imported:false;readonly source_storage_written:false;readonly physical_disk_verified:false;
  readonly requires_input_review:boolean;
  readonly browser_input_requires_reentry:boolean;
}
export interface FeeRecoveryStagedSummary {
  readonly scope:'INDEPENDENT_FEE_RECOVERY_STAGED_DATA';readonly captured_at:string;readonly logical_utf8_bytes:number;
  readonly calculation:FeeRecoveryCalculation;readonly required_choice:'REPLACE_QUARANTINE_DATA';readonly financial_writes:0;readonly runtime_installed:false;
  readonly requires_input_review:boolean;
  readonly browser_input_requires_reentry:boolean;
}
interface Operation {checkpoint:WorkbenchCheckpoint;controller:AbortController;external?:AbortSignal;interrupted:Promise<never>;reject:(e:Error)=>void;phase:'DECODING'|'READY'}
interface Issued {operation:Operation;data:FeeRecoveryQuarantine;freshOwner:WorkbenchStateOwner;freshTarget:{data:FeeRecoveryQuarantine}}
const failure=(code:string)=>new Error('FEE_RECOVERY_WORKSPACE_'+code);
function verified(value:FeeRecoveryData):boolean {
  if(!value||typeof value!=='object'||!Object.isFrozen(value))return false;
  const ds=Object.getOwnPropertyDescriptors(value),keys=['kind','version','captured_at','source_wire','supplement_json','restoration','supplement','logical_utf8_bytes','financial_writes','import_authority','confirmation_authority','runtime_installed'];
  return Reflect.ownKeys(ds).length===keys.length&&keys.every(k=>ds[k]?.enumerable&&'value'in ds[k]!)&&ds.kind!.value==='INTERNAL_FEE_WORKBENCH_RECOVERED_DATA'&&ds.version!.value==='0.1'&&ds.financial_writes!.value===0&&ds.import_authority!.value===false&&ds.confirmation_authority!.value===false&&ds.runtime_installed!.value===false&&Object.isFrozen(ds.restoration!.value)&&Object.isFrozen(ds.supplement!.value);
}
/** Same-store stale checkpoints and private identities are consumed once; data archives contain no such authority. */
export class FeeRecoveryWorkspace {
  private readonly owner=new WorkbenchStateOwner();
  private readonly slot={current:null as Issued|null};
  private readonly issued=new WeakMap<object,Issued>();
  private operation:Operation|null=null;private closed=false;
  constructor(private readonly format:Pick<FeeRecoveryFormat,'decode'>=new FeeRecoveryFormat()){this.owner.bind(this.slot,'recovery-workspace');}
  current():FeeRecoveryQuarantine|null{return this.slot.current?.freshTarget.data??null;}
  status(){return this.closed?'CLOSED':this.operation?this.isCurrent(this.operation)?this.operation.phase:'STALE':this.current()?'OPEN':'EMPTY';}
  /** Consumer edits invalidate staged replacements; nested data itself is deeply frozen. */
  invalidate():void{this.owner.touch();}
  private isCurrent(op:Operation){return!this.closed&&this.operation===op&&!op.controller.signal.aborted&&!op.external?.aborted&&this.owner.isCurrent(op.checkpoint);}
  private check(op:Operation){if(this.closed)throw failure('CLOSED');if(op.controller.signal.aborted||op.external?.aborted)throw failure('CANCELLED');if(!this.isCurrent(op))throw failure('STALE');}
  private interrupt(op:Operation){op.reject(failure('CANCELLED'));op.controller.abort();}
  cancel(){const old=this.operation;this.operation=null;if(old)this.interrupt(old);}
  dispose(){this.closed=true;this.cancel();}
  async stage(raw:unknown,external?:AbortSignal):Promise<FeeRecoveryStagedSummary>{
    if(this.closed)throw failure('CLOSED');if(typeof AbortController!=='function')throw failure('UNAVAILABLE');
    let reject!:(e:Error)=>void;const interrupted=new Promise<never>((_,no)=>{reject=no;});void interrupted.catch(()=>{});
    const op:Operation={checkpoint:this.owner.checkpoint(),controller:new AbortController(),external,interrupted,reject,phase:'DECODING'};
    const previous=this.operation;this.operation=op;if(previous)this.interrupt(previous);
    const abort=()=>{if(this.operation===op)this.operation=null;this.interrupt(op);};external?.addEventListener('abort',abort,{once:true});
    try{
      this.check(op);const archive=await Promise.race([this.format.decode(raw,op.controller.signal),interrupted]);this.check(op);if(!verified(archive))throw failure('UNVERIFIED_DATA');this.check(op);
      // No archived busy/read/confirmation/cache values become live fields. All originals remain inside archive.
      const capture=archive.restoration.capture,calculation=calculate(archive),requires_input_review=calculation.status!=='CALCULATED_FOR_REVIEW'||capture.blockers.length>0||Object.values(capture.editors).some(v=>v!==null)||Object.values(capture.activity).some(Boolean)||archive.supplement.pending_present||archive.supplement.workflow.pending_calculation===true;
      const pending=archive.supplement.pending_control,browser_input_requires_reentry=!!pending&&(pending.bad_input===true||Array.isArray(pending.files)&&pending.files.length>0);
      const data:FeeRecoveryQuarantine=freezeRecoveryData({scope:'INDEPENDENT_FEE_RECOVERY_DATA_QUARANTINE',archive,calculation,fresh_owner:true,active_reads:0,pending_patch_replays:0,financial_writes:0,runtime_installed:false,customer_reviewed:false,recomputed_cache_imported:false,source_storage_written:false,physical_disk_verified:false,requires_input_review,browser_input_requires_reentry});
      const freshOwner=new WorkbenchStateOwner(),freshTarget={data};freshOwner.bind(freshTarget,'recovered-data');this.check(op);
      const summary:FeeRecoveryStagedSummary=freezeRecoveryData({scope:'INDEPENDENT_FEE_RECOVERY_STAGED_DATA',captured_at:archive.captured_at,logical_utf8_bytes:archive.logical_utf8_bytes,calculation:data.calculation,required_choice:'REPLACE_QUARANTINE_DATA',financial_writes:0,runtime_installed:false,requires_input_review,browser_input_requires_reentry});
      op.phase='READY';this.issued.set(summary,{operation:op,data,freshOwner,freshTarget});return summary;
    }catch{this.check(op);throw failure('DECODE_FAILED');}
    finally{external?.removeEventListener('abort',abort);if(this.operation===op&&op.phase!=='READY')this.operation=null;}
  }
  /** Replaces only this independent data holder, once, after the caller's explicit choice. */
  confirm(summary:FeeRecoveryStagedSummary,choice:'REPLACE_QUARANTINE_DATA'):FeeRecoveryQuarantine{
    const c=this.issued.get(summary);if(!c)throw failure('FOREIGN_OR_CONSUMED');this.check(c.operation);
    if(choice!=='REPLACE_QUARANTINE_DATA')throw failure('CHOICE_REQUIRED');
    if(!this.owner.commit(c.operation.checkpoint,[{target:this.slot,values:{current:c}}]))throw failure('STALE');
    this.issued.delete(summary);this.operation=null;return c.freshTarget.data;
  }
  ownerStatus(){return this.slot.current?.freshOwner.status()??null;}
}
