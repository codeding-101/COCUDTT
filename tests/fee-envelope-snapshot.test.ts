import {beforeAll, describe, expect, it, vi} from 'vitest';
import {strFromU8, unzipSync} from 'fflate';
import {PDFDocument, PDFRawStream, decodePDFRawStream} from 'pdf-lib';
import {feeEnvelopeInternalSnapshot, feeEnvelopeInternalHtml, feeEnvelopeWorkbookSheet, feeEnvelopeInternalWorkbook, FEE_ENVELOPE_REPORT_BYTES} from '../src/data/fee-envelope-snapshot';
import {parseFeeEnvelope, updateFeeEnvelopeSources} from '../src/data/fee-envelope';
import {empty, fullSources, historical, seal, hash, lease} from './fixtures/fee-envelope';
import {actualQuotesProject} from './fixtures/actual-quotes';
import {projectCustomerQuote} from '../src/data/customer-quote';
import {emptyCustomerQuoteFields} from '../src/domain/customer-quote';
import {createCustomerQuoteDocument} from '../src/ui/customer-quote';
import {createCustomerWorkbook} from '../src/ui/workbook-export';
import {createCustomerPdf} from '../src/ui/customer-pdf';

let original: string, known: string, source: Awaited<ReturnType<typeof fullSources>>;
const sentinel = 'PRIVATE_ENVELOPE_73_<script>alert(73)</script>_😀_x000D_';
const parts = (bytes: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(bytes)).map(([k, v]) => [k, strFromU8(v)]));
const xmlText = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
function workbookEvidence(bytes: Uint8Array) {
  const xml = parts(bytes)['xl/worksheets/sheet1.xml']!;
  const rows = [...xml.matchAll(/<row\b[^>]*>(.*?)<\/row>/gs)].map(r => [...r[1]!.matchAll(/<t\b[^>]*>(.*?)<\/t>/gs)].map(c => xmlText(c[1]!)));
  const join = (label: string) => rows.filter(r => r[0] === label).map(r => r[3]).join('');
  return {raw: JSON.parse(join('完整封套原文JSON字符串')) as string, review: JSON.parse(join('完整封套审计')), xml, rows};
}
beforeAll(async () => {
  source = await fullSources('113');
  source.sources.project_json = JSON.stringify({...JSON.parse(source.sources.project_json), internal_exact_amount: '113.123456789123'});
  const a = empty(source.sources, 'UNKNOWN_IMPORTED').a;
  a.envelope_id = sentinel;
  original = '\r\n' + JSON.stringify(seal(a), null, '\t').replace(/\n/g, '\r\n') + '\r\n  ';
  known = JSON.stringify((await historical('1.0')).a);
}, 30000);

describe('独立交接保留原文件与本地历史口径', {timeout: 30000}, () => {
  it('原始CR/LF、空格、Unicode和两种SHA分别保留；不是认证或应用资格', async () => {
    const s = await feeEnvelopeInternalSnapshot(original), a = await parseFeeEnvelope(original);
    expect(s.raw_file_json).toBe(original); expect(s.raw_file_sha256).toBe(hash(original));
    expect(s.semantic_content_sha256).toBe(a.content_sha256); expect(s.raw_file_sha256).not.toBe(a.content_sha256);
    expect(s.lease).toEqual(lease(a)); expect(s.review.history_status).toBe('NOT_ESTABLISHED');
    expect(s.review.issues).toContain('HISTORY_NOT_ESTABLISHED');
    expect(s).toMatchObject({financial_writes: 0, latest_proven: false, global_duplicate_proof: false, professional_review: false, customer_document: false});
    expect(s).not.toHaveProperty('ready');
  });
  it('仅排版改变文件SHA，不改变语义SHA、历史和来源', async () => {
    const a = await feeEnvelopeInternalSnapshot(original), b = await feeEnvelopeInternalSnapshot(JSON.stringify(JSON.parse(original)));
    expect(a.raw_file_sha256).not.toBe(b.raw_file_sha256); expect(a.semantic_content_sha256).toBe(b.semantic_content_sha256);
    expect(a.review).toEqual(b.review);
  });
  it('每份结果深冻结、调用之间无共享审计别名', async () => {
    const a = await feeEnvelopeInternalSnapshot(known), b = await feeEnvelopeInternalSnapshot(known);
    expect(Object.isFrozen(a)).toBe(true); expect(Object.isFrozen(a.review.receipts[0]!.rows)).toBe(true);
    expect(() => { a.review.receipts[0]!.rows[0]!.cost_id = 'CHANGED'; }).toThrow();
    expect(a.review).toEqual(b.review); expect(a.review).not.toBe(b.review);
  });
  it('缺配对/附件/精度保持null和待办，不补造零值或已确认来源', async () => {
    const a = empty({...source.sources, pair_json: null, attachment_json: null, precision_json: null}, 'UNKNOWN_IMPORTED').a;
    const s = await feeEnvelopeInternalSnapshot(JSON.stringify(a));
    expect(s.review.reviews).toEqual({pair: null, attachment: null, precision: null});
    expect(s.review.issues).toContain('CURRENT_PAIR_MISSING');
    expect(JSON.parse(s.raw_file_json).current_sources.precision_json).toBeNull();
  });
  it('完整回执、原始闭包及相对当前来源失配同时保留', async () => {
    const s = await feeEnvelopeInternalSnapshot(known);
    expect(s.review.history_status).toBe('STRUCTURALLY_CHECKED_LOCAL_LINEAGE'); expect(s.review.receipts).toHaveLength(1);
    expect(s.review.consumed).toHaveLength(1); expect(s.review.issues).toContain('PROJECT_SNAPSHOT_MISMATCH');
    expect(JSON.parse(s.raw_file_json).archives).toEqual(JSON.parse(known).archives);
  });
  it('当前项目删除旧费用后，历史消费及载荷失配仍随审计交接', async () => {
    const h = await historical(), a = await updateFeeEnvelopeSources(h.a, lease(h.a), {...h.a.current_sources, project_json: h.sources.project_json});
    const s = await feeEnvelopeInternalSnapshot(JSON.stringify(a));
    expect(s.review.payload_is_current).toBe(false); expect(s.review.issues).toContain('HISTORICAL_PAYLOAD_DIFFERS_FROM_CURRENT');
    expect(s.review.consumed).toHaveLength(1); expect(a.archives).toEqual(h.a.archives);
  });
  it('只引用已有费用保持零新增消费，不被报告为新费用', async () => {
    const h = await historical('1.0', true), s = await feeEnvelopeInternalSnapshot(JSON.stringify(h.a));
    expect(s.review.consumed).toEqual([]); expect(s.review.receipts[0]!.rows[0]!.operation).toBe('REFERENCE_EXISTING');
  });
  it('原始精确金额、候选、分数及未知值未经Number换算', async () => {
    const s = await feeEnvelopeInternalSnapshot(original), p = JSON.parse(s.raw_file_json);
    expect(p.current_sources).toEqual(source.sources);
    expect(JSON.stringify(s.review)).toContain('"numerator":"113"');
    expect(p.current_sources.project_json).toContain('113.123456789123');
  });
});

describe('真实HTML与XLSX完整证据和转义', {timeout: 30000}, () => {
  it('静态HTML转义原始代码、首行LF与CR，不含可执行对象或外链', async () => {
    const html = await feeEnvelopeInternalHtml(original);
    expect(html).toContain('&lt;script&gt;'); expect(html).toContain('&#13;&#10;');
    expect(html).not.toMatch(/<script|<iframe|<form|<a |<img|<link|<object|<embed/i);
    expect(html).toContain(hash(original)); expect(html).toContain('历史未知'); expect(html).toContain('指纹不是签名');
    const raw = html.match(/<h2>完整封套原文（含全部历史与来源）<\/h2><pre><span aria-hidden="true"><\/span>([\s\S]*)<\/pre><\/html>$/)![1]!;
    const decoded = raw.replace(/&#13;/g, '\r').replace(/&#10;/g, '\n').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
    expect(decoded).toBe(original);
  });
  it('HTML当前载荷相符不掩盖配对失配，也不称历史为真实付款', async () => {
    const html = await feeEnvelopeInternalHtml(known);
    expect(html).toContain('不代表配对/附件/精度来源全部相符'); expect(html).toContain('PROJECT_SNAPSHOT_MISMATCH');
    expect(html).toContain('仍不证明真实业务或全局唯一'); expect(html).toContain('付款事实');
  });
  it('真实XLSX解包后逐片还原完整原文件及审计，CR/LF、Unicode和字面OOXML转义不丢失', async () => {
    const file = await feeEnvelopeInternalWorkbook(original), evidence = workbookEvidence(file), s = await feeEnvelopeInternalSnapshot(original);
    expect(evidence.raw).toBe(original); expect(evidence.review).toEqual(s.review);
    expect(evidence.raw).toContain('_x000D_'); expect(evidence.raw).toContain('😀');
    expect(evidence.rows.every(r => r.length === 4)).toBe(true);
    expect(evidence.xml).not.toMatch(/<f[ >]|<hyperlink|TargetMode="External"/);
    expect(Object.keys(parts(file))).not.toEqual(expect.arrayContaining(['xl/vbaProject.bin', 'docProps/core.xml']));
  });
  it('完整历史XLSX不裁剪回执、退休编号或归档，实际文件重建后可严格打开', async () => {
    const e = workbookEvidence(await feeEnvelopeInternalWorkbook(known));
    expect(await parseFeeEnvelope(e.raw)).toEqual(await parseFeeEnvelope(known));
    expect(e.review.receipts).toHaveLength(1); expect(e.review.issues).toContain('PROJECT_SNAPSHOT_MISMATCH');
  });
  it.each(['=HYPERLINK("https://invalid","x")', '+1+1', '-1+1', '@SUM(A1)', '\t=1+1'])('公式形文本%s只作为文本单元格', async envelope_id => {
    const a = JSON.parse(original); a.envelope_id = envelope_id;
    const raw = JSON.stringify(seal(a)), sheet = await feeEnvelopeWorkbookSheet(raw), e = workbookEvidence(await feeEnvelopeInternalWorkbook(raw));
    expect(sheet.rows.every(r => r.every(c => c.kind === 'text'))).toBe(true);
    expect(e.raw).toBe(raw); expect(e.xml).not.toMatch(/<f[ >]/);
  });
});

describe('失败整份退出，原资料保持且无部分导出', {timeout: 30000}, () => {
  const exporters = [feeEnvelopeInternalSnapshot, feeEnvelopeInternalHtml, feeEnvelopeInternalWorkbook];
  it.each(exporters)('%s拒绝重算外层摘要仍掩盖不了的坏历史', async exportFile => {
    const a = JSON.parse(known); a.archives[0].raw_json += ' '; const raw = JSON.stringify(seal(a));
    await expect(exportFile(raw)).rejects.toThrow('FEE_ENVELOPE_INVALID'); expect(raw).toBe(JSON.stringify(a));
    expect((await feeEnvelopeInternalSnapshot(known)).review.receipts).toHaveLength(1);
  });
  it.each(exporters)('%s拒绝重复键、额外字段和对象强制转字符串', async exportFile => {
    await expect(exportFile(original.replace('"revision": 1', '"revision": 1,"revision":1'))).rejects.toThrow();
    const a = JSON.parse(original); a.verified = true; await expect(exportFile(JSON.stringify(a))).rejects.toThrow();
    let calls = 0; await expect(exportFile({toString() { calls++; return original; }})).rejects.toThrow(); expect(calls).toBe(0);
  });
  it.each([feeEnvelopeInternalHtml, feeEnvelopeInternalWorkbook])('%s超过独立报告上限整份拒绝，不截断原文件', async exportFile => {
    const raw = original + ' '.repeat(FEE_ENVELOPE_REPORT_BYTES);
    await expect(exportFile(raw)).rejects.toThrow('EXPORT_SIZE'); expect(raw.endsWith(' '.repeat(100))).toBe(true);
  });
  it('HTML转义膨胀单独检查最终字节，JSON仍可交接', async () => {
    const a = JSON.parse(original), p = JSON.parse(a.current_sources.project_json); p.internal_note = '&'.repeat(1450000);
    a.current_sources.project_json = JSON.stringify(p); const raw = JSON.stringify(seal(a));
    expect((await feeEnvelopeInternalSnapshot(raw)).raw_file_json).toBe(raw);
    await expect(feeEnvelopeInternalHtml(raw)).rejects.toThrow('HTML_EXPORT_SIZE');
  });
  it('有效1.1完整历史过大时保留JSON交接，报告整份拒绝而不删历史', async () => {
    const raw = JSON.stringify((await historical('1.1')).a);
    expect(new TextEncoder().encode(raw).length).toBeGreaterThan(FEE_ENVELOPE_REPORT_BYTES);
    expect((await feeEnvelopeInternalSnapshot(raw)).raw_file_json).toBe(raw);
    await expect(feeEnvelopeInternalWorkbook(raw)).rejects.toThrow('WORKBOOK_EXPORT_SIZE');
    await expect(feeEnvelopeInternalHtml(raw)).rejects.toThrow('HTML_EXPORT_SIZE');
  });
  it('SHA不可用时失败，不返回伪指纹或部分结果', async () => {
    vi.stubGlobal('crypto', undefined);
    try { await expect(feeEnvelopeInternalSnapshot(original)).rejects.toThrow('CRYPTO_UNAVAILABLE'); }
    finally { vi.unstubAllGlobals(); }
    expect((await feeEnvelopeInternalSnapshot(original)).raw_file_sha256).toBe(hash(original));
  });
});

describe('内部交接不进入客户白名单', {timeout: 30000}, () => {
  it.each(['full', 'compact'] as const)('实际%s客户HTML/XLSX/PDF与无封套结果逐字节一致', async view => {
    const quote = projectCustomerQuote(actualQuotesProject(), {...emptyCustomerQuoteFields(), reference: 'PUBLIC_73'});
    const html = createCustomerQuoteDocument(quote, '2026-10-19', view), xlsx = createCustomerWorkbook(quote, '2026-10-19', view), pdf = await createCustomerPdf(quote, '2026-10-19', view);
    Object.assign(quote, {fee_envelope: await feeEnvelopeInternalSnapshot(original), fee_envelope_html: await feeEnvelopeInternalHtml(known)});
    expect(createCustomerQuoteDocument(quote, '2026-10-19', view)).toBe(html);
    expect(createCustomerWorkbook(quote, '2026-10-19', view)).toEqual(xlsx);
    const second = await createCustomerPdf(quote, '2026-10-19', view); expect(second).toEqual(pdf);
    const doc = await PDFDocument.load(second), decoded = doc.context.enumerateIndirectObjects().map(([, o]) => o instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(o).decode()) : o.toString()).join('');
    expect(html + Object.values(parts(xlsx)).join('') + decoded).not.toMatch(/PRIVATE_ENVELOPE_73|INTERNAL_FEE_APPLICATION_ENVELOPE|synthetic-transaction|raw_file_sha256/);
  });
});
