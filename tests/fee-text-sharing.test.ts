import {describe, expect, it, vi} from 'vitest';
import {encodeFeeTextSharingPrototype as encode, decodeFeeTextSharingPrototype as decode, TEXT_SHARING_PROTOTYPE_LIMITS as limits} from '../tools/fee-text-sharing-prototype';

const long = 'SYNTHETIC_ONLY_' + '中\r\n"\\😀'.repeat(180);
const document = (value: unknown = [long]) => JSON.parse(encode(value)) as Record<string, unknown>;
const nodes = (doc: Record<string, unknown>) => doc.nodes as unknown[][];
const read = (doc: Record<string, unknown>) => decode(JSON.stringify(doc));

describe('development-only text sharing and exact restoration', () => {
  it.each([null, true, false, 0, -0, 0.000001, 1e22, '', '中文😀\b\t\n\f\r\u0000', [], {}, [null, 'ref', 4], {kind: 'INTERNAL_FEE_TEXT_SHARING_PROTOTYPE', ref: 0, nodes: [['ref', 0]]}].map(value => ({value})))('restores ordinary data and marker-like literals %#', ({value}) => {
    const restored = decode(encode(value));
    expect(restored).toStrictEqual(value);
    expect(Buffer.from(JSON.stringify(restored))).toEqual(Buffer.from(JSON.stringify(value)));
  });
  it('preserves source UTF-8, whitespace, escaped Unicode and CRLF without parsing the source', () => {
    const raw = '\ufeff  { "商品" : "\\u4e2d", "金额": "113.123456789123" }\r\n' + long;
    const input = {first: {name: 'A.json', saved_raw: raw, saved_at: null}, second: {name: null, saved_raw: raw, saved_at: '2026-10-21T00:00:00.000Z'}};
    const wire = encode(input), doc = JSON.parse(wire), output = decode(wire) as typeof input;
    expect(doc.texts).toEqual([raw]); expect(doc.nodes.filter((n: unknown[]) => n[0] === 'ref')).toHaveLength(2);
    expect(Buffer.from(output.first.saved_raw)).toEqual(Buffer.from(raw));
    expect(output).toStrictEqual(input); expect(output.first).not.toBe(output.second);
    output.first.name = 'CHANGED'; expect(output.second.name).toBeNull(); expect(input.first.name).toBe('A.json');
    expect(decode(wire)).toStrictEqual(input);
  });
  it('handles prototype-looking keys as inert own data and retains order', () => {
    const input = JSON.parse('{"__proto__":{"x":"literal"},"constructor":"data","prototype":[1],"10":"ten","2":"two"}');
    const output = decode(encode(input)) as Record<string, unknown>;
    expect(Object.hasOwn(output, '__proto__')).toBe(true); expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
    expect(JSON.stringify(output)).toBe(JSON.stringify(input)); expect(Object.prototype).not.toHaveProperty('x');
  });
  it('uses deterministic text/node order and does not retain a mutable input', () => {
    const input = {a: long, b: [long, {p: null}]}, wire = encode(input);
    expect(encode(structuredClone(input))).toBe(wire);
    input.b = []; expect(decode(wire)).toStrictEqual({a: long, b: [long, {p: null}]});
  });
  it('copies repeated holders independently even when the caller shared the same object', () => {
    const holder = {raw: long, reviewed: false}, output = decode(encode([holder, holder])) as typeof holder[];
    expect(output[0]).not.toBe(output[1]); output[0]!.reviewed = true; expect(output[1]!.reviewed).toBe(false);
  });
  it('refuses accessors and toJSON without calling them', () => {
    const getter = vi.fn(() => long), toJSON = vi.fn(() => ({raw: long}));
    expect(() => encode(Object.defineProperty({}, 'raw', {enumerable: true, get: getter}))).toThrow();
    expect(() => encode({toJSON})).toThrow(); expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
  });
  it.each([undefined, NaN, Infinity, 1n, new Date(0), '\ud800', '\udfff', Array(1), {missing: undefined}].map(value => ({value})))('retains the original strict input boundary %#', ({value}) => expect(() => encode(value)).toThrow());
  it('rejects actual cyclic inputs', () => {const value: unknown[] = []; value.push(value); expect(() => encode(value)).toThrow();});
  it('retains the existing strict wire duplicate-key and malformed Unicode checks', () => {
    const wire = encode(null);
    expect(() => decode(wire.replace('"version":"0.1"', '"version":"0.1","version":"0.1"'))).toThrow();
    expect(() => decode(wire.replace('"texts":[]', '"texts":["\\ud800"]'))).toThrow();
  });
  it.each([
    ['kind', 'OTHER'], ['version', '1.0'], ['financial_writes', 1], ['import_authority', true], ['confirmation_authority', true], ['root', 1], ['extra_authority', false],
  ])('refuses altered header %s', (key, value) => {const doc = document(); doc[key as string] = value; expect(() => read(doc)).toThrow('HEADER');});
  it.each([-1, 1.5, 999, 'https://foreign.invalid/node'])('refuses an invalid node reference %s', id => {
    const doc = document(); (nodes(doc)[0]![1] as unknown[])[0] = id; expect(() => read(doc)).toThrow('NODE_REFERENCE');
  });
  it('rejects reference cycles before restoration', () => {const doc = document(); doc.nodes = [['array', [0]]]; expect(() => read(doc)).toThrow('REFERENCE_CYCLE');});
  it('forbids object/node aliasing across holders', () => {const doc = document(); doc.nodes = [['array', [1, 1]], ['null']]; expect(() => read(doc)).toThrow('NODE_ALIAS');});
  it('rejects out-of-order nodes and unreachable nodes', () => {
    const doc = document(); doc.nodes = [['array', [2, 1]], ['null'], ['null']]; expect(() => read(doc)).toThrow('NODE_ORDER');
    doc.nodes = [['null'], ['null']]; expect(() => read(doc)).toThrow('UNREACHABLE_NODE');
  });
  it('rejects missing/foreign text references, duplicate text and unused table entries', () => {
    const doc = document(); nodes(doc)[1] = ['ref', 20]; expect(() => read(doc)).toThrow('TEXT_REFERENCE');
    const duplicated = document(); (duplicated.texts as string[]).push(long); expect(() => read(duplicated)).toThrow('DUPLICATE_TEXT');
    const unused = document(null); unused.texts = [long]; expect(() => read(unused)).toThrow('UNUSED_TEXT');
  });
  it('requires a first-use text order and refuses short table entries', () => {
    const doc = document([long, long + 'B']); nodes(doc)[1] = ['ref', 1]; expect(() => read(doc)).toThrow('TEXT_ORDER');
    const short = document(); short.texts = ['small']; expect(() => read(short)).toThrow('TEXT_ENTRY');
  });
  it('rejects unknown tags, malformed tuples, duplicate object keys and noncanonical long literals', () => {
    const tag = document(null); tag.nodes = [['EXECUTE', 'path']]; expect(() => read(tag)).toThrow('NODE_TAG');
    tag.nodes = [['null', true]]; expect(() => read(tag)).toThrow('NODE_SHAPE');
    tag.nodes = [['object', [['a', 1], ['a', 2]]], ['null'], ['null']]; expect(() => read(tag)).toThrow('DUPLICATE_KEY');
    tag.nodes = [['text', long]]; expect(() => read(tag)).toThrow('TEXT_ENTRY');
  });
  it('checks expanded bytes before allocating a repeated large result', () => {
    const doc = document(null), raw = 'x'.repeat(1024 * 1024);
    doc.texts = [raw]; doc.nodes = [['array', Array.from({length: 129}, (_, i) => i + 1)], ...Array.from({length: 129}, () => ['ref', 0])];
    doc.expanded_json_utf8_bytes = 1;
    expect(() => read(doc)).toThrow('EXPANDED_LIMIT');
    expect(limits.encoded_bytes).toBe(128 * 1024 * 1024); expect(limits.expanded_json_bytes).toBe(limits.encoded_bytes);
  }, 30000);
  it('checks semantic depth independently of the flat wire depth', () => {
    const doc = document(null); doc.nodes = [...Array.from({length: 33}, (_, i) => ['array', [i + 1]]), ['null']];
    expect(() => read(doc)).toThrow('DEPTH');
  });
  it('rejects incorrect declared sizes and modified text, with no authority from a digest', () => {
    const wrongSize = document(); wrongSize.expanded_json_utf8_bytes = 1; expect(() => read(wrongSize)).toThrow('SIZE_MISMATCH');
    const wrongText = document(); wrongText.texts = [long.replace('SYNTHETIC_ONLY_', 'DIFFERENT_ONLY_')]; expect(() => read(wrongText)).toThrow('DIGEST_MISMATCH');
    const wrongHash = document(); wrongHash.expanded_json_sha256 = '0'.repeat(64); expect(() => read(wrongHash)).toThrow('DIGEST_MISMATCH');
  });
  it('round-trips 200 deterministic mixed values against native JSON and UTF-8', () => {
    let seed = 86021;
    const next = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed;};
    const value = (depth: number): unknown => {
      const kind = next() % (depth < 4 ? 7 : 5);
      if (kind === 0) return null;
      if (kind === 1) return next() % 2 === 0;
      if (kind === 2) return (next() % 10000) / 100;
      if (kind === 3) return long;
      if (kind === 4) return 'literal "\\\r\n😀中文 ' + next();
      if (kind === 5) return Array.from({length: next() % 4}, () => value(depth + 1));
      return Object.fromEntries(Array.from({length: next() % 4}, (_, i) => ['key-' + i, value(depth + 1)]));
    };
    for (let i = 0; i < 200; i++) {const original = value(0), restored = decode(encode(original)); expect(restored).toStrictEqual(original); expect(Buffer.from(JSON.stringify(restored))).toEqual(Buffer.from(JSON.stringify(original)));}
  }, 30000);
});
