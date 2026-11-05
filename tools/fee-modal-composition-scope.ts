/** Same-origin diagnostic copies. These ports grant no save, fee-write or workbench installation authority. */
import{IsolatedResourceOwner,type ResourceCloseChoice}from'./fee-resource-owner';
import{FieldHelpEventPort}from'./fee-field-help-port';
import{OnboardingPreferencePort}from'./fee-onboarding-preference';
import{ComponentStorageGuard}from'./fee-component-session-dom';
import{ComponentSession,type SessionCloseOrder,type SessionBootstrap}from'./fee-component-session';
import{ModalScrollLocks,ModalScrollError,type ModalScrollLease}from'./fee-modal-composition-locks';
import{modalCompositionPrefix,type ModalRole}from'./fee-modal-composition-source';

interface Controller{render(...args:string[]):string;afterRender():void;dismiss(restore?:boolean,persist?:boolean):void;readonly isOpen?:boolean;}
interface Mobile extends Controller{beforeRender(project:object):boolean;open(trigger:HTMLElement):boolean;}
interface Field extends Controller{open(topic:string,anchor:string):boolean;}
interface Guide extends Controller{entry():string;start(automatic:boolean):boolean;open(trigger?:HTMLElement):boolean;move(direction:'next'|'back'):boolean;setHidden(hidden:boolean):void;}
type Module=Record<string,unknown>;
interface Entry{role:ModalRole;prefix:string;root:HTMLElement;owner:IsolatedResourceOwner;controller:Controller|null;lease:ModalScrollLease|null;dialogs:Set<HTMLDialogElement>;ports:FieldHelpEventPort[];portByTarget:WeakMap<EventTarget,FieldHelpEventPort>;current:HTMLDialogElement|null;preference:OnboardingPreferencePort;failedRemoval:boolean;removalFailures:number;setupFailed:boolean;nativeError:string|null;}
interface OpenModal{entry:Entry;dialog:HTMLDialogElement;returnTo:HTMLElement|null;}
interface Environment{doc:Document;view:Window&typeof globalThis;stage:HTMLElement;locks:ModalScrollLocks;entries:Map<ModalRole,Entry>;stack:OpenModal[];pendingScroll:ScrollToOptions|null;changed:()=>void;usable:()=>boolean;}
const environments=new Map<string,Environment>(),mounted=new WeakSet<Document>();
const registry=(prefix:string,role:ModalRole)=>{const env=environments.get(prefix),entry=env?.entries.get(role);if(!env||!entry)throw Error('MODAL_COMPOSITION_UNISSUED_PORT');return{env,entry};};
function top(env:Environment){env.stack=env.stack.filter(s=>s.dialog.isConnected&&s.dialog.open);return env.stack.at(-1);}
function repair(env:Environment,returnTo:HTMLElement|null=null){
 const active=env.doc.activeElement as HTMLElement|null,foreign=active?.closest('dialog[open]');
 if(foreign&&!env.stack.some(s=>s.dialog===foreign))return;
 const current=top(env);if(current){if(active&&current.dialog.contains(active))return;const target=returnTo&&current.dialog.contains(returnTo)&&returnTo.getClientRects().length?returnTo:[...current.dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),summary,[tabindex="-1"]')].find(e=>e.getClientRects().length>0&&!e.closest('[hidden],[inert]'));target?.focus({preventScroll:true});}
 else{if(returnTo?.isConnected&&env.stage.contains(returnTo)&&returnTo.getClientRects().length)returnTo.focus({preventScroll:true});if(env.pendingScroll){const scroll=env.pendingScroll;env.pendingScroll=null;env.view.scrollTo(scroll);}}
}
function unlock(env:Environment,e:Entry,lease:ModalScrollLease){const released=env.locks.release(e,lease);if(e.lease===lease)e.lease=null;return released;}
function lock(env:Environment,e:Entry){if(e.lease){if(env.locks.inspect().needs_cleanup)throw new ModalScrollError('NEEDS_CLEANUP',e.lease);return e.lease;}try{e.lease=env.locks.acquire(e);return e.lease;}catch(error){if(error instanceof ModalScrollError&&error.lease)e.lease=error.lease;e.nativeError=String(error).slice(0,512);throw error;}}
function closed(env:Environment,e:Entry,dialog:HTMLDialogElement){
 if(dialog.isConnected&&dialog.open)return;
 const record=env.stack.find(s=>s.dialog===dialog);env.stack=env.stack.filter(s=>s.dialog!==dialog);
 if(e.current===dialog){e.current=null;if(e.lease)unlock(env,e,e.lease);}
 repair(env,record?.returnTo??null);env.changed();
}
export function modalCompositionPort(prefix:string,role:ModalRole){
 modalCompositionPrefix(prefix);if(!['mobile','field','guide'].includes(role))throw Error('MODAL_COMPOSITION_ROLE');
 return Object.freeze({
  get document(){const{env,entry:e}=registry(prefix,role);return{createElement(tag:string){if(tag!=='div')throw Error('MODAL_COMPOSITION_NODE_KIND');return env.doc.createElement('div');},querySelector:<T extends Element=Element>(selector:string)=>e.root.querySelector<T>(selector),querySelectorAll:<T extends Element=Element>(selector:string)=>e.root.querySelectorAll<T>(selector),get activeElement(){return e.root.contains(env.doc.activeElement)?env.doc.activeElement:null;},body:e.root};},
  get window(){const{env}=registry(prefix,role);return{get scrollX(){return env.view.scrollX;},get scrollY(){return env.view.scrollY;},scrollTo(options:ScrollToOptions){if(top(env))env.pendingScroll=options;else env.view.scrollTo(options);}};},
  matchMedia(query:string){return registry(prefix,role).env.view.matchMedia(query);},
  lockScroll(){const{env,entry}=registry(prefix,role);return lock(env,entry);},
  unlockScroll(lease:ModalScrollLease){const{env,entry}=registry(prefix,role);return unlock(env,entry,lease);},
  showModal(dialog:HTMLDialogElement){
   const{env,entry:e}=registry(prefix,role);if(!env.usable()||!e.owner.isOpen()||!e.root.contains(dialog))throw Error('MODAL_COMPOSITION_DIALOG_SCOPE');if(env.locks.inspect().needs_cleanup)throw new ModalScrollError('NEEDS_CLEANUP');
   const active=env.doc.activeElement,returnTo=active instanceof env.view.HTMLElement&&env.stage.contains(active)?active:null;
   try{dialog.showModal();}catch(error){e.nativeError=String(error).slice(0,512);throw error;}finally{if(dialog.isConnected&&dialog.open){e.dialogs.add(dialog);e.current=dialog;lock(env,e);env.stack=env.stack.filter(s=>s.dialog!==dialog);env.stack.push({entry:e,dialog,returnTo});env.changed();}}
  },
  closeModal(dialog:HTMLDialogElement){const{env,entry:e}=registry(prefix,role);if(!e.dialogs.has(dialog))throw Error('MODAL_COMPOSITION_UNOWNED_DIALOG');try{dialog.close();}finally{closed(env,e,dialog);}},
  listen<K extends keyof HTMLElementEventMap>(dialog:HTMLDialogElement,type:K,listener:(event:HTMLElementEventMap[K])=>void){
   const{env,entry:e}=registry(prefix,role);if(!e.root.contains(dialog)||!['cancel','close','keydown'].includes(type))throw Error('MODAL_COMPOSITION_LISTENER_SCOPE');e.dialogs.add(dialog);
   let port=e.portByTarget.get(dialog);if(!port){port=new FieldHelpEventPort(e.owner,dialog,{canRun:()=>env.usable(),beforeRemove:event=>{if(e.failedRemoval&&event==='keydown'){e.failedRemoval=false;e.removalFailures++;throw Error('MODAL_COMPOSITION_REMOVE_FAILURE');}}});e.portByTarget.set(dialog,port);e.ports.push(port);}
   return port.listen(type,event=>{if(type==='keydown'&&top(env)?.dialog!==dialog)return;try{if(type==='close')closed(env,e,dialog);listener(event as HTMLElementEventMap[K]);}finally{repair(env);}});
  },
  readPreference(){return registry(prefix,role).entry.preference.read();},writePreference(value:'hidden'|'show'){return registry(prefix,role).entry.preference.write(value);},
 });
}
export interface ModalCompositionLoaders{loadField():Promise<unknown>;loadGuide():Promise<unknown>;guideReady?():Promise<void>;businessPanel?():string;}
export function createFrameModalComposition(prefix:string,mobileModule:unknown,loaders:ModalCompositionLoaders){
 modalCompositionPrefix(prefix);const doc=document,view=doc.defaultView as(Window&typeof globalThis)|null,frame=view?.frameElement as HTMLIFrameElement|null;
 if(!view||view.parent===view||!frame||frame.tagName!=='IFRAME'||frame.dataset.modalComposition!==prefix||frame.ownerDocument.querySelectorAll('iframe[data-modal-composition="'+prefix+'"]').length!==1||doc.querySelector('#app')||mounted.has(doc)||environments.has(prefix))throw Error('MODAL_COMPOSITION_FRAME_REQUIRED');
 if(!loaders||typeof loaders.loadField!=='function'||typeof loaders.loadGuide!=='function'||loaders.guideReady!==undefined&&typeof loaders.guideReady!=='function')throw Error('MODAL_COMPOSITION_LOADERS');
 if(loaders.businessPanel!==undefined&&typeof loaders.businessPanel!=='function')throw Error('MODAL_COMPOSITION_SURFACE');
 let session:ComponentSession|null=null,revision=0,invalidated=false,actionsEnabled=true,observer:MutationObserver|null=null,project:object={},retired:HTMLDetailsElement|null=null;
 const changed=()=>{revision=Math.min(Number.MAX_SAFE_INTEGER,revision+1);session?.touch();},invalidate=()=>{invalidated=true;changed();session?.invalidate();},stage=doc.createElement('main');stage.dataset.modalComposition=prefix;
 stage.innerHTML='<h1>移动设置、字段说明与引导 · 组合副本</h1><p>仅核对本副本的输入、弹窗和资源。原文与文件留在本机，不授予保存、费用写入或工作台切换权限。</p>';
 doc.body.append(stage);mounted.add(doc);
 const env:Environment={doc,view,stage,locks:new ModalScrollLocks(doc.body.style),entries:new Map(),stack:[],pendingScroll:null,changed,usable:()=>actionsEnabled&&!invalidated&&stage.isConnected&&frame.isConnected&&frame.contentDocument===doc};environments.set(prefix,env);
 const fileIds=new WeakMap<File,number>();let nextFile=0;
 const fileState=(input:HTMLInputElement)=>[...(input.files??[])].map(f=>{if(!fileIds.has(f))fileIds.set(f,++nextFile);return[fileIds.get(f),f.name,f.size,f.type];});
 const rawState=(root:HTMLElement)=>JSON.stringify([...root.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('input,textarea,select')].map(e=>[e.tagName,e.getAttribute('data-raw')??e.getAttribute('data-file')??e.getAttribute('data-onboarding-field'),e.value,e instanceof view.HTMLInputElement&&e.type==='file'?fileState(e):e instanceof view.HTMLInputElement?e.checked:null]));
 function requireUsable(){if(!env.usable())throw Error('MODAL_COMPOSITION_CHANGED');}
 function createPart(role:ModalRole,value:unknown){
  requireUsable();if(env.entries.has(role))throw Error('MODAL_COMPOSITION_ALREADY_CREATED');const exports=value as Module,name=role==='mobile'?'MobileSettingsController':role==='field'?'FieldHelpController':'OnboardingController';if(!exports||typeof exports[name]!=='function')throw Error('MODAL_COMPOSITION_MODULE');
  const root=doc.createElement('section');root.dataset.modalRole=role;stage.append(root);const owner=new IsolatedResourceOwner(),preference=new OnboardingPreferencePort(null,()=>env.usable()&&owner.isOpen());
  const e:Entry={role,prefix,root,owner,controller:null,lease:null,dialogs:new Set(),ports:[],portByTarget:new WeakMap(),current:null,preference,failedRemoval:false,removalFailures:0,setupFailed:false,nativeError:null};env.entries.set(role,e);
  const controller=new(exports[name] as new()=>Controller)();e.controller=controller;
  const mobilePanel=()=>loaders.businessPanel?.()??'<details data-evidence-section="advanced-settings"><summary>高级设置副本</summary><label>未提交原文<input data-raw="mobile" aria-label="移动副本原文"></label><label>未读取的本地文件<input type="file" data-file="mobile" aria-label="移动副本文件"></label><button type="button" data-child-open="field">打开字段说明</button><button type="button" data-child-open="guide">打开使用引导</button></details>';
  if(role==='mobile')root.innerHTML='<button type="button" data-action="open-mobile-settings">打开高级设置</button>'+mobilePanel()+controller.render('尚未保存','仅为组合副本');
  else if(role==='field')root.innerHTML=(loaders.businessPanel?'<p>业务字段说明</p>':'<label>字段副本原文<input data-raw="field" aria-label="字段副本原文"></label><button type="button" data-action="show-field-help" data-help-anchor="value-anchor">货值字段说明</button>')+controller.render();
  else root.innerHTML=(loaders.businessPanel?'<p>本地业务副本使用引导</p>':'<label>引导副本原文<input data-raw="guide" aria-label="引导副本原文"></label>')+(controller as Guide).entry()+controller.render();
  for(const button of root.querySelectorAll<HTMLButtonElement>('[data-action="open"],[data-action="save"]')){button.disabled=true;button.title='本副本仅核对组件，不提供项目打开或保存。';}
  const rootPort=new FieldHelpEventPort(owner,root,{canRun:()=>env.usable()});e.ports.push(rootPort);
  owner.own('OTHER',()=>preference.seal());
  owner.own('DIALOG',()=>{
   controller.dismiss(false,false);
   for(const dialog of e.dialogs)if(dialog.isConnected&&dialog.open)try{modalCompositionPort(prefix,role).closeModal(dialog);}catch{}
   if([...e.dialogs].some(d=>d.isConnected&&d.open))throw Error('MODAL_COMPOSITION_DIALOG_STILL_OPEN');
   if(e.lease)unlock(env,e,e.lease);repair(env);
  });
  try{
   rootPort.listen('click',event=>{const element=event.target instanceof env.view.Element?event.target.closest<HTMLButtonElement>('button'):null;if(!element||!root.contains(element))return;const action=element.dataset.action;
    if(env.locks.inspect().needs_cleanup&&(['open-mobile-settings','show-field-help','show-onboarding'].includes(action??'')||element.dataset.childOpen)){e.nativeError='MODAL_SCROLL_NEEDS_CLEANUP';return;}
    if(action==='open-mobile-settings')(controller as Mobile).open(element);
    else if(action==='close-mobile-settings')controller.dismiss();
    else if(action==='show-field-help')(controller as Field).open('value','value-anchor');
    else if(action==='close-field-help'||action==='close-onboarding')controller.dismiss();
    else if(action==='show-onboarding')(controller as Guide).open(element);
    else if(action==='onboarding-next'||action==='onboarding-back')(controller as Guide).move(action==='onboarding-next'?'next':'back');
    else if(element.dataset.childOpen){const child=env.entries.get(element.dataset.childOpen as ModalRole);if(!child||!child.owner.isOpen())return;if(child.role==='field')(child.controller as Field).open('value','value-anchor');else(child.controller as Guide).open(element);}
   });
   if(role==='guide')rootPort.listen('change',event=>{const input=event.target;if(input instanceof env.view.HTMLInputElement&&input.dataset.onboardingField==='hide')(controller as Guide).setHidden(input.checked);});
   if(role==='mobile')(controller as Mobile).beforeRender(project);
   controller.afterRender();if(role==='guide')(controller as Guide).start(false);
  }catch{e.setupFailed=true;}
  return Object.freeze({
   root,controller,open(){requireUsable();if(!owner.isOpen())throw Error('MODAL_COMPOSITION_NOT_OPEN');const button=root.querySelector<HTMLElement>('button[data-action]')!;if(role==='mobile')return(controller as Mobile).open(button);if(role==='field')return(controller as Field).open('value','value-anchor');return(controller as Guide).open(button);},
   dismiss(){requireUsable();if(!owner.isOpen())throw Error('MODAL_COMPOSITION_NOT_OPEN');controller.dismiss();},
   prepareClose:()=>owner.prepareClose(),acknowledge:(t:ResourceCloseChoice,c:boolean)=>owner.acknowledge(t,c),close:(t:ResourceCloseChoice)=>owner.close(t,'CLOSE_OWNED_STAGED_RESOURCES'),retryCleanup:()=>owner.retryCleanup('RETRY_FAILED_OWNED_RESOURCES'),
   failNextRemoval(){e.failedRemoval=true;},
   inspect(){return{raw:rawState(root),root_connected:root.isConnected,frame_connected:frame!.isConnected&&frame!.contentDocument===doc,usable:env.usable()&&owner.isOpen()&&!e.setupFailed&&!env.locks.inspect().needs_cleanup,owner:owner.snapshot(),dialog_open:[...e.dialogs].some(d=>d.isConnected&&d.open),controller_open:controller.isOpen??null,setup_failed:e.setupFailed,removal_failures:e.removalFailures,native_errors:e.nativeError?[e.nativeError]:[],preference:preference.inspect(),listeners:e.ports.map(p=>p.inspect()),financial_writes:0,source_save_state_written:false};},
   renderMobile(replace:boolean){
    if(role!=='mobile'||!owner.isOpen())throw Error('MODAL_COMPOSITION_NOT_MOBILE');requireUsable();if(top(env)?.entry.role&&top(env)!.entry.role!=='mobile')throw Error('MODAL_COMPOSITION_CLOSE_UPPER_MODAL_FIRST');if(replace&&loaders.businessPanel)throw Error('MODAL_COMPOSITION_BUSINESS_REPLACE_FORBIDDEN');if(replace&&retired)throw Error('MODAL_COMPOSITION_RETIRED_INPUT_LIMIT');
    const oldPanel=root.querySelector<HTMLDetailsElement>('[data-evidence-section="advanced-settings"]')!;
    if(replace)project={};(controller as Mobile).beforeRender(project);
    root.innerHTML='<button type="button" data-action="open-mobile-settings">打开高级设置</button>'+mobilePanel()+controller.render('尚未保存','仅为组合副本');
    for(const button of root.querySelectorAll<HTMLButtonElement>('[data-action="open"],[data-action="save"]')){button.disabled=true;button.title='本副本仅核对组件，不提供项目打开或保存。';}
    if(!replace)root.querySelector('[data-evidence-section="advanced-settings"]')!.replaceWith(oldPanel);
    else{retired=oldPanel;const retained=doc.createElement('details');retained.dataset.retiredInputs='';retained.innerHTML='<summary>上一份副本原文与文件（未保存）</summary>';retained.append(oldPanel);stage.append(retained);}
    controller.afterRender();changed();
   },
  });
 }
 const mobile=createPart('mobile',mobileModule),guard=new ComponentStorageGuard(view,invalidate),bootstrapOwner=new IsolatedResourceOwner(),events=new FieldHelpEventPort(bootstrapOwner,stage,{canRun:()=>env.usable()}),pageEvents=new FieldHelpEventPort(bootstrapOwner,view),parts:{field:ReturnType<typeof createPart>|null;guide:ReturnType<typeof createPart>|null}={field:null,guide:null};
 const drain=()=>{if(observer?.takeRecords().length)changed();};
 let setupFailed=false;
 try{
  bootstrapOwner.own('OTHER',()=>guard.restore());guard.install();
  events.listen('input',changed);events.listen('change',changed);events.listen('click',changed);pageEvents.listen('pagehide',invalidate);
  observer=new view.MutationObserver(records=>{if(records.some(r=>r.target===frame))invalidate();else changed();});bootstrapOwner.own('OTHER',()=>observer!.disconnect());observer.observe(stage,{childList:true,subtree:true,attributes:true,attributeFilter:['id','open','aria-labelledby','aria-describedby']});observer.observe(frame,{attributes:true,attributeFilter:['src','id','data-modal-composition']});
 }catch{setupFailed=true;invalidated=true;}
 const bootstrap:SessionBootstrap={inspect(){drain();const o=bootstrapOwner.snapshot(),m=mobile.inspect(),g=guard.inspect(),phases=[o.phase,m.owner.phase],phase=phases.every(p=>p==='CLOSED')?'CLOSED':phases.includes('FAILED')?'FAILED':phases.includes('CLOSING')?'CLOSING':'OPEN';return{phase,resources:o.resources+m.owner.resources,failed_resources:o.failed_resources+m.owner.failed_resources,physical_tasks:o.physical_tasks+m.owner.physical_tasks,physical_cleanup:o.physical_cleanup+m.owner.physical_cleanup,root_connected:stage.isConnected,frame_connected:frame.isConnected&&frame.contentDocument===doc,descriptor_owned:g.owned,guard_restored:g.restored,storage_lookups:g.lookups,revision,raw:rawState(stage),invalidated};},
  async close(){if(mobile.inspect().owner.phase!=='CLOSED'){const t=mobile.prepareClose();mobile.acknowledge(t,true);await mobile.close(t);}if(mobile.inspect().owner.phase!=='CLOSED')throw Error('MODAL_COMPOSITION_MOBILE_CLEANUP');if(bootstrapOwner.isOpen()){const b=bootstrapOwner.prepareClose();bootstrapOwner.acknowledge(b,true);await bootstrapOwner.close(b,'CLOSE_OWNED_STAGED_RESOURCES');}},
  async retryCleanup(){if(mobile.inspect().owner.phase==='FAILED')await mobile.retryCleanup();if(mobile.inspect().owner.phase!=='CLOSED')throw Error('MODAL_COMPOSITION_MOBILE_CLEANUP');if(bootstrapOwner.snapshot().phase==='FAILED')await bootstrapOwner.retryCleanup('RETRY_FAILED_OWNED_RESOURCES');else if(bootstrapOwner.isOpen()){const t=bootstrapOwner.prepareClose();bootstrapOwner.acknowledge(t,true);await bootstrapOwner.close(t,'CLOSE_OWNED_STAGED_RESOURCES');}},
 };
 session=new ComponentSession({bootstrap,loadField:loaders.loadField,loadGuide:loaders.loadGuide,createField(module){return parts.field=createPart('field',module);},async createGuide(module){const p=parts.guide=createPart('guide',module);await loaders.guideReady?.();return p;}});if(setupFailed)session.invalidate();
 return Object.freeze({
  stage,mobile,parts,session,start:()=>session!.start(),whenSettled:()=>session!.whenSettled(),stopStartup(){session!.stopStartup();actionsEnabled=false;},
  prepareClose(order:SessionCloseOrder='GUIDE_FIRST'){drain();return session!.prepareClose(order);},acknowledge(t:Parameters<ComponentSession['acknowledge']>[0],checked:boolean){drain();session!.acknowledge(t,checked);},close(t:Parameters<ComponentSession['close']>[0]){const work=session!.close(t,'CLOSE_RETAINED_COMPONENT_RESOURCES');actionsEnabled=false;return work;},retryCleanup:()=>session!.retryCleanup('RETRY_COMPONENT_SESSION_CLEANUP'),
  readyReceipt(){drain();return session!.readyReceipt();},repaint:()=>mobile.renderMobile(false),replaceSyntheticProject(choice:'REPLACE_SYNTHETIC_FORM_RETAIN_OLD_INPUTS'){if(choice!=='REPLACE_SYNTHETIC_FORM_RETAIN_OLD_INPUTS')throw Error('MODAL_COMPOSITION_EXPLICIT_REPLACE');mobile.renderMobile(true);},
  inspect(){drain();return{phase:session!.inspect().phase,session:session!.inspect(),mobile:mobile.inspect(),field:parts.field?.inspect()??null,guide:parts.guide?.inspect()??null,scroll:env.locks.inspect(),stack:env.stack.filter(s=>s.dialog.isConnected&&s.dialog.open).map(s=>s.entry.role),raw:rawState(stage),retired_input_groups:retired?1:0,retired_file_choices:retired?[...retired.querySelectorAll<HTMLInputElement>('input[type=file]')].reduce((n,e)=>n+(e.files?.length??0),0):0,guard:guard.inspect(),setup_failed:setupFailed,root_connected:stage.isConnected,frame_connected:frame.isConnected,financial_writes:0,source_save_state_written:false,full_workbench_switch:false,production_integrated:false,all_frame_resources_owned:false,adversarial_script_isolation:false};},
 });
}
export type ModalComposition=ReturnType<typeof createFrameModalComposition>;
