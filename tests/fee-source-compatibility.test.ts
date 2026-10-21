import {describe,expect,it} from 'vitest';
import {inspectFeeSourceCompatibility,feeCompatibilityNodes} from '../tools/fee-source-compatibility';
import {feeCompatibilityValue,feeCompatibilityCategory} from '../tools/fee-source-compatibility-cases';
import {captureFeeWorkbenchSourceFrame,projectFeeSourceFrameToLegacy,observeFeeSourceStorage,type FeeSourceReaders,type FeeWorkbenchSourceFrame} from '../src/ui/fee-workbench-source-adapter';
import {captureRuntimeFeeWorkbench} from '../src/ui/fee-workbench-preview';
import {copyFeeEnvelopeJson} from '../src/data/fee-envelope-json';
import {WorkbenchStateOwner} from '../src/ui/workbench-state';

/** Small protocol states only. Independent mapping evidence comes from actual app.ts in the browser matrix. */
function fixture(){
  const owner=new WorkbenchStateOwner(),common=()=>({file_evidence:{name:null,saved_raw:null,saved_at:null},epoch:0,reading:false,write_busy:false});
  const f={kind:'INTERNAL_FEE_WORKBENCH_SOURCE_FRAME',version:'0.1',financial_writes:0,import_authority:false,confirmation_authority:false,
    producers:{project:null,workflow:{stateInitialized:false,pendingCalculation:false,pairFxLease:null,projectReadEpoch:0,projectReadToken:null,settlementEpoch:0,settlementPlan:null,sensitivityControls:{private:'SYNTHETIC_PRIVATE'},customerFields:null,customerView:'full',customerReviewed:false,recoveryStage:null,recoveryReviewBusy:false,projectSaveBusy:false,projectResourceBusy:false,settlementBusy:false,customerSummaryBusy:false,customerPdfBusy:false},
      bill:{capture:common(),draft:null},pair:{capture:common(),pair:null,editor:null,reviewEditor:null},
      attachment:{...common(),attachment:null,editor:null,mutation_busy:false,preview:null,recovery:null,read_token:0},precision:{...common(),selection:null,editor:null,mutation_busy:false,preview:null,recovery:null,read_token:0},
      envelope:{...common(),current:null,mutation_busy:false,cache_busy:false,preview:null,read_token:0},attachment_workspace:{pending:null,export_busy:false},precision_workspace:{pending:null,export_busy:false},envelope_workspace:{pending:null,busy:false,exporting:false}},
    pending:{present:false,control:null},storage:observeFeeSourceStorage(()=>null)} as unknown as FeeWorkbenchSourceFrame;
  const p=f.producers,readers:FeeSourceReaders={project:()=>{throw Error('UNINITIALIZED_PROJECT_READ');},workflow:()=>p.workflow,bill:()=>p.bill,pair:()=>p.pair,attachment:()=>p.attachment,precision:()=>p.precision,envelope:()=>p.envelope,attachment_workspace:()=>p.attachment_workspace,precision_workspace:()=>p.precision_workspace,envelope_workspace:()=>p.envelope_workspace,pending:()=>f.pending,storage:()=>f.storage};
  return {owner,f,readers,legacy:()=>projectFeeSourceFrameToLegacy(f)};
}

describe('compatibility observations never select a production capture or authorize fees',()=>{
  it('records all four stages separately and keeps source data private',()=>{
    const f=fixture(),before=JSON.stringify(f.f),checkpoint=f.owner.checkpoint(),result=inspectFeeSourceCompatibility(f.owner,f.legacy,f.readers);
    expect(result.result).toBe('CAPTURE_EQUAL');expect(result.full_capture_equal).toBe(true);
    for(const field of ['legacy_capture','retained_parse','source_frame','reconstruction'] as const)expect(result[field]).toEqual({status:'ACCEPTED',reason:null});
    expect(result).toMatchObject({production_action:'KEEP_ORIGINAL_CAPTURE',application_readiness:'NOT_TESTED',import_authority:false,confirmation_authority:false,financial_writes:0,owner_unchanged:true});
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE');expect(JSON.stringify(f.f)).toBe(before);expect(f.owner.isCurrent(checkpoint)).toBe(true);expect(Object.isFrozen(result.legacy_capture)).toBe(true);
  });
  it('separates accepted outer capture from rejected duplicate-key retained JSON',()=>{
    const f=fixture(),legacy=captureRuntimeFeeWorkbench({...f.legacy(),retained_json:'{"x":1,"x":2}'}),result=inspectFeeSourceCompatibility(f.owner,()=>legacy,f.readers);
    expect(result.legacy_capture.status).toBe('ACCEPTED');expect(result.retained_parse).toEqual({status:'REJECTED',reason:'ENVELOPE_STRICT_JSON'});
    expect(result.reconstruction.status).toBe('ACCEPTED');expect(result.full_capture_equal).toBe(false);expect(result.result).toBe('CAPTURE_DIFFERENT');expect(result.application_readiness).toBe('NOT_TESTED');
  });
  it('does not substitute an adapter output when an independent original capture differs',()=>{
    const f=fixture(),legacy=captureRuntimeFeeWorkbench({...f.legacy(),blockers:['SYNTHETIC_ORIGINAL_BLOCKER']}),result=inspectFeeSourceCompatibility(f.owner,()=>legacy,f.readers);
    expect(result.result).toBe('CAPTURE_DIFFERENT');expect(result.production_action).toBe('KEEP_ORIGINAL_CAPTURE');expect(legacy.blockers).toEqual(['SYNTHETIC_ORIGINAL_BLOCKER']);
  });
  it('preserves accepted old input when the stricter frame rejects a field',()=>{
    const f=fixture(),legacy=f.legacy();Object.assign(f.f.producers.workflow,{projectSaveBusy:'false'});
    const result=inspectFeeSourceCompatibility(f.owner,()=>legacy,f.readers);
    expect(result.result).toBe('ADAPTER_REJECTS_LEGACY_CAPTURE');expect(result.retained_parse.status).toBe('ACCEPTED');expect(result.source_frame.reason).toBe('ADAPTER_BOOLEAN');expect(result.reconstruction.status).toBe('NOT_RUN');expect(result.full_capture_equal).toBeNull();
  });
  it('keeps an original-capture exception distinct from an untested retained layer',()=>{
    const f=fixture(),result=inspectFeeSourceCompatibility(f.owner,()=>{throw Error('PRIVATE business path');},f.readers);
    expect(result.legacy_capture).toEqual({status:'REJECTED',reason:'SOURCE_READER_REJECTED'});expect(result.retained_parse.status).toBe('NOT_RUN');expect(result.source_frame.status).toBe('ACCEPTED');expect(result.result).toBe('LEGACY_CAPTURE_REJECTED');expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it.each([new Error('FEE_SOURCE_ADAPTER_PRIVATE_BUSINESS'),{message:'SECRET'},'SYNTHETIC_SECRET'])('exports no arbitrary exception text',error=>{
    const f=fixture(),result=inspectFeeSourceCompatibility(f.owner,()=>{throw error;},f.readers);
    expect(result.legacy_capture.reason).toBe('SOURCE_READER_REJECTED');expect(JSON.stringify(result)).not.toMatch(/SECRET|PRIVATE_BUSINESS/);
  });
  it('does not execute an exception message getter',()=>{
    const f=fixture(),error=new Error();let called=false;Object.defineProperty(error,'message',{get:()=>{called=true;return 'SECRET';}});
    expect(inspectFeeSourceCompatibility(f.owner,()=>{throw error;},f.readers).legacy_capture.reason).toBe('SOURCE_READER_REJECTED');expect(called).toBe(false);
  });
  it('stops subsequent observations after an original-reader owner mutation',()=>{
    const f=fixture(),legacy=f.legacy();let called=false;
    const result=inspectFeeSourceCompatibility(f.owner,()=>{f.owner.touch();return legacy;},{...f.readers,bill:()=>{called=true;return f.readers.bill();}});
    expect(result.result).toBe('STALE_OBSERVATION');expect(result.owner_unchanged).toBe(false);expect(result.retained_parse.status).toBe('NOT_RUN');expect(result.source_frame.status).toBe('NOT_RUN');expect(called).toBe(false);
  });
  it('detects producer ABA and never continues with later source readers',()=>{
    const f=fixture(),legacy=f.legacy(),target={text:'A'};f.owner.bind(target,'compatibility-test');let later=false;
    const result=inspectFeeSourceCompatibility(f.owner,()=>legacy,{...f.readers,bill:()=>{target.text='B';target.text='A';return f.readers.bill();},pair:()=>{later=true;return f.readers.pair();}});
    expect(result.result).toBe('STALE_OBSERVATION');expect(result.source_frame.reason).toBe('ADAPTER_STALE');expect(result.reconstruction.status).toBe('NOT_RUN');expect(later).toBe(false);expect(target.text).toBe('A');
  });
  it('does not issue a production-ready result after a failing producer',()=>{
    const f=fixture(),legacy=f.legacy(),result=inspectFeeSourceCompatibility(f.owner,()=>legacy,{...f.readers,storage:()=>{throw Error('PRIVATE_STORAGE');}});
    expect(result.source_frame).toEqual({status:'REJECTED',reason:'SOURCE_READER_REJECTED'});expect(result.production_action).toBe('KEEP_ORIGINAL_CAPTURE');expect(result.application_readiness).toBe('NOT_TESTED');
  });
  it.each(['plain','unicode','unicode_forms','opaque_text','marker_keys','key_order','null_prototype','shared_reference','negative_zero'] as const)('retains ordinary JSON serialization of %s without issuing authority',id=>{
    const f=fixture(),value=feeCompatibilityValue(id).value;f.f.producers.workflow.sensitivityControls=value;
    const frame=captureFeeWorkbenchSourceFrame(f.owner,f.readers),original=JSON.stringify(value),result=inspectFeeSourceCompatibility(f.owner,f.legacy,f.readers);
    expect(JSON.stringify(frame.producers.workflow.sensitivityControls)).toBe(original);expect(result.full_capture_equal).toBe(true);expect(result.application_readiness).toBe('NOT_TESTED');expect(feeCompatibilityCategory(id)).toBe('JSON_EXTENSION');
  });
  it('counts repeated references as repeated tree nodes rather than deduplicating budget',()=>{
    const child={value:1},root={a:child,b:child};expect(feeCompatibilityNodes(root)).toBe(5);expect(feeCompatibilityNodes(copyFeeEnvelopeJson(root))).toBe(5);
  });
});
