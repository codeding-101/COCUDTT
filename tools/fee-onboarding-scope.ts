/** Trusted diagnostic document only; same-origin frames are not a script security boundary. */
import{IsolatedResourceOwner,type ResourceOwnerLimits,type ResourceCloseChoice}from'./fee-resource-owner';
import{FieldHelpEventPort}from'./fee-field-help-port';
import{OnboardingPreferencePort,type OnboardingPreference}from'./fee-onboarding-preference';
import{onboardingScopePrefix}from'./fee-onboarding-source';
interface Controller{readonly isOpen:boolean;entry():string;render():string;afterRender():void;start(automatic:boolean):boolean;open(trigger?:HTMLElement):boolean;setHidden(value:boolean):void;move(direction:'next'|'back'):boolean;dismiss(restore?:boolean,persist?:boolean):void;}
interface Component{OnboardingController:new()=>Controller;}
const ports=new WeakMap<HTMLDialogElement,{events:FieldHelpEventPort;preference:OnboardingPreferencePort}>(),mounted=new WeakSet<Document>();
export function registerOnboardingListener<K extends 'cancel'|'close'|'keydown'>(target:HTMLDialogElement,type:K,listener:(event:HTMLElementEventMap[K])=>void){const cap=ports.get(target);if(!cap||!['cancel','close','keydown'].includes(type))throw Error('ONBOARDING_SCOPE_UNISSUED_TARGET');return cap.events.listen(type,listener as EventListener);}
export function readOnboardingPreference(target:HTMLDialogElement|null){const cap=target&&ports.get(target);if(!cap)throw Error('ONBOARDING_SCOPE_UNISSUED_PREFERENCE');return cap.preference.read();}
export function writeOnboardingPreference(target:HTMLDialogElement|null,value:'hidden'|'show'){const cap=target&&ports.get(target);if(!cap)throw Error('ONBOARDING_SCOPE_UNISSUED_PREFERENCE');cap.preference.write(value);}
export function createFrameOnboardingScope(component:Component,prefix:string,initial:OnboardingPreference=null,limits:Partial<ResourceOwnerLimits>={}){
 onboardingScopePrefix(prefix);const doc=document,view=doc.defaultView as(Window&typeof globalThis)|null,frame=view?.frameElement as HTMLIFrameElement|null;
 if(!view||view.parent===view||!frame||frame.tagName!=='IFRAME'||frame.dataset.onboardingFrame!==prefix||doc.querySelector('#app'))throw Error('ONBOARDING_SCOPE_FRAME_REQUIRED');
 if(frame.ownerDocument.querySelectorAll('iframe[data-onboarding-frame="'+prefix+'"]').length!==1||mounted.has(doc))throw Error('ONBOARDING_SCOPE_DUPLICATE');
 if(initial!==null&&initial!=='hidden'&&initial!=='show')throw Error('ONBOARDING_SCOPE_INITIAL');
 const owner=new IsolatedResourceOwner(limits);mounted.add(doc);const root=doc.createElement('main'),controller=new component.OnboardingController();root.dataset.onboardingScope=prefix;
 root.innerHTML='<h1>使用引导 · 独立副本</h1><p>偏好仅保留于本次诊断会话，不读写原页面的浏览器偏好。关闭不代表已保存。</p><label>未提交原文<input data-guide-raw aria-label="引导副本未提交原文"></label>'+controller.entry()+controller.render();doc.body.append(root);
 const dialog=root.querySelector<HTMLDialogElement>('#'+prefix+'-dialog'),raw=root.querySelector<HTMLInputElement>('[data-guide-raw]')!;if(!dialog)throw Error('ONBOARDING_SCOPE_RENDER');
 let ready=false,setupFailed=false,invalidated=false,observer:MutationObserver|null=null,observerActive=false,failRemoval=false,removalFailures=0;
 function invalidate(){if(!invalidated){invalidated=true;if(owner.isOpen())owner.cancelClose();}}
 function drain(){if(observer?.takeRecords().length)invalidate();}
 function currentDOM(){drain();if(invalidated)return false;try{if(!root.isConnected||frame!.contentDocument!==doc||doc.getElementById(prefix+'-dialog')!==dialog||dialog!.parentElement!==root||dialog!.getAttribute('aria-labelledby')!==prefix+'-title'||!dialog!.querySelector('#'+prefix+'-title')||frame!.dataset.onboardingFrame!==prefix||frame!.ownerDocument.querySelectorAll('iframe[data-onboarding-frame="'+prefix+'"]').length!==1){invalidate();return false;}return true;}catch{invalidate();return false;}}
 function usable(){if(!owner.isOpen())throw Error('ONBOARDING_SCOPE_NOT_OPEN');if(!ready)throw Error('ONBOARDING_SCOPE_NOT_READY');if(!currentDOM())throw Error('ONBOARDING_SCOPE_ROOT_CHANGED');}
 const canRun=()=>ready&&currentDOM(),preference=new OnboardingPreferencePort(initial,()=>owner.isOpen()&&canRun()),rootPort=new FieldHelpEventPort(owner,root,{canRun}),dialogPort=new FieldHelpEventPort(owner,dialog,{canRun,beforeRemove:type=>{if(failRemoval&&type==='cancel'){failRemoval=false;removalFailures++;throw Error('ONBOARDING_SCOPE_SYNTHETIC_REMOVE_FAILURE');}}});ports.set(dialog,{events:dialogPort,preference});
 function refreshStatus(){const template=doc.createElement('template');template.innerHTML=controller.entry();const selector='[data-'+prefix+'-status]',next=template.content.querySelector(selector),current=root.querySelector(selector);if(next&&current)current.textContent=next.textContent;}
 function open(){usable();const opened=controller.open(root.querySelector<HTMLElement>('[data-action="show-onboarding"]')!);refreshStatus();return opened;}
 function move(direction:'next'|'back'){usable();if(direction!=='next'&&direction!=='back')throw Error('ONBOARDING_SCOPE_DIRECTION');return controller.move(direction);}
 try{
  owner.own('DIALOG',()=>{const parent=frame!.ownerDocument,previous=parent.activeElement as HTMLElement|null;controller.dismiss(false,false);if(dialog.open)dialog.close();if(previous&&previous!==frame&&previous.isConnected&&parent.activeElement!==previous)previous.focus({preventScroll:true});});
  owner.own('OTHER',()=>preference.seal());
  rootPort.listen('click',event=>{if(!(event.target instanceof view!.Element))return;const button=event.target.closest<HTMLButtonElement>('button[data-action]');if(!button||!root.contains(button))return;switch(button.dataset.action){case'show-onboarding':open();break;case'close-onboarding':controller.dismiss();break;case'onboarding-next':move('next');break;case'onboarding-back':move('back');break;}});
  rootPort.listen('change',event=>{if(event.target instanceof view!.HTMLInputElement&&event.target.matches('[data-onboarding-field="hide"]')&&root.contains(event.target))controller.setHidden(event.target.checked);});
  controller.afterRender();observer=new view.MutationObserver(()=>{if(observerActive&&owner.isOpen())invalidate();});owner.own('OTHER',()=>{observerActive=false;observer!.disconnect();});observer.observe(root,{childList:true});observer.observe(dialog,{attributes:true,attributeFilter:['id','aria-labelledby']});observer.observe(frame,{attributes:true,attributeFilter:['src','id','data-onboarding-frame']});observerActive=true;ready=true;
 }catch{setupFailed=true;ready=false;observerActive=false;observer?.disconnect();}
 return Object.freeze({root,dialog,owner,prefix,open,move,
  start(automatic:boolean){usable();if(typeof automatic!=='boolean')throw Error('ONBOARDING_SCOPE_AUTOMATIC');const opened=controller.start(automatic);refreshStatus();return opened;},
  dismiss(){usable();controller.dismiss();},rebind(){usable();controller.afterRender();},raw:()=>raw.value,
  failNextRemoval(){usable();failRemoval=true;},failNextPreferenceRead(){usable();preference.failNextRead();},failNextPreferenceWrite(){usable();preference.failNextWrite();},
  prepareClose():ResourceCloseChoice{drain();return owner.prepareClose();},acknowledge(t:ResourceCloseChoice,checked:boolean){drain();owner.acknowledge(t,checked);},cancelClose(){owner.cancelClose();},close(t:ResourceCloseChoice){drain();return owner.close(t,'CLOSE_OWNED_STAGED_RESOURCES');},retryCleanup(){return owner.retryCleanup('RETRY_FAILED_OWNED_RESOURCES');},
  inspect(){drain();return{prefix,ready,usable:ready&&owner.isOpen()&&!invalidated,setup_failed:setupFailed,invalidated,observer_active:observerActive,removal_failures:removalFailures,root_connected:root.isConnected,frame_connected:frame.isConnected,dialog_open:dialog.open,controller_open:controller.isOpen,raw:raw.value,preference:preference.inspect(),listeners:{root:rootPort.inspect(),dialog:dialogPort.inspect()},owner:owner.snapshot(),browser_preference_persisted:false,production_integrated:false,financial_writes:0,source_save_state_written:false,frame_removed:false,all_frame_resources_owned:false,adversarial_script_isolation:false};},
 });
}
