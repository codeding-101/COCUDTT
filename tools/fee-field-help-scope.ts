/** Trusted same-origin diagnostic documents, not an adversarial-script sandbox. */
import{IsolatedResourceOwner,type ResourceOwnerLimits,type ResourceCloseChoice}from'./fee-resource-owner';
import{FieldHelpEventPort}from'./fee-field-help-port';
import{fieldHelpScopePrefix}from'./fee-field-help-source';
import type{FieldHelpTopic}from'../src/ui/field-help';

interface Controller{render():string;afterRender():void;open(topic:string|undefined,anchor:string|undefined):boolean;dismiss(restore?:boolean):void;}
interface Component{FieldHelpController:new()=>Controller;FIELD_HELP:Readonly<Record<string,unknown>>;fieldHelpButton(topic:FieldHelpTopic,anchor:string,label?:string):string;}
const componentPorts=new WeakMap<HTMLDialogElement,FieldHelpEventPort>();
const mountedDocuments=new WeakSet<Document>();

export function registerFieldHelpListener<K extends 'close'|'keydown'>(target:HTMLDialogElement,type:K,listener:(event:HTMLElementEventMap[K])=>void){
 const port=componentPorts.get(target);
 if(!port||!['close','keydown'].includes(type))throw Error('FIELD_HELP_SCOPE_UNISSUED_TARGET');
 return port.listen(type,listener as EventListener);
}

export function createFrameFieldHelpScope(component:Component,prefix:string,limits:Partial<ResourceOwnerLimits>={}){
 fieldHelpScopePrefix(prefix);
 const doc=document,view=doc.defaultView as(Window&typeof globalThis)|null,frame=view?.frameElement as HTMLIFrameElement|null;
 if(!view||view.parent===view||!frame||frame.tagName!=='IFRAME'||frame.dataset.fieldHelpFrame!==prefix||doc.querySelector('#app'))throw Error('FIELD_HELP_SCOPE_FRAME_REQUIRED');
 if(frame.ownerDocument.querySelectorAll('iframe[data-field-help-frame="'+prefix+'"]').length!==1)throw Error('FIELD_HELP_SCOPE_DUPLICATE_PREFIX');
 if(mountedDocuments.has(doc))throw Error('FIELD_HELP_SCOPE_ALREADY_MOUNTED');
 mountedDocuments.add(doc);
 const owner=new IsolatedResourceOwner(limits),root=doc.createElement('main');
 root.dataset.fieldHelpScope=prefix;
 const controller=new component.FieldHelpController(),anchor='value-anchor';
 root.innerHTML='<h1>字段说明 · 隔离副本</h1><p>关闭只停止本副本资源，未提交原文保留；不代表已保存。</p><label>副本未提交原文<input data-field-raw aria-label="副本未提交原文"></label><p>'+component.fieldHelpButton('value',anchor,'货值字段说明')+'</p>'+controller.render();
 doc.body.append(root);
 const raw=root.querySelector<HTMLInputElement>('[data-field-raw]')!,dialog=root.querySelector<HTMLDialogElement>('#'+prefix+'-dialog');
 if(!dialog)throw Error('FIELD_HELP_SCOPE_RENDER');
 let ready=false,setupFailed=false,invalidated=false,observer:MutationObserver|null=null,observerActive=false,failRemoval=false,removalFailures=0;
 function invalidate(){if(!invalidated){invalidated=true;if(owner.isOpen())owner.cancelClose();}}
 function drain(){if(observer?.takeRecords().length)invalidate();}
 function currentDOM(){
  drain();
  if(invalidated)return false;
  try{
   if(!root.isConnected||frame!.contentDocument!==doc||doc.getElementById(prefix+'-dialog')!==dialog||dialog!.parentElement!==root||frame!.dataset.fieldHelpFrame!==prefix||frame!.ownerDocument.querySelectorAll('iframe[data-field-help-frame="'+prefix+'"]').length!==1||dialog!.getAttribute('aria-labelledby')!==prefix+'-title'||dialog!.getAttribute('aria-describedby')!==prefix+'-content'){invalidate();return false;}
   return true;
  }catch{invalidate();return false;}
 }
 function usable(){if(!owner.isOpen())throw Error('FIELD_HELP_SCOPE_NOT_OPEN');if(!ready)throw Error('FIELD_HELP_SCOPE_NOT_READY');if(!currentDOM())throw Error('FIELD_HELP_SCOPE_ROOT_CHANGED');}
 const canRun=()=>ready&&currentDOM();
 const rootPort=new FieldHelpEventPort(owner,root,{canRun}),dialogPort=new FieldHelpEventPort(owner,dialog,{canRun,beforeRemove:type=>{if(failRemoval&&type==='keydown'){failRemoval=false;removalFailures++;throw Error('FIELD_HELP_SCOPE_SYNTHETIC_REMOVE_FAILURE');}}});
 componentPorts.set(dialog,dialogPort);
 function open(topic:string){
  usable();
  if(typeof topic!=='string'||!Object.hasOwn(component.FIELD_HELP,topic))return false;
  if(dialog!.open)controller.dismiss(false);
  return controller.open(topic,anchor);
 }
 function dismiss(){usable();controller.dismiss();}
 try{
  owner.own('DIALOG',()=>{
   const parentDoc=frame!.ownerDocument,previous=parentDoc.activeElement as HTMLElement|null;
   dialog.close();
   if(previous&&previous!==frame&&previous.isConnected&&parentDoc.activeElement!==previous)previous.focus({preventScroll:true});
  });
  rootPort.listen('click',event=>{
   if(!(event.target instanceof view!.Element))return;
   const button=event.target.closest<HTMLButtonElement>('button[data-action]');
   if(!button||!root.contains(button))return;
   if(button.dataset.action==='show-field-help'&&button.dataset.helpTopic)open(button.dataset.helpTopic);
   else if(button.dataset.action==='close-field-help')dismiss();
  });
  controller.afterRender();
  observer=new view.MutationObserver(()=>{if(observerActive&&owner.isOpen())invalidate();});
  owner.own('OTHER',()=>{observerActive=false;observer!.disconnect();});
  observer.observe(root,{childList:true});
  observer.observe(dialog,{attributes:true,attributeFilter:['id','aria-labelledby','aria-describedby']});
  observer.observe(frame,{attributes:true,attributeFilter:['src','id','data-field-help-frame']});
  observerActive=true;
  ready=true;
 }catch{setupFailed=true;ready=false;observerActive=false;observer?.disconnect();}
 return Object.freeze({
  root,dialog,owner,prefix,open,dismiss,
  rebind(){usable();controller.afterRender();},
  raw:()=>raw.value,
  failNextRemoval(){usable();failRemoval=true;},
  prepareClose():ResourceCloseChoice{drain();return owner.prepareClose();},
  acknowledge(token:ResourceCloseChoice,checked:boolean){drain();owner.acknowledge(token,checked);},
  cancelClose(){owner.cancelClose();},
  close(token:ResourceCloseChoice){drain();return owner.close(token,'CLOSE_OWNED_STAGED_RESOURCES');},
  retryCleanup(){return owner.retryCleanup('RETRY_FAILED_OWNED_RESOURCES');},
  inspect(){drain();return{prefix,ready,usable:ready&&owner.isOpen()&&!invalidated,setup_failed:setupFailed,invalidated,observer_active:observerActive,removal_failures:removalFailures,root_connected:root.isConnected,frame_connected:frame.isConnected,dialog_open:dialog.open,raw:raw.value,dialog_id:dialog.id,title_id:dialog.getAttribute('aria-labelledby'),content_id:dialog.getAttribute('aria-describedby'),listeners:{root:rootPort.inspect(),dialog:dialogPort.inspect()},owner:owner.snapshot(),production_integrated:false,financial_writes:0,source_save_state_written:false,frame_removed:false,all_frame_resources_owned:false,adversarial_script_isolation:false};},
 });
}
