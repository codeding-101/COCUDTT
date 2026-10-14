import {emptyContainerBillDraft,type ContainerBillDraft} from '../domain/container-bill-draft.js';
import {emptyEvidence} from '../domain/source-evidence.js';
import {serializeContainerBillDraft} from './container-bill-file.js';
export const CONTAINER_BILL_TEMPLATES=['container-bill-empty','container-bill-synthetic-example'] as const;
export function containerBillTemplate(id:string):ContainerBillDraft {
 if(!(CONTAINER_BILL_TEMPLATES as readonly string[]).includes(id))throw Error('CONTAINER_BILL_TEMPLATE_UNKNOWN');
 const file=emptyContainerBillDraft(id);file.name=id==='container-bill-empty'?'集装箱账单空草稿':'集装箱账单合成例题';
 if(id==='container-bill-empty'){
  file.rows=[{input:{line_id:'bill-1'},evidence:emptyEvidence()}];
  file.notes='先逐项录入原始计费条件；缺条件不补零。独立草稿不是项目JSON，尚未接入工具。';
 }else{
  file.review_date='2026-10-14';file.rows=[{input:{line_id:'synthetic-dd-1',scope_id:'synthetic-dd',direction:'IMPORT',equipment_type:'40HC (synthetic)',container_ids:['SYNTHETIC-A','SYNTHETIC-B'],currency:'USD',reference:'合成免费期及阶梯条件，非承运人费率',charge_kind:'DEMURRAGE',mode:'DAILY',
   period:{start_date:'2026-10-01',end_date:'2026-10-08',start_included:true,end_included:true,start_event:'人工指定计期起点',end_event:'人工指定计期终点'},
   daily:{free_day_basis:'CALENDAR_DAYS',charge_day_basis:'CALENDAR_DAYS',free_days:2,tier_mode:'MARGINAL',tier_basis:'AFTER_FREE_TIME',tiers:[{through_day:2,rate:'10'},{through_day:4,rate:'20'},{through_day:null,rate:'30'}]}},
   evidence:{reference:'合成学习条件；没有真实账单',valid_from:'2026-10-01',valid_to:'2026-10-31',checked_on:'2026-10-14',status:'EXAMPLE'}}];
  file.notes='固定手算：每箱2×10+2×20+2×30=120 USD，两箱240 USD。仅假设，来源EXAMPLE，不代表费用已计入或确认。';
 }
 return file;
}
export function containerBillTemplateText(id:string):string {return serializeContainerBillDraft(containerBillTemplate(id));}
