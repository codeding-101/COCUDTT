import {describe, expect, it} from 'vitest';
import {readFeeLayeredWorkbenchRoots as read} from '../tools/fee-layered-source-mapping';
import {encodeFeeLayeredCapturePrototype as encode, decodeFeeLayeredCapturePrototype as decode} from '../tools/fee-layered-capture-prototype';
import {captureFeeSemanticBudget} from '../src/ui/fee-workbench-semantic-capture';
import {semanticFixture} from './helpers/fee-semantic-fixture';
import {feeCompatibilityValue} from '../tools/fee-source-compatibility-cases';
const rebuilt = (f: ReturnType<typeof semanticFixture>) => decode(encode(read(f.owner, f.readers))).capture;
describe('independent borrowed source mapping retains original full facts', () => {
  it('matches the current production capture without changing owner or adopting data', () => {
    const f = semanticFixture(), checkpoint = f.owner.checkpoint(), before = captureFeeSemanticBudget(f.owner, f.readers).capture;
    expect(JSON.stringify(rebuilt(f))).toBe(JSON.stringify(before)); expect(f.owner.isCurrent(checkpoint)).toBe(true);
  });
  it('exposes borrowed roots only, not an immutable issued capture or retained string', () => {
    const f = semanticFixture(), parts = read(f.owner, f.readers), r = parts.retained_root as Record<string, unknown>;
    expect(parts.retained_format).toBe('PRETTY_LF'); expect(Object.hasOwn(parts.capture_shell, 'retained_json')).toBe(false);
    expect(r.sensitivity).toBe(f.f.producers.workflow.sensitivityControls); expect(Object.isFrozen(r.sensitivity)).toBe(false);
    expect(Object.isFrozen(parts)).toBe(true); expect(Object.isFrozen(r)).toBe(true);
  });
  it.each(['baseline','plain','unicode','unicode_forms','opaque_text','marker_keys','key_order','null_prototype','shared_reference','negative_zero','depth_28','depth_29','depth_30'] as const)('matches supported extension %s', id => {
    const f = semanticFixture(); if (id !== 'baseline') f.f.producers.workflow.sensitivityControls = {extension: feeCompatibilityValue(id).value};
    expect(JSON.stringify(rebuilt(f))).toBe(JSON.stringify(captureFeeSemanticBudget(f.owner, f.readers).capture));
  });
  it.each(['undefined','function','symbol_value','symbol_key','non_enumerable','sparse_array','custom_prototype','cycle','nan','infinity','lone_high','lone_low','accessor','to_json'] as const)('rejects %s without accessor or toJSON calls', id => {
    const f = semanticFixture(), value = feeCompatibilityValue(id); f.f.producers.workflow.sensitivityControls = {extension: value.value};
    expect(() => rebuilt(f)).toThrow(); expect(value.calls()).toBe(0);
  });
  it.each(['pendingCalculation','customerReviewed','recoveryReviewBusy','projectSaveBusy','projectResourceBusy','settlementBusy','customerSummaryBusy','customerPdfBusy'] as const)('retains workflow flag %s', field => {
    const f = semanticFixture(); f.f.producers.workflow[field] = true; expect(JSON.stringify(rebuilt(f))).toBe(JSON.stringify(captureFeeSemanticBudget(f.owner, f.readers).capture));
  });
  it.each(['projectReadEpoch','projectReadToken','settlementEpoch'] as const)('retains read/settlement value %s', field => {
    const f = semanticFixture(); f.f.producers.workflow[field] = 7; expect(JSON.stringify(rebuilt(f))).toBe(JSON.stringify(captureFeeSemanticBudget(f.owner, f.readers).capture));
  });
  it('retains exact absent/empty/unavailable storage facts', () => {
    const f = semanticFixture(), keys = Object.keys(f.f.storage); f.f.storage[keys[0]!] = {raw: '', available: true}; f.f.storage[keys[1]!] = {raw: null, available: false}; f.f.storage[keys[2]!] = {raw: '\ufeff{未完成\r\n', available: true};
    expect(JSON.stringify(rebuilt(f))).toBe(JSON.stringify(captureFeeSemanticBudget(f.owner, f.readers).capture));
  });
  it('keeps pending control text and metadata separate from committed source files', () => {
    const f = semanticFixture(); f.f.pending = {present: true, control: {tag: 'INPUT', id: 'synthetic', type: 'text', value: '{UNFINISHED\r\n', dataset: {path: 'SYNTHETIC', unknown: '中😀'}, connected: false}};
    expect(JSON.stringify(rebuilt(f))).toBe(JSON.stringify(captureFeeSemanticBudget(f.owner, f.readers).capture)); expect(rebuilt(f).editors.pending_input).toContain('UNFINISHED');
  });
  it('rejects inconsistent available/raw storage and invalid pending shape', () => {
    const f = semanticFixture(), key = Object.keys(f.f.storage)[0]!; f.f.storage[key] = {raw: 'PRIVATE', available: false}; expect(() => read(f.owner, f.readers)).toThrow('INVALID');
    f.f.storage[key] = {raw: null, available: false}; f.f.pending = {present: false, control: {tag: '', id: '', type: '', value: '', dataset: {}, connected: true}}; expect(() => read(f.owner, f.readers)).toThrow('INVALID');
  });
  it('does not invoke getters on source-only data, metadata or workflow flags', () => {
    for (const target of ['draft','file','workflow'] as const) {const f = semanticFixture(); let calls = 0; const getter = {enumerable: true, get() {calls++; return null;}};
      if (target === 'draft') Object.defineProperty(f.f.producers.bill, 'draft', getter);
      if (target === 'file') Object.defineProperty(f.f.producers.bill.capture.file_evidence, 'saved_raw', getter);
      if (target === 'workflow') Object.defineProperty(f.f.producers.workflow, 'stateInitialized', getter);
      expect(() => read(f.owner, f.readers)).toThrow(); expect(calls).toBe(0);
    }
  });
  it('rejects a source-only accessor before serialization', () => {
    const f = semanticFixture(); let calls = 0; f.f.producers.bill.draft = Object.defineProperty({}, 'private', {enumerable: true, get() {calls++; return 'PRIVATE';}}) as never;
    expect(() => read(f.owner, f.readers)).toThrow(); expect(calls).toBe(0);
  });
  it('stops after an owner ABA and does not read the next producer', () => {
    const f = semanticFixture(); let later = false; expect(() => read(f.owner, {...f.readers, bill: () => {f.owner.touch(); return f.readers.bill();}, pair: () => {later = true; return f.readers.pair();}})).toThrow('STALE'); expect(later).toBe(false);
  });
  it('detects revision changes during source descriptor inspection', () => {
    const f = semanticFixture(); let changed = false; f.f.storage = new Proxy(f.f.storage, {ownKeys(target) {if (!changed) {changed = true; f.owner.touch();} return Reflect.ownKeys(target);}});
    expect(() => read(f.owner, f.readers)).toThrow('STALE');
  });
});
