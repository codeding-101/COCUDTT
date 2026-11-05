/** Scoped source-call adapters. Original callbacks/options and application resources are retained. */
export interface WorkbenchResourceSite{readonly id:string;readonly path:string;readonly kind:'EVENT_LISTENER'|'REMOVE_EVENT'|'TIMER'|'CLEAR_TIMER'|'OBJECT_URL'|'REVOKE_URL';readonly line:number}
type Listener=EventListenerOrEventListenerObject|null;
interface EventRecord{site:string;target:WeakRef<EventTarget>;listener:WeakRef<object>;type:string;capture:boolean;active:boolean;unknown:boolean}
export class WorkbenchResourceObservation{
  private epoch=0;private closed=false;private unknown=0;private readonly sites:ReadonlyMap<string,WorkbenchResourceSite>;private readonly events:EventRecord[]=[];private readonly timers=new Map<ReturnType<typeof setTimeout>,string>();private readonly urls=new Map<string,string>();
  constructor(sites:readonly WorkbenchResourceSite[]){if(new Set(sites.map(s=>s.id)).size!==sites.length)throw Error('WORKBENCH_RESOURCE_SITES');this.sites=new Map(sites.map(s=>[s.id,Object.freeze({...s})]));}
  private touch(site:string,kind:WorkbenchResourceSite['kind']){if(this.closed)return;this.epoch++;if(this.sites.get(site)?.kind!==kind)this.unknown++;}
  private options(value:boolean|AddEventListenerOptions|EventListenerOptions|undefined){if(value===undefined||typeof value==='boolean')return{capture:value===true,unknown:false};try{const d=Object.getOwnPropertyDescriptors(value),plain=[Object.prototype,null].includes(Object.getPrototypeOf(value));if(!plain||Object.values(d).some(p=>!('value'in p)))return{capture:false,unknown:true};const capture=d.capture?.value===true,unknown=!!d.once?.value||!!d.signal?.value||d.capture!==undefined&&typeof d.capture.value!=='boolean';return{capture,unknown};}catch{return{capture:false,unknown:true};}}
  listen(site:string,target:EventTarget,type:string,listener:Listener,options?:boolean|AddEventListenerOptions){
    const out=target.addEventListener(type,listener,options);if(this.closed)return out;this.touch(site,'EVENT_LISTENER');if(listener){const o=this.options(options),found=this.events.find(r=>r.active&&r.target.deref()===target&&r.listener.deref()===listener&&r.type===type&&r.capture===o.capture);if(!found)this.events.push({site,target:new WeakRef(target),listener:new WeakRef(listener),type,capture:o.capture,active:true,unknown:o.unknown});}return out;
  }
  remove(site:string,target:EventTarget,type:string,listener:Listener,options?:boolean|EventListenerOptions){const out=target.removeEventListener(type,listener,options);if(this.closed)return out;this.touch(site,'REMOVE_EVENT');const o=this.options(options);if(o.unknown)this.unknown++;for(const r of this.events)if(r.target.deref()===target&&r.listener.deref()===listener&&r.type===type&&r.capture===o.capture)r.active=false;return out;}
  timer(site:string,callback:(...args:any[])=>void,delay?:number,...args:any[]):ReturnType<typeof setTimeout>{if(this.closed)return setTimeout(callback,delay,...args);this.touch(site,'TIMER');const ledger=this;let handle:ReturnType<typeof setTimeout>;handle=setTimeout(function(this:unknown,...values:any[]){try{return Reflect.apply(callback,this,values);}finally{if(!ledger.closed){ledger.timers.delete(handle);ledger.epoch++;}}},delay,...args);this.timers.set(handle,site);return handle;}
  clearTimer(site:string,handle:ReturnType<typeof setTimeout>|undefined){const out=clearTimeout(handle);if(!this.closed){this.touch(site,'CLEAR_TIMER');if(handle!==undefined)this.timers.delete(handle);}return out;}
  url(site:string,blob:Blob){const url=URL.createObjectURL(blob);if(!this.closed){this.touch(site,'OBJECT_URL');this.urls.set(url,site);}return url;}
  revoke(site:string,url:string){const out=URL.revokeObjectURL(url);if(!this.closed){this.touch(site,'REVOKE_URL');this.urls.delete(url);}return out;}
  snapshot(){const events=this.events.filter(e=>e.active&&e.target.deref()&&e.listener.deref()),unknown=this.unknown+events.filter(e=>e.unknown).length;return Object.freeze({scope:'SOURCE_RESOURCE_OBSERVATION',epoch:this.epoch,observing:!this.closed,unknown,active:events.length+this.timers.size+this.urls.size,sites:this.sites.size,event_listeners:events.length,timers:this.timers.size,object_urls:this.urls.size,application_resources_removed:0,external_registrations_covered:false,automatic_listener_removal_fully_observed:false,financial_writes:0});}
  isCurrent(epoch:number){return!this.closed&&this.epoch===epoch;}
  stop(){this.closed=true;this.epoch++;return this.snapshot();}
}
/** One ledger per isolated module graph, shared by source-call instrumentation. */
let active:WorkbenchResourceObservation|null=null;
export function installWorkbenchResourceObservation(sites:readonly WorkbenchResourceSite[]){if(active?.snapshot().observing)throw Error('WORKBENCH_RESOURCE_OBSERVER_EXISTS');active=new WorkbenchResourceObservation(sites);return active;}
export const workbenchResourceCalls={
 listen:(site:string,target:EventTarget,type:string,listener:Listener,options?:boolean|AddEventListenerOptions)=>active?active.listen(site,target,type,listener,options):target.addEventListener(type,listener,options),
 remove:(site:string,target:EventTarget,type:string,listener:Listener,options?:boolean|EventListenerOptions)=>active?active.remove(site,target,type,listener,options):target.removeEventListener(type,listener,options),
 timer:(site:string,callback:(...args:any[])=>void,delay?:number,...args:any[])=>active?active.timer(site,callback,delay,...args):setTimeout(callback,delay,...args),
 clearTimer:(site:string,handle:ReturnType<typeof setTimeout>|undefined)=>active?active.clearTimer(site,handle):clearTimeout(handle),
 url:(site:string,blob:Blob)=>active?active.url(site,blob):URL.createObjectURL(blob),revoke:(site:string,url:string)=>active?active.revoke(site,url):URL.revokeObjectURL(url),
};
