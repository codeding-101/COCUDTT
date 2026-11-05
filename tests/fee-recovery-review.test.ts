import {beforeAll, afterEach, describe, expect, it, vi} from 'vitest';
import {FeeRecoveryFormat, type FeeRecoveryData} from '../tools/fee-recovery-format';
import {FeeRecoveryReview, RECOVERY_REVIEW_ROW_LIMIT, previewRecoveryReviewValue} from '../tools/fee-recovery-review';
import {recoveryReadingFixture, recoveryReadingWire, probeRecoveryReading} from '../tools/fee-recovery-review-cases';
import {feeEnvelopeSha256} from '../src/data/fee-envelope-json';

const signal = () => new AbortController().signal;
const encode = (f = recoveryReadingFixture()) => new FeeRecoveryFormat().encode(f.parts, f.supplement, signal(), {captured_at: '2026-10-28T00:00:00.000Z'});
const deferred = <T,>() => {let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
let raw: string, data: FeeRecoveryData, probe: Awaited<ReturnType<typeof probeRecoveryReading>>;
beforeAll(async () => {raw = await recoveryReadingWire(); data = await new FeeRecoveryFormat().decode(raw, signal()); probe = await probeRecoveryReading();});
afterEach(() => vi.unstubAllGlobals());
async function open(wire = raw) {const review = new FeeRecoveryReview(), m = await review.stage(wire); review.confirm(m, 'OPEN_ARCHIVE_READING_ONLY'); return {review, m};}

describe('complete archive reading is separate from business restoration', () => {
  it.each(['baseline','drafts','bad-number','unread-file','other-input','old-authority','unknown'])('portable %s case keeps original data and no authority', kind => {
    const item = probe.cases.find(c => c.id === kind)!; expect(item.rows).toBeGreaterThan(80); expect(Object.values(item.checks).every(v => v === true)).toBe(true);
  });
  it('binds both exact source texts, consumes explicit selection once and never opens implicitly', async () => {
    const r = new FeeRecoveryReview(), m = await r.stage(raw); expect(r.current()).toBeNull(); expect(r.pending()).toBe(m);
    expect(m.source_sha256).toBe(await feeEnvelopeSha256(data.source_wire)); expect(m.supplement_sha256).toBe(await feeEnvelopeSha256(data.supplement_json));
    expect(() => r.confirm(m, 'AUTO' as never)).toThrow('READING_CHOICE_REQUIRED'); r.confirm(m, 'OPEN_ARCHIVE_READING_ONLY'); expect(r.current()).toBe(m);
    expect(() => r.confirm(m, 'OPEN_ARCHIVE_READING_ONLY')).toThrow('CONSUMED'); expect(Object.isFrozen(m.rows[0]!.path)).toBe(true);
  });
  it.each(['json','spread','clone','other-review'])('rejects %s selection identities', async kind => {
    const r = new FeeRecoveryReview(), m = await r.stage(raw), other = new FeeRecoveryReview();
    const foreign = kind === 'json' ? JSON.parse(JSON.stringify(m)) : kind === 'spread' ? {...m} : kind === 'clone' ? structuredClone(m) : await other.stage(raw);
    expect(() => r.confirm(foreign, 'OPEN_ARCHIVE_READING_ONLY')).toThrow('FOREIGN'); expect(r.current()).toBeNull();
  });
  it.each(['cost','review','attachment','precision'])('keeps uncommitted %s content as re-entry data', async field => {
    const {review, m} = await open(await recoveryReadingWire('drafts')), row = m.rows.find(r => r.id === '/capture/editors/' + field)!;
    expect(row.policy).toBe('REVIEW_AND_REENTER'); expect(row.requires_attention).toBe(true); expect(review.details(m, row.id).text).toBe(review.archive()!.restoration.capture.editors[field as 'cost']);
  });
  it.each(['settlement_plan','sensitivity','customer_fields'])('keeps %s separate from submitted project values', async field => {
    const {review, m} = await open(await recoveryReadingWire('drafts')), before = review.archive()!.source_wire, row = m.rows.find(r => r.id === '/retained/' + field)!;
    expect(row.policy).toBe('REVIEW_AND_REENTER'); review.markRead(m, row.id, true, 'READ_ONLY_NOT_ADOPT');
    expect(review.archive()!.source_wire).toBe(before); expect(review.state()).toMatchObject({financial_writes: 0, installation_authority: false, customer_reviewed: false});
  });
  it.each(['bad-number','unread-file'] as const)('%s remains unresolved after EVERY row is read', async kind => {
    const {review, m} = await open(await recoveryReadingWire(kind)), original = review.archive()!, row = m.rows.find(r => r.id === '/supplement/pending_control')!;
    expect(row.policy).toBe('REENTER_REQUIRED'); expect(review.details(m, row.id).text).toContain('checked: false');
    for (const item of m.rows) review.markRead(m, item.id, true, 'READ_ONLY_NOT_ADOPT');
    expect(review.state().read_count).toBe(m.rows.length); expect(review.state().input_reentry_required).toBe(true);
    expect(review.archive()).toBe(original); expect(original.supplement.pending_control!.value).toBe(''); expect(original.import_authority).toBe(false);
    if (kind === 'unread-file') expect(review.details(m, row.id).text).toContain('SYNTHETIC_UNREAD102.json');
  });
  it('does not execute old HTML, application patches, activity or customer approval', async () => {
    const {review, m} = await open(await recoveryReadingWire('old-authority'));
    for (const id of ['/retained/customer_reviewed','/retained/project_read_token','/supplement/envelope_ui/workbench_confirmation','/supplement/envelope_ui/workbench_candidate']) expect(m.rows.find(r => r.id === id)!.policy).toBe('NEVER_REPLAY');
    const html = review.details(m, '/supplement/tax_ui/review_html'); expect(html.text).toContain('<script>');
    expect(review.archive()!.supplement.envelope_ui.workbench_confirmation).toEqual({acknowledged: true, token: 'SYNTHETIC_OLD102'});
    expect(review.state()).toMatchObject({financial_writes: 0, customer_reviewed: false, pending_patch_replays: 0});
  });
  it('keeps false, null, zero, unknown negative zero, BOM/CRLF and path delimiters distinct', async () => {
    const {review, m} = await open(await recoveryReadingWire('unknown'));
    expect(m.rows.find(r => r.id === '/retained/future~1a~0b')!.policy).toBe('UNKNOWN_ARCHIVE');
    expect(m.rows.find(r => r.id === '/retained/toString')!.policy).toBe('UNKNOWN_ARCHIVE');
    expect(review.details(m, '/retained/future~1a~0b').text).toContain('-0');
    expect(review.details(m, '/supplement/extensions').text).toContain('\ufeff保留\r\n😀');
    expect(review.details(m, '/retained/customer_reviewed').text).toBe('false'); expect(review.details(m, '/retained/project_read_token').text).toBe('null');
    expect(review.details(m, '/retained/settlement_epoch').text).toBe('0');
    expect(Object.is((review.archive()!.supplement.extensions.future as {amount: number}).amount, -0)).toBe(true);
  });
  it('covers every captured or retained member once, with retained_json represented by the decoded retained tree', async () => {
    const {review, m} = await open(await recoveryReadingWire('drafts')), a = review.archive()!;
    for (const [group, value] of [['capture', a.restoration.capture], ['retained', a.restoration.retained_root], ['supplement', a.supplement]] as const) for (const key of Object.keys(value as object)) {
      if (group === 'capture' && key === 'retained_json') continue;
      expect(m.rows.some(r => r.path[0] === group && r.path[1] === key)).toBe(true);
    }
    expect(new Set(m.rows.map(r => r.id)).size).toBe(m.rows.length);
  });
  it('records only private read marks; unchecking and invalid choices never affect data or approval', async () => {
    const {review, m} = await open(), id = m.rows[0]!.id, before = review.archive();
    expect(() => review.markRead(m, id, true, 'APPLY' as never)).toThrow('READ_MARK_ONLY');
    expect(() => review.markRead(m, id, 'yes' as never, 'READ_ONLY_NOT_ADOPT')).toThrow('READ_MARK_ONLY');
    review.markRead(m, id, true, 'READ_ONLY_NOT_ADOPT'); expect(review.isRead(m, id)).toBe(true);
    review.markRead(m, id, false, 'READ_ONLY_NOT_ADOPT'); expect(review.state().read_count).toBe(0); expect(review.archive()).toBe(before);
    expect(() => review.markRead(m, '/UNKNOWN', true, 'READ_ONLY_NOT_ADOPT')).toThrow('UNKNOWN_ROW');
  });
  it('preserves current marks on cancelled candidate switching and clears them on explicit new selection', async () => {
    const {review, m} = await open(); review.markRead(m, m.rows[0]!.id, true, 'READ_ONLY_NOT_ADOPT');
    const staged = await review.stage(await recoveryReadingWire('drafts')); expect(review.current()).toBe(m);
    expect(() => review.markRead(m, m.rows[0]!.id, true, 'READ_ONLY_NOT_ADOPT')).toThrow('LOCKED'); review.cancel(); expect(review.isRead(m, m.rows[0]!.id)).toBe(true);
    expect(() => review.confirm(staged, 'OPEN_ARCHIVE_READING_ONLY')).toThrow('STALE');
    const next = await review.stage(raw); review.confirm(next, 'OPEN_ARCHIVE_READING_ONLY'); expect(review.state().read_count).toBe(0);
    expect(() => review.details(m, m.rows[0]!.id)).toThrow('FOREIGN'); expect(() => review.markRead({...next}, next.rows[0]!.id, true, 'READ_ONLY_NOT_ADOPT')).toThrow('FOREIGN');
  });
  it('invalidates context even through ABA and cannot regain marks from identical archive bytes', async () => {
    const {review, m} = await open(); review.markRead(m, m.rows[0]!.id, true, 'READ_ONLY_NOT_ADOPT'); review.invalidateContext(); review.invalidateContext();
    expect(review.state()).toMatchObject({phase: 'STALE', read_count: 0}); expect(() => review.details(m, m.rows[0]!.id)).toThrow('STALE');
    const next = await review.stage(raw); review.confirm(next, 'OPEN_ARCHIVE_READING_ONLY'); expect(next.source_sha256).toBe(m.source_sha256); expect(review.state().read_count).toBe(0);
  });
  it('caps the reading inventory separately and refuses the whole over-limit candidate without discarding current data', async () => {
    const {review, m} = await open(), f = recoveryReadingFixture();
    for (let i = 0; i < RECOVERY_REVIEW_ROW_LIMIT - m.rows.length; i++) f.supplement.workflow['unknown_' + i] = null;
    const at = await review.stage(await encode(f)); expect(at.rows.length).toBe(RECOVERY_REVIEW_ROW_LIMIT); review.cancel();
    f.supplement.workflow.one_too_many = null; await expect(review.stage(await encode(f))).rejects.toThrow('DECODE_OR_INVENTORY_FAILED'); expect(review.current()).toBe(m);
  });
  it('does not read global storage, write files or ask archived controllers to run', async () => {
    const storage = {getItem: vi.fn(() => {throw Error('NO_GLOBAL_READ');}), setItem: vi.fn(() => {throw Error('NO_GLOBAL_WRITE');})}, picker = vi.fn();
    vi.stubGlobal('localStorage', storage); vi.stubGlobal('showSaveFilePicker', picker);
    const {review, m} = await open(); for (const row of m.rows) review.markRead(m, row.id, true, 'READ_ONLY_NOT_ADOPT');
    expect(storage.getItem).not.toHaveBeenCalled(); expect(storage.setItem).not.toHaveBeenCalled(); expect(picker).not.toHaveBeenCalled();
    expect(review.state()).toMatchObject({storage_reads: 0, storage_writes: 0, file_writes: 0, production_integrated: false, full_live_workbench_reopen: false});
  });
});

describe('bounded asynchronous switching, failure and read-only previews', () => {
  it.each(['cancel','abort','context','dispose'])('%s returns promptly but retains one physical decode slot', async action => {
    const gate = deferred<FeeRecoveryData>(), external = new AbortController(), r = new FeeRecoveryReview({decode: () => gate.promise}), p = r.stage('DELAYED', external.signal).catch(e => e.message);
    await expect(r.stage('OVERLAP')).rejects.toThrow('BUSY');
    if (action === 'cancel') r.cancel(); else if (action === 'abort') external.abort(); else if (action === 'context') r.invalidateContext(); else r.dispose();
    expect(await p).toContain('CANCELLED_OR_STALE'); expect(r.state().phase).toBe(action === 'dispose' ? 'CLOSED' : 'SETTLING');
    await expect(r.stage('STILL_PHYSICAL')).rejects.toThrow(action === 'dispose' ? 'CLOSED' : 'BUSY'); gate.resolve(data); await r.whenIdle(); expect(r.current()).toBeNull(); expect(r.pending()).toBeNull();
  });
  it('rejects pre-abort without decoding and aborts ready selection without dropping current archive', async () => {
    const format = new FeeRecoveryFormat(), spy = vi.spyOn(format, 'decode'), r = new FeeRecoveryReview(format), pre = new AbortController(); pre.abort();
    await expect(r.stage(raw, pre.signal)).rejects.toThrow('CANCELLED'); expect(spy).not.toHaveBeenCalled();
    const first = await r.stage(raw); r.confirm(first, 'OPEN_ARCHIVE_READING_ONLY'); const external = new AbortController(), next = await r.stage(raw, external.signal); external.abort();
    expect(() => r.confirm(next, 'OPEN_ARCHIVE_READING_ONLY')).toThrow('STALE'); expect(r.current()).toBe(first); spy.mockRestore();
  });
  it('redacts a late private failure and keeps current archive and read marks', async () => {
    let calls = 0; const gate = deferred<FeeRecoveryData>(), r = new FeeRecoveryReview({decode: () => ++calls === 1 ? Promise.resolve(data) : gate.promise}), m = await r.stage(raw); r.confirm(m, 'OPEN_ARCHIVE_READING_ONLY'); r.markRead(m, m.rows[0]!.id, true, 'READ_ONLY_NOT_ADOPT');
    const p = r.stage('PRIVATE').catch(e => e.message); r.cancel(); expect(await p).toContain('CANCELLED');
    gate.reject({get message() {throw Error('PRIVATE_ERROR_SHOULD_NOT_BE_READ');}}); await r.whenIdle(); expect(r.current()).toBe(m); expect(r.isRead(m, m.rows[0]!.id)).toBe(true);
  });
  it.each(['BROKEN {','null','{"kind":"INTERNAL_RUNTIME_FEE_APPLICATION_BACKUP","pending_patches":[]}'])('invalid input %s preserves the previous review', async input => {
    const {review, m} = await open(); await expect(review.stage(input)).rejects.toThrow('DECODE_OR_INVENTORY_FAILED'); expect(review.current()).toBe(m);
  });
  it('ignores accessor metadata without invoking it and rechecks context after descriptor reentry', async () => {
    let reads = 0; const bad = {...data}; Object.defineProperty(bad, 'import_authority', {enumerable: true, get() {reads++; return true;}}); Object.freeze(bad);
    await expect(new FeeRecoveryReview({decode: async () => bad}).stage('FAKE')).rejects.toThrow('DECODE_OR_INVENTORY_FAILED'); expect(reads).toBe(0);
    let r!: FeeRecoveryReview, touched = false; const proxy = new Proxy(data, {ownKeys(target) {if (!touched) {touched = true; r.invalidateContext();} return Reflect.ownKeys(target);}});
    r = new FeeRecoveryReview({decode: async () => proxy}); await expect(r.stage('REENTER')).rejects.toThrow('STALE'); expect(r.current()).toBeNull();
  });
  it.each([false,null,0,-0,'\ufeff原文\r\n😀'])('preserves primitive preview %s', value => {expect(previewRecoveryReviewValue(value)).toEqual({text: Object.is(value, -0) ? '-0' : String(value), truncated: false});});
  it('bounds previews by characters, nodes and depth without changing complete source data', () => {
    const text = '😀'.repeat(2001), preview = previewRecoveryReviewValue(text); expect(preview.text.length).toBeLessThanOrEqual(2000); expect(preview.truncated).toBe(true); expect(text.length).toBe(4002);
    expect(previewRecoveryReviewValue(Array.from({length: 200}, () => 1)).truncated).toBe(true);
    expect(previewRecoveryReviewValue({a: {b: {c: {d: {e: {f: {g: true}}}}}}}).truncated).toBe(true);
  });
});
