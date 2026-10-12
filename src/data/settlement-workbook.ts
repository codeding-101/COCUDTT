import type { ProjectFile } from './project-file.js';
import type { SettlementPlan } from '../domain/settlement.js';
import { settlementBinding } from './settlement-context.js';
import { compareProject } from './workbook-snapshot.js';
import { calculateSettlement } from '../engine/settlement.js';
import { calculateFunding } from '../engine/funding.js';
import { textCell as t, decimalCell as n, type WorkbookCell, type WorkbookSheet } from './xlsx-file.js';

/** Detached internal snapshot, including invalid inputs and the reason calculation stopped. */
export function settlementWorkbookSheets(project: ProjectFile, plan: SettlementPlan): WorkbookSheet[] {
  const note = (label: string, value: string): WorkbookCell[] => [t(label),t(''),t(''),t(''),t(''),t(''),t(value)];
  const payments = [note('范围','当前术语合同价款与银行费用计划；收付净额不是利润，不含其他经营收付，不跨币种加总。'),
    note('绑定快照',JSON.stringify(plan.binding)),note('方式',plan.method),note('格式',plan.version),note('银行费用核对',plan.bank_status)];
  try {
    const current = settlementBinding(project);
    const analysis = compareProject(project).columns.find(column => column.incoterm === project.incoterm)?.result ?? null;
    const result = calculateSettlement(plan,current,analysis,project.term_scenarios?.[project.incoterm]?.responsibility_overrides);
    payments.push(note('核对结果',`合同价${result.principal}；付款合计${result.allocated}；差额${result.difference} ${current.currency}`));
    for (const event of result.events) payments.push([t(event.date),t(event.kind === 'PRINCIPAL' ? '合同价款' : '银行费用'),t(event.payer === 'BUYER' ? '买方' : '卖方'),t(event.recipient === 'SELLER' ? '卖方' : '银行'),n(event.amount),t(event.currency),t(`${event.label}\n${event.formula}${event.cost_id ? '\n关联费用ID：'+event.cost_id : ''}`)]);
    for (const total of result.totals) payments.push(note(`${total.currency} 收付汇总`,`买方付款${total.buyer_outflow}；卖方收款${total.seller_inflow}；卖方银行付款${total.seller_outflow}；卖方收付净额${total.seller_net}；银行费用${total.bank_fees}（不是利润）`));
  } catch (error) { payments.push(note('付款计划未完成',error instanceof Error ? error.message : String(error))); }
  payments.push(note('内部备注',plan.notes),note('原始计划JSON（包含未完成输入）',JSON.stringify(plan,null,2)));
  const funding: WorkbookCell[][] = [[t('范围'),t('单笔恒定本金的单利假设，不加进付款计划收付，不扣减经营利润或落地成本；机会成本不是银行账单。'),t('不推定实际银行利息付款日或融资到账')],
    [t('格式'),t(plan.version),t('1.0未提供资金占用语义；空白不是零成本')]];
  if (plan.funding) {
    const f = plan.funding;
    for (const [label,value,unit] of [['测算状态',f.status,'明确不测算不表示零成本'],['成本性质',f.kind,'融资利息或资金机会成本'],['测算方',f.party,'买方或卖方'],['恒定本金',f.principal,f.currency],['年利率',f.annual_rate,'百分数，例如6表示6%'],['起始日',f.start_date,'含起始日'],['截止日',f.end_date,'不含截止日'],['计息基准',f.day_basis,'ACT_365F闰年也除365；ACT_360实际天数除360'],['假设依据',f.reference,'本金期间、利率及计息基准来源']] as const) funding.push([t(label),t(value),t(unit)]);
  }
  try {
    const result = calculateFunding(plan,settlementBinding(project));
    if (!result) funding.push([t('结果'),t('明确不测算；不是零成本'),t('保留的输入不参与计算')]);
    else funding.push([t('实际计息天数'),n(String(result.days)),t('算头不算尾，同日0天；按UTC民用日期差，无时区/DST调整')],
      [t('计息年基数'),n(String(result.denominator)),t('用户明确选择')],
      [t(result.kind === 'FINANCING' ? '融资利息假设' : '资金机会成本假设'),n(result.cost),t(result.currency)],
      [t('单利替值公式'),t(result.formula),t('本金 × 年利率(%) ÷ 100 × 实际天数 ÷ 年基数')]);
  } catch (error) { funding.push([t('资金占用假设未完成'),t(error instanceof Error ? error.message : String(error)),t('不导出旧结果或假定零成本')]); }
  funding.push([t('精度与使用'),t('生成时快照，编辑单元格不会重算；最多256有效位，未按银行货币单位舍入。超出Excel数值精度以文本保留。'),t('实际银行计息另按合同核对；不含复利、变动本金、负利率或保证金冻结')]);
  return [{name:'付款计划',headers:['日期/项目','类型','实际付款方','收款方','原币金额','币种','条件、公式与快照'],widths:[28,20,18,18,24,12,100],rows:payments,freezeColumns:1},
    {name:'资金占用假设',headers:['项目','输入/结果','单位与口径'],widths:[28,100,80],rows:funding,freezeColumns:1}];
}
