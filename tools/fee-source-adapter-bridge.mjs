// Appended in memory by the dedicated validation server only. Never part of a normal build.
export const feeSourceAdapterBridge = String.raw`
import {captureFeeWorkbenchSourceFrame as captureSource88,projectFeeSourceFrameToLegacy as projectSource88,observeFeeSourcePending as pendingSource88,observeFeeSourceStorage as storageSource88,FEE_SOURCE_STORAGE_KEYS as storageKeys88} from './fee-workbench-source-adapter.js';
const workflowKeys88=['stateInitialized','pendingCalculation','pairFxLease','projectReadEpoch','projectReadToken','settlementEpoch','settlementPlan','sensitivityControls','customerFields','customerView','customerReviewed','recoveryStage','recoveryReviewBusy','projectSaveBusy','projectResourceBusy','settlementBusy','customerSummaryBusy','customerPdfBusy'];
const readers88=()=>({
 project:()=>({project:state.project,fxRows:state.fxRows,fileEvidence:state.fileEvidence,fileName:state.fileName,savedAt:state.savedAt,dirty:state.dirty}),
 workflow:()=>Object.fromEntries(workflowKeys88.map(k=>[k,workflow[k]])),
 bill:()=>({capture:containerBill.workbenchCapture(),draft:containerBill.draft}),
 pair:()=>({capture:containerPair.workbenchCapture(),pair:containerPair.pair,editor:containerPair.editor,reviewEditor:containerPair.reviewEditor}),
 attachment:()=>feeTaxWorkspace.controller.workbenchCapture(),precision:()=>feePrecisionWorkspace.controller.workbenchCapture(),envelope:()=>feeEnvelopeWorkspace.controller.workbenchCapture(),
 attachment_workspace:()=>feeTaxWorkspace.workbenchCapture(),precision_workspace:()=>feePrecisionWorkspace.workbenchCapture(),envelope_workspace:()=>feeEnvelopeWorkspace.workbenchCapture(),
 pending:()=>pendingSource88(workflow.editedControl),storage:()=>storageSource88(key=>localStorage.getItem(key))
});
function compareSource88(label){
 const checkpoint=workbenchState.checkpoint(),projectBefore=workflow.stateInitialized?JSON.stringify(state.project):null,envelopeBefore=feeEnvelopeWorkspace.controller.state().current?.raw_json??null,reviewBefore=workflow.customerReviewed;
 const old=captureCurrentFeeWorkbench(),frame=captureSource88(workbenchState,readers88()),adapted=projectSource88(frame),oldJson=JSON.stringify(old),newJson=JSON.stringify(adapted);
 const different=Object.keys(old).filter(k=>JSON.stringify(old[k])!==JSON.stringify(adapted[k]));
 const stable=workbenchState.isCurrent(checkpoint)&&projectBefore===(workflow.stateInitialized?JSON.stringify(state.project):null)&&envelopeBefore===(feeEnvelopeWorkspace.controller.state().current?.raw_json??null)&&reviewBefore===workflow.customerReviewed;
 if(oldJson!==newJson||different.length||!stable)throw Error('SOURCE_ADAPTER_SHADOW_MISMATCH '+label+' '+different.join(','));
 return{label,equal:true,different,owner_unchanged:true,project_and_receipts_unchanged:true,customer_review_unchanged:true,financial_writes:0,root_fields:Object.keys(old),retained_fields:Object.keys(JSON.parse(old.retained_json)),source_fields:Object.keys(old.sources),file_holders:Object.keys(old.files),activity:old.activity,blockers:old.blockers,pending:frame.pending,storage_availability:Object.values(frame.storage).map(v=>v.available),legacy_utf8_bytes:new TextEncoder().encode(oldJson).length,frame_utf8_bytes:new TextEncoder().encode(JSON.stringify(frame)).length};
}
async function scenarioSource88(label){
 const saved=Object.fromEntries([...workflowKeys88,'editedControl'].map(k=>[k,workflow[k]])),appSaved={fxRows:state.fxRows,fileEvidence:state.fileEvidence,fileName:state.fileName,savedAt:state.savedAt,dirty:state.dirty};
 const get=Object.getOwnPropertyDescriptor(Storage.prototype,'getItem'),set=Object.getOwnPropertyDescriptor(Storage.prototype,'setItem'),remove=Object.getOwnPropertyDescriptor(Storage.prototype,'removeItem'),key=storageKeys88[0],oldRaw=get.value.call(localStorage,key);
 let control=null,reads=0,writes=0,finish=null,readPromise=null;
 try{
  workflow.editedControl=null;workflow.pendingCalculation=false;
  if(label==='uninitialized')workflow.stateInitialized=false;
  if(label==='pending_only')workflow.pendingCalculation=true;
  if(label.startsWith('control_')){
   const kind=label.slice(8);control=document.createElement(kind==='select'?'select':kind==='textarea'?'textarea':kind==='other'?'div':'input');
   if(kind==='select'){const option=document.createElement('option');option.value='SYNTHETIC_OPTION';option.textContent='合成选项';control.append(option);}
   else if(kind!=='other'){if(kind==='checkbox'){control.type='checkbox';control.checked=true;control.value='SYNTHETIC_CHECKBOX';}else control.value='{未提交 原文\n';}
   control.id='synthetic-adapter-control';control.dataset.path='SYNTHETIC_FIELD';control.dataset.unknown='保留';
   if(kind!=='detached')document.body.append(control);workflow.editedControl=control;
  }
  if(label.startsWith('fx_')||label==='blockers_all'){
   const books=structuredClone(state.project.fx_books.length?state.project.fx_books:[{id:'synthetic-adapter-market',name:'SYNTHETIC',type:'MARKET',date:'2026-01-01',rates:{'USD/CNY':'7'}}]);
   books[0].name='SYNTHETIC_PRESERVED_NAME';books[0].unknown_extension={literal:'EXACT'};
   state.fxRows=booksToRows(books);workflow.pairFxLease={row_key:JSON.stringify(state.fxRows),books};
   if(label==='fx_changed')state.fxRows=state.fxRows.map((r,i)=>i? r:{...r,rate:'9.123456'});
   if(label==='fx_incomplete')state.fxRows=state.fxRows.map((r,i)=>i? r:{...r,rate:''});
   if(label==='fx_bad'||label==='blockers_all')state.fxRows=state.fxRows.map((r,i)=>i? r:{...r,rate:7});
  }
  if(label==='project_read_active'||label==='project_read_stale'){workflow.projectReadEpoch=8;workflow.projectReadToken=label==='project_read_active'?8:7;}
  if(label==='recovery')workflow.recoveryReviewBusy=true;
  if(label==='file_busy'||label==='blockers_all')workflow.customerPdfBusy=true;
  if(label==='file_download'||label==='file_saved'){
   state.fileName='SYNTHETIC_NAME.json';state.savedAt=label==='file_saved'?'2026-01-01T00:00:00.000Z':null;state.dirty=label!=='file_saved';
   state.fileEvidence={name:state.fileName,saved_raw:'\uFEFFSYNTHETIC_FILE\r\n',saved_at:state.savedAt};
  }
  if(label==='storage_absent')remove.value.call(localStorage,key);
  if(label==='storage_empty')set.value.call(localStorage,key,'');
  if(label==='storage_bad')set.value.call(localStorage,key,'\uFEFF{未完成\r\n');
  Object.defineProperty(Storage.prototype,'getItem',{...get,value:function(k){reads++;if(label==='storage_throw_all'||label==='storage_throw_one'&&k===key)throw Error('SYNTHETIC_STORAGE_DENIED');return get.value.call(this,k);}});
  Object.defineProperty(Storage.prototype,'setItem',{...set,value:function(){writes++;throw Error('ADAPTER_MUST_NOT_WRITE_STORAGE');}});
  Object.defineProperty(Storage.prototype,'removeItem',{...remove,value:function(){writes++;throw Error('ADAPTER_MUST_NOT_REMOVE_STORAGE');}});
  if(label==='envelope_read'||label==='blockers_all')readPromise=feeEnvelopeWorkspace.controller.openFile({arrayBuffer:()=>new Promise(resolve=>{finish=resolve;})});
  workbenchState.touch();const result=compareSource88(label);
  if(reads!==20||writes!==0)throw Error('SOURCE_ADAPTER_STORAGE_EFFECT '+reads+'/'+writes);
  result.storage_reads=reads;result.storage_writes=writes;
  if(label==='blockers_all'&&result.blockers.join(',')!=='INVALID_FX_OR_PROJECT,ACTIVE_ENVELOPE,ACTIVE_FILE_WRITE')throw Error('Blocker order');
  if(label==='uninitialized'&&result.file_holders.length!==6)throw Error('Missing file holders');
  if(label==='project_read_active'&&!result.activity.project_read||label==='project_read_stale'&&result.activity.project_read)throw Error('Read token mismatch');
  if(label==='storage_throw_all'&&result.storage_availability.some(Boolean))throw Error('Unavailable storage lost');
  return result;
 }finally{
  Object.defineProperty(Storage.prototype,'getItem',get);Object.defineProperty(Storage.prototype,'setItem',set);Object.defineProperty(Storage.prototype,'removeItem',remove);
  if(readPromise){feeEnvelopeWorkspace.controller.cancelRead();finish(new TextEncoder().encode('{}').buffer);await readPromise;}
  if(oldRaw===null)remove.value.call(localStorage,key);else set.value.call(localStorage,key,oldRaw);
  control?.remove();Object.assign(workflow,saved);Object.assign(state,appSaved);workbenchState.touch();
 }
}
Object.defineProperty(window,'__feeSourceAdapter88',{value:Object.freeze({compare:compareSource88,scenario:scenarioSource88}),configurable:true});
`;
