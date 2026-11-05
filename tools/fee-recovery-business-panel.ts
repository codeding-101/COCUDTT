/** Separate developer UI. It never mounts existing controller renderers into another workbench. */
import {escapeHtml as h} from '../src/ui/format';
import {emptyCustomerQuoteFields,CUSTOMER_QUOTE_FIELDS,type CustomerQuoteFields} from '../src/domain/customer-quote';
import {renderCustomerQuoteBody} from '../src/ui/customer-quote';
import type {CustomerQuoteView} from '../src/data/customer-quote-view';
import type {FeeRecoveredBusinessSession,RecoveredBusinessCandidate,RecoveredBusinessConfirmation,RecoveredCustomerPreview} from './fee-recovery-business';
import type {RecoveredHandoffFile} from './fee-recovery-business-files';
export type RecoveredBusinessWriter=(name:string,text:string,mime:string)=>Promise<'SAVED'|'DOWNLOAD_STARTED'>;
const labels:Record<keyof CustomerQuoteFields,string>={issuer:'报价提供方',recipient:'客户或接收方',reference:'公开编号',goods_description:'公开商品说明',delivery_terms:'交付安排',payment_terms:'付款安排',included_scope:'报价包含范围',excluded_scope:'报价不含范围',insurance_terms:'保险安排',tax_terms:'税费口径',remarks:'公开备注'};
export const downloadRecoveredBusinessFile:RecoveredBusinessWriter=async(name,text,mime)=>{const url=URL.createObjectURL(new Blob([text],{type:mime}));try{const link=document.createElement('a');link.href=url;link.download=name;link.click();return'DOWNLOAD_STARTED';}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}};
export class FeeRecoveredBusinessPanel {
 private candidate:RecoveredBusinessCandidate|null=null;private confirmation:RecoveredBusinessConfirmation|null=null;private acknowledged=false;
 private customer:RecoveredCustomerPreview|null=null;private customerOpen=false;private fields=emptyCustomerQuoteFields();private view:CustomerQuoteView='compact';
 private files:readonly RecoveredHandoffFile[]=[];private busy=false;private disposed=false;private operation=0;private message='已创建独立业务副本；请重新准备本次费用，旧候选及客户确认不生效。';
 private readonly click=(event:Event)=>{const e=event.target;if(!(e instanceof Element))return;const button=e.closest<HTMLElement>('[data-business-action]');if(button)void this.action(button.dataset.businessAction!,button.dataset.fileIndex);};
 private readonly change=(event:Event)=>{const e=event.target;if(!(e instanceof HTMLInputElement||e instanceof HTMLSelectElement))return;
  try{if(e.matches('[data-business-ack]')&&e instanceof HTMLInputElement&&this.confirmation){this.business.acknowledge(this.confirmation,e.checked);this.acknowledged=e.checked;this.render();}
   if(e.matches('[data-business-review]')&&e instanceof HTMLInputElement&&this.customer){if(e.checked)this.business.confirmCustomer(this.customer,'CONFIRM_PUBLIC_CONTENT');else{this.business.clearCustomerReview();this.customer=null;}this.customerOpen=true;this.render();}
   if(e.matches('[data-business-view]')){this.view=e.value==='full'?'full':'compact';this.clearCustomer();this.render();}}
  catch{this.message='本次确认已过期，请重新核对。';this.render();}};
 private readonly input=(event:Event)=>{const e=event.target;if(!(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement))return;const key=e.dataset.businessCustomer;if(!key||!CUSTOMER_QUOTE_FIELDS.includes(key as keyof CustomerQuoteFields))return;this.fields[key as keyof CustomerQuoteFields]=e.value;this.clearCustomer();const exportButton=this.host.querySelector<HTMLButtonElement>('[data-business-action=customer-export]');if(exportButton)exportButton.disabled=true;const preview=this.host.querySelector('[data-business-customer-preview]');if(preview)preview.innerHTML='公开内容已修改，请重新预览和确认。';};
 constructor(private readonly host:HTMLElement,private readonly business:FeeRecoveredBusinessSession,private readonly write:RecoveredBusinessWriter=downloadRecoveredBusinessFile){host.addEventListener('click',this.click);host.addEventListener('change',this.change);host.addEventListener('input',this.input);this.render();}
 private clearCustomer(){this.business.clearCustomerReview();this.customer=null;}
 private render(){if(this.disposed)return;const s=this.business.state(),btn=(key:string,label:string,disabled=false,extra='')=>`<button type="button" data-business-action="${key}"${disabled||this.busy&&key!=='cancel'?' disabled':''}${extra}>${label}</button>`;
  this.host.innerHTML=`<h1>恢复后业务核对原型</h1><p>独立副本使用新确认，不替换原工作台。完整界面重开仍待验证。</p><div class="business-metrics"><p>当前费用 <strong data-business-count>${s.cost_count}</strong></p><p>卖方利润 <strong>${h(s.seller_profit??'未知')} ${h(s.base_currency)}</strong></p><p>买方总支付 <strong>${h(s.buyer_total)} ${h(s.base_currency)}</strong></p></div><p role="status" data-business-status>${h(this.message)}</p><div class="business-actions">${btn('prepare','重新准备本次费用')}${btn('cancel','取消本次候选')}</div>
  ${this.candidate?`<section data-business-candidate><h2>本次候选</h2><p>新增 ${this.candidate.summary.costs_added} 笔费用、1 份回执；${this.candidate.summary.participants.length} 组状态已准备，尚未应用。</p><table><thead><tr><th>费用</th><th>原币金额</th></tr></thead><tbody>${this.candidate.rows.map(r=>`<tr><td>${h(r.name)}</td><td>${h(r.amount)} ${h(r.currency)}</td></tr>`).join('')}</tbody></table>${btn('arm','核对后准备明确提交')}</section>`:''}
  ${this.confirmation?`<section data-business-confirmation><label><input type="checkbox" data-business-ack${this.acknowledged?' checked':''}${this.busy?' disabled':''}>我已检查本次候选，同意在这个独立副本中提交一次费用及回执。</label>${btn('apply','明确提交本次批次',!this.acknowledged)}</section>`:''}
  ${s.new_application_present?'<p data-business-applied>本副本已记录一次新批次。重复点击不会再次计费，原恢复档案继续保留。</p>':''}
  <section><h2>内部文件交接</h2><p>分别保留当前项目、封套、原恢复数据及新应用备份。内部文件含来源与成本，不能作为客户报价。下载开始不代表已确认落盘。</p>${btn('handoff','生成内部交接清单')}<div data-business-handoff>${this.files.length?`<ul>${this.files.map((f,i)=>`<li>${h(f.name)} · ${f.bytes.toLocaleString('zh-CN')} 字节 ${btn('download','下载',false,` data-file-index="${i}"`)}</li>`).join('')}</ul>`:''}</div></section>
  <details data-business-customer${this.customerOpen?' open':''}><summary>客户报价 · 单独核对公开内容</summary><p>此处重新填写公开信息，不沿用归档里的客户确认。仅输出原有报价白名单。</p><div class="business-fields">${CUSTOMER_QUOTE_FIELDS.map(k=>`<label>${labels[k]}<input data-business-customer="${k}" value="${h(this.fields[k])}" maxlength="4000"${this.busy?' disabled':''}></label>`).join('')}</div><label>版式<select data-business-view><option value="compact"${this.view==='compact'?' selected':''}>简洁版</option><option value="full"${this.view==='full'?' selected':''}>完整版</option></select></label>${btn('customer-preview','预览公开报价')}${btn('customer-export','下载客户报价草稿',!this.customer||!s.customer_reviewed)}<div data-business-customer-preview>${this.customer?renderCustomerQuoteBody(this.customer.quote,undefined,this.view):''}</div>${this.customer?`<label><input type="checkbox" data-business-review${s.customer_reviewed?' checked':''}>我已检查当前公开内容</label>`:''}</details>`;
 }
 private async action(key:string,index?:string){
  if(this.disposed)return;
  if(key==='cancel'){this.operation++;this.business.cancel();this.busy=false;this.candidate=null;this.confirmation=null;this.acknowledged=false;this.message='已取消当前候选；已提交费用、回执及原恢复档案保留。';this.render();return;}
  if(this.busy)return;const operation=++this.operation;
  this.busy=true;this.customerOpen=this.host.querySelector<HTMLDetailsElement>('[data-business-customer]')?.open??false;this.render();
  try{
   if(key==='prepare'){this.candidate=null;this.confirmation=null;this.acknowledged=false;const candidate=await this.business.prepare();if(operation!==this.operation)return;this.candidate=candidate;this.message='新候选已准备，核对并明确确认后才会提交。';}
   if(key==='arm'&&this.candidate){this.confirmation=this.business.arm(this.candidate);this.acknowledged=false;this.message='请检查本次候选并明确勾选。';}
   if(key==='apply'&&this.confirmation){await this.business.apply(this.confirmation,'APPLY_NEW_RECOVERED_BATCH');this.candidate=null;this.confirmation=null;this.acknowledged=false;this.customer=null;this.files=[];if(operation!==this.operation)return;this.message='本批次已应用一次；请另存项目、封套与完整内部交接资料，并重新核对客户报价。';}
   if(key==='handoff'){const files=await this.business.handoff();if(operation!==this.operation)return;this.files=files;this.message='交接清单已生成；请分别下载并核对文件。原恢复数据与新应用备份均保留。';}
   if(key==='download'){const file=this.files[Number(index)];if(!file||!/^\d+$/.test(index??''))throw Error('FILE_SELECTION');const result=await this.write(file.name,file.text,file.mime);if(result!=='SAVED'&&result!=='DOWNLOAD_STARTED')throw Error('WRITE_RESULT');this.message=result==='SAVED'?'已确认该文件写入；其余交接文件仍需分别保存。':'已发起该文件下载，请确认浏览器下载完成；数据与保存标记保留。';}
   if(key==='customer-preview'){this.customerOpen=true;this.customer=this.business.stageCustomer(this.fields,this.view);this.message='公开报价已生成预览，请重新检查并勾选。';}
   if(key==='customer-export'&&this.customer){const result=await this.write('customer-recovered-quote-draft.html',this.business.exportCustomer(this.customer),'text/html');if(result!=='SAVED'&&result!=='DOWNLOAD_STARTED')throw Error('WRITE_RESULT');this.message='已发起客户报价草稿保存，请确认文件；内部原文与费用不会自动加入报价。';}
  }catch{if(operation!==this.operation)return;this.candidate=null;this.confirmation=null;this.acknowledged=false;this.message=this.business.state().new_application_present?'本次操作未完成；已应用的费用及回执保留，可重新生成交接资料。':'操作未完成或需要重新核对；当前资料保留。';}
  finally{if(operation===this.operation){this.busy=false;this.render();}else if(key==='apply'&&!this.disposed){this.render();}}
 }
 dispose(){this.disposed=true;this.operation++;this.business.dispose();this.host.removeEventListener('click',this.click);this.host.removeEventListener('change',this.change);this.host.removeEventListener('input',this.input);}
}
