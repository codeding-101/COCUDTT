/** Real seven-field business form inside the scoped native-dialog composition. Local prototype only. */
import{escapeHtml as h}from'../src/ui/format';
import{FeeRecoveryTradePanel}from'./fee-recovery-trade-panel';
import{createFrameModalComposition,type ModalCompositionLoaders}from'./fee-modal-composition-scope';
import{BusinessModalPaint,BusinessModalCloseGuard,BusinessModalError,type BusinessModalCloseChoice}from'./fee-business-modal';
import type{FeePackageContinuation,ContinuationHandoffChoice,ContinuationDelivery}from'./fee-package-continuation';
import type{ReconcileCandidate}from'./fee-recovery-reconcile';
import type{PackageWriter}from'./fee-recovery-package-transfer';
import type{RecoveredTradeField}from'./fee-recovery-trade';

export function createBusinessModal(prefix:string,mobileModule:unknown,loaders:ModalCompositionLoaders,business:FeePackageContinuation,writer:PackageWriter){
 if(loaders.businessPanel)throw new BusinessModalError('FOREIGN_SURFACE');
 const composition=createFrameModalComposition(prefix,mobileModule,{...loaders,businessPanel:()=>'<details open data-evidence-section="advanced-settings"><summary>本地交易副本 · 七项输入</summary><div data-business-trade></div><label>待处理的本地文件<input type="file" data-business-file></label><p>选中文件只保留在本会话，尚未读取或导入。需继续处理或明确放弃选择后才能关闭。</p><button type="button" data-business-action="clear-file">明确放弃这次文件选择</button><button type="button" data-child-open="field">货值字段说明</button><button type="button" data-child-open="guide">使用引导</button></details>'});
 const root=composition.stage,doc=root.ownerDocument,view=doc.defaultView!,host=root.querySelector<HTMLElement>('[data-business-trade]')!,file=root.querySelector<HTMLInputElement>('[data-business-file]')!;
 const heading=root.querySelector('h1')!;heading.textContent='本地业务副本 · 弹窗与交接';
 heading.nextElementSibling!.textContent='本轮接入交易、来源核对与完整内部交接；税务、汇率、费用、合同及归档原文保持原有边界。关闭本视图与确认保存分别操作。';
 const controls=doc.createElement('section');controls.dataset.businessControls='';controls.innerHTML='<p role="status" data-business-status>资料仅留在本机。未提交输入、未读文件及未保存修改都会阻止关闭。</p><button type="button" data-business-action="retry-paint">关闭上层弹窗后更新显示</button><div data-business-source></div><div data-business-save></div><button type="button" data-business-action="prepare-close">检查并准备关闭</button><label><input type="checkbox" data-business-close-ack>已核对关闭条件；关闭不会代替保存</label><button type="button" data-business-action="close">明确关闭已保存副本视图</button>';
 root.append(controls);
 let closing=false,closed=false,operation=0,active=0,message='',source:ReconcileCandidate|null=null,save:ContinuationHandoffChoice|null=null,delivery:ContinuationDelivery|null=null,close:BusinessModalCloseChoice|null=null;
 const usable=()=>{const c=composition.inspect();return!closing&&!closed&&root.isConnected&&root.contains(host)&&root.contains(file)&&c.mobile.frame_connected&&!c.session.invalidated&&!business.state().closed;};
 const paint=new BusinessModalPaint(usable,()=>composition.inspect().stack.some(r=>r!=='mobile'),()=>{const result=host.querySelector<HTMLElement>('[data-trade-result]');if(result)result.innerHTML='<p role="status" data-deferred-business-result>业务资料已变化。请关闭上层弹窗并更新显示，旧金额暂不展示。</p>';});
 const panel=new FeeRecoveryTradePanel(host,business.trade,true,{request:(kind,run)=>paint.request(kind,run),canEdit:()=>usable()&&!composition.inspect().session.stop_requested});
 const facts=()=>{const values=business.trade.view().values,unadopted=[...host.querySelectorAll<HTMLInputElement>('[data-recovered-field]')].some(e=>e.value!==values[e.dataset.recoveredField as RecoveredTradeField]);return{usable:usable(),pendingTrade:business.trade.hasPending()||unadopted,unsavedBusiness:business.hasUnsaved(),unreadFiles:file.files?.length??0,physicalTasks:active+Number(business.busy())+Number(business.sources.busy())+Number(composition.inspect().session.pipeline_pending),deferredPaint:paint.inspect().pending,pendingHandoff:!!save||!!delivery||business.pendingHandoff()!==null||business.sources.pending()!==null};};
 const guard=new BusinessModalCloseGuard(facts,()=>JSON.stringify({capture:business.capture(),raw:[...host.querySelectorAll<HTMLInputElement>('input')].map(e=>[e.dataset.recoveredField,e.value,e.validity.badInput]),stack:composition.inspect().stack,paint:paint.inspect()}));
 function status(text:string){message=text;controls.querySelector('[data-business-status]')!.textContent=text;}
 function renderControls(){if(closed)return;
  controls.querySelector('[data-business-source]')!.innerHTML='<h2>核对交易与封套</h2><p>只核对本视图允许修改的项目来源，不应用费用；原历史和未解决事项保留。</p><button type="button" data-business-action="prepare-source">准备项目来源差异</button>'+ (source?'<ul>'+source.rows.map(r=>'<li>'+h(r.slot)+'：'+r.before_bytes+' → '+r.after_bytes+' 字节；'+(r.changed?'已变化':'保持')+'</li>').join('')+'</ul><ul>'+source.unresolved_issues.map(i=>'<li>'+h(i)+'</li>').join('')+'</ul><label><input type="checkbox" data-business-source-ack>已核对变更和仍未解决事项</label><button type="button" data-business-action="confirm-source">明确同步项目来源并保留历史</button>':'');
  controls.querySelector('[data-business-save]')!.innerHTML='<h2>完整内部交接</h2><p>只下载项目 JSON 不能代替完整交接。文件准备、交付和确认已保存分别进行；客户报价不在本视图生成。</p><button type="button" data-business-action="prepare-save">准备完整交接文件</button>'+(save?'<p>'+h(save.name)+' · '+save.bytes+' 字节</p><button type="button" data-business-action="deliver-save">明确交付完整文件</button>':'')+(delivery?'<p>文件已交付（'+h(delivery.result)+'），尚未确认保存。</p><button type="button" data-business-action="ack-save">我已核对并保存完整交接文件</button>':'')+'<button type="button" data-business-action="cancel">取消待办 · 保留业务资料</button>';
 }
 const jobs=new Set<Promise<unknown>>();
 async function run(task:()=>Promise<void>){if(!usable())throw new BusinessModalError('CONTEXT_CHANGED');const generation=++operation;guard.touch();active++;try{await task();if(generation===operation&&usable())status('本次操作完成。请核对结果，保存确认仍需单独操作。');}catch(error){if(generation===operation&&usable())status('本次操作未完成；输入和已提交资料保留。'+String(error).slice(0,180));}finally{active--;if(generation===operation&&usable())renderControls();}}
 function cancel(){if(!usable())throw new BusinessModalError('CONTEXT_CHANGED');operation++;guard.touch();business.cancelExport();business.sources.cancel();source=null;save=null;delivery=null;status('已取消待办；已提交交易、未提交输入和选中文件保持。');renderControls();}
 function refresh(){if(!usable())throw new BusinessModalError('CONTEXT_CHANGED');guard.touch();panel.sync();}
 function prepareClose(){controls.querySelector<HTMLInputElement>('[data-business-close-ack]')!.checked=false;const t=guard.prepare();composition.prepareClose();close=t;status('关闭条件已检查；请核对声明并明确关闭。此操作没有确认保存。');return t;}
 async function closeView(token:BusinessModalCloseChoice,choice:'CLOSE_SAVED_INDEPENDENT_BUSINESS_VIEW'){
  // Native component review is taken last, after all status/ack DOM events have settled.
  const t=composition.prepareClose();guard.consume(token,choice);composition.acknowledge(t,true);closing=true;
  panel.dispose();for(const e of host.querySelectorAll<HTMLInputElement>('input'))e.readOnly=true;file.disabled=true;
  try{await composition.close(t);closed=composition.inspect().phase==='CLOSED';status(closed?'本地视图已关闭；关闭没有更改保存证据。':'部分资源尚未清理，请明确重试；资料继续保留。');}finally{if(closed){root.removeEventListener('input',changed);root.removeEventListener('change',changed);root.removeEventListener('click',clicked);}}
 }
 function changed(event:Event){const target=event.target as HTMLInputElement;if(target.matches('[data-business-close-ack]')){if(event.type==='change'&&close){try{guard.acknowledge(close,target.checked);}catch{close=null;status('关闭检查已失效，请重新准备。');}}return;}guard.touch();if(!usable()){status('副本上下文已变化，原文和文件保留；本次选择未采用。');return;}if(target.matches('[data-business-source-ack]')&&source){try{business.sources.acknowledge(source,target.checked);}catch{business.sources.cancel();source=null;status('来源候选已失效，业务资料保持；请重新准备并核对。');renderControls();}}}
 function clicked(event:Event){const el=event.target instanceof view.Element?event.target.closest<HTMLElement>('[data-business-action]'):null;if(!el||!root.contains(el)||!usable())return;const action=el.dataset.businessAction;
  if(action==='prepare-close'){try{prepareClose();}catch(error){status('暂不能关闭：'+String(error).slice(0,180));}return;}
  if(action==='close'){if(close){const job=closeView(close,'CLOSE_SAVED_INDEPENDENT_BUSINESS_VIEW').catch(error=>status('关闭未完成：'+String(error).slice(0,180)));jobs.add(job);void job.finally(()=>jobs.delete(job));}return;}
  guard.touch();
  if(action==='retry-paint'){try{paint.retry();status('已按当前业务资料更新显示；不代表资料已保存。');}catch(error){status(String(error));}return;}
  if(action==='clear-file'){file.value='';status('已明确放弃本次未读取文件选择；业务资料保持。');return;}
  if(action==='cancel'){cancel();return;}
  const job=run(async()=>{
   if(action==='prepare-source'){if(business.trade.hasPending())throw new BusinessModalError('UNCOMMITTED_TRADE_INPUT');source=await business.sources.stage(['project_json']);}
   else if(action==='confirm-source'){if(!source)throw new BusinessModalError('SOURCE_REVIEW_REQUIRED');await business.sources.confirm(source,'UPDATE_CURRENT_SOURCES_KEEP_HISTORY');source=null;refresh();}
   else if(action==='prepare-save'){if(business.trade.hasPending())throw new BusinessModalError('UNCOMMITTED_TRADE_INPUT');if(file.files?.length)throw new BusinessModalError('UNREAD_FILE');save=await business.prepareHandoff();delivery=null;}
   else if(action==='deliver-save'){if(!save)throw new BusinessModalError('HANDOFF_REVIEW_REQUIRED');const token=save;save=null;delivery=await business.deliver(token,'EXPORT_INTERNAL_CONTINUATION',writer);}
   else if(action==='ack-save'){if(!delivery)throw new BusinessModalError('DELIVERY_REQUIRED');business.acknowledgeSaved(delivery,'CONFIRM_HANDOFF_SAVED');delivery=null;}
  });jobs.add(job);void job.finally(()=>jobs.delete(job));
 }
 root.addEventListener('input',changed);root.addEventListener('change',changed);root.addEventListener('click',clicked);renderControls();
 return Object.freeze({start:()=>composition.start(),stopStartup:()=>composition.stopStartup(),refresh,retryPaint:()=>paint.retry(),prepareClose,acknowledgeClose:(t:BusinessModalCloseChoice,checked:boolean)=>guard.acknowledge(t,checked),close:closeView,cancelTasks:cancel,
  async whenIdle(){await Promise.all([business.whenIdle(),business.sources.whenIdle(),composition.whenSettled(),...jobs]);},
  async retryCleanup(){if(!closing||closed)throw new BusinessModalError('NO_FAILED_CLEANUP');await composition.retryCleanup();closed=composition.inspect().phase==='CLOSED';if(closed){root.removeEventListener('input',changed);root.removeEventListener('change',changed);root.removeEventListener('click',clicked);}return closed;},
  inspect(){return{scope:'REAL_TRADE_MODAL_HANDOFF',closed,closing,composition:composition.inspect(),paint:paint.inspect(),guard:guard.inspect(),facts:facts(),message,trade:business.trade.view(),business:business.state(),selected_file_count:file.files?.length??0,source_candidate:source!==null,save_candidate:save!==null,delivery_pending_ack:delivery!==null,retained_input:business.originalInput(),production_integrated:false,full_workbench_reopen:false,new_fee_application_enabled:false,customer_export_enabled:false};},
 });
}
