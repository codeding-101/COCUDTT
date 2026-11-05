/** Fixed two-component diagnostic startup. No workbench, financial or save authority. */
import type{ResourceCloseChoice}from'./fee-resource-owner';
export type ComponentRole='field'|'guide';
export interface ComponentView{raw:string;root_connected:boolean;frame_connected:boolean;usable:boolean;owner:{phase:string;resources:number;failed_resources:number;physical_tasks:number;physical_cleanup:number};}
export interface SessionComponent{inspect():ComponentView;prepareClose():ResourceCloseChoice;acknowledge(t:ResourceCloseChoice,checked:boolean):void;close(t:ResourceCloseChoice):Promise<unknown>;retryCleanup():Promise<unknown>;}
export interface BootstrapView{phase:string;resources:number;failed_resources:number;physical_tasks:number;physical_cleanup:number;root_connected:boolean;frame_connected:boolean;descriptor_owned:boolean;guard_restored:boolean;storage_lookups:number;revision:number;raw:string;invalidated:boolean;}
export interface SessionBootstrap{inspect():BootstrapView;close():Promise<unknown>;retryCleanup():Promise<unknown>;}
export interface ComponentSessionPorts{bootstrap:SessionBootstrap;loadField():Promise<unknown>;createField(module:unknown):SessionComponent|Promise<SessionComponent>;loadGuide():Promise<unknown>;createGuide(module:unknown):SessionComponent|Promise<SessionComponent>;}
export type SessionCloseOrder='GUIDE_FIRST'|'FIELD_FIRST';
export interface ComponentSessionChoice{readonly scope:'CLOSE_COMPONENT_SESSION';readonly order:SessionCloseOrder;readonly roles:readonly ComponentRole[];readonly raw_retained:true;readonly source_saved:false;}
export interface ComponentSessionReceipt{readonly scope:'READY_COMPONENT_SESSION';readonly full_workbench_switch:false;}
type Phase='IDLE'|'STARTING'|'READY'|'STOPPING'|'STOPPED'|'FAILED'|'CLOSING'|'CLEANUP_FAILED'|'CLOSED';
type Step='FIELD_MODULE'|'FIELD_FACTORY'|'GUIDE_MODULE'|'GUIDE_FACTORY'|null;
interface Binding{key:string;raw:string;}
interface Capture{bootstrap:Binding;field:Binding|null;guide:Binding|null;}
function fail(s:string):never{throw Error('COMPONENT_SESSION_'+s);}
const isCount=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
export class ComponentSession{
 private phase:Phase='IDLE';private step:Step=null;private started=false;private pending=false;private generation:object={};private revision:object={};private stopped=false;private invalidated=false;private capturing=false;
 private pipeline:Promise<void>|null=null;private cleanupPending=false;private field:SessionComponent|null=null;private guide:SessionComponent|null=null;private unknownFactory=false;private error:string|null=null;
 private loads=0;private factories=0;private late=0;private closeCalls={field:0,guide:0,bootstrap:0};
 private ready:{token:ComponentSessionReceipt;revision:object;capture:Capture}|null=null;
 private review:{token:ComponentSessionChoice;revision:object;capture:Capture;checked:boolean}|null=null;
 constructor(private readonly ports:ComponentSessionPorts){if(!ports||typeof ports.loadField!=='function'||typeof ports.loadGuide!=='function'||typeof ports.createField!=='function'||typeof ports.createGuide!=='function'||!ports.bootstrap||['inspect','close','retryCleanup'].some(k=>typeof Reflect.get(ports.bootstrap,k)!=='function'))fail('PORTS');}
 private advance(){this.revision={};this.ready=null;this.review=null;}
 touch(){this.advance();}
 invalidate(){this.invalidated=true;if(this.cleanupPending||this.phase==='CLOSING'||this.phase==='CLEANUP_FAILED'||this.phase==='CLOSED'){this.advance();return;}this.stopStartup();}
 stopStartup(){if(this.phase==='CLOSING'||this.cleanupPending||this.phase==='CLEANUP_FAILED')fail('BUSY_OR_NEEDS_RETRY');if(this.phase==='CLOSED')return;this.stopped=true;this.generation={};this.advance();this.phase=this.pending?'STOPPING':'STOPPED';}
 private current(g:object){return !this.stopped&&!this.invalidated&&this.generation===g;}
 start():Promise<void>{
  if(this.started||this.phase!=='IDLE')fail('STARTED_OR_STOPPED');this.started=true;this.pending=true;this.phase='STARTING';this.advance();const g=this.generation;
  this.pipeline=Promise.resolve().then(async()=>{
   for(const role of['field','guide']as const){if(!this.current(g))return;
    this.step=role==='field'?'FIELD_MODULE':'GUIDE_MODULE';this.loads++;const module=await(role==='field'?this.ports.loadField():this.ports.loadGuide());
    if(!this.current(g)){this.late++;return;}
    this.step=role==='field'?'FIELD_FACTORY':'GUIDE_FACTORY';this.factories++;let component:SessionComponent;
    try{component=await(role==='field'?this.ports.createField(module):this.ports.createGuide(module));if(!component||['inspect','prepareClose','acknowledge','close','retryCleanup'].some(k=>typeof Reflect.get(component,k)!=='function'))fail('UNKNOWN_FACTORY');}catch(error){this.unknownFactory=true;throw error;}
    this[role]=component;this.advance();
    if(!this.current(g)){this.late++;return;}
    const v=this.readPart(component);if(!v.usable||v.owner.phase!=='OPEN'||!v.root_connected||!v.frame_connected)fail('PARTIAL_COMPONENT');
   }
  }).catch(()=>{this.error='START_FAILED_'+(this.step??'BEFORE_MODULE');}).finally(()=>{this.pending=false;this.step=null;this.advance();this.phase=this.stopped||this.invalidated?'STOPPED':this.error?'FAILED':'READY';});
  return this.pipeline;
 }
 whenSettled(){return this.pipeline??Promise.resolve();}
 private readPart(p:SessionComponent):ComponentView{const v=p.inspect();if(!v||typeof v.raw!=='string'||typeof v.root_connected!=='boolean'||typeof v.frame_connected!=='boolean'||typeof v.usable!=='boolean'||!v.owner||!['OPEN','CLOSING','FAILED','CLOSED'].includes(v.owner.phase)||!['resources','failed_resources','physical_tasks','physical_cleanup'].every(k=>isCount(Reflect.get(v.owner,k))))fail('UNKNOWN_COMPONENT');return v;}
 private readBootstrap(){const v=this.ports.bootstrap.inspect();if(!v||typeof v.raw!=='string'||!['OPEN','CLOSING','FAILED','CLOSED'].includes(v.phase)||!['resources','failed_resources','physical_tasks','physical_cleanup','storage_lookups','revision'].every(k=>isCount(Reflect.get(v,k)))||!['root_connected','frame_connected','descriptor_owned','guard_restored','invalidated'].every(k=>typeof Reflect.get(v,k)==='boolean'))fail('UNKNOWN_BOOTSTRAP');return v;}
 private capture(requireReady=false):Capture{
  if(this.capturing)fail('REENTRANT');this.capturing=true;const revision=this.revision;
  try{const b=this.readBootstrap(),part=(p:SessionComponent|null):Binding|null=>{if(!p){if(requireReady)fail('NOT_READY');return null;}const v=this.readPart(p);if(v.owner.physical_tasks||v.owner.physical_cleanup)fail('WAIT_COMPONENT_TASKS');if(requireReady&&(!v.usable||v.owner.phase!=='OPEN'||!v.root_connected||!v.frame_connected))fail('NOT_READY');return{raw:v.raw,key:JSON.stringify([v.root_connected,v.frame_connected,v.usable,v.owner.phase,v.owner.resources,v.owner.failed_resources])};};
   if(requireReady&&(!b.descriptor_owned||b.invalidated||!b.root_connected||!b.frame_connected||b.phase!=='OPEN'))fail('NOT_READY');
   if(b.physical_tasks||b.physical_cleanup)fail('WAIT_BOOTSTRAP_TASKS');const result={bootstrap:{raw:b.raw,key:JSON.stringify([b.phase,b.resources,b.failed_resources,b.root_connected,b.frame_connected,b.descriptor_owned,b.guard_restored,b.storage_lookups,b.revision,b.invalidated])},field:part(this.field),guide:part(this.guide)};if(revision!==this.revision)fail('CHANGED_DURING_READ');return result;
  }finally{this.capturing=false;}
 }
 private same(a:Capture,b:Capture){return(['bootstrap','field','guide']as const).every(k=>a[k]===null?b[k]===null:!!b[k]&&a[k]!.key===b[k]!.key&&a[k]!.raw===b[k]!.raw);}
 readyReceipt():ComponentSessionReceipt{if(this.phase!=='READY'||this.pending||this.stopped||this.invalidated||!this.field||!this.guide)fail('NOT_READY');this.advance();const revision=this.revision,capture=this.capture(true),token=Object.freeze({scope:'READY_COMPONENT_SESSION' as const,full_workbench_switch:false as const});this.ready={token,revision,capture};return token;}
 isCurrent(token:ComponentSessionReceipt){const r=this.ready;if(!r||r.token!==token||r.revision!==this.revision||this.phase!=='READY'||this.pending||this.stopped||this.invalidated)return false;try{return this.same(r.capture,this.capture(true))&&r.revision===this.revision;}catch{return false;}}
 prepareClose(order:SessionCloseOrder='GUIDE_FIRST'):ComponentSessionChoice{if(this.capturing)fail('REENTRANT');if(this.cleanupPending||this.phase==='CLOSING'||this.phase==='CLOSED')fail('BUSY_OR_CLOSED');if(this.pending)fail('WAIT_PHYSICAL_STARTUP');if(order!=='GUIDE_FIRST'&&order!=='FIELD_FIRST')fail('ORDER');this.advance();const revision=this.revision,capture=this.capture(),roles=(['field','guide']as const).filter(r=>this[r]!==null),token=Object.freeze({scope:'CLOSE_COMPONENT_SESSION' as const,order,roles:Object.freeze(roles),raw_retained:true as const,source_saved:false as const});this.review={token,revision,capture,checked:false};return token;}
 private checked(token:ComponentSessionChoice){const r=this.review;if(this.capturing||this.cleanupPending||this.pending||!r||r.token!==token||r.revision!==this.revision)fail('FOREIGN_OR_STALE');if(!this.same(r.capture,this.capture())||r.revision!==this.revision)fail('FOREIGN_OR_STALE');return r;}
 acknowledge(token:ComponentSessionChoice,checked:boolean){const r=this.checked(token);if(typeof checked!=='boolean')fail('ACKNOWLEDGEMENT');r.checked=checked;}
 cancelClose(){if(this.cleanupPending)fail('BUSY');this.advance();}
 async close(token:ComponentSessionChoice,choice:'CLOSE_RETAINED_COMPONENT_RESOURCES'){const r=this.checked(token);if(!r.checked||choice!=='CLOSE_RETAINED_COMPONENT_RESOURCES')fail('EXPLICIT_CLOSE_REQUIRED');this.stopped=true;this.generation={};this.advance();return this.cleanup(token.order,false);}
 async retryCleanup(choice:'RETRY_COMPONENT_SESSION_CLEANUP'){if(this.cleanupPending||this.pending||this.phase!=='CLEANUP_FAILED'||choice!=='RETRY_COMPONENT_SESSION_CLEANUP')fail('EXPLICIT_RETRY_REQUIRED');return this.cleanup('GUIDE_FIRST',true);}
 private async cleanup(order:SessionCloseOrder,retry:boolean){
  this.cleanupPending=true;this.phase='CLOSING';this.advance();let allClosed=!this.unknownFactory;
  try{
   for(const role of(order==='GUIDE_FIRST'?['guide','field']:['field','guide'])as ComponentRole[]){const p=this[role];if(!p)continue;try{const before=this.readPart(p);if(before.owner.phase!=='CLOSED'||before.owner.resources){this.closeCalls[role]++;if(before.owner.phase==='FAILED'){if(!retry)fail('CHILD_NEEDS_RETRY');await p.retryCleanup();}else{const t=p.prepareClose();p.acknowledge(t,true);await p.close(t);}}}catch{}
    try{const after=this.readPart(p);if(after.owner.phase!=='CLOSED'||after.owner.resources||after.owner.physical_tasks||after.owner.physical_cleanup)allClosed=false;}catch{allClosed=false;}
   }
   if(allClosed){try{const b=this.readBootstrap();if(b.phase!=='CLOSED'||b.resources){this.closeCalls.bootstrap++;if(b.phase==='FAILED'){if(!retry)fail('BOOTSTRAP_NEEDS_RETRY');await this.ports.bootstrap.retryCleanup();}else await this.ports.bootstrap.close();}}catch{}
    try{const b=this.readBootstrap();allClosed=b.phase==='CLOSED'&&b.resources===0&&b.physical_tasks===0&&b.physical_cleanup===0&&b.guard_restored;}catch{allClosed=false;}
   }
  }finally{this.cleanupPending=false;this.phase=allClosed?'CLOSED':'CLEANUP_FAILED';this.advance();}
  return this.inspect();
 }
 inspect(){const part=(p:SessionComponent|null)=>{if(!p)return null;try{const v=this.readPart(p);return{known:true,root_connected:v.root_connected,frame_connected:v.frame_connected,usable:v.usable,phase:v.owner.phase,resources:v.owner.resources,failed_resources:v.owner.failed_resources,physical_tasks:v.owner.physical_tasks,physical_cleanup:v.owner.physical_cleanup};}catch{return{known:false};}};let bootstrap:Omit<BootstrapView,'raw'>|{known:false};try{const{raw,...v}=this.readBootstrap();bootstrap=v;}catch{bootstrap={known:false};}const components={field:part(this.field),guide:part(this.guide)};return{phase:this.phase,pipeline_pending:this.pending,physical_step:this.step,physical_module_loads:this.pending&&this.step?.endsWith('MODULE')?1:0,physical_factories:this.pending&&this.step?.endsWith('FACTORY')?1:0,started:this.started,stop_requested:this.stopped,invalidated:this.invalidated,unknown_factory:this.unknownFactory,start_error:this.error,loads_started:this.loads,factories_started:this.factories,late_results_retained_or_ignored:this.late,cleanup_pending:this.cleanupPending,pending_close:!!this.review,close_calls:{...this.closeCalls},bootstrap,components,original_application_resources_removed:0,frame_removed:false,all_frame_resources_owned:false,raw_snapshot_frozen:false,browser_preference_persisted:false,financial_writes:0,source_save_state_written:false,full_workbench_switch:false,root_installation_authority:false};}
}
