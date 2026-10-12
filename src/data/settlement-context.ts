import type { ProjectFile } from './project-file.js';
import type { SettlementBinding } from '../domain/settlement.js';

export function settlementBinding(project: ProjectFile): SettlementBinding {
  if (project.anchor.kind !== 'ACTUAL_QUOTES') throw Error('付款计划须绑定当前术语独立录入的实际报价，不能使用模拟或反推报价');
  const quote = project.term_scenarios?.[project.incoterm]?.quote;
  if (!quote) throw Error('当前术语缺少实际报价，请先录入');
  return { project_name: project.name, goods_name: project.goods.name, quantity: String(project.goods.quantity), unit: project.goods.unit,
    incoterm: project.incoterm, named_place: quote.named_place ?? '', amount: quote.amount, currency: quote.currency };
}
