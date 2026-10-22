import {describe,expect,it} from 'vitest';
import {captureFeeSemanticBudget,projectFeeSemanticCapture} from '../tools/fee-source-semantic-budget';
import {inspectFeeSemanticBudget} from '../tools/fee-semantic-budget-diagnostic';
import {feeCompatibilityValue,FEE_COMPATIBILITY_VALUE_CASES} from '../tools/fee-source-compatibility-cases';
import {feeCompatibilityNodes} from '../tools/fee-source-compatibility';
import {parseFeeEnvelopeJson} from '../src/data/fee-envelope-json';
import {captureRuntimeFeeWorkbench,runtimeFeeWorkbenchPreparedSnapshot} from '../src/ui/fee-workbench-preview';
import {captureFeeWorkbenchSourceFrame} from '../src/ui/fee-workbench-source-adapter';
import {semanticFixture} from './helpers/fee-semantic-fixture';

describe('v0.2 semantic roots preserve original guards',()=>{
  it('matches a controlled baseline, detaches data and conveys no candidate authority',()=>{
    const f=semanticFixture(),token=f.owner.checkpoint(),s=captureFeeSemanticBudget(f.owner,f.readers);
    expect(s.version).toBe('0.2');expect(JSON.stringify(s.capture)).toBe(JSON.stringify(f.baseline));expect(Object.isFrozen(s.capture.files)).toBe(true);
    f.f.producers.workflow.sensitivityControls={changed:true};expect(s.capture.retained_json).toContain('SYNTHETIC_PRIVATE');expect(f.owner.isCurrent(token)).toBe(true);
    const reopened=projectFeeSemanticCapture(JSON.parse(JSON.stringify(s)));expect(reopened).toEqual(s.capture);
    expect(()=>runtimeFeeWorkbenchPreparedSnapshot(reopened as never)).toThrow('FOREIGN_PREVIEW');expect(s).toMatchObject({financial_writes:0,import_authority:false,confirmation_authority:false});
  });
  it.each(['depth_29','depth_30'] as const)('closes the %s wrapper-depth counterexample',id=>{
    const f=semanticFixture();f.f.producers.workflow.sensitivityControls={compatibility_extension:feeCompatibilityValue(id).value};
    const original=f.original();expect(()=>parseFeeEnvelopeJson(original.retained_json)).not.toThrow();expect(()=>captureFeeWorkbenchSourceFrame(f.owner,f.readers)).toThrow('STRICT_JSON');
    expect(JSON.stringify(projectFeeSemanticCapture(captureFeeSemanticBudget(f.owner,f.readers)))).toBe(JSON.stringify(original));
  });
  it.each(['frame_over','retained_at'])('closes the %s wrapper-node counterexample',id=>{
    const f=semanticFixture(),base=feeCompatibilityNodes(f.retained),frame=feeCompatibilityNodes(captureFeeWorkbenchSourceFrame(f.owner,f.readers)),target=id==='frame_over'?300001-(frame-base):300000;
    Object.assign(f.f.producers.workflow.sensitivityControls as object,{extension:Array(target-base-1).fill(0)});
    const original=f.original();expect(feeCompatibilityNodes(JSON.parse(original.retained_json))).toBe(target);expect(()=>parseFeeEnvelopeJson(original.retained_json)).not.toThrow();
    expect(()=>captureFeeWorkbenchSourceFrame(f.owner,f.readers)).toThrow('STRICT_JSON');expect(captureFeeSemanticBudget(f.owner,f.readers).capture).toEqual(original);
  });
  it.each(['depth_31','depth_32'] as const)('still rejects the original retained-depth violation %s',id=>{
    const f=semanticFixture();f.f.producers.workflow.sensitivityControls={extension:feeCompatibilityValue(id).value};
    expect(()=>f.original()).not.toThrow();expect(()=>parseFeeEnvelopeJson(f.original().retained_json)).toThrow('STRICT_JSON');expect(()=>captureFeeSemanticBudget(f.owner,f.readers)).toThrow('STRICT_JSON');
  });
  it('counts repeated aliases as separate semantic nodes, rejecting node300001',()=>{
    const f=semanticFixture(),base=feeCompatibilityNodes(f.retained),shared=Array(Math.floor((300001-base-3)/2)).fill(0);
    Object.assign(f.f.producers.workflow.sensitivityControls as object,{a:shared,b:shared});
    let n=feeCompatibilityNodes(JSON.parse(f.original().retained_json));for(let i=n;i<300001;i++)Object.assign(f.f.producers.workflow.sensitivityControls as object,{['padding_'+i]:0});
    n=feeCompatibilityNodes(JSON.parse(f.original().retained_json));expect(n).toBe(300001);expect(()=>captureFeeSemanticBudget(f.owner,f.readers)).toThrow('STRICT_JSON');
  });
  it.each(FEE_COMPATIBILITY_VALUE_CASES.filter(id=>!id.startsWith('depth_')&&!['undefined','function','symbol_value','symbol_key','non_enumerable','sparse_array','custom_prototype','cycle','nan','infinity','lone_high','lone_low','accessor','to_json'].includes(id)))('preserves ordinary JSON extension %s',id=>{
    const f=semanticFixture();f.f.producers.workflow.sensitivityControls={extension:feeCompatibilityValue(id).value};
    expect(JSON.stringify(captureFeeSemanticBudget(f.owner,f.readers).capture)).toBe(JSON.stringify(f.original()));
  });
  it.each(['undefined','function','symbol_value','symbol_key','non_enumerable','sparse_array','custom_prototype','cycle','nan','infinity','lone_high','lone_low','accessor','to_json'] as const)('rejects unsupported JS %s without executing accessors or toJSON',id=>{
    const f=semanticFixture(),value=feeCompatibilityValue(id);f.f.producers.workflow.sensitivityControls={extension:value.value};
    expect(()=>captureFeeSemanticBudget(f.owner,f.readers)).toThrow();expect(value.calls()).toBe(0);
  });
  it('validates source-only documents even though they are absent from retained data',()=>{
    const f=semanticFixture();f.f.producers.bill.draft={extra:feeCompatibilityValue('depth_32').value} as never;
    expect(()=>captureFeeSemanticBudget(f.owner,f.readers)).toThrow('STRICT_JSON');
  });
  it('rejects an accessor on a producer wrapper before using a workflow flag',()=>{
    const f=semanticFixture();let calls=0;Object.defineProperty(f.f.producers.workflow,'stateInitialized',{enumerable:true,get:()=>{calls++;return false;}});
    expect(()=>captureFeeSemanticBudget(f.owner,f.readers)).toThrow('INVALID');expect(calls).toBe(0);
  });
  it('rejects an accessor on source-only draft without calling it',()=>{
    const f=semanticFixture();let calls=0;Object.defineProperty(f.f.producers.bill,'draft',{enumerable:true,get:()=>{calls++;return null;}});
    expect(()=>captureFeeSemanticBudget(f.owner,f.readers)).toThrow('INVALID');expect(calls).toBe(0);
  });
  it('stops on a producer ABA before reading any later producer',()=>{
    const f=semanticFixture(),state={value:'A'};f.owner.bind(state,'test');let later=false;
    expect(()=>captureFeeSemanticBudget(f.owner,{...f.readers,bill:()=>{state.value='B';state.value='A';return f.readers.bill();},pair:()=>{later=true;return f.readers.pair();}})).toThrow('STALE');expect(later).toBe(false);
  });
  it('checks revision again after descriptor traps during validation',()=>{
    const f=semanticFixture(),storage=f.f.storage;let entered=false;
    f.f.storage=new Proxy(storage,{ownKeys(target){if(!entered){entered=true;f.owner.touch();}return Reflect.ownKeys(target);}});
    expect(()=>captureFeeSemanticBudget(f.owner,f.readers)).toThrow('STALE');
  });
  it.each(['{"x":1,"x":2}','{"x":','{"x":"\\ud800"}'])('rechecks retained text when reopening a wire capture',retained_json=>{
    const f=semanticFixture(),s=captureFeeSemanticBudget(f.owner,f.readers),c=captureRuntimeFeeWorkbench({...s.capture,retained_json});
    expect(()=>projectFeeSemanticCapture({...s,capture:c})).toThrow();
  });
  it('rejects malformed/extra headers and getter payloads without execution',()=>{
    const f=semanticFixture(),s=captureFeeSemanticBudget(f.owner,f.readers);let calls=0;
    for(const d of [{...s,version:'0.1'},{...s,import_authority:true},{...s,extra:0},Object.assign(Object.create({}),s),{...s,[Symbol('x')]:0}])expect(()=>projectFeeSemanticCapture(d)).toThrow();
    const d={...s};Object.defineProperty(d,'capture',{enumerable:true,get:()=>{calls++;return s.capture;}});expect(()=>projectFeeSemanticCapture(d)).toThrow();expect(calls).toBe(0);
  });
  it('separates a rejected original retained layer from accepted outer text',()=>{
    const f=semanticFixture();f.f.producers.workflow.sensitivityControls={extension:feeCompatibilityValue('depth_31').value};
    const d=inspectFeeSemanticBudget(f.owner,f.original,f.readers);expect(d.legacy_capture.status).toBe('ACCEPTED');expect(d.retained_parse.status).toBe('REJECTED');expect(d.semantic_capture.status).toBe('REJECTED');expect(d.reconstruction.status).toBe('NOT_RUN');expect(d.full_capture_equal).toBeNull();
  });
  it('exports fixed diagnostic codes without business data or exception message getters',()=>{
    const f=semanticFixture(),error=new Error();let calls=0;Object.defineProperty(error,'message',{get:()=>{calls++;return 'SYNTHETIC_PRIVATE';}});
    const d=inspectFeeSemanticBudget(f.owner,()=>{throw error;},f.readers);expect(d.legacy_capture.reason).toBe('SOURCE_READER_REJECTED');expect(JSON.stringify(d)).not.toContain('SYNTHETIC_PRIVATE');expect(calls).toBe(0);expect(d.application_readiness).toBe('NOT_TESTED');
  });
  it('does not compare a mixed observation or run readers after original capture changes state',()=>{
    const f=semanticFixture();let called=false;const d=inspectFeeSemanticBudget(f.owner,()=>{f.owner.touch();return f.baseline;},{...f.readers,bill:()=>{called=true;return f.readers.bill();}});
    expect(d.owner_unchanged).toBe(false);expect(d.semantic_capture.status).toBe('NOT_RUN');expect(d.full_capture_equal).toBeNull();expect(called).toBe(false);
  });
});
