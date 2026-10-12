import type { Responsibility } from '../domain/enums.js';
import { TRADE_NODE_LABELS } from '../domain/enums.js';
import type { AnalysisResult, EnrichedCostItem } from '../engine/analyze.js';
import type { Comparison, ComparisonColumn } from '../engine/compare.js';
import { dec, escapeHtml, levelLabel, warningClass } from './format.js';
import { SOURCE_STATUS_LABELS } from './source-editor.js';
import { DELIVERY_EVENT_LABELS } from '../domain/logistics.js';
import { CARRIAGE_MODE_LABELS } from '../domain/enums.js';
import { renderExplanations, renderItemReasoning, renderCostCharts } from './result-explanation.js';

function renderLogistics(result: AnalysisResult): string {
  const { transport, insurance, container_reminders } = result.logistics;
  if (!transport && !insurance.configured && !container_reminders.length) return '';
  return `<section class="panel"><div class="panel-body"><h3 class="panel-heading">运输风险与保险核对</h3>
    <p class="hint block">运输与保险资料核对版本 ${result.logistics.version}，不替代合同及保单专业复核。</p>
    ${transport ? `<p class="hint block">${transport.confirmed && !result.risk.needs_confirmation ? '交货事实通过当前人工记录检查' : '运输/交货资料仍待核对'}。仅标记一次交货风险转移；换段不重置风险，费用按明细独立计算。</p>
      <ol class="transport-flow">${transport.plan.segments.map((segment, n) => `<li${n === transport.delivery_index ? ' class="transfer"' : ''}><strong>${escapeHtml(segment.from || '起点待填')} → ${escapeHtml(segment.to || '终点待填')}</strong><span>${CARRIAGE_MODE_LABELS[segment.mode]} · ${escapeHtml(segment.carrier || '承运人未填')}</span>
        ${n === transport.delivery_index ? `<p data-risk-event>${transport.confirmed ? '录入交货点' : '待核对交货点'}：${escapeHtml(transport.plan.delivery_location)} · ${DELIVERY_EVENT_LABELS[transport.plan.delivery_event]}（${transport.plan.delivery_at === 'ORIGIN' ? '该段起点' : '该段终点'}）</p>` : ''}</li>`).join('')}</ol>
      <p>卖方运费支付终点：${escapeHtml(transport.plan.paid_to || '未填/无运输义务')}</p>` : ''}
    ${insurance.configured ? `<p>保险保障：${escapeHtml(insurance.cover)}；${insurance.issues.length ? '仍待核对' : '通过当前资料检查，非保单认证'}。录入保额 ${escapeHtml(insurance.sum_insured)} ${escapeHtml(insurance.sum_insured_currency)}。</p>
      ${insurance.required && insurance.minimum_amount ? `<p class="hint block">按原合同价 ${escapeHtml(insurance.contract_amount)} ${escapeHtml(insurance.currency)} 计算110%基线，最低参考保额（展示向上到分）${insurance.minimum_amount.toFixed(2, 0)} ${escapeHtml(insurance.currency)}；保障区间 ${escapeHtml(insurance.insured_from)} → ${escapeHtml(insurance.insured_to)}。保额不计入成本或税基，保费仍在费用明细单独计算。</p>` : ''}` : ''}
    ${container_reminders.length ? `<h4>集装箱费用提醒</h4><ul class="decision-issues">${container_reminders.map(text => `<li>${escapeHtml(text)}</li>`).join('')}</ul>` : ''}
  </div></section>`;
}

function sourceReference(reference: string): string {
  try {
    const url = new URL(reference);
    if (url.protocol === 'https:' || url.protocol === 'http:') return `<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(reference)}</a>`;
  } catch { /* 合同编号等文本来源原样展示 */ }
  return escapeHtml(reference || '未填写');
}

function sellerProfit(value: AnalysisResult['seller']['margin']): string {
  return value === null ? '无法评估' : dec(value);
}

function renderDecisionCheck(result: AnalysisResult): string {
  const decision = result.decision;
  return `<section class="panel"><div class="panel-body">
    <h3 class="panel-heading">结果核对 · ${decision.ready ? '符合当前排名检查条件' : '参考测算，仍待核对'}</h3>
    ${decision.context.map(line => `<p class="hint block">${escapeHtml(line)}</p>`).join('')}
    <p class="hint block">${decision.ready ? '当前未发现本轮检查覆盖的数据来源或费用问题。' : `还有 ${decision.issues.length} 条未完成事项；当前方案不参与最优排名，金额保留供核对。`} 用户核对记录不等于程序或海关认证，未覆盖的业务条件仍需人工确认。</p>
    ${decision.issues.length ? `<details class="evidence"><summary>查看待核对原因</summary><ul class="decision-issues">${decision.issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join('')}</ul></details>` : ''}
    ${decision.sources.length ? `<details class="evidence"><summary>查看本次使用的 ${decision.sources.length} 项来源记录</summary>
      <table class="grid stackable source-table"><thead><tr><th>数据</th><th>状态</th><th>来源</th><th>来源适用期</th><th>核对日期</th></tr></thead><tbody>
      ${decision.sources.map((source) => `<tr>
        <td data-label="数据">${escapeHtml(source.label)}<small>核算日期 ${escapeHtml(source.applicable_date)}</small></td>
        <td data-label="状态">${source.evidence ? SOURCE_STATUS_LABELS[source.evidence.status] : '无记录'}${source.issues.length ? '<small>待核对</small>' : ''}</td>
        <td data-label="来源">${sourceReference(source.evidence?.reference ?? '')}</td>
        <td data-label="适用期">${escapeHtml(source.evidence?.valid_from || '未填')} ～ ${escapeHtml(source.evidence?.valid_to || '未填')}</td>
        <td data-label="核对日期">${escapeHtml(source.evidence?.checked_on || '未填')}</td>
      </tr>`).join('')}
      </tbody></table></details>` : ''}
  </div></section>`;
}

export interface OutputState {
  result: AnalysisResult | null;
  comparison: Comparison | null;
  error: string | null;
}

function responsibilityTag(responsibility: Responsibility): string {
  if (responsibility === 'SELLER') return '<span class="tag seller">卖方</span>';
  if (responsibility === 'BUYER') return '<span class="tag buyer">买方</span>';
  if (responsibility === 'CONDITIONAL') return '<span class="tag conditional">待确认</span>';
  return '<span class="tag muted">共担</span>';
}

function exclusionLabel(exclusion: EnrichedCostItem['exclusion']): string {
  switch (exclusion) {
    case 'CONTAINED_IN_PARENT':
      return '已含在另一笔费用内';
    case 'INCLUDED_IN_QUOTE':
      return '已含于报价，不重复计费';
    case 'GOODS_VALUE':
      return '货物价值，由采购成本代表';
    case 'SHARED_NOT_SPLIT':
      return '双方共担，未拆分';
    case 'CONDITIONAL_UNRESOLVED':
      return '归属待确认，未计入任何一方';
    case null:
      return '';
  }
}

function rowClass(responsibility: Responsibility): string {
  return responsibility === 'SELLER'
    ? 'resp-seller'
    : responsibility === 'BUYER'
      ? 'resp-buyer'
      : 'resp-conditional';
}

/** 结论区：先给答案，再给过程 */
function renderHero(result: AnalysisResult): string {
  const separation = result.risk.needs_confirmation ? '<small>请核对交货条件</small>' : result.risk.separation ? '<small>风险与费用分离</small>' : '<small>风险按交货条件转移</small>';
  return `
  <section class="panel">
    <div class="hero">
      <div class="cell primary">
        <span>${result.rebate.applicable === false ? '卖方利润（未计境外税务）' : '卖方利润（含出口退税）'}</span>
        <strong>${sellerProfit(result.seller.margin)}</strong>
        <small>${result.seller.margin === null ? '卖方采购成本未知，买方测算可继续' : result.rebate.applicable === false ? '卖方成本需自行核实' : `不含退税 ${dec(result.seller.margin_ex_rebate)}`} · 报价 ${result.incoterm}</small>
      </div>
      <div class="cell">
        <span>买方总支付</span>
        <strong>${dec(result.buyer.landed_cost_with_tax)}</strong>
        <small>不含可抵扣增值税 ${dec(result.buyer.landed_cost_ex_deductible)}</small>
      </div>
      <div class="cell">
        <span>出口退税</span>
        <strong>${result.rebate.applicable === false ? '不适用' : dec(result.seller.rebate_total)}</strong>
        <small>${result.rebate.applicable === false ? '中国进口场景' : `占利润 ${result.seller.margin === null || result.seller.margin.isZero() ? '—' : `${dec(result.seller.rebate_total.dividedBy(result.seller.margin).times(100))}%`}`}</small>
      </div>
      <div class="cell">
        <span>风险转移</span>
        <strong style="font-size:14px;font-weight:600">${result.risk.needs_confirmation ? '交货地点待确认' : escapeHtml(TRADE_NODE_LABELS[result.risk.transfer_node])}</strong>
        ${separation}
      </div>
    </div>
  </section>`;
}

function renderBreakdown(result: AnalysisResult): string {
  const s = result.seller;
  const b = result.buyer;
  return `
  <section class="panel">
    <div class="panel-body">
      <div class="summary">
        <div class="card seller">
          <h3>卖方成本与利润</h3>
          <div class="row"><span>报价收入</span><strong>${dec(s.revenue)}</strong></div>
          <div class="row"><span>承担费用</span><strong>−${dec(s.cost_total)}</strong></div>
          <div class="row"><span>采购含税成本</span><strong>${s.goods_cost === null ? '未知' : `−${dec(s.goods_cost)}`}</strong></div>
          <div class="row"><span>中国出口退税</span><strong>${result.rebate.applicable === false ? '不适用' : `+${dec(s.rebate_total)}`}</strong></div>
          ${s.rebate_lag_cost.isZero() ? '' : `<div class="row"><span>退税资金占用</span><strong>−${dec(s.rebate_lag_cost)}</strong></div>`}
          <div class="row total"><span>利润</span><strong>${sellerProfit(s.margin)}</strong></div>
          ${result.rebate.applicable === false ? `<p class="hint block">${escapeHtml(result.rebate.basis_rule)}</p>` : `<div class="row"><span>其中退税额</span><strong>${dec(s.rebate_total)}</strong></div>`}
        </div>
        <div class="card buyer">
          <h3>买方落地成本</h3>
          <div class="row"><span>报价金额</span><strong>${dec(b.quote_amount)}</strong></div>
          <div class="row"><span>报价外费用</span><strong>+${dec(b.additional_cost_total.minus(b.duty_total).minus(b.consumption_tax_total).minus(b.vat_total))}</strong></div>
          <div class="row"><span>进口关税</span><strong>+${dec(b.duty_total)}</strong></div>
          <div class="row"><span>进口消费税</span><strong>+${dec(b.consumption_tax_total)}</strong></div>
          <div class="row"><span>进口增值税</span><strong>+${dec(b.vat_total)}</strong></div>
          <div class="row total"><span>落地成本（含税）</span><strong>${dec(b.landed_cost_with_tax)}</strong></div>
          <div class="row"><span>不含可抵扣增值税</span><strong>${dec(b.landed_cost_ex_deductible)}</strong></div>
        </div>
        <div class="card">
          <h3>计税与风险</h3>
          <p class="hint block">费用规则：${escapeHtml(result.rule_set.id)} · 实现版本 ${escapeHtml(result.rule_set.version)}（需结合合同核对）</p>
          <div class="row"><span>海关计税价格</span><strong>${dec(result.dutiable_value.value)}</strong></div>
          ${result.import_tax.calculation_mode === 'CN_GENERAL_TRADE' ? '<p class="hint block">中国一般贸易进口 · CNY 计税 · 税款舍入至分</p>' : ''}
          ${result.import_tax.calculation_mode === 'CN_GENERAL_TRADE' ? result.dutiable_value.components.map((component) => `<div class="row"><span>${escapeHtml(component.label)}</span><strong>${dec(component.amount)}</strong></div>`).join('') : ''}
          <div class="row"><span>关税税率</span><strong>${dec(result.import_tax.duty_rate, 4)}</strong></div>
          <div class="row"><span>增值税率</span><strong>${dec(result.import_tax.vat_rate, 4)}</strong></div>
          <div class="row"><span>风险转移点</span><strong style="font-weight:500">${escapeHtml(result.risk.transfer_point)}</strong></div>
          ${result.risk.separation_note !== null ? `<p class="hint block">${escapeHtml(result.risk.separation_note)}</p>` : ''}
        </div>
      </div>
    </div>
  </section>`;
}

function renderWarnings(result: AnalysisResult): string {
  const errors = result.warnings.filter((warning) => warning.level === 'ERROR');
  const warns = result.warnings.filter((warning) => warning.level === 'WARN');
  const infos = result.warnings.filter((warning) => warning.level === 'INFO');
  if (result.warnings.length === 0) return '';

  const list = (items: typeof result.warnings): string =>
    `<ul class="warnings">${items
      .map(
        (warning) => `<li>
        <span class="level ${warningClass(warning.level)}">${levelLabel(warning.level)}</span>
        <span><code>${escapeHtml(warning.code)}</code> ${escapeHtml(warning.message)}</span>
      </li>`,
      )
      .join('')}</ul>`;

  return `
  <section class="panel">
    <div class="panel-body">
      <h3 style="margin:0 0 8px;font-size:12px;color:var(--muted)">
        校验与提示 · 错误 ${errors.length} · 提示 ${warns.length} · 说明 ${infos.length}
      </h3>
      ${errors.length > 0 ? `<div class="banner error"><div><strong>有阻断性错误</strong>${list(errors)}</div></div>` : ''}
      ${warns.length > 0 ? list(warns) : ''}
      ${infos.length > 0 ? list(infos) : ''}
    </div>
  </section>`;
}

function renderItemDetail(result: AnalysisResult): string {
  return `
  <section class="panel">
    <div class="panel-body">
      <h3 class="panel-heading">逐项明细</h3>
      ${result.inactive_items.length ? `<details class="evidence"><summary>本方案未启用 ${result.inactive_items.length} 项费用</summary><ul>${result.inactive_items.map(item => `<li>${escapeHtml(item.cost_name)} · 适用：${item.applicable_incoterms?.length ? escapeHtml(item.applicable_incoterms.join('、')) : '不启用'}${item.alternative_group ? ` · 替代报价组：${escapeHtml(item.alternative_group)}` : ''} · 未解析金额，未计入税基与汇总</li>`).join('')}</ul></details>` : ''}
      <table class="grid stackable">
        <thead>
          <tr>
            <th>费用</th><th>节点</th><th class="num">核算金额</th>
            <th>归属</th><th>汇总处理</th><th>归属依据</th>
          </tr>
        </thead>
        <tbody>
          ${result.items
            .map(
              (enriched) => `<tr>
            <td class="nowrap" data-label="费用">${escapeHtml(enriched.item.cost_name)}</td>
            <td class="nowrap" data-label="节点">${TRADE_NODE_LABELS[enriched.item.trade_node]}</td>
            <td class="num" data-label="核算金额">
              ${dec(enriched.base_amount)}
              <small>${dec(enriched.gross_amount)} ${escapeHtml(enriched.item.currency)}</small>
            </td>
            <td class="nowrap ${rowClass(enriched.responsibility)}" data-label="归属">${responsibilityTag(enriched.responsibility)}</td>
            <td class="nowrap" data-label="汇总处理">${
              enriched.exclusion !== null
                ? `<span class="tag muted">${escapeHtml(exclusionLabel(enriched.exclusion))}</span>`
                : enriched.counts_to_seller
                  ? '<span class="tag seller">计入卖方</span>'
                  : enriched.counts_to_buyer
                    ? '<span class="tag buyer">计入买方</span>'
                    : '<span class="tag muted">未计入</span>'
            }</td>
            <td data-label="归属依据">
              <details class="evidence" data-evidence-section="reasoning-${escapeHtml(enriched.item.cost_id)}">
                <summary>${enriched.rule_id !== null ? `<code class="rule">${escapeHtml(enriched.rule_id)}</code>` : '查看依据'}</summary>
                ${renderItemReasoning(result, enriched, exclusionLabel(enriched.exclusion) || (enriched.counts_to_seller ? '计入卖方费用' : enriched.counts_to_buyer ? '计入买方报价外费用' : '未计入汇总'))}
                ${
                  enriched.fx !== null
                    ? `<div class="note">汇率：${escapeHtml(
                        `${enriched.fx.from}→${enriched.fx.to} ${enriched.fx.rate.toFixed(6)}（${enriched.fx.source}${enriched.fx.book_id !== null ? ` · ${enriched.fx.book_id}` : ''}）`,
                      )}</div>`
                    : ''
                }
              </details>
            </td>
          </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>
  </section>`;
}

function renderComparison(comparison: Comparison): string {
  const bestSeller = comparison.best_seller_margin;
  const bestBuyer = comparison.best_buyer_landed;

  /** 每个术语一行：把"变化的维度"放在行上，行是廉价的轴，列是昂贵的轴 */
  const row = (column: ComparisonColumn): string => {
    if (!column.available) {
      return `<tr class="unavailable">
        <th>${column.incoterm}</th>
        <td colspan="7" data-label="说明"><span class="hint">${escapeHtml(column.unavailable_reason ?? '不适用当前运输方式')}</span></td>
      </tr>`;
    }
    if (!column.feasible) {
      return `<tr class="unavailable">
        <th>${column.incoterm}</th>
        <td colspan="7" data-label="说明"><span class="hint">${escapeHtml(column.infeasible_reason ?? '该基准下不可行')}</span></td>
      </tr>`;
    }
    const bestMargin = column.incoterm === bestSeller ? ' best' : '';
    const bestLanded = column.incoterm === bestBuyer ? ' best' : '';
    return `<tr>
      <th class="term">${column.incoterm}<small>${column.decision_ready ? '可参与排名' : '参考测算'}</small></th>
      <td class="num" data-label="报价金额">${dec(column.quote_amount)}</td>
      <td class="num" data-label="承担费用">${dec(column.seller.cost_total)}</td>
      <td class="num${bestMargin}" data-label="卖方利润">
        ${sellerProfit(column.seller.margin)}
        <small>${column.seller.margin === null ? '采购成本未知，不参与利润排名' : `不含退税 ${dec(column.seller.margin_ex_rebate)}`}</small>
      </td>
      <td class="num${bestLanded}" data-label="买方总支付">
        ${dec(column.buyer.landed_cost_with_tax)}
        <small>不含可抵扣税 ${dec(column.buyer.landed_cost_ex_deductible)}</small>
      </td>
      <td class="num" data-label="买方报价外费用">
        ${dec(column.buyer.additional_cost_total)}
        <small>其中进口税费 ${dec(column.import_tax_total)}</small>
      </td>
      <td data-label="风险转移点">${escapeHtml(TRADE_NODE_LABELS[column.transfer_node])}${
        column.risk_separation ? ' <span class="tag muted">分离</span>' : ''
      }</td>
      <td class="num" data-label="承担范围与告警">
        ${column.seller_cost_items} 项
        <small>${column.seller_cost_nodes} 个节点 · ${column.conditional_count} 待确认 · ${column.warning_count} 告警</small>
        ${column.decision_issues.length ? `<details class="evidence"><summary>待核对原因</summary><ul class="decision-issues">${column.decision_issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join('')}</ul></details>` : ''}
      </td>
    </tr>`;
  };

  return `
  <section class="panel">
    <div class="panel-body">
      <h3 class="panel-heading">11 术语横向对比</h3>
      <div class="panel-actions" style="margin:0 0 10px">
        <span class="tag accent">基准：${
          comparison.anchor.kind === 'ACTUAL_QUOTES'
            ? '各方案实际报价'
            : comparison.anchor.kind === 'FIXED_QUOTE'
            ? 'A 固定报价金额'
            : comparison.anchor.kind === 'FIXED_MARKET_PRICE'
              ? 'B 固定买方总支付'
              : 'C 固定目标利润率'
        }</span>
        ${
          comparison.best_seller_margin !== null
            ? `<span class="tag seller">可排名方案中卖方利润最高：${comparison.best_seller_margin}</span>`
            : ''
        }
        ${
          comparison.best_buyer_landed !== null
            ? `<span class="tag buyer">可排名方案中买方总支付最低：${comparison.best_buyer_landed}</span>`
            : ''
        }
      </div>
      ${comparison.best_seller_margin === null && comparison.best_buyer_landed === null ? '<p class="hint block">当前没有可参与排名的方案，请先核对来源、补全费用归属或解决错误。</p>' : ''}
      <table class="grid compare stackable">
        <thead>
          <tr>
            <th>术语</th>
            <th class="num">报价金额</th>
            <th class="num">承担费用</th>
            <th class="num">卖方利润</th>
            <th class="num">买方总支付</th>
            <th class="num">报价外费用</th>
            <th>风险转移点</th>
            <th class="num">卖方承担</th>
          </tr>
        </thead>
        <tbody>
          ${comparison.columns.map(row).join('')}
        </tbody>
      </table>
      <p class="hint block">
        ${comparison.anchor.kind === 'ACTUAL_QUOTES' ? '本次采用独立合同报价，各方案按启用费用重新核算。缺失报价不计算；报价有效期按合同比较日期核对。商品净价仍是共同输入，若各报价的净价或商品范围不同，请分项目测算。' : comparison.uses_scenario_costs ? '本次按适用术语启用费用，各方案重新计算税基与税额，运价差异会影响进口税费。替代报价组不得同时启用两项；固定报价仍假设各术语报价金额相同，请核对比较基准。' : '本次比较固定交易费用、计税价格和税率。在这些假设内，各术语进口税费相同，承担方不同；真实价格或费用变化时应重新核算。'}
        高亮仅比较可参与排名的方案。来源仍待核对、税基不完整或存在未计入成本的费用时，保留参考金额并排除排名。
      </p>
    </div>
  </section>`;
}

export function renderOutputColumn(state: OutputState): string {
  if (state.error !== null) {
    return `
    <section class="panel">
      <div class="panel-body">
        <div class="banner error">
          <div>
            <strong>无法计算：输入不足以得出结果</strong>
            <div style="margin-top:4px">${escapeHtml(state.error)}</div>
          </div>
        </div>
        <p class="hint block">引擎不会在缺数据时猜一个结果。请按提示补全输入——常见原因是缺少对应类型的汇率簿，或费用项缺少计费参数。</p>
      </div>
    </section>${state.comparison !== null ? renderComparison(state.comparison) : ''}`;
  }
  if (state.result === null) {
    return '<section class="panel"><div class="panel-body"><p class="empty">暂无可显示的结果</p></div></section>';
  }
  return `
  ${renderDecisionCheck(state.result)}
  ${renderLogistics(state.result)}
  ${renderHero(state.result)}
  ${renderBreakdown(state.result)}
  ${renderCostCharts(state.result)}
  ${renderExplanations(state.result)}
  ${renderWarnings(state.result)}
  <div class="result-tables">
    ${renderItemDetail(state.result)}
    ${state.comparison !== null ? renderComparison(state.comparison) : ''}
  </div>`;
}

/** 顶栏关键数字：录入时始终可见，改一个数字立刻看到结果变化 */
export function renderKpis(state: OutputState): string {
  if (state.error !== null) {
    return `<div class="kpis"><div class="kpi alert"><span>状态</span><strong>无法计算</strong></div></div>`;
  }
  if (state.result === null) return '';
  const result = state.result;
  const errors = result.warnings.filter((warning) => warning.level === 'ERROR').length;
  const warns = result.warnings.filter((warning) => warning.level === 'WARN').length;
  const alerts = new Set([
    ...result.warnings.filter((warning) => warning.level === 'ERROR' || warning.level === 'WARN').map((warning) => warning.message),
    ...result.decision.issues,
  ]).size;
  return `
  <div class="kpis">
    <div class="kpi"><span>${result.decision.ready ? '方案' : '参考方案'}</span><strong>${result.incoterm}</strong></div>
    <div class="kpi profit"><span>卖方利润</span><strong>${sellerProfit(result.seller.margin)}</strong></div>
    <div class="kpi"><span>买方总支付</span><strong>${dec(result.buyer.landed_cost_with_tax)}</strong></div>
    <div class="kpi${alerts > 0 ? ' alert' : ' dim'}"><span>提示</span><strong>${alerts}</strong></div>
  </div>`;
}
