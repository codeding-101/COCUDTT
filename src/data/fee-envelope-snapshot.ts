import {parseFeeEnvelope, reviewFeeEnvelope} from './fee-envelope.js';
import {feeEnvelopeSha256} from './fee-envelope-json.js';
import {FeeEnvelopeError} from '../domain/fee-envelope.js';
import {serializeWorkbook, textCell, type WorkbookSheet} from './xlsx-file.js';

/** Independent report limits; the envelope JSON itself retains its existing 128 MiB limit. */
export const FEE_ENVELOPE_REPORT_BYTES = 8 * 1024 * 1024;
export const FEE_ENVELOPE_WORKBOOK_MODEL_BYTES = 32 * 1024 * 1024;
const bytes = (text: string) => new TextEncoder().encode(text).length;
const fail = (reason: string): never => { throw new FeeEnvelopeError(reason); };
function within(text: string, reason: string) {
  if (bytes(text) > FEE_ENVELOPE_REPORT_BYTES) fail(reason);
  return text;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Exact opened text, rather than a reserialized approximation of that file. No installation. */
export async function feeEnvelopeInternalSnapshot(raw: unknown) {
  const envelope = await parseFeeEnvelope(raw);
  // parseFeeEnvelope accepts only primitive strings. They cannot change across an await.
  const raw_file_json = raw as string;
  return freeze({
    scope: 'INTERNAL_READ_ONLY_FEE_ENVELOPE_HANDOFF' as const,
    financial_writes: 0 as const,
    latest_proven: false as const,
    global_duplicate_proof: false as const,
    professional_review: false as const,
    customer_document: false as const,
    raw_file_json,
    raw_file_sha256: await feeEnvelopeSha256(raw_file_json),
    semantic_content_sha256: envelope.content_sha256,
    lease: {
      envelope_id: envelope.envelope_id, business_id: envelope.business_id,
      revision: envelope.revision, content_sha256: envelope.content_sha256,
    },
    review: await reviewFeeEnvelope(envelope),
  });
}

const escaped = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  .replace(/\r/g, '&#13;').replace(/\n/g, '&#10;');
const notice = '内部资料，勿直接发客户。仅核对所提供文件的完整来源与本地历史结构；不证明最新版本、全局未重复、真实订单、付款事实或专业复核。指纹不是签名。没有费用写入，也不安装或恢复工作台数据。';
const history = (status: string) => status === 'NOT_ESTABLISHED'
  ? '历史未知：不能推定未消费。' : '本地历史结构通过：仍不证明真实业务或全局唯一。';
type Snapshot = Awaited<ReturnType<typeof feeEnvelopeInternalSnapshot>>;
function summary(s: Snapshot): string[][] {
  return [
    ['范围', notice], ['封套编号', s.lease.envelope_id], ['业务命名空间', s.lease.business_id],
    ['修订', String(s.lease.revision)], ['原文件 UTF-8 SHA-256', s.raw_file_sha256],
    ['语义内容 SHA-256', s.semantic_content_sha256],
    ['历史口径', history(s.review.history_status)],
    ['当前项目/账单', s.review.payload_is_current ? '与末次历史载荷相符；不代表配对/附件/精度来源全部相符' : '与历史载荷不同，保留历史，不重放'],
    ['回执数', String(s.review.receipts.length)], ['本地已消费来源数', String(s.review.consumed.length)],
    ['全局未重复证明', '无'], ['最新版本证明', '无'], ['费用写入数', '0'],
    ['原始待办', s.review.issues.join('；')],
  ];
}
async function reportSnapshot(raw: unknown, reason: string) {
  if (typeof raw !== 'string') throw new FeeEnvelopeError('TEXT_REQUIRED');
  within(raw, reason);
  const s = await feeEnvelopeInternalSnapshot(raw);
  within(JSON.stringify(s), reason);
  return s;
}

/** Static standalone HTML. Complete evidence is included or the entire export is rejected. */
export async function feeEnvelopeInternalHtml(raw: unknown): Promise<string> {
  const reason = 'HTML_EXPORT_SIZE', s = await reportSnapshot(raw, reason);
  const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>内部封套交接审计</title><style>body{font:16px/1.6 sans-serif;max-width:1100px;margin:24px auto;padding:0 16px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:8px;text-align:left;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}h1{font-size:1.5rem}</style>'
    + '<h1>内部封套交接审计</h1><p>' + notice + '</p><p>未提交编辑不在本报告。原金额、分数、币种、未知值和失配均按来源保留，不合计、不舍入、不确认税务或应用资格。原文件指纹覆盖全部 UTF-8 原文（含空格与换行），语义指纹覆盖封套规范内容，两者不互相替代。</p>'
    + '<table><thead><tr><th>字段</th><th>核对结果</th></tr></thead><tbody>'
    + summary(s).map(row => '<tr>' + row.map(c => '<td>' + escaped(c) + '</td>').join('') + '</tr>').join('')
    + '</tbody></table><h2>完整来源、回执、消费及当前失配审计</h2><pre>' + escaped(JSON.stringify(s.review, null, 2))
    // A first LF after <pre> is removed even when expressed as a character reference.
    + '</pre><h2>完整封套原文（含全部历史与来源）</h2><pre><span aria-hidden="true"></span>' + escaped(s.raw_file_json) + '</pre></html>';
  return within(html, reason);
}

/** Text-only cells preserve exact strings, including formula-like content and long decimals. */
export async function feeEnvelopeWorkbookSheet(raw: unknown): Promise<WorkbookSheet> {
  const reason = 'WORKBOOK_EXPORT_SIZE', s = await reportSnapshot(raw, reason);
  const row = (values: string[]) => [...values, ...Array(Math.max(0, 4 - values.length)).fill('')].map(textCell);
  const rows = summary(s).map(([key, value]) => row(['摘要', '', key!, value!]));
  rows.push(row(['编码说明', '', '原文还原', '按片段序号拼接“完整封套原文JSON字符串”的值，再进行一次JSON字符串解码；保留原始CR/LF和Unicode。审计片段直接拼接为JSON。']));
  // JSON-string encoding preserves CR/LF through XML line-ending normalization.
  for (const [label, text] of [['完整封套原文JSON字符串', JSON.stringify(s.raw_file_json)], ['完整封套审计', JSON.stringify(s.review, null, 2)]]) {
    // Iterate Unicode points; chunks can be concatenated without damaging surrogate pairs.
    let chunk = '', count = 0, sequence = 1;
    for (const point of text!) {
      chunk += point;
      if (++count === 240) { rows.push(row([label!, String(sequence++), '', chunk])); chunk = ''; count = 0; }
    }
    if (chunk) rows.push(row([label!, String(sequence), '', chunk]));
  }
  const sheet: WorkbookSheet = {name: '内部封套审计', headers: ['类别', '片段序号', '字段', '值/完整原文片段'], widths: [25, 12, 38, 100], rows, freezeColumns: 1};
  // Includes cell/model overhead. The existing writer independently limits physical rows.
  if (bytes(JSON.stringify(sheet)) > FEE_ENVELOPE_WORKBOOK_MODEL_BYTES) fail(reason);
  return sheet;
}

/** Actual XLSX bytes; no browser, disk, cache, customer exporter, or workflow side effects. */
export async function feeEnvelopeInternalWorkbook(raw: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const sheet = await feeEnvelopeWorkbookSheet(raw);
  const result = serializeWorkbook({audience: 'INTERNAL', title: '内部封套交接审计', generatedAt: '', sheets: [sheet]});
  if (result.byteLength > FEE_ENVELOPE_REPORT_BYTES) fail('WORKBOOK_EXPORT_SIZE');
  return result;
}
