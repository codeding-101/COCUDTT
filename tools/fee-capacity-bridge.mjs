// Dedicated Vite transforms only. The ordinary build never imports these observations.
export function transformFeeCapacity(code, id) {
 const path=id.replaceAll('\\','/'),once=(text,from,to)=>{if(text.split(from).length!==2)throw Error('Capacity observation binding changed '+path);return text.replace(from,to);};
 const imports="import {traceCapacitySync as trace92,observeRetainedShape as shape92,observeCompleteShape as wholeShape92} from '../../tools/fee-capacity-trace.ts';\n";
 if(path.endsWith('/src/ui/fee-workbench-semantic-capture.ts')){
  code=once(code,'const r = copy(raw) as typeof raw;',"shape92(raw); const r = trace92('RETAINED_ROOT',()=>copy(raw)) as typeof raw;");
  code=once(code,'const c = captureRuntimeFeeWorkbench(value as RuntimeFeeWorkbenchCapture);',"wholeShape92(value); const c = trace92('WHOLE_CAPTURE',()=>captureRuntimeFeeWorkbench(value as RuntimeFeeWorkbenchCapture));");
  code=once(code,'parse(c.retained_json); return c;',"trace92('RETAINED_REOPEN',()=>parse(c.retained_json)); return c;");
  return {code:imports+code,map:null};
 }
 if(path.endsWith('/src/ui/fee-workbench-candidate.ts'))return{code:imports+once(code,'const backup = encodeRuntimeFeeBackup(rawBackup);',"const backup = trace92('BACKUP_ENCODE',()=>encodeRuntimeFeeBackup(rawBackup));"),map:null};
 if(path.endsWith('/src/ui/app.ts'))return{code:once(code,'function captureCurrentFeeWorkbench():RuntimeFeeWorkbenchCapture{','function captureUnobserved92():RuntimeFeeWorkbenchCapture{')+'\n'+bridge,map:null};
 return null;
}

const bridge=String.raw`
import Decimal92 from 'decimal.js';
import {beginCapacityTrace as begin92,endCapacityTrace as end92,traceCapacitySync as sync92,traceCapacityAsync as async92,capacityFailureCode as code92} from '../../tools/fee-capacity-trace.ts';
import {previewRuntimeFeeWorkbench as preview92} from './fee-workbench-preview.js';
// Hoisted wrapper ensures that the original constructor callbacks also receive the observer.
function captureCurrentFeeWorkbench():RuntimeFeeWorkbenchCapture{return sync92('CAPTURE',()=>captureUnobserved92());}
const hash92=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const sourceTexts92=()=>({...currentEnvelopeSources(),envelope_json:feeEnvelopeWorkspace.controller.state().current?.raw_json??null});
async function preservation92(){
 const sources=sourceTexts92(),values={...sources,fx:JSON.stringify({rows:state.fxRows,lease:workflow.pairFxLease}),project_file:JSON.stringify(state.fileEvidence),
  bill:JSON.stringify(containerBill.workbenchCapture()),pair:JSON.stringify(containerPair.workbenchCapture()),tax:JSON.stringify(feeTaxWorkspace.controller.workbenchCapture()),precision:JSON.stringify(feePrecisionWorkspace.controller.workbenchCapture()),envelope:JSON.stringify(feeEnvelopeWorkspace.controller.workbenchCapture()),
  tax_ui:JSON.stringify(feeTaxWorkspace.workbenchCapture()),precision_ui:JSON.stringify(feePrecisionWorkspace.workbenchCapture()),envelope_ui:JSON.stringify(feeEnvelopeWorkspace.workbenchCapture()),storage:JSON.stringify(observeFeeSourceStorage(key=>localStorage.getItem(key)))};
 const hashes={};for(const[key,text]of Object.entries(values))hashes[key]=text===null?null:await hash92(text);
 return{hashes,customer_reviewed:workflow.customerReviewed};
}
let capacityBusy92=false;
async function measure92(count,mode){
 if(capacityBusy92)throw Error('CAPACITY_TRACE_BUSY');
 if(![1,4,8].includes(count)||!['SHAPE','MEASURE'].includes(mode))throw Error('CAPACITY_PROBE_INPUT');
 capacityBusy92=true;
 let summary=null,capture=null,result=null,backup=null,trace=null,phase='CAPTURE',failure=null;
 try{
  const checkpoint=workbenchState.checkpoint(),before=await preservation92();
  begin92(mode);
  try{
   capture=captureCurrentFeeWorkbench();
   if(mode==='MEASURE'){
    phase='PREVIEW';result=await async92('PREVIEW',()=>preview92(capture,'synthetic-capacity-'+crypto.randomUUID()));
    if(result.status!=='STAGED'||result.rows.length!==count)throw Error('CAPACITY_PREVIEW_NOT_STAGED');
    phase='PREPARE';summary=await async92('PREPARE',()=>runtimeCandidatePreparer.prepare(result));
    if(summary.participants.length!==10||summary.costs_added!==count||summary.before.seller_profit!==null||summary.after.seller_profit!==null||!new Decimal92(summary.after.buyer_total).minus(summary.before.buyer_total).eq(791*count))throw Error('CAPACITY_PREPARED_FACTS');
    phase='BACKUP_READ';backup=sync92('BACKUP_READ',()=>runtimeCandidatePreparer.backup(summary));
   }
  }catch(error){failure={phase,code:code92(error)};}finally{trace=end92();}
  const after=await preservation92(),stable=JSON.stringify(before)===JSON.stringify(after)&&workbenchState.isCurrent(checkpoint);
  if(!stable)throw Error('CAPACITY_READ_ONLY_INVARIANT');
  let copiedSummaryRejected=null;
  if(summary){try{runtimeCandidatePreparer.backup(JSON.parse(JSON.stringify(summary)));copiedSummaryRejected=false;}catch(error){copiedSummaryRejected=code92(error)==='RUNTIME_CANDIDATE_FOREIGN_SUMMARY';}if(!copiedSummaryRejected)throw Error('CAPACITY_SUMMARY_AUTHORITY');}
  return{count,mode,status:failure?'REJECTED':mode==='SHAPE'?'CAPTURE_ACCEPTED':'PREPARED',failure,trace,
   not_run:failure?['CAPTURE','PREVIEW','PREPARE','BACKUP_READ'].slice(['CAPTURE','PREVIEW','PREPARE','BACKUP_READ'].indexOf(failure.phase)+1):mode==='SHAPE'?['PREVIEW','PREPARE','BACKUP_READ']:[],
   prepared:summary?{participants:summary.participants.length,costs_added:summary.costs_added,buyer_delta:new Decimal92(summary.after.buyer_total).minus(summary.before.buyer_total).toString(),seller_profit_before:summary.before.seller_profit,seller_profit_after:summary.after.seller_profit,copied_summary_rejected:copiedSummaryRejected}:null,
   capture_sha256:capture?await hash92(JSON.stringify(capture)):null,backup_text:backup,
   preservation:{owner_unchanged:true,six_sources_unchanged:true,all_controller_and_workspace_captures_unchanged:true,fx_and_file_evidence_unchanged:true,storage_unchanged:true,customer_review_unchanged:true,customer_reviewed:after.customer_reviewed,financial_writes:0}};
 }finally{if(summary)runtimeCandidatePreparer.discard(summary);capacityBusy92=false;}
}
Object.defineProperty(window,'__feeCapacity92',{value:Object.freeze({measure:measure92,sourceHashes:async()=>{const result={};for(const[key,raw]of Object.entries(sourceTexts92()))result[key]=raw===null?null:{bytes:new TextEncoder().encode(raw).length,sha256:await hash92(raw)};return result;},
 startNative:()=>begin92('MEASURE'),endNative:()=>end92(),preservation:preservation92}),configurable:true});
`;
