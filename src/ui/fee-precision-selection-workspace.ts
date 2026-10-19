import {FeePrecisionSelectionController,FEE_PRECISION_SELECTION_STORAGE_KEYS,type FeePrecisionSelectionControllerEnvironment} from './fee-precision-selection-controller.js';
import {reviewFeePrecisionSelection} from '../data/fee-precision-selection.js';
import {feePrecisionSelectionInternalHtml,feePrecisionSelectionWorkbookSheet} from '../data/fee-precision-selection-snapshot.js';
import {FEE_PRECISION_CHANNELS,type PrecisionFraction} from '../domain/fee-precision.js';
import {readFeePrecisionForm,newFeePrecisionForm,changeFeePrecisionForm} from './fee-precision-selection-form.js';
import {serializeWorkbook,XLSX_MIME} from '../data/xlsx-file.js';
import {escapeHtml as h} from './format.js';

type Environment=Omit<FeePrecisionSelectionControllerEnvironment,'changed'|'write'>&{write:(name:string,data:string|Uint8Array<ArrayBuffer>,mime:string)=>Promise<'SAVED'|'DOWNLOAD_STARTED'>;onChange?:()=>void};
type Pending={action:string;id:string;token:string;basis:string;raw?:string|null};
const channels={cash:'应付 G',net:'净额 N',tax:'税额 T',credit:'抵扣假设 X',economic:'费用净额 E',customs:'海关成分 C'};
const fraction=(v:PrecisionFraction|null)=>v===null?'未知':v.denominator==='1'?v.numerator:v.numerator+'/'+v.denominator;
const policyLabels:Record<string,string>={NOT_RECORDED:'未记录政策确认',NEEDS_REVIEW:'政策待复核',RECORDED_POLICY_ASSUMPTION:'已记录算术政策假设'};

/** Independent UI adapter. Neither this panel nor its controller installs costs or embedded sources. */
export class FeePrecisionSelectionWorkspace {
 readonly controller:FeePrecisionSelectionController;
 private pending:Pending|null=null;private typing=false;private exportBusy=false;private exportMessage='';
 private reviewKey='';private reviewGeneration=0;private reviewHtml='';
 constructor(private readonly env:Environment){this.controller=new FeePrecisionSelectionController({...env,changed:()=>{this.refresh();env.onChange?.();}});}
 private live(){try{return this.env.currentSources();}catch{return null;}}
 private basis(){const s=this.controller.state();return JSON.stringify([s.selection?.content_sha256,s.editor,this.live()]);}
 private button(action:string,label:string,disabled=false,extra=''){return`<button type="button" data-action="fee-precision-${action}"${disabled?' disabled':''}${extra}>${h(label)}</button>`;}
 render():string{return`<details class="panel fee-precision-workspace" data-evidence-section="fee-precision-selection"><summary><span class="panel-title">精度与换汇政策 · 内部核对</span></summary><div class="panel-body" data-fee-precision-host>${this.body()}</div></details>`;}
 private body():string{
  const s=this.controller.state(),a=s.selection,locked=!!s.editor||s.mutation_busy,writing=s.write_busy||this.exportBusy;
  const b=(action:string,label:string,disabled=false,extra='')=>this.button(action,label,disabled||s.mutation_busy,extra);
  return`<p>适用场景：核对已提交费用成分的舍入或换汇假设。原值、候选和带符号差额分别保留；未知不补零，不混加通道或币种。政策确认只记录算术假设，不证明税务资格，不清除原业务待办，不写入费用、利润或进口税基。</p>
   <p data-fee-precision-status role="status" aria-live="polite">${h(s.message)}</p>
   <p data-fee-precision-source>${a?`修订 ${a.revision} · ${s.dirty?'有待保存资料':'已打开或另存文件'} · ${s.source_is_current?'完整双来源原文相符，仍须业务复核':'当前双来源不可用或失配；以下仅为历史假设，不能确认或正式导出'}`:'先捕获完整配对并提交费用成分附件，再明确新建；打开独立文件不会安装其中的项目、账单或附件。'}</p>
   <div class="panel-actions">${b('create','从当前双来源新建空文件',locked||!this.live())}${b('open','打开精度 JSON 候选',locked)}${b('recover','检查本机精度草稿',locked)}${b('save','另存精度 JSON',!a||locked||writing)}${b('html','导出内部 HTML',!a||locked||writing||!s.source_is_current)}${b('xlsx','导出内部 Excel',!a||locked||writing||!s.source_is_current)}</div><input id="fee-precision-file-input" type="file" accept=".json,application/json" hidden>
   ${s.preview?`<section class="fee-precision-confirm"><p>已校验候选 ${h(s.preview.selection_id)} · 修订 ${s.preview.revision}。采用只替换本面板文件，须另行核对双来源。</p>${b('adopt','核对并采用候选',locked,` data-fee-precision-id="${s.preview.token}"`)}${b('cancel','取消候选')}</section>`:''}
   ${s.recovery?`<section class="fee-precision-confirm"><p>本机候选 ${h(s.recovery.selection_id)}${s.recovery.has_editor?'，包含未提交编辑':''}。恢复不会自动重绑或确认来源。</p>${b('restore','核对并恢复草稿',locked,` data-fee-precision-id="${s.recovery.token}"`)}${b('cancel','取消候选')}</section>`:''}
   ${this.pending?`<section class="fee-precision-confirm" role="alert"><p>${h(this.confirmation(this.pending.action))} 请先另存或备份需要保留的资料。</p>${b('confirm','确认执行',false,` data-fee-precision-token="${this.pending.token}"`)}${b('cancel','保留当前资料')}</section>`:''}
   ${a?`<div class="panel-actions">${b('add','新增原成分政策',locked||!s.source_is_current||a.records.length>=48)}${b('rebind','重绑当前双来源并撤销全部政策确认',locked||!this.live()||s.source_is_current)}</div><p>最多48个不同成分/通道组合。已有记录只改政策；更换成分或通道须先删除，再新增。重绑保留历史原值，不自动修正失配记录。</p><div data-fee-precision-review>${this.reviewHtml||'正在核对来源、政策与业务待办…'}</div>`:''}
   ${this.editor()}
   <details><summary>独立草稿、冲突与备份</summary><p>资料仅保存在本机浏览器，清除存储会丢失。自动草稿不等于另存文件，两槽分别写入，不能保证同时成功。旧草稿和跨标签冲突保留原文，先备份再明确放弃对应槽位。</p><p data-fee-precision-storage>文件槽：${h(s.storage_status.committed??'暂无已知故障')}；编辑槽：${h(s.storage_status.editor??'暂无已知故障')}</p><div class="panel-actions">${b('backup-memory','备份内存及未提交编辑',s.write_busy)}${b('backup-committed','备份本机文件原文',s.write_busy)}${b('backup-editor','备份本机编辑原文',s.write_busy)}${b('clear-committed','明确放弃本机文件原文')}${b('clear-editor','明确放弃本机编辑原文')}${b('persist','重存当前内存草稿',!a||locked)}</div><p>内存备份为资料包，不可当作精度JSON直接打开；原文备份不删除草稿，也不标记文件已保存。内部输出包含完整来源，请勿直接发送客户。</p></details><p data-fee-precision-export role="status">${h(this.exportMessage)}</p>`;
 }
 private confirmation(action:string){return({create:'新建空文件会替换本面板资料，不复制已有政策。',adopt:'采用候选会替换本面板已提交文件。',restore:'恢复候选会替换本面板内存资料。',discard:'放弃当前未提交编辑，保留已提交记录。',remove:'删除该政策并保留退休编号。',rebind:'重绑完整双来源，撤销全部政策确认；原值和政策保留，失配目标仍须处理。','clear-committed':'只放弃本机文件槽原文，内存资料保留。','clear-editor':'只放弃本机编辑槽原文，内存编辑保留。'} as Record<string,string>)[action]??'替换本面板资料。';}
 private editor():string{
  const s=this.controller.state(),e=s.editor,a=s.selection;if(!e||!a)return'';
  const isNew=e.record_id===null,f=readFeePrecisionForm(e.record_json,isNew),c=(isNew?f?.choice:f) as Record<string,unknown>|undefined;
  const input=(path:string,label:string,value:unknown,numeric=false)=>`<label>${h(label)}<input data-fee-precision-field="${path}" value="${h(String(value??''))}" maxlength="${numeric?64:200}"${numeric?' inputmode="decimal"':''}></label>`;
  const choose=(path:string,label:string,value:unknown,options:Record<string,string>)=>`<label>${h(label)}<select data-fee-precision-field="${path}">${Object.entries(options).map(([v,label])=>`<option value="${h(v)}"${v===value?' selected':''}>${h(label)}</option>`).join('')}</select></label>`;
  // Only list source identities here. Exact money and target capture is the validated file API's job.
  const attachment=JSON.parse(a.attachment_snapshot_json) as {records:{record_id:string;target:{line_id:string;cost_id:string}}[]};
  return`<section data-fee-precision-editor><h3>未提交精度政策</h3><p>${s.editor_is_current&&s.source_is_current?'正在编辑当前文件的政策。':'编辑依据的资料或原成分已变化；原文保留，请备份并重新核对。'} 提交前不改变已记录政策，未提交编辑只进入备份。</p>
   ${e.record_json===''&&isNew?this.button('start','开始选择原成分与通道',s.mutation_busy):f&&c?`
    ${isNew?`<div class="bill-fields">${choose('component_record_id','原成分（明确选择）',f.component_record_id,{'':'请选择',...Object.fromEntries(attachment.records.map(r=>[r.record_id,r.target.line_id+' → '+r.target.cost_id]))})}${choose('channel','原通道（明确选择）',f.channel,{'':'请选择',...channels})}</div>`:`<p>固定原成分 ${h(e.slot?.component_record_id??'')} · ${h(channels[e.slot!.channel])}。原金额、币种和目标不能在此编辑。</p>`}
    <p>切换政策类型会清空该类型专属字段，请先备份。单位、模式、币种、汇率、日期和依据均须明确填写，不推定默认值。</p>
    <div class="bill-fields">${choose('choice.kind','政策类型',c.kind,{UNRESOLVED:'待明确（不产生候选）',ROUND:'原币舍入核对',FX:'明确汇率换算核对'})}
    ${c.kind!=='UNRESOLVED'?(()=>{const p=c.policy as Record<string,string>;return input('policy.unit','最小单位（大于0，最多6位小数）',p.unit,true)+choose('policy.mode','舍入模式',p.mode,{'':'请选择',HALF_UP:'HALF_UP · 半入',HALF_EVEN:'HALF_EVEN · 半偶',DOWN:'DOWN · 向零截取'})+input('policy.basis','政策依据（必填）',p.basis);})():''}
    ${c.kind==='FX'?(()=>{const r=c.rate_source as Record<string,string>;return input('to','目标币种（3位大写）',c.to)+choose('purpose','核对用途',c.purpose,{'':'请选择',COMMERCIAL_REVIEW:'商业成分核对',CUSTOMS_COMPONENT_REVIEW:'中国海关成分诊断（非税款）'})+input('as_of','本次核对日期 YYYY-MM-DD',c.as_of)+input('rate_source.base','汇率基准币种',r.base)+input('rate_source.quote','汇率报价币种',r.quote)+input('rate_source.rate','明确汇率（1基准币 = ?报价币）',r.rate,true)+choose('rate_source.type','汇率类型',r.type,{'':'请选择',CONTRACT:'合同',MARKET:'市场',CUSTOMS:'海关'})+(['rate_date','valid_from','valid_to','reference'] as const).map(k=>input('rate_source.'+k,({rate_date:'汇率日期 YYYY-MM-DD',valid_from:'有效开始 YYYY-MM-DD',valid_to:'有效结束 YYYY-MM-DD',reference:'汇率来源定位'})[k],r[k])).join('');})():''}</div>
    ${c.kind==='FX'?'<p>日期须覆盖本次核对日，汇率方向由币种对严格匹配。商业通道仅用合同/市场汇率；海关成分诊断仅用于C通道、海关汇率换至CNY、0.01单位及HALF_UP，不代替完税价格或实际税款计算。本次核对日期与账单复核日期一致后才可记录政策确认。</p>':''}`:`<p role="alert">恢复原文无法完整投影为当前表单，未重建或删除字段。请备份后再明确放弃并重新编辑。</p><pre class="pair-original">${h(e.record_json)}</pre>`}
   <div class="panel-actions">${this.button('submit','提交政策（不应用费用）',!f||!s.editor_is_current||!s.source_is_current||s.mutation_busy)}${this.button('discard','明确放弃未提交编辑',s.mutation_busy)}${this.button('backup-memory','备份内存与编辑',s.write_busy)}</div></section>`;
 }
 refresh():void{
  if(typeof document==='undefined')return;const host=document.querySelector<HTMLElement>('[data-fee-precision-host]');if(!host)return;
  if(this.typing){const s=this.controller.state(),status=host.querySelector('[data-fee-precision-status]'),storage=host.querySelector('[data-fee-precision-storage]');if(status)status.textContent=s.message;if(storage)storage.textContent=`文件槽：${s.storage_status.committed??'暂无已知故障'}；编辑槽：${s.storage_status.editor??'暂无已知故障'}`;return;}
  const active=document.activeElement,field=active instanceof HTMLElement?active.dataset.feePrecisionField:undefined,selection=active instanceof HTMLInputElement?[active.selectionStart,active.selectionEnd] as const:null;
  host.innerHTML=this.body();
  if(field){const next=host.querySelector<HTMLInputElement|HTMLSelectElement>(`[data-fee-precision-field="${field}"]`);next?.focus();if(next instanceof HTMLInputElement&&selection&&selection[0]!==null)next.setSelectionRange(selection[0],selection[1]);}
  this.review();
 }
 afterRender():void{this.review();}
 private review():void{
  const s=this.controller.state(),a=s.selection,live=this.live(),key=JSON.stringify([a?.content_sha256,live,s.editor?.editor_id,s.mutation_busy]);if(key===this.reviewKey)return;
  this.reviewKey=key;const generation=++this.reviewGeneration;this.reviewHtml=a?'正在核对来源、政策与业务待办…':'';
  const show=()=>{const host=document.querySelector('[data-fee-precision-review]');if(host)host.innerHTML=this.reviewHtml;};show();if(!a)return;
  // Embedded sources permit historical arithmetic display only; absence of live sources never authorizes a receipt/export.
  void reviewFeePrecisionSelection(a,live?.pair_json??a.pair_snapshot_json,live?.attachment_json??a.attachment_snapshot_json).then(review=>{
   if(generation!==this.reviewGeneration||this.controller.state().selection?.content_sha256!==a.content_sha256||JSON.stringify(this.live())!==JSON.stringify(live))return;
   const now=this.controller.state(),locked=!!now.editor||now.mutation_busy,originalRecords=JSON.parse(a.attachment_snapshot_json).records as {record_id:string;sources:Record<string,{provenance:string}>}[];
   this.reviewHtml=`<p>配对来源：${live&&review.source_status.pair_current?'原文相符':'不可用或失配'}；成分附件：${live&&review.source_status.attachment_current?'原文相符':'不可用或失配'}；双来源：${live&&review.source_status.coherent_current?'相互一致':'须重新核对'}。</p>`+(review.rows.length?review.rows.map(row=>{
    const r=row.record,v=row.calculation.values,eligible=!!live&&now.source_is_current&&row.policy.issues.length===0;
    const source=review.source_review.rows.find(x=>x.record_id===r.component_record_id),original=originalRecords.find(x=>x.record_id===r.component_record_id);
    return`<section class="fee-precision-record"><h3>${h(r.target.line_id)} → ${h(r.target.cost_id)} · ${channels[r.channel]}</h3><dl class="fee-precision-values"><div><dt>原值 · ${h(r.currency)}</dt><dd>${h(fraction(r.original))}</dd></div><div><dt>候选 · ${h(r.choice.kind==='FX'?r.choice.to:r.currency)}</dt><dd>${h(fraction(v.rounded))}</dd></div><div><dt>舍入差额（候选减舍入前金额）</dt><dd>${h(fraction(v.delta))}</dd></div></dl><p>${r.choice.kind==='FX'?'换汇候选与差额以目标币种表示；差额相对精确换汇额，不是不同币种原值相减。':'原币舍入候选不替换原值。'}</p>
     <p>政策：${!live||!now.source_is_current?'当前来源不可用或失配，历史回执不能确认当前政策':policyLabels[row.policy.status]} · ${h(row.policy.issues.join('；'))}</p><p>原业务待办（政策确认不会清除）：${h(row.business_issues.join('；')||'当前列表为空，仍须另行核对来源及税务资格。')}</p><p>原成分来源与资格待办：${(['tax','credit','customs'] as const).map(f=>h(({tax:'拆税',credit:'抵扣',customs:'海关成分'})[f]+' · '+(original?.sources[f]?.provenance??'来源不可用')+' · '+(source?.acknowledgements[f].issues.join('；')??'记录不可用'))).join(' / ')}</p><p>目标绑定：${h(row.binding_issues.join('；')||'本次未发现绑定差异')}</p>
     <div class="panel-actions">${this.button('edit','编辑该政策',locked,` data-fee-precision-id="${h(r.record_id)}"`)}${this.button('remove','删除该政策',locked,` data-fee-precision-id="${h(r.record_id)}"`)}${this.button('ack','记录算术政策确认',locked||!eligible,` data-fee-precision-id="${h(r.record_id)}"`)}</div><details><summary>完整成分、政策与逐步算术审计</summary><pre class="pair-original">${h(JSON.stringify({record:r,calculation:row.calculation,source:review.source_review.rows.find(x=>x.record_id===r.component_record_id)},null,2))}</pre></details></section>`;
   }).join(''):'<p>尚无政策记录。新增时明确选择成分和通道，未知不推定为零。</p>');show();
  }).catch(()=>{if(generation===this.reviewGeneration){this.reviewHtml='<p role="alert">核对暂未完成，原资料保留；请备份后重试。</p>';show();}});
 }
 field(path:string,value:string,typing=false):void{
  if(this.env.blocked())return;const e=this.controller.state().editor;if(!e)return;
  const text=changeFeePrecisionForm(e.record_json,e.record_id===null,path,value);
  if(text!==null&&text!==e.record_json){this.pending=null;this.typing=typing;try{this.controller.editText(text);}finally{this.typing=false;}}
 }
 private request(action:string,id:string):void{
  let raw:string|null|undefined;if(action.startsWith('clear-')){try{raw=this.env.storage.getItem(FEE_PRECISION_SELECTION_STORAGE_KEYS[action==='clear-editor'?'editor':'committed']);}catch{this.exportMessage='本机原文无法读取，未放弃或覆盖。';this.refresh();return;}}
  this.pending={action,id,token:crypto.randomUUID(),basis:this.basis(),raw};this.refresh();
 }
 async action(action:string,data:DOMStringMap):Promise<void>{
  if(this.env.blocked())return;const key=action.replace(/^fee-precision-/,''),s=this.controller.state(),id=data.feePrecisionId??'';
  try{
   if(key==='confirm'){
    const p=this.pending;this.pending=null;if(!p||p.token!==data.feePrecisionToken||p.basis!==this.basis()){this.exportMessage='确认期间资料已变化，未执行；请重新核对。';this.refresh();return;}await this.execute(p);return;
   }
   if(key==='cancel'){this.pending=null;this.controller.cancelRead();return;}
   if(s.mutation_busy)return;
   if(['create','remove','discard','rebind','clear-committed','clear-editor','adopt','restore'].includes(key)){this.request(key,id);return;}
   this.pending=null;
   if(key==='open'){if(!s.editor){const input=document.querySelector<HTMLInputElement>('#fee-precision-file-input');if(input){input.value='';input.click();}}return;}
   if(key==='recover'){await this.controller.prepareLocalRecovery();return;}
   if(key==='add'){if(s.source_is_current)this.controller.beginEdit();return;}
   if(key==='edit'){this.controller.beginEdit(id);return;}
   if(key==='start'){if(s.editor?.record_id===null&&s.editor.record_json==='')this.controller.editText(newFeePrecisionForm());return;}
   if(key==='submit'){await this.controller.submitEditor();return;}
   if(key==='ack'){await this.controller.acknowledge(id);return;}
   if(key==='save'){if(!this.exportBusy)await this.controller.save();return;}
   if(key==='backup-memory'){if(!this.exportBusy)await this.controller.backupMemory();return;}
   if(key==='backup-committed'||key==='backup-editor'){if(!this.exportBusy)await this.controller.backupLocalRaw(key==='backup-editor'?'editor':'committed');return;}
   if(key==='persist'){await this.controller.persistCurrent();return;}
   if(key==='html'||key==='xlsx')await this.export(key);
  }catch{this.exportMessage='操作未完成，资料保留；可先备份后重试。';this.refresh();}
 }
 private async execute(p:Pending):Promise<void>{
  const s=this.controller.state();if(s.mutation_busy)return;
  if(p.action==='create')await this.controller.createFromCurrentSources();
  else if(p.action==='remove')await this.controller.removeRecord(p.id);
  else if(p.action==='discard')this.controller.discardEditor();
  else if(p.action==='rebind')await this.controller.rebindToCurrentSources();
  else if(p.action==='adopt'&&s.preview?.token===Number(p.id))await this.controller.adoptPreview(s.preview.token);
  else if(p.action==='restore'&&s.recovery?.token===Number(p.id))this.controller.restoreLocal(s.recovery.token);
  else if(p.action==='clear-editor'||p.action==='clear-committed')this.exportMessage=this.controller.discardLocal(p.action==='clear-editor'?'editor':'committed',p.raw??null)?'已明确放弃所选本机原文，内存保留。':'本机原文已变化或不可写，未确认放弃；请备份后重试。';
  this.refresh();
 }
 private async export(kind:'html'|'xlsx'):Promise<void>{
  const s=this.controller.state(),live=this.live();if(!s.selection||s.editor||s.mutation_busy||s.write_busy||this.exportBusy||!s.source_is_current||!live)return;
  const a=s.selection,basis=this.basis();this.exportBusy=true;this.exportMessage='正在生成点击时的已提交内部快照…';this.refresh();
  try{
   const data=kind==='html'?await feePrecisionSelectionInternalHtml(a,live.pair_json,live.attachment_json):serializeWorkbook({audience:'INTERNAL',title:'内部精度政策假设',generatedAt:new Date().toISOString(),sheets:[await feePrecisionSelectionWorkbookSheet(a,live.pair_json,live.attachment_json)]});
   if(this.env.blocked())return;
   const result=await this.env.write('internal-fee-precision-selection.'+kind,data,kind==='html'?'text/html':XLSX_MIME);
   if(result!=='SAVED'&&result!=='DOWNLOAD_STARTED')throw Error('WRITE_RESULT');
   this.exportMessage=(result==='SAVED'?'已导出点击时内部快照。':'已发起内部快照下载，请确认落盘。')+(basis===this.basis()?'':' 期间资料已变化，本文件仅反映点击时资料。')+' 包含完整来源，请勿直接发送客户。';
  }catch(error){this.exportMessage=error instanceof Error&&error.name==='AbortError'?'已取消内部导出，资料保留。':'内部导出失败或超过Excel限额，原文保留；可另存JSON。';}
  finally{this.exportBusy=false;this.refresh();}
 }
 storageChanged(key:string|null):void{for(const value of Object.values(FEE_PRECISION_SELECTION_STORAGE_KEYS))if(key===null||key===value){this.pending=null;this.controller.storageChanged(value);}}
}
