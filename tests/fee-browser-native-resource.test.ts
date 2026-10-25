import {describe, expect, it, vi} from 'vitest';
import {FeeBrowserNativeCodec} from '../tools/fee-browser-native-codec';
import {FeeBrowserCaptureContract} from '../tools/fee-browser-capture-contract';
import {WorkbenchStateOwner} from '../src/ui/workbench-state';
import {feeLayeredParts as parts} from '../tools/fee-layered-capture-cases';
import {encodeFeeLayeredCapturePrototype as encode} from '../tools/fee-layered-capture-prototype';
import {probeFeeBrowserNativeResources} from '../tools/fee-browser-native-resource-probe';
const signal = () => new AbortController().signal;
const deferred = <T,>() => {let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
describe('native codec bounds outstanding work without pretending physical crypto cancellation', () => {
  it('checks both native API boundaries with forty overlapping requests and eventual slot reuse', async () => {
    const report = await probeFeeBrowserNativeResources(); expect(report.cases).toHaveLength(6);
    expect(report.cases.every(c => Object.values(c.checks).every(Boolean))).toBe(true);
  });
  it.each(['encode','decode'] as const)('%s: pre-abort and busy checks happen before borrowed input access', async method => {
    const c = new FeeBrowserNativeCodec(), gate = deferred<ArrayBuffer>(), digest = vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(() => gate.promise), controller = new AbortController(), getter = vi.fn();
    const input = parts(); Object.defineProperty(input, 'retained_root', {enumerable: true, get: getter}); controller.abort({private: 'HIDDEN'});
    try {
      await expect(method === 'encode' ? c.encode(input, controller.signal) : c.decode('PRIVATE', controller.signal)).rejects.toThrow('CANCELLED');
      const held = c.encode(parts(), signal()); expect(c.state()).toBe('WORKING');
      for (let i = 0; i < 20; i++) await expect(method === 'encode' ? c.encode(input, signal()) : c.decode('INVALID', signal())).rejects.toThrow('BUSY');
      expect(getter).not.toHaveBeenCalled(); expect(digest).toHaveBeenCalledTimes(1); gate.resolve(new Uint8Array(32).buffer); await held;
      expect(c.state()).toBe('IDLE'); expect(await c.encode(parts(), signal())).toBe(encode(parts()));
    } finally {gate.resolve(new Uint8Array(32).buffer); digest.mockRestore();}
  });
  for (const method of ['encode','decode'] as const) for (const action of ['abort','reject'] as const) {
    it(method + ': ' + action + ' keeps slot until digest settles, then releases without a second hash', async () => {
      const c = new FeeBrowserNativeCodec(), gate = deferred<ArrayBuffer>(), digest = vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(() => gate.promise), controller = new AbortController();
      try {
        const held = (method === 'encode' ? c.encode(parts(), controller.signal) : c.decode(encode(parts()), controller.signal)).catch(e => e.code);
        if (action === 'abort') controller.abort({private: 'SECRET'});
        expect(c.state()).toBe('WORKING'); await expect(c.encode(parts(), signal())).rejects.toThrow('BUSY');
        if (action === 'abort') gate.resolve(new Uint8Array(32).buffer); else gate.reject({get message() {throw Error('DO_NOT_READ');}});
        expect(await held).toBe(action === 'abort' ? 'CANCELLED' : 'CRYPTO_FAILED'); expect(c.state()).toBe('IDLE'); expect(digest).toHaveBeenCalledTimes(1);
        expect(await c.encode(parts(), signal())).toBe(encode(parts()));
      } finally {gate.resolve(new Uint8Array(32).buffer); digest.mockRestore();}
    });
  }
  it.each(['cancel','dispose','replace'] as const)('contract %s rejects while real native digest is held; no queued retry is created', async action => {
    const owner = new WorkbenchStateOwner(), c = new FeeBrowserNativeCodec(), session = new FeeBrowserCaptureContract(owner, c), gate = deferred<ArrayBuffer>(), reached = deferred<void>();
    const digest = vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(() => {reached.resolve(); return gate.promise;});
    try {
      const old = session.capture(() => parts()).catch(e => e.code); await reached.promise;
      if (action === 'cancel') session.cancel(); else if (action === 'dispose') session.dispose(); else await expect(session.capture(() => parts())).rejects.toThrow('ENCODE_FAILED');
      expect(await old).toBe(action === 'dispose' ? 'CLOSED' : 'CANCELLED'); expect(c.state()).toBe('WORKING'); expect(digest).toHaveBeenCalledTimes(1);
      await expect(c.decode(encode(parts()), signal())).rejects.toThrow('BUSY'); gate.resolve(new Uint8Array(32).buffer);
      for (let i = 0; i < 10 && c.state() === 'WORKING'; i++) await Promise.resolve();
      expect(c.state()).toBe('IDLE'); expect(session.state()).toBe(action === 'dispose' ? 'CLOSED' : 'IDLE');
      if (action !== 'dispose') {const latest = await session.capture(() => parts()); expect(session.isCurrent(latest)).toBe(true);}
    } finally {gate.resolve(new Uint8Array(32).buffer); digest.mockRestore(); session.dispose();}
  });
  it('does not issue or decode after actual owner ABA while native hashing is unresolved', async () => {
    const owner = new WorkbenchStateOwner(), state = {raw: 'A'}; owner.bind(state, 'source');
    const c = new FeeBrowserNativeCodec(), session = new FeeBrowserCaptureContract(owner, c), gate = deferred<ArrayBuffer>(), reached = deferred<void>();
    const digest = vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(() => {reached.resolve(); return gate.promise;});
    try {
      const result = session.capture(() => parts()).catch(e => e.code); await reached.promise; state.raw = 'B'; state.raw = 'A'; gate.resolve(new Uint8Array(32).buffer);
      expect(await result).toBe('STALE'); expect(session.state()).toBe('IDLE'); expect(c.state()).toBe('IDLE'); expect(digest).toHaveBeenCalledTimes(2);
    } finally {gate.resolve(new Uint8Array(32).buffer); digest.mockRestore(); session.dispose();}
  });
  it('returns a constant unavailable error and releases the resource slot', async () => {
    const c = new FeeBrowserNativeCodec(); vi.stubGlobal('crypto', undefined);
    try {await expect(c.encode(parts(), signal())).rejects.toThrow('CRYPTO_UNAVAILABLE'); expect(c.state()).toBe('IDLE');} finally {vi.unstubAllGlobals();}
  });
});
