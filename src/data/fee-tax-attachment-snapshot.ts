import {validateFeeTaxAttachment,reviewFeeTaxAttachment} from './fee-tax-attachment.js';
import {FEE_TAX_CHANNEL_KEYS} from '../domain/fee-tax-components.js';
import {textCell,type WorkbookSheet} from './xlsx-file.js';
import {FeeTaxAttachmentError} from '../domain/fee-tax-attachment.js';
export const FEE_TAX_WORKBOOK_SNAPSHOT_BYTES=8*1024*1024;

/** Explicit internal export; never handed to the customer document builders. */
async function buildSnapshot(value:unknown,currentPairText:string,workbookLimit?:number){
 const pending=validateFeeTaxAttachment(value),a=await pending;
 // a is already a detached, validated file; avoid validating it again just to print its JSON.
 const text=JSON.stringify(a,null,2)+'\n';
 if(workbookLimit!==undefined&&new TextEncoder().encode(text).length>workbookLimit)throw new FeeTaxAttachmentError('WORKBOOK_EXPORT_SIZE');
 return{scope:'INTERNAL_NO_FEE_APPLICATION' as const,attachment_json:text,review:await reviewFeeTaxAttachment(a,currentPairText)};
}
export async function feeTaxAttachmentInternalSnapshot(value:unknown,currentPairText:string){return buildSnapshot(value,currentPairText);}
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const labels={cash:'应付G',net:'净额N',tax:'税额T',credit:'抵扣假设X',economic:'费用净额E',customs:'海关成分C'};
function notes(row:Awaited<ReturnType<typeof reviewFeeTaxAttachment>>['rows'][number]):string{
 const states={NOT_RECORDED:'未核对',NEEDS_REVIEW:'待复核',RECORDED_ASSUMPTION:'已记录用户假设'};
 return[...Object.entries(row.acknowledgements).map(([f,s])=>labels[f as 'tax'|'credit'|'customs']+'：'+states[s.status]),...row.issues,...Object.values(row.acknowledgements).flatMap(x=>x.issues)].join('；');
}
export async function feeTaxAttachmentInternalHtml(value:unknown,currentPairText:string):Promise<string>{
 const s=await feeTaxAttachmentInternalSnapshot(value,currentPairText),rows=s.review.rows.map(r=>`<tr><th>${escape(r.record_id)}</th><td>${escape(r.calculation.input.currency)}</td>${FEE_TAX_CHANNEL_KEYS.map(k=>{const v=r.calculation.channels[k];return`<td>${v?escape(v.numerator+'/'+v.denominator):'未知'}</td>`;}).join('')}<td>${escape(notes(r))}</td></tr>`).join('');
 return'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>内部成分附件快照</title><style>body{font:16px/1.6 sans-serif;max-width:1100px;margin:24px auto;padding:0 16px}table{border-collapse:collapse}td,th{padding:8px;border:1px solid #bbb;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}.table{overflow:auto}</style><h1>内部成分附件快照</h1><p>内部资料：包含完整来源与凭证/资格假设，勿直接发客户。只含已提交附件，未提交编辑不在本报告。未知不补零，不写费用或认证抵扣资格。金额为原币精确分数，分母1表示整数；不换汇、不合计不同币种。</p><p>'+ (s.review.pair_is_current?'与提供的当前配对原文相符；仍须业务复核。':'来源失配：以下是历史假设，不得作为当前业务结论。')+'</p><div class="table"><table><thead><tr><th>记录</th><th>币种</th>'+FEE_TAX_CHANNEL_KEYS.map(k=>'<th>'+labels[k]+'</th>').join('')+'<th>待办</th></tr></thead><tbody>'+rows+'</tbody></table></div><h2>完整附件原文</h2><pre>'+escape(s.attachment_json)+'</pre></html>';
}
export async function feeTaxAttachmentWorkbookSheet(value:unknown,currentPairText:string):Promise<WorkbookSheet>{
 const s=await buildSnapshot(value,currentPairText,FEE_TAX_WORKBOOK_SNAPSHOT_BYTES);
 const row=(values:string[])=>[...values,...Array(Math.max(0,9-values.length)).fill('')].map(textCell),rows=[row(['口径','内部用户假设，不写费用；只含已提交附件；原币精确分数不合计']),row(['来源状态',s.review.pair_is_current?'原文相符，仍须复核':'历史来源失配'])];
 for(const r of s.review.rows){rows.push(row([r.record_id,r.calculation.input.currency,...FEE_TAX_CHANNEL_KEYS.map(k=>{const v=r.calculation.channels[k];return v?v.numerator+'/'+v.denominator:'未知';}),notes(r)]));}
 const points=Array.from(s.attachment_json);for(let i=0;i<points.length;i+=240)rows.push(row(['完整附件JSON片段',String(i/240+1),points.slice(i,i+240).join('')]));
 return{name:'内部费用税务成分',headers:['记录/类别','币种/值','应付G/JSON片段',...FEE_TAX_CHANNEL_KEYS.slice(1).map(k=>labels[k]),'待办'],widths:[40,20,100,25,25,25,25,25,80],rows,freezeColumns:1};
}
