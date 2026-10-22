import {describe, expect, it} from 'vitest';
import {beginCapacityTrace, endCapacityTrace, ordinaryJsonShape, observeRetainedShape, observeCompleteShape, traceCapacitySync, traceCapacityAsync, capacityFailureCode} from '../tools/fee-capacity-trace';

describe('tooling-only capacity observations', () => {
  it.each([null, true, false, -0, 1e22, 1e-8, '中文😀€', '"\\\b\t\n\f\r\u0000\u001f', '\ud800', '\udfff', '\ud800\ud800\udfff\udfff', {'键😀"': [null, '多字节', 7]}])('counts exact compact UTF-8 without granting parser acceptance %#', value => {
    expect(ordinaryJsonShape(value).compact_utf8_bytes).toBe(Buffer.byteLength(JSON.stringify(value)));
  });
  it('expands aliases per occurrence and counts depth from the original root', () => {
    const child = {a: [1, 2]}, root = {x: child, y: child};
    expect(ordinaryJsonShape(root)).toEqual({compact_utf8_bytes: Buffer.byteLength(JSON.stringify(root)), nodes: 9, root_zero_depth: 3});
    expect(ordinaryJsonShape(Object.assign(Object.create(null), {value: 1})).nodes).toBe(2);
  });
  it('projects repeated large text beyond the unchanged 128MiB budget', () => {
    expect(ordinaryJsonShape(Array(129).fill('x'.repeat(1024 * 1024))).compact_utf8_bytes).toBe(129 * (1024 * 1024 + 2) + 130);
  });
  it.each([undefined, NaN, Infinity, 1n, () => 1, Symbol('x'), new Date(0), Array(1), Object.assign([1], {extra: 2}), {a: undefined}])('rejects unsupported data without normalizing %#', value => {
    expect(() => ordinaryJsonShape(value)).toThrow('CAPACITY_SHAPE_JSON_ONLY');
  });
  it('rejects accessors, toJSON, symbols, nonenumerables, cycles and custom prototypes without invoking code', () => {
    let calls = 0;
    const getter = Object.defineProperty({}, 'x', {enumerable: true, get() {calls++; return 1;}});
    const toJSON = {toJSON() {calls++; return null;}};
    const cycle: {self?: unknown} = {}; cycle.self = cycle;
    for (const value of [getter, toJSON, {[Symbol('x')]: 1}, Object.defineProperty({}, 'hidden', {value: 1}), cycle, Object.create({x: 1})]) expect(() => ordinaryJsonShape(value)).toThrow('CAPACITY_SHAPE_JSON_ONLY');
    expect(calls).toBe(0);
  });
  it('does not observe or intercept normal uninstrumented calls', async () => {
    expect(traceCapacitySync('CAPTURE', () => 4)).toBe(4);
    expect(await traceCapacityAsync('PREPARE', async () => 5)).toBe(5);
    expect(() => endCapacityTrace()).toThrow('CAPACITY_TRACE_UNFINISHED');
  });
  it('keeps shape collection outside measured timings', () => {
    beginCapacityTrace('SHAPE', () => {throw Error('MUST_NOT_TIME');});
    observeRetainedShape({x: 1}); observeRetainedShape({x: undefined});
    traceCapacitySync('CAPTURE', () => 1);
    const report = endCapacityTrace();
    expect(report.events[0]!.ms).toBeNull();
    expect(report.retained_roots).toEqual([{status: 'COUNTED', shape: ordinaryJsonShape({x: 1}), fields: {x: ordinaryJsonShape(1)}}, {status: 'UNAVAILABLE'}]);
    beginCapacityTrace('MEASURE'); observeRetainedShape({x: 1}); expect(endCapacityTrace().retained_roots).toEqual([]);
  });
  it('counts the real nested text expansion separately from the retained semantic root', () => {
    const root = {raw: '中文😀"\\\n'}, capture = {retained_json: JSON.stringify(root, null, 2) + '\n'};
    beginCapacityTrace('SHAPE'); observeRetainedShape(root); observeCompleteShape(capture);
    const report = endCapacityTrace();
    expect(report.retained_roots[0]).toMatchObject({shape: ordinaryJsonShape(root)});
    expect(report.complete_captures).toEqual([{status: 'COUNTED', shape: {compact_utf8_bytes: Buffer.byteLength(JSON.stringify(capture)), nodes: 2, root_zero_depth: 1}}]);
  });
  it('records nested stages and propagates the original failure unchanged', async () => {
    let tick = 0; const original = Error('FEE_ENVELOPE_INVALID:STRICT_JSON');
    beginCapacityTrace('MEASURE', () => tick++);
    await expect(traceCapacityAsync('PREPARE', async () => traceCapacitySync('RETAINED_ROOT', () => {throw original;}))).rejects.toBe(original);
    expect(endCapacityTrace().events).toEqual([
      {sequence: 1, parent: null, phase: 'PREPARE', status: 'REJECTED', ms: 3, code: original.message},
      {sequence: 2, parent: 1, phase: 'RETAINED_ROOT', status: 'REJECTED', ms: 1, code: original.message},
    ]);
  });
  it('refuses overlapping sessions and unfinished asynchronous probes', async () => {
    let release!: () => void;
    beginCapacityTrace('MEASURE');
    const pending = traceCapacityAsync('PREVIEW', () => new Promise<void>(ok => {release = ok;}));
    expect(() => beginCapacityTrace('MEASURE')).toThrow('CAPACITY_TRACE_BUSY');
    expect(() => endCapacityTrace()).toThrow('CAPACITY_TRACE_UNFINISHED');
    release(); await pending; expect(endCapacityTrace().events[0]!.status).toBe('ACCEPTED');
  });
  it.each([NaN, Infinity, -1])('leaves invalid timings unknown %#', n => {
    let calls = 0; beginCapacityTrace('MEASURE', () => calls++ ? n : 0);
    traceCapacitySync('CAPTURE', () => 1); expect(endCapacityTrace().events[0]!.ms).toBeNull();
  });
  it('publishes only fixed failure codes without reading an exception accessor', () => {
    let calls = 0;
    expect(capacityFailureCode(Error('private business text'))).toBe('UNCLASSIFIED');
    expect(capacityFailureCode(Object.defineProperty({}, 'message', {get() {calls++; return 'private';}}))).toBe('UNCLASSIFIED');
    expect(capacityFailureCode(Error('RUNTIME_BACKUP_RAW_SIZE'))).toBe('RUNTIME_BACKUP_RAW_SIZE');
    expect(calls).toBe(0);
  });
});
