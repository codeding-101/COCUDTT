import type {ProjectFile} from '../data/project-file.js';
import type {ContainerBillDraft} from '../domain/container-bill-draft.js';
import type {ContainerCostPair} from '../domain/container-cost-pair.js';
import type {ContainerCostProposalInput} from '../domain/container-cost-proposal.js';
import {createContainerCostPair,updateContainerCostPair,parseContainerCostPair,serializeContainerCostPair,reviewContainerCostPair,CONTAINER_COST_PAIR_BYTES,enableContainerCostReview,containerCostPairBusiness,replaceContainerCostReviewPlan} from '../data/container-cost-pair.js';
import {emptyEvidence,evidenceKey} from '../domain/source-evidence.js';
import {confirmContainerCostIntent} from '../engine/container-cost-proposal.js';
import {reviewContainerBillDraft} from '../engine/container-bill-draft.js';
import {COST_EDITOR_FIELDS,COST_EDITOR_STORAGE_KEY,validateContainerCostEditor,startContainerCostEditor,copyContainerCostFacts,buildContainerCostIntent,containerCostEditorIsCurrent,type ContainerCostEditor} from '../data/container-cost-editor.js';
import {copyContainerBusiness} from '../data/container-business-copy.js';
import {REVIEW_EDITOR_STORAGE_KEY,REVIEW_EDITOR_FIELDS,validateContainerReviewEditor,startContainerReviewEditor,containerReviewEditorIsCurrent,containerReviewTargets,buildContainerReviewRecord,type ContainerReviewEditor,type ReviewEditorField} from '../data/container-review-editor.js';
import {setContainerReviewRecord,confirmContainerReviewRecord,removeContainerReviewRecord,reviewContainerCostReviewPlan} from '../data/container-cost-review-plan.js';
import {containerReviewExample} from '../data/container-review-example.js';
export const PAIR_STORAGE_KEY='trade-cost-engine:container-cost-pair-v1';
type PairReview=ReturnType<typeof reviewContainerCostPair>;
interface Environment {
 project:()=>ProjectFile;bill:()=>ContainerBillDraft|null;blocked:()=>boolean;render:()=>void;
 install:(pair:ContainerCostPair)=>void;afterInstall:()=>void;cancelOtherReads:()=>void;
 write:(name:string,text:string,mime:string)=>Promise<'SAVED'|'DOWNLOAD_STARTED'>;
 inputIssues?:()=>string[];
}
export function pairLiveIssues(pair:ContainerCostPair,project:ProjectFile,bill:ContainerBillDraft|null):string[]{
 const key=(v:unknown)=>evidenceKey(v,emptyEvidence()),issues:string[]=[];
 try{if(key(pair.project)!==key(project))issues.push('PROJECT_SNAPSHOT_MISMATCH');if(!bill)issues.push('BILL_SNAPSHOT_MISSING');else if(key(pair.bill)!==key(bill))issues.push('BILL_SNAPSHOT_MISMATCH');}catch{issues.push('CURRENT_INPUT_REVIEW_REQUIRED');}return issues;
}
/** Own draft and read epoch. Opening commits a validated pair before any recompute/render. */
export class ContainerCostPairController {
 pair:ContainerCostPair|null=null;review:PairReview|null=null;busy=false;message='尚无配对快照；先另存自己的资料，再捕获或打开配对文件。';
 editor:ContainerCostEditor|null=null;
 reviewEditor:ContainerReviewEditor|null=null;reviewPage=0;
 private reviewCache:{key:string;report:ReturnType<typeof reviewContainerCostReviewPlan>}|null=null;
 private targetCache:{key:string;decision:string;options:ReturnType<typeof containerReviewTargets>}|null=null;
 copyName='';copyAcknowledged=false;copyCandidate:{pair:ContainerCostPair;text:string;source_pair_id:string;source_revision:number}|null=null;
 private copyKey:string|null=null;
 private epoch=0;private loaded=false;
 constructor(private readonly env:Environment){}
 cancelReads():void {this.epoch++;if(this.message.startsWith('正在读取'))this.message='配对读取已取消，当前资料保留。';}
 liveIssues():string[]{return[...(this.env.inputIssues?.()??[]),...(this.pair?pairLiveIssues(this.pair,this.env.project(),this.env.bill()):[])];}
 loadLocal():void {
  if(this.loaded)return;this.loaded=true;
  try{const raw=localStorage.getItem(PAIR_STORAGE_KEY);if(raw!==null&&raw!=='null'){try{const pair=parseContainerCostPair(raw),review=reviewContainerCostPair(pair);this.pair=pair;this.review=review;this.message='已恢复独立配对快照，仅核对当前资料；未自动替换项目或账单，请另存文件。';}catch{this.message='配对草稿无法读取，原文未覆盖；请备份后再捕获或打开资料。';}}}catch{this.message='配对自动草稿不可用，请另存配对文件。';}
  try{const raw=localStorage.getItem(COST_EDITOR_STORAGE_KEY);if(raw!==null&&raw!=='null'){const editor:unknown=JSON.parse(raw);validateContainerCostEditor(editor);this.editor=editor;this.message+=' 已恢复未提交编辑，仍绑定原修订；请核对后提交或明确放弃。';}}catch{this.message+=' 编辑草稿无法读取，原文未覆盖；新建编辑前请备份。';}
  try{const raw=localStorage.getItem(REVIEW_EDITOR_STORAGE_KEY);if(raw!==null&&raw!=='null'){const editor:unknown=JSON.parse(raw);validateContainerReviewEditor(editor);this.reviewEditor=editor;this.message+=' 已恢复未提交核对记录，须提交或明确放弃。';}}catch{this.message+=' 核对记录草稿无法读取，原文保留，请先备份。';}
 }
 reviewState(){
  if(!this.pair||this.pair.version!=='1.1')return null;
  try{if(this.reviewCache?.key!==this.pair.content_key)this.reviewCache={key:this.pair.content_key,report:reviewContainerCostReviewPlan(this.pair.review_plan!,containerCostPairBusiness(this.pair))};return this.reviewCache.report;}catch{return null;}
 }
 reviewTargets(){
  if(!this.pair||!this.reviewEditor)return[];const decision=this.reviewEditor.fields.decision;
  try{if(this.targetCache?.key!==this.pair.content_key||this.targetCache.decision!==decision)this.targetCache={key:this.pair.content_key,decision,options:containerReviewTargets(this.pair,decision)};return this.targetCache.options;}catch{return[];}
 }
 private persistReviewEditor(){try{localStorage.setItem(REVIEW_EDITOR_STORAGE_KEY,JSON.stringify(this.reviewEditor));}catch{this.message+=' 核对编辑草稿保存失败，内存保留，请勿刷新。';}}
 editReview(dataset:DOMStringMap,value:string):void {
  if(!this.reviewEditor||this.busy||this.env.blocked()||!REVIEW_EDITOR_FIELDS.some(f=>f===dataset.pairReviewField))return;
  const field=dataset.pairReviewField as ReviewEditorField;if(this.reviewEditor.original_record_id&&['decision','target'].includes(field))return;
  this.cancelReads();if(Array.from(value).length>4000){this.message='核对字段超过4000字符，原值保留。';this.env.render();return;}
  if(field==='decision'&&value!==this.reviewEditor.fields.decision)this.reviewEditor.fields.target='';
  this.reviewEditor.fields[field]=value;this.message='核对编辑尚未提交；保存记录后须单独确认来源，原费用及待办保持。';this.persistReviewEditor();this.env.render();
 }
 private persistEditor():void {
  try{localStorage.setItem(COST_EDITOR_STORAGE_KEY,JSON.stringify(this.editor));}catch{this.message+=' 编辑自动草稿保存失败，内存保留，请勿刷新。';}
 }
 edit(dataset:DOMStringMap,value:string):void {
  if(!this.editor||this.busy||this.env.blocked()||!COST_EDITOR_FIELDS.some(k=>k===dataset.pairEditorField))return;
  this.cancelReads();const key=dataset.pairEditorField as keyof ContainerCostEditor['fields'];
  // Bound before changing memory; no truncated replacement for a user's original text.
  if(Array.from(value).length>4000){this.message='编辑字段超过4000字符，原值保留。';this.env.render();return;}
  this.editor.fields[key]=value;this.message='编辑尚未提交；提交后另存配对，费用仍未应用。修改后的旧来源确认不能沿用。';this.persistEditor();this.env.render();
 }
 private set(pair:ContainerCostPair|null,review:PairReview|null,message:string):void {
  this.epoch++;this.pair=pair;this.review=review;this.message=message;this.copyAcknowledged=false;this.copyKey=null;
  try{localStorage.setItem(PAIR_STORAGE_KEY,pair?serializeContainerCostPair(pair):'null');}catch{this.message+=' 自动草稿保存失败；内存保留，请另存配对文件。';}
 }
 editCopy(dataset:DOMStringMap,value:string,checked=false):void {
  if(this.busy||this.env.blocked())return;const field=dataset.pairCopyField;
  if(field!=='name'&&field!=='acknowledged')return;this.cancelReads();
  if(field==='name'){
   if(Array.from(value).length>200){this.message='新业务名称超过200字符，原值保留。';this.env.render();return;}
   this.copyName=value;this.copyAcknowledged=false;this.copyKey=null;
  }else{this.copyAcknowledged=checked;this.copyKey=checked?this.pair?.content_key??null:null;}
  this.message='业务复制输入仅保留本页；生成的副本须另存后再打开复核，原资料保留。';this.env.render();
 }
 action(action:string,dataset:DOMStringMap={}):void {
  if(this.busy||this.env.blocked())return;
  try{
   if(action==='pair-review-discard'){this.reviewEditor=null;this.cancelReads();this.persistReviewEditor();this.message='已明确放弃未提交核对编辑，已保存记录保留。';this.env.render();return;}
   if(this.reviewEditor&&action!=='pair-review-submit')throw Error('review_editor_pending');
   if(action==='pair-editor-discard'){this.editor=null;this.message='已明确放弃未提交编辑；已保存选择保留。';this.cancelReads();this.persistEditor();this.env.render();return;}
   if(this.editor&&!['pair-editor-facts','pair-editor-submit'].includes(action))throw Error('editor_pending');
   if(action==='pair-review-example'){
    const pair=containerReviewExample(),review=reviewContainerCostPair(pair);this.cancelReads();this.env.cancelOtherReads();this.env.install(pair);
    this.set(pair,review,'已打开合成核对体验示例（替换项目和账单）；原资料请以自己的另存文件为准。示例不能直接确认，费用未应用。');this.env.afterInstall();return;
   }
   if(action==='pair-review-next'||action==='pair-review-prev'){this.reviewPage=Math.max(0,this.reviewPage+(action==='pair-review-next'?1:-1));this.cancelReads();this.env.render();return;}
   if(action==='pair-review-enable'){
    if(!this.pair||this.liveIssues().length)throw Error('review_context');const pair=enableContainerCostReview(this.pair,this.pair.content_key);
    this.set(pair,reviewContainerCostPair(pair),'已明确启用配对1.1核对记录；请另存新文件。业务修订不变，未应用费用。');this.env.render();return;
   }
   if(action==='pair-review-start'||action==='pair-review-edit'){
    if(!this.pair||this.liveIssues().length)throw Error('review_context');this.reviewEditor=startContainerReviewEditor(this.pair,action==='pair-review-edit'?dataset.reviewRecord??null:null);
    this.cancelReads();this.message='已开始独立核对编辑；明确选择类型、目标及来源，不自动确认。';this.persistReviewEditor();this.env.render();return;
   }
   if(action==='pair-review-submit'||action==='pair-review-confirm'||action==='pair-review-remove'){
    if(!this.pair||this.pair.version!=='1.1'||this.liveIssues().length)throw Error('review_context');
    const current=this.pair,business=containerCostPairBusiness(current),plan=current.review_plan!;let updated;
    if(action==='pair-review-submit'){
     if(!this.reviewEditor||!containerReviewEditorIsCurrent(this.reviewEditor,current))throw Error('review_editor_stale');
     updated=setContainerReviewRecord(plan,plan.content_key,business,buildContainerReviewRecord(this.reviewEditor,current));
    }else{if(!dataset.reviewRecord)throw Error('review_record');updated=action==='pair-review-confirm'?confirmContainerReviewRecord(plan,plan.content_key,business,dataset.reviewRecord):removeContainerReviewRecord(plan,plan.content_key,dataset.reviewRecord);}
    const pair=replaceContainerCostReviewPlan(current,current.content_key,updated);this.set(pair,reviewContainerCostPair(pair),action==='pair-review-submit'?'核对记录已保存到配对草稿，请单独确认来源并另存配对文件；原待办与费用保持。':action==='pair-review-confirm'?'已记录用户来源确认；这是假设记录，原待办与费用保持。':'核对记录已移除，退休编号保留；费用保持。');
    if(action==='pair-review-submit'){this.reviewEditor=null;this.persistReviewEditor();}this.env.render();return;
   }
   if(action==='pair-copy-discard'){this.copyCandidate=null;this.copyAcknowledged=false;this.copyKey=null;this.cancelReads();this.message='已明确放弃内存副本候选；当前业务资料及已下载文件保留。';this.env.render();return;}
   if(action==='pair-copy-prepare'){
    if(!this.pair||this.copyCandidate||this.liveIssues().length||!this.copyAcknowledged||this.copyKey!==this.pair.content_key)throw Error('copy_context');
    const source=this.pair,copied=copyContainerBusiness(source,this.copyKey,this.copyName,new Date().toISOString()),text=serializeContainerCostPair(copied);
    this.copyCandidate={pair:copied,text,source_pair_id:source.pair_id,source_revision:source.revision};this.copyAcknowledged=false;this.copyKey=null;this.cancelReads();
    this.message='新业务副本已生成并冻结在本页内存；请另存后再打开复核。原项目/账单/提案及保存状态未改，未应用费用。';this.env.render();return;
   }
   if(action==='pair-copy-save'){
    if(!this.copyCandidate)throw Error('copy_missing');this.cancelReads();void this.saveCopy(this.copyCandidate.text);return;
   }
   if(action==='pair-editor-start'){
    if(!this.pair||this.liveIssues().length||!dataset.pairLine)throw Error('editor_context');
    const editor=startContainerCostEditor(this.pair,dataset.pairLine);validateContainerCostEditor(editor);this.editor=editor;this.cancelReads();this.message='已开始未提交编辑；请明确取用账单事实并选择全部业务条件，不会生成实际费用。';this.persistEditor();this.env.render();return;
   }
   if(action==='pair-editor-facts'||action==='pair-editor-submit'){
    if(!this.pair||!this.editor||this.liveIssues().length||!containerCostEditorIsCurrent(this.editor,this.pair))throw Error('editor_stale');
    if(action==='pair-editor-facts'){
     const amount=reviewContainerBillDraft(this.pair.bill,this.pair.project).rows.find(r=>r.line_id===this.editor!.line_id)?.calculation?.amount??null;
     this.editor=copyContainerCostFacts(this.editor,this.pair,amount);this.cancelReads();this.message='已取用原币账单事实，未推定承担、税务、汇率类型或确认来源。';this.persistEditor();this.env.render();return;
    }
    const intent=buildContainerCostIntent(this.editor,this.pair),selection=structuredClone(this.pair.selection);
    const index=selection.intents.findIndex(i=>i.line_id===intent.line_id);
    if(index<0)selection.intents.push(intent);else{if(selection.intents[index]!.operation!=='CREATE_NEW')throw Error('reference');selection.intents[index]=intent;}
    const pair=updateContainerCostPair(this.pair,this.pair.content_key,this.pair.project,this.pair.bill,selection),review=reviewContainerCostPair(pair);
    this.set(pair,review,'已提交完整提案，请查看待办并另行确认来源；未新增项目费用。');this.editor=null;this.persistEditor();this.env.render();return;
   }
   if(action==='pair-confirm-selection'){
    if(!this.pair||this.liveIssues().length)throw Error('confirm_context');
    const selection=structuredClone(this.pair.selection),intent=selection.intents.find(i=>i.line_id===dataset.pairLine);
    if(!intent||intent.operation!=='CREATE_NEW')throw Error('confirm_intent');
    const confirmed=confirmContainerCostIntent(this.pair.project,this.pair.bill,intent,intent.evidence??emptyEvidence());
    selection.intents[selection.intents.indexOf(intent)]=confirmed;
    const pair=updateContainerCostPair(this.pair,this.pair.content_key,this.pair.project,this.pair.bill,selection);
    this.set(pair,reviewContainerCostPair(pair),'已记录当前完整提案的用户来源确认；业务待办仍保留，未应用费用或进行专业认证。');this.env.render();return;
   }
   if(action==='pair-clear'){this.set(null,null,'配对快照已清空，项目与账单保留；之前文件请另行保管。');this.env.render();return;}
   if(action==='pair-save'){if(!this.pair||this.liveIssues().length)throw Error('mismatch');this.cancelReads();void this.save(serializeContainerCostPair(this.pair));return;}
   if(action==='pair-remove-selection'){
    const id=dataset.pairLine;if(!this.pair||!id||!this.pair.selection.intents.some(i=>i.line_id===id))return;
    const selection=structuredClone(this.pair.selection);selection.intents=selection.intents.filter(i=>i.line_id!==id);
    const p=updateContainerCostPair(this.pair,this.pair.content_key,this.pair.project,this.pair.bill,selection);
    this.set(p,reviewContainerCostPair(p),'选择已移除，旧映射保留；当前资料如失配须另行捕获。');this.env.render();return;
   }
   if(this.env.inputIssues?.().length)throw Error('unfinished_fx');
   const project=this.env.project(),bill=this.env.bill();if(!bill)throw Error('bill');
   let selection:ContainerCostProposalInput=structuredClone(this.pair?.selection??{version:'0.1',intents:[]});
   if(action==='pair-new')selection={version:'0.1',intents:[]};
   else if(action==='pair-add-references'){
    for(const row of bill.rows)if(row.cost_reference&&!selection.intents.some(i=>i.line_id===row.input.line_id))selection.intents.push({operation:'REFERENCE_EXISTING',line_id:row.input.line_id,cost_id:row.cost_reference.cost_id,note:row.cost_reference.note});
   }else if(action!=='pair-capture')return;
   const pair=action==='pair-new'||!this.pair?createContainerCostPair(project,bill,selection):updateContainerCostPair(this.pair,this.pair.content_key,project,bill,selection);
   this.set(pair,reviewContainerCostPair(pair),'已捕获当前完整修订，提案只读；来源及包含待办保留，费用未写入。');this.env.render();
  }catch{this.message='操作未完成，资料保留：'+(this.reviewEditor?'存在未提交核对编辑，请检查类型、目标、说明及来源；失配时先明确放弃编辑，再捕获当前修订。':'')+(this.editor?'存在未提交编辑，请补齐明确选择并核对原修订；若失配请先放弃编辑、捕获当前修订后重开。':'')+(action.startsWith('pair-copy-')?'请核对新名称和复制范围接受、已有候选、目标编号冲突及已删除目标引用。':'')+'请核对来源/示例状态、有效期/核对日期、汇率行、账单、重复/悬空选择、删除目标编号及失配。 '+(this.env.inputIssues?.()??[]).join('；');this.env.render();}
 }
 async open(file:{text:()=>Promise<string>;size?:number}):Promise<void> {
  if(this.busy||this.env.blocked())return;
  if(this.editor||this.reviewEditor){this.message='请先提交或明确放弃未提交编辑，再打开配对文件；当前资料保留。';this.env.render();return;}
  this.env.cancelOtherReads();const epoch=++this.epoch;this.message='正在读取完整配对资料；期间修改或其他读取会取消载入。';this.env.render();
  if(epoch!==this.epoch||this.env.blocked())return;
  let installed=false;
  try{
   if((file.size??0)>CONTAINER_COST_PAIR_BYTES)throw Error('size');const text=await file.text();if(epoch!==this.epoch||this.env.blocked())return;
   const pair=parseContainerCostPair(text),review=reviewContainerCostPair(pair);
   this.env.install(pair);installed=true;
   this.set(pair,review,'已打开同一修订的项目与账单；付款/假设和客户公开输入已重置，提案未应用。');
  }catch{if(epoch!==this.epoch||this.env.blocked())return;this.message='配对读取失败或资料不完整/版本/结构/大小不支持；当前完整资料保留，原文件请核对。';this.env.render();return;}
  if(installed)this.env.afterInstall();
 }
 private async save(text:string):Promise<void> {
  this.busy=true;this.message='正在另存点击时完整配对快照；后续编辑不改变本次内容。';this.env.render();
  try{const result=await this.env.write('internal-container-cost-pair.json',text,'application/json');this.message=result==='SAVED'?'已另存点击时完整快照；后续修改须重新捕获并另存，项目保存状态未改变。':'已发起配对文件下载，请确认落盘；后续修改须重新捕获并另存。';}
  catch(error){this.message=error instanceof Error&&error.name==='AbortError'?'已取消配对另存，资料保留。':'配对另存失败，请检查下载/保存权限或空间；资料保留。';}
  finally{this.busy=false;if(!this.env.blocked())this.env.render();}
 }
 private async saveCopy(text:string):Promise<void> {
  this.busy=true;this.message='正在另存已冻结的新业务副本；原资料及后续修改不会改变本次文件。';this.env.render();
  try{const result=await this.env.write('new-business-container-cost-pair.json',text,'application/json');this.message=result==='SAVED'?'已另存新业务副本；请单独打开并重新绑定/确认，原业务及保存状态未改。重复另存同一候选保持同一新身份。':'已发起新业务副本下载，请确认落盘后再打开复核；原业务保留，候选身份保持。';}
  catch(error){this.message=error instanceof Error&&error.name==='AbortError'?'已取消副本另存；同一内存候选保留，可重试。':'副本另存失败，请核对权限或空间；同一内存候选及原资料保留，可重试。';}
  finally{this.busy=false;if(!this.env.blocked())this.env.render();}
 }
}
