import {describe, expect, it} from 'vitest';
import {encodeFeeTextSharingPrototype as encode, decodeFeeTextSharingPrototype as decode} from '../tools/fee-text-sharing-prototype';
import {feePerformanceFixture} from '../tools/fee-performance-fixture';
import {feePerformanceHarness} from '../tools/fee-performance-harness';
import {previewRuntimeFeeWorkbench, type RuntimeFeeWorkbenchCapture} from '../src/ui/fee-workbench-preview';
import {WorkbenchStateOwner, type WorkbenchCheckpoint} from '../src/ui/workbench-state';
import {d} from '../src/domain/decimal';

describe('text equality is independent of state and confirmation ownership', () => {
  it('does not turn a restored checkpoint into an issued ownership token', () => {
    const owner = new WorkbenchStateOwner(), target = {value: 'BEFORE'}; owner.bind(target, 'test'); const token = owner.checkpoint();
    const restored = decode(encode(token)) as WorkbenchCheckpoint;
    expect(restored).toStrictEqual(token); expect(owner.isCurrent(token)).toBe(true); expect(owner.isCurrent(restored)).toBe(false);
    expect(owner.commit(restored, [{target, values: {value: 'AFTER'}}])).toBe(false); expect(target.value).toBe('BEFORE');
  });
  it('same text after an ABA edit still invalidates the real checkpoint', () => {
    const owner = new WorkbenchStateOwner(), target = {raw: 'SYNTHETIC_SOURCE'.repeat(100)}; owner.bind(target, 'source');
    const original = target.raw, token = owner.checkpoint(), wire = encode({raw: target.raw});
    target.raw = 'TEMPORARY'; target.raw = original;
    expect(encode({raw: target.raw})).toBe(wire); expect(owner.isCurrent(token)).toBe(false);
    expect(owner.commit(token, [{target, values: {raw: 'LATE'}}])).toBe(false); expect(target.raw).toBe(original);
  });
  it('refuses a live owner facade instead of reading accessor-backed state implicitly', () => {
    const owner = new WorkbenchStateOwner(), target = {raw: 'SYNTHETIC'}; owner.bind(target, 'source'); const token = owner.checkpoint();
    expect(() => encode(target)).toThrow(); expect(owner.isCurrent(token)).toBe(true); expect(target.raw).toBe('SYNTHETIC');
  });
  it.each(['pending_input', 'read_epoch', 'read_token', 'source_raw', 'file_name', 'saved_at', 'customer_reviewed', 'storage_available'])('retains %s independently of equal source text', field => {
    const base: Record<string, unknown> = {raw: 'SYNTHETIC'.repeat(200), pending_input: null, read_epoch: 2, read_token: 3, source_raw: 'EXACT\r\n', file_name: null, saved_at: null, customer_reviewed: true, storage_available: false};
    const before = encode(base), next = {...base, [field]: field === 'raw' ? 'DIFFERENT' : 'EXPLICIT_CHANGED_VALUE'};
    expect(encode(next)).not.toBe(before); expect(decode(encode(next))).toStrictEqual(next); expect(decode(before)).toStrictEqual(base);
  });
  it('restores a real complete capture before the original preview and ten-participant preparation', async () => {
    const fixture = await feePerformanceFixture(1), h = await feePerformanceHarness(fixture.raw), token = h.owner.checkpoint();
    const before = h.capture(), baseline = JSON.stringify(before), wire = encode(before), restored = decode(wire) as RuntimeFeeWorkbenchCapture;
    expect(JSON.stringify(restored)).toBe(baseline); expect(h.owner.isCurrent(token)).toBe(true);
    const pending = structuredClone(restored); pending.editors.cost = 'SYNTHETIC_UNCOMMITTED {未完成原文';
    const blocked = await previewRuntimeFeeWorkbench(decode(encode(pending)) as RuntimeFeeWorkbenchCapture, 'SHARING_PENDING_INPUT');
    expect(blocked.status).toBe('BLOCKED'); expect(blocked.issues).toContain('UNCOMMITTED_COST');
    await expect(h.preparer.prepare(blocked)).rejects.toThrow();
    const preview = await previewRuntimeFeeWorkbench(restored, 'SHARING_PROTOTYPE_SOFTWARE_ONLY'); expect(preview.status).toBe('STAGED');
    const candidate = await h.preparer.prepare(preview);
    expect(candidate.participants).toHaveLength(10); expect(candidate.costs_added).toBe(1);
    expect(d(candidate.after.buyer_total).minus(candidate.before.buyer_total).eq('791')).toBe(true);
    expect(candidate.before.seller_profit).toBeNull(); expect(candidate.after.seller_profit).toBeNull();
    expect(() => h.preparer.backup(decode(encode(candidate)) as typeof candidate)).toThrow('FOREIGN_SUMMARY');
    h.preparer.discard(candidate);
    expect(JSON.stringify(h.capture())).toBe(baseline); expect(h.owner.isCurrent(token)).toBe(true);
    expect(h.workflow.customerReviewed).toBe(true); expect(h.envelopeUi.applicationBackup()).toBeNull();
  }, 90000);
  it('a cancelled real file read stays cancelled after a diagnostic snapshot is restored', async () => {
    const fixture = await feePerformanceFixture(1), h = await feePerformanceHarness(fixture.raw), c = h.envelopeUi.controller;
    const original = c.state().current!.raw_json; let finish!: (bytes: ArrayBuffer) => void;
    const pending = c.openFile({arrayBuffer: () => new Promise<ArrayBuffer>(resolve => {finish = resolve;})});
    const active = c.workbenchCapture();
    const snapshot = {raw: original, epoch: active.epoch, read_token: active.read_token, reading: active.reading};
    expect(decode(encode(snapshot))).toStrictEqual(snapshot); expect(snapshot.reading).toBe(true);
    c.cancelRead(); const cancelled = c.workbenchCapture(), checkpoint = h.owner.checkpoint();
    expect(cancelled.read_token).not.toBe(snapshot.read_token); expect(cancelled.reading).toBe(false);
    finish(new TextEncoder().encode(original).buffer); expect(await pending).toBe(false);
    expect(c.state().preview).toBeNull(); expect(c.state().current!.raw_json).toBe(original);
    expect(h.owner.isCurrent(checkpoint)).toBe(true); expect(h.envelopeUi.applicationBackup()).toBeNull();
  }, 60000);
});
