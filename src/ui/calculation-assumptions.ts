import type{AssumptionSection}from'../data/calculation-assumptions.js';
import{escapeHtml as h}from'./format.js';
/** No inputs, actions, external links or scripts in the exported summary. */
export function renderCalculationAssumptions(sections:readonly AssumptionSection[]):string{
 return `<section class="panel" data-report-section="calculation-assumptions"><div class="panel-body"><h2>计算假设摘要 · 内部复核</h2><p>直接读取生成时的输入与计算记录。各术语完整公式和来源仍在后文；本摘要不认证真实业务。</p>${sections.map(s=>`<h3>${h(s.title)}</h3><table class="grid stackable"><tbody>${s.rows.map(r=>`<tr><th scope="row">${h(r.label)}</th><td data-label="摘要">${h(r.value)}</td></tr>`).join('')}</tbody></table>`).join('')}</div></section>`;
}
