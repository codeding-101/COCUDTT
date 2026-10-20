import {unknownFileEvidence, openedFileEvidence, savedFileEvidence, type FileEvidence} from './file-evidence.js';
import type {WorkbenchStateOwner} from './workbench-state.js';
import type {FeeTaxAttachment,FeeTaxAttachmentFacet} from '../domain/fee-tax-attachment.js';
import {FEE_TAX_ATTACHMENT_BYTES} from '../domain/fee-tax-attachment.js';
import {createFeeTaxAttachment,parseFeeTaxAttachment,serializeFeeTaxAttachment,setFeeTaxAttachmentRecord,acknowledgeFeeTaxAttachmentRecord,removeFeeTaxAttachmentRecord,rebindFeeTaxAttachment} from '../data/fee-tax-attachment.js';
import {startFeeTaxAttachmentEditor,validateFeeTaxAttachmentEditor,parseFeeTaxAttachmentEditor,readFeeTaxAttachmentEditorInput,feeTaxAttachmentEditorIsCurrent,type FeeTaxAttachmentEditor} from '../data/fee-tax-attachment-editor.js';

export const FEE_TAX_ATTACHMENT_STORAGE_KEYS={committed:'trade-cost-engine:fee-tax-attachment-v1',editor:'trade-cost-engine:fee-tax-attachment-editor-v1'} as const;
export type FeeTaxAttachmentStorageSlot=keyof typeof FEE_TAX_ATTACHMENT_STORAGE_KEYS;
export interface FeeTaxAttachmentControllerEnvironment {
 stateOwner?:WorkbenchStateOwner;
 storage:{getItem:(key:string)=>string|null;setItem:(key:string,value:string)=>void};
 currentPairText:()=>string|null;blocked:()=>boolean;changed:()=>void;
 write:(name:string,text:string,mime:string)=>Promise<'SAVED'|'DOWNLOAD_STARTED'>;
}
type FileSource={size?:number;name?:string;text:()=>Promise<string>};
type Slot=FeeTaxAttachmentStorageSlot;
type Recovery={token:number;epoch:number;raw:Record<Slot,string|null>;attachment:FeeTaxAttachment;editor:FeeTaxAttachmentEditor|null};
type Preview={token:number;epoch:number;attachment:FeeTaxAttachment;file_evidence?:FileEvidence};
const slots:Slot[]=['committed','editor'];
const lease=(a:FeeTaxAttachment)=>({revision:a.revision,content_sha256:a.content_sha256});
const abort=(error:unknown)=>error instanceof Error&&error.name==='AbortError';
/** Injectable attachment orchestrator. No global storage or project installation. */
export class FeeTaxAttachmentController {
 private attachment:FeeTaxAttachment|null=null;
 private editor:FeeTaxAttachmentEditor|null=null;
 private preview:Preview|null=null;private recovery:Recovery|null=null;
 private epoch=0;private readToken=0;private readingToken:number|null=null;private mutationBusy=false;private writeBusy=false;
 private savedKey:string|null=null;private observed=new Map<Slot,string|null>();private protectedSlots=new Set<Slot>();
 private storageStatus:Record<Slot,string|null>={committed:null,editor:null};private observedOnce=false;
 private message='附件尚未载入；独立资料不会自动替换项目或账单。';
 private fileEvidence:FileEvidence=unknownFileEvidence();
 constructor(private readonly env:FeeTaxAttachmentControllerEnvironment){env.stateOwner?.bind(this,'tax-controller');}
 workbenchCapture(){return{...this.state(),file_evidence:this.fileEvidence,epoch:this.epoch,read_token:this.readToken,reading:this.readingToken!==null,saved_content_sha256:this.savedKey,preview:this.preview?structuredClone(this.preview):null,recovery:this.recovery?structuredClone(this.recovery):null,observed:Object.fromEntries(this.observed),protected_slots:[...this.protectedSlots]};}
 state(){return{attachment:this.attachment?structuredClone(this.attachment):null,editor:this.editor?structuredClone(this.editor):null,source_is_current:!!this.attachment&&this.live()===this.attachment.pair_snapshot_json,editor_is_current:!!this.attachment&&!!this.editor&&feeTaxAttachmentEditorIsCurrent(this.editor,this.attachment),preview:this.preview?{token:this.preview.token,attachment_id:this.preview.attachment.attachment_id,revision:this.preview.attachment.revision}:null,recovery:this.recovery?{token:this.recovery.token,attachment_id:this.recovery.attachment.attachment_id,has_editor:!!this.recovery.editor}:null,dirty:!!this.editor||!!this.attachment&&this.savedKey!==this.attachment.content_sha256,mutation_busy:this.mutationBusy,write_busy:this.writeBusy,storage_status:{...this.storageStatus},message:this.message};}
 private notify(message?:string){if(message!==undefined)this.message=message;try{this.env.changed();}catch{this.message='显示更新失败，内存附件与原文保留，请备份后重试。';}}
 private touch(){this.epoch++;this.readToken++;this.readingToken=null;this.preview=null;this.recovery=null;}
 private live(){try{return this.env.currentPairText();}catch{return null;}}
 private canAct(){return!this.env.blocked()&&!this.mutationBusy;}
 private observe(){if(this.observedOnce)return;this.observedOnce=true;for(const slot of slots){try{const raw=this.env.storage.getItem(FEE_TAX_ATTACHMENT_STORAGE_KEYS[slot]);this.observed.set(slot,raw);if(raw!==null&&raw!=='null'){this.protectedSlots.add(slot);this.storageStatus[slot]='PENDING_RECOVERY';}}catch{this.protectedSlots.add(slot);this.storageStatus[slot]='UNAVAILABLE';}}}
 private writeSlot(slot:Slot,text:string):boolean{
  this.observe();if(this.protectedSlots.has(slot)||!this.observed.has(slot))return false;
  const key=FEE_TAX_ATTACHMENT_STORAGE_KEYS[slot];
  try{
   const raw=this.env.storage.getItem(key);if(raw!==this.observed.get(slot)){this.protectedSlots.add(slot);this.storageStatus[slot]='CONFLICT';return false;}
   this.env.storage.setItem(key,text);
   if(this.env.storage.getItem(key)!==text){this.protectedSlots.add(slot);this.storageStatus[slot]='CONFLICT';return false;}
   this.observed.set(slot,text);this.storageStatus[slot]=null;return true;
  }catch{this.protectedSlots.add(slot);this.storageStatus[slot]='WRITE_FAILED';return false;}
 }
 private persistEditor(){return this.writeSlot('editor',this.editor?JSON.stringify(this.editor):'null');}
 private install(a:FeeTaxAttachment,text:string,editor:FeeTaxAttachmentEditor|null,saved=false,evidence?:FileEvidence){
  if(evidence)this.fileEvidence=evidence;else if(this.attachment?.attachment_id!==a.attachment_id)this.fileEvidence=unknownFileEvidence();
  this.attachment=a;this.editor=editor;this.savedKey=saved?a.content_sha256:null;this.touch();const epoch=this.epoch;
  const committed=this.writeSlot('committed',text);
  // Storage adapters can reenter; never clear an editor created during the committed write.
  const edited=epoch!==this.epoch;if(committed&&!edited)this.persistEditor();
  return committed&&!edited&&slots.every(s=>this.storageStatus[s]===null);
 }
 cancelRead(){this.readToken++;this.readingToken=null;this.preview=null;this.recovery=null;this.notify('读取已取消，当前附件和未提交编辑保留。');}
 async createFromCurrentPair():Promise<boolean>{
  if(!this.canAct()||this.editor)return false;const pair=this.live();if(pair===null)return false;
  return this.mutate(async()=>createFeeTaxAttachment(pair),pair,false);
 }
 beginEdit(record_id:string|null=null):boolean{
  if(!this.canAct()||!this.attachment||this.editor)return false;
  try{this.editor=startFeeTaxAttachmentEditor(this.attachment,record_id);this.touch();const cached=this.persistEditor();this.notify(cached?'已开始独立编辑，提交前不会改变已保存记录。':'编辑已保留在内存，本机草稿受保护或不可写，请备份。');return true;}catch{this.notify('无法开始该记录的编辑，资料保留。');return false;}
 }
 editText(text:string):boolean{
  if(this.env.blocked()||!this.editor)return false;
  try{this.editor=validateFeeTaxAttachmentEditor({...this.editor,record_json:text});this.touch();const cached=this.persistEditor();this.notify(cached?'未提交编辑已保留，尚未确认或应用。':'未提交编辑保留在内存，本机草稿未写入，请备份。');return true;}catch{this.notify('编辑内容无效或超限，原文保留。');return false;}
 }
 discardEditor():boolean{
  if(this.env.blocked()||!this.editor)return false;this.editor=null;this.touch();this.persistEditor();this.notify('已明确放弃内存中的未提交编辑；受保护的本机原文仍可备份。');return true;
 }
 async submitEditor():Promise<boolean>{
  if(!this.canAct()||!this.attachment||!this.editor||!feeTaxAttachmentEditorIsCurrent(this.editor,this.attachment))return false;
  const editor=structuredClone(this.editor),pair=this.live();if(pair!==this.attachment.pair_snapshot_json){this.notify('当前配对来源失配，编辑保留；须先明确核对来源。');return false;}
  try{const input=readFeeTaxAttachmentEditorInput(editor);return await this.mutate(a=>setFeeTaxAttachmentRecord(a,lease(a),input,editor.record_id),pair,true);}catch{this.notify('编辑尚未通过完整校验，原文与已提交记录保留。');return false;}
 }
 async acknowledge(record_id:string,facet:FeeTaxAttachmentFacet):Promise<boolean>{
  if(!this.canAct()||this.editor||!this.attachment)return false;const pair=this.live();if(pair===null)return false;
  return this.mutate(a=>acknowledgeFeeTaxAttachmentRecord(a,lease(a),pair,record_id,facet),pair,false);
 }
 async removeRecord(record_id:string):Promise<boolean>{if(!this.canAct()||this.editor||!this.attachment)return false;return this.mutate(a=>removeFeeTaxAttachmentRecord(a,lease(a),record_id),this.live(),false);}
 async rebindToCurrentPair():Promise<boolean>{
  if(!this.canAct()||this.editor||!this.attachment)return false;const pair=this.live();if(pair===null)return false;
  return this.mutate(a=>rebindFeeTaxAttachment(a,lease(a),pair),pair,false);
 }
 private async mutate(task:(a:FeeTaxAttachment)=>Promise<FeeTaxAttachment>,pair:string|null,clearEditor:boolean):Promise<boolean>{
  if(!this.canAct())return false;this.mutationBusy=true;const epoch=this.epoch,a=this.attachment?structuredClone(this.attachment):null;this.notify('正在校验独立附件，原资料保留。');
  try{
   const result=await task(a!),text=await serializeFeeTaxAttachment(result);
   if(epoch!==this.epoch||this.env.blocked()||this.live()!==pair)return false;
   const cached=this.install(result,text,clearEditor?null:this.editor);this.notify(cached?'独立附件已更新，请另存；原项目和费用保持。':'独立附件已更新并保留在内存；本机草稿未完整写入，请另存或备份。');return true;
  }catch{if(epoch===this.epoch)this.notify('操作未通过校验，附件和编辑原文保留。');return false;}
  finally{this.mutationBusy=false;this.notify();}
 }
 async openFile(file:FileSource):Promise<boolean>{
  if(!this.canAct()||this.editor)return false;const token=++this.readToken,epoch=this.epoch;this.readingToken=token;this.preview=null;this.recovery=null;this.notify('正在读取附件候选，不替换当前项目或账单。');
  try{
   if(file.size!==undefined&&(!Number.isFinite(file.size)||file.size<0||file.size>FEE_TAX_ATTACHMENT_BYTES))throw Error('size');
   const text=await file.text(),attachment=await parseFeeTaxAttachment(text);
   if(token!==this.readToken||epoch!==this.epoch||this.env.blocked())return false;
   this.preview={token,epoch,attachment,file_evidence:openedFileEvidence(text,file.name??null)};this.notify('附件候选已校验；明确采用后才替换本面板附件，项目和账单保持。');return true;
  }catch(error){if(token===this.readToken&&epoch===this.epoch)this.notify(abort(error)?'已取消读取，当前资料保留。':'附件读取失败，当前资料保留；原文件仍可备份。');return false;}
  finally{if(this.readingToken===token){this.readingToken=null;this.notify();}}
 }
 async adoptPreview(token:number):Promise<boolean>{
  if(!this.canAct()||this.editor||!this.preview||this.preview.token!==token||token!==this.readToken)return false;const p=this.preview;
  const text=await serializeFeeTaxAttachment(p.attachment);
  if(this.preview!==p||p.epoch!==this.epoch||token!==this.readToken||this.env.blocked())return false;
  const cached=this.install(p.attachment,text,null,true,p.file_evidence);this.notify(cached?'已明确采用独立附件，未安装其中的项目或账单。':'已采用独立附件；本机旧草稿受保护，未被覆盖。');return true;
 }
 async prepareLocalRecovery():Promise<boolean>{
  if(this.env.blocked())return false;this.observe();const token=++this.readToken,epoch=this.epoch,raw={} as Record<Slot,string|null>;this.recovery=null;this.preview=null;
  try{
   for(const s of slots){raw[s]=this.env.storage.getItem(FEE_TAX_ATTACHMENT_STORAGE_KEYS[s]);this.observed.set(s,raw[s]);if(raw[s]!==null&&raw[s]!=='null'){this.protectedSlots.add(s);this.storageStatus[s]='PENDING_RECOVERY';}}
   if(raw.committed===null||raw.committed==='null'){this.notify('没有完整附件可恢复；独立编辑原文仍保留供备份。');return false;}
   const attachment=await parseFeeTaxAttachment(raw.committed),editor=raw.editor===null||raw.editor==='null'?null:parseFeeTaxAttachmentEditor(raw.editor);
   if(token!==this.readToken||epoch!==this.epoch||this.env.blocked())return false;
   this.recovery={token,epoch,raw,attachment,editor};this.notify('本机附件与编辑已检查；须明确恢复，不自动安装或重新确认。');return true;
  }catch{if(token===this.readToken&&epoch===this.epoch){for(const s of slots)if(raw[s]!==undefined&&raw[s]!==null&&raw[s]!=='null'){this.protectedSlots.add(s);this.storageStatus[s]='INVALID_OR_UNREADABLE';}this.notify('本机草稿不能完整恢复，原文未覆盖；请先备份。');}return false;}
 }
 restoreLocal(token:number):boolean{
  if(!this.canAct()||this.editor||!this.recovery||this.recovery.token!==token||token!==this.readToken||this.recovery.epoch!==this.epoch)return false;const r=this.recovery;
  try{if(slots.some(s=>this.env.storage.getItem(FEE_TAX_ATTACHMENT_STORAGE_KEYS[s])!==r.raw[s])){this.notify('恢复期间本机草稿已变化，原资料保留，请重新检查。');return false;}}
  catch{this.notify('恢复前无法重读本机草稿，资料保留。');return false;}
  if(r.epoch!==this.epoch||token!==this.readToken||this.editor||this.env.blocked())return false;
  this.attachment=r.attachment;this.editor=r.editor;this.savedKey=null;this.fileEvidence=unknownFileEvidence();this.touch();for(const s of slots){this.protectedSlots.delete(s);this.storageStatus[s]=null;this.observed.set(s,r.raw[s]);}
  this.notify(this.editor&&!feeTaxAttachmentEditorIsCurrent(this.editor,this.attachment)?'已明确恢复；旧编辑来源失配，原文保留，不能直接提交。':'已明确恢复独立附件/编辑，尚未另存；未替换项目或账单。');return true;
 }
 storageChanged(key:string):void{
  const slot=slots.find(s=>FEE_TAX_ATTACHMENT_STORAGE_KEYS[s]===key);if(!slot)return;this.observe();
  try{if(this.env.storage.getItem(key)===this.observed.get(slot))return;}catch{}
  this.protectedSlots.add(slot);this.storageStatus[slot]='CONFLICT';this.touch();this.notify('本机草稿在其他位置变化，内存资料保留；不自动合并或覆盖。');
 }
 discardLocal(slot:Slot,expectedRaw:string|null):boolean{
  if(this.env.blocked()||!slots.includes(slot))return false;this.observe();const key=FEE_TAX_ATTACHMENT_STORAGE_KEYS[slot];
  try{if(this.env.storage.getItem(key)!==expectedRaw)return false;this.env.storage.setItem(key,'null');if(this.env.storage.getItem(key)!=='null')throw Error();this.observed.set(slot,'null');this.protectedSlots.delete(slot);this.storageStatus[slot]=null;this.touch();this.notify('已明确放弃所选本机草稿；内存附件与编辑保持。');return true;}
  catch{this.protectedSlots.add(slot);this.storageStatus[slot]='WRITE_FAILED';return false;}
 }
 async persistCurrent():Promise<boolean>{
  if(!this.canAct()||!this.attachment)return false;const epoch=this.epoch,text=await serializeFeeTaxAttachment(this.attachment);if(epoch!==this.epoch||this.env.blocked())return false;
  const ok=this.writeSlot('committed',text);if(ok)this.persistEditor();this.notify(ok&&slots.every(s=>this.storageStatus[s]===null)?'本机草稿已写入并读回；仍须另存文件备份。':'本机草稿未完整写入，内存资料保持。');return ok&&slots.every(s=>this.storageStatus[s]===null);
 }
 async save():Promise<boolean>{
  if(this.env.blocked()||this.writeBusy||!this.attachment||this.editor)return false;const a=structuredClone(this.attachment),epoch=this.epoch;this.writeBusy=true;this.notify('正在另存点击时附件；后续编辑不会改变该文件。');
  try{const text=await serializeFeeTaxAttachment(a),result=await this.env.write('internal-fee-tax-attachment.json',text,'application/json');
   if(result==='SAVED'&&epoch===this.epoch&&this.attachment?.content_sha256===a.content_sha256&&!this.editor){this.savedKey=a.content_sha256;this.fileEvidence=savedFileEvidence(text);}
   this.notify(result==='SAVED'?'已另存点击时附件；后续修改或未提交编辑须再次保存。':'已发起附件下载，请确认落盘；待保存状态保留。');return true;
  }catch(error){this.notify(abort(error)?'已取消另存，附件与后续编辑保留。':'另存失败，附件与后续编辑保留。');return false;}
  finally{this.writeBusy=false;this.notify();}
 }
 async backupLocalRaw(slot:Slot):Promise<boolean>{
  if(this.env.blocked()||this.writeBusy||!slots.includes(slot))return false;let raw:string|null;
  try{raw=this.env.storage.getItem(FEE_TAX_ATTACHMENT_STORAGE_KEYS[slot]);}catch{this.notify('原文目前无法读取，未删除或覆盖。');return false;}if(raw===null)return false;
  this.writeBusy=true;try{await this.env.write('internal-fee-tax-'+slot+'-raw.txt',raw,'text/plain');this.notify('已另存或发起本机原文备份；原文未删除，请确认落盘。');return true;}catch{this.notify('原文备份未完成，本机原文保留。');return false;}finally{this.writeBusy=false;this.notify();}
 }
 async backupMemory():Promise<boolean>{
  if(this.env.blocked()||this.writeBusy)return false;const a=this.attachment?structuredClone(this.attachment):null,e=this.editor?structuredClone(this.editor):null;this.writeBusy=true;
  try{const text=JSON.stringify({kind:'INTERNAL_FEE_TAX_MEMORY_BACKUP',version:'0.1',attachment_json:a?await serializeFeeTaxAttachment(a):null,editor_json:e?JSON.stringify(e):null},null,2)+'\n';await this.env.write('internal-fee-tax-memory-backup.json',text,'application/json');this.notify('已另存或发起完整内存备份，含未提交编辑；不改变附件保存状态。');return true;}
  catch{this.notify('内存备份未完成，当前资料保留。');return false;}finally{this.writeBusy=false;this.notify();}
 }
}
