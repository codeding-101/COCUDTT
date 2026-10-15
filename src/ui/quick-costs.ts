import type {ProjectFile} from '../data/project-file.js';
import type {CostItem} from '../domain/cost-item.js';
import type {AnalysisResult} from '../engine/analyze.js';
import {dec,escapeHtml as h} from './format.js';
import {fieldHelpButton} from './field-help.js';

export const QUICK_COST_KINDS=['carriage','insurance'] as const;
export type QuickCostKind=typeof QUICK_COST_KINDS[number];
const category={carriage:'MAIN_CARRIAGE',insurance:'INSURANCE'} as const;
const label={carriage:'主要运费',insurance:'保险费'} as const;
export function isQuickCostKind(value:unknown):value is QuickCostKind{return value==='carriage'||value==='insurance';}
export function quickCostRows(project:ProjectFile,kind:QuickCostKind):CostItem[]{return project.items.filter(item=>item.cost_category===category[kind]);}
/** Availability is deliberately conservative. No grouping, conversion or fee inference. */
export function quickCostBlock(project:ProjectFile,item:CostItem):string|null{
 if(project.items.filter(row=>row.cost_id===item.cost_id).length!==1)return'费用编号重复，请在完整明细修正';
 if(item.source!=='USER'||item.is_goods_value)return'系统生成费用或货值项仅在完整明细核对';
 if(item.applicable_incoterms!==undefined&&!item.applicable_incoterms.includes(project.incoterm))return'当前术语未启用这笔费用';
 if(item.pricing_method!=='FIXED'&&item.pricing_method!=='ACTUAL')return'非固定或实际金额计价，请在完整明细编辑参数';
 if(item.contained_in_cost_id!==undefined)return'这笔费用已含于另一项，请核对完整包含关系';
 if(item.alternative_group?.trim()||item.dedup_group?.trim())return'存在替代报价组或去重组，请在完整明细核对';
 if(item.container_charge||item.includes_port_charges)return'存在集装箱或港杂范围，请在完整明细核对';
 if(project.items.some(row=>row.contained_in_cost_id===item.cost_id||row.calculation_base?.kind==='COST_ITEMS'&&row.calculation_base.ids.includes(item.cost_id)))return'其他费用包含或引用这笔费用，请在完整明细核对';
 return null;
}

export class QuickCostsController {
 private project:ProjectFile|null=null;
 private selected:Partial<Record<QuickCostKind,string>>={};
 private epoch=0;
 private message='';
 private sync(project:ProjectFile):void{if(this.project!==project){this.project=project;this.selected={};this.message='';}}
 choose(project:ProjectFile,kind:unknown,id:string,lease:string|undefined):boolean{
  if(!isQuickCostKind(kind)||this.project!==project||lease!==String(this.epoch))return false;
  if(id&&!quickCostRows(project,kind).some(item=>item.cost_id===id))return false;
  if(id)this.selected[kind]=id;else delete this.selected[kind];this.message='';return true;
 }
 editTarget(project:ProjectFile,kind:unknown,id:string|undefined,lease:string|undefined):string|null{
  if(!isQuickCostKind(kind)||this.project!==project||lease!==String(this.epoch)||!id||this.selected[kind]!==id){this.message='快捷视图已更新，请重新选择费用；原记录未改动。';return null;}
  const item=quickCostRows(project,kind).find(row=>row.cost_id===id);
  const reason=item?quickCostBlock(project,item):'这笔费用已不在当前范围';
  if(reason){this.message=reason+'；请使用完整明细。';return null;}
  this.message='已按原币修改选中的既有费用；其他费用、报价与货值未联动。';return id;
 }
 render(project:ProjectFile,result:AnalysisResult|null):string{
  this.sync(project);const lease=String(++this.epoch);
  return `<details class="panel quick-costs" data-evidence-section="quick-costs"><summary><span class="panel-title">主要运费与保险费 · 快捷编辑</span><span class="hint">先明确选择一笔既有费用</span></summary><div class="panel-body">
   <p class="hint block">每次只改选中记录的原币金额；不自动合并、换币或新建费用，不联动货值与报价。缺少费用请先到完整明细明确添加。</p>
   ${this.message?`<p class="quick-cost-message" role="status">${h(this.message)}</p>`:''}
   <div class="quick-cost-grid">${QUICK_COST_KINDS.map(kind=>{
    const rows=quickCostRows(project,kind),item=rows.find(row=>row.cost_id===this.selected[kind]);if(!item)delete this.selected[kind];
    const block=item?quickCostBlock(project,item):null,resolved=item?result?.items.find(row=>row.item.cost_id===item.cost_id):undefined;
    return `<section data-quick-cost-section="${kind}"><h3>${label[kind]}</h3><label class="field">选中费用（${rows.length}项，不表示合计）<select data-quick-cost-kind="${kind}" data-quick-cost-field="choose" data-quick-cost-lease="${lease}"><option value="">请先选择，不自动猜测</option>${rows.map(row=>`<option value="${h(row.cost_id)}"${row.cost_id===item?.cost_id?' selected':''}>${h(row.cost_name)} · ${h(row.currency)} · ${h(row.cost_id)}</option>`).join('')}</select></label>
     ${!rows.length?'<p class="hint">没有这一类别的既有费用；不会当作已核实的零费用。</p>':!item?'<p class="hint">按费用编号选择一笔记录。多笔费用分别核对，不自动合并。</p>':`<p class="quick-cost-context">费用编号 ${h(item.cost_id)} · 原币 ${h(item.currency)}${rows.length>1?' · 其他同类费用保持':''}</p>${block?`<p class="quick-cost-block">${h(block)}；请使用完整明细。</p>`:`<label class="field">${label[kind]}原币金额（${h(item.currency)}）<input type="text" inputmode="decimal" class="num" value="${h(String(item.amount??''))}" data-quick-cost-kind="${kind}" data-quick-cost-field="amount" data-quick-cost-id="${h(item.cost_id)}" data-quick-cost-lease="${lease}"></label><p class="hint">${resolved?`本次核算金额 ${dec(resolved.base_amount)} ${h(result!.base_currency)}；`:'当前尚无可用计算结果；'}${item.included_in_quoted_price?'原记录标记含于报价，请另核对报价勾稽。':'报价包含按完整方案核对。'}</p>`}`}
    </section>`;
   }).join('')}</div><div class="panel-actions"><button data-action="show-cost-settings">查看完整费用明细 →</button>${fieldHelpButton('responsibility','quick-cost-responsibility','费用归属说明')}</div></div></details>`;
 }
}
