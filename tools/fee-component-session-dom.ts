/** Creator-owned child document bootstrap. Retains its frame and all raw controls. */
import{IsolatedResourceOwner}from'./fee-resource-owner';import{FieldHelpEventPort}from'./fee-field-help-port';
import{ComponentSession,type ComponentSessionPorts,type BootstrapView}from'./fee-component-session';
const equalDescriptor=(a:PropertyDescriptor|undefined,b:PropertyDescriptor|undefined)=>!!a&&!!b&&['get','set','value','writable','enumerable','configurable'].every(k=>Object.is(Reflect.get(a,k),Reflect.get(b,k)));
/** A trusted creator supplies the target. This class never reads the stored value. */
export class ComponentStorageGuard{
 private readonly original:PropertyDescriptor;private readonly guarded:PropertyDescriptor;private installed=false;private restored=false;private lookups=0;
 constructor(private readonly target:object,notify:()=>void=()=>{}){const original=Object.getOwnPropertyDescriptor(target,'localStorage');if(!original||original.configurable!==true||typeof notify!=='function')throw Error('COMPONENT_BOOTSTRAP_DESCRIPTOR');this.original=Object.freeze({...original});const self=this;this.guarded=Object.freeze({configurable:true,enumerable:original.enumerable??false,get(){self.lookups++;try{notify();}catch{}throw Error('COMPONENT_BOOTSTRAP_STORAGE_FORBIDDEN');}});}
 install(){if(this.installed||this.restored||!equalDescriptor(Object.getOwnPropertyDescriptor(this.target,'localStorage'),this.original))throw Error('COMPONENT_BOOTSTRAP_INSTALL_CONFLICT');Object.defineProperty(this.target,'localStorage',this.guarded);this.installed=true;}
 restore(){const current=Object.getOwnPropertyDescriptor(this.target,'localStorage');if(equalDescriptor(current,this.original)){this.restored=true;return;}if(!this.installed||!equalDescriptor(current,this.guarded))throw Error('COMPONENT_BOOTSTRAP_RESTORE_CONFLICT');Object.defineProperty(this.target,'localStorage',this.original);if(!equalDescriptor(Object.getOwnPropertyDescriptor(this.target,'localStorage'),this.original))throw Error('COMPONENT_BOOTSTRAP_RESTORE_INCOMPLETE');this.restored=true;}
 inspect(){return{lookups:this.lookups,owned:this.installed&&!this.restored&&equalDescriptor(Object.getOwnPropertyDescriptor(this.target,'localStorage'),this.guarded),restored:this.restored&&equalDescriptor(Object.getOwnPropertyDescriptor(this.target,'localStorage'),this.original),original_descriptor_unchanged:equalDescriptor(Object.getOwnPropertyDescriptor(this.target,'localStorage'),this.original)};}
}
const mounted=new WeakSet<Document>();
export function createFrameComponentSession(prefix:string,loaders:Omit<ComponentSessionPorts,'bootstrap'>){
 if(typeof prefix!=='string'||!/^session122-[a-z0-9]{1,29}$/.test(prefix))throw Error('COMPONENT_BOOTSTRAP_PREFIX');
 const doc=document,view=doc.defaultView as(Window&typeof globalThis)|null,frame=view?.frameElement as HTMLIFrameElement|null,suffix=prefix.slice(11);
 if(!view||view.parent===view||!frame||frame.tagName!=='IFRAME'||doc.querySelector('#app')||frame.dataset.componentSession!==prefix||frame.dataset.fieldHelpFrame!=='field120-run'+suffix||frame.dataset.onboardingFrame!=='guide121-run'+suffix||frame.ownerDocument.querySelectorAll('iframe[data-component-session="'+prefix+'"]').length!==1||mounted.has(doc))throw Error('COMPONENT_BOOTSTRAP_FRAME_REQUIRED');
 if(!loaders||['loadField','createField','loadGuide','createGuide'].some(k=>typeof Reflect.get(loaders,k)!=='function'))throw Error('COMPONENT_BOOTSTRAP_PORTS');
 let session:ComponentSession|null=null,observer:MutationObserver|null=null,revision=0,invalidated=false,setupFailed=false;
 const touch=()=>{revision=Math.min(Number.MAX_SAFE_INTEGER,revision+1);session?.touch();},invalidate=()=>{invalidated=true;touch();session?.invalidate();},guard=new ComponentStorageGuard(view,invalidate);
 const owner=new IsolatedResourceOwner(),root=doc.createElement('main');root.dataset.componentBootstrap=prefix;root.innerHTML='<h1>组件会话 · 启动与关闭核对</h1><p>取消只停止后续准备；已创建组件与输入保留，加载实际结束后再核对关闭。关闭资源不代表已保存或原文冻结。</p><label>会话未提交原文<input data-session-raw aria-label="会话未提交原文"></label>';doc.body.append(root);mounted.add(doc);
 const raw=root.querySelector<HTMLInputElement>('[data-session-raw]')!,events=new FieldHelpEventPort(owner,doc),pageEvents=new FieldHelpEventPort(owner,view);
 const drain=()=>{if(observer?.takeRecords().length)invalidate();};
 try{
  owner.own('OTHER',()=>guard.restore());guard.install();
  events.listen('input',touch);events.listen('change',touch);pageEvents.listen('pagehide',invalidate);
  observer=new view.MutationObserver(invalidate);owner.own('OTHER',()=>observer!.disconnect());observer.observe(frame,{attributes:true,attributeFilter:['src','id','data-component-session','data-field-help-frame','data-onboarding-frame']});observer.observe(root,{childList:true});
 }catch{setupFailed=true;invalidated=true;}
 const bootstrap={
  inspect():BootstrapView{drain();const o=owner.snapshot(),g=guard.inspect();return{phase:o.phase,resources:o.resources,failed_resources:o.failed_resources,physical_tasks:o.physical_tasks,physical_cleanup:o.physical_cleanup,root_connected:root.isConnected,frame_connected:frame.isConnected&&frame.contentDocument===doc,descriptor_owned:g.owned,guard_restored:g.restored,storage_lookups:g.lookups,revision,raw:raw.value,invalidated};},
  close(){const t=owner.prepareClose();owner.acknowledge(t,true);return owner.close(t,'CLOSE_OWNED_STAGED_RESOURCES');},retryCleanup(){return owner.retryCleanup('RETRY_FAILED_OWNED_RESOURCES');},
 };
 session=new ComponentSession({...loaders,bootstrap});if(setupFailed)session.invalidate();
 return Object.freeze({session,root,raw:()=>raw.value,inspect(){return{...session!.inspect(),setup_failed:setupFailed,root_connected:root.isConnected,frame_connected:frame.isConnected,entire_frame_retired:false,raw_snapshot_frozen:false,source_save_state_written:false};}});
}
