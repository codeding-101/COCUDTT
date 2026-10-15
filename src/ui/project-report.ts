import styles from './styles.css?inline';
import { serializeProject, toScenario, toScenarios, toTrade, type ProjectFile } from '../data/project-file.js';
import { analyze } from '../engine/analyze.js';
import { compare, scenarioWithDerivedInclusions } from '../engine/compare.js';
import { escapeHtml } from './format.js';
import { renderOutputColumn } from './views-output.js';
import { projectSensitivity, renderSensitivityResult, type SensitivityControls } from './sensitivity.js';
import type { SettlementPlan } from '../domain/settlement.js';
import { renderSettlementSnapshot } from './settlement.js';
import type {ContainerBillDraft} from '../domain/container-bill-draft.js';
import {renderContainerBillSnapshot} from './container-bill.js';
import type {ContainerCostPair} from '../domain/container-cost-pair.js';
import {containerPairSnapshot} from '../data/container-pair-snapshot.js';

/** 每次重新计算并生成独立HTML字符串，不保留可被后续编辑改变的引用。 */
export function createProjectReport(project: ProjectFile, generatedAt = new Date().toISOString(), hypothesis?: SensitivityControls, settlement?: SettlementPlan,bill?:ContainerBillDraft,pair?:ContainerCostPair): string {
  const trade = toTrade(project);
  const template = toScenario(project);
  const input = { trade, taxProfile: project.tax_profile, fxBooks: project.fx_books,
    ...(project.export_date !== undefined ? { today: project.export_date } : {}) };
  const result = analyze({ ...input, scenario: scenarioWithDerivedInclusions(template, trade) });
  const comparison = compare({ ...input, template, scenarios: toScenarios(project), anchor: project.anchor });
  const snapshot = serializeProject(project);
  const title = `${project.name || '未命名交易'} · 内部测算报告`;
  const rows = [
    ['商品', project.goods.name], ['数量与单位', `${project.goods.quantity} ${project.goods.unit}`],
    ['货物净价/货值', `${project.goods.trade_value.amount} ${project.goods.trade_value.currency}`],
    ['本方案报价', `${template.quote.amount} ${template.quote.currency} · ${project.incoterm} ${template.quote.named_place ?? ''}`],
    ['合同比较日期', project.evaluation_date ?? '未填写（实际报价及费用约定的有效期需核对）'],
    ['卖方采购成本', String(project.goods.seller_goods_cost.amount).trim() === '' ? '未知，利润无法评估' : `${project.goods.seller_goods_cost.amount} ${project.goods.seller_goods_cost.currency}`],
    ['核算币种', project.base_currency], ['进口申报日期', project.tax_profile.import.declarationDate ?? '未填写'],
    ['比较基准', project.anchor.kind === 'ACTUAL_QUOTES' ? '各方案实际报价' : project.anchor.kind === 'FIXED_QUOTE' ? '固定报价金额' : project.anchor.kind === 'FIXED_MARKET_PRICE' ? `固定买方总支付 ${project.anchor.buyer_total} ${project.anchor.currency}` : `固定目标利润率 ${project.anchor.margin_rate}`],
  ];
  // 报告默认展开依据和待办，避免打印时遗漏未核对内容。
  const output = renderOutputColumn({ result, comparison, error: null }).replace(/<details([^>]*)>/g, '<details$1 open>');
  let hypothesisHtml = '';
  if (hypothesis?.enabled) {
    try { const analysis = projectSensitivity(project, hypothesis);
      hypothesisHtml = `<section class="panel"><div class="panel-body"><h2>生成时的假设分析（参考）</h2>${renderSensitivityResult(analysis)}<details open><summary>假设参数快照（不写回项目）</summary><pre>${escapeHtml(JSON.stringify(analysis.request, null, 2))}</pre></details></div></section>`;
    } catch (error) { hypothesisHtml = `<section class="panel"><div class="panel-body"><h2>假设分析未完成</h2><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p><pre>${escapeHtml(JSON.stringify(hypothesis, null, 2))}</pre></div></section>`; }
  }
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>${styles}</style><style>
body { padding: 16px; } .report { margin: 0 auto; max-width: 1600px; }
.report-header h1 { font-size: 21px; margin: 0 0 10px; } .report-header { margin-bottom: 16px; }
.report > .panel { margin-bottom: 16px; } .report pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; }
@media print { @page { size: A4 landscape; margin: 12mm; } body { padding: 0; background: white; }
.panel { box-shadow: none; } .hero .cell { break-inside: avoid; } table tr { break-inside: avoid; }
.report-help { display: none; } a { color: inherit; } .result-tables { display: block; }
.snapshot:not([open]) > pre { display: none; } }
</style></head><body><main class="report">
<header class="report-header"><h1>${escapeHtml(title)}</h1>
<p>生成时间：${escapeHtml(generatedAt)} · ${result.decision.ready ? '满足当前排名检查条件' : '参考测算，仍有待核对事项'}</p>
<p class="hint">报告保存生成时的输入和结果。人工记录不等于程序或主管机关认证；比较结论取决于录入事实及模型范围。</p>
<aside class="responsibility-notice" aria-label="责任声明">本工具仅供学习与内部测算参考，不构成法律或专业贸易建议。实际合同请以 Incoterms® 官方文本及当地法规为准。</aside>
<p class="report-help">离线打开即可复核；使用浏览器打印功能可保存PDF。需要查看完整输入时，展开文末输入快照。</p></header>
<section class="panel"><div class="panel-body"><h2 class="panel-heading">生成时的交易输入</h2>
<table class="grid stackable"><tbody>${rows.map(([label = '', value = '']) => `<tr><th>${escapeHtml(label)}</th><td data-label="输入">${escapeHtml(value)}</td></tr>`).join('')}</tbody></table></div></section>
${output}
${hypothesisHtml}
${settlement ? renderSettlementSnapshot(project, settlement, result) : ''}
${bill?renderContainerBillSnapshot(bill,project):''}
 ${pair?`<section class="panel"><div class="panel-body"><h2>内部配对与核对记录</h2><p>用户来源假设，不清除原待办或写费用；只包含已保存配对，未提交编辑不在报告。当前资料失配时须按历史记录核对。</p><pre class="pair-original">${escapeHtml(JSON.stringify(containerPairSnapshot(pair,project,bill),null,2))}</pre></div></section>`:''}
<section class="panel"><div class="panel-body"><details class="snapshot"><summary>完整项目输入快照（可另存为项目JSON）</summary><pre>${escapeHtml(snapshot)}</pre></details></div></section>
</main></body></html>`;
}
