import type {AnalysisResult, EnrichedCostItem} from '../engine/analyze.js';
import type {CalculationStep} from '../engine/calculation.js';
import type {FxResolution} from '../engine/fx.js';
import {FX_TYPE_LABELS, PRICING_METHOD_LABELS} from '../domain/enums.js';
import type {ExclusionReason} from '../engine/inclusion.js';
import {escapeHtml as h} from './format.js';
import {revealWorkspaceElement} from './workspace.js';

const FX_SOURCE:Record<FxResolution['source'],string>={IDENTITY:'同币种，无需换算',ITEM:'费用项显式汇率',DESIGNATED_BOOK:'方案指定汇率簿',BOOK:'按类型选择汇率簿'};
const EXCLUSION:Record<ExclusionReason,string>={CONTAINED_IN_PARENT:'已含于父费用',INCLUDED_IN_QUOTE:'已含于报价',GOODS_VALUE:'货值行，采购成本单独处理',SHARED_NOT_SPLIT:'共同承担尚未拆分',CONDITIONAL_UNRESOLVED:'承担条件未决'};
const CHARTS=['responsibility','seller-fees','buyer-payment','customs-base'] as const;

/** Display only the resolution the engine actually used; never resolve against newer inputs. */
export function renderLearningFx(fx:FxResolution|null|undefined):string{
 if(!fx)return '<p class="hint">此记录没有独立汇率解析；不补设汇率1。派生税额直接使用计税结果，其他情况请查看原公式说明。</p>';
 return `<div class="learning-fx"><p><strong>1 ${h(fx.from)} = ${h(fx.rate.toString())} ${h(fx.to)}</strong> · ${h(FX_TYPE_LABELS[fx.fx_type])}</p><p>${FX_SOURCE[fx.source]}${fx.book_id!==null?` · 簿编号 ${h(fx.book_id)}`:''}${fx.fx_date!==null?` · 解析日期 ${h(fx.fx_date)}`:''}${fx.inverted?' · 采用反向报价解析结果':''}</p>${fx.evidence?`<p>来源文字（不代表已核对）：${h(fx.evidence.reference)}</p>`:''}</div>`;
}
function recordedSteps(steps:readonly CalculationStep[],currency:string):string{
 return `<ol class="learning-steps">${steps.map(step=>`<li data-learning-step="${h(step.id)}"><strong>${h(step.label)}</strong><p>${h(step.formula)}</p><p class="learning-equation">${h(step.substitution)} → <b>${step.value===null?'不适用／无法计算':`${h(step.value.toString())} ${h(currency)}`}</b></p>${step.note?`<p class="hint">${h(step.note)}</p>`:''}</li>`).join('')}</ol>`;
}
function nav(kind:'reason'|'chart'|'group',id:string,label:string):string{return `<button type="button" data-action="learning-target" data-learning-kind="${kind}" data-learning-id="${h(id)}">${h(label)} →</button>`;}
function destination(cost:EnrichedCostItem):string{
 if(cost.exclusion!==null)return `未计入双方费用汇总：${EXCLUSION[cost.exclusion]}`;
 return cost.counts_to_seller?'计入卖方承担费用':cost.counts_to_buyer?'计入买方报价外费用':'未计入双方费用汇总，请核对承担条件';
}
/** A read-only teaching view. All amounts and expressions come from the supplied analysis. */
export function renderCalculationLearning(result:AnalysisResult|null,error:string|null):string{
 if(error!==null||!result)return '';
 const totals=result.calculations.find(group=>group.id==='totals');
 return `<details class="panel calculation-learning" data-evidence-section="calculation-learning"><summary><span class="panel-title">读懂本次计算</span><span class="hint">原币、汇率、计入范围与实际公式</span></summary><div class="panel-body">
  <p class="learning-scope">${h(result.incoterm)} · 本页当前录入报价的测算 · 核算币种 ${h(result.base_currency)}</p><p class="hint">以下直接展示本次引擎记录，保留计算精度；卡片两位小数仅作展示。目标毛利率或买方支付基准的反推、各术语实际合同报价比较在完整方案对比中查看，不能与当前结果混用。</p>
  <p class="hint">${result.decision.ready?'通过当前程序检查，仍需核实实际合同与资料。':'当前仍有待核对事项，以下为参考测算，不代表业务核验通过。'}</p>
  <details class="evidence" data-evidence-section="learning-totals"><summary>1. 报价如何形成利润与买方支付</summary>${totals?recordedSteps(totals.steps,result.base_currency):'<p>本次未提供汇总公式记录，不补造算式。</p>'}<div class="panel-actions">${nav('group','totals','查看原汇总公式')}${nav('chart','buyer-payment','查看买方支付图')}</div></details>
  <details class="evidence" data-evidence-section="learning-costs"><summary>2. 逐笔费用：原币 → 核算 → 汇总</summary><p class="hint">原币计价结果可能已经过引擎精度处理；固定／实际金额的原始输入另列。金额有值不等于计入成本，费用承担、报价包含、父项包含与海关加计分别核对。</p>
   <div class="learning-cost-list">${result.items.map(cost=>`<details class="learning-cost" data-evidence-section="learning-cost-${h(cost.item.cost_id)}" data-learning-cost="${h(cost.item.cost_id)}"><summary>${h(cost.item.cost_name)} <small>${h(cost.item.cost_id)}</small></summary><div class="learning-cost-body"><dl><div><dt>原币计价结果</dt><dd>${h(cost.gross_amount.toString())} ${h(cost.item.currency)}</dd></div><div><dt>核算金额</dt><dd>${h(cost.base_amount.toString())} ${h(result.base_currency)}</dd></div><div><dt>计价方式</dt><dd>${h(PRICING_METHOD_LABELS[cost.item.pricing_method])}</dd></div></dl>${['FIXED','ACTUAL'].includes(cost.item.pricing_method)&&cost.item.source==='USER'?`<p>原始金额输入：<span class="learning-raw">${h(String(cost.item.amount??'未填写'))}</span> ${h(cost.item.currency)}</p>`:''}
    ${renderLearningFx(cost.fx)}<p class="learning-destination">${h(destination(cost))}</p><p class="hint">本次报价内含：${cost.included_in_quote?'是':'否'}${cost.item.contained_in_cost_id!==undefined?`；父费用 ${h(cost.item.contained_in_cost_id)}`:''}。${cost.needs_confirmation?'本项仍需人工核对；':'其他来源及待办见完整结果；'}此处不重新判定归属或去重。</p>
    <details class="evidence"><summary>本笔实际计价与换算记录</summary>${cost.calculations.length?cost.calculations.map(step=>recordedSteps([step],step.id==='conversion'||cost.item.source==='DERIVED'?result.base_currency:cost.item.currency)).join(''):'<p>本次没有独立公式记录。</p>'}</details>${nav('reason',cost.item.cost_id,'查看完整归属与去重依据')}</div></details>`).join('')}</div>
   ${result.inactive_items.length?`<p class="hint">另有 ${result.inactive_items.length} 项本方案未启用，未解析金额、汇率或计入税基与汇总：</p><ul>${result.inactive_items.map(item=>`<li>${h(item.cost_name)} · ${h(item.cost_id)} · 未计算</li>`).join('')}</ul>`:''}<div class="panel-actions">${nav('chart','responsibility','查看费用汇总去向图')}${nav('chart','seller-fees','查看卖方费用图')}</div></details>
  <details class="evidence" data-evidence-section="learning-customs"><summary>3. 海关计税为何另用一套口径</summary><p class="hint">海关加计与商业承担分别计算，不按谁付款或是否含于报价直接决定。以下只展示实际入选组成；未独立列出不代表法律上免税。保额不是保费。</p>
   ${result.dutiable_value.components.map(component=>`<article class="learning-customs-component" data-learning-component="${h(component.cost_id)}"><h3>${h(component.label)}</h3><p>计入计税价格：${h(component.amount.toString())} ${h(result.base_currency)}</p>${renderLearningFx(component.fx)}${component.calculation?recordedSteps([component.calculation],result.base_currency):'<p class="hint">本项未提供独立操作数记录，请核对原计税过程。</p>'}</article>`).join('')}
   <p>本次完税价格合计：<strong>${h(result.dutiable_value.value.toString())} ${h(result.base_currency)}</strong></p><div class="panel-actions">${nav('group','customs','查看完整完税价格公式')}${nav('group','import-tax','查看税额与舍入')}${nav('chart','customs-base','查看计税价格图')}</div></details>
 </div></details>`;
}

/** Exact dataset matching avoids injecting user IDs into CSS selectors. Navigation never edits data. */
export function focusLearningTarget(result:AnalysisResult|null,kind:string|undefined,id:string|undefined):boolean{
 if(!result||!id)return false;
 let target:HTMLElement|undefined;
 if(kind==='reason'&&result.items.some(cost=>cost.item.cost_id===id))target=[...document.querySelectorAll<HTMLElement>('[data-evidence-section]')].find(el=>el.dataset.evidenceSection===`reasoning-${id}`);
 else if(kind==='group'&&result.calculations.some(group=>group.id===id))target=[...document.querySelectorAll<HTMLElement>('[data-evidence-section]')].find(el=>el.dataset.evidenceSection===`calculation-${id}`);
 else if(kind==='chart'&&(CHARTS as readonly string[]).includes(id))target=[...document.querySelectorAll<HTMLElement>('[data-visualization]')].find(el=>el.dataset.visualization===id);
 if(!target)return false;
 const focus=target.tagName==='DETAILS'?target.querySelector<HTMLElement>('summary'):target;
 if(!focus)return false;if(focus===target)focus.tabIndex=-1;revealWorkspaceElement(focus);return true;
}
