/** Dedicated developer bridge. Production build and app imports remain unchanged. */
import{feeBrowserNativeBridge}from'./fee-browser-native-bridge.mjs';
export const feeRecoveryBrowserBridge=feeBrowserNativeBridge+String.raw`
import{FeeRecoveryFormat as RecoveryFormat98}from'../../tools/fee-recovery-format.ts';
import{inspectFeeBrowserNativeCaptureBudget as recoveryBudget98}from'../../tools/fee-browser-native-codec.ts';
import{FeeRecoveryWorkspace as RecoveryWorkspace98}from'../../tools/fee-recovery-workspace.ts';
import{validateFeeRecoverySupplement as supplementCheck98}from'../../tools/fee-recovery-supplement.ts';
import{readFeeLayeredWorkbenchRoots as recoveryRoots98}from'../../tools/fee-layered-source-mapping.ts';
function supplement98(){
 const c=workflow.editedControl,form=c instanceof HTMLInputElement||c instanceof HTMLSelectElement||c instanceof HTMLTextAreaElement;
 const pending_control=form?{tag:c.tagName,id:c.id,type:c.type,value:c.value,dataset:{...c.dataset},connected:c.isConnected,
  checked:c instanceof HTMLInputElement&&['checkbox','radio'].includes(c.type)?c.checked:null,
  selection_start:c instanceof HTMLInputElement||c instanceof HTMLTextAreaElement?c.selectionStart:null,
  selection_end:c instanceof HTMLInputElement||c instanceof HTMLTextAreaElement?c.selectionEnd:null,
  selected_values:c instanceof HTMLSelectElement?[...c.selectedOptions].map(o=>o.value):null,bad_input:c.validity.badInput,validation_message:c.validationMessage,
  files:c instanceof HTMLInputElement&&c.type==='file'?[...c.files??[]].map(f=>({name:f.name,size:f.size,type:f.type,last_modified:f.lastModified})):null}:null;
 const pending_other=c&&!form?{tag:c.tagName,id:c.id,dataset:{...c.dataset},connected:c.isConnected,text_content:c.textContent??'',content_editable:c.isContentEditable}:null;
 const review=u=>({export_message:u.exportMessage,review_key:u.reviewKey,review_generation:u.reviewGeneration,review_html:u.reviewHtml});
 return supplementCheck98({scope:'FEE_WORKBENCH_RECOVERY_SUPPLEMENT',version:'0.1',
  workflow:{state_initialized:workflow.stateInitialized,pending_calculation:workflow.pendingCalculation,restored_from_draft:workflow.restoredFromDraft,draft_failure:workflow.draftFailure,draft_storage_unavailable:workflow.draftStorageUnavailable,workspace_mode:workflow.workspaceMode,workspace_note:workflow.workspaceNote,calculated_at:workflow.calculatedAt,recovery_stage:workflow.recoveryStage,recovery_review:workflow.recoveryReview,recovery_review_error:workflow.recoveryReviewError,recovery_review_epoch:workflow.recoveryReviewEpoch,recovery_review_busy:workflow.recoveryReviewBusy,input_locations:workflow.inputLocations,sensitivity_error:workflow.sensitivityError,customer_error:workflow.customerError,project_save_busy:workflow.projectSaveBusy,project_resource_busy:workflow.projectResourceBusy,settlement_busy:workflow.settlementBusy,customer_summary_busy:workflow.customerSummaryBusy,customer_pdf_busy:workflow.customerPdfBusy},
  app:workflow.stateInitialized?{error:state.error,status:state.status,status_level:state.statusLevel}:{error:null,status:'',status_level:'info'},pair_ui:{review_page:containerPair.reviewPage},tax_ui:review(feeTaxWorkspace),precision_ui:review(feePrecisionWorkspace),
  envelope_ui:{message:feeEnvelopeWorkspace.message,business_name:feeEnvelopeWorkspace.businessName,choices:{...feeEnvelopeWorkspace.choices},choice_token:feeEnvelopeWorkspace.choiceToken,review_key:feeEnvelopeWorkspace.reviewKey,review_generation:feeEnvelopeWorkspace.reviewGeneration,review_html:feeEnvelopeWorkspace.reviewHtml,workbench_result:feeEnvelopeWorkspace.workbenchResult,workbench_candidate:feeEnvelopeWorkspace.workbenchCandidate,workbench_confirmation:feeEnvelopeWorkspace.workbenchConfirmation,workbench_application:feeEnvelopeWorkspace.workbenchApplication,workbench_generation:feeEnvelopeWorkspace.workbenchGeneration,workbench_busy:feeEnvelopeWorkspace.workbenchBusy,workbench_message:feeEnvelopeWorkspace.workbenchMessage,workbench_save_notice:feeEnvelopeWorkspace.workbenchSaveNotice},
  view:{collapsed_sections:[...collapsedSections],expanded_evidence_sections:[...expandedEvidenceSections]},pending_present:c!==null,pending_control,pending_other,extensions:{}});
}
let recoveryWire98=null;
const hashRecovery98=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
function inventory98(){const targets={app:state,workflow,bill:containerBill,pair:containerPair,'tax-controller':feeTaxWorkspace.controller,'precision-controller':feePrecisionWorkspace.controller,'envelope-controller':feeEnvelopeWorkspace.controller,'tax-workspace':feeTaxWorkspace,'precision-workspace':feePrecisionWorkspace,'envelope-workspace':feeEnvelopeWorkspace};return{owner:workbenchState.status(),fields:Object.fromEntries(Object.entries(targets).map(([key,target])=>[key,Object.keys(target).filter(k=>!['env','controller'].includes(k)).sort()]))};}
function safeRecoveryCode98(error){const d=error&&typeof error==='object'?Object.getOwnPropertyDescriptor(error,'code'):null;return d&&'value'in d&&typeof d.value==='string'&&/^[A-Z_]+$/.test(d.value)?d.value:'REJECTED_DATA';}
async function recoveryCycle98(label,compression='AUTO',pressureCount=null){
 const checkpoint=workbenchState.checkpoint(),projectBefore=JSON.stringify(state.project),envelopeBefore=feeEnvelopeWorkspace.controller.state().current?.raw_json??null,reviewBefore=workflow.customerReviewed;
 let original=null,original_refused=false;try{original=captureCurrentFeeWorkbench();}catch{original_refused=true;}
 const parts=recoveryRoots98(workbenchState,readers88()),supplement=supplement98(),format=new RecoveryFormat98();let wire;
 try{wire=await format.encode(parts,supplement,new AbortController().signal,{compression});}
 catch(error){const code=safeRecoveryCode98(error),historyLimit=['armed_candidate','applied_history','repeat_applied_history'].includes(label)&&code==='LOGICAL_SIZE';
  if(historyLimit){const source=recoveryBudget98(parts),supplementBytes=new TextEncoder().encode(JSON.stringify(supplement)).length,total=source.capture.compact_utf8_bytes+supplementBytes;
   if(original_refused||total<=128*1024*1024||!workbenchState.isCurrent(checkpoint)||JSON.stringify(state.project)!==projectBefore||(feeEnvelopeWorkspace.controller.state().current?.raw_json??null)!==envelopeBefore||workflow.customerReviewed!==reviewBefore)throw Error('RECOVERY_HISTORY_REFUSAL_DIFFERS');
   return{label,status:'RECOVERY_AGGREGATE_REFUSED',code,original_refused:false,source_capture_utf8_bytes:source.capture.compact_utf8_bytes,supplement_utf8_bytes:supplementBytes,logical_utf8_bytes:total,logical_limit_bytes:128*1024*1024,capture_sha256:await hashRecovery98(JSON.stringify(original)),supplement_sha256:await hashRecovery98(JSON.stringify(supplement)),source_cost_count:state.project.items.length,history:{application_record_preserved:supplement.envelope_ui.workbench_application!==null,candidate_record_preserved:supplement.envelope_ui.workbench_candidate!==null,confirmation_record_preserved:supplement.envelope_ui.workbench_confirmation!==null},history_archived:false,archive_created:false,decoded:false,staged:false,financial_writes:0,original_owner_unchanged:true,project_and_envelope_unchanged:true,customer_review_unchanged:true};}
  if(![4,8].includes(pressureCount)||code!==(pressureCount===4?'SOURCE_CAPTURE_BYTES':'SOURCE_ROOT_BYTES')||!original_refused)throw error;
  if(!workbenchState.isCurrent(checkpoint)||JSON.stringify(state.project)!==projectBefore||(feeEnvelopeWorkspace.controller.state().current?.raw_json??null)!==envelopeBefore||workflow.customerReviewed!==reviewBefore)throw Error('RECOVERY_REFUSAL_MUTATED');
  return{label,status:'BOTH_REFUSED',code,original_refused,archive_created:false,decoded:false,staged:false,financial_writes:0,original_owner_unchanged:true,project_and_envelope_unchanged:true,customer_review_unchanged:true};}
 const workspace=new RecoveryWorkspace98(format),staged=await workspace.stage(wire);if(workspace.current()!==null)throw Error('RECOVERY_PREMATURE_INSTALL');
 let foreign=false;try{workspace.confirm(JSON.parse(JSON.stringify(staged)),'REPLACE_QUARANTINE_DATA');}catch{foreign=true;}
 const data=workspace.confirm(staged,'REPLACE_QUARANTINE_DATA'),archive=data.archive,sameOriginal=JSON.stringify(archive.restoration.capture)===JSON.stringify(original),sameSupplement=JSON.stringify(archive.supplement)===JSON.stringify(supplement);
 let twice=false;try{workspace.confirm(staged,'REPLACE_QUARANTINE_DATA');}catch{twice=true;}
 let invalid=false;try{await workspace.stage('BROKEN {');}catch{invalid=true;}
 const preserved=workspace.current()===data,sourceUnchanged=workbenchState.isCurrent(checkpoint)&&JSON.stringify(state.project)===projectBefore&&(feeEnvelopeWorkspace.controller.state().current?.raw_json??null)===envelopeBefore&&workflow.customerReviewed===reviewBefore;
 if(!sameOriginal||!sameSupplement||!foreign||!twice||!invalid||!preserved||!sourceUnchanged||data.active_reads!==0||data.customer_reviewed!==false||data.pending_patch_replays!==0||data.runtime_installed!==false)throw Error('RECOVERY_ROUNDTRIP_DIFFERS '+JSON.stringify({sameOriginal,sameSupplement,foreign,twice,invalid,preserved,sourceUnchanged,owner_current:workbenchState.isCurrent(checkpoint),project_unchanged:JSON.stringify(state.project)===projectBefore,envelope_unchanged:(feeEnvelopeWorkspace.controller.state().current?.raw_json??null)===envelopeBefore,review_unchanged:workflow.customerReviewed===reviewBefore}));
 recoveryWire98=wire;const packet=JSON.parse(wire),isGzip=packet.kind==='INTERNAL_FEE_WORKBENCH_RECOVERY_ARCHIVE';
 return{label,status:'RESTORED_TO_DATA_QUARANTINE',complete_capture_equal:true,supplement_equal:true,capture_sha256:await hashRecovery98(JSON.stringify(original)),supplement_sha256:await hashRecovery98(archive.supplement_json),source_wire_sha256:await hashRecovery98(archive.source_wire),wire_sha256:await hashRecovery98(wire),wire_characters:wire.length,wire_utf8_bytes:new TextEncoder().encode(wire).length,transport:isGzip?'GZIP_BASE64_UTF8':'PLAIN_JSON',logical_utf8_bytes:archive.logical_utf8_bytes,private_copy_refused:foreign,double_confirmation_refused:twice,failed_replacement_preserved:preserved,original_owner_unchanged:true,project_and_envelope_unchanged:true,customer_review_unchanged:true,customer_confirmation_restored:false,pending_patch_replays:0,active_reads:0,financial_writes:0,runtime_installed:false,requires_input_review:data.requires_input_review,browser_input_requires_reentry:data.browser_input_requires_reentry,calculation:data.calculation,history:{application_record_preserved:supplement.envelope_ui.workbench_application!==null,candidate_record_preserved:supplement.envelope_ui.workbench_candidate!==null,confirmation_record_preserved:supplement.envelope_ui.workbench_confirmation!==null},fresh_owner:workspace.ownerStatus(),pending:{present:supplement.pending_present,form:supplement.pending_control!==null,other:supplement.pending_other!==null,unchecked:supplement.pending_control?.checked===false,selected_values:supplement.pending_control?.selected_values??null,browser_buffer_unavailable:supplement.pending_control?.bad_input===true,file_metadata_only:Array.isArray(supplement.pending_control?.files)&&supplement.pending_control.files.length>0}};
}
async function recoveryScenario98(label){
 const before={pending:workflow.pendingCalculation,control:workflow.editedControl,recovery:workflow.recoveryStage,busy:workflow.recoveryReviewBusy,sensitivity:workflow.sensitivityControls};let control=null,storageDescriptor=null;
 try{
  if(label==='pending_text'||label==='pending_checkbox'||label==='pending_select'||label==='pending_other'){
   control=document.createElement(label==='pending_select'?'select':label==='pending_other'?'div':'input');control.id='synthetic-recovery98';
   if(label==='pending_text'){control.type='text';control.value='未提交 not-a-number 中😀';document.body.append(control);}
   if(label==='pending_checkbox'){control.type='checkbox';control.checked=false;}
   if(label==='pending_select'){control.multiple=true;for(const value of['A','中😀']){const option=document.createElement('option');option.value=value;option.selected=true;control.append(option);}}
   if(label==='pending_other'){control.contentEditable='true';control.textContent='未提交 OTHER 中😀';}
   workflow.editedControl=control;workflow.pendingCalculation=label==='pending_text';
  }
  if(label==='recovery_active'){workflow.recoveryStage='INTERACTION';workflow.recoveryReviewBusy=true;}
  if(label==='unknown_extension')workflow.sensitivityControls={...workflow.sensitivityControls,synthetic_unknown:{raw:'\ufeff \r\n中😀',negative_zero:-0,history:'UNKNOWN_IMPORTED'}};
  if(label==='storage_unavailable'){storageDescriptor=Object.getOwnPropertyDescriptor(Storage.prototype,'getItem');Object.defineProperty(Storage.prototype,'getItem',{configurable:true,value(){throw Error('SYNTHETIC_STORAGE_UNAVAILABLE');}});}
  return await recoveryCycle98(label,label==='forced_gzip'?'GZIP':'AUTO');
 }finally{if(storageDescriptor)Object.defineProperty(Storage.prototype,'getItem',storageDescriptor);control?.remove();workflow.pendingCalculation=before.pending;workflow.editedControl=before.control;workflow.recoveryStage=before.recovery;workflow.recoveryReviewBusy=before.busy;workflow.sensitivityControls=before.sensitivity;}
}
let specialInput98=null;
function prepareInput98(kind){if(specialInput98||!['number','file'].includes(kind))throw Error('RECOVERY_INPUT_SETUP');const control=document.createElement('input');control.type=kind;control.id='synthetic-recovery-native-input';document.body.append(control);
 specialInput98={control,pending:workflow.pendingCalculation,previous:workflow.editedControl};if(kind==='file'){const list=new DataTransfer();list.items.add(new File(['SYNTHETIC_UNREAD_BYTES'],'incoming.json',{type:'application/json',lastModified:1}));control.files=list.files;}
 workflow.editedControl=control;workflow.pendingCalculation=true;return control.id;}
function clearInput98(){if(specialInput98){const old=specialInput98;specialInput98=null;old.control.remove();workflow.pendingCalculation=old.pending;workflow.editedControl=old.previous;}}
Object.defineProperty(window,'__feeRecovery98',{value:Object.freeze({inventory:inventory98,scenario:recoveryScenario98,cycle:recoveryCycle98,supplement:supplement98,prepareInput:prepareInput98,clearInput:clearInput98,
 wireChunk:(at,length)=>{if(!Number.isSafeInteger(at)||at<0||!Number.isSafeInteger(length)||length<1||length>262144||recoveryWire98===null)throw Error('RECOVERY_WIRE_CHUNK');return recoveryWire98.slice(at,at+length);},clearWire:()=>{recoveryWire98=null;}}),configurable:true});
`;
