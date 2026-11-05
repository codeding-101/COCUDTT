/** Local diagnostic boundaries. Original source bodies and collection identities are retained. */
import type {FeeWorkbenchObservationCheck} from './fee-workbench-observation';

export interface WorkbenchBoundarySite {
  readonly id:string; readonly owner:string; readonly kind:'METHOD_ENTRY'|'COLLECTION_CALL';
  readonly method:string; readonly field?:string; readonly path:string; readonly line:number;
}
export class WorkbenchBoundaryObservation {
  private closed=false;
  private epoch=0;
  private unknown=0;
  private notifications=0;
  private readonly issued=new WeakMap<object,number>();
  private readonly sites:ReadonlyMap<string,WorkbenchBoundarySite>;
  private targets:Readonly<Record<string,object>>;
  private readonly collections=new Map<string,object>();
  constructor(sites:readonly WorkbenchBoundarySite[],targets:Record<string,object>,collections:Readonly<Record<string,object>>={}){
    if(!sites.length||new Set(sites.map(s=>s.id)).size!==sites.length||sites.some(s=>!targets[s.owner])||new Set(Object.values(targets)).size!==Object.keys(targets).length)throw Error('WORKBENCH_BOUNDARY_PLAN');
    this.sites=new Map(sites.map(s=>[s.id,Object.freeze({...s})]));
    this.targets=Object.freeze({...targets});
    for(const s of sites.filter(s=>s.kind==='COLLECTION_CALL'&&s.field)){
      const key=s.owner+'.'+s.field;if(this.collections.has(key))continue;
      const d=Object.getOwnPropertyDescriptor(targets[s.owner]!,s.field!);
      const value=collections[key]??(d&&'value'in d?d.value:undefined);
      if(value&&typeof value==='object')this.collections.set(key,value);else this.unknown++;
    }
  }
  private advance(){if(this.epoch<Number.MAX_SAFE_INTEGER)this.epoch++;else this.unknown++;this.notifications++;}
  entry(site:string,receiver:unknown){
    if(this.closed)return;
    const s=this.sites.get(site);
    if(!s||s.kind!=='METHOD_ENTRY'){this.unknown++;this.advance();return;}
    // A borrowed method does not mutate the registered original owner by itself.
    if(this.targets[s.owner]!==receiver)return;
    this.advance();
  }
  prepareCollection(site:string,receiver:object,method:string){
    if(!this.closed){
      const s=this.sites.get(site),expected=s?.field?this.collections.get(s.owner+'.'+s.field):s?this.targets[s.owner]:undefined;
      if(!s||s.kind!=='COLLECTION_CALL'||s.method!==method||expected!==receiver)this.unknown++;
      this.advance();
    }
    // Preparing the callee happens BEFORE original arguments are evaluated.
    const operation=Reflect.get(receiver,method);
    return(...args:unknown[])=>Reflect.apply(operation,receiver,args);
  }
  collection(site:string,receiver:object,method:string,args:readonly unknown[]){return this.prepareCollection(site,receiver,method)(...args);}
  checkpoint(){if(this.closed)throw Error('WORKBENCH_BOUNDARY_CLOSED');const t=Object.freeze({scope:'SOURCE_BOUNDARY_CHECKPOINT',epoch:this.epoch});this.issued.set(t,this.epoch);return t;}
  isCurrent(token:object){return !this.closed&&this.issued.get(token)===this.epoch&&this.unknown===0;}
  snapshot(){return Object.freeze({scope:'DECLARED_SOURCE_BOUNDARIES',observing:!this.closed,epoch:this.epoch,unknown:this.unknown,sites:this.sites.size,notifications:this.notifications,retained_targets:Object.keys(this.targets).length,retained_collections:this.collections.size,cached_declared_method_entries_covered:true,declared_collection_calls_covered:true,arbitrary_external_nested_mutations_covered:false,reflective_mutations_covered:false,financial_writes:0});}
  stop(){this.closed=true;this.advance();this.targets=Object.freeze({});this.collections.clear();return this.snapshot();}
}
let active:WorkbenchBoundaryObservation|null=null;
export function installWorkbenchBoundaryObservation(sites:readonly WorkbenchBoundarySite[],targets:Record<string,object>,collections:Readonly<Record<string,object>>={}){
  if(active?.snapshot().observing)throw Error('WORKBENCH_BOUNDARY_OBSERVER_EXISTS');
  active=new WorkbenchBoundaryObservation(sites,targets,collections);return active;
}
export const workbenchBoundaryCalls={
  entry(site:string,receiver:unknown){active?.entry(site,receiver);},
  prepareCollection(site:string,receiver:object,method:string){if(active)return active.prepareCollection(site,receiver,method);const operation=Reflect.get(receiver,method);return(...args:unknown[])=>Reflect.apply(operation,receiver,args);},
  collection(site:string,receiver:object,method:string,...args:unknown[]){return active?active.collection(site,receiver,method,args):Reflect.apply(Reflect.get(receiver,method),receiver,args);},
};
export interface WorkbenchBufferObservation {
  snapshot():{epoch:number;observing:boolean;dirty_attached:number;dirty_detached:number;unreadable:number;file_selected:number};
  isCurrent(epoch:number):boolean;
}
export class FeeWorkbenchBoundaryCheck {
  private closed=false;
  private readonly issued=new WeakMap<object,{legacy:object;boundary:object;dom:number}>();
  constructor(private readonly legacy:FeeWorkbenchObservationCheck,private readonly boundaries:WorkbenchBoundaryObservation,private readonly buffers:WorkbenchBufferObservation){}
  inspect(){
    if(this.closed)throw Error('WORKBENCH_BOUNDARY_CHECK_CLOSED');
    const dom=this.buffers.snapshot(),boundary=this.boundaries.checkpoint(),legacy=this.legacy.inspect();
    if(!this.buffers.isCurrent(dom.epoch)||!this.boundaries.isCurrent(boundary)||!this.legacy.matches(legacy))throw Error('WORKBENCH_BOUNDARY_STALE');
    const blockers:string[]=[];
    if(dom.dirty_attached)blockers.push('EDITED_DOM_BUFFER');
    if(dom.dirty_detached)blockers.push('DETACHED_EDITED_BUFFER');
    if(dom.unreadable)blockers.push('UNREADABLE_DOM_BUFFER');
    if(dom.file_selected)blockers.push('FILE_SELECTION_REQUIRES_REVIEW');
    if(legacy.resources.unknown)blockers.push('RESOURCE_LIFETIME_UNKNOWN');
    const report=Object.freeze({scope:'READ_ONLY_WORKBENCH_BOUNDARIES',legacy,boundaries:this.boundaries.snapshot(),buffers:dom,blockers:Object.freeze(blockers),initial_save_evidence_unknown:true,full_freshness_verified:false,all_dom_buffers_covered:false,automatic_listener_removal_fully_observed:false,financial_writes:0,switch_enabled:false,import_authority:false,confirmation_authority:false});
    this.issued.set(report,{legacy,boundary,dom:dom.epoch});return report;
  }
  matches(report:object){const p=this.issued.get(report);return !this.closed&&!!p&&this.boundaries.isCurrent(p.boundary)&&this.buffers.isCurrent(p.dom)&&this.legacy.matches(p.legacy);}
  dispose(){this.closed=true;}
}
