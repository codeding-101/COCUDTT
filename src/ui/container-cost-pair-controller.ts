import type {ProjectFile} from '../data/project-file.js';
import type {ContainerBillDraft} from '../domain/container-bill-draft.js';
import type {ContainerCostPair} from '../domain/container-cost-pair.js';
import type {ContainerCostProposalInput} from '../domain/container-cost-proposal.js';
import {createContainerCostPair,updateContainerCostPair,parseContainerCostPair,serializeContainerCostPair,reviewContainerCostPair,CONTAINER_COST_PAIR_BYTES} from '../data/container-cost-pair.js';
import {emptyEvidence,evidenceKey} from '../domain/source-evidence.js';
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
 private epoch=0;private loaded=false;
 constructor(private readonly env:Environment){}
 cancelReads():void {this.epoch++;if(this.message.startsWith('正在读取'))this.message='配对读取已取消，当前资料保留。';}
 liveIssues():string[]{return[...(this.env.inputIssues?.()??[]),...(this.pair?pairLiveIssues(this.pair,this.env.project(),this.env.bill()):[])];}
 loadLocal():void {
  if(this.loaded)return;this.loaded=true;
  try{const raw=localStorage.getItem(PAIR_STORAGE_KEY);if(raw!==null&&raw!=='null'){try{const pair=parseContainerCostPair(raw),review=reviewContainerCostPair(pair);this.pair=pair;this.review=review;this.message='已恢复独立配对快照，仅核对当前资料；未自动替换项目或账单，请另存文件。';}catch{this.message='配对草稿无法读取，原文未覆盖；请备份后再捕获或打开资料。';}}}catch{this.message='配对自动草稿不可用，请另存配对文件。';}
 }
 private set(pair:ContainerCostPair|null,review:PairReview|null,message:string):void {
  this.epoch++;this.pair=pair;this.review=review;this.message=message;
  try{localStorage.setItem(PAIR_STORAGE_KEY,pair?serializeContainerCostPair(pair):'null');}catch{this.message+=' 自动草稿保存失败；内存保留，请另存配对文件。';}
 }
 action(action:string,dataset:DOMStringMap={}):void {
  if(this.busy||this.env.blocked())return;
  try{
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
  }catch{this.message='操作未完成，资料保留：请核对汇率行、账单、重复/悬空选择、删除目标编号及失配，捕获当前修订后再另存。 '+(this.env.inputIssues?.()??[]).join('；');this.env.render();}
 }
 async open(file:{text:()=>Promise<string>;size?:number}):Promise<void> {
  if(this.busy||this.env.blocked())return;this.env.cancelOtherReads();const epoch=++this.epoch;this.message='正在读取完整配对资料；期间修改或其他读取会取消载入。';this.env.render();
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
}
