import type { CustomerQuote } from '../domain/customer-quote.js';
import { bilingualSummary, type LanguagePair } from '../data/bilingual-summary.js';
import { escapeHtml } from './format.js';

const pair=(p:LanguagePair)=>`<p lang="zh-CN">${escapeHtml(p.zh)}</p><p lang="en">${escapeHtml(p.en)}</p>`;
const pending='待双方确认 / Pending confirmation by both parties';
export function renderBilingualSummary(quote:CustomerQuote,generatedAt=new Date().toISOString()):string {
 const summary=bilingualSummary(quote,generatedAt);
 return `<article class="bilingual-summary" data-bilingual-summary><h2>中英文条款摘要 · 草稿 / Bilingual terms summary · Draft</h2>
 <p>固定模板版本 ${summary.version} / Fixed template version ${summary.version}</p>
 <p>供双方复核；尚未形成合同或确定承诺。/ For review by both parties; this is not an executed contract or a firm commitment.</p>
 <p>公开字段保留原文，未自动翻译；英文标签和标准提示不代表原文已获英文确认。/ Public fields retain their original wording without automatic translation. English labels and standard guidance do not confirm the English meaning of that wording.</p>
 <table><thead><tr><th>项目 / Item</th><th>公开原文或数据 / Original public wording or data</th></tr></thead><tbody>${summary.rows.map(r=>`<tr><th>${pair(r.label)}</th><td>${escapeHtml(r.value||pending)}</td></tr>`).join('')}</tbody></table>
 <section><h3>标准提示 / Standard guidance</h3>${summary.standard.map(pair).join('')}</section>
 <section><h3>待双方确认 / Pending confirmation</h3>${summary.pending.length?`<ol>${summary.pending.map(p=>`<li${p.translated?'':' data-original-notice'}>${pair(p)}</li>`).join('')}</ol>`:`<p>当前检查未发现额外待办；实际合同及履约仍须确认。/ No additional pending items were found in the current checks; the actual contract and performance arrangements still require confirmation.</p>`}</section>
 <footer>${pair(summary.disclaimer)}${pair(summary.precision)}<p>生成时间（ISO时间戳） / Generated at (ISO timestamp): ${escapeHtml(summary.generatedAt)}</p></footer></article>`;
}
const styles=`.bilingual-summary{font:14px/1.65 system-ui,"Microsoft YaHei",sans-serif;color:#162338;overflow-wrap:anywhere;max-width:900px;margin:auto}.bilingual-summary p{white-space:pre-wrap;margin:4px 0 8px}.bilingual-summary [lang=en]{color:#46556a}.bilingual-summary table{width:100%;table-layout:fixed;border-collapse:collapse}.bilingual-summary th,.bilingual-summary td{border:1px solid #d8dee8;padding:10px;vertical-align:top;text-align:left;white-space:pre-wrap}.bilingual-summary th{width:35%;background:#f3f6fb}.bilingual-summary footer{border-top:1px solid #d8dee8;margin-top:20px;font-size:12px}.bilingual-summary h2{font-size:21px}.bilingual-summary h3{font-size:17px}@media(max-width:480px){.bilingual-summary{font-size:13px}.bilingual-summary th,.bilingual-summary td{padding:6px}}@media print{@page{size:A4;margin:14mm}.bilingual-summary tr{break-inside:avoid}.bilingual-summary h3{break-after:avoid}}`;
export function bilingualSummaryStyles():string {return styles;}
export function createBilingualSummaryDocument(quote:CustomerQuote,generatedAt=new Date().toISOString()):string {
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(quote.reference||'客户报价说明')} · 中英文条款摘要草稿</title><style>${styles}body{background:white;margin:0;padding:20px}</style></head><body><main>${renderBilingualSummary(quote,generatedAt)}</main></body></html>`;
}
