import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createServer} from 'vite';
import {diagnosticUtf8Bytes as size} from '../tools/fee-layered-browser-utf8';
import {transformFeeLayeredBrowserPort as transform} from '../tools/fee-layered-browser-port';
import {encodeFeeLayeredCapturePrototype as encode, decodeFeeLayeredCapturePrototype as decode} from '../tools/fee-layered-capture-prototype';
import {feeLayeredParts as parts} from '../tools/fee-layered-capture-cases';
import {WorkbenchStateOwner} from '../src/ui/workbench-state';
describe('scoped browser diagnostic port keeps Node codec and private freshness', () => {
  it.each(['', 'ASCII', '中文😀', '\r\n"\\\u0000', '\ud800', '\udfff', '\ud800x\udfff', 'e\u0301\u00e9', '\ufeff RAW'])('matches TextEncoder and Buffer bytes %#', text => {expect(size(text)).toBe(Buffer.byteLength(text)); expect(size(text)).toBe(new TextEncoder().encode(text).length);});
  it('counts all UTF16 single code units and deterministic mixed strings consistently', () => {
    const all = String.fromCharCode(...Array.from({length: 65536}, (_, i) => i)); expect(size(all)).toBe(Buffer.byteLength(all));
    let seed = 95024; for (let i = 0; i < 200; i++) {const text = Array.from({length: 50}, () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return String.fromCharCode(seed & 65535);}).join(''); expect(size(text)).toBe(Buffer.byteLength(text));}
  });
  it('touches only the diagnostic codec/size modules and rejects source drift', () => {
    const source = readFileSync(new URL('../tools/fee-layered-capture-prototype.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n'), port = transform(source, '/tools/fee-layered-capture-prototype.ts')!;
    expect(port.code).not.toMatch(/node:crypto|\bBuffer\./); expect(port.code).toContain('await checked.materialize()'); expect(port.code).toContain('crypto.subtle.digest');
    expect(transform('ANY_ORIGINAL', '/src/ui/app.ts')).toBeNull(); expect(() => transform('SOURCE_CHANGED', '/tools/fee-layered-capture-prototype.ts')).toThrow('SOURCE_CHANGED');
  });
  it('produces identical Node/browser wires and rejects private tokens after async hashing', async () => {
    const server = await createServer({configFile: false, plugins: [{name: 'layered-browser-port-test', enforce: 'pre', transform}], optimizeDeps: {noDiscovery: true, include: []}, server: {middlewareMode: true, hmr: false, watch: null}, appType: 'custom'});
    try {
      const port = await server.ssrLoadModule('/tools/fee-layered-capture-prototype.ts');
      for (const value of [null, -0, {raw: '\ufeff 中😀\r\n"\\'.repeat(160)}, JSON.parse('{"__proto__":{"x":1},"ref":0}'), [[], {deep: [true, null]}]]) for (const format of ['COMPACT','PRETTY_LF'] as const) {
        const input = parts(value, format), wire = await port.encodeFeeLayeredCapturePrototype(input); expect(wire).toBe(encode(input)); expect(await port.decodeFeeLayeredCapturePrototype(wire)).toStrictEqual(decode(wire));
      }
      const owner = new WorkbenchStateOwner(), session = new port.FeeLayeredCapturePrototype(owner), p = session.capture(() => parts()); queueMicrotask(() => owner.touch()); await expect(p).rejects.toThrow('STALE');
      const cancelled = session.capture(() => parts()); queueMicrotask(() => session.cancel()); await expect(cancelled).rejects.toThrow('STALE');
      const issued = await session.capture(() => parts()); expect(session.isCurrent(issued)).toBe(true); expect(session.isCurrent(JSON.parse(session.encode(issued)))).toBe(false);
    } finally {await server.close();}
  }, 60000);
});
