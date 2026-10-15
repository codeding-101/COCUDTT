import type {ContainerCostPair} from '../domain/container-cost-pair.js';
import type {ContainerBillDraft} from '../domain/container-bill-draft.js';
import type {ProjectFile} from './project-file.js';
import {containerCostPairBusiness,validateContainerCostPair,serializeContainerCostPair} from './container-cost-pair.js';
import {reviewContainerCostReviewPlan} from './container-cost-review-plan.js';
import {emptyEvidence,evidenceKey} from '../domain/source-evidence.js';
import {textCell as t,type WorkbookSheet} from './xlsx-file.js';
export function containerPairSnapshot(pair:ContainerCostPair,project:ProjectFile,bill?:ContainerBillDraft){
 validateContainerCostPair(pair);const key=(v:unknown)=>evidenceKey(v,emptyEvidence()),issues:string[]=[];
 if(key(project)!==key(pair.project))issues.push('PROJECT_SNAPSHOT_MISMATCH');if(!bill||key(bill)!==key(pair.bill))issues.push('BILL_SNAPSHOT_MISMATCH');
 return{scope:'INTERNAL_NO_FEE_APPLICATION' as const,issues,pair:structuredClone(pair),review:pair.version==='1.1'?reviewContainerCostReviewPlan(pair.review_plan!,containerCostPairBusiness(pair)):null};
}
/** One bounded sheet keeps the complete workbook within the existing 16-sheet limit. */
export function containerPairWorkbookSheet(pair:ContainerCostPair,project:ProjectFile,bill?:ContainerBillDraft):WorkbookSheet {
 const s=containerPairSnapshot(pair,project,bill),row=(values:string[])=>[...values,...Array(8-values.length).fill('')].map(t);
 const rows=[row(['口径','内部核对假设，不写费用；只含已保存配对，未提交编辑不在此报告']),row(['当前资料',s.issues.join('；')||'与已捕获快照一致']),row(['业务修订',String(pair.revision),'配对版本 '+pair.version]),row(['核对修订',String(pair.review_plan?.revision??'未启用')])];
 for(const r of pair.review_plan?.records??[]){const status=s.review?.records.find(x=>x.record_id===r.record_id);rows.push(row(['核对记录',r.record_id,r.decision,JSON.stringify(r.target),r.explanation,r.evidence.reference,s.issues.length?'当前资料失配，历史记录待复核':status?.status==='RECORDED_ASSUMPTION'?'已记录用户来源假设':'待复核',[...(status?.issues??[]),'原待办不清除，不应用费用'].join('；')]));}
 const points=Array.from(serializeContainerCostPair(pair));for(let i=0;i<points.length;i+=240)rows.push(row(['完整配对JSON片段',String(i/240+1),points.slice(i,i+240).join('')]));
 return{name:'配对与核对记录',headers:['类别','编号/值','类型/JSON片段','目标','说明','来源','状态','待办'],widths:[26,35,100,65,80,80,48,85],rows,freezeColumns:2};
}
