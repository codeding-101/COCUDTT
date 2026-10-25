/** Controlled API-boundary test on a disposable diagnostic page. Never instrument the production workbench. */
import {FeeBrowserNativeCodec} from './fee-browser-native-codec';
import {FeeBrowserCaptureContract} from './fee-browser-capture-contract';
import {WorkbenchStateOwner} from '../src/ui/workbench-state';
import {feeLayeredParts as parts} from './fee-layered-capture-cases';
const deferred = () => {let resolve!: () => void; const promise = new Promise<void>(yes => {resolve = yes;}); return {promise, resolve};};
const code = (p: Promise<unknown>) => p.then(() => 'RESOLVED', e => Object.getOwnPropertyDescriptor(e, 'code')?.value ?? 'UNKNOWN');
export async function probeFeeBrowserNativeResources() {
  const cases: {id: string; checks: Record<string, boolean>}[] = [];
  const c = new FeeBrowserNativeCodec(), wire = await c.encode(parts(), new AbortController().signal), subtle = crypto.subtle, original = subtle.digest.bind(subtle), descriptor = Object.getOwnPropertyDescriptor(subtle, 'digest');
  for (const stage of ['ENCODING','VERIFYING'] as const) for (const action of ['cancel','dispose','replace'] as const) {
    const owner = new WorkbenchStateOwner(), session = new FeeBrowserCaptureContract(owner, c), reached = deferred(), gate = deferred(); let calls = 0;
    Object.defineProperty(subtle, 'digest', {configurable: true, value(algorithm: AlgorithmIdentifier, data: BufferSource) {
      calls++; const actual = original(algorithm, data);
      if (calls === 1) {reached.resolve(); return actual.then(async result => {await gate.promise; return result;});} return actual;
    }});
    try {
      // VERIFYING starts from a pre-existing oracle wire; ENCODING uses the actual native encoder.
      const backend = stage === 'ENCODING' ? c : {encode: async () => wire, decode: c.decode.bind(c)};
      const scoped = stage === 'ENCODING' ? session : new FeeBrowserCaptureContract(owner, backend);
      const pending = code(scoped.capture(() => parts())); await reached.promise;
      if (action === 'cancel') scoped.cancel(); else if (action === 'dispose') scoped.dispose(); else await code(scoped.capture(() => parts()));
      const prompt = await pending, busy = c.state() === 'WORKING'; let refusals = 0;
      for (let i = 0; i < 20; i++) {if (await code(c.encode(parts(), new AbortController().signal)) === 'BUSY') refusals++; if (await code(c.decode(wire, new AbortController().signal)) === 'BUSY') refusals++;}
      const one = calls === 1; gate.resolve(); for (let i = 0; i < 100 && c.state() === 'WORKING'; i++) await new Promise<void>(r => setTimeout(r, 0));
      const idle = c.state() === 'IDLE', after = await c.encode(parts(), new AbortController().signal);
      cases.push({id: 'native-resource-' + stage + '-' + action, checks: {prompt_rejection: prompt === (action === 'dispose' ? 'CLOSED' : 'CANCELLED'), held_slot: busy, all_forty_refused: refusals === 40, no_queued_digest: one, released_after_settle: idle, reuse_wire_equal: after === wire}});
      scoped.dispose();
    } finally {gate.resolve(); session.dispose(); if (descriptor) Object.defineProperty(subtle, 'digest', descriptor); else Reflect.deleteProperty(subtle, 'digest');}
  }
  return {kind: 'SYNTHETIC_FEE_BROWSER_NATIVE_RESOURCE_PROBE' as const, cases, physical_crypto_cancellation_verified: false as const, peak_memory_measured: false as const};
}
