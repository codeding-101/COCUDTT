import { FUNDING_EXAMPLE_FILES, fundingExampleJson, fundingExampleRecord, type FundingExampleKind } from '../data/funding-example.js';
import { escapeHtml as e } from './format.js';
// A small independent stylesheet makes this standalone artifact identical in all builds.
export const FUNDING_EXAMPLE_GUIDE_STYLES='*{box-sizing:border-box}body{margin:0;padding:16px;background:#f4f5f7;color:#14181f;font:14px/1.7 "Segoe UI","Microsoft YaHei",system-ui,sans-serif}.guide{max-width:960px;margin:auto;background:white;border:1px solid #e2e5ea;border-radius:8px}.panel-body{padding:20px}h1{font-size:23px;margin:0 0 16px}h3{font-size:17px;margin:20px 0 8px}p,li,th,td{overflow-wrap:anywhere}li{margin:6px 0}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{text-align:left;padding:8px;border:1px solid #e2e5ea;vertical-align:top}th{background:#f4f5f7}.hint{font-size:12px;color:#586171}@media(max-width:600px){body{padding:8px}.panel-body{padding:12px}h1{font-size:19px}ol,ul{padding-left:22px}thead{display:none}tbody,tr,th,td{display:block}tr{border:1px solid #e2e5ea;border-radius:6px;margin-bottom:10px}th,td{border:0}td::before{content:attr(data-label);display:inline-block;margin-right:12px;color:#586171;font-size:12px}}@media print{body{padding:0;background:white}.guide{max-width:none;border:0}tr{break-inside:avoid}}';
export function fundingExampleGuideBody():string {
  const record=fundingExampleRecord(),r=record.expected;
  return `<p><strong>这是合成手算案例，不是真实贸易、报关或银行业务验收。</strong>只录入CIF合成报价，来源仍为示例，其余术语不参与有效报价排名；不要把示例税率或汇率套入实际交易。</p>
  <ol><li>先分别保存当前项目及本页付款计划，再下载下方配套文件。下载不会替换当前交易。</li><li>用“打开项目”选择${e(FUNDING_EXAMPLE_FILES.project)}，再用付款面板的“打开内部付款计划JSON”选择${e(FUNDING_EXAMPLE_FILES.plan)}。两个文件必须配对，核对绑定名称、商品、数量、术语、地点及原币报价。</li><li>展开资金占用结果，逐笔核对9月11日减少4000、9月21日增加2000，余额为12000 → 8000 → 10000 USD。本金12000与合成合同报价108300 USD是两个独立输入。</li><li>按下表核对区间、真实日期差、期初/截止余额与总额。可将截止日增加“减少10000 USD”事件，核对期末余额变0而成本仍为50；再删除该试验事件恢复原例。没有依据的变更只属于新的合成假设。</li><li>分别导出内部HTML/Excel，核对“资金占用假设”中的原始事件、审计事件、各段与总公式。客户文件沿用公开白名单，不自动带入本页本金/依据；分享前须重新预览检查。</li></ol>
  <table class="grid stackable"><thead><tr><th>区间（含起日、不含止日）</th><th>本金/天数</th><th>本金×天数</th><th>精确成本（USD）</th></tr></thead><tbody>${r.segments.map(s=>`<tr><th>${s.start_date} → ${s.end_date}</th><td data-label="本金/天数">${s.principal} USD / ${s.days}天</td><td data-label="本金×天数">${s.principal_days} USD·天</td><td data-label="精确成本">${s.cost_exact}</td></tr>`).join('')}</tbody></table>
  <p>期初本金 ${r.opening_principal} USD，截止余额 ${r.closing_principal} USD；本金×天数合计 ${r.principal_days} USD·天。${e(r.formula)} USD。</p>
  <p class="hint">40/3及50/3是循环小数的精确分数表示。界面默认最多12有效位，近似值标≈，完整精度可展开；Excel保留生成时计算值，超出Excel数值精度以文本保存。没有按银行货币单位舍入，不直接相加显示的近似小数验证总额。</p>
  <h3>导出文件怎么用</h3><ul><li>项目JSON：保存交易与规则输入；不含本页付款、客户公开字段或临时假设。</li><li>付款计划JSON：单独保存绑定、付款及资金事件；打开项目不会自动带入它。</li><li>内部HTML/Excel：含内部成本、来源和本页计划的生成时快照，可能敏感；不能作为项目/付款文件再导入，编辑Excel单元格不会重跑引擎。</li><li>客户HTML/Excel/PDF及双语摘要：先检查公开预览；内部资金数据不自动进入客户文件。手填公开文字仍可能含敏感内容，须人工核对。</li><li>手算核对记录和本说明页：配套的合成参考资料；不是计算结果认证、项目或付款文件。</li></ul>
  <p>绑定错误时先核对是否打开了正确配对，不直接点击重新绑定来掩盖错误；输入或版本错误时保留原文件。取消/失败不会替换当前输入。发起下载后须确认浏览器实际保存；跨设备需传递项目与付款两个文件。</p>
  <p class="hint">若改成本例以外的真实输入，原手算预期值不再适用。真实税率/汇率、资金合同、生效日界与凭证仍须另核，真实手机和人工专业验收尚未完成。</p>`;
}
export function renderFundingExamplePanel(busy=false):string {
  const buttons:[FundingExampleKind,string][]=[['project','下载配套项目JSON'],['plan','下载配套付款JSON'],['record','下载手算核对记录'],['guide','下载离线说明页']];
  return `<details class="panel" data-evidence-section="funding-example"><summary><span class="panel-title">合成案例 · 本金事件核对与导出说明</span></summary><div class="panel-body"><p>四份文件独立生成，不读取当前项目、付款、草稿或客户资料。</p><div class="panel-actions">${buttons.map(([kind,label])=>`<button data-action="download-funding-example" data-example-kind="${kind}"${busy?' disabled':''}>${label}</button>`).join('')}</div>${busy?'<p role="status">正在导出模板、案例或结构文件…</p>':''}${fundingExampleGuideBody()}</div></details>`;
}
export function fundingExampleResource(kind:string):{name:string;mime:string;text:string} {
  if(!Object.hasOwn(FUNDING_EXAMPLE_FILES,kind))throw Error('请选择目录中的合成案例文件');
  const key=kind as FundingExampleKind,name=FUNDING_EXAMPLE_FILES[key];
  if(key!=='guide')return{name,mime:'application/json',text:fundingExampleJson(key)};
  return{name,mime:'text/html',text:`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>合成本金案例 · 手算核对与导出说明</title><style>${FUNDING_EXAMPLE_GUIDE_STYLES}</style></head><body><main class="panel guide"><div class="panel-body"><h1>合成本金案例 · 手算核对与导出说明</h1>${fundingExampleGuideBody()}</div></main></body></html>\n`};
}
