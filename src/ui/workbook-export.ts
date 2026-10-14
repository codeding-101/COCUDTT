import { customerWorkbook, internalWorkbook } from '../data/workbook-snapshot.js';
import { decimalCell as n, serializeWorkbook, textCell as t, type WorkbookSnapshot } from '../data/xlsx-file.js';
import type { CustomerQuote } from '../domain/customer-quote.js';
import type { ProjectFile } from '../data/project-file.js';
import { projectSensitivity, type SensitivityControls } from './sensitivity.js';
import type { SettlementPlan } from '../domain/settlement.js';
import { settlementWorkbookSheets } from '../data/settlement-workbook.js';

export function createCustomerWorkbook(quote:CustomerQuote,generatedAt=new Date().toISOString()):Uint8Array<ArrayBuffer> {
  return serializeWorkbook(customerWorkbook(quote,generatedAt));
}
export function internalWorkbookSnapshot(project:ProjectFile,generatedAt=new Date().toISOString(),hypothesis?:SensitivityControls,plan?:SettlementPlan):WorkbookSnapshot {
  const workbook=internalWorkbook(project,generatedAt);
  if(hypothesis?.enabled){
    const note=(label:string,value:string)=>[t(label),t(value),t(''),t(''),t(''),t(''),t(''),t('')];
    const rows=[note('说明','假设参考，不能作为确定推荐；不写回原项目。'),note('参数快照',JSON.stringify(hypothesis))];
    try{
      const result=projectSensitivity(project,hypothesis);rows.push(note('调整口径',result.adjustment_note));
      for(const point of [result.baseline,...result.points]){
        if(point.error){rows.push(note(point.label,'无法计算：'+point.error));continue;}
        for(const row of point.rows)for(const [label,metric] of [['报价',row.quote],['卖方利润',row.profit],['买方总支付',row.payment],['抵扣后成本',row.net_payment],['进口税额',row.tax],['完税价格',row.dutiable]] as const){
          const cell=(value:typeof metric.value)=>value===null?t('未知/不适用'):n(value.toFixed());
          rows.push([t(point.label+' · '+row.incoterm),t(label),cell(metric.value),cell(metric.delta),cell(metric.percent),t(result.base_currency+'（变化百分比以%为单位）'),t(point.hypothetical?'假设参考':row.checks_passed?'基准通过当前检查':'基准参考'),t(row.issues.join('\n'))]);
        }
      }
    }catch(error){rows.push(note('假设未完成',error instanceof Error?error.message:String(error)));}
    workbook.sheets.push({name:'假设分析',headers:['情景','指标/参数','结果','相对基准变化','相对基准变化(%)','单位','状态','待办'],widths:[26,50,22,22,22,36,30,80],rows,freezeColumns:2});
  }
  if (plan) workbook.sheets.push(...settlementWorkbookSheets(project,plan));
  return workbook;
}
export function createInternalWorkbook(project:ProjectFile,generatedAt=new Date().toISOString(),hypothesis?:SensitivityControls,plan?:SettlementPlan):Uint8Array<ArrayBuffer> {
  return serializeWorkbook(internalWorkbookSnapshot(project,generatedAt,hypothesis,plan));
}
