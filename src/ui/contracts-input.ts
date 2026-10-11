import type { ProjectFile, QuoteTemplate } from '../data/project-file.js';
import { FX_TYPES, FX_TYPE_LABELS } from '../domain/enums.js';
import { escapeHtml } from './format.js';
import { renderSourceEditor } from './source-editor.js';

export function emptyContractQuote(project: ProjectFile): QuoteTemplate {
  return { amount: '', currency: project.base_currency, fx_type: 'CONTRACT', named_place: '' };
}

/** 只录入当前术语的约定，避免一次修改影响其他方案。 */
export function renderContractPanel(project: ProjectFile): string {
  const term = project.incoterm;
  const record = project.term_scenarios?.[term];
  const actual = project.anchor.kind === 'ACTUAL_QUOTES';
  const quote = record?.quote ?? emptyContractQuote(project);
  const prefix = `term_scenarios.${term}.quote`;
  const active = project.items.filter(item => item.applicable_incoterms === undefined || item.applicable_incoterms.includes(term));
  const quoteFields = actual ? `<h3 class="panel-heading">${term} 实际合同报价</h3>
    <div class="field-grid">
      <label class="field">本方案报价金额<input type="text" inputmode="decimal" value="${escapeHtml(quote.amount)}" data-path="${prefix}.amount"></label>
      <label class="field">本方案报价币种<input type="text" value="${escapeHtml(quote.currency)}" data-path="${prefix}.currency"></label>
      <label class="field wide">术语指定地点或港口<input type="text" value="${escapeHtml(quote.named_place ?? '')}" data-path="${prefix}.named_place" placeholder="照合同填写，如上海港；费用与交货范围另核对"></label>
      <label class="field">商业汇率类型<select data-path="${prefix}.fx_type">${FX_TYPES.map(type => `<option value="${type}"${type === quote.fx_type ? ' selected' : ''}>${FX_TYPE_LABELS[type]}</option>`).join('')}</select></label>
      <label class="field">商业汇率日期<input type="text" value="${escapeHtml(quote.fx_date ?? '')}" data-path="${prefix}.fx_date" placeholder="YYYY-MM-DD"></label>
    </div>
    ${renderSourceEditor(record?.quote_evidence, 'quote', term)}
    <p class="hint block">用报价单或合同编号记录来源，适用期按报价有效期填写，首尾日期均包含。报价金额、商品或交货事实变动后须重新核对。切换贸易术语可录入另一方案；没有报价的方案不使用公共金额补齐。</p>
    <button class="ghost danger" data-action="clear-contract-quote">清除 ${term} 报价</button>
    <p class="hint block">已录入：${escapeHtml(Object.entries(project.term_scenarios ?? {}).filter(([, entry]) => entry.quote?.amount.trim()).map(([t, entry]) => `${t} ${entry.quote!.amount} ${entry.quote!.currency}`).join('；') || '尚无报价')}</p>` :
    '<p class="hint block">当前使用模拟比较基准。保存的实际报价保留，但不用于本次反推或固定金额模拟；下列费用约定仍逐方案应用。</p>';
  return `<details class="panel" data-section="contract" open><summary><span class="panel-title">合同报价与费用约定 · ${term}</span></summary><div class="panel-body">
    <label class="field">合同比较日期<input type="text" value="${escapeHtml(project.evaluation_date ?? '')}" data-path="evaluation_date" placeholder="YYYY-MM-DD"></label>
    <p class="hint block">此日期用于核对报价和合同费用约定有效期；税率及海关汇率仍按进口申报日期核对。比较日期须明确录入，以便复现历史测算。</p>
    ${quoteFields}
    <h3 class="panel-heading">${term} 费用承担约定</h3>
    <p class="hint block">默认按术语判定；合同另有约定时，选择买方或卖方并记录条款和核对依据。约定只影响这一术语的费用承担，风险转移仍按术语及交货事实判断。分摊费用请先拆成两笔。</p>
    ${active.map(item => {
      const override = record?.responsibility_overrides?.[item.cost_id];
      const binding = `data-contract-cost="${escapeHtml(item.cost_id)}"`;
      return `<details class="evidence" data-evidence-section="${escapeHtml(`contract:${term}:${item.cost_id}`)}"><summary>${escapeHtml(item.cost_name)} · ${override ? (override.responsibility === 'SELLER' ? '合同约定卖方' : '合同约定买方') : '按术语判定'}</summary>
        <div class="field-grid"><label class="field">费用承担<select ${binding} data-contract-field="responsibility">
          <option value="DEFAULT"${override ? '' : ' selected'}>按术语判定</option><option value="SELLER"${override?.responsibility === 'SELLER' ? ' selected' : ''}>合同约定卖方</option><option value="BUYER"${override?.responsibility === 'BUYER' ? ' selected' : ''}>合同约定买方</option></select></label>
        ${override ? `<label class="field wide">合同条款或约定说明<input type="text" value="${escapeHtml(override.reason ?? '')}" ${binding} data-contract-field="reason" placeholder="说明这笔费用的范围及承担方"></label>` : ''}</div>
        ${override ? renderSourceEditor(override.evidence, 'contract-cost', JSON.stringify([term, item.cost_id])) : ''}</details>`;
    }).join('') || '<p class="hint block">本方案暂无启用费用。</p>'}
    ${Object.keys(record?.responsibility_overrides ?? {}).filter(id => !project.items.some(item => item.cost_id === id)).map(id =>
      `<p class="hint block">约定引用的费用 ${escapeHtml(id)} 已不存在。<button class="ghost danger" data-action="remove-contract-override" data-contract-cost="${escapeHtml(id)}">删除这条失效约定</button></p>`).join('')}
  </div></details>`;
}
