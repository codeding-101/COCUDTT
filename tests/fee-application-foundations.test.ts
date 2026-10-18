import{describe,expect,it}from'vitest';
import{aggregate}from'../src/engine/aggregate';
import{computeDutiableValue}from'../src/engine/tax/dutiable-value';
import{reviewFeeTaxComponent}from'../src/engine/fee-tax-components';
import{reviewContainerCostBoundaries}from'../src/engine/container-cost-review';
import{proposeContainerCosts}from'../src/engine/container-cost-proposal';
import{createFeePrecisionSelection,addFeePrecisionSelectionRecord,acknowledgeFeePrecisionSelectionRecord,reviewFeePrecisionSelection}from'../src/data/fee-precision-selection';
import{serializeFeeTaxAttachment}from'../src/data/fee-tax-attachment';
import{serializeProject}from'../src/data/project-file';
import{updateContainerCostPair}from'../src/data/container-cost-pair';
import{d}from'../src/domain/decimal';
import type{RebateResult}from'../src/engine/tax/rebate';
import type{FeeTaxComponentInput}from'../src/domain/fee-tax-components';
import{makeCostItem,makeTrade}from'./helpers/factory';
import{populatedAttachment,completePair}from'./fixtures/fee-tax-attachment';
import{chinaImportSampleProjectFile}from'../src/data/sample-project';

const components=():FeeTaxComponentInput=>({line_id:'component-design',currency:'CNY',gross:'113',tax:{kind:'EXPLICIT',net:'100',tax:'13'},credit:{kind:'ASSUMED',amount:'13',basis:'合成算术',document_ref:'合成凭证',eligibility_ref:'仅测试假设'},customs:{kind:'ADD_COMPONENT',amount:'40',basis:'合成部分加计'}});
const rebate=():RebateResult=>({entity_type:'TRADING',fob_value:d(0),basis:d(0),basis_rule:'合成零退税',rebate_rate:d(0),vat_rate:d(0),vat_rebate:d(0),consumption_tax_rebate:d(0),rebate_total:d(0),theoretical_rebate:d(0),non_refundable_vat:d(0),is_capped_by_credit:false,lag_cost:d(0),warnings:[]});
function totals(amount:string,side:'SELLER'|'BUYER',tax_included:boolean,payer:'SELLER'|'BUYER'=side){
 const item=makeCostItem({cost_id:'service',amount,tax_included,responsibility:side,responsibility_source:'CONTRACT',payment_party:payer,economic_bearer:side});
 return aggregate({items:[item],amountBaseOf:()=>d(amount),exclusions:new Map(),decisionOf:()=>({responsibility:side,source:'CONTRACT',confidence:'HIGH',note:'合成明确归属'}),quote_amount_base:d(1000),seller_goods_cost_base:d(800),rebate:rebate(),vat_deductible_for_buyer:true});
}
describe('费用应用前的实际模型边界：不把通道混为一个金额',()=>{
 it.each([false,true])('tax_included=%s不会把服务费G=113自动改成E=100或扣除X=13',tax=>{
  const c=reviewFeeTaxComponent(components());expect(c.channels.economic).toEqual({numerator:'100',denominator:'1'});expect(c.channels.customs).toEqual({numerator:'40',denominator:'1'});
  const result=totals('113','BUYER',tax);expect(result.buyer.additional_cost_total.toString()).toBe('113');expect(result.buyer.landed_cost_with_tax.toString()).toBe('1113');expect(result.buyer.landed_cost_ex_deductible.toString()).toBe('1113');expect(result.buyer.deductible_vat.toString()).toBe('0');
 });
 it.each([false,true])('卖方tax_included=%s仍按同一个113计算成本，不能声称同时表达100经济成本',tax=>{
  const gross=totals('113','SELLER',tax),net=totals('100','SELLER',tax);expect(gross.seller.cost_total.toString()).toBe('113');expect(gross.seller.margin!.toString()).toBe('87');expect(net.seller.cost_total.toString()).toBe('100');expect(net.seller.margin!.toString()).toBe('100');expect(net.buyer.additional_cost_total.toString()).toBe('0');
 });
 it.each([false,true])('未拆税标记%s不构成服务抵扣或部分海关加计模型',tax=>{
  const p=chinaImportSampleProjectFile(),item=makeCostItem({cost_id:'partial-customs',amount:'113',tax_included:tax,customs_value:'ADD'}),trade=makeTrade({items:[item]});
  const run=()=>computeDutiableValue({goods:trade.goods,items:trade.items,baseCurrency:'CNY',books:[],profile:p.tax_profile,goodsValueBase:d(1000),grossOf:()=>d(113),amountBase:()=>d(113)});
  const add=run();expect(add.components.find(x=>x.cost_id===item.cost_id)!.amount.toString()).toBe('113');item.customs_value='EXCLUDE';expect(run().components.some(x=>x.cost_id===item.cost_id)).toBe(false);expect(reviewFeeTaxComponent(components()).channels.customs).toEqual({numerator:'40',denominator:'1'});
 });
 it.each(['SELLER','BUYER'] as const)('付款方与%s承担方不同，不会自动生成垫付/应收清偿台账',side=>{
  const payer=side==='SELLER'?'BUYER':'SELLER',result=totals('113',side,false,payer);expect(result.seller.cost_total.toString()).toBe(side==='SELLER'?'113':'0');expect(result.buyer.additional_cost_total.toString()).toBe(side==='BUYER'?'113':'0');expect(result).not.toHaveProperty('cash_ledger');
 });
 it('已提交精度政策不解除旧提案CORE_PRECISION_LOSS，也不插入项目费用',async()=>{
  const s=await populatedAttachment('0.1234567'),before=serializeProject(s.pair.project),attachment=await serializeFeeTaxAttachment(s.attachment);let file=await createFeePrecisionSelection(s.raw,attachment);
  file=await addFeePrecisionSelectionRecord(file,{revision:file.revision,content_sha256:file.content_sha256},{component_record_id:s.id,channel:'cash',choice:{kind:'ROUND',policy:{kind:'EXPLICIT',unit:'0.000001',mode:'HALF_UP',basis:'合成政策，非应用授权'}}});
  file=await acknowledgeFeePrecisionSelectionRecord(file,{revision:file.revision,content_sha256:file.content_sha256},s.raw,attachment,file.records[0]!.record_id);
  const r=await reviewFeePrecisionSelection(file,s.raw,attachment);expect(r.rows[0]!.policy.status).toBe('RECORDED_POLICY_ASSUMPTION');expect(r.rows[0]!.business_issues).toContain('PROPOSAL_CORE_PRECISION_LOSS');expect(proposeContainerCosts(s.pair.project,s.pair.bill,s.pair.selection).rows[0]!.issues).toContain('CORE_PRECISION_LOSS');expect(serializeProject(s.pair.project)).toBe(before);
 });
 it('直接插入后沿用旧CREATE_NEW提案会发生目标冲突，不能靠新增字段冒充已完成交接',()=>{
  const s=completePair(),before=serializeProject(s.pair.project),copy=structuredClone(s.pair.project),intent=s.pair.selection.intents[0]!;if(intent.operation!=='CREATE_NEW')throw Error('fixture');copy.items.push(structuredClone(intent.new_cost));
  const row=proposeContainerCosts(copy,s.pair.bill,s.pair.selection).rows[0]!;expect(row.issues).toContain('COST_ID_ALREADY_EXISTS');expect(serializeProject(s.pair.project)).toBe(before);expect(copy.items.filter(x=>x.cost_id===intent.new_cost.cost_id)).toHaveLength(1);
 });
 it('含税/服务税率引用仍是原只读边界待办，成分的数学可拆分不重写这些状态',()=>{
  const s=completePair(),selection=structuredClone(s.pair.selection),intent=selection.intents[0]!;if(intent.operation!=='CREATE_NEW')throw Error('fixture');intent.new_cost.tax_included=true;intent.new_cost.tax_rate_ref='SYNTHETIC-13';
  // Reseal the existing pair through its supported update path rather than altering a digest.
  const pair=updateContainerCostPair(s.pair,s.pair.content_key,s.pair.project,s.pair.bill,selection),review=reviewContainerCostBoundaries(pair,pair.content_key);
  expect(review.rows[0]!.issues).toContain('TAX_INCLUSIVE_TREATMENT_UNSUPPORTED');expect(review.rows[0]!.issues).toContain('SERVICE_TAX_REFERENCE_NOT_INTERPRETED');expect(review.rows[0]!.channels.economic_cost).toBeNull();expect(reviewFeeTaxComponent(components()).channels.net).toEqual({numerator:'100',denominator:'1'});
 });
});
