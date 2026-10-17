import {logisticsProject} from './logistics-project';
import {makeCostItem} from '../helpers/factory';
import {containerBillTemplate} from '../../src/data/container-bill-templates';
import {bindContainerBillDraft} from '../../src/data/container-bill-context';
import {confirmContainerBillLine} from '../../src/engine/container-bill-draft';
import {confirmContainerCostIntent} from '../../src/engine/container-cost-proposal';
import {createContainerCostPair,serializeContainerCostPair,enableContainerCostReview} from '../../src/data/container-cost-pair';
import {createFeeTaxAttachment,setFeeTaxAttachmentRecord} from '../../src/data/fee-tax-attachment';
import type {FeeTaxAttachmentRecordInput,FeeTaxAttachment,FeeTaxAttachmentSource} from '../../src/domain/fee-tax-attachment';
import type {ContainerCostIntent} from '../../src/domain/container-cost-proposal';
export const lease=(a:FeeTaxAttachment)=>({revision:a.revision,content_sha256:a.content_sha256});
export const source=():FeeTaxAttachmentSource=>({provenance:'USER_SUPPLIED',reference:'合成来源，仅软件测试',valid_from:'2026-10-01',valid_to:'2026-10-31',checked_on:'2026-10-17'});
export function completePair(amount='113',version:'1.0'|'1.1'='1.0',line_id='bill-line'){
 const project=logisticsProject('CIF');let bill=bindContainerBillDraft(containerBillTemplate('container-bill-synthetic-example'),project);bill.review_date='2026-10-17';
 bill.rows=[{input:{line_id,scope_id:'new-independent-scope',direction:'IMPORT',equipment_type:'20GP',container_ids:['SYNTHETIC-A'],currency:'USD',reference:'合成非实际账单',charge_kind:'INSPECTION',mode:'PER_CONTAINER',rate:amount}}];
 const {provenance:_provenance,...fields}=source(),evidence={...fields,status:'UNVERIFIED' as const};bill=confirmContainerBillLine(bill,line_id,evidence);
 const cost=makeCostItem({cost_id:'new-proposed-service',cost_name:'合成服务费',amount,currency:'USD',container_charge:'INSPECTION',container_charge_scope:'new-independent-scope',applicable_incoterms:['CIF'],occurrence_reason:'NORMAL_OPERATION',responsibility:'BUYER',responsibility_source:'CONTRACT',payment_party:'BUYER',economic_bearer:'BUYER',customs_value:'EXCLUDE'});
 const intent=confirmContainerCostIntent(project,bill,{operation:'CREATE_NEW',line_id,new_cost:cost,note:'合成服务费，不应用费用'} as Extract<ContainerCostIntent,{operation:'CREATE_NEW'}>,evidence);
 let pair=createContainerCostPair(project,bill,{version:'0.1',intents:[intent]});if(version==='1.1')pair=enableContainerCostReview(pair,pair.content_key);
 const raw=serializeContainerCostPair(pair),record:FeeTaxAttachmentRecordInput={target:{...pair.mapping.entries[0]!},input:{line_id:'component-short',currency:'USD',gross:amount,tax:{kind:'GROSS_RATE',rate:'0.13'},credit:{kind:'NONE',basis:'合成本次不调整'},customs:{kind:'NOT_ADDED',basis:'合成本通道不加计'}},sources:{tax:source(),credit:source(),customs:source()}};
 return{pair,raw,record};
}
export async function populatedAttachment(amount='113',version:'1.0'|'1.1'='1.0'){
 const setup=completePair(amount,version),empty=await createFeeTaxAttachment(setup.raw),attachment=await setFeeTaxAttachmentRecord(empty,lease(empty),setup.record);
 return{...setup,attachment,id:attachment.records[0]!.record_id};
}
export function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
