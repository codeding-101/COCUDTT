import {describe, expect, it, vi} from 'vitest';
import {FeeBrowserNativeCodec, feeBrowserNativeUtf8Bytes as utf8, inspectFeeBrowserNativeCaptureBudget as budget, FEE_LAYERED_CAPTURE_LIMITS as limits} from '../tools/fee-browser-native-codec';
import {encodeFeeLayeredCapturePrototype as nodeEncode, decodeFeeLayeredCapturePrototype as nodeDecode, inspectFeeLayeredCaptureBudget as nodeBudget} from '../tools/fee-layered-capture-prototype';
import {feeLayeredParts as parts} from '../tools/fee-layered-capture-cases';
import {probeFeeBrowserRecoveryContract} from '../tools/fee-browser-recovery-probe';
const signal = () => new AbortController().signal;
const codec = () => new FeeBrowserNativeCodec();
const long = '\ufeff  { "商品":"\\u4e2d", "cost":"113.123456789123" }\r\n中😀"\\'.repeat(70);
const nest = (depth: number): unknown => {let v: unknown = null; while (depth--) v = [v]; return v;};
describe('standalone native codec interoperates with unchanged Node wire0.1', () => {
  it.each([null, -0, true, 1e22, '', '中😀\b\t\n\f\r\u0000', [], {raw: long, pending: '{unfinished', history: 'UNKNOWN_IMPORTED'}, JSON.parse('{"10":"ten","2":"two","__proto__":{"x":1},"constructor":"data","toJSON":"text"}')].map(value => ({value})))('exact reciprocal bytes, both formats %#', async ({value}) => {
    const c = codec();
    for (const format of ['COMPACT','PRETTY_LF'] as const) {
      const input = parts(value, format), wire = await c.encode(input, signal());
      expect(wire).toBe(nodeEncode(input)); expect(await c.decode(nodeEncode(input), signal())).toStrictEqual(nodeDecode(wire));
      const restored = await c.decode(wire, signal()), {retained_json, ...capture_shell} = restored.capture;
      expect(nodeEncode({retained_root: restored.retained_root, capture_shell, retained_format: format})).toBe(wire);
      expect(restored.capture.retained_json).toBe(format === 'COMPACT' ? JSON.stringify(value) : JSON.stringify(value, null, 2) + '\n');
      expect(restored).toMatchObject({financial_writes: 0, import_authority: false, confirmation_authority: false, runtime_integrated: false});
      expect(Object.isFrozen(restored)).toBe(true); expect(Object.isFrozen(restored.capture.files.project)).toBe(true);
    }
  });
  it('detaches nested borrowed holders before its first asynchronous yield', async () => {
    const input = parts({rows: [{raw: long}]}), expected = nodeEncode(input), c = codec(), pending = c.encode(input, signal());
    (input.retained_root as {rows: {raw: string}[]}).rows[0]!.raw = 'AFTER'; input.capture_shell.files.project = {...input.capture_shell.files.project, name: 'AFTER.json'};
    expect(await pending).toBe(expected); expect(c.state()).toBe('IDLE');
  });
  it('expands aliased containers and preserves complete raw text with separate holder metadata', async () => {
    const holder = {raw: long}, input = parts([holder, holder]);
    input.capture_shell.files.project = {name: 'P.json', saved_raw: long, saved_at: null};
    input.capture_shell.files.bill = {name: null, saved_raw: long, saved_at: '2026-10-25T00:00:00Z'};
    const c = codec(), wire = await c.encode(input, signal()), restored = await c.decode(wire, signal()), roots = restored.retained_root as typeof holder[];
    expect(wire).toBe(nodeEncode(input)); expect(JSON.parse(wire).texts).toEqual([long]); expect(roots[0]).not.toBe(roots[1]);
    expect(Buffer.from(restored.capture.files.project.saved_raw!)).toEqual(Buffer.from(long)); expect(restored.capture.files.project).not.toBe(restored.capture.files.bill);
  });
  it.each([undefined, NaN, Infinity, 1n, Symbol('x'), new Date(0), '\ud800', '\udfff', Array(1), {missing: undefined}].map(value => ({value})))('rejects unsupported borrowed data before any crypto %#', async ({value}) => {
    const input = parts(); input.retained_root = value;
    const digest = vi.spyOn(crypto.subtle, 'digest'); try {await expect(codec().encode(input, signal())).rejects.toThrow(); expect(digest).not.toHaveBeenCalled();} finally {digest.mockRestore();}
  });
  it('rejects cycles, symbol/hidden keys, foreign prototypes and accessors without calling them', async () => {
    const cycle: unknown[] = []; cycle.push(cycle); const getter = vi.fn(() => long), toJSON = vi.fn(() => 1);
    for (const v of [cycle, {[Symbol('x')]: 1}, Object.defineProperty({}, 'hidden', {value: 1}), Object.create({x: 1}), Object.defineProperty({}, 'raw', {enumerable: true, get: getter}), {toJSON}]) await expect(codec().encode(parts(v), signal())).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
  });
  it.each([['kind','OTHER'], ['version','1.0'], ['financial_writes',1], ['import_authority',true], ['confirmation_authority',true], ['runtime_integrated',true], ['retained_format','PRETTY'], ['extra',false]])('refuses changed header %s', async (key, value) => {
    const d = JSON.parse(nodeEncode(parts())); d[key as string] = value; await expect(codec().decode(JSON.stringify(d), signal())).rejects.toThrow();
  });
  it.each(['digest','summary','duplicate-wire','duplicate-text','unused-text','reference','negative-zero-ref','structural-ref','missing-node','unreachable-node','root-boundary','duplicate-keys','key-order','bad-chunk','unicode'] as const)('independently rejects corrupted wire %s', async mutation => {
    const d = JSON.parse(nodeEncode(parts({raw: long}))), nodes = (d.chunks as string[]).flatMap((s: string) => JSON.parse(s) as unknown[][]);
    let raw: string;
    if (mutation === 'digest') d.retained_sha256 = '0'.repeat(64);
    if (mutation === 'summary') d.summary.capture.nodes++;
    if (mutation === 'duplicate-text') d.texts.push(long);
    if (mutation === 'unused-text') d.texts.push(long + 'UNUSED');
    if (mutation === 'reference') nodes.find(n => n[0] === 'text-ref')![1] = 999;
    if (mutation === 'structural-ref') nodes[0] = ['node-ref', 0];
    if (mutation === 'missing-node') nodes.pop();
    if (mutation === 'unreachable-node') nodes.push(['null']);
    if (mutation === 'root-boundary') d.retained_nodes = 1;
    if (mutation === 'duplicate-keys') nodes[0] = ['object', '["a","a"]'];
    if (mutation === 'key-order') nodes[0] = ['object', '["10","2"]'];
    if (mutation === 'unicode') d.texts[0] = '\ud800';
    d.chunks = [JSON.stringify(nodes)];
    if (mutation === 'negative-zero-ref') d.chunks[0] = d.chunks[0].replace('["text-ref",0]', '["text-ref",-0]');
    if (mutation === 'bad-chunk') d.chunks = ['[]'];
    raw = JSON.stringify(d); if (mutation === 'duplicate-wire') raw = raw.replace('"version":"0.1"', '"version":"0.1","version":"0.1"');
    expect(() => nodeDecode(raw)).toThrow(); await expect(codec().decode(raw, signal())).rejects.toThrow();
  });
  it('retains original strict UTF-8 counting and rejects isolated surrogates', () => {
    const bmp = String.fromCharCode(...Array.from({length: 65536}, (_, i) => i).filter(i => i < 0xd800 || i > 0xdfff));
    const supplementary = Array.from({length: 1024}, (_, i) => String.fromCodePoint(0x10000 + i * 1023)).join('');
    for (const text of [bmp, supplementary, '', long, 'e\u0301é', '\u0000\r\n']) {expect(utf8(text)).toBe(Buffer.byteLength(text)); expect(utf8(text)).toBe(new TextEncoder().encode(text).length);}
    for (const text of ['\ud800','\udfff','\ud800x\udfff']) expect(() => utf8(text)).toThrow('UNICODE');
  });
  it.each([0, 28, 32, 33])('matches root depth acceptance %i', async depth => {
    const input = parts(nest(depth)); if (depth === 33) {expect(() => budget(input)).toThrow('SEMANTIC_LIMIT'); await expect(codec().encode(input, signal())).rejects.toThrow('SEMANTIC_LIMIT');}
    else {expect(budget(input)).toEqual(nodeBudget(input)); const c = codec(); expect((await c.decode(await c.encode(input, signal()), signal())).retained_root).toEqual(input.retained_root);}
  });
  it('keeps exactly300000 expanded nodes and refuses300001 before hashing', async () => {
    const input = parts(Array(299999).fill(null), 'COMPACT'), c = codec(), wire = await c.encode(input, signal());
    expect(JSON.parse(wire).summary.retained.nodes).toBe(300000); expect(wire).toBe(nodeEncode(input)); expect((await c.decode(wire, signal())).retained_root).toEqual(input.retained_root);
    await expect(c.encode(parts(Array(300000).fill(null), 'COMPACT'), signal())).rejects.toThrow('SEMANTIC_LIMIT');
  }, 90000);
  it('keeps128MiB full-capture exact/+1 and expanded repeated-root limits before materialization', () => {
    const empty = parts('', 'COMPACT'), {blockers, ...shell} = empty.capture_shell, fixed = Buffer.byteLength(JSON.stringify({...shell, retained_json: '""', blockers}));
    const raw = 'x'.repeat(limits.semantic_bytes - fixed); expect(budget(parts(raw, 'COMPACT')).capture.compact_utf8_bytes).toBe(134217728);
    expect(() => budget(parts(raw + 'x', 'COMPACT'))).toThrow('CAPTURE_BYTES');
    expect(() => budget(parts(Array(129).fill('x'.repeat(1024 * 1024)), 'COMPACT'))).toThrow('ROOT_BYTES');
    expect(() => budget(parts(Array(48).fill('"'.repeat(1024 * 1024)), 'COMPACT'))).toThrow('CAPTURE_BYTES');
  }, 90000);
  it('runs the original39 interface/recovery cases and ten exact wires against actual native codec', async () => {
    const native = await probeFeeBrowserRecoveryContract(codec()), oracle = await probeFeeBrowserRecoveryContract({encode: async p => nodeEncode(p), decode: async w => nodeDecode(w)});
    expect(native.cases).toHaveLength(39); expect(native.cases).toEqual(oracle.cases); expect(native.cases.every(c => Object.values(c.checks).every(Boolean))).toBe(true); expect(native.wires).toEqual(oracle.wires);
  });
});
