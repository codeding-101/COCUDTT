import {describe,it,expect} from 'vitest';
import {bilingualSummary} from '../src/data/bilingual-summary';
import {createBilingualSummaryDocument} from '../src/ui/bilingual-summary';
import {projectCustomerQuote} from '../src/data/customer-quote';
import {emptyCustomerQuoteFields,type CustomerQuote} from '../src/domain/customer-quote';
import {incotermBasics} from '../src/domain/incoterm-basics';
import {resolveRisk} from '../src/engine/risk';
import type {Incoterm} from '../src/domain/enums';
import {actualQuotesProject} from './fixtures/actual-quotes';

function quote(term:Incoterm='FOB'):CustomerQuote {
 const p=actualQuotesProject();p.incoterm='FOB';const q=projectCustomerQuote(p,{...emptyCustomerQuoteFields(),reference:'PUBLIC-SUMMARY-001',issuer:'公开公司',recipient:'公开客户',payment_terms:'按双方确认日期支付，不得变成已付款'});
 const basics=incotermBasics(term),risk=resolveRisk(term);q.quote.incoterm=term;q.standard={risk_point:risk.transfer_point,risk_pending:risk.needs_confirmation,freight_risk_separated:basics.freight_risk_separated,insurance_obligation:basics.required_seller_insurance,import_cost_bearer:basics.import_clearance_and_tax_costs};return q;
}
describe('中英文摘要的基础概念对照',()=>{
 it.each([
  ['EXW',/not loaded/],['FCA',/remains unconfirmed/],['FAS',/alongside the vessel/],['FOB',/on board.*shipment/],['CFR',/on board.*shipment/],['CIF',/on board.*shipment/],['CPT',/delivered to the carrier/],['CIP',/delivered to the carrier/],['DAP',/ready for unloading/],['DPU',/have been unloaded/],['DDP',/ready for unloading/],
 ] as [Incoterm,RegExp][])('%s：风险、投保义务、费用和税费资格分开',(term,risk)=>{
  const s=bilingualSummary(quote(term),'2026-09-10'),english=s.standard.map(p=>p.en).join('\n');expect(s.standard[0]!.en).toMatch(risk);
  expect(english.includes('Seller-paid carriage')).toBe(['CFR','CIF','CPT','CIP'].includes(term));
  expect(english).toContain(`tax costs: ${term==='DDP'?'seller':'buyer'}`);expect(english).toContain('does not determine the statutory taxpayer');expect(english).toContain('Unloading costs require separate contract review');
  if(term==='CIF'||term==='CIP'){expect(english).toContain(term==='CIF'?'Clauses (C)':'Clauses (A)');expect(english).toContain('110%');expect(english).toContain('contract currency');expect(english).toContain('does not certify coverage');}else{expect(english).toContain('does not require either party');expect(english).not.toContain('110%');}
  expect(english.includes('first carrier')).toBe(term==='CPT'||term==='CIP');expect(english).toContain('does not designate a prevailing language');
 });
 it.each(['SELLER_PREMISES','OTHER'] as const)('FCA已知%s分支不变成另一交货动作',(place)=>{const q=quote('FCA'),r=resolveRisk('FCA',{delivery_place:place});q.standard.risk_point=r.transfer_point;q.standard.risk_pending=false;const en=bilingualSummary(q).standard[0]!.en;expect(en).toContain(place==='SELLER_PREMISES'?'loading is completed':'remain on the seller’s transport');expect(en).not.toContain('remains unconfirmed');if(place==='OTHER')expect(en).toContain('ready for unloading');});
 it.each(['risk','pending','insurance','freight','import'] as const)('检测%s提示漂移，阻断误配英文模板',(kind)=>{const q=quote();if(kind==='risk')q.standard.risk_point='UNKNOWN_PRIVATE';if(kind==='pending')q.standard.risk_pending=true;if(kind==='insurance')q.standard.insurance_obligation='ICC_A';if(kind==='freight')q.standard.freight_risk_separated=true;if(kind==='import')q.standard.import_cost_bearer='SELLER';expect(()=>bilingualSummary(q)).toThrow('模板不一致');});
});
describe('公开摘要边界与待确认语义',()=>{
 it('十进制报价和数据保持原值，自由条款原文不会被改成英文承诺',()=>{const q=quote();q.quote.amount='1234567890123456.123456';q.goods.quantity='0.000001';q.terms.remarks='原文😀 <script>alert(1)</script> https://example.invalid';const s=bilingualSummary(q,'2026-09-10'),html=createBilingualSummaryDocument(q,'2026-09-10');expect(s.rows[5]!.value).toBe('1,234,567,890,123,456.123456 CNY');expect(s.rows[4]!.value).toBe('0.000001 PCS');expect(html).toContain('按双方确认日期支付');expect(html).toContain('without automatic translation');expect(html).toContain('&lt;script&gt;');expect(html).toContain('原文😀');expect(html).not.toMatch(/<script|<a |<iframe|<form|<input|<textarea|application\/json/);});
 it('所有部位不复制私有扩展、内部名称、原价、来源及额外元数据',()=>{const q=quote();Object.assign(q,{project:'PRIVATE_PROJECT_188',notes:'PRIVATE_NOTES_499'});Object.assign(q.quote,{source:'PRIVATE_SOURCE_123',cost:'82763.128'});Object.assign(q.terms,{internal:'PRIVATE_INTERNAL_343'});const html=createBilingualSummaryDocument(q);expect(JSON.stringify(bilingualSummary(q))+html).not.toMatch(/PRIVATE_|82763\.128|seller_goods_cost|quote_evidence|values_key/);expect(html).toContain('PUBLIC-SUMMARY-001');expect(html).not.toMatch(/hidden|display:none/);});
 it('过期生成日期保留有效期，并以对应中英文列为待确认',()=>{const q=quote(),s=bilingualSummary(q,'2026-10-12');expect(s.rows[7]!.value).toBe('2026-09-01 至 2026-09-30');expect(s.pending.find(p=>p.zh.includes('生成日期'))?.en).toContain('not automatically extended');expect(s.pending.every(p=>p.translated)).toBe(true);});
 it('未知待办保留原文并标明英文待确认，不静默丢弃或假译',()=>{const q=quote();q.pending=['新增未映射待办'];const s=bilingualSummary(q,'2026-09-10');expect(s.pending).toEqual([{zh:'新增未映射待办',en:'Original pending notice is retained; English wording requires confirmation.',translated:false}]);expect(createBilingualSummaryDocument(q,'2026-09-10')).toContain('data-original-notice');});
 it('空公开条款两语均为待确认，空待办不表示已签约或必然可履约',()=>{const q=quote();q.pending=[];const html=createBilingualSummaryDocument(q,'2026-09-10');expect(html).toContain('待双方确认 / Pending confirmation');expect(html).toContain('not an executed contract');expect(html).toContain('still require confirmation');});
 it('输出为公开不可变快照，输入冻结不被写入，后续修改不改变结果',()=>{const q=quote(),before=JSON.stringify(q);Object.freeze(q.quote);const s=bilingualSummary(q,'2026-09-10'),html=createBilingualSummaryDocument(q,'2026-09-10');q.terms.payment='后续变更';q.pending.push('后续待办');expect(s.rows[9]!.value).toContain('按双方确认日期支付');expect(html).not.toContain('后续');expect(before).not.toContain('后续');});
 it('非法时间明确失败，标题和生成时间按文字转义',()=>{expect(()=>bilingualSummary(quote(),'invalid')).toThrow('生成时间');const q=quote();q.reference='<img src=x onerror=alert(1)>';const html=createBilingualSummaryDocument(q,'2026-09-10');expect(html).toContain('&lt;img');expect(html).not.toContain('<img');});
});
