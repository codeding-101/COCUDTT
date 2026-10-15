import {escapeHtml as h} from './format.js';

interface ReturnPoint {x:number;y:number;data:Record<string,string|undefined>;}
/** One original form tree, temporarily hosted in a native modal. No business state is copied. */
export class MobileSettingsController {
 private active=false;
 private project:object|null=null;
 private point:ReturnPoint|null=null;
 private prepared:ReturnPoint|null=null;
 private scroll=0;
 private overflow='';
 private resetToStart=false;
 private bound=new WeakSet<HTMLDialogElement>();
 onReturn:()=>void=()=>this.dismiss();
 get isOpen():boolean{return this.active;}
 isSmall():boolean{return typeof matchMedia==='function'&&matchMedia('(max-width: 700px)').matches;}
 remember(trigger:HTMLElement):void{if(!this.active&&this.isSmall())this.prepared={x:window.scrollX,y:window.scrollY,data:{...trigger.dataset}};}
 beforeRender(project:object):boolean{
  const replaced=this.project!==project&&this.active;
  if(this.project!==project){if(this.active)this.dismiss(false);this.point=null;this.prepared=null;this.project=project;this.resetToStart=replaced;}
  if(this.active){const host=document.querySelector<HTMLElement>('[data-mobile-settings-host]');if(host)this.scroll=host.scrollTop;}
  return replaced;
 }
 render(saveState:string,status:string):string{return `<dialog id="mobile-settings-dialog" aria-labelledby="mobile-settings-title"><header class="mobile-settings-header"><button type="button" data-action="close-mobile-settings">← 返回测算</button><h2 id="mobile-settings-title">高级设置</h2><div class="mobile-settings-files"><button type="button" data-action="open">打开项目</button><button type="button" data-action="save">保存项目</button></div><p class="mobile-settings-save-state">${h(saveState)}</p><p class="mobile-settings-status" role="status">${h(status)}</p></header><div data-mobile-settings-host></div></dialog>`;}
 afterRender():void{
  const dialog=document.querySelector<HTMLDialogElement>('#mobile-settings-dialog');if(!dialog)return;
  if(!this.bound.has(dialog)){
   this.bound.add(dialog);
   dialog.addEventListener('cancel',event=>{event.preventDefault();this.onReturn();});
   dialog.addEventListener('close',()=>{if(dialog.isConnected&&this.active&&!dialog.open)this.dismiss();});
   dialog.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const controls=[...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),summary,a[href]')].filter(el=>el.getClientRects().length>0);
    const first=controls[0],last=controls[controls.length-1];if(!first||!last)return;
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first.focus();}
   });
  }
  if(this.active){if(!this.isSmall()){this.dismiss(false);return;}this.mount(dialog);}
  if(this.resetToStart){this.resetToStart=false;window.scrollTo({left:0,top:0,behavior:'instant'});}
 }
 open(trigger:HTMLElement):boolean{
  const dialog=document.querySelector<HTMLDialogElement>('#mobile-settings-dialog');
  if(!this.isSmall()||!dialog||typeof dialog.showModal!=='function'||!document.querySelector('[data-evidence-section="advanced-settings"]')){this.prepared=null;return false;}
  if(!this.active){this.point=this.prepared??{x:window.scrollX,y:window.scrollY,data:{...trigger.dataset}};this.prepared=null;this.scroll=0;this.overflow=document.body.style.overflow;this.active=true;}
  this.afterRender();return true;
 }
 route(target:HTMLElement|null,trigger:HTMLElement):void{
  if(target?.closest('[data-evidence-section="advanced-settings"]'))this.open(trigger);
  else if(this.active)this.dismiss(false);
 }
 private mount(dialog:HTMLDialogElement):void{
  const panel=document.querySelector<HTMLDetailsElement>('[data-evidence-section="advanced-settings"]'),host=dialog.querySelector<HTMLElement>('[data-mobile-settings-host]');if(!panel||!host)return;
  if(panel.parentElement!==host){let marker=document.querySelector<HTMLElement>('[data-mobile-settings-placeholder]');if(!marker){marker=document.createElement('div');marker.dataset.mobileSettingsPlaceholder='';panel.before(marker);}host.append(panel);}
  panel.open=true;document.body.style.overflow='hidden';if(!dialog.open)dialog.showModal();host.scrollTop=this.scroll;
 }
 dismiss(restore=true):void{
  if(!this.active){this.prepared=null;return;}
  const point=this.point;this.active=false;this.point=null;this.prepared=null;this.scroll=0;
  const dialog=document.querySelector<HTMLDialogElement>('#mobile-settings-dialog'),panel=dialog?.querySelector<HTMLElement>('[data-evidence-section="advanced-settings"]'),marker=document.querySelector<HTMLElement>('[data-mobile-settings-placeholder]');
  if(panel&&marker)marker.replaceWith(panel);if(dialog?.open)dialog.close();document.body.style.overflow=this.overflow;
  if(restore&&point){const entries=Object.entries(point.data),trigger=[...document.querySelectorAll<HTMLElement>('[data-action]')].find(el=>entries.every(([key,value])=>el.dataset[key]===value));trigger?.focus({preventScroll:true});window.scrollTo({left:point.x,top:point.y,behavior:'instant'});}
 }
 resize():void{
  if(!this.active||this.isSmall())return;
  const focused=document.activeElement instanceof HTMLElement?document.activeElement:null;
  this.dismiss(false);focused?.focus({preventScroll:true});
 }
}
