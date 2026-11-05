import {escapeHtml as h} from './format.js';

interface ReturnPoint {x:number;y:number;data:Record<string,string|undefined>;}
interface Placement {
 dialog:HTMLDialogElement;host:HTMLElement;panel:HTMLDetailsElement;
 parent:Node;next:ChildNode|null;marker:HTMLElement;
}
interface OverflowLease {style:CSSStyleDeclaration;axes:{name:string;value:string;priority:string}[];}
function visibleControl(element:HTMLElement,dialog:HTMLDialogElement):boolean{
 if(element.tabIndex<0||element.getClientRects().length===0||element.closest('[hidden],[inert]'))return false;
 const visibility=getComputedStyle(element).visibility;if(visibility==='hidden'||visibility==='collapse')return false;
 for(let parent=element.parentElement;parent&&parent!==dialog;parent=parent.parentElement){
  if(parent.tagName!=='DETAILS'||(parent as HTMLDetailsElement).open)continue;
  const summary=[...parent.children].find(child=>child.tagName==='SUMMARY');
  if(!summary?.contains(element))return false;
 }
 return true;
}
/** One original form tree, temporarily hosted in a native modal. No business state is copied. */
export class MobileSettingsController {
 private active=false;
 private project:object|null=null;
 private point:ReturnPoint|null=null;
 private prepared:ReturnPoint|null=null;
 private scroll=0;
 private placement:Placement|null=null;
 private overflow:OverflowLease|null=null;
 private closing=false;
 private retireOnRender=false;
 private notice='';
 private resetToStart=false;
 private bound=new WeakSet<HTMLDialogElement>();
 onReturn:()=>void=()=>this.dismiss();
 get isOpen():boolean{return this.active;}
 isSameProject(project:object):boolean{return this.project===project;}
 isSmall():boolean{return typeof matchMedia==='function'&&matchMedia('(max-width: 700px)').matches;}
 remember(trigger:HTMLElement):void{if(!this.active&&this.isSmall())this.prepared={x:window.scrollX,y:window.scrollY,data:{...trigger.dataset}};}
 beforeRender(project:object):boolean{
  const replaced=this.project!==project&&this.active;
  // Make a detached, owned form visible to the renderer's File-node transfer.
  if(this.active&&this.placement&&!this.placement.panel.isConnected)this.dismiss(false);
  if(this.project!==project){
   if(this.active)this.dismiss(false);
   // Retire an uncloseable old modal only after a completed project render
   // actually disconnects its old tree.
   this.retireOnRender=this.active;this.point=null;this.prepared=null;
   this.project=project;this.resetToStart=replaced;
  }
  if(this.active&&this.placement)this.scroll=this.placement.host.scrollTop;
  return replaced;
 }
 render(saveState:string,status:string):string{
  const feedback=`<p data-mobile-settings-feedback role="status"${this.notice?'':' hidden'}>${h(this.notice)}</p>`;
  return `${feedback}<dialog id="mobile-settings-dialog" aria-labelledby="mobile-settings-title"><header class="mobile-settings-header"><button type="button" data-action="close-mobile-settings">← 返回测算</button><h2 id="mobile-settings-title">高级设置</h2><div class="mobile-settings-files"><button type="button" data-action="open">打开项目</button><button type="button" data-action="save">保存项目</button></div><p class="mobile-settings-save-state">${h(saveState)}</p><p class="mobile-settings-status" role="status">${h(status)}</p>${feedback}</header><div data-mobile-settings-host></div></dialog>`;
 }
 afterRender():void{
  const dialog=document.querySelector<HTMLDialogElement>('#mobile-settings-dialog');
  if(this.closing){
   // Native close can synchronously blur an edited field and complete a redraw.
   // Keep the new form closed and retire only a tree actually replaced by it.
   if(this.placement&&dialog?.isConnected&&dialog!==this.placement.dialog&&!this.placement.dialog.isConnected&&document.querySelector('[data-evidence-section="advanced-settings"]')?.isConnected)this.placement=null;
   return;
  }
  if(this.retireOnRender&&this.placement&&!this.placement.dialog.isConnected){this.finish(false);this.retireOnRender=false;}
  if(!dialog){if(this.active)this.dismiss(false);return;}
  if(!this.bound.has(dialog)){
   this.bound.add(dialog);
   dialog.addEventListener('cancel',event=>{event.preventDefault();this.onReturn();});
   dialog.addEventListener('close',()=>{if(!this.closing&&this.placement?.dialog===dialog&&this.active&&!dialog.open)this.dismiss();});
   dialog.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const controls=[...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),summary,a[href]')].filter(el=>visibleControl(el,dialog));
    const first=controls[0],last=controls[controls.length-1];if(!first||!last)return;
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first.focus();}
   });
  }
  if(this.active){if(!this.isSmall()){this.dismiss(false);return;}this.mount(dialog);}
  if(this.resetToStart&&!this.active){this.resetToStart=false;window.scrollTo({left:0,top:0,behavior:'instant'});}
 }
 open(trigger:HTMLElement):boolean{
  const dialog=document.querySelector<HTMLDialogElement>('#mobile-settings-dialog');
  const panel=document.querySelector<HTMLDetailsElement>('[data-evidence-section="advanced-settings"]'),host=dialog?.querySelector<HTMLElement>('[data-mobile-settings-host]');
  if(!this.isSmall()){this.prepared=null;return false;}
  if(!dialog?.isConnected||!host?.isConnected||!panel?.isConnected||typeof dialog.showModal!=='function'){
   if(this.active)this.dismiss(false);
   this.prepared=null;if(panel&&!panel.closest('dialog'))panel.open=true;
   this.feedback(this.active?'弹窗暂时无法返回，输入已保留；请重试返回。':'高级设置暂时无法弹出，原表单已保留在页面；可稍后重试打开。');
   return this.active&&this.placement?.dialog.open===true;
  }
  if(!this.active){this.point=this.prepared??{x:window.scrollX,y:window.scrollY,data:{...trigger.dataset}};this.prepared=null;this.scroll=0;this.active=true;}
  this.afterRender();return this.active&&this.placement?.dialog===dialog&&dialog.open;
 }
 route(target:HTMLElement|null,trigger:HTMLElement):void{
  if(target?.closest('[data-evidence-section="advanced-settings"]'))this.open(trigger);
  else if(this.active)this.dismiss(false);
 }
 private mount(dialog:HTMLDialogElement):void{
  const panel=document.querySelector<HTMLDetailsElement>('[data-evidence-section="advanced-settings"]'),host=dialog.querySelector<HTMLElement>('[data-mobile-settings-host]');
  if(!panel?.isConnected||!host?.isConnected||!dialog.isConnected){this.dismiss(false);this.feedback('高级设置暂时不可用，表单已保留；请返回页面后重试。');return;}
  if(this.placement&&this.placement.dialog!==dialog){
   if(this.placement.dialog.isConnected){this.dismiss(false);return;}
   // The renderer transfers selected File nodes; never resurrect an old tree.
   this.placement=null;
  }
  if(this.placement&&(this.placement.panel!==panel||this.placement.host!==host||panel.parentElement!==host)){
   this.dismiss(false);this.feedback('高级设置未能保持打开，原输入已保留；请重试打开。');return;
  }
  try{
   if(!this.placement){
    const parent=panel.parentNode;if(!parent||panel.closest('dialog'))throw Error('Unowned modal form');
    const marker=document.createElement('div');marker.dataset.mobileSettingsPlaceholder='';
    this.placement={dialog,host,panel,parent,next:panel.nextSibling,marker};panel.before(marker);host.append(panel);
   }
   panel.open=true;this.lockOverflow();if(!dialog.open)dialog.showModal();
   if(!dialog.open)throw Error('Native modal did not open');
   host.scrollTop=this.scroll;this.feedback('');
  }catch{
   this.dismiss(false);this.feedback(this.active?'弹窗暂时无法返回，输入仍保留在弹窗中；请重试返回。':'高级设置未能弹出，原表单已返回页面；请重试打开。');
  }
 }
 private lockOverflow():void{
  if(this.overflow)return;const style=document.body.style;
  this.overflow={style,axes:['overflow-x','overflow-y'].map(name=>({name,value:style.getPropertyValue(name),priority:style.getPropertyPriority(name)}))};style.setProperty('overflow','hidden');
 }
 private releaseOverflow():void{
  const lease=this.overflow;if(!lease)return;
  for(const axis of lease.axes){
   if(lease.style.getPropertyValue(axis.name)!=='hidden'||lease.style.getPropertyPriority(axis.name)!=='')continue;
   if(axis.value)lease.style.setProperty(axis.name,axis.value,axis.priority);else lease.style.removeProperty(axis.name);
  }
  this.overflow=null;
 }
 private restorePanel(placement:Placement):void{
  const{panel,parent,next,marker,dialog}=placement;
  if(parent.isConnected){if(marker.parentNode===parent)marker.replaceWith(panel);else parent.insertBefore(panel,next?.parentNode===parent?next:null);}
  else if(dialog.parentNode?.isConnected)dialog.before(panel);
  else document.body.append(panel);
  // Do not remove a marker moved into an externally changed layout.
 }
 private feedback(message:string):void{
  this.notice=message;for(const node of document.querySelectorAll<HTMLElement>('[data-mobile-settings-feedback]')){node.textContent=message;node.hidden=!message;}
 }
 private finish(restore:boolean):void{
  const point=this.point;this.releaseOverflow();this.active=false;this.placement=null;this.point=null;this.prepared=null;this.scroll=0;this.retireOnRender=false;this.feedback('');
  if(this.resetToStart){this.resetToStart=false;window.scrollTo({left:0,top:0,behavior:'instant'});}
  else if(restore&&point){const entries=Object.entries(point.data),trigger=[...document.querySelectorAll<HTMLElement>('[data-action]')].find(el=>entries.every(([key,value])=>el.dataset[key]===value));trigger?.focus({preventScroll:true});window.scrollTo({left:point.x,top:point.y,behavior:'instant'});}
 }
 dismiss(restore=true):void{
  if(this.closing)return;
  if(!this.active){this.prepared=null;return;}
  const placement=this.placement;
  if(placement?.dialog.isConnected&&placement.dialog.open){
   // Reconnect only the known, detached host. A failed native close must not
   // leave its File nodes outside the renderer's ownership scan.
   if(!placement.host.parentNode&&placement.host.contains(placement.panel)){
    try{placement.dialog.append(placement.host);}catch{this.feedback('表单暂时无法返回，输入仍保留；请重试返回。');return;}
   }
   this.closing=true;try{placement.dialog.close();}catch{/* Native state determines whether retirement is safe. */}finally{this.closing=false;}
   if(placement.dialog.isConnected&&placement.dialog.open){this.feedback('弹窗暂时无法关闭，输入已保留；请重试返回。');return;}
  }
  if(placement&&this.placement===placement){try{this.restorePanel(placement);}catch{this.feedback('表单暂时未能返回页面，输入仍保留；请重试返回。');return;}}
  this.finish(restore);
 }
 resize():void{
  if(!this.active||this.isSmall())return;
  const focused=document.activeElement instanceof HTMLElement?document.activeElement:null;
  this.dismiss(false);if(!this.active)focused?.focus({preventScroll:true});
 }
}
