import styles from './styles.css?inline';
import { serializeProject, toScenario, toTrade, type ProjectFile } from '../data/project-file.js';
import { analyze } from '../engine/analyze.js';
import { compare, scenarioWithDerivedInclusions } from '../engine/compare.js';
import { escapeHtml } from './format.js';
import { renderOutputColumn } from './views-output.js';

/** 每次重新计算并生成独立HTML字符串，不保留可被后续编辑改变的引用。 */
export function createProjectReport(project: ProjectFile, generatedAt = new Date().toISOString()): string {
  const trade = toTrade(project);
  const template = toScenario(project);
  const input = { trade, taxProfile: project.tax_profile, fxBooks: project.fx_books,
    ...(project.export_date !== undefined ? { today: project.export_date } : {}) };
  const result = analyze({ ...input, scenario: scenarioWithDerivedInclusions(template, trade) });
  const comparison = compare({ ...input, template, anchor: project.anchor });
  const snapshot = serializeProject(project);
  const title = `${project.name || '未命名交易'} · 内部测算报告`;
  const rows = [
    ['商品', project.goods.name], ['数量与单位', `${project.goods.quantity} ${project.goods.unit}`],
    ['货物净价/货值', `${project.goods.trade_value.amount} ${project.goods.trade_value.currency}`],
    ['合同报价', `${project.quote.amount} ${project.quote.currency} · ${project.incoterm}`],
    ['卖方采购成本', String(project.goods.seller_goods_cost.amount).trim() === '' ? '未知，利润无法评估' : `${project.goods.seller_goods_cost.amount} ${project.goods.seller_goods_cost.currency}`],
    ['核算币种', project.base_currency], ['进口申报日期', project.tax_profile.import.declarationDate ?? '未填写'],
    ['比较基准', project.anchor.kind === 'FIXED_QUOTE' ? '固定报价金额' : project.anchor.kind === 'FIXED_MARKET_PRICE' ? `固定买方总支付 ${project.anchor.buyer_total} ${project.anchor.currency}` : `固定目标利润率 ${project.anchor.margin_rate}`],
  ];
  // 报告默认展开依据和待办，避免打印时遗漏未核对内容。
  const output = renderOutputColumn({ result, comparison, error: null }).replace(/<details([^>]*)>/g, '<details$1 open>');
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
<p class="report-help">离线打开即可复核；使用浏览器打印功能可保存PDF。需要查看完整输入时，展开文末输入快照。</p></header>
<section class="panel"><div class="panel-body"><h2 class="panel-heading">生成时的交易输入</h2>
<table class="grid stackable"><tbody>${rows.map(([label = '', value = '']) => `<tr><th>${escapeHtml(label)}</th><td data-label="输入">${escapeHtml(value)}</td></tr>`).join('')}</tbody></table></div></section>
${output}
<section class="panel"><div class="panel-body"><details class="snapshot"><summary>完整项目输入快照（可另存为项目JSON）</summary><pre>${escapeHtml(snapshot)}</pre></details></div></section>
</main></body></html>`;
}
