/** Observation-only comparison. No fallback selection or business readiness claim. */
import {parseFeeEnvelopeJson} from '../src/data/fee-envelope-json';
import type {RuntimeFeeWorkbenchCapture} from '../src/ui/fee-workbench-preview';
import type {FeeSourceReaders} from '../src/ui/fee-workbench-source-adapter';
import type {WorkbenchStateOwner} from '../src/ui/workbench-state';
import {captureFeeSemanticBudget,projectFeeSemanticCapture} from './fee-source-semantic-budget';
import type {FeeCompatibilityObservation} from './fee-source-compatibility';

function reason(error: unknown): string {
  const d=error instanceof Error ? Object.getOwnPropertyDescriptor(error,'message') : null;
  if(d&&'value'in d&&typeof d.value==='string'&&['FEE_ENVELOPE_INVALID:STRICT_JSON','FEE_ENVELOPE_INVALID:UTF8_SIZE','FEE_SEMANTIC_BUDGET_INVALID','FEE_SEMANTIC_BUDGET_STALE'].includes(d.value))return d.value;
  return 'SOURCE_READER_REJECTED';
}
export function inspectFeeSemanticBudget(owner: WorkbenchStateOwner, original: () => RuntimeFeeWorkbenchCapture, readers: FeeSourceReaders) {
  const checkpoint=owner.checkpoint(),skipped=(): FeeCompatibilityObservation=>({status:'NOT_RUN',reason:null});
  const out={kind:'INTERNAL_FEE_SEMANTIC_BUDGET_DIAGNOSTIC' as const,version:'0.2' as const,legacy_capture:skipped(),retained_parse:skipped(),semantic_capture:skipped(),reconstruction:skipped(),full_capture_equal:null as boolean|null,owner_unchanged:true,
    production_action:'KEEP_ORIGINAL_CAPTURE' as const,application_readiness:'NOT_TESTED' as const,financial_writes:0 as const,import_authority:false as const,confirmation_authority:false as const};
  const current=()=>out.owner_unchanged=owner.isCurrent(checkpoint);
  const observe=<T>(field:'legacy_capture'|'retained_parse'|'semantic_capture'|'reconstruction',task:()=>T): {value:T}|null=>{
    if(!current())return null;
    try{const value=task();out[field]={status:'ACCEPTED',reason:null};return {value};}catch(error){out[field]={status:'REJECTED',reason:reason(error)};return null;}
  };
  const legacy=observe('legacy_capture',original);if(legacy)observe('retained_parse',()=>parseFeeEnvelopeJson(legacy.value.retained_json));
  const semantic=observe('semantic_capture',()=>captureFeeSemanticBudget(owner,readers));
  const rebuilt=semantic?observe('reconstruction',()=>projectFeeSemanticCapture(semantic.value)):null;
  if(current()&&legacy&&rebuilt)out.full_capture_equal=JSON.stringify(legacy.value)===JSON.stringify(rebuilt.value);
  current();for(const k of ['legacy_capture','retained_parse','semantic_capture','reconstruction'] as const)Object.freeze(out[k]);return Object.freeze(out);
}
