import {unknownFileEvidence, openedFileEvidence, savedFileEvidence, type FileEvidence} from './file-evidence.js';
import type {WorkbenchStateOwner} from './workbench-state.js';
import type {FeePrecisionSelection} from '../domain/fee-precision-selection.js';
import {FEE_PRECISION_SELECTION_BYTES} from '../domain/fee-precision-selection.js';
import {createFeePrecisionSelection,parseFeePrecisionSelection,serializeFeePrecisionSelection,addFeePrecisionSelectionRecord,setFeePrecisionSelectionChoice,acknowledgeFeePrecisionSelectionRecord,removeFeePrecisionSelectionRecord,rebindFeePrecisionSelection} from '../data/fee-precision-selection.js';
import {startFeePrecisionSelectionEditor,validateFeePrecisionSelectionEditor,parseFeePrecisionSelectionEditor,readFeePrecisionSelectionEditorInput,feePrecisionSelectionEditorIsCurrent,type FeePrecisionSelectionEditor} from '../data/fee-precision-selection-editor.js';

export const FEE_PRECISION_SELECTION_STORAGE_KEYS={committed:'trade-cost-engine:fee-precision-selection-v1',editor:'trade-cost-engine:fee-precision-selection-editor-v1'} as const;
export type FeePrecisionStorageSlot=keyof typeof FEE_PRECISION_SELECTION_STORAGE_KEYS;
export interface FeePrecisionCurrentSources {pair_json:string;attachment_json:string}
export interface FeePrecisionSelectionControllerEnvironment {
 stateOwner?:WorkbenchStateOwner;
 storage:{getItem:(key:string)=>string|null;setItem:(key:string,value:string)=>void};
 currentSources:()=>FeePrecisionCurrentSources|null;blocked:()=>boolean;changed:()=>void;
 write:(name:string,text:string,mime:string)=>Promise<'SAVED'|'DOWNLOAD_STARTED'>;
}
type FileSource={size?:number;name?:string;text:()=>Promise<string>};
type Preview={token:number;epoch:number;selection:FeePrecisionSelection;live:FeePrecisionCurrentSources|null;file_evidence?:FileEvidence};
type Recovery=Preview&{raw:Record<FeePrecisionStorageSlot,string|null>;editor:FeePrecisionSelectionEditor|null};
const slots:FeePrecisionStorageSlot[]=['committed','editor'],KEYS=FEE_PRECISION_SELECTION_STORAGE_KEYS;
const lease=(a:FeePrecisionSelection)=>({revision:a.revision,content_sha256:a.content_sha256});
const sameLive=(a:FeePrecisionCurrentSources|null,b:FeePrecisionCurrentSources|null)=>a===null?b===null:b!==null&&a.pair_json===b.pair_json&&a.attachment_json===b.attachment_json;
const abort=(e:unknown)=>e instanceof Error&&e.name==='AbortError';
/** Injectable, independent orchestrator. Construction never reads global storage or installs sources. */
export class FeePrecisionSelectionController {
 private selection:FeePrecisionSelection|null=null;private editor:FeePrecisionSelectionEditor|null=null;
 private preview:Preview|null=null;private recovery:Recovery|null=null;
 private epoch=0;private readToken=0;private readingToken:number|null=null;private mutationBusy=false;private writeBusy=false;private notifying=false;
 private savedKey:string|null=null;private observedOnce=false;private observed=new Map<FeePrecisionStorageSlot,string|null>();
 private protectedSlots=new Set<FeePrecisionStorageSlot>();private writingSlots=new Set<FeePrecisionStorageSlot>();
 private storageStatus:Record<FeePrecisionStorageSlot,string|null>={committed:null,editor:null};
 private message='精度文件尚未载入；独立政策不应用费用。';
 private fileEvidence:FileEvidence=unknownFileEvidence();
 constructor(private readonly env:FeePrecisionSelectionControllerEnvironment){env.stateOwner?.bind(this,'precision-controller');}
 workbenchCapture(){return{...this.state(),file_evidence:this.fileEvidence,epoch:this.epoch,read_token:this.readToken,reading:this.readingToken!==null,saved_content_sha256:this.savedKey,preview:this.preview?structuredClone(this.preview):null,recovery:this.recovery?structuredClone(this.recovery):null,observed:Object.fromEntries(this.observed),protected_slots:[...this.protectedSlots],writing_slots:[...this.writingSlots]};}
 private blocked(){try{return!!this.env.blocked();}catch{return true;}}
 private live():FeePrecisionCurrentSources|null{try{const s=this.env.currentSources();return s&&typeof s.pair_json==='string'&&typeof s.attachment_json==='string'?{pair_json:s.pair_json,attachment_json:s.attachment_json}:null;}catch{return null;}}
 private current(a:FeePrecisionSelection,s:FeePrecisionCurrentSources|null){return!!s&&a.pair_snapshot_json===s.pair_json&&a.attachment_snapshot_json===s.attachment_json;}
 state(){const live=this.live();return{selection:this.selection?structuredClone(this.selection):null,editor:this.editor?structuredClone(this.editor):null,source_is_current:!!this.selection&&this.current(this.selection,live),editor_is_current:!!this.selection&&!!this.editor&&feePrecisionSelectionEditorIsCurrent(this.editor,this.selection),preview:this.preview?{token:this.preview.token,selection_id:this.preview.selection.selection_id,revision:this.preview.selection.revision}:null,recovery:this.recovery?{token:this.recovery.token,selection_id:this.recovery.selection.selection_id,has_editor:!!this.recovery.editor}:null,dirty:!!this.editor||!!this.selection&&this.savedKey!==this.selection.content_sha256,mutation_busy:this.mutationBusy,write_busy:this.writeBusy,storage_status:{...this.storageStatus},message:this.message};}
 private notify(message?:string){if(message!==undefined)this.message=message;if(this.notifying)return;this.notifying=true;try{this.env.changed();}catch{this.message='显示更新失败，内存和原文保留，请备份后重试。';}finally{this.notifying=false;}}
 private touch(){this.epoch++;this.readToken++;this.readingToken=null;this.preview=null;this.recovery=null;}
 private canAct(){return!this.blocked()&&!this.mutationBusy;}
 private unchanged(epoch:number,live:FeePrecisionCurrentSources|null){const blocked=this.blocked(),now=this.live();return!blocked&&epoch===this.epoch&&sameLive(now,live);}
 private observe(){if(this.observedOnce)return;this.observedOnce=true;for(const s of slots){try{const raw=this.env.storage.getItem(KEYS[s]);if(raw!==null&&typeof raw!=='string')throw Error();this.observed.set(s,raw);if(raw!==null&&raw!=='null'){this.protectedSlots.add(s);this.storageStatus[s]='PENDING_RECOVERY';}}catch{this.protectedSlots.add(s);this.storageStatus[s]='UNAVAILABLE';}}}
 private conflict(slot:FeePrecisionStorageSlot){this.protectedSlots.add(slot);this.storageStatus[slot]='CONFLICT';}
 private writeSlot(slot:FeePrecisionStorageSlot,text:string,epoch=this.epoch):boolean{
  this.observe();if(epoch!==this.epoch||this.protectedSlots.has(slot)||!this.observed.has(slot)||this.writingSlots.has(slot))return false;
  this.writingSlots.add(slot);try{
   const raw=this.env.storage.getItem(KEYS[slot]);if(epoch!==this.epoch)return false;if(raw!==this.observed.get(slot)){this.conflict(slot);return false;}
   this.env.storage.setItem(KEYS[slot],text);const after=this.env.storage.getItem(KEYS[slot]);
   if(after!==text){this.conflict(slot);return false;}if(this.protectedSlots.has(slot))return false;
   this.observed.set(slot,text);this.storageStatus[slot]=null;return epoch===this.epoch;
  }catch{this.protectedSlots.add(slot);this.storageStatus[slot]='WRITE_FAILED';return false;}finally{this.writingSlots.delete(slot);}
 }
 private persistEditor(epoch=this.epoch){return this.writeSlot('editor',this.editor?JSON.stringify(this.editor):'null',epoch);}
 private install(a:FeePrecisionSelection,text:string,editor:FeePrecisionSelectionEditor|null,saved=false,evidence?:FileEvidence){
  if(evidence)this.fileEvidence=evidence;else if(this.selection?.selection_id!==a.selection_id)this.fileEvidence=unknownFileEvidence();
  this.selection=a;this.editor=editor;this.savedKey=saved?a.content_sha256:null;this.touch();const epoch=this.epoch,ok=this.writeSlot('committed',text,epoch);
  if(ok&&epoch===this.epoch)this.persistEditor(epoch);return ok&&epoch===this.epoch&&slots.every(s=>this.storageStatus[s]===null);
 }
 cancelRead(){this.readToken++;this.readingToken=null;this.preview=null;this.recovery=null;this.notify('读取已取消，当前文件和未提交编辑保留。');}
 async createFromCurrentSources():Promise<boolean>{if(!this.canAct()||this.editor)return false;const s=this.live();if(!s)return false;return this.mutate(()=>createFeePrecisionSelection(s.pair_json,s.attachment_json),s,false);}
 beginEdit(record_id:string|null=null):boolean{
  if(!this.canAct()||!this.selection||this.editor)return false;
  try{this.editor=startFeePrecisionSelectionEditor(this.selection,record_id);this.touch();const ok=this.persistEditor();this.notify(ok?'已开始独立编辑，提交前不改变政策记录。':'编辑在内存保留，本机草稿受保护或不可写，请备份。');return true;}catch{this.notify('不能编辑该记录，当前资料保留。');return false;}
 }
 editText(text:string):boolean{if(this.blocked()||!this.editor)return false;try{this.editor=validateFeePrecisionSelectionEditor({...this.editor,record_json:text});this.touch();const ok=this.persistEditor();this.notify(ok?'未提交原文已保留，尚未记录政策或应用费用。':'未提交原文保留在内存，本机草稿未写入，请备份。');return true;}catch{this.notify('文本无效或超限，原编辑保留。');return false;}}
 discardEditor():boolean{if(this.blocked()||!this.editor)return false;this.editor=null;this.touch();this.persistEditor();this.notify('已明确放弃内存未提交编辑；受保护的本机原文仍保留。');return true;}
 async submitEditor():Promise<boolean>{
  if(!this.canAct()||!this.selection||!this.editor||!feePrecisionSelectionEditorIsCurrent(this.editor,this.selection))return false;
  const e=structuredClone(this.editor),s=this.live();if(!this.current(this.selection,s)){this.notify('完整双来源失配，编辑保留；须先明确核对来源。');return false;}
  try{const input=readFeePrecisionSelectionEditorInput(e);return this.mutate(a=>e.record_id===null?addFeePrecisionSelectionRecord(a,lease(a),input):setFeePrecisionSelectionChoice(a,lease(a),e.record_id!,input),s,true);}catch{this.notify('编辑未通过严格校验，原文和已提交记录保留。');return false;}
 }
 async acknowledge(record_id:string):Promise<boolean>{if(!this.canAct()||this.editor||!this.selection)return false;const s=this.live();if(!s)return false;return this.mutate(a=>acknowledgeFeePrecisionSelectionRecord(a,lease(a),s.pair_json,s.attachment_json,record_id),s,false);}
 async removeRecord(record_id:string):Promise<boolean>{if(!this.canAct()||this.editor||!this.selection)return false;return this.mutate(a=>removeFeePrecisionSelectionRecord(a,lease(a),record_id),this.live(),false);}
 async rebindToCurrentSources():Promise<boolean>{if(!this.canAct()||this.editor||!this.selection)return false;const s=this.live();if(!s)return false;return this.mutate(a=>rebindFeePrecisionSelection(a,lease(a),s.pair_json,s.attachment_json),s,false);}
 private async mutate(task:(a:FeePrecisionSelection)=>Promise<FeePrecisionSelection>,live:FeePrecisionCurrentSources|null,clearEditor:boolean):Promise<boolean>{
  if(!this.canAct())return false;this.mutationBusy=true;const epoch=this.epoch,a=this.selection?structuredClone(this.selection):null;this.notify('正在校验精度文件，原资料保留。');
  try{const result=await task(a!),text=await serializeFeePrecisionSelection(result);if(!this.unchanged(epoch,live))return false;const ok=this.install(result,text,clearEditor?null:this.editor);this.notify(ok?'独立政策已更新，请另存；原值和业务待办保持。':'独立政策已更新并保留在内存；本机草稿未完整写入，请备份。');return true;}
  catch{if(epoch===this.epoch)this.notify('操作未通过校验，文件和编辑原文保留。');return false;}finally{this.mutationBusy=false;this.notify();}
 }
 async openFile(file:FileSource):Promise<boolean>{
  if(!this.canAct()||this.editor)return false;const token=++this.readToken,epoch=this.epoch,live=this.live();this.readingToken=token;this.preview=null;this.recovery=null;this.notify('正在读取独立候选，不安装项目或成分附件。');
  try{if(file.size!==undefined&&(!Number.isFinite(file.size)||file.size<0||file.size>FEE_PRECISION_SELECTION_BYTES))throw Error('size');const text=await file.text(),selection=await parseFeePrecisionSelection(text);if(token!==this.readToken||!this.unchanged(epoch,live))return false;this.preview={token,epoch,live,selection,file_evidence:openedFileEvidence(text,file.name??null)};this.notify('文件候选已校验，明确采用后才替换本面板文件。');return true;}
  catch(e){if(token===this.readToken&&epoch===this.epoch)this.notify(abort(e)?'已取消读取，资料保留。':'读取失败，当前资料保留；原文件未改动。');return false;}
  finally{if(this.readingToken===token){this.readingToken=null;this.notify();}}
 }
 async adoptPreview(token:number):Promise<boolean>{
  if(!this.canAct()||this.editor||!this.preview||token!==this.preview.token||token!==this.readToken)return false;const p=this.preview;
  try{const text=await serializeFeePrecisionSelection(p.selection);if(this.preview!==p||token!==this.readToken||!this.unchanged(p.epoch,p.live))return false;const ok=this.install(p.selection,text,null,true,p.file_evidence);this.notify(ok?'已明确采用独立文件，未安装其中的项目或附件。':'已采用独立文件；本机旧草稿受保护，请保留备份。');return true;}catch{this.notify('候选采用失败，当前资料保留。');return false;}
 }
 async prepareLocalRecovery():Promise<boolean>{
  if(!this.canAct())return false;this.observe();const token=++this.readToken,epoch=this.epoch,live=this.live(),raw={} as Record<FeePrecisionStorageSlot,string|null>;this.preview=null;this.recovery=null;
  try{for(const s of slots){raw[s]=this.env.storage.getItem(KEYS[s]);if(raw[s]!==null&&typeof raw[s]!=='string')throw Error();this.observed.set(s,raw[s]);if(raw[s]!==null&&raw[s]!=='null'){this.protectedSlots.add(s);this.storageStatus[s]='PENDING_RECOVERY';}}
   if(raw.committed===null||raw.committed==='null'){this.notify('没有完整文件可恢复；孤立编辑原文仍可备份。');return false;}
   const selection=await parseFeePrecisionSelection(raw.committed),editor=raw.editor===null||raw.editor==='null'?null:parseFeePrecisionSelectionEditor(raw.editor);
   if(token!==this.readToken||!this.unchanged(epoch,live))return false;this.recovery={token,epoch,live,raw,selection,editor};this.notify('草稿候选已检查，须明确恢复，不自动重绑或确认。');return true;
  }catch{if(token===this.readToken&&epoch===this.epoch){for(const s of slots)if(raw[s]!==undefined&&raw[s]!==null&&raw[s]!=='null'){this.protectedSlots.add(s);this.storageStatus[s]='INVALID_OR_UNREADABLE';}this.notify('草稿不能完整恢复，原文未覆盖；请先备份。');}return false;}
 }
 restoreLocal(token:number):boolean{
  if(!this.canAct()||this.editor||!this.recovery||token!==this.recovery.token||token!==this.readToken)return false;const r=this.recovery;
  try{for(const s of slots)if(this.env.storage.getItem(KEYS[s])!==r.raw[s]){this.conflict(s);this.notify('恢复期间草稿已变化，请重新检查并保留两份备份。');return false;}}catch{this.notify('恢复前无法重读草稿，原资料保留。');return false;}
  if(!this.unchanged(r.epoch,r.live)||token!==this.readToken||this.editor)return false;
  if(this.selection?.selection_id===r.selection.selection_id&&this.selection.content_sha256!==r.selection.content_sha256&&r.selection.revision<=this.selection.revision){this.notify('旧修订或同修订分支冲突，未回退当前文件；请备份两份资料。');return false;}
  this.selection=r.selection;this.editor=r.editor;this.savedKey=null;this.fileEvidence=unknownFileEvidence();this.touch();for(const s of slots){this.protectedSlots.delete(s);this.storageStatus[s]=null;this.observed.set(s,r.raw[s]);}
  this.notify(this.editor&&!feePrecisionSelectionEditorIsCurrent(this.editor,this.selection)?'已明确恢复；编辑租约或槽位失配，原文保留，不能直接提交。':'已明确恢复独立文件和编辑；仍须另存，未应用费用。');return true;
 }
 storageChanged(key:string):void{const s=slots.find(s=>KEYS[s]===key);if(!s)return;this.observe();try{if(this.env.storage.getItem(key)===this.observed.get(s))return;}catch{}this.conflict(s);this.touch();this.notify('其他位置的草稿已变化，内存保留，不自动合并。');}
 discardLocal(slot:FeePrecisionStorageSlot,expectedRaw:string|null):boolean{
  if(!this.canAct()||!slots.includes(slot)||this.writingSlots.has(slot))return false;this.observe();const epoch=this.epoch;this.writingSlots.add(slot);
  try{const raw=this.env.storage.getItem(KEYS[slot]);if(raw!==expectedRaw||epoch!==this.epoch)return false;this.env.storage.setItem(KEYS[slot],'null');if(this.env.storage.getItem(KEYS[slot])!=='null'){this.conflict(slot);return false;}this.observed.set(slot,'null');if(epoch!==this.epoch){this.protectedSlots.add(slot);this.storageStatus[slot]='WRITE_INTERRUPTED';return false;}this.protectedSlots.delete(slot);this.storageStatus[slot]=null;this.touch();this.notify('已明确放弃所选本机原文；内存文件和编辑保持。');return true;}
  catch{this.protectedSlots.add(slot);this.storageStatus[slot]='WRITE_FAILED';return false;}finally{this.writingSlots.delete(slot);}
 }
 async persistCurrent():Promise<boolean>{
  if(!this.canAct()||!this.selection)return false;const epoch=this.epoch,live=this.live(),a=structuredClone(this.selection);
  try{const text=await serializeFeePrecisionSelection(a);if(!this.unchanged(epoch,live))return false;const ok=this.writeSlot('committed',text,epoch);if(ok&&epoch===this.epoch)this.persistEditor(epoch);const complete=ok&&epoch===this.epoch&&slots.every(s=>this.storageStatus[s]===null);this.notify(complete?'两份草稿已写入并读回；仍须文件备份。':'本机草稿未完整写入，内存资料保持。');return complete;}catch{this.notify('草稿写入前校验失败，内存资料保留。');return false;}
 }
 private async write(name:string,text:string,mime:string){const r=await this.env.write(name,text,mime);if(r!=='SAVED'&&r!=='DOWNLOAD_STARTED')throw Error('WRITE_RESULT');return r;}
 async save():Promise<boolean>{
  if(this.blocked()||this.writeBusy||!this.selection||this.editor)return false;const a=structuredClone(this.selection),epoch=this.epoch;this.writeBusy=true;this.notify('正在另存点击时文件，后续修改不会混入。');
  try{const text=await serializeFeePrecisionSelection(a),r=await this.write('internal-fee-precision-selection.json',text,'application/json');if(r==='SAVED'&&epoch===this.epoch&&this.selection?.content_sha256===a.content_sha256&&!this.editor){this.savedKey=a.content_sha256;this.fileEvidence=savedFileEvidence(text);}this.notify(r==='SAVED'?'已另存点击时文件；后续修改仍须保存。':'已发起下载，请确认落盘；待保存状态保留。');return true;}catch(e){this.notify(abort(e)?'已取消另存，资料和后续编辑保留。':'另存失败，资料和后续编辑保留。');return false;}finally{this.writeBusy=false;this.notify();}
 }
 async backupLocalRaw(slot:FeePrecisionStorageSlot):Promise<boolean>{
  if(this.blocked()||this.writeBusy||!slots.includes(slot))return false;let raw:string|null;const epoch=this.epoch;try{raw=this.env.storage.getItem(KEYS[slot]);}catch{this.notify('原文不可读取，未删除或覆盖。');return false;}if(raw===null||typeof raw!=='string'||this.writeBusy||this.blocked()||epoch!==this.epoch)return false;this.writeBusy=true;
  try{await this.write('internal-fee-precision-'+slot+'-raw.txt',raw,'text/plain');this.notify('已另存或发起原文备份，请确认落盘；原文未删除。');return true;}catch{this.notify('原文备份未完成，原文仍保留。');return false;}finally{this.writeBusy=false;this.notify();}
 }
 async backupMemory():Promise<boolean>{
  if(this.blocked()||this.writeBusy)return false;const a=this.selection?structuredClone(this.selection):null,e=this.editor?structuredClone(this.editor):null;this.writeBusy=true;
  try{const text=JSON.stringify({kind:'INTERNAL_FEE_PRECISION_MEMORY_BACKUP',version:'0.1',selection_json:a?await serializeFeePrecisionSelection(a):null,editor_json:e?JSON.stringify(e):null},null,2)+'\n';await this.write('internal-fee-precision-memory-backup.json',text,'application/json');this.notify('完整内存备份已另存或发起下载，含未提交编辑；保存状态保持。');return true;}catch{this.notify('内存备份未完成，当前资料保留。');return false;}finally{this.writeBusy=false;this.notify();}
 }
}
