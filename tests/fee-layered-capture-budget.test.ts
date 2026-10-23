import {describe, expect, it} from 'vitest';
import {encodeFeeLayeredCapturePrototype as encode, decodeFeeLayeredCapturePrototype as decode, inspectFeeLayeredCaptureBudget as inspect, FEE_LAYERED_CAPTURE_LIMITS as limits} from '../tools/fee-layered-capture-prototype';
import {feeLayeredParts as parts} from '../tools/fee-layered-capture-cases';
import {copyFeeEnvelopeJson} from '../src/data/fee-envelope-json';
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8');
function nest(depth: number): unknown {let value: unknown = null; for (let i = 0; i < depth; i++) value = [value]; return value;}
describe('layered budgets count expanded original roots, independent of reference size', () => {
  it.each([0, 1, 28, 31, 32])('accepts original root depth %i without protocol-wrapper depth', depth => {
    const value = nest(depth); expect(() => copyFeeEnvelopeJson(value)).not.toThrow();
    const wire = encode(parts(value)); expect(decode(wire).retained_root).toEqual(value); expect(inspect(parts(value)).retained.root_zero_depth).toBe(depth);
  });
  it('rejects semantic depth33 even though transport chunks are shallow', () => {expect(() => copyFeeEnvelopeJson(nest(33))).toThrow(); expect(() => encode(parts(nest(33)))).toThrow('SEMANTIC_LIMIT');});
  it('supports exactly300000 semantic nodes through bounded chunks', () => {
    const value = Array(299999).fill(null), input = parts(value, 'COMPACT'), wire = encode(input), d = JSON.parse(wire);
    expect(d.summary.retained.nodes).toBe(300000); expect(d.chunks.length).toBeGreaterThan(500);
    const restored = decode(wire); expect(restored.retained_root).toEqual(value); expect(Buffer.byteLength(restored.capture.retained_json)).toBe(bytes(value));
  }, 90000);
  it('counts aliased holders separately at node300001', () => {
    const shared = Array(149999).fill(null), value = {a: shared, b: shared};
    expect(() => copyFeeEnvelopeJson(value)).toThrow(); expect(() => encode(parts(value))).toThrow('SEMANTIC_LIMIT');
  }, 30000);
  it.each(['COMPACT', 'PRETTY_LF'] as const)('matches actual JSON byte budgets in %s', format => {
    const value = {raw: '中😀\u0000\r\n"\\'.repeat(1000), nested: [[], {}, {a: ['line', false, null, 1e23]}]}, input = parts(value, format), budget = inspect(input);
    const retained_json = format === 'COMPACT' ? JSON.stringify(value) : JSON.stringify(value, null, 2) + '\n';
    const {blockers, ...shell} = input.capture_shell, full = {...shell, retained_json, blockers};
    expect(budget.retained.compact_utf8_bytes).toBe(bytes(value)); expect(budget.retained_text_utf8_bytes).toBe(Buffer.byteLength(retained_json)); expect(budget.capture.compact_utf8_bytes).toBe(bytes(full));
  });
  it('counts actual128MiB and rejects one byte over before complete capture materialization', () => {
    const empty = parts('', 'COMPACT'), {blockers, ...shell} = empty.capture_shell;
    const fixed = bytes({...shell, retained_json: '""', blockers}), value = 'x'.repeat(limits.semantic_bytes - fixed);
    expect(inspect(parts(value, 'COMPACT')).capture.compact_utf8_bytes).toBe(128 * 1024 * 1024);
    expect(() => inspect(parts(value + 'x', 'COMPACT'))).toThrow('CAPTURE_BYTES');
  }, 60000);
  it('rejects repeated raw strings above the retained-root byte limit without constructing expanded JSON', () => {
    const raw = 'x'.repeat(1024 * 1024); expect(() => inspect(parts(Array(129).fill(raw), 'COMPACT'))).toThrow('ROOT_BYTES');
  }, 30000);
  it('rejects full escaped capture above128MiB while the retained root remains below it', () => {
    const raw = '"'.repeat(1024 * 1024), value = Array(48).fill(raw);
    expect(bytes(raw) * 48).toBeLessThan(limits.semantic_bytes);
    expect(() => inspect(parts(value, 'COMPACT'))).toThrow('CAPTURE_BYTES');
  }, 30000);
  it('preserves fixed transport limits separately from semantic budgets', () => {
    expect(limits).toMatchObject({semantic_bytes: 128 * 1024 * 1024, encoded_bytes: 128 * 1024 * 1024, semantic_nodes: 300000, semantic_depth: 32, chunk_nodes: 512});
    const d = JSON.parse(encode(parts())), n = JSON.parse(d.chunks[0]); d.chunks = [JSON.stringify(n.slice(0, 1)), JSON.stringify(n.slice(1))]; expect(() => decode(JSON.stringify(d))).toThrow('CHUNK');
  });
});
