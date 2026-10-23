import {describe, expect, it, vi} from 'vitest';
import {encodeFeeLayeredCapturePrototype as encode, decodeFeeLayeredCapturePrototype as decode} from '../tools/fee-layered-capture-prototype';
import {feeLayeredParts as parts} from '../tools/fee-layered-capture-cases';
import {copyFeeEnvelopeJson} from '../src/data/fee-envelope-json';
const long = 'SYNTHETIC_ONLY_中\r\n"\\😀'.repeat(120);
const doc = (value: unknown = {raw: long}) => JSON.parse(encode(parts(value))) as Record<string, unknown>;
const rows = (d: Record<string, unknown>) => (d.chunks as string[]).flatMap(c => JSON.parse(c) as unknown[][]);
function setRows(d: Record<string, unknown>, nodes: unknown[][]) {d.chunks = Array.from({length: Math.ceil(nodes.length / 512)}, (_, i) => JSON.stringify(nodes.slice(i * 512, (i + 1) * 512)));}
const read = (d: Record<string, unknown>) => decode(JSON.stringify(d));
describe('independent layered capture: complete strings and separate holders', () => {
  it.each([null, true, false, -0, 0.000001, 1e22, '', '中文😀\b\t\n\f\r\u0000', [], {}, {ref: 0, kind: 'text-ref', chunks: ['opaque']}, [null, 3]].map(value => ({value})))('retains ordinary values and marker-shaped data %#', ({value}) => {
    const input = parts(value), restored = decode(encode(input));
    expect(restored.retained_root).toStrictEqual(copyFeeEnvelopeJson(value));
    expect(restored.capture.retained_json).toBe(JSON.stringify(value, null, 2) + '\n');
    expect(restored).toMatchObject({financial_writes: 0, import_authority: false, confirmation_authority: false, runtime_integrated: false});
  });
  it.each(['COMPACT', 'PRETTY_LF'] as const)('keeps exact retained formatting %s', format => {
    const value = {line: '\r\n\t\u0000"\\中😀', nested: [{empty: {}}, [true, -0, 1e25]]}, input = parts(value, format), restored = decode(encode(input));
    expect(restored.capture.retained_json).toBe(format === 'COMPACT' ? JSON.stringify(value) : JSON.stringify(value, null, 2) + '\n');
  });
  it('shares raw leaves across both roots while keeping file names, nulls and confirmation fields separate', () => {
    const raw = '\ufeff  { "商品":"\\u4e2d", "amount":"113.123456789123" }\r\n' + long;
    const input = parts({first: {raw, name: null, reviewed: false}, second: {raw, name: 'B.json', reviewed: true}, pending: '{unfinished'});
    input.capture_shell.files.project = {name: 'P.json', saved_raw: raw, saved_at: null};
    input.capture_shell.files.bill = {name: null, saved_raw: raw, saved_at: '2026-10-23T00:00:00Z'};
    const wire = encode(input), packet = JSON.parse(wire), restored = decode(wire);
    expect(packet.texts).toEqual([raw]); expect(rows(packet).filter(n => n[0] === 'text-ref')).toHaveLength(4);
    expect(restored.retained_root).toStrictEqual(input.retained_root);
    expect(Buffer.from(restored.capture.files.project.saved_raw!)).toEqual(Buffer.from(raw));
    expect(restored.capture.files.project).not.toBe(restored.capture.files.bill);
    expect(Object.isFrozen(restored.capture.files.project)).toBe(true);
    expect(restored.capture.files.bill).toEqual(input.capture_shell.files.bill);
  });
  it('does not merge structurally aliased holders', () => {
    const holder = {raw: long}, restored = decode(encode(parts([holder, holder]))).retained_root as typeof holder[];
    expect(restored[0]).not.toBe(restored[1]); expect(restored[0]).toEqual(restored[1]);
  });
  it('preserves prototype-looking own keys and numeric property order as inert data', () => {
    const value = JSON.parse('{"10":"ten","2":"two","__proto__":{"polluted":true},"constructor":"literal","toJSON":"data"}');
    const restored = decode(encode(parts(value))).retained_root as object;
    expect(JSON.stringify(restored)).toBe(JSON.stringify(value)); expect(Object.hasOwn(restored, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(restored)).toBe(Object.prototype); expect(Object.prototype).not.toHaveProperty('polluted');
  });
  it('is deterministic and detached from later nested input changes', () => {
    const input = parts({a: long, rows: [{value: 'BEFORE'}]}), wire = encode(input);
    expect(encode(structuredClone(input))).toBe(wire); (input.retained_root as {rows: {value: string}[]}).rows[0]!.value = 'AFTER';
    expect((decode(wire).retained_root as {rows: {value: string}[]}).rows[0]!.value).toBe('BEFORE');
  });
  it.each([undefined, NaN, Infinity, 1n, Symbol('x'), new Date(0), '\ud800', '\udfff', Array(1), {missing: undefined}].map(value => ({value})))('rejects original unsupported data %#', ({value}) => {const input = parts(); input.retained_root = value; expect(() => encode(input)).toThrow();});
  it('rejects cycles, hidden/symbol keys and foreign prototypes', () => {
    const cycle: unknown[] = []; cycle.push(cycle);
    for (const value of [cycle, Object.defineProperty({}, 'hidden', {value: 1}), {[Symbol('x')]: 1}, Object.assign(Object.create({x: 1}), {raw: long})]) expect(() => encode(parts(value))).toThrow();
  });
  it('does not execute data getters or toJSON, including protocol wrappers', () => {
    const getter = vi.fn(() => long), toJSON = vi.fn(() => 1);
    expect(() => encode(parts(Object.defineProperty({}, 'raw', {enumerable: true, get: getter})))).toThrow();
    expect(() => encode(parts({toJSON}))).toThrow();
    const input = parts(); Object.defineProperty(input, 'capture_shell', {enumerable: true, get: getter}); expect(() => encode(input)).toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
  });
  it.each([['kind', 'OTHER'], ['version', '1.0'], ['financial_writes', 1], ['import_authority', true], ['confirmation_authority', true], ['runtime_integrated', true], ['retained_format', 'PRETTY'], ['extra', false]])('rejects altered protocol %s', (key, value) => {const d = doc(); d[key as string] = value; expect(() => read(d)).toThrow();});
  it.each([-1, 0.5, 999, 'https://foreign.invalid/raw'])('rejects invalid text reference %s', id => {
    const d = doc(), n = rows(d), i = n.findIndex(v => v[0] === 'text-ref'); n[i]![1] = id; setRows(d, n); expect(() => read(d)).toThrow('TEXT_REFERENCE');
  });
  it('rejects a negative-zero reference carried literally on the wire', () => {
    const d = doc(); d.chunks = (d.chunks as string[]).map(c => c.replace('["text-ref",0]', '["text-ref",-0]')); expect(() => read(d)).toThrow('TEXT_REFERENCE');
  });
  it('rejects text-table duplicates, unused values and non-first-use ordering', () => {
    const duplicate = doc(); (duplicate.texts as string[]).push(long); expect(() => read(duplicate)).toThrow('DUPLICATE_TEXT');
    const unused = doc(); (unused.texts as string[]).push(long + 'UNUSED'); expect(() => read(unused)).toThrow('UNUSED_TEXT');
    const order = doc([long, long + 'B']), n = rows(order), i = n.findIndex(v => v[0] === 'text-ref'); n[i]![1] = 1; setRows(order, n); expect(() => read(order)).toThrow('TEXT_ORDER');
  });
  it.each(['node-ref', 'cycle', 'alias', 'execute'])('has no structural or executable reference tag %s', tag => {const d = doc(), n = rows(d); n[0] = [tag, 0]; setRows(d, n); expect(() => read(d)).toThrow('NODE_TAG');});
  it('rejects missing, unreachable or wrongly divided root nodes', () => {
    const missing = doc(), a = rows(missing); a.pop(); setRows(missing, a); expect(() => read(missing)).toThrow();
    const extra = doc(), b = rows(extra); b.push(['null']); setRows(extra, b); expect(() => read(extra)).toThrow('UNREACHABLE_NODE');
    const boundary = doc(); boundary.retained_nodes = 1; expect(() => read(boundary)).toThrow('ROOT_BOUNDARY');
  });
  it('rejects duplicate/foreign keys and incorrect key order', () => {
    for (const keys of [['a', 'a'], ['10', '2'], [0]]) {const d = doc(), n = rows(d); n[0] = ['object', JSON.stringify(keys)]; setRows(d, n); expect(() => read(d)).toThrow();}
    const shell = doc(); const n = rows(shell); n[shell.retained_nodes as number] = ['object', JSON.stringify(['extra'])]; setRows(shell, n); expect(() => read(shell)).toThrow();
  });
  it('rejects duplicate wire keys, bad Unicode and malformed chunks before restoration', () => {
    const wire = encode(parts()); expect(() => decode(wire.replace('"version":"0.1"', '"version":"0.1","version":"0.1"'))).toThrow();
    const unicode = doc(); unicode.texts = ['\ud800']; expect(() => read(unicode)).toThrow();
    for (const chunk of ['[', '{}', '[]', '[["null",true]]']) {const d = doc(); d.chunks = [chunk]; expect(() => read(d)).toThrow();}
  });
  it('recomputes full semantic sizes and both content digests rather than trusting declarations', () => {
    const size = doc(); (size.summary as {capture: {compact_utf8_bytes: number}}).capture.compact_utf8_bytes = 1; expect(() => read(size)).toThrow('SUMMARY');
    const hash = doc(); hash.capture_sha256 = '0'.repeat(64); expect(() => read(hash)).toThrow('DIGEST');
    const text = doc(); text.texts = [long.replace('SYNTHETIC', 'DIFFERENT')]; expect(() => read(text)).toThrow('DIGEST');
  });
  it('compares 200 deterministic mixed trees against original JSON bytes in both formats', () => {
    let seed = 94023; const next = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    function value(depth: number): unknown {const kind = next() % (depth < 4 ? 7 : 5); if (!kind) return null; if (kind === 1) return next() % 2 === 0; if (kind === 2) return (next() % 100000) / 100; if (kind === 3) return long; if (kind === 4) return '"\\\r\n中😀\u0000' + next(); if (kind === 5) return Array.from({length: next() % 4}, () => value(depth + 1)); return Object.fromEntries(Array.from({length: next() % 4}, (_, i) => ['key-' + i, value(depth + 1)]));}
    for (let i = 0; i < 200; i++) {const v = value(0), f = i % 2 ? 'COMPACT' : 'PRETTY_LF', restored = decode(encode(parts(v, f))); expect(restored.retained_root).toStrictEqual(copyFeeEnvelopeJson(v)); expect(Buffer.from(restored.capture.retained_json)).toEqual(Buffer.from(f === 'COMPACT' ? JSON.stringify(v) : JSON.stringify(v, null, 2) + '\n'));}
  });
});
