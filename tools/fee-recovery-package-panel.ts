/** Developer-only, explicitly owned local package UI. Inspection never installs into a business holder. */
import {escapeHtml as h} from '../src/ui/format';
import {RecoveredPackageTransfer,type RecoveredPackageChoice,type PackageWriter} from './fee-recovery-package-transfer';
import {RecoveryPackageError,type RecoveredPackageReview} from './fee-recovery-package';

const messages:Record<string,string>={BUSY:'前一个文件任务尚未结束，请稍后重试。',FILE_SIZE:'请选择1字节至64 MiB的内部项目包。',FILE_BYTES:'文件读取不完整，原只读视图保持。',FILE_UTF8:'文件不是有效UTF-8，原只读视图保持。',CANCELLED:'本次操作已取消，当前项目和原只读视图保持。',CANCELLED_OR_STALE:'操作已取消或当前资料变化，请重新准备。',FOREIGN_CONSUMED_OR_STALE:'候选已使用或当前资料变化，请重新准备。',EXPLICIT_CHOICE_REQUIRED:'请使用本次候选对应的明确操作。',DELIVERY_CANCELLED:'文件保存已取消，当前项目保持；可重新准备。',WRITE_FAILED:'文件交付失败，当前项目保持；请重新准备后重试。',PREPARATION_FAILED:'完整校验未通过，当前项目和原只读视图保持。',CLOSED:'此本地文件容器已关闭。'};
const phases:Record<string,string>={IDLE:'等待选择',BUILDING:'正在准备内部包',READING:'正在核对本机文件',DELIVERING:'正在交付文件',SETTLING:'已取消，等待底层任务结束',AWAITING_EXPLICIT_CHOICE:'待你明确选择',READ_ONLY_OPEN:'独立只读视图已打开',CLOSED:'本机文件容器已关闭'};

/** An anchor can only acknowledge starting a download, never OS completion. */
export const startRecoveredPackageDownload:PackageWriter=async file=>{
  const url=URL.createObjectURL(new Blob([file.text],{type:file.mime})),a=document.createElement('a');a.href=url;a.download=file.name;a.hidden=true;document.body.append(a);
  try{a.click();return'DOWNLOAD_STARTED';}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
};

export class RecoveredPackagePanel{
  private message='先准备完整内部包，核对内容后再下载；选择文件只会准备只读候选。';private working=false;private operation=0;private closed=false;
  private readonly click=(event:Event)=>{const el=event.target;if(!(el instanceof Element)||!this.host.contains(el))return;const button=el.closest<HTMLElement>('[data-package-action]');if(button)void this.action(button.dataset.packageAction!);};
  private readonly change=(event:Event)=>{const el=event.target;if(!(el instanceof HTMLInputElement)||!this.host.contains(el)||!el.matches('[data-package-file]'))return;const file=el.files?.[0];if(file)void this.action('read',file);};
  constructor(private readonly host:HTMLElement,readonly transfer:RecoveredPackageTransfer,private readonly writer:PackageWriter=startRecoveredPackageDownload,private readonly afterDelivery:()=>void=()=>{}){host.addEventListener('click',this.click);host.addEventListener('change',this.change);this.render();}
  sourceChanged(){this.operation++;this.transfer.cancel();this.working=false;this.message='当前资料已变化，旧文件候选失效；原只读视图保留，请重新准备。';this.render();void this.transfer.whenIdle().then(()=>this.render());}
  private review(r:RecoveredPackageReview,preview:boolean){return`<section ${preview?'data-package-preview':'data-package-opened'}><h3>${preview?'核对本次内部文件':'已打开独立只读视图'}</h3><p><strong>${h(r.project_name)}</strong> · ${h(r.base_currency)}；卖方利润 ${h(r.seller_profit??'不可计算')}，买方总支付 ${h(r.buyer_total)}</p><p>来源同步 ${r.source_updates} 次 · 本副本新应用 ${r.new_fee_applications} 次 · 历史回执 ${r.historical_receipts} 份 · 退休费用编号 ${r.retired_cost_ids} 个</p><div class="package-files"><table><thead><tr><th>保留的内部文件</th><th>字节及指纹</th></tr></thead><tbody>${r.files.map(f=>`<tr><th>${h(f.name)}</th><td>${f.bytes}<code>${h(f.sha256)}</code></td></tr>`).join('')}</tbody></table></div><details><summary>原始档案与待核对事项</summary><p>原始来源 SHA-256 <code>${h(r.original_source_sha256)}</code></p><p>原始补充资料 SHA-256 <code>${h(r.original_supplement_sha256)}</code></p><p>${r.original_drafts_present?'原始档案中保留草稿或未完成候选；只作记录，不执行。':'原始档案保持原文，不作为新的确认凭证。'}</p><ul>${r.unresolved_issues.map(i=>`<li>${h(i)}</li>`).join('')}</ul></details><p>这是一份内部核对视图。未安装到当前项目，未应用费用，未恢复旧确认，也未批准客户报价；不代表完整业务工作区已重开。</p></section>`;}
  private choice(c:RecoveredPackageChoice){return`${this.review(c.review,true)}<p>文件 ${h(c.name)} · ${c.bytes} 字节<code>${h(c.sha256)}</code></p><button type="button" data-package-action="${c.scope==='RECOVERED_PACKAGE_EXPORT'?'download':'open'}"${this.working?' disabled':''}>${c.scope==='RECOVERED_PACKAGE_EXPORT'?'明确下载内部项目包':'明确打开独立只读视图'}</button>`;}
  render(){if(this.closed)return;const state=this.transfer.state(),pending=this.transfer.pending(),opened=this.transfer.currentReview(),disabled=this.working||this.transfer.busy();
    this.host.innerHTML=`<h2>内部项目包 · 本机交接</h2><p class="package-private">含内部成本、原始恢复档案与完整来源变更记录。用于内部保全，请使用另行核对的客户报价对外发送。</p><p role="status" aria-live="polite" data-package-status>${h(this.message)}</p><div class="package-actions"><button type="button" data-package-action="prepare"${disabled?' disabled':''}>准备完整内部包</button><button type="button" data-package-action="cancel">取消本次操作</button></div><label class="package-file-label">选择本机内部项目包（仅核对）<input type="file" accept="application/json,.json" data-package-file${disabled?' disabled':''}></label><p class="package-phase" data-package-phase="${h(state.phase)}">${h(phases[state.phase]??'正在处理本机文件')} · 当前项目未因文件操作写入费用</p>${pending?this.choice(pending):'<p data-package-empty>准备文件后会显示内容摘要，仍须明确选择下载或只读打开。</p>'}${opened?this.review(opened,false):''}`;
  }
  private async action(action:string,file?:File){if(this.closed)return;if(action==='cancel'){this.operation++;this.transfer.cancel();this.working=false;this.message='本次文件操作已取消。已发起的下载无法撤回，当前项目和原只读视图保持。';this.render();void this.transfer.whenIdle().then(()=>this.render());return;}
    const n=++this.operation;this.working=true;let delivered=false;this.message=action==='read'?'正在读取并完整核对本机文件…':action==='prepare'?'正在收集当前资料并核对完整内部包…':'正在处理明确选择…';this.render();
    try{if(action==='prepare'){await this.transfer.prepareExport();this.message='内部包已完整核对。请检查来源记录和文件，再明确下载。';}
      else if(action==='read'&&file){await this.transfer.stageFile(file);this.message='文件已核对，请明确打开独立只读视图；当前项目保持。';}
      else if(action==='download'){const c=this.transfer.pending();if(!c)throw new RecoveryPackageError('FOREIGN_CONSUMED_OR_STALE');const result=await this.transfer.deliver(c,'EXPORT_INTERNAL_PACKAGE',this.writer);delivered=true;this.message=result.result==='SAVED'?'保存接口已确认完成；当前项目保持。':'已发起浏览器下载，请在下载列表确认完成；当前项目保持。';this.afterDelivery();}
      else if(action==='open'){const c=this.transfer.pending();if(!c)throw new RecoveryPackageError('FOREIGN_CONSUMED_OR_STALE');this.transfer.openReadOnly(c,'OPEN_READ_ONLY_PACKAGE');this.message='已打开独立只读视图，当前业务副本和原始恢复容器保持。';}
    }catch(error){if(n!==this.operation)return;this.message=delivered?'文件交付已完成或已发起，但后续显示失败；没有回滚文件操作，请检查下载列表。':error instanceof RecoveryPackageError?messages[error.code]??'内部文件未通过完整校验，当前项目和原只读视图保持。':'文件操作未完成，当前项目和原只读视图保持；请检查已提交输入和来源一致性。';}
    finally{if(n===this.operation){this.working=false;this.render();}}
  }
  dispose(){if(this.closed)return;this.closed=true;this.operation++;this.transfer.dispose();this.host.removeEventListener('click',this.click);this.host.removeEventListener('change',this.change);}
}
