import type { Scenario } from '../domain/scenario.js';
import type { Trade } from '../domain/trade.js';
import { overrideEvidenceValues, quoteEvidenceValues } from '../domain/contract-evidence.js';
import { evidenceKey } from '../domain/source-evidence.js';
import { checkSource, type DecisionReadiness } from './decision-readiness.js';
import { isIsoDate } from './tax/china-import.js';
import type { Warning } from '../domain/warning.js';

/** 合同约定只改变费用承担；风险转移仍按术语及交货事实判定。 */
export function assessContract(base: DecisionReadiness, trade: Trade, activeIds: readonly string[], scenario: Scenario, warnings: readonly Warning[]): DecisionReadiness {
  if (!scenario.contract_review) return base;
  const issues = [...base.issues];
  const sources = [...base.sources];
  const context = [...base.context];
  const date = scenario.contract_review.evaluation_date ?? '';
  const overrides = Object.entries(scenario.responsibility_overrides ?? {});
  const activeOverrides = overrides.filter(([id]) => activeIds.includes(id));
  if (scenario.contract_review.require_quote || activeOverrides.length > 0) {
    context.push(`合同比较日期：${date || '未填写'}（与进口申报日期分别核对）`);
    if (!isIsoDate(date)) issues.push('合同比较日期未填写或无效，无法核对报价及合同费用约定的有效期');
  }
  if (scenario.contract_review.require_quote) {
    for (const warning of warnings.filter(warning => warning.code === 'QUOTE_NOT_RECONCILED' || warning.code === 'QUOTE_INCLUSION_CONFLICT')) issues.push(warning.message);
    if (!scenario.quote.named_place?.trim()) issues.push('实际报价未填写术语指定地点或港口，请核对合同交货范围');
    context.push(`实际合同报价：${scenario.quote.amount} ${scenario.quote.currency} · ${scenario.incoterm} ${scenario.quote.named_place ?? ''}`);
    const evidence = scenario.quote.evidence;
    sources.push(checkSource(`${scenario.incoterm} 合同报价`, date, evidence,
      evidence ? evidenceKey(quoteEvidenceValues(trade, scenario), evidence) : undefined));
  }
  for (const [id, override] of overrides) {
    const item = trade.items.find(item => item.cost_id === id);
    if (!item) { issues.push(`合同费用约定引用了不存在的费用 ${id}，请删除或重新指定`); continue; }
    if (!activeIds.includes(id)) continue;
    if (!override.reason?.trim()) issues.push(`费用「${item.cost_name}」的合同约定缺少条款说明`);
    const evidence = override.evidence;
    sources.push(checkSource(`${scenario.incoterm} 费用约定：${item.cost_name}`, date, evidence,
      evidence ? evidenceKey(overrideEvidenceValues(trade, scenario, id), evidence) : undefined));
    context.push(`合同费用约定：${item.cost_name} → ${override.responsibility === 'SELLER' ? '卖方' : '买方'}；${override.reason || '说明未填'}。风险转移仍按术语及交货事实判断。`);
  }
  // 基础检查已添加原有来源问题，这里仅追加本次合同来源的待办。
  for (const source of sources.slice(base.sources.length)) {
    if (source.issues.length) issues.push(`${source.label}：${source.issues.join('；')}`);
  }
  return { ready: issues.length === 0, issues: [...new Set(issues)], sources, context };
}
