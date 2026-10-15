import {escapeHtml as h} from './format.js';
export const FIELD_HELP={
 value:{title:'货值与合同报价',text:['货值和报价分别录入。中国进口口径需要不含运费、保险费的货物净价；整价已含运保费时请先拆分并核对。','修改货值不会自动改写报价，也不会自动创建费用。未确认净价口径时保留待核对状态。']},
 anchor:{title:'比较基准',text:['固定报价：假设各术语使用同一报价金额，再比较费用承担。固定目标毛利率：在方案对比中反推各术语报价，例如0.2表示20%。','顶部与当前摘要仍使用录入报价。实际报价和固定买方支付在专业模式中选择；比较假设不等于实际合同。']},
 fx:{title:'商业汇率与海关汇率',text:['原币金额、核算币种与计税币种分别保留。报价及费用按所选商业汇率解析；中国进口计税另核对海关汇率和申报日期。','汇率须为正数。不要用市场或合同汇率代替海关汇率；日期与来源改变后重新核对适用条件。']},
 responsibility:{title:'费用归属与报价包含',text:['费用名称不能决定由谁承担。请核对贸易术语、作业节点、发生原因及有效合同约定。谁付款、谁承担和货损风险分别判断。','含于报价、含于另一笔费用与海关加计是不同口径。快捷金额只改选中的记录，完整明细仍保留原关系和待办。']},
 variant:{title:'运输条款变形',text:['Stowed、Trimmed等附加条件须按合同明确装卸作业与费用范围，不凭名称推断所有责任。','本工具的变形字段不会自动改写风险转移点。合同如另有风险约定，应单独记录并专业复核；FOB不能被解释成工厂交货。']},
 tax:{title:'中国进口税务口径',text:['当前中国一般贸易进口模式针对单商品一票；请核对申报日期、货物净价、运保费及其他加计项目、币种、税率、原产地和待遇资格。','税率与可抵扣资格由实际资料核实；示例数值不是实际适用税率。费用承担、报价包含不直接决定是否加计税基，其他国家税制未全面核验。']},
 source:{title:'来源核对与确认',text:['填写来源文件、条款或页面、适用期间和核对日期，再明确记录人工核对状态。示例不是真实业务证据。','程序只检查记录及其与当前数值的绑定，不认证来源或法律效力。修改依据或业务数据后，按提示重新核对；确认不能替代真实合同、税务或保单复核。']},
} as const;
export type FieldHelpTopic=keyof typeof FIELD_HELP;
export function fieldHelpButton(topic:FieldHelpTopic,anchor:string,label='字段说明'):string{return `<button type="button" class="field-help-trigger" data-action="show-field-help" data-help-topic="${topic}" data-help-anchor="${h(anchor)}" aria-label="${h(label)}" aria-haspopup="dialog" aria-controls="field-help-dialog">?</button>`;}
export function helpField(body:string,topic:FieldHelpTopic,anchor:string):string{return `<div class="field-help-wrap">${body}${fieldHelpButton(topic,anchor,FIELD_HELP[topic].title+'说明')}</div>`;}

/** UI-only state. Native modal handles Escape; Tab stays within its controls. */
export class FieldHelpController{
 private topic:FieldHelpTopic|null=null;private anchor='';private bound=new WeakSet<HTMLDialogElement>();
 private contents():string{
  const topic=this.topic?FIELD_HELP[this.topic]:null;
  return `<header><h2 id="field-help-title">${topic?h(topic.title):'字段说明'}</h2><button type="button" data-action="close-field-help">关闭说明</button></header><div id="field-help-content">${topic?topic.text.map(text=>`<p>${h(text)}</p>`).join(''):''}</div>`;
 }
 render():string{return `<dialog id="field-help-dialog" aria-labelledby="field-help-title" aria-describedby="field-help-content">${this.contents()}</dialog>`;}
 afterRender():void{
  const dialog=document.querySelector<HTMLDialogElement>('#field-help-dialog');if(!dialog)return;
  if(!this.bound.has(dialog)){this.bound.add(dialog);dialog.addEventListener('close',()=>{if(!dialog.isConnected)return;const anchor=this.anchor;this.topic=null;this.anchor='';this.restore(anchor);});dialog.addEventListener('keydown',event=>{if(event.key!=='Tab')return;const buttons=[...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];if(!buttons.length)return;const index=buttons.indexOf(document.activeElement as HTMLButtonElement);event.preventDefault();buttons[(index+(event.shiftKey?-1:1)+buttons.length)%buttons.length]?.focus();});}
  if(this.topic&&!dialog.open&&typeof dialog.showModal==='function')dialog.showModal();
 }
 open(topic:string|undefined,anchor:string|undefined):boolean{
  if(!topic||!Object.hasOwn(FIELD_HELP,topic)||!anchor)return false;
  const dialog=document.querySelector<HTMLDialogElement>('#field-help-dialog');if(!dialog||typeof dialog.showModal!=='function')return false;
  this.topic=topic as FieldHelpTopic;this.anchor=anchor;dialog.innerHTML=this.contents();this.afterRender();return true;
 }
 dismiss(restore=true):void{
  const anchor=this.anchor;this.topic=null;this.anchor='';const dialog=document.querySelector<HTMLDialogElement>('#field-help-dialog');if(dialog?.open)dialog.close();if(restore)this.restore(anchor);
 }
 private restore(anchor:string):void{if(anchor)[...document.querySelectorAll<HTMLElement>('[data-help-anchor]')].find(el=>el.dataset.helpAnchor===anchor)?.focus({preventScroll:true});}
}
