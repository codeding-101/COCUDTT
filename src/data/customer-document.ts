import type { CustomerQuote } from '../domain/customer-quote.js';
import { d } from '../domain/decimal.js';
import { isIsoDate } from '../engine/tax/china-import.js';

export interface CustomerDocument { reference:string; generatedAt:string; rows:[string,string][]; standard:string[]; pending:string[]; disclaimer:string; precision:string }
export const CUSTOMER_DISCLAIMER='本工具仅供学习与内部测算参考，不构成法律或专业贸易建议。实际合同请以 Incoterms® 官方文本及当地法规为准。';
export function customerDocument(quote:CustomerQuote,generatedAt=new Date().toISOString()):CustomerDocument {
  const amount=d(quote.quote.amount),[whole='',fraction='']=amount.toFixed(Math.max(2,amount.decimalPlaces())).split('.');
  const money=whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+fraction;
  const date=generatedAt.slice(0,10),pending=[...quote.pending];
  if(quote.quote.valid_from&&quote.quote.valid_to&&isIsoDate(date)&&(date<quote.quote.valid_from||date>quote.quote.valid_to))pending.push('文档生成日期不在所列报价有效期内，需重新确认报价，不能自动延长有效期');
  const standard=[`风险转移：${quote.standard.risk_point}${quote.standard.risk_pending?'（待核对具体分支）':''}。具体交货事实和双方另约仍须确认。`];
  if(quote.standard.freight_risk_separated)standard.push('卖方支付运费至约定目的地，不代表货损风险持续由卖方承担至该目的地。');
  standard.push(quote.standard.insurance_obligation?`本术语通常要求卖方投保，默认协会货物条款${quote.standard.insurance_obligation==='ICC_A'?'(A)':'(C)'}或等效保障；保额与实际条款另核。`:'本术语未规定双方须向对方订立保险合同；实际投保及保费承担依双方约定。');
  standard.push(`标准进口清关及税费费用承担：${quote.standard.import_cost_bearer==='SELLER'?'卖方':'买方'}。费用承担不自动确定法定纳税人或抵扣资格；卸货费用另核合同。所有权、付款和违约处理须另约。`);
  return {reference:quote.reference,generatedAt,rows:[['报价提供方',quote.issuer],['客户/接收方',quote.recipient],['公开编号',quote.reference],['商品',quote.goods.description],['数量与单位',`${quote.goods.quantity} ${quote.goods.unit}`],['报价总额（原币）',`${money} ${quote.quote.currency}`],['贸易术语与指定地点',`${quote.quote.incoterm} ${quote.quote.named_place} · Incoterms® ${quote.quote.incoterms_version}`],['报价有效期',quote.quote.valid_from&&quote.quote.valid_to?`${quote.quote.valid_from} 至 ${quote.quote.valid_to}`:'待双方确认'],['交付安排',quote.terms.delivery],['付款安排',quote.terms.payment],['报价包含范围',quote.terms.included],['报价不包含范围',quote.terms.excluded],['保险安排',quote.terms.insurance],['税费口径',quote.terms.tax],['公开备注',quote.terms.remarks]],standard,pending,disclaimer:CUSTOMER_DISCLAIMER,precision:`客户报价说明版本 ${quote.version} · 原币报价保留录入精度，未自动生成单价、税额或承诺条款。`};
}
