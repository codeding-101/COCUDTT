import {feeSourceAdapterBridge} from './fee-source-adapter-bridge.mjs';
import {feeSemanticBudgetBridge} from './fee-semantic-budget-bridge.mjs';
import {feeLegacyCaptureOracle} from './fee-legacy-capture-oracle.mjs';
// All modifications are in a dedicated in-memory validation transform.
// The historical capture is independent from the actual new app binding.
const observer=feeSemanticBudgetBridge.replaceAll('captureCurrentFeeWorkbench()','captureLegacyFeeWorkbench91()')
 .replace("inspectFeeSemanticBudget as inspectSource89","inspectFeeSemanticIntegration as inspectSource89")
 .replaceAll('fee-semantic-budget-diagnostic.ts','fee-semantic-integration-diagnostic.ts')
 .replace("from '../../tools/fee-source-semantic-budget.ts'","from './fee-workbench-semantic-capture.ts'")
 .replace("}},readers88());","}},readers88(),()=>captureCurrentFeeWorkbench());")
 .replace("semantic=captureSemantic90(workbenchState,readers88()),adapted=projectSemantic90(semantic)","adapted=captureCurrentFeeWorkbench()")
 .replaceAll('__feeSourceSemanticBudget90','__feeSemanticIntegration91');
if(!observer.includes('readers88(),()=>captureCurrentFeeWorkbench()')||!observer.includes('adapted=captureCurrentFeeWorkbench()'))throw Error('Production binding was not observed');
export const feeSemanticIntegrationBridge="import {captureRuntimeFeeWorkbench} from './fee-workbench-preview.js';\n"+feeLegacyCaptureOracle+'\n'+feeSourceAdapterBridge.replaceAll('captureCurrentFeeWorkbench()','captureLegacyFeeWorkbench91()')+'\n'+observer;
