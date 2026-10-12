import { d } from '../domain/decimal.js';
import { CUSTOMER_QUOTE_FIELDS, type CustomerQuote, type CustomerQuoteFields } from '../domain/customer-quote.js';
import type { ProjectFile } from '../data/project-file.js';
import { projectCustomerQuote } from '../data/customer-quote.js';
import { escapeHtml } from './format.js';
import { isIsoDate } from '../engine/tax/china-import.js';

const FIELD_LABELS:Record<keyof CustomerQuoteFields,string>={issuer:'报价提供方（公开名称）',recipient:'客户/接收方（公开名称）',reference:'公开报价编号',goods_description:'公开商品说明（留空沿用商品名称）',delivery_terms:'具体交付时间与安排',payment_terms:'付款方式、时间与币种',included_scope:'报价包含的费用范围',excluded_scope:'报价不包含的费用范围',insurance_terms:'实际保险安排或另约',tax_terms:'税费口径与适用条件',remarks:'其他公开备注'};
export const customerQuoteFileName=(quote:CustomerQuote):string=>`${(quote.reference||'客户报价说明').replace(/[\\/:*?"<>|]/g,'-').slice(0,80)}-客户报价草稿.html`;
const text=(value:string):string=>value?escapeHtml(value):'待双方确认';
const money=(value:string):string=>{
  const number=d(value),[whole='',fraction='']=number.toFixed(Math.max(2,number.decimalPlaces())).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')}.${fraction}`;
};
export function renderCustomerQuoteBody(quote:CustomerQuote,generatedAt=new Date().toISOString()):string {
  const generatedDate=generatedAt.slice(0,10);
  const outsidePeriod=quote.quote.valid_from&&quote.quote.valid_to&&isIsoDate(generatedDate)&&(generatedDate<quote.quote.valid_from||generatedDate>quote.quote.valid_to);
  const pending=[...quote.pending,...(outsidePeriod?['文档生成日期不在所列报价有效期内，需重新确认报价，不能自动延长有效期']:[])];
  const rows=[['报价提供方',quote.issuer],['客户/接收方',quote.recipient],['公开编号',quote.reference],['商品',quote.goods.description],['数量与单位',`${quote.goods.quantity} ${quote.goods.unit}`],
    ['报价总额（原币）',`${money(quote.quote.amount)} ${quote.quote.currency}`],['贸易术语与指定地点',`${quote.quote.incoterm} ${quote.quote.named_place} · Incoterms® ${quote.quote.incoterms_version}`],
    ['报价有效期',quote.quote.valid_from&&quote.quote.valid_to?`${quote.quote.valid_from} 至 ${quote.quote.valid_to}`:'待双方确认'],
    ['交付安排',quote.terms.delivery],['付款安排',quote.terms.payment],['报价包含范围',quote.terms.included],['报价不包含范围',quote.terms.excluded],['保险安排',quote.terms.insurance],['税费口径',quote.terms.tax],['公开备注',quote.terms.remarks]];
  return `<article class="customer-quote" data-customer-document><header><p>客户报价说明 · 草稿</p><h1>${escapeHtml(quote.reference||'客户报价说明')}</h1><p>供双方复核的报价草稿，尚不表示已签署合同或确认全部履约条件。</p></header>
    <table><tbody>${rows.map(([label='',value=''])=>`<tr><th>${escapeHtml(label)}</th><td>${text(value)}</td></tr>`).join('')}</tbody></table>
    <section><h2>术语标准提示</h2><p>风险转移：${escapeHtml(quote.standard.risk_point)}${quote.standard.risk_pending?'（待核对具体分支）':''}。具体交货事实和双方另约仍须确认。</p>
    ${quote.standard.freight_risk_separated?'<p>卖方支付运费至约定目的地，不代表货损风险持续由卖方承担至该目的地。</p>':''}
    <p>${quote.standard.insurance_obligation?`本术语通常要求卖方投保，默认协会货物条款${quote.standard.insurance_obligation==='ICC_A'?'(A)':'(C)'}或等效保障；保额与实际条款另核。`:'本术语未规定双方须向对方订立保险合同；实际投保及保费承担依双方约定。'}</p>
    <p>标准进口清关及税费费用承担：${quote.standard.import_cost_bearer==='SELLER'?'卖方':'买方'}。费用承担不自动确定法定纳税人或抵扣资格；卸货费用另核合同。所有权、付款和违约处理须另约。</p></section>
    <section><h2>待双方确认</h2>${pending.length?`<ul>${pending.map(item=>`<li>${escapeHtml(item)}</li>`).join('')}</ul>`:'<p>当前填写及核对未发现额外待办；实际合同与履约安排仍须双方确认。</p>'}</section>
    <footer><p>本工具仅供学习与内部测算参考，不构成法律或专业贸易建议。实际合同请以 Incoterms® 官方文本及当地法规为准。</p><p>客户报价说明版本 ${quote.version} · 原币报价保留录入精度，未自动生成单价、税额或承诺条款。</p></footer></article>`;
}
const styles=`.customer-quote{color:#162338;font:14px/1.65 system-ui,"Microsoft YaHei",sans-serif;max-width:900px;margin:0 auto;overflow-wrap:anywhere}.customer-quote h1{font-size:25px;margin:8px 0}.customer-quote h2{font-size:17px}.customer-quote table{width:100%;border-collapse:collapse;table-layout:fixed}.customer-quote th,.customer-quote td{border:1px solid #d8dee8;padding:10px;text-align:left;white-space:pre-wrap;vertical-align:top}.customer-quote th{width:27%;background:#f3f6fb}.customer-quote section{margin-top:20px}.customer-quote footer{border-top:1px solid #d8dee8;font-size:12px;color:#46556a;margin-top:24px}.customer-quote header{padding-bottom:14px}.customer-quote p,.customer-quote li{white-space:pre-wrap}@media(max-width:480px){.customer-quote{font-size:13px}.customer-quote th,.customer-quote td{padding:7px}.customer-quote h1{font-size:20px}}@media print{@page{size:A4;margin:14mm}.customer-quote tr{break-inside:avoid}.customer-quote h2{break-after:avoid}.customer-quote footer{color:#162338}}`;

/** 渲染器只接受公开白名单，文件不包含项目JSON、隐藏字段、脚本或内部报告CSS。 */
export function createCustomerQuoteDocument(quote:CustomerQuote,generatedAt=new Date().toISOString()):string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(quote.reference||'客户报价说明')} · 报价草稿</title><style>${styles}body{margin:0;padding:20px;background:white}</style></head><body><main>${renderCustomerQuoteBody(quote,generatedAt)}<p class="customer-quote">生成时间（ISO时间戳）：${escapeHtml(generatedAt)}</p></main></body></html>`;
}
export function renderCustomerQuotePanel(project:ProjectFile,fields:CustomerQuoteFields,reviewed:boolean,quote:CustomerQuote|null,error:string|null):string {
  return `<details class="panel" data-evidence-section="customer-quote"><summary><span class="panel-title">客户报价预览 · 公开字段</span></summary><div class="panel-body">
    <p>导出对象是客户报价说明草稿。报价取当前术语实际合同原币总额；下方明确填写的文字将进入客户文件，请只填写允许对外发送的内容。参数仅保留在本页，新建/打开项目重置。</p>
    <p class="hint">内部测算报告包含采购成本、利润、来源及完整输入，供内部复核。客户说明从公开字段重新生成，不能替代正式合同或税务确认。</p>
    <div class="customer-fields">${CUSTOMER_QUOTE_FIELDS.map(key=>`<label>${FIELD_LABELS[key]}<textarea rows="${['issuer','recipient','reference'].includes(key)?1:3}" maxlength="4000" data-customer-field="${key}"${key==='goods_description'?` placeholder="${escapeHtml(project.goods.name)}"`:''}>${escapeHtml(fields[key])}</textarea></label>`).join('')}</div>
    ${error?`<p class="banner error" role="alert">客户预览尚未生成：${escapeHtml(error)}</p>`:''}
    ${quote?`<div class="customer-preview" aria-label="客户将看到的内容"><style>${styles}</style>${renderCustomerQuoteBody(quote)}</div>`:'<p class="hint">请先录入当前术语的实际报价、指定地点、商品数量及单位。</p>'}
    <label class="customer-review"><input type="checkbox" data-customer-field="reviewed"${reviewed?' checked':''}${!quote?' disabled':''}>已检查上方公开内容，作为待双方确认的草稿导出</label>
    <button data-action="export-customer-quote"${!quote||!reviewed?' disabled':''}>导出客户报价说明（HTML）</button>
    <button data-action="export-customer-xlsx"${!quote||!reviewed?' disabled':''}>导出客户报价 Excel 草稿</button>
    <p class="hint">编辑公开字段或项目后须重新检查。导出不保存项目、不改变来源确认，也不包含假设分析结果。</p></div></details>`;
}
export { projectCustomerQuote };
