import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'..');
const h=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const amount=value=>{const [whole,fraction]=value.split('.');return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+fraction};
export function renderImportWalkthrough(projectText,record) {
 const p=JSON.parse(projectText),baseline=record.scenarios[0].expected;
 const headings={dutiable_value:'完税价格',duty:'关税',consumption_tax:'消费税',vat:'进口增值税',buyer_total:'买方总支付',buyer_ex_deductible:'不含可抵扣税成本'};
 return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>中国进口合成演示 · COCUDTT</title><style>
:root{font-family:system-ui,"Microsoft YaHei",sans-serif;color:#243c36;background:#f3f5f3;line-height:1.7}*{box-sizing:border-box}body{margin:0}main{max-width:1000px;margin:auto;padding:40px 24px}h1{font-size:clamp(25px,4vw,38px);line-height:1.3}h2{font-size:22px;margin-top:0}h3{font-size:18px}a{color:#075e50}section,details{background:white;border:1px solid #d9e1db;border-radius:8px;padding:24px;margin:20px 0}p,li,td,code{overflow-wrap:anywhere}.label{font-size:13px;letter-spacing:.08em;color:#4a665b}.notice{border-left:4px solid #aa732a;padding:12px 16px;background:#fff7e9}.actions{display:flex;gap:12px;flex-wrap:wrap}.button{display:inline-block;padding:12px 18px;background:#166450;color:white;border-radius:5px;text-decoration:none;min-height:44px}.secondary{background:#edf2ef;color:#174f42}table{width:100%;border-collapse:collapse}th,td{padding:12px 8px;border-bottom:1px solid #e1e8e3;text-align:left}td:last-child{font-variant-numeric:tabular-nums}summary{cursor:pointer;font-weight:600;min-height:44px}ol{padding-left:24px}li{margin:12px 0}code{white-space:normal}.small{font-size:14px;color:#4c6157}.formula{padding:10px 12px;background:#f4f7f5;font-family:ui-monospace,monospace;font-size:14px}.flow{display:flex;gap:8px;flex-wrap:wrap}.flow span{background:#e8f1ec;padding:8px 12px;border-radius:4px}@media(max-width:600px){main{padding:24px 12px}section,details{padding:16px}th,td{padding:10px 4px;font-size:14px}.actions>a{flex:1;text-align:center}.flow{display:grid;grid-template-columns:1fr 1fr}}@media print{body{background:white}main{max-width:none;padding:0}.actions{display:none}section,details{break-inside:avoid}a{color:inherit}}
</style></head><body><main>
<p class="label">COCUDTT / 可复现合成案例 / 1.0 / ${h(record.prepared_on)}</p><h1>读懂一次中国进口测算</h1>
<p>先核对净价、报价与两类汇率，再沿真实公式核对税款和买方支付。所有数字均虚构；本页不读取浏览器缓存、当前交易或任何用户文件。</p>
<p class="notice"><strong>这不是实际商品的税则、报价或业务验收。</strong>卖方采购成本留空，利润应显示“无法评估”；来源为 EXAMPLE，结果必须保留“参考测算”。本页整理现有程序口径，未进行新一轮法规核查或专业复核。</p>
<div class="flow" aria-label="演示步骤"><span>01 下载固定项目</span><span>02 打开并核对输入</span><span>03 对照金额与待办</span><span>04 分别改变假设</span></div>
<section id="start"><h2>1. 下载项目，再显式打开</h2><p>打开会替换当前交易、原始汇率输入及内存中的付款/客户/假设参数。请先保存当前项目及独立资料；独立账单/配对不由此文件恢复，需重新核对。</p>
<div class="actions"><a class="button" id="download-project" download="china-import-walkthrough.project.json" href="data:application/json;charset=utf-8,${encodeURIComponent(projectText)}">下载合成项目 JSON</a><a class="button secondary" href="trade-cost-engine.html">打开测算工具</a></div>
<p>离线使用：将本页与 <code>trade-cost-engine.html</code> 放在同一目录。下载后，在工具“项目与导出 → 打开项目 JSON”选择文件；本页不会自动导入、覆盖交易或加入最近项目。下载行为由浏览器处理，请检查文件是否已保存。</p></section>
<section id="inputs"><h2>2. 逐项核对输入</h2><table><thead><tr><th scope="col">输入</th><th scope="col">合成值与含义</th></tr></thead><tbody>
<tr><th scope="row">路线与术语</th><td>德国（演示）→ 中国；单商品一票、一般贸易、CIF / 海运</td></tr><tr><th scope="row">商品与货值</th><td>1000 PCS；货物净价 100,000 USD，不把CIF整价再填成净价</td></tr><tr><th scope="row">运保费与报价</th><td>运费 8,000 USD；保险费 300 USD；报价 108,300 USD。基准价恰等于净价＋运保费是本例设定，不是通用定价公式</td></tr><tr><th scope="row">卖方采购成本</th><td>未知，保持空白；不能用0替代</td></tr><tr><th scope="row">商业／海关汇率</th><td>7.00 ／ 7.08 CNY/USD；核算币种 CNY，商业支付与计税分别使用</td></tr><tr><th scope="row">日期</th><td>申报日2026-09-10；虚构海关汇率适用2026-09，加入或打开日期不延长有效期</td></tr><tr><th scope="row">税务假设</th><td>从价关税5%、进口VAT13%、无消费税；VAT不可抵扣测算。税率、资格与来源均非真实业务结论</td></tr></tbody></table>
<p class="small">项目版本 ${h(p.schema_version)}；固定整理时间不是实际申报日。未列目的港、代理、查验和国内运输等实际费用，示例总额不是完整真实落地成本。</p></section>
<section id="baseline"><h2>3. 核对基准金额（人民币）</h2><table><thead><tr><th scope="col">结果</th><th scope="col">预期 CNY</th></tr></thead><tbody>${Object.entries(headings).map(([key,label])=>`<tr><th scope="row">${label}</th><td data-expected="${key}">${amount(baseline[key])}</td></tr>`).join('')}<tr><th scope="row">卖方利润</th><td>无法评估（采购成本未知）</td></tr></tbody></table>
${record.scenarios[0].formulae.map(line=>`<p class="formula">${h(line)}</p>`).join('')}
<p>进口VAT先按分舍入，再进入总支付；消费税为0是本例明确设定。VAT不可抵扣，因此两种成本口径相同。没有启用中国出口退税测算；进口税款不按出口退税抵减。</p>
<p><strong>金额可计算，业务仍待核对。</strong>顶部保留“参考测算”；不要为让提示消失而确认虚构来源。CIF风险不能按运费支付终点推断，保费300也不认证险别或保额。</p></section>
<section id="experiments"><h2>4. 三次独立假设实验</h2><p>每次先重新打开刚下载的基准文件，确认总支付恢复901,101.49 CNY，再按下列要求修改。不要累计上次改动；不要修改日期或确认来源来迎合答案。基准始终使用录入报价，不是其他术语的反推结果。</p>
${record.scenarios.slice(1).map(s=>`<details data-scenario="${h(s.id)}"><summary>${h(s.label)}</summary><p>在高级设置的汇率管理中定位 CONTRACT 或 CUSTOMS 的 USD/CNY；运费实验同时修改费用明细中的“国际海运费”和报价金额，系统不会自动重报合同价格。</p>${s.formulae.map(line=>`<p class="formula">${h(line)}</p>`).join('')}<p>买方总支付 <strong>${amount(s.expected.buyer_total)} CNY</strong>；相对基准增加 ${amount(s.expected.delta_buyer)} CNY。卖方利润仍未知，来源仍须复核。</p></details>`).join('')}</section>
<section id="handoff"><h2>5. 保存结果并记录边界</h2><p>每次修改失焦或回车后检查结果；内部HTML报告和内部Excel保留本次输入、汇率、税基与待办。用“保存项目”另存修改后的项目，独立付款/账单/配对仍需分别存档。最近项目只是手动本机快照，不是备份。</p><ul>${record.limitations.map(line=>`<li>${h(line)}</li>`).join('')}</ul>
<p>本工具仅供学习与内部测算参考，不构成法律或专业贸易建议。实际合同请以 Incoterms® 官方文本及当地法规为准。</p><p class="small">固定手算记录与自动化对照见仓库 <code>docs/cases/china-import-walkthrough.expected.json</code>、<code>tests/china-import-walkthrough.test.ts</code>；真实单据、人工专业复核和真实手机验收尚未完成。</p></section>
<p><a href="project-introduction.html">返回项目介绍</a> · <a href="#start">回到下载步骤</a></p></main></body></html>\n`;
}
export function buildImportWalkthrough(check=false){
 const projectText=readFileSync(resolve(root,'docs/cases/china-import-walkthrough.project.json'),'utf8').replace(/\r\n/g,'\n');
 const record=JSON.parse(readFileSync(resolve(root,'docs/cases/china-import-walkthrough.expected.json'),'utf8'));
 const html=renderImportWalkthrough(projectText,record),target=resolve(root,'china-import-walkthrough.html');
 if(check){if(readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==html)throw Error('Walkthrough differs: run node tools/build-import-walkthrough.mjs');}
 else writeFileSync(target,html,'utf8');
 console.log(check?'Import walkthrough: deterministic offline HTML and embedded project match source':'Generated offline import walkthrough from fixed project and hand calculations');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)buildImportWalkthrough(process.argv.includes('--check'));
