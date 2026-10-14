import type { AnalysisResult } from '../engine/analyze.js';
import { incotermBasics } from '../domain/incoterm-basics.js';

export function renderConceptCheck(result: AnalysisResult): string {
  const basics = incotermBasics(result.incoterm);
  return `<section class="panel"><div class="panel-body"><details class="evidence" data-evidence-section="concept-check"><summary>基础概念核对 · ${result.incoterm}</summary>
    <ul class="decision-issues">
      <li>交货与风险：${basics.freight_risk_separated ? 'C类术语的运费支付终点不同于交货风险转移点；卖方支付运费不代表途中全部风险仍归卖方。' : '按具体术语及约定地点/交货事实判断，不用费用付款方代替风险承担方。'}</li>
      <li>投保合同义务：${basics.required_seller_insurance ? `卖方须按${result.incoterm}投保，默认${basics.required_seller_insurance === 'ICC_A' ? '协会货物条款(A)' : '协会货物条款(C)'}或等效保障；保额、另约条件及资料需独立核对。` : '双方均无向对方订立保险合同的义务；这不等于禁止投保，也不等于某方必付已录入保费。自愿保费须记录实际合同/承担方。'}</li>
      <li>目的地卸货：${basics.delivery_requires_destination_unloading ? 'DPU要求卖方卸货完成后交货；这是交货作业义务。' : '本术语不以卖方完成目的地卸货为交货义务；卸货费用仍须另查运输合同和买卖合同，不能据此一律归买方。'}</li>
      <li>清关与税费费用：出口清关${basics.export_clearance === 'SELLER' ? '卖方' : '买方'}，进口清关及进口税费原则上${basics.import_clearance_and_tax_costs === 'SELLER' ? '卖方' : '买方'}承担；合同例外需逐项核对。费用承担不自动认定法定纳税人或VAT抵扣资格。</li>
      <li>报价、保额与税基分开：报价内含按本方案口径去重；海关税基按货物净价、符合范围的运保费及调整计算。保额不是保费，不加入成本或税基。</li>
      <li>Incoterms不规定货物所有权转移、具体付款方式/账期或违约救济；这些应由合同及适用法律另行约定。</li>
    </ul><p class="hint block">此处说明基础边界，金额仍受本次输入、来源及待办限制。未确认费用未计入双方，可能低估成本，不能据参考数字推荐方案。</p>
  </details></div></section>`;
}
