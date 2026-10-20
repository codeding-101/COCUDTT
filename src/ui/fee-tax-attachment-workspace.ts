import {FeeTaxAttachmentController,FEE_TAX_ATTACHMENT_STORAGE_KEYS,type FeeTaxAttachmentControllerEnvironment} from './fee-tax-attachment-controller.js';
import {reviewFeeTaxAttachment} from '../data/fee-tax-attachment.js';
import {parseContainerCostPair,reviewContainerCostPair} from '../data/container-cost-pair.js';
import {feeTaxAttachmentInternalHtml,feeTaxAttachmentWorkbookSheet} from '../data/fee-tax-attachment-snapshot.js';
import {serializeWorkbook,XLSX_MIME} from '../data/xlsx-file.js';
import {FEE_TAX_CHANNEL_KEYS} from '../domain/fee-tax-components.js';
import type {FeeTaxAttachmentFacet} from '../domain/fee-tax-attachment.js';
import {readFeeTaxForm,newFeeTaxForm,changeFeeTaxForm} from './fee-tax-attachment-form.js';
import {escapeHtml as h} from './format.js';

type Environment=Omit<FeeTaxAttachmentControllerEnvironment,'changed'|'write'>&{write:(name:string,data:string|Uint8Array<ArrayBuffer>,mime:string)=>Promise<'SAVED'|'DOWNLOAD_STARTED'>;onChange?:()=>void};
const facets=['tax','credit','customs'] as const;
const labels={tax:'金额拆税',credit:'抵扣假设',customs:'海关成分'};
const channels={cash:'应付 G',net:'净额 N',tax:'税额 T',credit:'抵扣假设 X',economic:'费用净额 E',customs:'海关成分 C'};
const states={NOT_RECORDED:'未记录确认',NEEDS_REVIEW:'待复核',RECORDED_ASSUMPTION:'已记录用户假设'};
type Pending={action:string;id:string;token:string;basis:string;raw?:string|null};

/** DOM adapter only. The controller owns attachment leases, files and isolated storage. */
export class FeeTaxAttachmentWorkspace {
 readonly controller:FeeTaxAttachmentController;
 private pending:Pending|null=null;
 private exportBusy=false;private exportMessage='';private typing=false;
 private reviewKey='';private reviewGeneration=0;private reviewHtml='';
 constructor(private readonly env:Environment){this.controller=new FeeTaxAttachmentController({...env,write:(...args)=>env.write(...args),changed:()=>{this.refresh();env.onChange?.();}});env.stateOwner?.bind(this,'tax-workspace');}
 workbenchCapture(){return{pending:this.pending?structuredClone(this.pending):null,export_busy:this.exportBusy,typing:this.typing};}
 private basis(){const s=this.controller.state();return JSON.stringify([s.attachment?.content_sha256,s.editor,this.env.currentPairText()]);}
 private button(action:string,label:string,disabled=false,extra=''){return`<button type="button" data-action="fee-tax-${action}"${disabled?' disabled':''}${extra}>${h(label)}</button>`;}
 render():string{return`<details class="panel fee-tax-workspace" data-evidence-section="fee-tax-attachment"><summary><span class="panel-title">费用与税务成分 · 独立内部假设</span></summary><div class="panel-body" data-fee-tax-host>${this.body()}</div></details>`;}
 private body():string{
  const s=this.controller.state(),a=s.attachment,e=s.editor,b=(action:string,label:string,disabled=false,extra='')=>this.button(action,label,disabled||s.mutation_busy,extra);
  const locked=!!e||s.mutation_busy,writing=s.write_busy||this.exportBusy;
  return`<p>适用场景：逐笔记录已配对服务费的应付、拆税、抵扣和海关成分假设。未知保持未知；不换汇、不合计不同币种。这里的净额不是经营利润，抵扣假设不是税务资格认证，记录不会写入项目费用或进口税基。</p>
   <p data-fee-tax-status role="status" aria-live="polite">${h(s.message)}</p><p>${a?`附件修订 ${a.revision} · ${s.dirty?'有待保存资料':'已打开或另存附件'} · ${s.source_is_current?'配对原文相符，仍须业务复核':'来源失配或当前配对不可用，以下为历史假设'}`:'先在配对面板捕获当前完整修订，或打开已有独立附件。打开附件不安装其中的项目与账单。'}</p>
   <div class="panel-actions">${b('create','从当前配对新建空附件',locked||!this.env.currentPairText())}${b('open','打开附件 JSON 候选',locked)}${b('recover','检查本机附件草稿',locked)}${b('save','另存附件 JSON',!a||locked||writing)}${b('html','导出内部 HTML',!a||locked||writing)}${b('xlsx','导出内部 Excel',!a||locked||writing)}</div><input id="fee-tax-file-input" type="file" accept=".json,application/json" hidden>
   ${s.preview?`<section class="fee-tax-confirm"><p>已校验候选 ${h(s.preview.attachment_id)} · 修订${s.preview.revision}。采用只替换本面板附件；先备份当前资料。</p>${b('adopt','采用该附件候选',locked,` data-fee-tax-token="${s.preview.token}"`)}${b('cancel','取消候选')}</section>`:''}
   ${s.recovery?`<section class="fee-tax-confirm"><p>本机候选 ${h(s.recovery.attachment_id)}${s.recovery.has_editor?'，含未提交编辑':''}。恢复只替换本面板内存资料，旧来源不会自动重新确认。</p>${b('restore','明确恢复本机候选',locked,` data-fee-tax-token="${s.recovery.token}"`)}${b('cancel','取消候选')}</section>`:''}
   ${this.pending?`<section class="fee-tax-confirm" role="alert"><p>${h(this.confirmation(this.pending.action))} 请先另存或备份需要保留的资料。</p>${b('confirm','确认执行',false,` data-fee-tax-token="${this.pending.token}"`)}${b('cancel','保留当前资料')}</section>`:''}
   ${a?`<div class="panel-actions">${b('add','新增成分记录',!!e||a.records.length>=8)}${b('rebind','重新绑定当前配对（撤销全部确认）',locked||!this.env.currentPairText()||s.source_is_current)}</div><p>最多8笔。成分状态按行保留；改变任何输入或来源会撤销该记录三项确认。完整配对变更后，须在配对面板明确捕获修订，再在这里重新绑定。</p><div data-fee-tax-review>${this.reviewHtml||'正在核对附件来源与成分…'}</div>`:''}
   ${this.editor()}
   <details><summary>独立草稿与恢复备份</summary><p>数据仅在本机浏览器。清除存储会丢失草稿；自动草稿不等于另存文件。两个槽位分别写入，不能保证同时成功。旧草稿/其他标签页冲突受保护，须先备份、再明确放弃对应原文，最后重存内存资料。</p><p data-fee-tax-storage>附件槽：${h(s.storage_status.committed??'暂无已知故障')}；编辑槽：${h(s.storage_status.editor??'暂无已知故障')}</p><div class="panel-actions">${b('backup-memory','备份内存（含未提交编辑）',s.write_busy)}${b('backup-committed','备份本机附件原文',s.write_busy)}${b('backup-editor','备份本机编辑原文',s.write_busy)}${b('clear-committed','明确放弃本机附件原文')}${b('clear-editor','明确放弃本机编辑原文')}${b('persist','重存当前内存草稿',!a||locked)}</div><p>内存备份是恢复用资料包，不可作为附件JSON直接打开；原文备份不会删除草稿或清除待保存状态。</p></details>
   <p data-fee-tax-export role="status">${h(this.exportMessage)}</p>`;
 }
 private confirmation(action:string):string{return({create:'新建空附件会替换本面板当前附件，已提交记录不会复制。',adopt:'采用候选会替换本面板当前附件。',restore:'恢复候选会替换本面板当前内存附件。',remove:'删除这笔已提交记录并保留退休编号。',discard:'放弃当前未提交编辑，保留已提交记录。',rebind:'重新绑定当前完整配对，保留输入但撤销全部来源确认；悬空目标仍须逐笔处理。','clear-committed':'仅放弃本机附件槽原文；内存附件和编辑保留。','clear-editor':'仅放弃本机编辑槽原文；内存附件和编辑保留。'} as Record<string,string>)[action]??'替换本面板资料。';}
 private editor():string{
  const s=this.controller.state(),e=s.editor,a=s.attachment;if(!e||!a)return '';
  const b=(act:string,label:string,disabled=false)=>this.button(act,label,disabled||s.mutation_busy);
  const f=readFeeTaxForm(e.record_json),pair=parseContainerCostPair(a.pair_snapshot_json);
  const input=(path:string,label:string,value:string,numeric=false)=>`<label>${h(label)}<input data-fee-tax-field="${path}" value="${h(value)}"${numeric?' inputmode="decimal"':''} maxlength="${numeric?64:path.startsWith('sources.')?200:4000}"></label>`;
  const choose=(path:string,label:string,value:string,options:Record<string,string>)=>`<label>${label}<select data-fee-tax-field="${path}">${Object.entries(options).map(([v,l])=>`<option value="${v}"${v===value?' selected':''}>${h(l)}</option>`).join('')}</select></label>`;
  return`<section data-fee-tax-editor><h3>未提交成分编辑</h3><p>${s.editor_is_current&&s.source_is_current?'绑定当前附件和配对。':'来源或编辑租约失配；原文保留，不能直接提交。'} 编辑会独立缓存；另存和导出须先提交或明确放弃编辑。</p>
   ${!e.record_json?`<label>选择已捕获的配对映射<select data-fee-tax-field="target"><option value="">请选择，目标不会自动猜测</option>${pair.mapping.entries.map(m=>`<option value="${h(m.mapping_id)}">${h(m.line_id)} → ${h(m.cost_id)}</option>`).join('')}</select></label>`:f?`<p>账单行 ${h(f.target.line_id)} → ${h(f.target.cost_id)}。编辑不能改目标；需重新选择时先放弃本次编辑。</p><div class="panel-actions">${b('facts','明确取用该行原币金额与币种（不确认来源）')}</div><div class="bill-fields">${input('input.currency','原币币种（3位大写）',f.input.currency)}${input('input.gross','应付金额 G（未知留空）',f.input.gross??'',true)}</div>
    <p>切换分支会清空该分支的未提交专属字段，请先备份需要保留的内容。税率填小数比例（例如13%写0.13），本工具不推荐或认定适用税率。</p>
    ${facets.map(facet=>{const x=f.input[facet] as unknown as Record<string,string>,source=f.sources[facet];const options:Record<string,string>=facet==='tax'?{UNKNOWN:'未知',NO_SEPARATION:'不作拆分（N/T保持未知）',EXPLICIT:'明确净额与税额',GROSS_RATE:'按明确含税金额及税率拆分'}:facet==='credit'?{UNKNOWN:'未知',NONE:'本次明确无抵扣调整',ASSUMED:'记录抵扣金额假设'}:{UNKNOWN:'未知',NOT_ADDED:'本成分明确不加计',ADD_COMPONENT:'明确加计金额'};const names:Record<string,string>={net:'明确净额 N',tax:'明确税额 T',rate:'税率（比例）',amount:facet==='credit'?'抵扣假设 X':'海关加计成分 C',basis:'该处理的业务依据',document_ref:'凭证定位',eligibility_ref:'资格/用途假设依据'};
     return`<fieldset><legend>${labels[facet]}</legend><div class="bill-fields">${choose('input.'+facet+'.kind','处理口径',x.kind!,options)}${Object.entries(x).filter(([key])=>key!=='kind').map(([key,value])=>input('input.'+facet+'.'+key,names[key]??key,value,['net','tax','rate','amount'].includes(key))).join('')}${choose('sources.'+facet+'.provenance','来源类别',source.provenance,{UNSPECIFIED:'未提供',EXAMPLE:'合成示例（不可确认）',USER_SUPPLIED:'用户提供（仍须另行核对）'})}${(['reference','valid_from','valid_to','checked_on'] as const).map(key=>input('sources.'+facet+'.'+key,({reference:'来源定位',valid_from:'有效开始 YYYY-MM-DD',valid_to:'有效结束 YYYY-MM-DD',checked_on:'核对日期 YYYY-MM-DD'})[key],source[key])).join('')}</div></fieldset>`;
    }).join('')}`:`<p role="alert">恢复的编辑文本不能完整投影为当前表单。原文保持；请先备份，再放弃并重新编辑，不能静默重建或丢字段。</p><pre class="pair-original">${h(e.record_json)}</pre>`}
   <div class="panel-actions">${b('submit','提交完整成分记录（不写费用）',!f||!s.editor_is_current||!s.source_is_current)}${b('discard','明确放弃未提交编辑')}${b('backup-memory','备份当前内存与编辑',s.write_busy)}</div></section>`;
 }
 refresh():void{
  const host=document.querySelector<HTMLElement>('[data-fee-tax-host]');if(!host)return;
  if(this.typing){const status=host.querySelector('[data-fee-tax-status]');if(status)status.textContent=this.controller.state().message;return;}
  const active=document.activeElement,field=active instanceof HTMLElement?active.dataset.feeTaxField:undefined;
  const selection=active instanceof HTMLInputElement?[active.selectionStart,active.selectionEnd] as const:null;
  host.innerHTML=this.body();
  if(field){const next=host.querySelector<HTMLInputElement|HTMLSelectElement>(`[data-fee-tax-field="${field}"]`);next?.focus();if(next instanceof HTMLInputElement&&selection&&selection[0]!==null)next.setSelectionRange(selection[0],selection[1]);}
  this.review();
 }
 afterRender():void{this.review();}
 private review():void{
  const s=this.controller.state(),a=s.attachment,live=this.env.currentPairText();const key=JSON.stringify([a?.content_sha256,live,s.editor?.editor_id,s.mutation_busy]);
  if(key===this.reviewKey)return;this.reviewKey=key;const generation=++this.reviewGeneration;
  this.reviewHtml=a?'正在核对附件来源与成分…':'';const show=()=>{const host=document.querySelector('[data-fee-tax-review]');if(host)host.innerHTML=this.reviewHtml;};show();if(!a)return;
  void reviewFeeTaxAttachment(a,live??a.pair_snapshot_json+'\n').then(review=>{
   if(generation!==this.reviewGeneration)return;
   const now=this.controller.state();if(now.attachment?.content_sha256!==a.content_sha256||this.env.currentPairText()!==live)return;
   this.reviewHtml=review.rows.length?review.rows.map(row=>`<section class="fee-tax-record"><h3>${h(row.target.line_id)} → ${h(row.target.cost_id)}</h3><dl class="fee-tax-channels">${FEE_TAX_CHANNEL_KEYS.map(k=>{const v=row.calculation.channels[k];return`<div><dt>${channels[k]} · ${h(row.calculation.input.currency)}</dt><dd>${v?h(v.denominator==='1'?v.numerator:v.numerator+'/'+v.denominator):'未知'}</dd></div>`;}).join('')}</dl><p>${h([...row.issues,...row.calculation.issues].join('；')||'本次数值检查未发现待办；不代表专业认证。')}</p><div class="panel-actions">${this.button('edit','编辑此记录',!!now.editor||now.mutation_busy,` data-fee-tax-record="${h(row.record_id)}"`)}${this.button('remove','删除此记录',!!now.editor||now.mutation_busy,` data-fee-tax-record="${h(row.record_id)}"`)}</div>${facets.map(f=>`<p>${labels[f]}：${states[row.acknowledgements[f].status]} · ${h(row.acknowledgements[f].issues.join('；'))} ${this.button('ack','记录当前'+labels[f]+'来源确认',!!now.editor||now.mutation_busy||!now.source_is_current||row.acknowledgements[f].issues.length>0,` data-fee-tax-record="${h(row.record_id)}" data-fee-tax-facet="${f}"`)}</p>`).join('')}<details><summary>成分推导与原始操作数（精确分数）</summary><pre class="pair-original">${h(JSON.stringify(row.calculation.audit,null,2))}</pre></details></section>`).join(''):'<p>附件暂无成分记录。新增时金额、税率、抵扣与海关处理都不会自动推定。</p>';show();
  }).catch(()=>{if(generation===this.reviewGeneration){this.reviewHtml='<p role="alert">附件核对暂未完成，资料保留；请备份后重试。</p>';show();}});
 }
 field(path:string,value:string,typing=false):void{
  if(this.env.blocked())return;const s=this.controller.state(),e=s.editor,a=s.attachment;if(!e||!a)return;
  let text:string|null=null;
  if(path==='target'&&e.record_id===null&&e.record_json===''){
   const m=parseContainerCostPair(a.pair_snapshot_json).mapping.entries.find(x=>x.mapping_id===value);if(m)text=JSON.stringify(newFeeTaxForm(m,'component-'+crypto.randomUUID()),null,2);
  }else text=changeFeeTaxForm(e.record_json,path,value);
  if(text!==null&&text!==e.record_json){this.pending=null;this.typing=typing;try{this.controller.editText(text);}finally{this.typing=false;}}
 }
 private request(action:string,id:string):void{
  let raw:string|null|undefined;
  if(action.startsWith('clear-')){try{raw=this.env.storage.getItem(FEE_TAX_ATTACHMENT_STORAGE_KEYS[action==='clear-editor'?'editor':'committed']);}catch{this.exportMessage='本机原文无法读取，未放弃或覆盖。';this.refresh();return;}}
  this.pending={action,id,token:crypto.randomUUID(),basis:this.basis(),raw};this.refresh();
 }
 async action(action:string,data:DOMStringMap):Promise<void>{
  if(this.env.blocked())return;const key=action.replace(/^fee-tax-/,''),s=this.controller.state(),id=data.feeTaxRecord??'';
  try{
   if(['save','html','xlsx','backup-memory','backup-committed','backup-editor'].includes(key)&&(this.exportBusy||s.write_busy))return;
   if(key==='confirm'){
    const p=this.pending;this.pending=null;if(!p||p.token!==data.feeTaxToken||p.basis!==this.basis()){this.exportMessage='确认期间资料已变化，未执行替换；请重新核对。';this.refresh();return;}
    await this.execute(p.action,p.id,p.raw);return;
   }
   if(key==='cancel'){this.pending=null;this.controller.cancelRead();return;}
   if(['create','remove','discard','rebind','clear-committed','clear-editor'].includes(key)){this.request(key,id);return;}
   this.pending=null;
   if(key==='open'){if(!s.editor&&!s.mutation_busy){const input=document.querySelector<HTMLInputElement>('#fee-tax-file-input');if(input){input.value='';input.click();}}return;}
   if(key==='adopt'){if(s.preview?.token===Number(data.feeTaxToken))await this.controller.adoptPreview(s.preview.token);return;}
   if(key==='restore'){if(s.recovery?.token===Number(data.feeTaxToken))this.controller.restoreLocal(s.recovery.token);return;}
   if(key==='recover'){await this.controller.prepareLocalRecovery();return;}
   if(key==='add'){this.controller.beginEdit();return;}
   if(key==='edit'){this.controller.beginEdit(id);return;}
   if(key==='submit'){await this.controller.submitEditor();return;}
   if(key==='facts'){
    if(!s.editor||!s.attachment)return;const f=readFeeTaxForm(s.editor.record_json);if(!f)return;
    const pair=parseContainerCostPair(s.attachment.pair_snapshot_json),row=pair.bill.rows.find(r=>r.input.line_id===f.target.line_id);
    // Obtain the exact total from the same reviewed proposal, never infer rate × boxes here.
    const reviewed=reviewContainerCostPair(pair),proposal=reviewed.proposal.rows.find(r=>r.line_id===f.target.line_id);
    if(this.basis()!==JSON.stringify([s.attachment.content_sha256,s.editor,this.env.currentPairText()]))return;
    if(row&&typeof row.input.currency==='string'&&typeof proposal?.original_amount==='string'){f.input.gross=proposal.original_amount;f.input.currency=row.input.currency;this.controller.editText(JSON.stringify(f,null,2));}return;
   }
   if(key==='ack'&&facets.includes(data.feeTaxFacet as FeeTaxAttachmentFacet)){await this.controller.acknowledge(id,data.feeTaxFacet as FeeTaxAttachmentFacet);return;}
   if(key==='save'){await this.controller.save();return;}
   if(key==='backup-memory'){await this.controller.backupMemory();return;}
   if(key==='backup-committed'||key==='backup-editor'){await this.controller.backupLocalRaw(key==='backup-editor'?'editor':'committed');return;}
   if(key==='persist'){await this.controller.persistCurrent();return;}
   if(key==='html'||key==='xlsx')await this.export(key);
  }catch{this.exportMessage='操作未完成，当前资料保留；可先备份后重试。';this.refresh();}
 }
 private async execute(action:string,id:string,raw?:string|null):Promise<void>{
  if(action==='create')await this.controller.createFromCurrentPair();
  else if(action==='remove')await this.controller.removeRecord(id);
  else if(action==='discard')this.controller.discardEditor();
  else if(action==='rebind')await this.controller.rebindToCurrentPair();
  else if(action==='clear-editor'||action==='clear-committed'){
   const cleared=this.controller.discardLocal(action==='clear-editor'?'editor':'committed',raw??null);
   this.exportMessage=cleared?'已明确放弃所选本机原文；内存资料保持，可重存内存草稿。':'本机原文已变化或无法写入，未确认放弃；请重新检查并备份。';
  }
  this.refresh();
 }
 private async export(kind:'html'|'xlsx'):Promise<void>{
  const s=this.controller.state();if(!s.attachment||s.editor||s.mutation_busy||this.exportBusy)return;
  const a=s.attachment,pair=this.env.currentPairText()??a.pair_snapshot_json+'\n';this.exportBusy=true;this.exportMessage='正在生成点击时的已提交内部快照…';this.refresh();
  try{
   const data=kind==='html'?await feeTaxAttachmentInternalHtml(a,pair):serializeWorkbook({audience:'INTERNAL',title:'内部费用税务成分假设',generatedAt:new Date().toISOString(),sheets:[await feeTaxAttachmentWorkbookSheet(a,pair)]});
   if(this.env.blocked())return;
   const result=await this.env.write('internal-fee-tax-attachment.'+kind,data,kind==='html'?'text/html':XLSX_MIME);
   this.exportMessage=result==='SAVED'?'已导出点击时内部快照；包含完整来源，请勿直接发客户。':'已发起内部快照下载，请确认落盘；附件与项目保存状态保持。';
  }catch(error){this.exportMessage=error instanceof Error&&error.name==='AbortError'?'已取消内部导出，资料保留。':'内部导出失败或超过Excel限额，资料保留；可另存附件JSON。';}
  finally{this.exportBusy=false;this.refresh();}
 }
 storageChanged(key:string|null):void{for(const value of Object.values(FEE_TAX_ATTACHMENT_STORAGE_KEYS))if(key===null||key===value)this.controller.storageChanged(value);}
}
