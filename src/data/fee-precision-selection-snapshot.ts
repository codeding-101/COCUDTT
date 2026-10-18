import {validateFeePrecisionSelection,reviewFeePrecisionSelection} from './fee-precision-selection.js';
import {FeePrecisionSelectionError} from '../domain/fee-precision-selection.js';
import {textCell,type WorkbookSheet} from './xlsx-file.js';

export const FEE_PRECISION_WORKBOOK_BYTES=8*1024*1024;
async function snapshot(value:unknown,pair:string,attachment:string,workbook=false){
 const a=await validateFeePrecisionSelection(value),selection_json=JSON.stringify(a,null,2)+'\n';
 if(workbook&&new TextEncoder().encode(selection_json).length>FEE_PRECISION_WORKBOOK_BYTES)throw new FeePrecisionSelectionError('WORKBOOK_EXPORT_SIZE');
 const result={scope:'INTERNAL_NO_FEE_APPLICATION' as const,selection_json,review:await reviewFeePrecisionSelection(a,pair,attachment)};
 if(workbook&&new TextEncoder().encode(JSON.stringify(result)).length>FEE_PRECISION_WORKBOOK_BYTES)throw new FeePrecisionSelectionError('WORKBOOK_EXPORT_SIZE');return result;
}
export function feePrecisionSelectionInternalSnapshot(value:unknown,pair:string,attachment:string){return snapshot(value,pair,attachment);}
const escaped=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const fraction=(v:{numerator:string;denominator:string}|null)=>v===null?'未知':v.numerator+'/'+v.denominator;
const statuses={NOT_RECORDED:'未记录政策',NEEDS_REVIEW:'政策待复核',RECORDED_POLICY_ASSUMPTION:'已记录算术假设'};
function cells(row:Awaited<ReturnType<typeof reviewFeePrecisionSelection>>['rows'][number]){
 const r=row.record;return[r.record_id,r.channel,r.currency,r.choice.kind==='FX'?r.choice.to:r.currency,fraction(r.original),fraction(row.calculation.values.rounded),fraction(row.calculation.values.delta),statuses[row.policy.status as keyof typeof statuses],[...row.binding_issues,...row.policy.issues,...row.business_issues].join('；')];
}
function current(s:Awaited<ReturnType<typeof snapshot>>){return Object.values(s.review.source_status).every(Boolean);}
export async function feePrecisionSelectionInternalHtml(value:unknown,pair:string,attachment:string):Promise<string>{
 const s=await snapshot(value,pair,attachment),headers=['记录','通道','原币','候选币种','原精确金额','候选','有符号差额','政策状态','原待办'];
 return'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>内部精度政策快照</title><style>body{font:16px/1.6 sans-serif;max-width:1100px;margin:24px auto;padding:0 16px}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:8px;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}.table{overflow:auto}</style><h1>内部精度政策快照</h1><p>内部资料，勿直接发客户。仅含已提交记录；未提交编辑不在本报告。候选不覆盖原值，差额不写费用；不合计不同通道/币种，不确认税务或应用资格。</p><p>'+ (current(s)?'完整双来源相符，仍须业务复核。':'来源失配：以下保留历史假设，不得作为当前业务结论。')+'</p><div class="table"><table><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+s.review.rows.map(r=>'<tr>'+cells(r).map(c=>'<td>'+escaped(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div><h2>完整文件原文</h2><pre>'+escaped(s.selection_json)+'</pre><h2>完整来源、政策与逐步算术审计</h2><pre>'+escaped(JSON.stringify(s.review,null,2))+'</pre></html>';
}
export async function feePrecisionSelectionWorkbookSheet(value:unknown,pair:string,attachment:string):Promise<WorkbookSheet>{
 const s=await snapshot(value,pair,attachment,true),row=(v:string[])=>[...v,...Array(Math.max(0,9-v.length)).fill('')].map(textCell),rows=[row(['口径','仅已提交算术政策，非税务确认或费用应用；候选与原值并列，不合计不同币种/通道']),row(['完整来源',current(s)?'相符，仍须业务复核':'失配，历史假设待复核'])];
 for(const r of s.review.rows)rows.push(row(cells(r)));
 for(const [label,text]of[['完整精度JSON片段',s.selection_json],['完整精度审计片段',JSON.stringify(s.review,null,2)]]){const points=Array.from(text!);for(let i=0;i<points.length;i+=240)rows.push(row([label!,String(i/240+1),points.slice(i,i+240).join('')]));}
 return{name:'内部精度政策',headers:['记录/类别','通道/序号','原币/JSON片段','候选币种','原精确金额','候选','有符号差额','政策状态','原待办'],widths:[38,20,100,18,35,35,35,35,85],rows,freezeColumns:1};
}
