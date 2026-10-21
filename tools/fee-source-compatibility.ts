/** Developer-only observations. Never selects a production capture or issues application authority. */
import {parseFeeEnvelopeJson} from '../src/data/fee-envelope-json';
import {captureFeeWorkbenchSourceFrame, projectFeeSourceFrameToLegacy, type FeeSourceReaders} from '../src/ui/fee-workbench-source-adapter';
import type {RuntimeFeeWorkbenchCapture} from '../src/ui/fee-workbench-preview';
import type {WorkbenchStateOwner} from '../src/ui/workbench-state';

export interface FeeCompatibilityObservation {status: 'ACCEPTED' | 'REJECTED' | 'NOT_RUN'; reason: string | null}
export interface FeeSourceCompatibility {
  kind: 'INTERNAL_FEE_SOURCE_COMPATIBILITY_DIAGNOSTIC'; version: '0.1';
  legacy_capture: FeeCompatibilityObservation; retained_parse: FeeCompatibilityObservation;
  source_frame: FeeCompatibilityObservation; reconstruction: FeeCompatibilityObservation;
  full_capture_equal: boolean | null; owner_unchanged: boolean;
  result: 'CAPTURE_EQUAL' | 'CAPTURE_EQUAL_RETAINED_REJECTED' | 'ADAPTER_REJECTS_LEGACY_CAPTURE' | 'CAPTURE_DIFFERENT' | 'LEGACY_CAPTURE_REJECTED' | 'STALE_OBSERVATION';
  production_action: 'KEEP_ORIGINAL_CAPTURE'; financial_writes: 0;
  application_readiness: 'NOT_TESTED'; import_authority: false; confirmation_authority: false;
}
const skipped = (): FeeCompatibilityObservation => ({status:'NOT_RUN',reason:null});
/** Error messages may contain business data. Export only known fixed reason codes. */
function reason(error: unknown): string {
  if (error instanceof Error) {
    const message=Object.getOwnPropertyDescriptor(error,'message');
    if(message&&'value'in message&&typeof message.value==='string'){
      const match=/^(?:FEE_ENVELOPE_INVALID:(STRICT_JSON|UTF8_SIZE)|FEE_SOURCE_ADAPTER_([A-Z_]+))$/.exec(message.value);
      if(match?.[1])return 'ENVELOPE_'+match[1];
      if(match?.[2]&&['SHAPE','BOOLEAN','FILE_EVIDENCE','WORKFLOW','FX_LEASE','PROJECT','UNINITIALIZED_PROJECT','SOURCE','EPOCH','CONTROLLER','ENVELOPE','WORKSPACE','PENDING_CONTROL','STORAGE','STORAGE_VALUE','STALE','HEADER'].includes(match[2]))return 'ADAPTER_'+match[2];
    }
  }
  return 'SOURCE_READER_REJECTED';
}
/** Trusted synchronous callbacks only; their own side effects cannot be rolled back by this observer. */
export function inspectFeeSourceCompatibility(owner: WorkbenchStateOwner, readLegacy: () => RuntimeFeeWorkbenchCapture, readers: FeeSourceReaders): Readonly<FeeSourceCompatibility> {
  const checkpoint = owner.checkpoint();
  const out: FeeSourceCompatibility = {kind:'INTERNAL_FEE_SOURCE_COMPATIBILITY_DIAGNOSTIC',version:'0.1',legacy_capture:skipped(),retained_parse:skipped(),source_frame:skipped(),reconstruction:skipped(),
    full_capture_equal:null,owner_unchanged:true,result:'LEGACY_CAPTURE_REJECTED',production_action:'KEEP_ORIGINAL_CAPTURE',financial_writes:0,application_readiness:'NOT_TESTED',import_authority:false,confirmation_authority:false};
  const observe = <T>(task: () => T, field: 'legacy_capture' | 'retained_parse' | 'source_frame' | 'reconstruction'): {value:T} | null => {
    try {const value=task();out[field]={status:'ACCEPTED',reason:null};return {value};}
    catch(error) {out[field]={status:'REJECTED',reason:reason(error)};return null;}
  };
  const current = () => {out.owner_unchanged=owner.isCurrent(checkpoint);return out.owner_unchanged;};
  const finish = () => {
    if (!current()) out.result='STALE_OBSERVATION';
    for(const field of ['legacy_capture','retained_parse','source_frame','reconstruction'] as const) Object.freeze(out[field]);
    return Object.freeze(out);
  };
  const legacy=observe(readLegacy,'legacy_capture'); if(!current())return finish();
  if(legacy)observe(()=>parseFeeEnvelopeJson(legacy.value.retained_json),'retained_parse');
  if(!current())return finish();
  const frame=observe(()=>captureFeeWorkbenchSourceFrame(owner,readers),'source_frame'); if(!current())return finish();
  const rebuilt=frame?observe(()=>projectFeeSourceFrameToLegacy(frame.value),'reconstruction'):null;
  if(!current())return finish();
  if(legacy&&rebuilt){
    out.full_capture_equal=JSON.stringify(legacy.value)===JSON.stringify(rebuilt.value);
    out.result=out.full_capture_equal?(out.retained_parse.status==='ACCEPTED'?'CAPTURE_EQUAL':'CAPTURE_EQUAL_RETAINED_REJECTED'):'CAPTURE_DIFFERENT';
  }else if(legacy)out.result='ADAPTER_REJECTS_LEGACY_CAPTURE';
  return finish();
}

/** Counts an already ordinary JSON tree for controlled test construction only. Not a validator. */
export function feeCompatibilityNodes(value: unknown): number {
  return 1+(value&&typeof value==='object'?Object.values(value).reduce<number>((sum,v)=>sum+feeCompatibilityNodes(v),0):0);
}
