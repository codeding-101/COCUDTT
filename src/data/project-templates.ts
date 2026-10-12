import { newChinaImportProjectFile, chinaImportSampleProjectFile } from './sample-project.js';
import { COST_PRESETS, presetToCostItem } from './cost-presets.js';
import { validateProjectStructure } from './project-validation.js';
import { serializeProject, type ProjectFile } from './project-file.js';

export const PROJECT_TEMPLATES = [
 {id:'china-import-blank',title:'中国进口 · 空白录入',kind:'空白模板',description:'货物、日期、金额、汇率与税率均待填写，业务制度和资格待确认。'},
 {id:'china-import-container-checklist',title:'中国进口 · 集装箱费用核对',kind:'空白核对清单',description:'THC、分开D&D、查验和报关代理的待填行；核对是否发生、是否已含及实际收费范围，不默认金额或承担方。'},
 {id:'china-import-actual-quotes',title:'中国进口 · 实际报价比较',kind:'空白模板',description:'使用实际报价基准，但所有术语报价保持缺失；指定地点、有效期、来源、运输和保险资料均需录入。'},
 {id:'china-import-synthetic-example',title:'中国进口 · 合成公式演示',kind:'合成示例',description:'虚构货值、运保费、税率和汇率，来源标记为示例，用于公式核对，不是商品税则或真实成交数据。'},
] as const;
export const TEMPLATE_GENERATED_AT='2026-10-12T00:00:00Z';
/** Deterministic files, independent of the current project, local draft or public fields. */
export function createProjectTemplate(id:string):ProjectFile {
 const entry=PROJECT_TEMPLATES.find(t=>t.id===id);if(!entry)throw Error('未知项目模板，请选择目录中的模板');
 const project=id==='china-import-synthetic-example'?chinaImportSampleProjectFile():newChinaImportProjectFile();
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
export function projectTemplateCatalog():unknown {return {version:'1.0',schema_version:'0.8',generated_at:TEMPLATE_GENERATED_AT,templates:PROJECT_TEMPLATES.map(t=>({...t,file:`${t.id}.json`})),notes:['空白模板不表示交易条件已成立或费用为零。','合成示例不代表真实税率、汇率、税则归类或实际报价。','先保存当前项目，再通过打开项目导入模板；下载模板不替换当前内容。','客户公开字段、预览检查和假设控件目前不保存在项目JSON中。']};}
