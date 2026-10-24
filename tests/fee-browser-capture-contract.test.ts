import {describe, expect, it, vi} from 'vitest';
import {createServer} from 'vite';
import {WorkbenchStateOwner} from '../src/ui/workbench-state';
import {FeeBrowserCaptureContract, type FeeBrowserCaptureCodec} from '../tools/fee-browser-capture-contract';
import {encodeFeeLayeredCapturePrototype as encode, decodeFeeLayeredCapturePrototype as decode, type FeeLayeredCaptureParts} from '../tools/fee-layered-capture-prototype';
import {feeLayeredParts as parts} from '../tools/fee-layered-capture-cases';
import {transformFeeLayeredBrowserPort as transform} from '../tools/fee-layered-browser-port';

const deferred = <T,>() => {let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((ok, no) => {resolve = ok; reject = no;}); return {promise, resolve, reject};};
const codec: FeeBrowserCaptureCodec = {encode: async p => encode(p), decode: async w => decode(w)};
function setup(implementation = codec) {const owner = new WorkbenchStateOwner(), state = {raw: 'A'}; owner.bind(state, 'source'); return {owner, state, session: new FeeBrowserCaptureContract(owner, implementation)};}
function gated(stage: 'READING' | 'ENCODING' | 'VERIFYING') {
  const reached = deferred<void>(), gate = deferred<void>(); let first = true;
  const wait = async (at: string) => {if (first && at === stage) {first = false; reached.resolve(); await gate.promise;}};
  const f = setup({encode: async p => {await wait('ENCODING'); return encode(p);}, decode: async w => {await wait('VERIFYING'); return decode(w);}});
  const pending = f.session.capture(async () => {await wait('READING'); return parts();});
  return {...f, reached, gate, pending};
}
describe('browser-native interface contract uses real ownership and existing protocol data', () => {
  it('issues data only after encode and independent decode, preserving exact Node wire and owner', async () => {
    const f = setup(), before = f.owner.checkpoint(), input = parts({raw: '\ufeff 中😀\r\n"\\'.repeat(180)}), issued = await f.session.capture(() => input);
    expect(f.session.state()).toBe('ISSUED'); expect(f.session.exportWire(issued)).toBe(encode(input)); expect(issued.restoration).toEqual(decode(issued.wire));
    expect(issued).toMatchObject({financial_writes: 0, import_authority: false, confirmation_authority: false, runtime_integrated: false});
    expect(Object.isFrozen(issued)).toBe(true); expect(f.owner.isCurrent(before)).toBe(true); expect(f.state.raw).toBe('A');
  });
  it.each(['json','spread','clone','restoration','foreign-session'] as const)('refuses %s as a current private observation', async kind => {
    const f = setup(), issued = await f.session.capture(() => parts());
    const value = kind === 'json' ? JSON.parse(JSON.stringify(issued)) : kind === 'spread' ? {...issued} : kind === 'clone' ? structuredClone(issued) : kind === 'restoration' ? issued.restoration : await new FeeBrowserCaptureContract(f.owner, codec).capture(() => parts());
    expect(f.session.isCurrent(value)).toBe(false); expect(() => f.session.exportWire(value)).toThrow('FOREIGN_OR_STALE');
  });
  for (const stage of ['READING','ENCODING','VERIFYING'] as const) {
    it.each(['cancel','signal','dispose','replace'] as const)(stage + ': %s rejects before an unresolved backend returns', async action => {
      const signal = new AbortController(), reached = deferred<void>(), gate = deferred<void>(); let first = true;
      const wait = async (at: string) => {if (first && at === stage) {first = false; reached.resolve(); await gate.promise;}};
      const f = setup({encode: async p => {await wait('ENCODING'); return encode(p);}, decode: async w => {await wait('VERIFYING'); return decode(w);}});
      const pending = f.session.capture(async () => {await wait('READING'); return parts();}, signal.signal), observed = pending.catch(e => e.code);
      await reached.promise; expect(f.session.state()).toBe(stage); let latest;
      if (action === 'cancel') f.session.cancel(); else if (action === 'signal') signal.abort({private: 'DO_NOT_LEAK'}); else if (action === 'dispose') f.session.dispose(); else latest = await f.session.capture(() => parts());
      expect(await observed).toBe(action === 'dispose' ? 'CLOSED' : 'CANCELLED'); // gate is still unresolved here
      gate.resolve(); await Promise.resolve(); await Promise.resolve();
      if (latest) expect(f.session.isCurrent(latest)).toBe(true); else expect(f.session.state()).toBe(action === 'dispose' ? 'CLOSED' : 'IDLE');
      expect(f.state.raw).toBe('A');
    });
    it.each(['change','ABA'] as const)(stage + ': checks actual owner after %s on completion', async action => {
      const f = gated(stage), observed = f.pending.catch(e => e.code); await f.reached.promise;
      f.state.raw = 'B'; if (action === 'ABA') f.state.raw = 'A'; f.gate.resolve(); expect(await observed).toBe('STALE'); expect(f.session.state()).toBe('IDLE');
    });
  }
  it.each(['READING','ENCODING','VERIFYING'] as const)('redacts error accessors during %s', async stage => {
    let calls = 0; const error = {}; for (const key of ['message','stack','name']) Object.defineProperty(error, key, {get() {calls++; return 'PRIVATE';}});
    const f = setup({encode: async p => {if (stage === 'ENCODING') throw error; return encode(p);}, decode: async w => {if (stage === 'VERIFYING') throw error; return decode(w);}});
    await expect(f.session.capture(() => {if (stage === 'READING') throw error; return parts();})).rejects.toThrow(stage === 'READING' ? 'READ_FAILED' : stage === 'ENCODING' ? 'ENCODE_FAILED' : 'VERIFY_FAILED');
    expect(calls).toBe(0); expect(f.session.state()).toBe('IDLE');
  });
  it('does not invoke a pre-aborted reader and invalidates its previous observation', async () => {
    const f = setup(), old = await f.session.capture(() => parts()), signal = new AbortController(), read = vi.fn(() => parts()); signal.abort('PRIVATE');
    await expect(f.session.capture(read, signal.signal)).rejects.toThrow('CANCELLED'); expect(read).not.toHaveBeenCalled(); expect(f.session.isCurrent(old)).toBe(false);
  });
  it('removes external listeners on settlement while a later abort still invalidates an issued view', async () => {
    const f = setup(), signal = new AbortController(), add = vi.spyOn(signal.signal, 'addEventListener'), remove = vi.spyOn(signal.signal, 'removeEventListener');
    const issued = await f.session.capture(() => parts(), signal.signal); expect(add).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1);
    signal.abort(); expect(f.session.isCurrent(issued)).toBe(false); expect(f.session.state()).toBe('STALE'); expect(() => f.session.exportWire(issued)).toThrow('FOREIGN_OR_STALE');
  });
  it('handles late backend rejection after cancellation without reviving the old request', async () => {
    const f = setup(), gate = deferred<FeeLayeredCaptureParts>(), old = f.session.capture(() => gate.promise).catch(e => e.code);
    const latest = await f.session.capture(() => parts()); expect(await old).toBe('CANCELLED'); gate.reject({private: 'LATE_REJECTION'}); await Promise.resolve(); await Promise.resolve();
    expect(f.session.isCurrent(latest)).toBe(true);
  });
  it('gives a request started by a trusted abort listener the newest identity', async () => {
    const f = setup(), gate = deferred<FeeLayeredCaptureParts>(); let nested!: ReturnType<FeeBrowserCaptureContract['capture']>;
    const old = f.session.capture(signal => {signal.addEventListener('abort', () => {nested = f.session.capture(() => parts({latest: true}));}); return gate.promise;}).catch(e => e.code);
    const middle = f.session.capture(() => parts()).catch(e => e.code); expect(await old).toBe('CANCELLED'); expect(await middle).toBe('CANCELLED');
    const issued = await nested; gate.resolve(parts()); expect(f.session.isCurrent(issued)).toBe(true);
  });
  it('rejects codec metadata accessors without executing them', async () => {
    let calls = 0; const valid = decode(encode(parts())), bad = {...valid}; Object.defineProperty(bad, 'import_authority', {enumerable: true, get() {calls++; return true;}}); Object.freeze(bad);
    const f = setup({...codec, decode: async () => bad}); await expect(f.session.capture(() => parts())).rejects.toThrow('VERIFY_FAILED'); expect(calls).toBe(0);
  });
  it('rechecks owner after a codec descriptor trap', async () => {
    const f = setup(), valid = decode(encode(parts())); let touched = false;
    const proxy = new Proxy(valid, {ownKeys(target) {if (!touched) {touched = true; f.owner.touch();} return Reflect.ownKeys(target);}});
    const session = new FeeBrowserCaptureContract(f.owner, {...codec, decode: async () => proxy}); await expect(session.capture(() => parts())).rejects.toThrow('STALE');
  });
  it('closes idempotently and never starts a reader after disposal', async () => {
    const f = setup(), read = vi.fn(() => parts()); f.session.dispose(); f.session.dispose(); f.session.cancel();
    await expect(f.session.capture(read)).rejects.toThrow('CLOSED'); expect(read).not.toHaveBeenCalled(); expect(f.session.state()).toBe('CLOSED');
  });
  it('requires the native cancellation primitive without a silent fallback', async () => {
    const f = setup(); vi.stubGlobal('AbortController', undefined); try {await expect(f.session.capture(() => parts())).rejects.toThrow('UNAVAILABLE');} finally {vi.unstubAllGlobals();}
  });
  it('checks owner during actual WebCrypto encode/decode using the unchanged diagnostic port', async () => {
    const server = await createServer({configFile: false, plugins: [{name: 'browser-contract-existing-port', enforce: 'pre', transform}], optimizeDeps: {noDiscovery: true, include: []}, server: {middlewareMode: true, hmr: false, watch: null}, appType: 'custom'});
    try {
      const port = await server.ssrLoadModule('/tools/fee-layered-capture-prototype.ts');
      for (const stage of ['ENCODING','VERIFYING'] as const) {
        const owner = new WorkbenchStateOwner(); let encoded = 0, decoded = 0;
        const session = new FeeBrowserCaptureContract(owner, {encode: async p => {encoded++; const result = port.encodeFeeLayeredCapturePrototype(p); if (stage === 'ENCODING') queueMicrotask(() => owner.touch()); return result;}, decode: async w => {decoded++; const result = port.decodeFeeLayeredCapturePrototype(w); queueMicrotask(() => owner.touch()); return result;}});
        await expect(session.capture(() => parts())).rejects.toThrow('STALE'); expect(encoded).toBe(1); expect(decoded).toBe(stage === 'VERIFYING' ? 1 : 0);
      }
      const f = setup({encode: p => port.encodeFeeLayeredCapturePrototype(p), decode: w => port.decodeFeeLayeredCapturePrototype(w)}), root = {raw: 'BEFORE'}, issued = await f.session.capture(() => parts(root));
      expect(issued.wire).toBe(encode(parts(root))); expect(issued.restoration).toEqual(decode(issued.wire)); root.raw = 'AFTER'; f.owner.touch(); expect(f.session.isCurrent(issued)).toBe(false);
    } finally {await server.close();}
  }, 60000);
});
