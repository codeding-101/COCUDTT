import type { AnalysisResult, EnrichedCostItem } from '../engine/analyze.js';
import type { CalculationStep } from '../engine/calculation.js';
import type { ResponsibilitySource } from '../domain/enums.js';
import { COST_CATEGORY_LABELS, OCCURRENCE_REASON_LABELS, TRADE_NODE_LABELS } from '../domain/enums.js';
import { resultCharts, barLength } from '../engine/visualization.js';
import { dec, escapeHtml } from './format.js';

const SOURCES: Record<ResponsibilitySource, string> = {
  USER_OVERRIDE: '本方案人工指定', CONTRACT: '合同条款', OCCURRENCE_REASON: '发生原因',
  INCOTERM_RULE: '术语规则', SPECIAL_CONDITION: '特殊事实', TRADE_NODE: '节点弱推断', UNRESOLVED: '待确认',
};

export function renderCalculationSteps(steps: readonly CalculationStep[]): string {
  return `<ol class="calculation-steps">${steps.map(step => `<li data-calculation="${escapeHtml(step.id)}"><strong>${escapeHtml(step.label)}</strong>
    <p>${escapeHtml(step.formula)}</p><p class="formula">${escapeHtml(step.substitution)} → <b>${step.value === null ? '不适用/无法计算' : escapeHtml(step.value.toString())}</b></p>
    ${step.note ? `<p class="hint block">${escapeHtml(step.note)}</p>` : ''}</li>`).join('')}</ol>`;
}

export function renderItemReasoning(result: AnalysisResult, cost: EnrichedCostItem, aggregation: string): string {
  const item = cost.item;
  const components = result.dutiable_value.components.filter(c => c.cost_id === item.cost_id);
  return `<div class="reasoning" data-reasoning="${escapeHtml(item.cost_id)}">
    <p>输入事实：${result.incoterm} · ${TRADE_NODE_LABELS[item.trade_node]} · ${COST_CATEGORY_LABELS[item.cost_category]} · ${item.occurrence_reason ? OCCURRENCE_REASON_LABELS[item.occurrence_reason] : '发生原因未录入'}</p>
    <ol class="reasoning-steps">${cost.responsibility_trace.map(step => `<li><strong>${SOURCES[step.stage]} · ${step.matched ? '命中' : '未命中'}</strong><p>${escapeHtml(step.detail)}</p>
      ${step.candidates?.length ? `<details class="evidence"><summary>查看本层 ${step.candidates.length} 条候选及条件核对</summary><ul>${step.candidates.map(candidate => `<li><code>${escapeHtml(candidate.id)}</code> · ${candidate.selected ? '最终选择' : candidate.matched ? '符合条件，优先级较低/声明靠后' : '条件不符'}<ul>${candidate.checks.map(check => `<li>${escapeHtml(check)}</li>`).join('')}</ul></li>`).join('')}</ul></details>` : ''}</li>`).join('')}</ol>
    <p>${escapeHtml(cost.note)}</p>
    <p>判定来源：${SOURCES[cost.responsibility_source]}；系统置信度 ${cost.confidence}。${cost.needs_confirmation ? '仍需人工核对；计入金额不代表已确认。' : '未触发此项规则确认标记；来源及其他待办见结果核对。'}</p>
    <p>报价内含：${cost.included_in_quote ? '是' : '否'}（${cost.inclusion_basis === 'DECLARED_LIST' ? '采用本方案非空声明清单' : '声明清单为空，采用费用项标记'}）。${item.contained_in_cost_id ? `父费用：${escapeHtml(item.contained_in_cost_id)}。` : ''}</p>
    <p><strong>汇总去向：${escapeHtml(aggregation)}</strong>。归属判定与汇总去重是独立步骤。</p>
    <p>海关计税：${components.length ? components.map(c => `${escapeHtml(c.label)} ${dec(c.amount)} ${escapeHtml(result.base_currency)}`).join('；') : '不作为独立计税组成；被包含的费用可能由父项体现，不代表法律上免税。'}</p>
    ${result.warnings.filter(w => w.cost_id === item.cost_id && w.level !== 'INFO').map(w => `<p class="hint block">待核对：${escapeHtml(w.message)}</p>`).join('')}
    ${renderCalculationSteps(cost.calculations)}
  </div>`;
}

export function renderExplanations(result: AnalysisResult): string {
  return `<section class="panel"><div class="panel-body"><h3 class="panel-heading">计算过程 · ${escapeHtml(result.base_currency)}</h3>
    <p class="hint block">解释记录版本 ${result.explanation_version}。展开查看本次实际操作数与结果；以下保留引擎精度，金额卡片只展示两位小数。没有用展示值重新计算。税率、来源及适用条件仍需核对。</p>
    ${result.calculations.map(group => `<details class="evidence calculation-group" data-evidence-section="calculation-${group.id}"><summary>${escapeHtml(group.label)}</summary>${renderCalculationSteps(group.steps)}</details>`).join('')}
  </div></section>`;
}

export function renderCostCharts(result: AnalysisResult): string {
  return `<section class="panel"><div class="panel-body"><h3 class="panel-heading">费用与税基可视化 · ${escapeHtml(result.base_currency)}</h3>
    <p class="hint block">${result.decision.ready ? '当前资料通过本轮排名检查。' : '参考测算：仍有待办，图表不表示方案已通过业务核验。'} 条长按各图最大绝对金额缩放，负数标记“冲减”，不是占比图；四张图口径不同，不能相加。</p>
    <div class="cost-charts">${resultCharts(result).map(chart => `<figure class="cost-chart" data-visualization="${chart.id}"><figcaption>${escapeHtml(chart.title)}</figcaption>
      <p class="hint block">${escapeHtml(chart.note)}</p><ul class="chart-rows">${chart.rows.map(row => `<li data-chart-amount="${escapeHtml(row.amount.toString())}"><div class="chart-label"><span>${escapeHtml(row.label)}${row.amount.isNegative() ? '（冲减）' : ''}</span><strong>${dec(row.amount)}</strong></div><div class="chart-track" aria-hidden="true"><span class="chart-bar ${row.kind}${row.amount.isNegative() ? ' negative' : ''}" style="width:${barLength(row.amount, chart.rows)}%"></span></div></li>`).join('') || '<li>无计入费用</li>'}</ul>
      <p class="chart-total">${chart.id === 'responsibility' ? '实际计入双方费用（不含核对值）' : '本图合计'}：<strong>${dec(chart.total)}</strong></p>
    </figure>`).join('')}</div>
  </div></section>`;
}
