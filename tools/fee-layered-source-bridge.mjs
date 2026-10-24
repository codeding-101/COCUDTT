import {feeSemanticIntegrationBridge} from './fee-semantic-integration-bridge.mjs';
function once(code,from,to){if(code.split(from).length!==2)throw Error('Layered source observation changed');return code.replace(from,to);}
let bridge=once(feeSemanticIntegrationBridge,"inspectFeeSemanticIntegration as inspectSource89","inspectFeeLayeredSourceMapping as inspectSource89");
bridge=once(bridge,"from '../../tools/fee-semantic-integration-diagnostic.ts'","from '../../tools/fee-layered-source-diagnostic.ts'");
bridge=once(bridge,'function scenarioSource89(id){','async function scenarioSource89(id){');
bridge=once(bridge,'const diagnostic=inspectSource89(','const diagnostic=await inspectSource89(');
// The compatibility observation now reads legacy + actual production + independent roots: three10-key reads.
bridge=once(bridge,'if(!stable||writes!==0||reads!==20||','if(!stable||writes!==0||reads!==30||');
bridge=once(bridge,'const result=compareSource88(label);','const result=await compareSource88(label);');
export const feeLayeredSourceBridge=bridge+String.raw`
import {readFeeLayeredWorkbenchRoots as roots95} from '../../tools/fee-layered-source-mapping.ts';
import {encodeFeeLayeredCapturePrototype as encode95,decodeFeeLayeredCapturePrototype as decode95,inspectFeeLayeredCaptureBudget as budget95,FeeLayeredCapturePrototype as Session95} from '../../tools/fee-layered-capture-prototype.ts';
import {beginCapacityTrace as beginShape95,endCapacityTrace as endShape95,ordinaryJsonShape as shape95,capacityFailureCode as capacityCode95} from '../../tools/fee-capacity-trace.ts';
import {previewRuntimeFeeWorkbench as preview95,runtimeFeeWorkbenchPreparedSnapshot as privatePreview95} from './fee-workbench-preview.js';
import Decimal95 from 'decimal.js';
const hash95=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
let wire95=null,layeredBusy95=false;
const fixedReason95=error=>{const d=error&&typeof error==='object'?Object.getOwnPropertyDescriptor(error,'message'):null;return d&&'value'in d&&typeof d.value==='string'&&/^(?:FEE_LAYERED_SOURCE_MAPPING_(?:INVALID|STALE)|FEE_LAYERED_CAPTURE_PROTOTYPE_[A-Z_]+)$/.test(d.value)?d.value:capacityCode95(error);};
compareSource88=async function(label){
 const checkpoint=workbenchState.checkpoint(),projectBefore=workflow.stateInitialized?JSON.stringify(state.project):null,envelopeBefore=feeEnvelopeWorkspace.controller.state().current?.raw_json??null,reviewBefore=workflow.customerReviewed;
 const original=captureCurrentFeeWorkbench(),parts=roots95(workbenchState,readers88()),wire=await encode95(parts),restored=await decode95(wire),actual=restored.capture,oldJson=JSON.stringify(original),newJson=JSON.stringify(actual),retained=JSON.parse(original.retained_json);
 const different=Object.keys(original).filter(k=>JSON.stringify(original[k])!==JSON.stringify(actual[k]));
 if(oldJson!==newJson||different.length||!workbenchState.isCurrent(checkpoint)||projectBefore!==(workflow.stateInitialized?JSON.stringify(state.project):null)||envelopeBefore!==(feeEnvelopeWorkspace.controller.state().current?.raw_json??null)||reviewBefore!==workflow.customerReviewed)throw Error('LAYERED_OPERATIONAL_MISMATCH');
 wire95=wire;
 return{label,equal:true,different,owner_unchanged:true,project_and_receipts_unchanged:true,customer_review_unchanged:true,financial_writes:0,root_fields:Object.keys(original),retained_fields:Object.keys(retained),source_fields:Object.keys(original.sources),file_holders:Object.keys(original.files),activity:original.activity,blockers:original.blockers,
  pending:pendingSource88(workflow.editedControl),storage_availability:Object.values(retained.storage).map(v=>v.available),legacy_utf8_bytes:new TextEncoder().encode(oldJson).length,wire_utf8_bytes:new TextEncoder().encode(wire).length,wire_characters:wire.length,capture_sha256:await hash95(oldJson),restored_sha256:await hash95(newJson),wire_sha256:await hash95(wire)};
};
async function preservation95(){
 const values={sources:JSON.stringify({...currentEnvelopeSources(),envelope_json:feeEnvelopeWorkspace.controller.state().current?.raw_json??null}),fx:JSON.stringify({rows:state.fxRows,lease:workflow.pairFxLease}),project_file:JSON.stringify(state.fileEvidence),bill:JSON.stringify(containerBill.workbenchCapture()),pair:JSON.stringify(containerPair.workbenchCapture()),tax:JSON.stringify(feeTaxWorkspace.controller.workbenchCapture()),precision:JSON.stringify(feePrecisionWorkspace.controller.workbenchCapture()),envelope:JSON.stringify(feeEnvelopeWorkspace.controller.workbenchCapture()),tax_ui:JSON.stringify(feeTaxWorkspace.workbenchCapture()),precision_ui:JSON.stringify(feePrecisionWorkspace.workbenchCapture()),envelope_ui:JSON.stringify(feeEnvelopeWorkspace.workbenchCapture()),storage:JSON.stringify(observeFeeSourceStorage(key=>localStorage.getItem(key)))};
 const hashes={};for(const[key,value]of Object.entries(values))hashes[key]=await hash95(value);return{hashes,customer_reviewed:workflow.customerReviewed};
}
async function pressure95(count){
 if(layeredBusy95||![1,4,8].includes(count))throw Error('LAYERED_PRESSURE_INPUT');layeredBusy95=true;wire95=null;let summary=null;
 try{
  const checkpoint=workbenchState.checkpoint(),before=await preservation95();if(!workbenchState.isCurrent(checkpoint))throw Error('LAYERED_PRESSURE_STALE_START');
  let original=null,originalCode=null,trace;beginShape95('SHAPE');try{original=captureCurrentFeeWorkbench();}catch(error){originalCode=capacityCode95(error);}finally{trace=endShape95();}
  let parts=null,rootShape=null,shellShape=null,budget=null,wire=null,restored=null,mappingCode=null,phase='MAPPING',prepared=null;
  try{
   parts=roots95(workbenchState,readers88());rootShape=shape95(parts.retained_root);shellShape=shape95(parts.capture_shell);phase='BUDGET';budget=budget95(parts);
   phase='ENCODE';wire=await encode95(parts);phase='DECODE';restored=await decode95(wire);
   if(!original||JSON.stringify(restored.capture)!==JSON.stringify(original))throw Error('LAYERED_PRESSURE_CAPTURE_DIFFERS');
   phase='PREVIEW';const preview=await preview95(restored.capture,'synthetic-layered-'+crypto.randomUUID());if(preview.status!=='STAGED')throw Error('LAYERED_PRESSURE_NOT_STAGED');
   phase='PREPARE';summary=await runtimeCandidatePreparer.prepare(preview);
   let foreign=false,foreignPreview=false;try{runtimeCandidatePreparer.backup(JSON.parse(JSON.stringify(summary)));}catch{foreign=true;}try{privatePreview95(restored);}catch{foreignPreview=true;}
   if(summary.participants.length!==10||summary.costs_added!==count||!new Decimal95(summary.after.buyer_total).minus(summary.before.buyer_total).eq(791*count)||summary.before.seller_profit!==null||summary.after.seller_profit!==null||!foreign||!foreignPreview)throw Error('LAYERED_PRESSURE_CANDIDATE_DIFFERS');
   prepared={participants:10,costs_added:count,buyer_delta:String(791*count),seller_profit_before:null,seller_profit_after:null,foreign_summary_refused:foreign,restored_preview_refused:foreignPreview};wire95=wire;
  }catch(error){mappingCode=fixedReason95(error);if(mappingCode==='UNCLASSIFIED')throw error;}
  const after=await preservation95();if(!workbenchState.isCurrent(checkpoint)||JSON.stringify(before)!==JSON.stringify(after))throw Error('LAYERED_PRESSURE_MUTATED');
  const expected=count===1?null:count===4?'FEE_LAYERED_CAPTURE_PROTOTYPE_CAPTURE_BYTES':'FEE_LAYERED_CAPTURE_PROTOTYPE_ROOT_BYTES';
  if(mappingCode!==expected||(original!==null)!==(restored!==null))throw Error('LAYERED_PRESSURE_ACCEPTANCE_DIFFERS');
  return{count,status:original?'CAPTURE_EQUAL_AND_PREPARED':'BOTH_REFUSED',original_code:originalCode,original_trace:trace,mapped_root:rootShape,mapped_shell:shellShape,budget,mapping_failure:mappingCode?{phase,code:mappingCode}:null,
   full_capture_equal:original?JSON.stringify(original)===JSON.stringify(restored.capture):null,capture_sha256:original?await hash95(JSON.stringify(original)):null,restored_sha256:restored?await hash95(JSON.stringify(restored.capture)):null,
   prepared,wire_characters:wire?.length??0,wire_sha256:wire?await hash95(wire):null,not_run:mappingCode?['ENCODE','DECODE','PREVIEW','PREPARE']:[],
   preservation:{owner_unchanged:true,source_and_controller_hashes_equal:true,fx_file_storage_equal:true,customer_review_kept:true,customer_reviewed:after.customer_reviewed,financial_writes:0},physical_disk_io_verified:false};
 }finally{if(summary)runtimeCandidatePreparer.discard(summary);layeredBusy95=false;}
}
async function ownership95(){
 const beforeProject=JSON.stringify(state.project),beforeEnvelope=feeEnvelopeWorkspace.controller.state().current?.raw_json??null,review=workflow.customerReviewed,session=new Session95(workbenchState),issued=await session.capture(()=>roots95(workbenchState,readers88())),wire=session.encode(issued);
 let copied=false;try{session.encode(JSON.parse(wire));}catch{copied=true;}
 const identity={issued_current:session.isCurrent(issued),json_copy_refused:copied,restored_not_issued:!session.isCurrent(await decode95(wire))};
 const pending=workflow.pendingCalculation;workflow.pendingCalculation=!pending;workflow.pendingCalculation=pending;
 const latest=await session.capture(()=>roots95(workbenchState,readers88())),aba={old_expired:!session.isCurrent(issued),fresh_current:session.isCurrent(latest),equal_bytes:session.encode(latest)===wire};
 const current=feeEnvelopeWorkspace.controller.state().current;if(!current)throw Error('LAYERED_CANCEL_SOURCE_REQUIRED');let finishFile;
 const reading=feeEnvelopeWorkspace.controller.openFile({arrayBuffer:()=>new Promise(resolve=>{finishFile=resolve;})}),active=await session.capture(()=>roots95(workbenchState,readers88())),activeWire=session.encode(active);let finishView;
 const late=session.capture(()=>new Promise(resolve=>{finishView=resolve;}));feeEnvelopeWorkspace.controller.cancelRead();finishView(roots95(workbenchState,readers88()));let stale=false;try{await late;}catch(error){stale=fixedReason95(error)==='FEE_LAYERED_CAPTURE_PROTOTYPE_STALE';}
 const restored=await decode95(activeWire);finishFile(new TextEncoder().encode(current.raw_json).buffer);const installed=await reading;
 const cancel={late_view_rejected:stale,issued_expired:!session.isCurrent(active),restored_not_issued:!session.isCurrent(restored),late_file_not_installed:!installed,no_pending_adoption:feeEnvelopeWorkspace.controller.state().preview===null,current_source_kept:feeEnvelopeWorkspace.controller.state().current?.raw_json===current.raw_json};
 if(Object.values(identity).some(v=>v!==true)||Object.values(aba).some(v=>v!==true)||Object.values(cancel).some(v=>v!==true)||JSON.stringify(state.project)!==beforeProject||feeEnvelopeWorkspace.controller.state().current?.raw_json!==beforeEnvelope||workflow.customerReviewed!==review)throw Error('LAYERED_PRIVATE_IDENTITY_DIFFERS');
 return{identity,aba,cancel,project_and_envelope_unchanged:true,customer_review_unchanged:true,financial_writes:0,import_authority:false,confirmation_authority:false};
}
Object.defineProperty(window,'__feeLayeredSources95',{value:Object.freeze({ids:window.__feeSourceCompatibility89.ids,scenario:scenarioSource89,operational:scenarioSource88,pressure:pressure95,ownership:ownership95,
 wireChunk:(at,length)=>{if(!Number.isInteger(at)||at<0||!Number.isInteger(length)||length<1||length>262144||wire95===null)throw Error('LAYERED_WIRE_CHUNK');return wire95.slice(at,at+length);},
 clearWire:()=>{wire95=null;}}),configurable:true});
`;
