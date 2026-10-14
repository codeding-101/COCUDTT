import type {ContainerBillDraft} from '../domain/container-bill-draft.js';
import type {ProjectFile} from './project-file.js';
import {reviewContainerBillDraft} from '../engine/container-bill-draft.js';
import {serializeContainerBillDraft} from './container-bill-file.js';
import {textCell as t,type WorkbookCell,type WorkbookSheet} from './xlsx-file.js';
/** Original-currency amounts stay explicit text; this sheet never adds them into cost totals. */
export function containerBillWorkbookSheets(project:ProjectFile,file:ContainerBillDraft):WorkbookSheet[] {
 const r=reviewContainerBillDraft(file,project),summary:WorkbookCell[][]=[[t('说明'),t('独立内部假设；未写入项目费用，不合计币种/联合与分开项'),t(r.issues.join('；')),t('不是专业认证或推荐')]];
 for(const row of r.rows){const a=row.calculation;summary.push([t(row.line_id),t(a?a.amount+' '+a.input.currency:'条件待补，无金额'),t([row.input_issue??'',...row.source_issues,...(row.cost_reference?[...row.cost_reference.issues,...row.cost_reference.source_issues]:[])].filter(Boolean).join('；')),t(row.source_current?'账单来源记录与当前快照一致':'账单来源待核对')]);
  if(a){summary.push([t(row.line_id),t('箱数 '+a.container_count+'；每箱 '+a.per_container_amount+'；收费日 '+(a.billable_days??'不按日')),t('所选日 '+(a.selected_days??'不按日')+'；消耗免费 '+(a.consumed_free_days??'不适用')+'；未用免费 '+(a.unused_free_days??'不适用')),t('原币，无自动舍入')]);for(const tier of a.tier_totals)summary.push([t(row.line_id+' 阶'+(tier.tier_index+1)),t(tier.days+'天 × '+tier.rate+' /箱；每箱 '+tier.per_container_amount+'；整行 '+tier.amount),t('边际阶梯'),t(a.input.currency)]);}
  if(row.cost_reference)summary.push([t(row.line_id+' 已有费用引用'),t(row.cost_reference.cost_id),t('已含于 '+(row.cost_reference.existing_containment??'未指定')+'；报价内含 '+String(row.cost_reference.included_in_quoted_price)),t('只读引用，未写成本')]);
 }
 for(const p of r.potential_overlaps)summary.push([t('候选 '+p.line_ids.join(' ↔ ')),t(p.reason),t(p.container_ids.join('、')+'；'+(p.start_date??'固定项')+' → '+(p.end_date??'固定项')),t('保留待核对，不减金额')]);
 const sheets:WorkbookSheet[]=[{name:'集装箱账单',headers:['行/记录','原币金额/假设','待办/范围','口径'],widths:[28,85,100,50],rows:summary,freezeColumns:1}];
 const days:WorkbookCell[][]=[];for(const row of r.rows)for(const day of row.calculation?.days??[])days.push([t(row.line_id),t(day.date),t(String(day.period_day)),t(day.billable_day===null?'不适用':String(day.billable_day)),t(day.status),t(day.tier_day===null?'不适用':String(day.tier_day)),t(day.tier_index===null?'不适用':String(day.tier_index+1)),t(day.rate??'不适用'),t(day.per_container_amount),t(day.amount),t(row.calculation!.input.currency)]);
 // 50×3660 max: four bounded daily sheets; with existing nine sheets total remains <=16.
 for(let start=0;start<days.length;start+=50000)sheets.push({name:'账单逐日'+(start/50000+1),headers:['账单行','日期','期间日','收费日','状态','阶梯日','阶','原日率/箱','每箱金额','整行金额','原币'],widths:[28,18,12,12,14,12,12,28,28,28,12],rows:days.slice(start,start+50000),freezeColumns:1});
 const points=Array.from(serializeContainerBillDraft(file)),snapshot:WorkbookCell[][]=[];for(let i=0;i<points.length;i+=240)snapshot.push([t(String(i/240+1)),t(points.slice(i,i+240).join(''))]);
 sheets.push({name:'账单输入快照',headers:['片段序号','完整账单JSON（按序拼接，内部资料）'],widths:[14,120],rows:snapshot,freezeColumns:1});return sheets;
}
