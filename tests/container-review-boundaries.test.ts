import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {d} from '../src/domain/decimal';
import type {CostItem} from '../src/domain/cost-item';
import type {ContainerBillInput,ContainerBillDailyLine} from '../src/domain/container-bill';
import {normalizeItem} from '../src/engine/pricing';
import {applyInclusion,buildInclusionPredicate} from '../src/engine/inclusion';
import {computeDutiableValue} from '../src/engine/tax/dutiable-value';
import {calculateContainerBill} from '../src/engine/container-bill';
import {chinaImportSampleProjectFile} from '../src/data/sample-project';
import {makeCostItem} from './helpers/factory';

const item=(patch:Partial<CostItem>={})=>makeCostItem({cost_id:'service',amount:'113',responsibility:'BUYER',...patch});
const gross=(cost:CostItem)=>normalizeItem(cost,{resolveBase:()=>{throw Error('Unexpected base');}}).gross_amount;
const inclusion=(items:CostItem[])=>applyInclusion({items,included_cost_ids:[],quote_amount_base:d(113),amountBaseOf:id=>gross(items.find(i=>i.cost_id===id)!),responsibilityOf:id=>items.find(i=>i.cost_id===id)!.responsibility});
function customs(items:CostItem[]){
 const profile=structuredClone(chinaImportSampleProjectFile().tax_profile);delete profile.import.insuranceFallbackRate;
 return computeDutiableValue({goods:{name:'Synthetic',quantity:'1',unit:'PCS',trade_value:{amount:'100',currency:'CNY'},seller_goods_cost:{amount:'0',currency:'CNY'}},items,baseCurrency:'CNY',books:[],profile,goodsValueBase:d(100),grossOf:id=>gross(items.find(i=>i.cost_id===id)!),amountBase:id=>gross(items.find(i=>i.cost_id===id)!)});
}
function bill(){return structuredClone(JSON.parse(readFileSync(new URL('../docs/cases/container-bill-design.json',import.meta.url),'utf8')).cases[0].input) as ContainerBillInput;}

// These tests document CURRENT limitations. They do not endorse automatic tax treatment.
describe('接入前现状边界：记录不等于拆税/抵扣或费用应用',()=>{
 it.each([false,true])('含税标记%s当前不改变113原币金额',tax_included=>{
  expect(gross(item({tax_included,tax_rate_ref:'synthetic-only'})).toFixed()).toBe('113');
 });
 it('核心6位会改变半微单位，账单不能静默沿用这个结果',()=>{
  expect(gross(item({amount:'0.0000005'})).toFixed()).toBe('0.000001');
 });
 it('额外末尾零与核心精确兼容',()=>{
  expect(gross(item({amount:'1.230000000000000000'})).toFixed()).toBe('1.23');
 });
 it('报价内含只排除买方额外支付，不删除卖方实际成本',()=>{
  expect(inclusion([item({included_in_quoted_price:true})]).exclusions.get('service')).toBe('INCLUDED_IN_QUOTE');
  expect(inclusion([item({included_in_quoted_price:true,responsibility:'SELLER'})]).exclusions.has('service')).toBe(false);
 });
 it('非空报价清单覆盖逐项旗标',()=>{
  const predicate=buildInclusionPredicate(['other']);expect(predicate(item({included_in_quoted_price:true}))).toBe(false);
  expect(predicate(item({cost_id:'other',included_in_quoted_price:false}))).toBe(true);
 });
 it('报价已含运费仍独立进入海关计税价格',()=>{
  expect(customs([item({cost_category:'MAIN_CARRIAGE',amount:'20',included_in_quoted_price:true})]).value.toFixed()).toBe('120');
 });
 it('已含父项的子项不再加计，但不能据此证明父项覆盖事实',()=>{
  expect(customs([item({customs_value:'ADD'}),item({cost_id:'child',amount:'20',customs_value:'ADD',contained_in_cost_id:'service'})]).value.toFixed()).toBe('213');
 });
 it('含税ADD目前按录入额加计，不自动拆出服务VAT',()=>{
  expect(customs([item({tax_included:true,tax_rate_ref:'synthetic-only',customs_value:'ADD'})]).value.toFixed()).toBe('213');
 });
 it('EXCLUDE只排除该费用加计，不从商品整价倒扣',()=>{
  expect(customs([item({tax_included:true,customs_value:'EXCLUDE'})]).value.toFixed()).toBe('100');
 });
 it('相同箱日但不同scope标签是现有候选检测的限制',()=>{
  const x=bill();x.lines.push({...structuredClone(x.lines[0]!),line_id:'second',scope_id:'OTHER'});
  expect(calculateContainerBill(x).potential_overlaps).toEqual([]);
 });
 it('免费覆盖期间也可能命中重叠候选，零金额不消除交集',()=>{
  const x=bill(),line=x.lines[0] as ContainerBillDailyLine;line.daily.free_days=3660;
  x.lines.push({...structuredClone(line),line_id:'second'});const result=calculateContainerBill(x);
  expect(result.lines.map(l=>l.amount)).toEqual(['0','0']);expect(result.potential_overlaps).toHaveLength(1);
 });
 it('不同币种不证明同箱期间没有候选，结果不跨币合计',()=>{
  const x=bill();x.lines.push({...structuredClone(x.lines[0]!),line_id:'second',currency:'CNY'});
  const result=calculateContainerBill(x);expect(result.potential_overlaps).toHaveLength(1);expect(result).not.toHaveProperty('total');
 });
});
