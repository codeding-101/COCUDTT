/** Dedicated read-only app observation. App and all production modules remain untouched. */
import{feeRecoveryBrowserBridge}from'./fee-recovery-browser-bridge.mjs';
export const feeRecoverySharingBridge=feeRecoveryBrowserBridge+String.raw`
import{encodeFeeRecoverySharing as encodeSharing99,decodeFeeRecoverySharing as decodeSharing99,serializeFeeSharingSupplement as serializeSharing99,assessFeeRecoverySharing as assessSharing99,countFeeSharingGzipBytes as gzipSharing99}from'../../tools/fee-recovery-sharing.ts';
import{FeeBrowserNativeCodec as SharingSourceCodec99,inspectFeeBrowserNativeCaptureBudget as sourceBudget99}from'../../tools/fee-browser-native-codec.ts';
let sharingWires99=null;
async function sharingObservation99(label,count=null){
 const checkpoint=workbenchState.checkpoint(),beforeProject=JSON.stringify(state.project),beforeEnvelope=feeEnvelopeWorkspace.controller.state().current?.raw_json??null,beforeReview=workflow.customerReviewed;
 const unchanged=()=>workbenchState.isCurrent(checkpoint)&&JSON.stringify(state.project)===beforeProject&&(feeEnvelopeWorkspace.controller.state().current?.raw_json??null)===beforeEnvelope&&workflow.customerReviewed===beforeReview;
 let original=null,originalRefused=false;try{original=captureCurrentFeeWorkbench();}catch{originalRefused=true;}
 const parts=recoveryRoots98(workbenchState,readers88());let budget;
 try{budget=sourceBudget99(parts);}catch(error){const code=safeRecoveryCode98(error);if(![4,8].includes(count)||!originalRefused||code!==(count===4?'CAPTURE_BYTES':'ROOT_BYTES')||!unchanged())throw error;return{label,count,status:'SOURCE_REFUSED',code,original_capture_refused:true,sharing_encoded:false,recovery_archive_created:false,original_owner_unchanged:true,project_and_history_unchanged:true,customer_review_unchanged:true,financial_writes:0};}
 if(originalRefused)throw Error('SHARING_SOURCE_ACCEPTANCE_DIFFERS');
 const supplement=supplement98(),encoded=encodeSharing99(supplement),decoded=decodeSharing99(encoded.wire),expanded=serializeSharing99(decoded),exact=expanded===encoded.expanded_json;
 if(!exact)throw Error('SHARED_SUPPLEMENT_DIFFERS');const decision=assessSharing99(budget.capture.compact_utf8_bytes,encoded.summary.expanded_utf8_bytes,encoded.wire_utf8_bytes);
 let oldStatus='ACCEPTED',oldBytes=0,oldTransport=null;
 try{const oldWire=await new RecoveryFormat98().encode(parts,supplement,new AbortController().signal);oldBytes=new TextEncoder().encode(oldWire).length;oldTransport=JSON.parse(oldWire).kind==='INTERNAL_FEE_WORKBENCH_RECOVERY_ARCHIVE'?'GZIP_BASE64_UTF8':'PLAIN_JSON';}
 catch(error){if(safeRecoveryCode98(error)!=='LOGICAL_SIZE'||decision.within_aggregate_limit)throw error;oldStatus='REFUSED_LOGICAL_SIZE';}
 if((oldStatus==='ACCEPTED')!==decision.within_aggregate_limit)throw Error('SHARING_CHANGED_OLD_ADMISSION');
 const sourceWire=await new SharingSourceCodec99().encode(parts,new AbortController().signal),gzipOriginal=await gzipSharing99(encoded.expanded_json,new AbortController().signal),gzipShared=await gzipSharing99(encoded.wire,new AbortController().signal);
 const hashes={capture_sha256:await hashRecovery98(JSON.stringify(original)),source_wire_sha256:await hashRecovery98(sourceWire),supplement_expanded_sha256:await hashRecovery98(expanded),shared_wire_sha256:await hashRecovery98(encoded.wire)};
 if(!unchanged())throw Error('SHARING_OBSERVATION_STALE');sharingWires99={source:sourceWire,supplement:encoded.wire};
 return{label,count,status:'SUPPLEMENT_REPRESENTATION_EXACT',supplement_exact:true,original_capture_refused:false,decision,summary:encoded.summary,dictionary_entries:encoded.dictionary_entries,duplicate_occurrences:encoded.duplicate_occurrences,representation_saved_bytes:encoded.representation_saved_bytes,largest_repeated_texts:encoded.largest_repeated_texts,envelope_field_utf8_bytes:encoded.envelope_field_utf8_bytes,gzip_original_supplement_bytes:gzipOriginal,gzip_shared_supplement_bytes:gzipShared,gzip_saved_bytes:gzipOriginal-gzipShared,old_recovery_status:oldStatus,old_recovery_utf8_bytes:oldBytes,old_recovery_transport:oldTransport,source_wire_characters:sourceWire.length,shared_wire_characters:encoded.wire.length,...hashes,source_cost_count:workflow.stateInitialized?state.project.items.length:null,history:{candidate_record:supplement.envelope_ui.workbench_candidate!==null,confirmation_record:supplement.envelope_ui.workbench_confirmation!==null,application_record:supplement.envelope_ui.workbench_application!==null},original_owner_unchanged:true,project_and_history_unchanged:true,customer_review_unchanged:true,recovery_archive_created:false,runtime_installed:false,financial_writes:0};
}
window.__feeSharing99=Object.freeze({observe:sharingObservation99,inventory:inventory98,wireChunk:(kind,start,size)=>{if(!sharingWires99||!['source','supplement'].includes(kind)||!Number.isSafeInteger(start)||start<0||size!==262144)throw Error('SHARING_WIRE_ACCESS');return sharingWires99[kind].slice(start,start+size);},clearWires:()=>{sharingWires99=null;}});
`;
