import { newChinaImportProjectFile, chinaImportSampleProjectFile, sampleProjectFile } from './sample-project.js';
import { TEMPLATE_GUIDES } from './template-guides.js';
import type { SourceEvidence } from '../domain/source-evidence.js';
import { COST_PRESETS, presetToCostItem } from './cost-presets.js';
import { validateProjectStructure } from './project-validation.js';
import { serializeProject, type ProjectFile } from './project-file.js';

export const PROJECT_TEMPLATES = [
 {id:'china-import-blank',title:'中国进口 · 空白录入',kind:'空白模板',description:'货物、日期、金额、汇率与税率均待填写，业务制度和资格待确认。'},
 {id:'china-import-container-checklist',title:'中国进口 · 集装箱费用核对',kind:'空白核对清单',description:'THC、分开D&D、查验和报关代理的待填行；核对是否发生、是否已含及实际收费范围，不默认金额或承担方。'},
 {id:'china-import-actual-quotes',title:'中国进口 · 实际报价比较',kind:'空白模板',description:'使用实际报价基准，但所有术语报价保持缺失；指定地点、有效期、来源、运输和保险资料均需录入。'},
 {id:'china-import-synthetic-example',title:'中国进口 · 合成公式演示',kind:'合成示例',description:'虚构货值、运保费、税率和汇率，来源标记为示例，用于公式核对，不是商品税则或真实成交数据。'},
 {id:'professional-blank',title:'空白专业模板 · 通用成本',kind:'空白模板',description:'不填业务金额、税率、日期、费用或汇率；通用口径不代表任何国家完整税制。'},
 {id:'cif-synthetic-example',title:'CIF · 运保合成演示',kind:'合成示例',description:'虚构货值、运费及直接录入的保险费；不是完整的中国出口税务流程。'},
] as const;
export const TEMPLATE_GENERATED_AT='2026-10-12T00:00:00Z';
/** Deterministic files, independent of the current project, local draft or public fields. */
export function createProjectTemplate(id:string):ProjectFile {
 const entry=PROJECT_TEMPLATES.find(t=>t.id===id);if(!entry)throw Error('未知项目模板，请选择目录中的模板');
 const project=id==='china-import-synthetic-example'?chinaImportSampleProjectFile():newChinaImportProjectFile();
 if(id==='professional-blank'){
  project.tax_profile.id='generic-blank';project.tax_profile.import.calculationMode='LEGACY';
  project.tax_profile.export.dutyRates.fallback='';project.tax_profile.export.rebate.vatRates.fallback='';project.tax_profile.export.rebate.rebateRates.fallback='';
 }
 if(id==='cif-synthetic-example'){
  Object.assign(project,sampleProjectFile());project.export_date='2026-09-10';project.tax_profile.import.calculationMode='LEGACY';
  const evidence=():SourceEvidence=>({status:'EXAMPLE',reference:'内置虚构CIF数据，仅作通用成本演示',valid_from:'2026-08-01',valid_to:'2026-09-30',checked_on:''});
  project.tax_profile.import.rateEvidence=evidence();for(const row of project.tax_profile.import.hsTable?.entries??[])row.evidence=evidence();
  for(const book of project.fx_books)book.evidence=Object.fromEntries(Object.keys(book.rates).map(pair=>[pair,evidence()]));
 }
 project.name=`${entry.kind}：${entry.title}`;project.updated_at=TEMPLATE_GENERATED_AT;
 if(id==='china-import-actual-quotes'){project.anchor={kind:'ACTUAL_QUOTES'};project.term_scenarios={};}
 if(id==='china-import-container-checklist'){
  const keys=['thc-origin','thc-destination','container-demurrage','container-detention','destination-customs-inspection','import-customs-broker'];
  project.items=keys.map(key=>{const preset=COST_PRESETS.find(p=>p.key===key);if(!preset)throw Error('费用核对模板缺少预设');
   const item=presetToCostItem(preset,{cost_id:key,currency:'CNY',base_currency:'CNY',fx_type:'CONTRACT',amount:'',overrides:{pricing_method:'ACTUAL',notes:'待核对：是否发生、合同是否已含、原始账单范围、币种、节点及原因；不适用可删除。空金额不表示零费用。'}});
   delete item.occurrence_reason;return item;
  });
 }
 validateProjectStructure(project);return project;
}
export function projectTemplateText(id:string):string {return serializeProject(createProjectTemplate(id));}
/** Recognize only an unchanged issued template, never a filename or a reused name. */
export function importedTemplateNote(project:ProjectFile):string|null {
 const entry=PROJECT_TEMPLATES.find(t=>project.name===`${t.kind}：${t.title}`);
 if(!entry||serializeProject(project)!==projectTemplateText(entry.id))return null;
 return `已打开模板：${entry.title}。${entry.description} 先查看全部模板中的预设与使用前核对，再填写真实资料。`;
}
export function projectTemplateCatalog():unknown {return {version:'1.1',schema_version:'0.8',generated_at:'2026-10-16T00:00:00Z',templates:PROJECT_TEMPLATES.map(t=>({...t,file:`${t.id}.json`,guidance:structuredClone(TEMPLATE_GUIDES[t.id])})),notes:['空白模板不表示交易条件已成立或费用为零。','合成示例不代表真实税率、汇率、税则归类或实际报价。','先保存当前项目，再通过打开项目导入模板；下载模板不替换当前内容。','客户公开字段、预览检查和假设控件目前不保存在项目JSON中。','目录说明版本1.1不改变项目文件格式0.8；文件中的固定生成时间不代表业务日期。']};}
