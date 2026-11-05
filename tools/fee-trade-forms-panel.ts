import { escapeHtml as h } from '../src/ui/format';
import { renderSensitivityResult,sensitivityOptions,type SensitivityControls } from '../src/ui/sensitivity';
import { renderCustomerQuoteBody } from '../src/ui/customer-quote';
import { parseProject } from '../src/data/project-file';
import { CUSTOMER_QUOTE_FIELDS,type CustomerQuoteFields } from '../src/domain/customer-quote';
import { calculateRecoveredTrade } from './fee-recovery-trade';
import { FeeBankFundingPanel } from './fee-bank-funding-panel';
import { FeeContractSettlementManager } from './fee-contract-settlement';
import { startRecoveredPackageDownload } from './fee-recovery-package-panel';
import { startTradeFormsCustomerDownload,type CustomerArtifact,type CustomerArtifactFormat } from './fee-trade-forms-customer';
import type { PackageWriter } from './fee-recovery-package-transfer';

const labels:Record<keyof CustomerQuoteFields,string>={issuer:'报价提供方',recipient:'客户／接收方',reference:'公开编号',goods_description:'公开商品说明',delivery_terms:'公开交付安排',payment_terms:'公开付款安排',included_scope:'报价包含范围',excluded_scope:'报价不包含范围',insurance_terms:'公开保险安排',tax_terms:'公开税费口径',remarks:'公开备注'};
const button=(action:string,text:string,disabled=false)=>`<button type="button" data-tf-action="${action}"${disabled?' disabled':''}>${text}</button>`;
const messages:Record<string,string>={BUSY:'前一项任务仍在结束，请稍后重试。',UNCOMMITTED_INPUT:'请先提交或放弃未完成输入。',UNCOMMITTED_BUSINESS_INPUT:'请先完成业务或付款输入。',STALE_INPUT:'业务或付款上下文已变化，本次输入保留，请放弃缓冲后重新核对。',FOREIGN_OR_STALE:'原客户核对已失效，请重新准备并核对。',FRESH_REVIEW_REQUIRED:'请先核对当前公开内容，再导出客户草稿。',CANCELLED:'本次生成已取消，已提交资料保持。',CANCELLED_OR_STALE:'资料已变化或生成已取消，迟到文件不再采用。',WRITE_FAILED:'客户草稿交付失败，输入保留，可重新尝试。',WRITE_CANCELLED:'客户草稿交付已取消，输入保持。',NO_FORMS:'尚无已提交的内部表单可另存。',FIELD:'输入选项或文字长度超出本表单范围，请保留原文并检查。',FILE_SIZE:'内部表单超过4 MiB，请保留原文。'};
const reason=(e:unknown)=>e&&typeof e==='object'&&'code'in e?messages[String(e.code)]??'操作未完成，已提交资料与输入保持。':e instanceof Error?e.message:'操作未完成，资料保持。';

export class FeeTradeFormsPanel {
  private readonly parent:FeeBankFundingPanel;
  private readonly parentHost:HTMLElement;
  private readonly formHost:HTMLElement;
  private closed=false;private paintOnly=false;private parentBusy=false;private operation=0;
  private message='明确填写内部假设和客户公开文字，客户草稿须重新核对。';
  constructor(host:HTMLElement,readonly manager=new FeeContractSettlementManager(async()=>{},{bankFunding:true,tradeForms:true}),private readonly internalWriter:PackageWriter=startRecoveredPackageDownload,private readonly customerWriter:(file:CustomerArtifact)=>Promise<'DOWNLOAD_STARTED'|'SAVED'>=async f=>startTradeFormsCustomerDownload(f),afterOpen:()=>void=()=>{},private readonly afterPaint:()=>void=()=>{}) {
    host.innerHTML='<section data-tf-parent></section><section data-tf-forms></section>';
    this.parentHost=host.querySelector('[data-tf-parent]')!;this.formHost=host.querySelector('[data-tf-forms]')!;
    this.formHost.addEventListener('input',this.input);this.formHost.addEventListener('change',this.change);this.formHost.addEventListener('blur',this.blur,true);this.formHost.addEventListener('keydown',this.key);this.formHost.addEventListener('mousedown',this.down);this.formHost.addEventListener('click',this.click);
    this.parent=new FeeBankFundingPanel(this.parentHost,manager,internalWriter,afterOpen,busy=>{this.parentBusy=busy;this.render();});
  }
  private editableTarget(e:EventTarget|null):e is HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement{return(e instanceof HTMLInputElement||e instanceof HTMLSelectElement||e instanceof HTMLTextAreaElement)&&!!(e.dataset.tfSens||e.dataset.tfCustomer||e.dataset.tfView);}
  private input=(event:Event)=>{const e=event.target;if(this.editableTarget(e)&&!(e instanceof HTMLSelectElement)&&!(e instanceof HTMLInputElement&&e.type==='checkbox'))this.edit(e);};
  private change=(event:Event)=>{const e=event.target;if(e instanceof HTMLInputElement&&e.matches('[data-tf-review]')){try{const f=this.manager.current()?.forms,p=f?.pendingReview();if(p)f!.acknowledgeCustomer(p,e.checked);}catch(err){this.message=reason(err);}this.refresh(false);return;}if(this.editableTarget(e)&&(e instanceof HTMLSelectElement||e instanceof HTMLInputElement&&e.type==='checkbox')){this.edit(e);this.commit();}};
  private blur=(event:Event)=>{const e=event.target;if(this.editableTarget(e)&&!(e instanceof HTMLSelectElement)&&!(e instanceof HTMLInputElement&&e.type==='checkbox'))this.commit(false);};
  private key=(event:Event)=>{const e=event.target;if(event instanceof KeyboardEvent&&event.key==='Enter'&&!event.isComposing&&this.editableTarget(e)&&(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement&&event.ctrlKey)){event.preventDefault();this.commit();}};
  private down=(event:Event)=>{if(event.target instanceof Element&&event.target.closest('[data-tf-action],[data-tf-review]')&&this.manager.current()?.forms?.hasPending())event.preventDefault();};
  private click=(event:Event)=>{if(event.target instanceof Element){const b=event.target.closest<HTMLElement>('[data-tf-action]');if(b)void this.action(b.dataset.tfAction!);}};
  private refresh(changed:boolean,fields=true){if(this.closed)return;this.paintOnly=!fields;try{if(changed)this.parent.formsChanged();else this.parent.renderAll();}finally{this.paintOnly=false;}}
  private edit(e:HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement){if(this.closed)return;const f=this.manager.current()?.forms;if(!f)return;try{if(e.dataset.tfSens)f.editSensitivity(e.dataset.tfSens as keyof SensitivityControls,e instanceof HTMLInputElement&&e.type==='checkbox'?e.checked:e.value);else if(e.dataset.tfCustomer)f.editCustomer(e.dataset.tfCustomer as keyof CustomerQuoteFields,e.value);else f.editView(e.value as 'full');this.message='输入保留在未提交缓冲中，旧客户核对和导出候选已失效。';}catch(err){this.message=reason(err);}this.refresh(true,false);}
  private commit(fields=true){if(this.closed)return;try{if(this.manager.current()?.forms?.commit())this.message='内部表单草稿已提交，分析和客户公开内容继续按原规则核对。';}catch(e){this.message=reason(e);}this.refresh(true,fields);}
  private readonly lifecycleTasks=new Set<Promise<void>>();
  lifecycleState(){const p=this.parent.lifecycleState();return{physical:p.physical||this.lifecycleTasks.size>0,import_candidate:p.import_candidate};}
  whenLifecycleIdle(){return Promise.all([this.parent.whenLifecycleIdle(),...Array.from(this.lifecycleTasks,p=>p.catch(()=>{}))]).then(()=>{});}
  cancelLifecycleTasks(){this.operation++;this.parent.cancelLifecycleTasks();}
  renderAll(){if(!this.closed)this.parent.renderAll();}
  private action(action:string){const task=this.runAction(action);this.lifecycleTasks.add(task);this.afterPaint();void task.finally(()=>{this.lifecycleTasks.delete(task);if(!this.closed)this.refresh(false);}).catch(()=>{});return task;}
  private async runAction(action:string){if(this.closed)return;const s=this.manager.current(),f=s?.forms;if(!s||!f)return;
    if(action==='cancel'){this.operation++;f.cancelCustomer();this.message='已取消客户生成；已发起的下载无法撤回，当前输入保持。';this.refresh(false);void f.whenIdle().then(()=>{if(!this.closed)this.refresh(false);});return;}
    const op=++this.operation;
    try{
      if(action==='commit'){this.commit();return;}
      if(action==='discard'){f.discard();this.message='已放弃整份表单缓冲，已提交的敏感性和公开字段保持。';this.refresh(true);return;}
      if(action==='prepare'){f.prepareCustomer();this.message='请查看当前公开内容、版式和待核对事项，再明确勾选。';this.refresh(false);return;}
      if(action==='partial'){await this.internalWriter(await s.formsFile());this.message='已发起内部表单分项下载；完整业务、付款和历史仍须完整交接。';this.refresh(false);return;}
      if(['HTML','XLSX','PDF'].includes(action)){const token=f.pendingReview();if(!token)throw Error('请先准备并核对当前客户公开内容');const task=f.deliverCustomer(token,action as CustomerArtifactFormat,this.customerWriter);this.message='正在准备仅含公开字段的客户草稿…';this.refresh(false);await task;if(op===this.operation)this.message='已交付或发起客户草稿下载，请检查完成；内部项目仍按完整交接状态保存。';}
    }catch(e){if(op===this.operation)this.message=reason(e);}finally{if(op===this.operation)this.refresh(false);}
  }
  render(){if(this.closed)return;try{this.paint();}finally{this.afterPaint();}}
  private paint(){if(this.closed)return;const s=this.manager.current(),f=s?.forms,v=f?.view();
    if(!s||!f||!v){this.formHost.innerHTML='<p class="x110-note">先明确打开独立副本，再录入敏感性与客户公开字段。旧档案中的参数、客户文字和确认不自动采用。</p>';return;}
    const focused=document.activeElement;if(this.paintOnly||v.pending&&this.formHost.contains(focused)&&(focused instanceof HTMLInputElement||focused instanceof HTMLTextAreaElement||focused instanceof HTMLSelectElement)){this.status();return;}
    const locked=this.parentBusy||s.busy()||v.blocked,input=v.input,control=input.sensitivity;
    const project=parseProject(s.capture().sources.project_json!);let options:{value:string;label:string}[]=[];try{options=sensitivityOptions(project,calculateRecoveredTrade(project).result,control.kind);}catch{/* original result errors are shown below */}
    const select=(key:string,label:string,choices:readonly(readonly[string,string])[],value:string)=>`<label>${label}<select data-tf-sens="${key}"${locked?' disabled':''}>${choices.map(([k,text])=>`<option value="${h(k)}"${value===k?' selected':''}>${h(text)}</option>`).join('')}</select></label>`;
    this.formHost.innerHTML=`<h2>敏感性与客户公开字段</h2><p class="x110-note">假设变化不写合同、费用或税基。客户文件只取公开字段；内部银行费、资金和来源资料不自动带入。两类输入共用本节草稿，完整内部文件保全已提交输入，客户核对在重开后重新进行。</p><p role="status" data-tf-status></p><div class="tf-grid"><article data-tf-sensitivity><h3>当前术语假设分析</h3><label><input type="checkbox" data-tf-sens="enabled"${control.enabled?' checked':''}${locked?' disabled':''}>启用本次假设分析</label>${select('kind','变量类型',[['FREIGHT','单项运费涨跌'],['FX','单行汇率变化'],['RESPONSIBILITY','待确认费用承担']],control.kind)}${select('target','调整对象',[['','请选择'],...options.map(o=>[o.value,o.label]as const),...(control.target&&!options.some(o=>o.value===control.target)?[[control.target,'保留的对象已不在当前范围，请重新选择']as const]:[])],control.target)}${control.kind==='RESPONSIBILITY'?'<p>分别假设全由卖方或买方承担，其他待确认项保持。</p>':(['from','to','step']as const).map((key,i)=>`<label>${['起始变化','结束变化','变化步长'][i]}（%）<input type="text" inputmode="decimal" data-tf-sens="${key}" value="${h(control[key])}"${locked?' disabled':''}></label>`).join('')}<p>最多21个变化点，实际报价、商业/海关汇率及基准为零时的口径沿原模型，不把假设作为真实报价确认。</p></article>
      <article data-tf-customer><h3>客户公开文字</h3>${CUSTOMER_QUOTE_FIELDS.map(key=>`<label>${labels[key]}${['issuer','recipient','reference'].includes(key)?`<input type="text" data-tf-customer="${key}" value="${h(input.customer_fields[key])}"${locked?' disabled':''}>`:`<textarea rows="2" data-tf-customer="${key}"${locked?' disabled':''}>${h(input.customer_fields[key])}</textarea>`}</label>`).join('')}<label>客户版式<select data-tf-view="view"${locked?' disabled':''}><option value="full"${input.customer_view==='full'?' selected':''}>完整版</option><option value="compact"${input.customer_view==='compact'?' selected':''}>简洁版</option></select></label><p>付款公开条款由你单独填写；不从内部银行费或资金计划自动拼接。长文字可用Ctrl+Enter提交。</p></article></div><div class="x110-actions">${button('commit','提交本节整份草稿',locked||!v.pending)}${button('discard','放弃本节整份缓冲',this.parentBusy||s.busy()||!v.pending)}${button('partial','另存内部表单（分项）',locked||v.pending||!f.committedRaw())}</div><section data-tf-results></section>`;
    this.status();
  }
  private status(){if(this.closed)return;const s=this.manager.current(),f=s?.forms,v=f?.view();if(!s||!f||!v)return;const status=this.formHost.querySelector('[data-tf-status]');if(status)status.textContent=this.message;
    const locked=this.parentBusy||s.busy()||v.blocked;for(const b of this.formHost.querySelectorAll<HTMLButtonElement>('[data-tf-action="commit"],[data-tf-action="discard"]'))b.disabled=!v.pending||(b.dataset.tfAction==='commit'?locked:this.parentBusy||s.busy());
    const result=this.formHost.querySelector('[data-tf-results]');if(!result)return;
    if(v.pending){result.innerHTML='<p>本节输入未提交，旧假设分析和客户预览暂不展示。</p>';return;}
    const q=v.review?.quote??v.customer,view=v.review?.view??v.input.customer_view;
    result.innerHTML=`<h3>假设分析结果</h3>${v.sensitivity_error?`<p class="x110-error">${h(v.sensitivity_error)}</p>`:v.sensitivity?renderSensitivityResult(v.sensitivity):'<p>尚未启用敏感性分析，参数作为内部输入保留。</p>'}<h3>客户草稿预览与新核对</h3>${v.customer_error?`<p class="x110-error">${h(v.customer_error)}</p>`:q?`<section class="tf-preview" data-tf-preview>${renderCustomerQuoteBody(q,v.review?.generated_at,view)}</section>`:'<p>请先补齐当前术语实际报价与指定地点。</p>'}<div class="x110-actions">${button('prepare','准备当前客户公开内容核对',locked||!!v.customer_error)}</div>${v.review?`<label><input type="checkbox" data-tf-review${v.reviewed?' checked':''}${locked?' disabled':''}>已核对当前公开内容、版式和待办，允许导出客户草稿；不表示合同条件已全部确认。</label>`:''}<div class="x110-actions">${(['HTML','XLSX','PDF']as const).map(format=>button(format,'导出客户 '+format+' 草稿',locked||!v.reviewed)).join('')}${button('cancel','取消客户生成',!v.physical)}</div><p>客户下载不清除内部待交接修改。生成失败保留文字；PDF不支持的字符可按原文使用HTML或Excel。</p>`;
  }
  dispose(){if(this.closed)return;this.closed=true;this.operation++;this.parent.dispose();this.formHost.removeEventListener('input',this.input);this.formHost.removeEventListener('change',this.change);this.formHost.removeEventListener('blur',this.blur,true);this.formHost.removeEventListener('keydown',this.key);this.formHost.removeEventListener('mousedown',this.down);this.formHost.removeEventListener('click',this.click);}
}
