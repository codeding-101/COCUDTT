import type {ContainerCostPairController} from './container-cost-pair-controller.js';
import {escapeHtml as h} from './format.js';
import {COST_CATEGORIES,COST_CATEGORY_LABELS,TRADE_NODES,TRADE_NODE_LABELS,FX_TYPES,FX_TYPE_LABELS,OCCURRENCE_REASONS,OCCURRENCE_REASON_LABELS} from '../domain/enums.js';
import {containerCostEditorIsCurrent,type CostEditorField} from '../data/container-cost-editor.js';
function renderEditor(controller:ContainerCostPairController):string {
 const e=controller.editor;if(!e)return '';const f=e.fields;
 const field=(key:CostEditorField,label:string)=>`<label>${h(label)}<input data-pair-editor-field="${key}" value="${h(f[key])}" maxlength="4000"></label>`;
 const choose=(key:CostEditorField,label:string,options:readonly string[],labels:Record<string,string>={})=>`<label>${h(label)}<select data-pair-editor-field="${key}"><option value="">请选择，未知请保留空白</option>${[...options,...(f[key]&&!options.includes(f[key])?[f[key]]:[])].map(v=>`<option value="${h(v)}"${f[key]===v?' selected':''}>${h(labels[v]??v)}</option>`).join('')}</select></label>`;
 const b=(action:string,label:string)=>`<button data-action="${action}"${controller.busy?' disabled':''}>${h(label)}</button>`;
 return `<section data-pair-editor><h3>未提交的新建费用提案 · ${h(e.line_id)}</h3>
 <p>独立编辑草稿自动保存在此浏览器；尚未包含在配对文件中。须提交或明确放弃后才能另存/打开配对。${!controller.pair||!containerCostEditorIsCurrent(e,controller.pair)||controller.liveIssues().length?'当前修订失配：保留编辑原值；请放弃编辑、捕获当前修订后重开。':'绑定当前配对修订。'}</p>
 <p>新建仅支持固定原币金额、用户自定义、合同明确单方承担、当前术语及独立未含报价。编辑导入提案时，未提供控件的原字段会保留，相关待办不会自动清除。</p>
 <div class="panel-actions">${b('pair-editor-facts','明确取用账单原币事实（不确认来源）')}${b('pair-editor-submit','提交完整提案（不应用费用）')}${b('pair-editor-discard','放弃未提交编辑（保留已保存选择）')}</div>
 <p data-pair-editor-facts>原币金额 ${h(f.amount||'未取用')} ${h(f.currency)} · 本位币 ${h(f.base_currency)} · 收费 ${h(f.container_charge)} / ${h(f.container_charge_scope)} · 术语 ${h(f.applicable_term)}。精度不舍入；超过核心6位保留阻断。</p>
 <div class="bill-fields">${field('cost_id','新建目标编号（不得复用已删除编号）')}${field('cost_name','费用名称')}${field('amount','原币精确金额（须与账单核对）')}
 ${choose('cost_category','费用类别',COST_CATEGORIES,COST_CATEGORY_LABELS)}${choose('trade_node','发生节点',TRADE_NODES,TRADE_NODE_LABELS)}${choose('occurrence_reason','发生原因',OCCURRENCE_REASONS,OCCURRENCE_REASON_LABELS)}
 ${choose('responsibility','合同责任承担方',['SELLER','BUYER'],{SELLER:'卖方',BUYER:'买方'})}${choose('payment_party','实际支付方',['SELLER','BUYER'],{SELLER:'卖方',BUYER:'买方'})}${choose('economic_bearer','经济承担方',['SELLER','BUYER'],{SELLER:'卖方',BUYER:'买方'})}
 ${choose('tax_included','金额含税口径',['true','false'],{true:'含税',false:'不含税'})}${choose('customs_value','海关计税价格处理（须核对是否已含货值）',['ADD','EXCLUDE'],{ADD:'明确加计未含货值的费用',EXCLUDE:'明确排除，不加计'})}${choose('fx_type','本费用换算汇率类型（不填汇率数值）',FX_TYPES,FX_TYPE_LABELS)}
 ${choose('basis','适用范围确认',['ACCEPT'],{ACCEPT:'按上述受限范围提交；导入的其他字段仍保留待核对'})}${field('note','提案说明及承担/税务依据')}
 ${field('reference','来源文件或条款定位')}${field('valid_from','来源有效开始 YYYY-MM-DD')}${field('valid_to','来源有效结束 YYYY-MM-DD')}${field('checked_on','核对日期 YYYY-MM-DD')}</div>
 <p>编辑不自动确认来源；修改后旧确认失效。提交后须另行点击确认当前提案来源；示例不能直接确认，快照不代表专业认证。来源确认也不会消除费用重叠、报价包含及精度待办。</p>
 ${e.original?`<details><summary>编辑前完整选择（内部，仅核对）</summary><pre class="pair-original">${h(JSON.stringify(e.original,null,2))}</pre></details>`:''}</section>`;
}
export function renderContainerCostPairPanel(controller:ContainerCostPairController):string {
 const p=controller.pair,r=controller.review,issues=controller.liveIssues(),disabled=controller.busy?' disabled':'',b=(action:string,label:string,extra='')=>`<button data-action="${action}"${extra}${disabled}>${label}</button>`;
 return `<details class="panel container-cost-pair-panel" data-evidence-section="container-cost-pair"><summary><span class="panel-title">项目＋账单配对交接 · 提案只读</span></summary><div class="panel-body">
 <p>一份内部JSON保存项目、账单与提案。打开会替换当前项目和账单，并重置付款/资金计划、假设参数及客户公开输入，请先另存自己的资料。提案不会新增费用或改变费用承担、税务及推荐。</p>
 <p>独立自动草稿仅恢复快照，不自动替换项目/账单；另存拷贝保持身份，不代表新业务。配对打开的原汇率簿在未修改汇率行时保持原值；实际编辑后沿用汇率编辑器的重组，原簿名/扩展请保留在原修订中。未填完或重复汇率行须先修正，原行保留在草稿/恢复备份，不能静默丢弃后交接。</p>
 <p data-pair-status role="status">${h(controller.message)}</p><div class="panel-actions">${b('pair-open','打开完整配对 JSON（先另存）')}${b('pair-new','新建配对记录（空选择，先另存）')}${b('pair-capture','捕获当前完整修订')}${b('pair-add-references','明确加入已有费用引用（只读）')}${p?b('pair-save','另存完整配对 JSON',issues.length?' disabled':''):''}${p?b('pair-clear','清空配对快照（保留项目/账单）'):''}</div><input id="pair-file-input" type="file" accept=".json,application/json" hidden>
 ${p?`<p>配对 ${h(p.pair_id)} · 修订${p.revision} · 项目 ${h(p.project.name)} · 账单 ${h(p.bill.id)}</p><p data-pair-live>${issues.length?'当前资料与快照失配：'+h(issues.join('；'))+'；须明确捕获当前修订，旧提案不能当当前核对结果。':'当前项目和账单与已捕获快照一致；仍须查看提案待办，不是业务认证。'}</p>
 <p>映射${p.mapping.entries.length}项，删除保留${p.retired_mappings.length}项；先移除悬空选择再捕获，已删除的新建目标编号不可复用。新建提案可明确编辑，实际费用仍不应用。</p>
 <div class="panel-actions">${p.bill.rows.filter(row=>!p.selection.intents.some(i=>i.line_id===row.input.line_id&&i.operation==='REFERENCE_EXISTING')).map(row=>b('pair-editor-start','编辑新建提案：'+row.input.line_id,` data-pair-line="${h(row.input.line_id)}"${issues.length||controller.editor?' disabled':''}`)).join('')}</div>
 <p>以下为已捕获修订的只读提案待办：${h(r?.proposal.issues.join('；')??'')}</p><table class="grid stackable"><thead><tr><th>账单行/目标</th><th>操作/原金额</th><th>待办</th><th>选择</th></tr></thead><tbody>${r?.proposal.rows.map(row=>`<tr><th>${h(row.line_id)} → ${h(row.cost_id)}</th><td data-label="操作/原金额">${row.operation==='CREATE_NEW'?'待新建（未写费用）':'已有只读引用'} · ${h(row.original_amount??'无金额')}（原币）</td><td data-label="待办">${h([...row.issues,...row.source_issues].join('；')||'本次未发现问题，仍未应用')}</td><td data-label="选择">${b('pair-remove-selection','移除选择（保留历史）',` data-pair-line="${h(row.line_id)}"`)}${row.operation==='CREATE_NEW'?b('pair-confirm-selection','确认当前提案来源（不应用费用）',` data-pair-line="${h(row.line_id)}"${issues.length||controller.editor?' disabled':''}`):''}</td></tr>`).join('')??''}</tbody></table>`:'<p>先录入或打开独立账单，再捕获一份配对快照；未确认条件及未知口径保留待办。</p>'}
 ${renderEditor(controller)}
 </div></details>`;
}
