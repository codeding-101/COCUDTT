import type { ProjectFile } from '../data/project-file.js';
import type { AnalysisResult } from '../engine/analyze.js';
import type { Comparison } from '../engine/compare.js';
import type { FxRow } from './fx-rows.js';
import { d } from '../domain/decimal.js';
import { dec, escapeHtml as h } from './format.js';
import type { InputSection } from './input-location.js';

export type WorkspaceMode = 'beginner' | 'professional';
export const WORKSPACE_MODE_KEY = 'trade-cost-engine:workspace-mode-v1';
export function loadWorkspaceMode(): WorkspaceMode {
  try { return localStorage.getItem(WORKSPACE_MODE_KEY) === 'professional' ? 'professional' : 'beginner'; }
  catch { return 'beginner'; }
}
export function saveWorkspaceMode(mode: WorkspaceMode): boolean {
  try { localStorage.setItem(WORKSPACE_MODE_KEY, mode); return true; } catch { return false; }
}

export interface WorkspaceIssue { message: string; section: InputSection; path?: string; fxRow?: string; }
/** More than one repair can be shown. These hints never replace engine validation or change inputs. */
export function workspaceIssues(project: ProjectFile, fxRows: readonly FxRow[]): WorkspaceIssue[] {
  const issues: WorkspaceIssue[] = [];
  const numeric = (value: unknown, label: string, path: string, section: InputSection, positive=false): void => {
    const text=String(value??'').trim();
    if (!text) issues.push({message:`${label}未填写`,path,section});
    else if (!/^-?\d+(\.\d+)?$/.test(text)) issues.push({message:`${label}请填纯数字，不带千分位或货币符号`,path,section});
    else if (positive && d(text).lte(0)) issues.push({message:`${label}必须大于零`,path,section});
  };
  numeric(project.goods.quantity,'商品数量','goods.quantity','goods',true);
  numeric(project.goods.trade_value.amount,'成交货值','goods.trade_value.amount','goods');
  const china=project.tax_profile.import.calculationMode==='CN_GENERAL_TRADE';
  if (!china || String(project.goods.seller_goods_cost.amount).trim()) numeric(project.goods.seller_goods_cost.amount,'卖方采购成本','goods.seller_goods_cost.amount','goods');
  if (project.anchor.kind!=='ACTUAL_QUOTES') numeric(project.quote.amount,'报价金额','quote.amount','quote');
  if (project.anchor.kind==='FIXED_MARGIN_RATE') {
    numeric(project.anchor.margin_rate,'目标毛利率','anchor.margin_rate','quote');
    const text=String(project.anchor.margin_rate).trim();
    if (/^-?\d+(\.\d+)?$/.test(text)&&(d(text).lte(0)||d(text).gte(1))) issues.push({message:'目标毛利率应大于0且小于1，例如0.2表示20%','path':'anchor.margin_rate',section:'quote'});
  }
  if (china && !project.tax_profile.import.declarationDate?.trim()) issues.push({message:'中国进口申报日期未填写',path:'tax_profile.import.declarationDate',section:'import-tax'});
  for (const row of fxRows) {
    const value=row.rate.trim();
    if (value && /^-?\d+(\.\d+)?$/.test(value) && d(value).lte(0)) issues.push({message:`${row.from}/${row.to} ${row.type}汇率必须大于零`,section:'fx',fxRow:row.row_id});
  }
  return issues;
}

export function renderModeSwitch(mode: WorkspaceMode): string {
  return `<div class="mode-switch" role="group" aria-label="界面模式"><button data-action="mode-beginner" aria-pressed="${mode==='beginner'}">新手模式</button><button data-action="mode-professional" aria-pressed="${mode==='professional'}">专业模式</button></div>`;
}
export function renderQuickStart(project: ProjectFile, note: string): string {
  return `<section class="quick-start" aria-labelledby="quick-start-title"><div class="workspace-heading"><div><p class="eyebrow">TRADE COST WORKSPACE</p><h1 id="quick-start-title">交易成本测算</h1><p>${h(note)}</p></div><span class="workspace-scope">${h(project.incoterm)} · ${project.tax_profile.import.calculationMode==='CN_GENERAL_TRADE'?'中国一般贸易进口':'通用成本口径'}</span></div>
    <div class="start-options"><button data-action="new-china-blank">中国进口 · 开始录入</button><button data-action="new-china-import">中国进口 · 合成示例</button><button data-action="new">CIF · 运保演示</button></div>
    <p class="workspace-footnote">载入会替换当前交易，请先保存。示例使用虚构假设；录入报价与货物净价是两个不同金额，含运保费整价请先拆分。</p>
    <ol class="workspace-steps"><li><span>01</span> 填交易与商品</li><li><span>02</span> 选报价与方案</li><li><span>03</span> 看结果、核对依据</li></ol></section>`;
}
export interface WorkspaceResult {
  project: ProjectFile; result: AnalysisResult|null; comparison: Comparison|null; error: string|null;
  issues: readonly WorkspaceIssue[]; calculatedAt: string; mode: WorkspaceMode;
}
export function renderCalculationStatus(state: WorkspaceResult): string {
  const blocked=state.error!==null||state.result===null;
  return `<div class="calculation-status ${blocked?'is-blocked':state.result!.decision.ready?'is-complete':'is-reference'}" role="status" aria-live="polite"><strong data-calculation-status>${blocked?'无法计算':state.result!.decision.ready?'计算完成':'计算完成 · 参考测算'}</strong><span>${h(state.project.base_currency)} · 更新于 ${h(state.calculatedAt)}</span></div>`;
}
export function renderWorkspaceSummary(state: WorkspaceResult): string {
  const r=state.result;
  if(state.error!==null||!r) return `<section class="workspace-summary is-blocked" aria-labelledby="workspace-result-title"><div class="workspace-heading"><h2 id="workspace-result-title">先补全这些输入</h2><span>无法计算</span></div><p>输入保留在原处。修正后会自动重算，不沿用上次结果。</p>
    ${state.issues.length?`<ul class="workspace-issues">${state.issues.map((issue,i)=>`<li><button data-action="locate-workspace-issue" data-issue-index="${i}">${h(issue.message)} →</button></li>`).join('')}</ul>`:''}
    <p class="engine-failure">${h(state.error??'暂无可显示的结果')}</p><button data-action="show-full-results">查看完整错误说明与修正入口</button></section>`;
  return `<section class="workspace-summary" aria-labelledby="workspace-result-title"><div class="workspace-heading"><div><p class="eyebrow">CURRENT CALCULATION</p><h2 id="workspace-result-title">${h(r.incoterm)} · 当前录入报价的测算</h2></div><span class="workspace-currency">核算币种 ${h(r.base_currency)}</span></div>
    <div class="workspace-result-values"><div><span>卖方利润</span><strong>${r.seller.margin===null?'无法评估':dec(r.seller.margin)}</strong><small>${r.seller.margin===null?'采购成本未知，买方测算可继续':r.rebate.applicable===false?'未计境外税务':'含中国出口退税测算'}</small></div><div><span>买方总支付</span><strong>${dec(r.buyer.landed_cost_with_tax)}</strong><small>不含可抵扣增值税 ${dec(r.buyer.landed_cost_ex_deductible)}</small></div></div>
    <div class="profit-strip"><span>报价收入 <b>${dec(r.seller.revenue)}</b></span><span>− 承担费用 <b>${dec(r.seller.cost_total)}</b></span><span>− 采购成本 <b>${r.seller.goods_cost===null?'未知':dec(r.seller.goods_cost)}</b></span><span>+ 出口退税 <b>${r.rebate.applicable===false?'不适用':dec(r.seller.rebate_total)}</b></span>${r.seller.rebate_lag_cost.isZero()?'':`<span>− 退税资金占用 <b>${dec(r.seller.rebate_lag_cost)}</b></span>`}</div>
    <p class="workspace-result-note">${r.decision.ready?'通过当前程序检查，仍需按合同与实际业务核实。':`参考测算：还有 ${r.decision.issues.length} 项待核对；金额可查看，不代表已通过业务核验。`}${state.project.anchor.kind==='FIXED_MARGIN_RATE'||state.project.anchor.kind==='FIXED_MARKET_PRICE'?' 当前卡片使用录入报价；目标基准的反推结果请查看完整方案对比。':''}</p><button data-action="show-full-results">查看完整计算过程与方案对比 →</button></section>`;
}

/** Open every containing disclosure so a repair never focuses an invisible control. */
export function revealWorkspaceElement(element: HTMLElement): void {
  for(let parent=element.parentElement;parent;parent=parent.parentElement) if(parent.tagName==='DETAILS') (parent as HTMLDetailsElement).open=true;
  element.focus({preventScroll:true});element.scrollIntoView({block:'center',behavior:'smooth'});
}
export function focusWorkspaceIssue(issue: WorkspaceIssue): boolean {
  const element=[...document.querySelectorAll<HTMLElement>('[data-path],[data-fx-field]')].find(el=>issue.path!==undefined?el.dataset.path===issue.path:issue.fxRow!==undefined&&el.dataset.fx===issue.fxRow&&el.dataset.fxField==='rate');
  if(!element)return false;revealWorkspaceElement(element);return true;
}
