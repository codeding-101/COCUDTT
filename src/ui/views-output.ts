import type { Responsibility } from '../domain/enums.js';
import { TRADE_NODE_LABELS } from '../domain/enums.js';
import type { AnalysisResult, EnrichedCostItem } from '../engine/analyze.js';
import type { Comparison, ComparisonColumn } from '../engine/compare.js';
import { dec, escapeHtml, levelLabel, warningClass } from './format.js';

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
  const separation = result.risk.separation ? '<small>风险与费用分离</small>' : '<small>风险与费用同步转移</small>';
  return `
  <section class="panel">
    <div class="hero">
      <div class="cell primary">
        <span>卖方利润（含出口退税）</span>
        <strong>${dec(result.seller.margin)}</strong>
        <small>不含退税 ${dec(result.seller.margin_ex_rebate)} · 报价 ${result.incoterm}</small>
      </div>
      <div class="cell">
        <span>买方总支付</span>
        <strong>${dec(result.buyer.landed_cost_with_tax)}</strong>
        <small>不含可抵扣增值税 ${dec(result.buyer.landed_cost_ex_deductible)}</small>
      </div>
      <div class="cell">
        <span>出口退税</span>
        <strong>${dec(result.seller.rebate_total)}</strong>
        <small>占利润 ${result.seller.margin.isZero() ? '—' : `${dec(result.seller.rebate_total.dividedBy(result.seller.margin).times(100))}%`}</small>
      </div>
      <div class="cell">
        <span>风险转移</span>
        <strong style="font-size:14px;font-weight:600">${escapeHtml(TRADE_NODE_LABELS[result.risk.transfer_node])}</strong>
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
          <div class="row"><span>采购含税成本</span><strong>−${dec(s.goods_cost)}</strong></div>
          <div class="row"><span>出口退税</span><strong>+${dec(s.rebate_total)}</strong></div>
          ${s.rebate_lag_cost.isZero() ? '' : `<div class="row"><span>退税资金占用</span><strong>−${dec(s.rebate_lag_cost)}</strong></div>`}
          <div class="row total"><span>利润</span><strong>${dec(s.margin)}</strong></div>
          <div class="row"><span>其中退税额</span><strong>${dec(s.rebate_total)}</strong></div>
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
          <div class="row"><span>海关完税价格</span><strong>${dec(result.dutiable_value.value)}</strong></div>
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
              <details class="evidence">
                <summary>${enriched.rule_id !== null ? `<code class="rule">${escapeHtml(enriched.rule_id)}</code>` : '查看依据'}</summary>
                <div class="note">${escapeHtml(enriched.note)}</div>
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
      <th class="term">${column.incoterm}</th>
      <td class="num" data-label="报价金额">${dec(column.quote_amount)}</td>
      <td class="num" data-label="承担费用">${dec(column.seller.cost_total)}</td>
      <td class="num${bestMargin}" data-label="卖方利润">
        ${dec(column.seller.margin)}
        <small>不含退税 ${dec(column.seller.margin_ex_rebate)}</small>
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
      </td>
    </tr>`;
  };

  return `
  <section class="panel">
    <div class="panel-body">
      <h3 class="panel-heading">11 术语横向对比</h3>
      <div class="panel-actions" style="margin:0 0 10px">
        <span class="tag accent">基准：${
          comparison.anchor.kind === 'FIXED_QUOTE'
            ? 'A 固定报价金额'
            : comparison.anchor.kind === 'FIXED_MARKET_PRICE'
              ? 'B 固定买方总支付'
              : 'C 固定目标利润率'
        }</span>
        ${
          comparison.best_seller_margin !== null
            ? `<span class="tag seller">卖方利润最优：${comparison.best_seller_margin}</span>`
            : ''
        }
        ${
          comparison.best_buyer_landed !== null
            ? `<span class="tag buyer">买方总支付最低：${comparison.best_buyer_landed}</span>`
            : ''
        }
      </div>
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
        进口税费在 11 个术语下是同一个数——完税价格由货值、运费、保险费构成，与术语无关，改变的只是由谁承担。
        高亮为该列的相对最优值。
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
    </section>`;
  }
  if (state.result === null) {
    return '<section class="panel"><div class="panel-body"><p class="empty">暂无可显示的结果</p></div></section>';
  }
  return `
  ${renderHero(state.result)}
  ${renderBreakdown(state.result)}
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
  const alerts = errors + warns;
  return `
  <div class="kpis">
    <div class="kpi"><span>方案</span><strong>${result.incoterm}</strong></div>
    <div class="kpi profit"><span>卖方利润</span><strong>${dec(result.seller.margin)}</strong></div>
    <div class="kpi"><span>买方总支付</span><strong>${dec(result.buyer.landed_cost_with_tax)}</strong></div>
    <div class="kpi${alerts > 0 ? ' alert' : ' dim'}"><span>提示</span><strong>${alerts}</strong></div>
  </div>`;
}
