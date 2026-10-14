import {emptyContainerBillDraft,type ContainerBillDraft} from '../domain/container-bill-draft.js';
import {emptyEvidence} from '../domain/source-evidence.js';
import {parseContainerBillDraft,serializeContainerBillDraft,validateContainerBillDraft,containerBillDraftSchema,CONTAINER_BILL_FILE_BYTES} from '../data/container-bill-file.js';
import {containerBillTemplate,containerBillTemplateText} from '../data/container-bill-templates.js';
import {bindContainerBillDraft,invalidateContainerBillConfirmations} from '../data/container-bill-context.js';
import {confirmContainerBillLine,confirmContainerBillCostReference} from '../engine/container-bill-draft.js';
import type {ProjectFile} from '../data/project-file.js';

export const BILL_STORAGE_KEY='trade-cost-engine:container-bill-v1';
export const BILL_ROW_FIELDS=['scope_id','direction','equipment_type','container_ids','currency','reference','charge_kind','mode','rate','period.start_date','period.end_date','period.start_event','period.end_event','period.start_included','period.end_included','daily.free_day_basis','daily.charge_day_basis','daily.free_days','daily.tier_mode','daily.tier_basis','tier.through_day','tier.rate','source.reference','source.valid_from','source.valid_to','source.checked_on','source.status','cost_reference.cost_id','cost_reference.note','cost_source.reference','cost_source.valid_from','cost_source.valid_to','cost_source.checked_on'] as const;
interface BillUiEnvironment {project:()=>ProjectFile;render:()=>void;write:(name:string,text:string,mime:string)=>Promise<'SAVED'|'DOWNLOAD_STARTED'>;blocked:()=>boolean}
/** Independent state and read epochs; project/customer payloads never receive this draft. */
export class ContainerBillController {
 draft:ContainerBillDraft|null=null;busy=false;message='尚未打开独立账单；新建不会预填业务条件。';
 private epoch=0;private loaded=false;
 constructor(private readonly env:BillUiEnvironment){}
 loadLocal():void {
  if(this.loaded)return;this.loaded=true;
  try{const raw=localStorage.getItem(BILL_STORAGE_KEY);if(raw!==null&&raw!=='null'){try{this.draft=parseContainerBillDraft(raw);this.message='已恢复独立账单草稿；请核对当前项目绑定并另存文件。';}catch{this.message='独立账单草稿无法读取，原文未覆盖；请先备份本地存储，再新建或打开其他账单。';}}}catch{this.message='账单自动草稿不可用；请另存独立文件。';}
 }
 cancelReads():void {this.epoch++;if(this.message.startsWith('正在本机读取'))this.message='读取已取消，当前输入保留。';}
 private changed(draft:ContainerBillDraft|null,message='账单已修改；来源及费用引用须核对，项目费用未改变。',notify=true):void {
  this.epoch++;this.draft=draft?invalidateContainerBillConfirmations(draft,this.env.project()):null;
  this.message=message;
  try{if(this.draft)localStorage.setItem(BILL_STORAGE_KEY,serializeContainerBillDraft(this.draft));else localStorage.setItem(BILL_STORAGE_KEY,'null');}catch{this.message+=' 自动草稿保存失败，请另存文件。';}
  if(notify)this.env.render();
 }
 projectChanged():void {
  this.cancelReads();if(this.draft)this.changed(this.draft,'当前项目已变更，账单输入保留；绑定和已有费用引用须重新核对。',false);
 }
 edit(dataset:DOMStringMap,value:string):void {
  if(!this.draft)return;
  const copy=structuredClone(this.draft),path=dataset.billField;
  try{
   if(dataset.billRow===undefined){if(path==='name'||path==='review_date'||path==='notes')copy[path]=value;else return;}
   else{
    if(!BILL_ROW_FIELDS.some(p=>p===path))return;
    const index=Number(dataset.billRow);if(!Number.isInteger(index)||index<0)return;
    const row=copy.rows[index];if(!row)return;
    const input=row.input,parts=path!.split('.'),field=parts.at(-1)!;
    const number=()=>{if(value==='')return null;if(!/^-?\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('integer');return Number(value);};
    if(parts[0]==='period'){
     const period=input.period??={};
     if(field==='start_included'||field==='end_included'){if(!['','true','false'].includes(value))throw Error('boolean');period[field]=value===''?null:value==='true';}
     else if(field==='start_date'||field==='end_date'||field==='start_event'||field==='end_event')period[field]=value;
    }else if(parts[0]==='daily'){
     const daily=input.daily??={};if(field==='free_days')daily.free_days=number();
     else if(field==='free_day_basis'||field==='charge_day_basis'||field==='tier_mode'||field==='tier_basis')daily[field]=value;
    }else if(parts[0]==='tier'){
     const j=Number(dataset.billTier);if(!Number.isInteger(j)||j<0)return;const tier=input.daily?.tiers?.[j];if(!tier)return;if(field==='through_day')tier.through_day=number();else if(field==='rate')tier.rate=value;
    }else if(parts[0]==='source'||parts[0]==='cost_source'){
     const source=parts[0]==='source'?(row.evidence??=emptyEvidence()):((row.cost_reference??={cost_id:'',note:''}).evidence??=emptyEvidence());
     if(field==='status'){if(value==='USER_CONFIRMED'){this.message='请使用明确核对按钮；状态选择不能自动确认。';this.env.render();return;}if(value!=='UNVERIFIED'&&value!=='EXAMPLE')return;source.status=value;}
     else if(field==='reference'||field==='valid_from'||field==='valid_to'||field==='checked_on')source[field]=value;
    }else if(parts[0]==='cost_reference'){
     const ref=row.cost_reference??={cost_id:'',note:''};if(field==='cost_id'||field==='note')ref[field]=value;
    }else if(path==='container_ids')input.container_ids=value===''?[]:value.split(/\r?\n/);
    else if(path==='scope_id'||path==='direction'||path==='equipment_type'||path==='currency'||path==='reference'||path==='charge_kind'||path==='mode'||path==='rate')input[path]=value;
   }
   validateContainerBillDraft(copy);this.changed(copy);
  }catch{this.message='账单输入超出结构或范围限制，已保留原值；整数项不能填写非整数文字。';this.env.render();}
 }
 action(action:string,dataset:DOMStringMap={}):void {
  if(this.busy&&['bill-new','bill-example','bill-clear','bill-save','bill-schema','bill-empty-template','bill-example-template'].includes(action))return;
  try{
   if(action==='bill-new'){this.changed(emptyContainerBillDraft('bill-'+crypto.randomUUID()),'已新建空账单；请逐项填写，未绑定当前项目。');return;}
   if(action==='bill-example'){this.changed(containerBillTemplate('container-bill-synthetic-example'),'已载入固定合成例题，来源为示例；不是承运人费率。');return;}
   if(action==='bill-clear'){this.changed(null,'账单面板已清空；请保留之前另存的文件。');return;}
   if(action==='bill-save'){if(this.draft)void this.save('internal-container-bill.json',serializeContainerBillDraft(this.draft),'application/json');return;}
   if(action==='bill-schema'){void this.save('container-bill-1.0.schema.json',JSON.stringify(containerBillDraftSchema(),null,2)+'\n','application/json');return;}
   if(action==='bill-empty-template'||action==='bill-example-template'){const id=action==='bill-empty-template'?'container-bill-empty':'container-bill-synthetic-example';void this.save(id+'.json',containerBillTemplateText(id),'application/json');return;}
   if(!this.draft)return;let copy=structuredClone(this.draft);
   if(action==='bill-rebind'){copy=bindContainerBillDraft(copy,this.env.project());this.changed(copy,'已显式绑定当前项目；相关确认撤销，请核对后重新确认。');return;}
   if(action==='bill-add-line'){if(copy.rows.length>=50)throw Error('limit');const id='bill-'+crypto.randomUUID();if(copy.rows.some(r=>r.input.line_id===id))throw Error('duplicate');copy.rows.push({input:{line_id:id},evidence:emptyEvidence()});}
   else{
    const i=Number(dataset.billRow);if(!Number.isInteger(i)||i<0)return;const row=copy.rows[i];if(!row)return;
    switch(action){
     case 'bill-remove-line':copy.rows.splice(i,1);break;
     case 'bill-add-tier':{const tiers=(row.input.daily??={}).tiers??=[];if(tiers.length>=20)throw Error('limit');tiers.push({through_day:null,rate:''});break;}
     case 'bill-remove-tier':{const j=Number(dataset.billTier),tiers=row.input.daily?.tiers;if(tiers&&Number.isInteger(j)&&j>=0&&j<tiers.length)tiers.splice(j,1);break;}
     case 'bill-clean-mode':if(row.input.mode==='DAILY')delete row.input.rate;else if(row.input.mode==='PER_CONTAINER'){delete row.input.period;delete row.input.daily;}else throw Error('mode');break;
     case 'bill-clear-reference':delete row.cost_reference;break;
     case 'bill-confirm-source':copy=confirmContainerBillLine(copy,row.input.line_id,row.evidence??emptyEvidence());break;
     case 'bill-confirm-reference':copy=confirmContainerBillCostReference(copy,row.input.line_id,this.env.project(),row.cost_reference?.evidence??emptyEvidence());break;
     default:return;
    }
   }
   validateContainerBillDraft(copy);this.changed(copy);
  }catch{this.message='操作未完成：请核对条件、来源日期/状态、绑定及费用引用待办；原输入保留。';this.env.render();}
 }
 async open(file:{text:()=>Promise<string>;size?:number}):Promise<void> {
  const epoch=++this.epoch;this.message='正在本机读取账单；读取期间修改会取消此次载入。';this.env.render();
  try{if((file.size??0)>CONTAINER_BILL_FILE_BYTES)throw Error('size');const text=await file.text();if(epoch!==this.epoch||this.env.blocked())return;const parsed=parseContainerBillDraft(text);this.changed(parsed,'已打开独立账单；保留来源记录，当前绑定及失效确认已重新核对。');}
  catch{if(epoch!==this.epoch||this.env.blocked())return;this.message='账单读取失败或版本/结构/大小不支持；当前输入保留，原文件请另行核对。';this.env.render();}
 }
 private async save(name:string,text:string,mime:string):Promise<void> {
  if(this.busy)return;this.busy=true;this.message='正在保存点击时的账单/资源快照；后续编辑不改变本次内容。';this.env.render();
  try{const result=await this.env.write(name,text,mime);this.message=result==='SAVED'?'已保存点击时的独立快照；后续修改请再次另存，项目保存状态未改变。':'已发起独立文件下载，请确认落盘；后续修改请再次另存。';}
  catch(error){this.message=error instanceof Error&&error.name==='AbortError'?'已取消账单保存，输入保留。':'账单保存失败；请检查下载/保存权限或空间，输入保留。';}
  finally{this.busy=false;this.env.render();}
 }
}
