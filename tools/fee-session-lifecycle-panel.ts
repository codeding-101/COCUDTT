import { escapeHtml as h } from '../src/ui/format';
import { FeeContractSettlementManager } from './fee-contract-settlement';
import { FeeTradeFormsPanel } from './fee-trade-forms-panel';
import { FeeSessionLifecycle,type CloseChoice } from './fee-session-lifecycle';
import { LifecycleRawInputs,lifecycleInput,startLifecycleDownload } from './fee-session-lifecycle-dom';
import type { CustomerArtifact } from './fee-trade-forms-customer';
import type { PackageWriter } from './fee-recovery-package-transfer';
const messages:Record<string,string>={BUSY:'任务仍在运行或结束，请先取消并等待，再重新准备关闭。',UNKNOWN_STATE:'无法完整检查当前状态，暂不关闭；请保留页面并先保全资料。',FOREIGN_OR_STALE:'资料或任务已变化，请重新准备关闭。',EXPLICIT_DISCARD_REQUIRED:'请先明确确认放弃本独立副本中的未交接修改和输入。',EXPLICIT_CLOSE_REQUIRED:'请明确关闭当前独立副本。'};
export class FeeSessionLifecyclePanel {
  readonly lifecycle:FeeSessionLifecycle;private editor:FeeTradeFormsPanel|null=null;private readonly raw:LifecycleRawInputs;private readonly editorHost:HTMLElement;private readonly bar:HTMLElement;private bound=false;private detached=false;private choice:CloseChoice|null=null;private acknowledged=false;private message='关闭前检查本独立副本；客户或分项下载不能代替完整内部保存。';
  constructor(private readonly host:HTMLElement,readonly manager=new FeeContractSettlementManager(async()=>{},{bankFunding:true,tradeForms:true}),writer:PackageWriter=startLifecycleDownload,customerWriter:(file:CustomerArtifact)=>Promise<'DOWNLOAD_STARTED'|'SAVED'>=startLifecycleDownload,afterOpen:()=>void=()=>{}){
    host.innerHTML='<section data-lc-editor></section><aside data-lc-controls></aside>';this.editorHost=host.querySelector('[data-lc-editor]')!;this.bar=host.querySelector('[data-lc-controls]')!;this.raw=new LifecycleRawInputs(manager);
    this.lifecycle=new FeeSessionLifecycle(manager,{inspect:()=>({physical:this.editor?.lifecycleState().physical??false,unaccepted:this.raw.unresolved().length,import_candidate:this.editor?.lifecycleState().import_candidate??false}),cancel:()=>this.editor?.cancelLifecycleTasks(),whenIdle:async()=>{await this.editor?.whenLifecycleIdle();},dispose:()=>this.teardown()});
    host.addEventListener('input',this.interaction,true);host.addEventListener('change',this.interaction,true);host.addEventListener('click',this.interaction,true);this.bar.addEventListener('mousedown',this.down);this.bar.addEventListener('click',this.click);this.bar.addEventListener('change',this.check);
    this.editor=new FeeTradeFormsPanel(this.editorHost,manager,writer,customerWriter,afterOpen,()=>this.refresh());this.refresh();
  }
  private interaction=(event:Event)=>{if(this.detached||event.target instanceof Node&&this.bar.contains(event.target))return;this.lifecycle.changed();this.choice=null;this.acknowledged=false;if((event.type==='input'||event.type==='change')&&lifecycleInput(event.target))this.raw.record(event.target,event.type);this.refresh();queueMicrotask(()=>this.refresh());};
  private down=(event:Event)=>{if(event.target instanceof Element&&event.target.closest('[data-lc-controls]'))event.preventDefault();};
  private click=(event:Event)=>{if(event.target instanceof Element){const a=event.target.closest<HTMLElement>('[data-lc-action]')?.dataset.lcAction;if(a)void this.act(a);}};
  private check=(event:Event)=>{if(event.target instanceof HTMLInputElement&&event.target.matches('[data-lc-ack]')&&this.choice){try{this.lifecycle.acknowledge(this.choice,event.target.checked);this.acknowledged=event.target.checked;}catch{this.choice=null;this.acknowledged=false;}this.refresh();}};
  private unload=(event:BeforeUnloadEvent)=>{if(this.lifecycle.view().needs_warning){event.preventDefault();event.returnValue='';}};
  private async act(action:string){try{if(action==='prepare'){this.choice=this.lifecycle.prepareClose();this.acknowledged=false;this.message=this.choice.requires_discard?'存在未交接修改或输入。可取消关闭，先完成并保存；也可明确放弃当前独立副本。':'当前独立副本无新增待交接输入，可以明确关闭。';}
      else if(action==='keep'){this.lifecycle.cancelClose();this.choice=null;this.acknowledged=false;this.message='已取消关闭，当前资料与输入保持。';}
      else if(action==='cancel-tasks'){const task=this.lifecycle.cancelTasks();this.choice=null;this.refresh();await task;this.editor?.renderAll();this.message='任务已实际结束，当前资料保持；请重新准备关闭。';}
      else if(action==='confirm'&&this.choice){this.lifecycle.confirm(this.choice,this.choice.requires_discard?'DISCARD_UNSAVED_SESSION':'CLOSE_SAVED_SESSION');this.message='本独立副本已关闭。原始文件与其他工作台保持。';}
    }catch(e){const code=e&&typeof e==='object'&&'code'in e?String(e.code):'';this.message=messages[code]??'关闭未完成，当前资料保持。';}this.refresh();}
  refresh(){const v=this.lifecycle.view();if(v.needs_warning&&!this.bound){window.addEventListener('beforeunload',this.unload);this.bound=true;}else if(!v.needs_warning&&this.bound){window.removeEventListener('beforeunload',this.unload);this.bound=false;}
    this.editorHost.inert=v.phase==='SETTLING';const button=(key:string,text:string,disabled=false)=>`<button type="button" data-lc-action="${key}"${disabled?' disabled':''}>${text}</button>`;
    const unaccepted=this.raw.unresolved();this.bar.innerHTML=`<h2>关闭本独立副本</h2><p role="status" data-lc-status>${h(this.message)}</p><p data-lc-state>${v.phase==='CLOSED'?'已关闭':v.unknown?'状态无法完整检查':v.physical?'任务仍在运行或结束':v.needs_warning?'有未提交或未交接资料':'当前无新增待交接修改'} · 费用写入0</p>${unaccepted.length?`<details><summary>保留的未被表单接受的文字（可复制保全）</summary>${unaccepted.map(r=>`<p>${h(r.field)}</p><pre>${h(String(r.value))}</pre>`).join('')}</details>`:''}${v.phase==='CLOSED'?'':`<div class="x110-actions">${button('prepare','检查并准备关闭',v.physical||v.unknown)}${button('cancel-tasks','取消任务并等待结束',v.phase==='SETTLING'||!v.physical)}${button('keep','取消关闭，保留资料')}</div>${this.choice?`<p>未提交：${this.choice.pending_inputs?'有':'无'}；未完整交接：${this.choice.unsaved?'有':'无'}；未接受文字：${this.choice.unaccepted_inputs}。</p>${this.choice.requires_discard?`<label><input type="checkbox" data-lc-ack${this.acknowledged?' checked':''}>明确放弃本独立副本的未交接修改与输入，关闭后不能从客户或分项文件完整恢复。</label>`:''}${button('confirm',this.choice.requires_discard?'明确放弃并关闭':'明确关闭',this.choice.requires_discard&&!this.acknowledged)}`:''}<p>浏览器刷新／离开时只在存在需保留资料或任务时请求原生提醒；浏览器、系统或强制终止仍可能不显示，不能替代文件备份。已发起下载无法撤回。</p>`}`;
  }
  render(){if(!this.detached)this.editor?.renderAll();this.refresh();}
  whenIdle(){return Promise.all([this.manager.whenIdle(),this.manager.current()?.whenIdle(),this.editor?.whenLifecycleIdle()]).then(()=>{});}
  private teardown(){if(this.detached)return;this.detached=true;this.host.removeEventListener('input',this.interaction,true);this.host.removeEventListener('change',this.interaction,true);this.host.removeEventListener('click',this.interaction,true);this.bar.removeEventListener('mousedown',this.down);this.bar.removeEventListener('click',this.click);this.bar.removeEventListener('change',this.check);if(this.bound){window.removeEventListener('beforeunload',this.unload);this.bound=false;}this.editor?.dispose();this.raw.clear();this.editorHost.innerHTML='';}
  /** Host removal is subject to the same clean-state check, never an implicit dirty discard. */
  dispose(){if(this.lifecycle.view().phase==='CLOSED')return;const p=this.lifecycle.prepareClose();this.lifecycle.confirm(p,'CLOSE_SAVED_SESSION');this.refresh();}
}
