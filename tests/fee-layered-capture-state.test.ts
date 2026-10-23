import {describe, expect, it} from 'vitest';
import {FeeLayeredCapturePrototype, decodeFeeLayeredCapturePrototype as decode, type FeeLayeredCaptureParts} from '../tools/fee-layered-capture-prototype';
import {feeLayeredParts as parts} from '../tools/fee-layered-capture-cases';
import {WorkbenchStateOwner} from '../src/ui/workbench-state';
import {feePerformanceFixture} from '../tools/fee-performance-fixture';
import {feePerformanceHarness} from '../tools/fee-performance-harness';
import {previewRuntimeFeeWorkbench, runtimeFeeWorkbenchPreparedSnapshot} from '../src/ui/fee-workbench-preview';
import {d} from '../src/domain/decimal';
function setup() {const owner = new WorkbenchStateOwner(), state = {raw: 'A', reviewed: false}; owner.bind(state, 'source'); return {owner, state, session: new FeeLayeredCapturePrototype(owner)};}
describe('layered snapshots convey neither private identity nor recovered application authority', () => {
  it('keeps issued identity private across JSON, copying and another session', async () => {
    const f = setup(), checkpoint = f.owner.checkpoint(), issued = await f.session.capture(() => parts({raw: f.state.raw})), wire = f.session.encode(issued);
    expect(f.session.isCurrent(issued)).toBe(true); expect(f.owner.isCurrent(checkpoint)).toBe(true); expect(Object.isFrozen(issued.summary.retained)).toBe(true);
    for (const copy of [structuredClone(issued), JSON.parse(wire), decode(wire)]) {expect(f.session.isCurrent(copy)).toBe(false); expect(() => f.session.encode(copy as typeof issued)).toThrow('FOREIGN_OR_STALE');}
    expect(new FeeLayeredCapturePrototype(f.owner).isCurrent(issued)).toBe(false);
  });
  it('keeps ABA invalidation despite identical raw bytes', async () => {
    const f = setup(), issued = await f.session.capture(() => parts({raw: f.state.raw})), old = f.session.encode(issued);
    f.state.raw = 'B'; f.state.raw = 'A'; expect(f.session.isCurrent(issued)).toBe(false); expect(() => f.session.encode(issued)).toThrow('FOREIGN_OR_STALE');
    const latest = await f.session.capture(() => parts({raw: f.state.raw})); expect(f.session.encode(latest)).toBe(old);
  });
  it('invalidates nested legacy edits when the owner is explicitly touched', async () => {
    const f = setup(), nested = {raw: 'BEFORE'}, issued = await f.session.capture(() => parts(nested)); nested.raw = 'AFTER'; f.owner.touch();
    expect(f.session.isCurrent(issued)).toBe(false);
  });
  it('rejects a synchronous trusted reader that changes and restores owned state', async () => {
    const f = setup(); await expect(f.session.capture(() => {f.state.raw = 'B'; f.state.raw = 'A'; return parts();})).rejects.toThrow('STALE');
  });
  it('detects descriptor-trap reentrancy after the snapshot walk', async () => {
    const f = setup(); let changed = false; const value = new Proxy({data: 'SYNTHETIC'}, {ownKeys(target) {if (!changed) {changed = true; f.owner.touch();} return Reflect.ownKeys(target);}});
    await expect(f.session.capture(() => parts(value))).rejects.toThrow('STALE');
  });
  it.each(['cancel', 'source', 'ABA'] as const)('rejects a late read after %s', async action => {
    const f = setup(); let finish!: (v: FeeLayeredCaptureParts) => void;
    const pending = f.session.capture(() => new Promise<FeeLayeredCaptureParts>(resolve => {finish = resolve;}));
    if (action === 'cancel') f.session.cancel(); else {f.state.raw = 'B'; if (action === 'ABA') f.state.raw = 'A';}
    finish(parts()); await expect(pending).rejects.toThrow('STALE');
  });
  it('keeps only the latest concurrent read, even for equal data', async () => {
    const f = setup(); let finish!: (v: FeeLayeredCaptureParts) => void;
    const old = f.session.capture(() => new Promise<FeeLayeredCaptureParts>(resolve => {finish = resolve;}));
    const latest = await f.session.capture(() => parts()); finish(parts()); await expect(old).rejects.toThrow('STALE'); expect(f.session.isCurrent(latest)).toBe(true);
  });
  it('redacts reader exceptions and does not turn errors into partial success', async () => {
    const f = setup(), error = new Error(); let calls = 0; Object.defineProperty(error, 'message', {get() {calls++; return 'PRIVATE';}});
    await expect(f.session.capture(() => {throw error;})).rejects.toThrow('READ_OR_DATA'); expect(calls).toBe(0);
    const issued = await f.session.capture(() => parts()); await expect(f.session.capture(() => {throw Error('PRIVATE');})).rejects.toThrow('READ_OR_DATA'); expect(f.session.isCurrent(issued)).toBe(false);
  });
  it.each(['pending', 'file_name', 'saved_at', 'customer_reviewed', 'storage_available', 'read_token'])('retains %s separately from identical source text', async field => {
    const f = setup(), root = {raw: 'SYNTHETIC'.repeat(200), pending: null, file_name: null, saved_at: null, customer_reviewed: false, storage_available: false, read_token: 3};
    const before = await f.session.capture(() => parts(root)), old = f.session.encode(before), changed = {...root, [field]: 'CHANGED'};
    const next = await f.session.capture(() => parts(changed)); expect(f.session.encode(next)).not.toBe(old); expect(decode(old).retained_root).toEqual(root); expect(decode(f.session.encode(next)).retained_root).toEqual(changed);
  });
  it('restores real complete capture bytes and ten-participant readiness without applying costs', async () => {
    const fixture = await feePerformanceFixture(1), h = await feePerformanceHarness(fixture.raw), original = h.capture(), originalJson = JSON.stringify(original), checkpoint = h.owner.checkpoint();
    const {retained_json, ...capture_shell} = original, session = new FeeLayeredCapturePrototype(h.owner);
    const issued = await session.capture(() => ({retained_root: JSON.parse(retained_json), capture_shell, retained_format: 'COMPACT'}));
    const restored = decode(session.encode(issued)); expect(JSON.stringify(restored.capture)).toBe(originalJson);
    const preview = await previewRuntimeFeeWorkbench(restored.capture, 'LAYERED94_SOFTWARE_ONLY'), candidate = await h.preparer.prepare(preview);
    expect(preview.status).toBe('STAGED'); expect(candidate.participants).toHaveLength(10); expect(candidate.costs_added).toBe(1);
    expect(d(candidate.after.buyer_total).minus(candidate.before.buyer_total).eq('791')).toBe(true);
    expect(candidate.before.seller_profit).toBeNull(); expect(candidate.after.seller_profit).toBeNull();
    expect(() => h.preparer.backup(JSON.parse(JSON.stringify(candidate)))).toThrow('FOREIGN_SUMMARY');
    expect(() => runtimeFeeWorkbenchPreparedSnapshot(restored as never)).toThrow('FOREIGN_PREVIEW'); h.preparer.discard(candidate);
    const pending = structuredClone(restored.capture); pending.editors.pending_input = '{UNCOMMITTED';
    const blocked = await previewRuntimeFeeWorkbench(pending, 'LAYERED94_PENDING'); expect(blocked.status).toBe('BLOCKED'); expect(blocked.issues).toContain('UNCOMMITTED_PENDING_INPUT');
    expect(JSON.stringify(h.capture())).toBe(originalJson); expect(h.owner.isCurrent(checkpoint)).toBe(true); expect(h.workflow.customerReviewed).toBe(true); expect(h.envelopeUi.applicationBackup()).toBeNull();
  }, 120000);
  it('cannot revive a cancelled real controller read after diagnostic restoration', async () => {
    const fixture = await feePerformanceFixture(1), h = await feePerformanceHarness(fixture.raw), c = h.envelopeUi.controller; let finish!: (v: ArrayBuffer) => void;
    const current = c.state().current!.raw_json, opening = c.openFile({arrayBuffer: () => new Promise<ArrayBuffer>(resolve => {finish = resolve;})}), active = c.workbenchCapture();
    const session = new FeeLayeredCapturePrototype(h.owner), issued = await session.capture(() => parts({raw: current, epoch: active.epoch, read_token: active.read_token, reading: active.reading})), wire = session.encode(issued);
    c.cancelRead(); const checkpoint = h.owner.checkpoint(); expect(session.isCurrent(issued)).toBe(false); expect(session.isCurrent(decode(wire))).toBe(false);
    finish(new TextEncoder().encode(current).buffer); expect(await opening).toBe(false); expect(c.state().current!.raw_json).toBe(current); expect(c.state().preview).toBeNull(); expect(h.owner.isCurrent(checkpoint)).toBe(true);
  }, 60000);
});
