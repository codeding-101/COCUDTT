import {describe, expect, it} from 'vitest';
import {FeeSourceViewPrototype, FEE_SOURCE_VIEW_PRODUCERS as ids, decodeFeeSourceViewPrototype as decode, type FeeSourceViewReader, type FeeSourceViewDocument} from '../tools/fee-source-view-prototype';
import {encodeFeeTextSharingPrototype as encodeData} from '../tools/fee-text-sharing-prototype';
import {WorkbenchStateOwner, type WorkbenchCheckpoint} from '../src/ui/workbench-state';

function fixture() {
  const owner = new WorkbenchStateOwner(), target = {raw: 'SOURCE_A'}; owner.bind(target, 'source-view-test');
  const raw = '\uFEFFSYNTHETIC 未识别原文\r\n{"broken":'.repeat(100);
  const values: Record<string, unknown>[] = ids.map((id, i) => ({raw, file_evidence: {name: i ? null : '报价.json', saved_raw: raw, saved_at: null},
    pending_input: null, read_token: 3, reading: false, storage: {available: false, raw: null}, extensions: {unknown: id}}));
  const readers: FeeSourceViewReader[] = ids.map((producer, i) => ({producer, read: () => i === 0 ? {...values[i], current: target.raw} : values[i]}));
  return {owner, target, values, readers, session: new FeeSourceViewPrototype(owner)};
}
const data = (view: FeeSourceViewDocument, i: number) => view.producers[i]!.value as Record<string, unknown>;

describe('explicit producer views preserve data without issuing business authority', () => {
  it('preserves all ten holders, opaque invalid JSON and unknown extensions exactly', () => {
    const f = fixture(), checkpoint = f.owner.checkpoint(), view = f.session.capture(f.readers), wire = f.session.encode(view), restored = decode(wire);
    expect(restored).toStrictEqual(view); expect(restored.producers.map(p => p.producer)).toEqual(ids);
    expect(data(restored, 0).raw).toBe(f.values[0]!.raw); expect(data(restored, 0).raw).toContain('\r\n{"broken":');
    expect(data(restored, 0).extensions).toEqual({unknown: 'project'});
    expect(f.owner.isCurrent(checkpoint)).toBe(true); expect(f.session.isCurrent(view)).toBe(true);
    expect(f.session.isCurrent(restored)).toBe(false); expect(() => f.session.encode(restored)).toThrow('FOREIGN_OR_STALE');
    expect(restored.financial_writes).toBe(0); expect(restored.import_authority).toBe(false); expect(restored.confirmation_authority).toBe(false);
  });
  it('shares text but keeps independently named file evidence and mutable source objects apart', () => {
    const f = fixture(); f.values[1]!.file_evidence = {name: '相同文本另一个文件.json', saved_raw: f.values[0]!.raw, saved_at: 'SYNTHETIC_TIME'};
    const view = f.session.capture(f.readers), wire = f.session.encode(view), restored = decode(wire), doc = JSON.parse(wire);
    expect(doc.texts.filter((t: string) => t === f.values[0]!.raw)).toHaveLength(1);
    expect(data(restored, 0).file_evidence).toEqual(f.values[0]!.file_evidence);
    expect(data(restored, 1).file_evidence).toEqual(f.values[1]!.file_evidence);
    expect(data(restored, 0).file_evidence).not.toBe(data(restored, 1).file_evidence);
    (f.values[0]!.file_evidence as {name: string}).name = 'LATER';
    expect((data(view, 0).file_evidence as {name: string}).name).toBe('报价.json');
    expect(Object.isFrozen(view.producers)).toBe(true); expect(Object.isFrozen(data(view, 0).file_evidence)).toBe(true);
    expect(() => { (data(restored, 0).file_evidence as {name: string}).name = 'FORBIDDEN'; }).toThrow();
  });
  it('keeps null, false, empty strings, pending text and marker-looking keys distinct', () => {
    const f = fixture(); f.values[0]!.extra = JSON.parse('{"__proto__":{"literal":true},"constructor":"data","ref":"https://example.invalid/not-read"}');
    f.values[0]!.pending_input = '{未提交'; f.values[1]!.pending_input = ''; f.values[2]!.storage = {available: true, raw: ''};
    const restored = decode(f.session.encode(f.session.capture(f.readers)));
    expect(data(restored, 0).extra).toStrictEqual(f.values[0]!.extra); expect(Object.hasOwn(data(restored, 0).extra as object, '__proto__')).toBe(true);
    expect(data(restored, 0).pending_input).toBe('{未提交'); expect(data(restored, 1).pending_input).toBe(''); expect(data(restored, 2).pending_input).toBeNull();
    expect(data(restored, 0).storage).toEqual({available: false, raw: null}); expect(data(restored, 2).storage).toEqual({available: true, raw: ''});
  });
  it('reads every producer once and performs no owner revision change', () => {
    const f = fixture(), calls: string[] = [], token = f.owner.checkpoint();
    const view = f.session.capture(f.readers.map(r => ({producer: r.producer, read: () => {calls.push(r.producer); return r.read();}})));
    expect(calls).toEqual(ids); decode(f.session.encode(view)); expect(f.owner.isCurrent(token)).toBe(true);
  });
  it('does not let another session reuse an issued view even with the same owner', () => {
    const f = fixture(), view = f.session.capture(f.readers), other = new FeeSourceViewPrototype(f.owner);
    expect(other.isCurrent(view)).toBe(false); expect(() => other.encode(view)).toThrow('FOREIGN_OR_STALE');
    expect(f.session.isCurrent(structuredClone(view))).toBe(false);
  });
  it('a restored original-owner checkpoint stays diagnostic data', () => {
    const f = fixture(), token = f.owner.checkpoint(); f.values[0]!.checkpoint = token;
    const restored = decode(f.session.encode(f.session.capture(f.readers)));
    expect(data(restored, 0).checkpoint).toStrictEqual(token);
    expect(f.owner.isCurrent(data(restored, 0).checkpoint as WorkbenchCheckpoint)).toBe(false); expect(f.owner.isCurrent(token)).toBe(true);
  });
  it('invalidates the original view after A-B-A even though diagnostic bytes are identical again', () => {
    const f = fixture(), view = f.session.capture(f.readers), wire = f.session.encode(view);
    f.target.raw = 'SOURCE_B'; f.target.raw = 'SOURCE_A';
    expect(f.session.isCurrent(view)).toBe(false); expect(() => f.session.encode(view)).toThrow('FOREIGN_OR_STALE');
    expect(f.session.encode(f.session.capture(f.readers))).toBe(wire);
  });
  it('respects the existing touch requirement for nested legacy edits', () => {
    const f = fixture(), view = f.session.capture(f.readers);
    (f.values[0]!.extensions as Record<string, unknown>).unknown = 'NESTED_EDIT'; f.owner.touch();
    expect(f.session.isCurrent(view)).toBe(false); expect(data(view, 0).extensions).toEqual({unknown: 'project'});
    expect(data(f.session.capture(f.readers), 0).extensions).toEqual({unknown: 'NESTED_EDIT'});
  });
  it('rejects a changed or ABA owner during a producer read, without returning a mixed view', () => {
    const f = fixture(), calls: string[] = [];
    const readers = f.readers.map((r, i) => ({producer: r.producer, read: () => {calls.push(r.producer); if (i === 2) {f.target.raw = 'TEMP'; f.target.raw = 'SOURCE_A';} return r.read();}}));
    expect(() => f.session.capture(readers)).toThrow('STALE'); expect(calls).toEqual(ids.slice(0, 3)); expect(f.target.raw).toBe('SOURCE_A');
  });
  it('stops on a throwing producer instead of filling the missing state with null', () => {
    const f = fixture(), token = f.owner.checkpoint(); let later = 0;
    const readers = f.readers.map((r, i) => ({producer: r.producer, read: () => {if (i === 3) throw Error('SYNTHETIC_UNREADABLE'); if (i > 3) later++; return r.read();}}));
    expect(() => f.session.capture(readers)).toThrow('SYNTHETIC_UNREADABLE'); expect(later).toBe(0); expect(f.owner.isCurrent(token)).toBe(true);
  });
  it.each(['missing', 'extra', 'duplicate', 'foreign', 'reordered', 'extra_field', 'array_getter', 'spec_getter', 'sparse'])('rejects %s producer specifications before calling any reader', kind => {
    const f = fixture(); let calls = 0; const readers = f.readers.map(r => ({producer: r.producer, read: () => {calls++; return r.read();}}));
    if (kind === 'missing') readers.pop(); if (kind === 'extra') readers.push(readers[0]!);
    if (kind === 'duplicate') readers[1] = readers[0]!;
    if (kind === 'foreign') (readers[0] as unknown as {producer: string}).producer = 'https://example.invalid/source';
    if (kind === 'reordered') [readers[0], readers[1]] = [readers[1]!, readers[0]!];
    if (kind === 'extra_field') Object.assign(readers[0]!, {unknown: true});
    if (kind === 'array_getter') Object.defineProperty(readers, '0', {get: () => {calls++; return f.readers[0];}, enumerable: true});
    if (kind === 'spec_getter') Object.defineProperty(readers[0]!, 'read', {get: () => {calls++; return f.readers[0]!.read;}, enumerable: true});
    if (kind === 'sparse') delete readers[2];
    expect(() => f.session.capture(readers)).toThrow('PRODUCERS'); expect(calls).toBe(0);
  });
  it('rejects accessors and toJSON inside a producer payload without executing them', () => {
    const f = fixture(); let calls = 0;
    f.readers[1] = {producer: 'workflow', read: () => Object.defineProperty({}, 'payload', {enumerable: true, get: () => {calls++; return 'BAD';}})};
    expect(() => f.session.capture(f.readers)).toThrow(); expect(calls).toBe(0);
    f.readers[1] = {producer: 'workflow', read: () => ({toJSON: () => {calls++; return 'BAD';}})};
    expect(() => f.session.capture(f.readers)).toThrow(); expect(calls).toBe(0);
  });
  it('rejects asynchronous producer values rather than encoding a pending promise', () => {
    const f = fixture(); f.readers[2] = {producer: 'bill', read: () => Promise.resolve({raw: 'LATE'})};
    expect(() => f.session.capture(f.readers)).toThrow();
  });
  it.each(['kind', 'version', 'financial_writes', 'import_authority', 'confirmation_authority', 'runtime_integrated', 'unknown', 'missing'])('rejects a forged %s diagnostic header', field => {
    const f = fixture(), doc = JSON.parse(JSON.stringify(f.session.capture(f.readers)));
    if (field === 'missing') delete doc.version; else doc[field] = field === 'kind' || field === 'version' ? 'OTHER' : true;
    expect(() => decode(encodeData(doc))).toThrow('DOCUMENT');
  });
  it.each(['missing', 'extra', 'duplicate', 'foreign', 'reordered', 'extra_field', 'missing_value'])('rejects %s restored producer closure', kind => {
    const f = fixture(), doc = JSON.parse(JSON.stringify(f.session.capture(f.readers)));
    if (kind === 'missing') doc.producers.pop(); if (kind === 'extra') doc.producers.push(doc.producers[0]);
    if (kind === 'duplicate') doc.producers[1] = doc.producers[0]; if (kind === 'foreign') doc.producers[0].producer = 'FOREIGN';
    if (kind === 'reordered') [doc.producers[0], doc.producers[1]] = [doc.producers[1], doc.producers[0]];
    if (kind === 'extra_field') doc.producers[0].foreign = true; if (kind === 'missing_value') delete doc.producers[0].value;
    expect(() => decode(encodeData(doc))).toThrow(/DOCUMENT|PRODUCERS/);
  });
  it('retains the underlying strict reference validation and logical expansion budget', () => {
    const f = fixture(), wire = JSON.parse(f.session.encode(f.session.capture(f.readers)));
    const node = wire.nodes.find((n: unknown[]) => n[0] === 'ref'); node[1] = -1;
    expect(() => decode(JSON.stringify(wire))).toThrow('TEXT_REFERENCE');
    const raw = 'S'.repeat(1024 * 1024); f.readers = ids.map(producer => ({producer, read: () => ({rows: Array(14).fill(raw)})}));
    expect(() => f.session.capture(f.readers)).toThrow('LOGICAL_BUDGET');
  }, 30000);
});
