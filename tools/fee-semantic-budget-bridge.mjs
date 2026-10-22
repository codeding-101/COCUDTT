import {feeSourceCompatibilityBridge} from './fee-source-compatibility-bridge.mjs';
// Reuse the exact phase89 synthetic state construction; replace ONLY the observed new protocol.
// Original app.ts capture stays independent, and phase89 evidence/adapter behavior remain unchanged.
const originalImport="import {inspectFeeSourceCompatibility as inspectSource89,feeCompatibilityNodes as nodesSource89} from '../../tools/fee-source-compatibility.ts';";
if(feeSourceCompatibilityBridge.split(originalImport).length!==2)throw Error('Compatibility bridge import changed');
export const feeSemanticBudgetBridge=feeSourceCompatibilityBridge.replace(originalImport,
  "import {inspectFeeSemanticBudget as inspectSource89} from '../../tools/fee-semantic-budget-diagnostic.ts';\nimport {feeCompatibilityNodes as nodesSource89} from '../../tools/fee-source-compatibility.ts';")+String.raw`
import {captureFeeSemanticBudget as captureSemantic90,projectFeeSemanticCapture as projectSemantic90} from '../../tools/fee-source-semantic-budget.ts';
// The original operational-scenario runner resolves this function at call time.
// Its fixtures, native controls, cancellation and restoration remain the phase88 ones.
compareSource88=function(label){
 const checkpoint=workbenchState.checkpoint(),projectBefore=workflow.stateInitialized?JSON.stringify(state.project):null,envelopeBefore=feeEnvelopeWorkspace.controller.state().current?.raw_json??null,reviewBefore=workflow.customerReviewed;
 const old=captureCurrentFeeWorkbench(),semantic=captureSemantic90(workbenchState,readers88()),adapted=projectSemantic90(semantic),oldJson=JSON.stringify(old),newJson=JSON.stringify(adapted),retained=JSON.parse(old.retained_json);
 const different=Object.keys(old).filter(k=>JSON.stringify(old[k])!==JSON.stringify(adapted[k]));
 if(oldJson!==newJson||different.length||!workbenchState.isCurrent(checkpoint)||projectBefore!==(workflow.stateInitialized?JSON.stringify(state.project):null)||envelopeBefore!==(feeEnvelopeWorkspace.controller.state().current?.raw_json??null)||reviewBefore!==workflow.customerReviewed)throw Error('SEMANTIC_OPERATIONAL_MISMATCH '+label);
 return{label,equal:true,different,owner_unchanged:true,project_and_receipts_unchanged:true,customer_review_unchanged:true,financial_writes:0,root_fields:Object.keys(old),retained_fields:Object.keys(retained),source_fields:Object.keys(old.sources),file_holders:Object.keys(old.files),activity:old.activity,blockers:old.blockers,pending:pendingSource88(workflow.editedControl),storage_availability:Object.values(retained.storage).map(v=>v.available),legacy_utf8_bytes:new TextEncoder().encode(oldJson).length};
};
Object.defineProperty(window,'__feeSourceSemanticBudget90',{value:Object.freeze({ids:window.__feeSourceCompatibility89.ids,scenario:scenarioSource89,operational:scenarioSource88}),configurable:true});
`;
