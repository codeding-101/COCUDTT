import {chinaImportSampleProjectFile} from './sample-project.js';
import {containerBillTemplate} from './container-bill-templates.js';
import {bindContainerBillDraft} from './container-bill-context.js';
import {createContainerCostPair,enableContainerCostReview,containerCostPairBusiness,replaceContainerCostReviewPlan} from './container-cost-pair.js';
import {setContainerReviewRecord} from './container-cost-review-plan.js';
import {reviewContainerBillDraft} from '../engine/container-bill-draft.js';
import {emptyEvidence} from '../domain/source-evidence.js';
import type {CostItem} from '../domain/cost-item.js';

/** Fixed synthetic exercise, explicitly opened by the user; never a source of actual defaults. */
export function containerReviewExample(){
 const project=chinaImportSampleProjectFile();project.name='中国进口 · 核对记录体验示例';
 const bill=bindContainerBillDraft(containerBillTemplate('container-bill-synthetic-example'),project),first=bill.rows[0]!;
 const second=structuredClone(first);second.input.line_id='example-other-line';second.input.scope_id='example-other-scope';second.input.charge_kind='DETENTION';bill.rows.push(second);
 const amount=reviewContainerBillDraft(bill,project).rows[0]!.calculation!.amount;
 const cost:CostItem={cost_id:'example-container-cost',cost_name:'合成集装箱费用提案（未应用）',cost_category:'CUSTOM',trade_node:'DESTINATION_TERMINAL',pricing_method:'FIXED',amount,currency:first.input.currency!,base_currency:project.base_currency,fx_type:'MARKET',tax_included:false,responsibility:'BUYER',responsibility_source:'CONTRACT',payment_party:'BUYER',economic_bearer:'BUYER',occurrence_reason:'NORMAL_OPERATION',customs_value:'EXCLUDE',included_in_quoted_price:false,is_custom:true,source:'USER',container_charge:'DEMURRAGE',container_charge_scope:first.input.scope_id!,applicable_incoterms:[project.incoterm]};
 const evidence={...emptyEvidence(),status:'EXAMPLE' as const,reference:'合成体验题；不是合同或承运人账单',valid_from:'2026-10-01',valid_to:'2026-10-31',checked_on:'2026-10-14'};
 let pair=createContainerCostPair(project,bill,{version:'0.1',intents:[{operation:'CREATE_NEW',line_id:first.input.line_id,new_cost:cost,note:'合成题：先观察原金额、跨标签箱日交集及待办',evidence}]});pair=enableContainerCostReview(pair,pair.content_key);
 const plan=pair.review_plan!,m=pair.mapping.entries[0]!,updated=setContainerReviewRecord(plan,plan.content_key,containerCostPairBusiness(pair),{decision:'KEEP_RECORDED_AMOUNT',target:{kind:'ROW',mapping_id:m.mapping_id,line_id:m.line_id,cost_id:m.cost_id},explanation:'合成题只保留账单金额，不进行拆税、抵扣或费用应用。示例来源不能直接确认。',evidence});
 return replaceContainerCostReviewPlan(pair,pair.content_key,updated);
}
