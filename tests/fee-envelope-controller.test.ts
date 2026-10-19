import {beforeAll, describe, expect, it, vi} from 'vitest';
import {FeeEnvelopeController, FEE_ENVELOPE_STORAGE_KEY as KEY, type FeeEnvelopeControllerEnvironment, type FeeEnvelopeBackup} from '../src/ui/fee-envelope-controller';
import {parseFeeEnvelope, reviewFeeEnvelope} from '../src/data/fee-envelope';
import * as envelopeData from '../src/data/fee-envelope';
import {FEE_ENVELOPE_BYTES, type FeeEnvelope} from '../src/domain/fee-envelope';
import {empty, fullSources, historical, seal} from './fixtures/fee-envelope';

let base: string, later: string, unknown: string, sameRevision: string, separate: string;
const text = (a: FeeEnvelope) => JSON.stringify(seal(a));
const deferred = <T>() => { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };
const choices = {acknowledge_unverifiable: true, switch_business: true, replace_unsaved: true};
const bytes = (raw: unknown): ArrayBuffer => typeof raw === 'string' ? new TextEncoder().encode(raw).buffer : raw as ArrayBuffer;
const file = (raw: string) => ({arrayBuffer: async () => bytes(raw)});
beforeAll(async () => {
  const s = await fullSources(), a = empty({...s.sources, pair_json: null, attachment_json: null, precision_json: null}).a;
  base = '\r\n' + JSON.stringify(a, null, '\t').replace(/\n/g, '\r\n') + '\r\n';
  const b = structuredClone(a); b.revision++; b.current_sources.project_json = JSON.stringify({...JSON.parse(b.current_sources.project_json), internal_note: 'changed sources'}); later = text(b);
  b.revision--; sameRevision = text(b);
  const u = structuredClone(a); u.history_origin = 'UNKNOWN_IMPORTED'; const ledger = JSON.parse(u.ledger_json); ledger.history_origin = u.history_origin; u.ledger_json = JSON.stringify(ledger); unknown = text(u);
  const other = structuredClone(a); other.envelope_id += '-other'; other.business_id += '-other'; const l = JSON.parse(other.ledger_json); l.business_id = other.business_id; other.ledger_json = JSON.stringify(l); separate = text(other);
  for (const raw of [base, later, unknown, sameRevision, separate]) await parseFeeEnvelope(raw);
}, 30000);

async function harness(initial: string | null = base, kind: 'FILE' | 'MEMORY' = 'FILE', slot: string | null = null) {
  let stored = slot, blocked = false;
  const writes: {name: string; raw: string; mime: string}[] = [];
  const env: FeeEnvelopeControllerEnvironment = {
    storage: {getItem: vi.fn(() => stored), compareAndSet: vi.fn((_key, expected, next) => { if (stored !== expected) return false; stored = next; return true; })},
    blocked: () => blocked, changed: vi.fn(), write: vi.fn(async (name, raw, mime) => { writes.push({name, raw, mime}); return 'SAVED' as const; }),
  };
  const c = new FeeEnvelopeController(env);
  if (initial !== null) {
    expect(await (kind === 'FILE' ? c.openFile(file(initial)) : c.previewMemory(initial))).toBe(true);
    expect(await c.adoptIncoming(c.state().preview!.token, choices)).toBe(true);
  }
  return {c, env, writes, getStored: () => stored, setStored: (s: string | null) => { stored = s; }, setBlocked: (v: boolean) => { blocked = v; }};
}
async function change(h: Awaited<ReturnType<typeof harness>>, note = 'new change') {
  const state = h.c.state(), a = JSON.parse(state.current!.raw_json) as FeeEnvelope;
  const sources = {...a.current_sources, project_json: JSON.stringify({...JSON.parse(a.current_sources.project_json), internal_note: note})};
  expect(await h.c.updateSources(state.current!.lease, sources)).toBe(true);
  return h.c.state().current!.raw_json;
}
async function preview(h: Awaited<ReturnType<typeof harness>>, raw: string) {
  expect(await h.c.previewMemory(raw)).toBe(true); return h.c.state().preview!;
}

describe('独立候选、原文与明确采用', {timeout: 30000}, () => {
  it('构造不接触存储；文件仅预览，明确采用不写来源或缓存', async () => {
    const h = await harness(null); expect(h.env.storage!.getItem).not.toHaveBeenCalled();
    expect(await h.c.openFile(file(base))).toBe(true); expect(h.c.state().current).toBeNull();
    expect(await h.c.adoptIncoming(h.c.state().preview!.token)).toBe(false);
    expect(await h.c.adoptIncoming(h.c.state().preview!.token, {acknowledge_unverifiable: true})).toBe(true);
    expect(h.c.state().current!.raw_json).toBe(base); expect(h.c.state().origin_raw).toBe(base); expect(h.c.state().dirty).toBe(false);
    expect(h.env.storage!.compareAndSet).not.toHaveBeenCalled(); expect(h.c.state()).toMatchObject({financial_writes: 0, latest_proven: false});
  });
  it('内存候选和本机恢复不能冒充文件已落盘', async () => {
    const h = await harness(base, 'MEMORY'); expect(h.c.state().dirty).toBe(true);
    const r = await harness(null, 'FILE', base); await r.c.prepareLocalRecovery();
    expect(await r.c.adoptIncoming(r.c.state().preview!.token, choices)).toBe(true); expect(r.c.state().dirty).toBe(true);
  });
  it('未知历史明确采用后仍未知，不因确认按钮变成已知未消费', async () => {
    const h = await harness(null); const p = await preview(h, unknown);
    expect(p.status).toBe('INCOMING_HISTORY_UNKNOWN'); expect(await h.c.adoptIncoming(p.token)).toBe(false);
    expect(await h.c.adoptIncoming(p.token, {acknowledge_unverifiable: true})).toBe(true);
    expect(h.c.state().current!.history_origin).toBe('UNKNOWN_IMPORTED');
    expect((await reviewFeeEnvelope(await parseFeeEnvelope(h.c.state().current!.raw_json))).issues).toContain('HISTORY_NOT_ESTABLISHED');
    expect(h.c.state().latest_proven).toBe(false);
  });
  it('当前/候选租约是副本，外部修改不会改变内部身份或判断', async () => {
    const h = await harness(); const state = h.c.state(); state.current!.lease.business_id = 'forged';
    const p = await preview(h, later); p.lease.revision = 999;
    expect(h.c.state().current!.lease.business_id).not.toBe('forged'); expect(h.c.state().preview!.lease.revision).toBe(2);
    expect(await h.c.adoptIncoming(p.token)).toBe(true); expect(h.c.state().current!.lease.revision).toBe(2);
  });
  it('更高修订须明确采用，原文件留作备份，不自动缓存或升级格式', async () => {
    const h = await harness(); const p = await preview(h, later);
    expect(p.status).toBe('DESCENDANT_PREVIEW_EXPLICIT_ADOPTION'); expect(h.c.state().current!.raw_json).toBe(base);
    expect(await h.c.adoptIncoming(p.token)).toBe(true); expect(h.c.state().previous_raw).toBe(base); expect(h.c.state().current!.raw_json).toBe(later);
    expect(h.env.storage!.compareAndSet).not.toHaveBeenCalled(); expect(await h.c.backupRaw('PREVIOUS')).toBe(true); expect(h.writes[0]!.raw).toBe(base);
  });
  it('未保存资料不能只凭候选令牌覆盖；明确替换后保留被替换原文', async () => {
    const h = await harness(base, 'MEMORY'), p = await preview(h, later);
    expect(p.replace_unsaved_required).toBe(true); expect(await h.c.adoptIncoming(p.token)).toBe(false);
    expect(await h.c.adoptIncoming(p.token, {replace_unsaved: true})).toBe(true); expect(h.c.state().previous_raw).toBe(base);
  });
  it('不同业务须明确切换，不能用“已知”覆盖原业务历史', async () => {
    const h = await harness(), p = await preview(h, separate); expect(p.status).toBe('SEPARATE_BUSINESS_PREVIEW');
    expect(await h.c.adoptIncoming(p.token)).toBe(false); expect(await h.c.adoptIncoming(p.token, {switch_business: true})).toBe(true);
    expect(h.c.state().previous_raw).toBe(base); expect(h.c.state().current!.raw_json).toBe(separate);
  });
  it.each(['older', 'same-revision', 'origin', 'partial-envelope', 'partial-business', 'genesis', 'retired'])('%s冲突不能靠全部确认旗标绕过', async kind => {
    let current = base, incoming = later, status = '';
    if (kind === 'older') { current = later; incoming = base; status = 'OLDER_REVISION_CONFLICT'; }
    if (kind === 'same-revision') { incoming = sameRevision; status = 'SAME_REVISION_CONFLICT'; }
    if (kind === 'origin') { const a = JSON.parse(unknown); a.revision = 3; incoming = text(a); status = 'HISTORY_ORIGIN_CONFLICT'; }
    if (kind.startsWith('partial')) { const a = JSON.parse(base); a.revision++; if (kind === 'partial-envelope') a.envelope_id += 'x'; else {a.business_id += 'x'; const l = JSON.parse(a.ledger_json); l.business_id = a.business_id; a.ledger_json = JSON.stringify(l);} incoming = text(a); status = 'PARTIAL_IDENTITY_CONFLICT'; }
    if (kind === 'genesis') { const a = JSON.parse(later); incoming = text(empty(a.current_sources).a); const n = JSON.parse(incoming); n.revision = 3; incoming = text(n); status = 'HISTORY_FORK_CONFLICT'; }
    if (kind === 'retired') { const a = JSON.parse(base), l = JSON.parse(a.ledger_json); l.retired_cost_ids = ['retired-target']; a.ledger_json = JSON.stringify(l); current = text(a); incoming = later; status = 'HISTORY_FORK_CONFLICT'; }
    const h = await harness(current), p = await preview(h, incoming); expect(p.status).toBe(status); expect(p.adoptable).toBe(false);
    expect(await h.c.adoptIncoming(p.token, choices)).toBe(false); expect(h.c.state().current!.raw_json).toBe(current); expect(h.c.state().incoming_raw).toBe(incoming);
  });
  it('未知历史同身份也检查旧修订、原点与退休集合，不借未知状态跳过冲突', async () => {
    const h = await harness(unknown), a = JSON.parse(unknown); a.revision = 2; const l = JSON.parse(a.ledger_json); l.retired_cost_ids = ['retired']; a.ledger_json = JSON.stringify(l); const next = text(a);
    let p = await preview(h, next); expect(await h.c.adoptIncoming(p.token, choices)).toBe(true);
    p = await preview(h, unknown); expect(p.status).toBe('OLDER_REVISION_CONFLICT'); expect(await h.c.adoptIncoming(p.token, choices)).toBe(false);
    a.revision = 3; l.retired_cost_ids = []; a.ledger_json = JSON.stringify(l); p = await preview(h, text(a)); expect(p.status).toBe('HISTORY_FORK_CONFLICT');
  });
  it('未知历史同身份不能提升已知原点，必须使用独立新业务身份', async () => {
    const h = await harness(unknown), p = await preview(h, later); expect(p.status).toBe('HISTORY_ORIGIN_CONFLICT'); expect(await h.c.adoptIncoming(p.token, choices)).toBe(false);
  });
  it('同一语义原文仅排版不同仍保留精确CR/LF，不伪造新修订', async () => {
    const h = await harness(), raw = JSON.stringify(JSON.parse(base)), p = await preview(h, raw);
    expect(p.status).toBe('NO_CHANGE'); expect(await h.c.adoptIncoming(p.token)).toBe(true); expect(h.c.state().current!.raw_json).toBe(raw); expect(h.c.state().current!.lease.revision).toBe(1);
  });
  it('未知采用选项、访问器或伪造verified标记整份拒绝且getter不执行', async () => {
    const h = await harness(null), p = await preview(h, base); let calls = 0;
    for (const input of [{verified: true}, {acknowledge_unverifiable: 'yes'}, null, [], Object.defineProperty({}, 'acknowledge_unverifiable', {enumerable: true, get() { calls++; return true; }})]) expect(await h.c.adoptIncoming(p.token, input)).toBe(false);
    expect(calls).toBe(0); expect(h.c.state().current).toBeNull();
  });
  it('未来比较状态默认阻断，不能把“并非已知冲突”误作可采用', async () => {
    const h = await harness(), actual = await envelopeData.compareFeeEnvelopeRecovery(base, later);
    const spy = vi.spyOn(envelopeData, 'compareFeeEnvelopeRecovery').mockResolvedValue({...actual, status: 'FUTURE_UNSUPPORTED_STATE'});
    try {const p = await preview(h, later); expect(p.adoptable).toBe(false); expect(await h.c.adoptIncoming(p.token, choices)).toBe(false); expect(h.c.state().current!.raw_json).toBe(base);}
    finally {spy.mockRestore();}
  });
});

describe('读取、候选和来源更新竞态', {timeout: 30000}, () => {
  it.each(['bad-json', 'duplicate', 'future', 'abort', 'read-error', 'bad-type', 'negative-size', 'oversize', 'nan-size', 'fractional-size', 'mismatch-size'])('读取%s不覆盖当前资料或已有缓存', async kind => {
    const h = await harness(base, 'FILE', 'OLD_LOCAL_RAW');
    const read = vi.fn(async () => { if (kind === 'abort') throw new DOMException('cancel', 'AbortError'); if (kind === 'read-error') throw Error('read'); if (kind === 'bad-type') return {} as string;
      if (kind === 'duplicate') return base.replace('"revision": 1', '"revision": 1,"revision":1'); if (kind === 'future') { const a = JSON.parse(base); a.version = '99'; return JSON.stringify(a); } return '{ unfinished\r\n😀'; });
    const size = kind === 'negative-size' ? -1 : kind === 'oversize' ? FEE_ENVELOPE_BYTES + 1 : kind === 'nan-size' ? NaN : kind === 'fractional-size' ? 1.5 : kind === 'mismatch-size' ? 1 : undefined;
    expect(await h.c.openFile({size, arrayBuffer: async () => bytes(await read())})).toBe(false); expect(h.c.state().current!.raw_json).toBe(base); expect(h.getStored()).toBe('OLD_LOCAL_RAW');
    if (['negative-size', 'oversize', 'nan-size', 'fractional-size'].includes(kind)) expect(read).not.toHaveBeenCalled();
    if (kind === 'bad-json') { expect(h.c.state().incoming_raw).toBe('{ unfinished\r\n😀'); expect(await h.c.backupRaw('INCOMING')).toBe(true); expect(h.writes[0]!.raw).toBe('{ unfinished\r\n😀'); }
  });
  it('两次读取乱序完成，只有新候选能保留，旧结果不能改提示', async () => {
    const h = await harness(), d = deferred<string>(), old = h.c.openFile({arrayBuffer: async () => bytes(await d.promise)});
    const p = await preview(h, later), message = h.c.state().message; d.resolve(unknown);
    expect(await old).toBe(false); expect(h.c.state().preview!.token).toBe(p.token); expect(h.c.state().incoming_raw).toBe(later); expect(h.c.state().message).toBe(message);
  });
  it('取消读取后迟到异常不能改当前提示或清除新候选', async () => {
    const h = await harness(), d = deferred<string>(), old = h.c.openFile({arrayBuffer: async () => bytes(await d.promise)}); h.c.cancelRead(); const p = await preview(h, later); d.reject(Error('late'));
    expect(await old).toBe(false); expect(h.c.state().preview!.token).toBe(p.token); expect(h.c.state().reading).toBe(false);
  });
  it.each(['cancel', 'invalidate', 'blocked'])('候选采用期间%s变化不安装旧结果', async kind => {
    const h = await harness(), p = await preview(h, later), pending = h.c.adoptIncoming(p.token);
    if (kind === 'cancel') h.c.cancelRead(); if (kind === 'invalidate') { h.c.invalidatePending(); h.c.invalidatePending(); } if (kind === 'blocked') h.setBlocked(true);
    expect(await pending).toBe(false); expect(h.c.state().current!.raw_json).toBe(base); expect(h.c.state().mutation_busy).toBe(false);
  });
  it('迟到文件不能覆盖读取期间新提交的来源', async () => {
    const h = await harness(), d = deferred<string>(), pending = h.c.openFile({arrayBuffer: async () => bytes(await d.promise)}); const current = await change(h); d.resolve(later);
    expect(await pending).toBe(false); expect(h.c.state().current!.raw_json).toBe(current); expect(h.c.state().preview).toBeNull();
  });
  it('来源先捕获再等待，原文和旧历史保留，无变化不改排版或修订', async () => {
    const h = await harness(), state = h.c.state(), a = JSON.parse(base);
    expect(await h.c.updateSources(state.current!.lease, a.current_sources)).toBe(true); expect(h.c.state().current!.raw_json).toBe(base); expect(h.c.state().dirty).toBe(false);
    const input = {...a.current_sources, project_json: JSON.stringify({...JSON.parse(a.current_sources.project_json), internal_note: 'captured'})}; const expected = structuredClone(input), pending = h.c.updateSources(state.current!.lease, input); input.project_json = '{}';
    expect(await pending).toBe(true); const b = await parseFeeEnvelope(h.c.state().current!.raw_json); expect(b.current_sources).toEqual(expected); expect(b.archives).toEqual(a.archives); expect(b.ledger_json).toBe(a.ledger_json); expect(h.c.state().origin_raw).toBe(base); expect(h.c.state().dirty).toBe(true);
  });
  it('来源旧租约、坏输入和getter不能提交，输入与旧文件保持', async () => {
    const h = await harness(), state = h.c.state(), a = JSON.parse(base); let calls = 0;
    expect(await h.c.updateSources({...state.current!.lease, revision: 99}, a.current_sources)).toBe(false);
    expect(await h.c.updateSources(state.current!.lease, {...a.current_sources, bill_json: '{}'})).toBe(false);
    expect(await h.c.updateSources(state.current!.lease, Object.defineProperty({}, 'project_json', {enumerable: true, get() {calls++; return '{}';}}))).toBe(false);
    expect(calls).toBe(0); expect(h.c.state().current!.raw_json).toBe(base);
  });
  it('来源更新期间显式失效或双击不能留下部分新修订', async () => {
    const h = await harness(), s = h.c.state(), a = JSON.parse(later);
    const p = h.c.updateSources(s.current!.lease, a.current_sources); expect(await h.c.updateSources(s.current!.lease, a.current_sources)).toBe(false); h.c.invalidatePending();
    expect(await p).toBe(false); expect(h.c.state().current!.raw_json).toBe(base); expect(h.c.state().mutation_busy).toBe(false);
  });
  it('取消已捕获坏文件不清除可备份原文', async () => {
    const h = await harness(); await h.c.previewMemory('{ invalid'); h.c.cancelRead(); expect(h.c.state().incoming_raw).toBe('{ invalid'); expect(await h.c.backupRaw('INCOMING')).toBe(true);
  });
  it.each([[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf0, 0x9f, 0x98], [0xff]].map(sequence => ({sequence})))('坏UTF8字节$sequence严格拒绝，不替换成可解析文本', async ({sequence}) => {
    const h = await harness(), raw = new Uint8Array([...new TextEncoder().encode('{"name":"'), ...sequence, ...new TextEncoder().encode('"}')]);
    expect(await h.c.openFile({size: raw.byteLength, arrayBuffer: async () => raw.buffer})).toBe(false);
    expect(h.c.state().incoming_error).toBe('VALIDATION_FILE_UTF8'); expect(h.c.state().current!.raw_json).toBe(base);
  });
  it('BOM不被解码器静默删除，按严格JSON拒绝并保留已解码原文', async () => {
    const h = await harness(), raw = '\ufeff' + base;
    expect(await h.c.openFile(file(raw))).toBe(false); expect(h.c.state().incoming_raw).toBe(raw); expect(h.c.state().current!.raw_json).toBe(base);
    expect(await h.c.backupRaw('INCOMING')).toBe(true); expect(h.writes.at(-1)!.raw).toBe(raw);
  });
});

describe('另存冻结与文件备份', {timeout: 30000}, () => {
  it.each(['SAVED', 'DOWNLOAD_STARTED', 'abort', 'failure', 'invalid'])('文件保存%s只在明确落盘且版本相同时清除未保存状态', async outcome => {
    const h = await harness(base, 'MEMORY'); h.env.write = vi.fn(async () => { if (outcome === 'abort') throw new DOMException('cancel', 'AbortError'); if (outcome === 'failure') throw Error('disk'); return outcome as 'SAVED'; });
    expect(await h.c.save()).toBe(['SAVED', 'DOWNLOAD_STARTED'].includes(outcome)); expect(h.c.state().dirty).toBe(outcome !== 'SAVED'); expect(h.c.state().current!.raw_json).toBe(base); expect(h.c.state().write_busy).toBe(false); expect(h.c.state().last_write_raw).toBe(base);
  });
  it('另存原始CR/LF和排版，等待期间的新来源不能被旧保存标记已保存', async () => {
    const h = await harness(base, 'MEMORY'), d = deferred<'SAVED'>(), written: string[] = [];
    h.env.write = vi.fn(async (_name, raw) => { written.push(raw); return d.promise; }); const p = h.c.save();
    await vi.waitFor(() => expect(written).toEqual([base])); const raw = await change(h); expect(await h.c.save()).toBe(false); d.resolve('SAVED');
    expect(await p).toBe(true); expect(h.c.state().current!.raw_json).toBe(raw); expect(h.c.state().dirty).toBe(true); expect(h.c.state().last_write_raw).toBe(base);
  });
  it('同一原文离开又返回也不能让旧保存清掉新候选的未保存状态', async () => {
    const h = await harness(base, 'MEMORY'), d = deferred<'SAVED'>(); h.env.write = vi.fn(async () => d.promise); const p = h.c.save();
    await vi.waitFor(() => expect(h.env.write).toHaveBeenCalled()); let candidate = await preview(h, separate); expect(await h.c.adoptIncoming(candidate.token, choices)).toBe(true);
    candidate = await preview(h, base); expect(await h.c.adoptIncoming(candidate.token, choices)).toBe(true); d.resolve('SAVED'); expect(await p).toBe(true); expect(h.c.state().dirty).toBe(true);
  });
  it('备份捕获时原文，失败不回滚后续编辑、不伪造已保存或删除缓存', async () => {
    const h = await harness(base, 'MEMORY', 'BROKEN_LOCAL'), d = deferred<'SAVED'>(), written: string[] = [];
    h.env.write = vi.fn(async (_n, raw) => { written.push(raw); return d.promise; }); const p = h.c.backupRaw('CURRENT');
    await change(h); expect(written).toEqual([base]); d.reject(Error('disk')); expect(await p).toBe(false);
    expect(h.c.state().dirty).toBe(true); expect(h.getStored()).toBe('BROKEN_LOCAL'); expect(h.c.state().last_write_raw).toBe(base);
  });
  it.each(['ORIGIN', 'CURRENT', 'LAST_WRITE'] as FeeEnvelopeBackup[])('%s备份不会清除未保存状态', async kind => {
    const h = await harness(base, 'MEMORY'); if (kind === 'LAST_WRITE') { await h.c.backupRaw('CURRENT'); }
    expect(await h.c.backupRaw(kind)).toBe(true); expect(h.writes.at(-1)!.raw).toBe(base); expect(h.c.state().dirty).toBe(true);
  });
  it('缺少原文、非法备份种类和坏UTF16缓存不产生截断文件', async () => {
    const h = await harness(null, 'FILE', '\ud800'); expect(await h.c.save()).toBe(false); expect(await h.c.backupRaw('CURRENT')).toBe(false);
    expect(await h.c.backupRaw('OTHER' as FeeEnvelopeBackup)).toBe(false); expect(await h.c.backupRaw('LIVE_LOCAL')).toBe(false); expect(h.env.write).not.toHaveBeenCalled(); expect(h.getStored()).toBe('\ud800');
  });
});

describe('显式缓存、原子适配契约与完整恢复', {timeout: 30000}, () => {
  it('明确缓存才观察空槽、CAS写入并读回，不改变文件保存状态', async () => {
    const h = await harness(base, 'MEMORY'); expect(h.env.storage!.getItem).not.toHaveBeenCalled(); expect(await h.c.persistCurrent()).toBe(true);
    expect(h.env.storage!.compareAndSet).toHaveBeenCalledWith(KEY, null, base); expect(h.getStored()).toBe(base); expect(h.c.state().dirty).toBe(true); expect(h.c.state().storage_status).toBe('READY');
  });
  it.each(['bad', 'valid', 'literal-null'])('已有缓存%s默认保护，打开别的文件也不覆盖', async kind => {
    const stored = kind === 'valid' ? base : kind === 'bad' ? '{BROKEN' : 'null';
    const h = await harness(later, 'FILE', stored); expect(await h.c.persistCurrent()).toBe(false); expect(h.getStored()).toBe(stored); expect(h.c.state().storage_protected).toBe(true); expect(h.env.storage!.compareAndSet).not.toHaveBeenCalled();
  });
  it('缺少原子适配器或读缓存异常时仍可另存文件，不退回普通读写', async () => {
    const h = await harness(base, 'MEMORY'); h.env.storage = undefined; expect(await h.c.persistCurrent()).toBe(false); expect(h.c.state().storage_status).toBe('UNAVAILABLE'); expect(await h.c.save()).toBe(true);
    const other = await harness(); other.env.storage!.getItem = vi.fn(() => {throw Error('denied');}); expect(await other.c.prepareLocalRecovery()).toBe(false); expect(other.c.state().current!.raw_json).toBe(base);
  });
  it('恢复须先完整预览后明确采用；导入缓存不代表已落盘或最新', async () => {
    const h = await harness(null, 'FILE', base); expect(await h.c.prepareLocalRecovery()).toBe(true); expect(h.c.state().current).toBeNull(); const p = h.c.state().preview!;
    expect(p.source).toBe('LOCAL'); expect(await h.c.adoptIncoming(p.token)).toBe(false); expect(await h.c.adoptIncoming(p.token, choices)).toBe(true);
    expect(h.c.state().current!.raw_json).toBe(base); expect(h.c.state().dirty).toBe(true); expect(h.c.state().latest_proven).toBe(false); expect(h.env.storage!.compareAndSet).not.toHaveBeenCalled();
  });
  it.each(['older', 'fork', 'unknown'])('缓存%s不能自动或强制覆盖当前资料', async kind => {
    const raw = kind === 'older' ? base : kind === 'fork' ? sameRevision : unknown, current = kind === 'older' ? later : base;
    const h = await harness(current, 'FILE', raw); expect(await h.c.prepareLocalRecovery()).toBe(true); const p = h.c.state().preview!;
    expect(await h.c.adoptIncoming(p.token, choices)).toBe(false); expect(h.c.state().current!.raw_json).toBe(current); expect(h.getStored()).toBe(raw);
  });
  it('坏缓存原文完整保留，可备份；新文件不触发清理', async () => {
    const bad = '{ incomplete\r\n😀', h = await harness(base, 'FILE', bad); expect(await h.c.prepareLocalRecovery()).toBe(false);
    expect(h.c.state().observed_local_raw).toBe(bad); expect(h.c.state().incoming_raw).toBe(bad); expect(await h.c.persistCurrent()).toBe(false);
    expect(await h.c.backupRaw('OBSERVED_LOCAL')).toBe(true); expect(h.writes.at(-1)!.raw).toBe(bad); expect(h.getStored()).toBe(bad);
  });
  it('准备后缓存变化不能采用；两份原文可分别备份', async () => {
    const h = await harness(null, 'FILE', base); await h.c.prepareLocalRecovery(); const token = h.c.state().preview!.token; h.setStored(later);
    expect(await h.c.adoptIncoming(token, choices)).toBe(false); expect(h.c.state().storage_status).toBe('CONFLICT'); expect(h.c.state().current).toBeNull();
    expect(await h.c.backupRaw('OBSERVED_LOCAL')).toBe(true); expect(h.writes.at(-1)!.raw).toBe(base);
    expect(await h.c.backupRaw('LIVE_LOCAL')).toBe(true); expect(h.writes.at(-1)!.raw).toBe(later);
  });
  it('恢复异步校验期间槽位变化即使没有事件，也阻断候选', async () => {
    const h = await harness(null, 'FILE', base), p = h.c.prepareLocalRecovery(); h.setStored(later);
    expect(await p).toBe(false); expect(h.c.state().preview).toBeNull(); expect(h.getStored()).toBe(later);
  });
  it('缓存准备与文件读取互相失效，取消后的令牌不可复用', async () => {
    const h = await harness(null, 'FILE', base); const p = await preview(h, base); await h.c.prepareLocalRecovery();
    expect(await h.c.adoptIncoming(p.token, choices)).toBe(false); const token = h.c.state().preview!.token; h.c.cancelRead(); expect(await h.c.adoptIncoming(token, choices)).toBe(false);
  });
  it.each(['false', 'throw', 'wrong-readback', 'invalid-result'])('CAS%s时不回滚写入或覆盖其他分支', async kind => {
    const h = await harness(base, 'MEMORY'); h.env.storage!.compareAndSet = vi.fn(async () => { if (kind === 'throw') throw Error('quota'); h.setStored('EXTERNAL_BRANCH'); return kind === 'false' ? false : kind === 'invalid-result' ? 'true' as unknown as boolean : true; });
    expect(await h.c.persistCurrent()).toBe(false); expect(h.c.state().current!.raw_json).toBe(base); expect(h.c.state().dirty).toBe(true); expect(h.c.state().storage_protected).toBe(true);
    expect(h.env.storage!.compareAndSet).toHaveBeenCalledTimes(1); if (kind !== 'throw') expect(h.getStored()).toBe('EXTERNAL_BRANCH');
  });
  it('CAS提交前原槽位变化，适配器比较失败而不丢失外部分支', async () => {
    const h = await harness(base, 'MEMORY'), d = deferred<void>();
    h.env.storage!.compareAndSet = vi.fn(async (_key, expected, next) => { await d.promise; if (h.getStored() !== expected) return false; h.setStored(next); return true; });
    const p = h.c.persistCurrent(); await vi.waitFor(() => expect(h.env.storage!.compareAndSet).toHaveBeenCalled()); h.setStored(later); d.resolve();
    expect(await p).toBe(false); expect(h.getStored()).toBe(later); expect(h.c.state().observed_local_raw).toBeNull(); expect(h.c.state().last_cache_write_raw).toBe(base);
  });
  it('缓存等待期间新来源不回滚；旧写入完成也不能宣称保存了新版本', async () => {
    const h = await harness(base, 'MEMORY'), d = deferred<boolean>();
    h.env.storage!.compareAndSet = vi.fn(async (_k, _e, next) => { await d.promise; h.setStored(next); return true; });
    const p = h.c.persistCurrent(); await vi.waitFor(() => expect(h.env.storage!.compareAndSet).toHaveBeenCalled()); const raw = await change(h); expect(await h.c.persistCurrent()).toBe(false); d.resolve(true);
    expect(await p).toBe(false); expect(h.c.state().current!.raw_json).toBe(raw); expect(h.getStored()).toBe(base); expect(h.c.state().storage_status).toBe('WRITE_INTERRUPTED'); expect(h.c.state().dirty).toBe(true);
    expect(await h.c.backupRaw('LAST_CACHE_WRITE')).toBe(true); expect(h.writes.at(-1)!.raw).toBe(base);
  });
  it('写入成功后抛异常不假装缓存未改变，也不再次写回旧槽', async () => {
    const h = await harness(base, 'MEMORY'); h.env.storage!.compareAndSet = vi.fn((_k, _e, next) => {h.setStored(next); throw Error('after-write');});
    expect(await h.c.persistCurrent()).toBe(false); expect(h.getStored()).toBe(base); expect(h.env.storage!.compareAndSet).toHaveBeenCalledTimes(1); expect(h.c.state().storage_status).toBe('WRITE_FAILED'); expect(h.c.state().message).toContain('实际缓存须重读');
  });
  it('只有所选缓存原文相同才可明确移除，保留被移除原文和当前资料', async () => {
    const bad = '{BAD_LOCAL', h = await harness(base, 'FILE', bad); expect(await h.c.discardLocal('wrong')).toBe(false); expect(h.getStored()).toBe(bad);
    expect(await h.c.discardLocal(bad)).toBe(true); expect(h.getStored()).toBeNull(); expect(h.c.state().current!.raw_json).toBe(base);
    expect(await h.c.persistCurrent()).toBe(true); expect(h.c.state().retained_local_raw).toBe(bad); expect(await h.c.backupRaw('RETAINED_LOCAL')).toBe(true); expect(h.writes.at(-1)!.raw).toBe(bad);
  });
  it('明确移除时CAS冲突或异常均不清掉当前内存，原文留存', async () => {
    for (const throws of [false, true]) { const h = await harness(base, 'FILE', 'BAD'); h.env.storage!.compareAndSet = vi.fn(() => { if (throws) throw Error('denied'); h.setStored('OTHER'); return false; });
      expect(await h.c.discardLocal('BAD')).toBe(false); expect(h.c.state().retained_local_raw).toBe('BAD'); expect(h.c.state().current!.raw_json).toBe(base); }
  });
  it('缓存事件仅处理独立键，变化使候选失效但不替换内存或观测原文', async () => {
    const h = await harness(base, 'FILE', later); await h.c.prepareLocalRecovery(); const token = h.c.state().preview!.token;
    h.c.storageChanged('other-key'); expect(h.c.state().preview!.token).toBe(token); h.c.storageChanged(KEY); expect(h.c.state().preview!.token).toBe(token);
    h.setStored('EXTERNAL'); h.c.storageChanged(KEY); expect(h.c.state().preview).toBeNull(); expect(h.c.state().current!.raw_json).toBe(base); expect(h.c.state().observed_local_raw).toBe(later); expect(h.getStored()).toBe('EXTERNAL');
  });
  it('两位控制器共享原子适配器，旧观测者不能覆盖新缓存', async () => {
    const h = await harness(base, 'MEMORY'); expect(await h.c.persistCurrent()).toBe(true);
    const c = new FeeEnvelopeController(h.env); await c.prepareLocalRecovery(); expect(await c.adoptIncoming(c.state().preview!.token, choices)).toBe(true);
    const next = await change(h); expect(await h.c.persistCurrent()).toBe(true); expect(await c.persistCurrent()).toBe(false); expect(h.getStored()).toBe(next); expect(c.state().current!.raw_json).toBe(base);
  });
  it('完整消费历史恢复后当前费用删除仍不重开消费', async () => {
    const history = await historical(), raw = JSON.stringify(history.a), h = await harness(null, 'FILE', raw);
    expect(await h.c.prepareLocalRecovery()).toBe(true); expect(await h.c.adoptIncoming(h.c.state().preview!.token, choices)).toBe(true);
    expect(await h.c.updateSources(h.c.state().current!.lease, {...history.a.current_sources, project_json: history.sources.project_json})).toBe(true);
    const a = await parseFeeEnvelope(h.c.state().current!.raw_json), r = await reviewFeeEnvelope(a); expect(r.consumed).toHaveLength(1); expect(r.issues).toContain('HISTORICAL_PAYLOAD_DIFFERS_FROM_CURRENT'); expect(a.archives).toEqual(history.a.archives);
  });
  it('完整历史即使提高revision并重算全部摘要，删掉回执仍不能恢复覆盖', async () => {
    const history = await historical(), raw = JSON.stringify(history.a), h = await harness(raw), a = structuredClone(history.a), l = JSON.parse(a.ledger_json);
    l.receipt_refs = []; a.ledger_json = JSON.stringify(l); a.archives = a.archives.filter(b => b.sha256 === l.genesis_ref); a.revision = 10;
    const incoming = text(a); await parseFeeEnvelope(incoming); const p = await preview(h, incoming);
    expect(p.status).toBe('HISTORY_FORK_CONFLICT'); expect(await h.c.adoptIncoming(p.token, choices)).toBe(false); expect(h.c.state().current!.raw_json).toBe(raw);
  });
  it('超过报告8MiB的合法1.1完整历史仍可独立打开、采用并逐字另存JSON', async () => {
    const history = await historical('1.1'), raw = '\n' + JSON.stringify(history.a) + '\r\n';
    expect(new TextEncoder().encode(raw).length).toBeGreaterThan(8 * 1024 * 1024);
    const h = await harness(raw); expect(await h.c.save()).toBe(true); expect(h.writes[0]!.raw).toBe(raw); expect(h.c.state().current!.raw_json).toBe(raw);
    expect(JSON.parse(h.writes[0]!.raw).archives).toEqual(history.a.archives);
  }, 60000);
});

describe('故障通知与可重入边界', () => {
  it('通知抛异常不丢掉已采用文件或留下繁忙标记', async () => {
    const h = await harness(null); h.env.changed = vi.fn(() => {throw Error('view');}); const p = await preview(h, base);
    expect(await h.c.adoptIncoming(p.token, choices)).toBe(true); expect(h.c.state().current!.raw_json).toBe(base); expect(h.c.state().mutation_busy).toBe(false);
  });
  it('通知回调不能重入发起额外读取、缓存或文件写入', async () => {
    const h = await harness(null), attempts: Promise<boolean>[] = [];
    h.env.changed = vi.fn(() => {attempts.push(h.c.previewMemory(base), h.c.persistCurrent(), h.c.save());}); const p = await preview(h, base);
    expect(await h.c.adoptIncoming(p.token, choices)).toBe(true); expect((await Promise.all(attempts)).every(v => v === false)).toBe(true); expect(h.env.storage!.compareAndSet).not.toHaveBeenCalled(); expect(h.env.write).not.toHaveBeenCalled();
  });
  it('blocked回调失效按阻断处理，恢复后原文件仍可保存', async () => {
    const h = await harness(base, 'MEMORY'); h.env.blocked = () => {throw Error('context');}; expect(await h.c.save()).toBe(false); expect(await h.c.previewMemory(later)).toBe(false); expect(await h.c.persistCurrent()).toBe(false);
    h.env.blocked = () => false; expect(await h.c.save()).toBe(true); expect(h.c.state().dirty).toBe(false);
  });
});
