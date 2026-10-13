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
  const funding: WorkbookCell[][] = [[t('范围'),t('显式本金的单利假设；1.2可按本金事件分段，1.3可按显式新利率分段。不加进付款计划收付，不扣减经营利润或落地成本；机会成本不是银行账单。'),t('不推定实际银行利息付款日或融资到账')],
    [t('格式'),t(plan.version),t('1.0未提供资金占用语义；空白不是零成本')]];
  if (plan.funding) {
    const f = plan.funding;
    for (const [label,value,unit] of [['测算状态',f.status,'明确不测算不表示零成本'],['成本性质',f.kind,'融资利息或资金机会成本'],['测算方',f.party,'买方或卖方'],[(['1.2','1.3','1.4'].includes(plan.version))&&f.balance_model==='EVENTS'?'期初本金':'恒定本金',f.principal,f.currency],[(plan.version==='1.3'||plan.version==='1.4')&&f.rate_model==='EVENTS'?'期初年利率':'年利率',f.annual_rate,'百分数，例如6表示6%'],['起始日',f.start_date,'含起始日'],['截止日',f.end_date,'不含截止日'],['计息基准',f.day_basis,'ACT_365F闰年也除365；ACT_360实际天数除360'],['假设依据',f.reference,'本金期间、利率及计息基准来源']] as const) funding.push([t(label),t(value),t(unit)]);
    if((['1.2','1.3','1.4'].includes(plan.version))) {
      funding.push([t('本金模型'),t(f.balance_model!),t('CONSTANT保留事件但不使用；EVENTS按日期和列表顺序处理')]);
      for(const row of f.events!)funding.push([t(`原始本金事件 ${row.id}`),t(JSON.stringify(row)),t(f.balance_model==='EVENTS'?'原始输入；是否可计算另核':'已保留，未参与恒定模型')]);
    }
  }
  if((plan.version==='1.3'||plan.version==='1.4')&&plan.funding){const f=plan.funding;funding.push([t('利率模型'),t(f.rate_model!),t('CONSTANT保留事件但不使用；EVENTS使用显式新年利率')]);for(const row of f.rate_events!)funding.push([t(`原始利率事件 ${row.id}`),t(JSON.stringify(row)),t(f.rate_model==='EVENTS'?'原始输入；是否可计算另核':'已保留，未参与固定利率模型')]);}
  if(plan.version==='1.4')funding.push([t('原始金额舍入假设'),t(JSON.stringify(plan.funding!.rounding)),t('明确不应用不表示银行不舍入')]);
  try {
    const result = calculateFunding(plan,settlementBinding(project));
    if (!result) funding.push([t('结果'),t('明确不测算；不是零成本'),t('保留的输入不参与计算')]);
    else { funding.push([t('实际计息天数'),n(String(result.days)),t('算头不算尾，同日0天；按UTC民用日期差，无时区/DST调整')],
      [t('计息年基数'),n(String(result.denominator)),t('用户明确选择')],
      [t(result.kind === 'FINANCING' ? '融资利息假设' : '资金机会成本假设'),n(result.cost),t(result.currency)],
      [t('单利替值公式'),t(result.formula),t(result.rates?'Σ(区间本金×年利率百分数×天数) ÷100 ÷年基数':result.ledger?'Σ(区间本金×天数) × 年利率(%) ÷ 100 ÷ 年基数':'本金 × 年利率(%) ÷ 100 × 实际天数 ÷ 年基数')]);
      if(result.rounding){const r=result.rounding;funding.push([t('金额舍入层级/方式/步长'),t(`${r.scope} / ${r.mode} / ${r.unit}`),t('用户显式假设；不从币种推定')],[t('舍入假设金额'),n(r.rounded_cost),t(result.currency+'；不改变原始单利/收付/利润')],[t('合计后舍入'),n(r.total_rounded),t(result.currency)],[t('若逐计算区间舍入'),n(r.interval_rounded),t('仅对比；不自动等于银行结息边界')],[t('逐区间减合计差额'),n(r.scope_difference),t(result.currency)],[t('原始单利精确分数'),t(r.unrounded_fraction),t(result.currency)],[t('本次舍入调整'),t(r.adjustment),t(r.adjustment_fraction+'；十进制展示最多256有效位')],[t('舍入依据'),t(r.reference),t('用户输入')]);for(const row of r.intervals)funding.push([t(`舍入比较 ${row.start_date} → ${row.end_date}`),n(row.rounded_cost),t(`未舍入${row.unrounded_cost}；精确分数${row.unrounded_fraction}；调整${row.adjustment}；调整精确分数${row.adjustment_fraction}`)]);}
      if(result.rates){funding.push([t('截止日年利率'),t(result.rates.closing_rate),t('百分数；截止日不增加计息日')],[t('本金×年利率百分数×天数合计'),t(result.rates.weighted_principal_rate_days),t('先累加再除100与年基数')]);for(const row of result.rates.events)funding.push([t(`利率审计 ${row.date} ${row.id}`),t(`${row.before}% → ${row.after}%`),t(row.reference)]);}
      if(result.ledger){
        funding.push([t('截止日余额'),n(result.ledger.closing_principal),t(result.currency+'；不推定本金已经归还')],[t('本金×天数合计'),n(result.ledger.principal_days),t(result.currency+(result.rates?'·天；利率变化时不能单独由该值计息':'·天；合计由该值统一计算'))]);
        for(const row of result.ledger.events)funding.push([t(`事件审计 ${row.date} ${row.id}`),t(`${row.direction==='INCREASE'?'+':'−'}${row.amount} ${row.currency}；${row.before} → ${row.after}`),t(row.reference)]);
        for(const row of result.ledger.segments)funding.push([t(`区间 ${row.start_date} → ${row.end_date}`),n(row.cost),t(`${result.currency}；本金${row.principal}；${row.days}天；${row.formula}${row.rate_reference!==undefined?'；利率依据：'+row.rate_reference:''}`)]);
        funding.push([t('区间与合计精度'),t((result.rates?'先汇总本金×年利率百分数×天数再除100与年基数；':'先汇总本金×天数再统一除年基数；')+'各段循环小数独立展示，尾数可能与显示值直接相加不同。'),t('未按银行货币单位舍入')]);
      }
    }
  } catch (error) { funding.push([t('资金占用假设未完成'),t(error instanceof Error ? error.message : String(error)),t('不导出旧结果或假定零成本')]); }
  funding.push([t('精度与使用'),t('生成时快照，编辑单元格不会重算；原始单利及调整十进制最多256有效位，金额舍入按显式步长另列，精确分数可核对。超出Excel数值精度以文本保留。'),t('实际银行计息另按合同核对；1.4显式金额舍入单独展示，不自动生成扣款；本金/利率事件，不含复利、市场指数自动重定价、负利率或保证金冻结')]);
  return [{name:'付款计划',headers:['日期/项目','类型','实际付款方','收款方','原币金额','币种','条件、公式与快照'],widths:[28,20,18,18,24,12,100],rows:payments,freezeColumns:1},
    {name:'资金占用假设',headers:['项目','输入/结果','单位与口径'],widths:[28,100,80],rows:funding,freezeColumns:1}];
}
