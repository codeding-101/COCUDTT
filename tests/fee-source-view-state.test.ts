import {describe, expect, it} from 'vitest';
import {FeeSourceViewPrototype, FEE_SOURCE_VIEW_PRODUCERS as ids, decodeFeeSourceViewPrototype as decode} from '../tools/fee-source-view-prototype';
import {feePerformanceFixture} from '../tools/fee-performance-fixture';
import {feePerformanceHarness} from '../tools/fee-performance-harness';
import {previewRuntimeFeeWorkbench} from '../src/ui/fee-workbench-preview';

describe('actual controller producer views are diagnostic only', () => {
  it('captures all ten declared producers without changing fees, receipts, review or original preparation', async () => {
    const fixture = await feePerformanceFixture(1), h = await feePerformanceHarness(fixture.raw), baseline = JSON.stringify(h.captureInput()), token = h.owner.checkpoint();
    const session = new FeeSourceViewPrototype(h.owner), readers = h.sourceViewReaders(), view = session.capture(readers), restored = decode(session.encode(view));
    expect(view.producers.map(p => p.producer)).toEqual(ids); expect(restored).toStrictEqual(view);
    for (let i = 0; i < readers.length; i++) expect(view.producers[i]!.value).toStrictEqual(readers[i]!.read());
    expect(h.owner.isCurrent(token)).toBe(true); expect(h.workflow.customerReviewed).toBe(true); expect(h.envelopeUi.applicationBackup()).toBeNull();
    expect(JSON.stringify(h.captureInput())).toBe(baseline);
    const originalPreview = await previewRuntimeFeeWorkbench(h.capture(), 'SOURCE_VIEW_ORIGINAL_PATH_ONLY');
    const candidate = await h.preparer.prepare(originalPreview); expect(candidate.participants).toHaveLength(10); expect(candidate.costs_added).toBe(1);
    expect(candidate.before.seller_profit).toBeNull(); expect(candidate.after.seller_profit).toBeNull(); h.preparer.discard(candidate);
    expect(JSON.stringify(h.captureInput())).toBe(baseline); expect(session.isCurrent(view)).toBe(true); expect(session.isCurrent(restored)).toBe(false);
  }, 90000);
  it('preserves actual pending input and invalidates an old view even when input is restored', async () => {
    const fixture = await feePerformanceFixture(1), h = await feePerformanceHarness(fixture.raw), session = new FeeSourceViewPrototype(h.owner);
    const original = session.capture(h.sourceViewReaders()), wire = session.encode(original);
    Object.assign(h.workflow, {pendingCalculation: true, editedControl: {scope: 'SYNTHETIC_PENDING', raw: '{未提交'}});
    const pending = decode(session.encode(session.capture(h.sourceViewReaders()))), workflow = pending.producers.find(p => p.producer === 'workflow')!.value as Record<string, unknown>;
    expect(workflow.pendingCalculation).toBe(true); expect(workflow.editedControl).toEqual({scope: 'SYNTHETIC_PENDING', raw: '{未提交'});
    expect(session.isCurrent(original)).toBe(false);
    h.workflow.pendingCalculation = false; h.workflow.editedControl = null;
    expect(session.encode(session.capture(h.sourceViewReaders()))).toBe(wire); expect(session.isCurrent(original)).toBe(false);
    expect(h.workflow.customerReviewed).toBe(true); expect(h.envelopeUi.applicationBackup()).toBeNull();
  }, 60000);
  it('keeps a cancelled real read invalid after a diagnostic view is decoded', async () => {
    const fixture = await feePerformanceFixture(1), h = await feePerformanceHarness(fixture.raw), c = h.envelopeUi.controller, session = new FeeSourceViewPrototype(h.owner);
    const original = c.state().current!.raw_json; let finish!: (value: ArrayBuffer) => void;
    const pendingRead = c.openFile({arrayBuffer: () => new Promise<ArrayBuffer>(resolve => {finish = resolve;})});
    const active = session.capture(h.sourceViewReaders()), activeData = decode(session.encode(active));
    const state = activeData.producers.find(p => p.producer === 'envelope')!.value as Record<string, unknown>; expect(state.reading).toBe(true);
    c.cancelRead(); const cancelled = session.capture(h.sourceViewReaders()); expect(session.isCurrent(active)).toBe(false);
    finish(new TextEncoder().encode(original).buffer); expect(await pendingRead).toBe(false);
    expect(c.state().preview).toBeNull(); expect(c.state().current!.raw_json).toBe(original); expect(session.isCurrent(cancelled)).toBe(true);
    expect(session.isCurrent(activeData)).toBe(false); expect(h.workflow.customerReviewed).toBe(true); expect(h.envelopeUi.applicationBackup()).toBeNull();
  }, 60000);
});
