import {describe, expect, it} from 'vitest';
import {captureFeeWorkbenchSourceFrame as capture, projectFeeSourceFrameToLegacy as project, type FeeSourceReaders} from '../src/ui/fee-workbench-source-adapter';
import {feeSourceAdapterFixture} from '../tools/fee-source-adapter-fixture';
import {WorkbenchStateOwner, type WorkbenchCheckpoint} from '../src/ui/workbench-state';

describe('source adapter capture ownership is local and synchronous', () => {
  it('detaches and freezes source data without changing real fees, receipts or review', async () => {
    const f=await feeSourceAdapterFixture(), before=JSON.stringify(f.h.captureInput()), token=f.h.owner.checkpoint();
    const frame=capture(f.h.owner,f.readers), legacy=project(frame);
    expect(Object.isFrozen(frame.producers.workflow)).toBe(true); expect(Object.isFrozen(frame.storage)).toBe(true);
    expect(f.h.owner.isCurrent(token)).toBe(true); expect(JSON.stringify(f.h.captureInput())).toBe(before);
    expect(f.h.workflow.customerReviewed).toBe(true); expect(f.h.envelopeUi.applicationBackup()).toBeNull();
    expect(legacy.sources).toStrictEqual(f.h.captureInput().sources);
    const ownerCopy=JSON.parse(JSON.stringify(token)) as WorkbenchCheckpoint; expect(f.h.owner.isCurrent(ownerCopy)).toBe(false);
    const oldName=frame.producers.project!.project.name; f.h.app.project.name='SYNTHETIC_NESTED_LATER'; f.h.owner.touch();
    expect(frame.producers.project!.project.name).toBe(oldName); expect(f.h.owner.isCurrent(token)).toBe(false);
  },90000);
  it('does not read the project before initialization', async () => {
    const f=await feeSourceAdapterFixture(); f.options.workflow.stateInitialized=false; let called=false;
    const frame=capture(f.h.owner,{...f.readers,project:()=>{called=true;throw Error('UNINITIALIZED_ACCESS');}});
    expect(frame.producers.project).toBeNull(); expect(called).toBe(false);
  },60000);
  it('rejects ABA changes during a producer read before returning a mixed capture', async () => {
    const f=await feeSourceAdapterFixture(), original=f.h.workflow.customerReviewed; let later=false;
    const readers:FeeSourceReaders={...f.readers,bill:()=>{f.h.workflow.customerReviewed=!original;f.h.workflow.customerReviewed=original;return f.readers.bill();},pair:()=>{later=true;return f.readers.pair();}};
    expect(()=>capture(f.h.owner,readers)).toThrow('STALE'); expect(later).toBe(false); expect(f.h.workflow.customerReviewed).toBe(original);
  },60000);
  it('does not execute JSON getters or toJSON while validating a producer payload', () => {
    const owner=new WorkbenchStateOwner(), target={value:0};owner.bind(target,'test'); let calls=0;
    const readers={bill:()=>Object.defineProperty({},'capture',{enumerable:true,get:()=>{calls++;return null;}}),pair:()=>({}),attachment:()=>({}),precision:()=>({}),envelope:()=>({}),attachment_workspace:()=>({}),precision_workspace:()=>({}),envelope_workspace:()=>({}),workflow:()=>({stateInitialized:false}),pending:()=>({}),storage:()=>({})} as unknown as FeeSourceReaders;
    expect(()=>capture(owner,readers)).toThrow(); expect(calls).toBe(0);
  });
});
