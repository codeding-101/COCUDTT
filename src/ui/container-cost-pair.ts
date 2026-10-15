import type {ContainerCostPairController} from './container-cost-pair-controller.js';
import {escapeHtml as h} from './format.js';
export function renderContainerCostPairPanel(controller:ContainerCostPairController):string {
 const p=controller.pair,r=controller.review,issues=controller.liveIssues(),disabled=controller.busy?' disabled':'',b=(action:string,label:string,extra='')=>`<button data-action="${action}"${extra}${disabled}>${label}</button>`;
 return `<details class="panel container-cost-pair-panel" data-evidence-section="container-cost-pair"><summary><span class="panel-title">项目＋账单配对交接 · 提案只读</span></summary><div class="panel-body">
 <p>一份内部JSON保存项目、账单与提案。打开会替换当前项目和账单，并重置付款/资金计划、假设参数及客户公开输入，请先另存自己的资料。提案不会新增费用或改变费用承担、税务及推荐。</p>
 <p>独立自动草稿仅恢复快照，不自动替换项目/账单；另存拷贝保持身份，不代表新业务。配对打开的原汇率簿在未修改汇率行时保持原值；实际编辑后沿用汇率编辑器的重组，原簿名/扩展请保留在原修订中。未填完或重复汇率行须先修正，原行保留在草稿/恢复备份，不能静默丢弃后交接。</p>
 <p data-pair-status role="status">${h(controller.message)}</p><div class="panel-actions">${b('pair-open','打开完整配对 JSON（先另存）')}${b('pair-new','新建配对记录（空选择，先另存）')}${b('pair-capture','捕获当前完整修订')}${b('pair-add-references','明确加入已有费用引用（只读）')}${p?b('pair-save','另存完整配对 JSON',issues.length?' disabled':''):''}${p?b('pair-clear','清空配对快照（保留项目/账单）'):''}</div><input id="pair-file-input" type="file" accept=".json,application/json" hidden>
 ${p?`<p>配对 ${h(p.pair_id)} · 修订${p.revision} · 项目 ${h(p.project.name)} · 账单 ${h(p.bill.id)}</p><p data-pair-live>${issues.length?'当前资料与快照失配：'+h(issues.join('；'))+'；须明确捕获当前修订，旧提案不能当当前核对结果。':'当前项目和账单与已捕获快照一致；仍须查看提案待办，不是业务认证。'}</p>
 <p>映射${p.mapping.entries.length}项，删除保留${p.retired_mappings.length}项；先移除悬空选择再捕获，已删除的新建目标编号不可复用。本轮不编辑新建费用提案、不执行费用应用。</p>
 <p>以下为已捕获修订的只读提案待办：${h(r?.proposal.issues.join('；')??'')}</p><table class="grid stackable"><thead><tr><th>账单行/目标</th><th>操作/原金额</th><th>待办</th><th>选择</th></tr></thead><tbody>${r?.proposal.rows.map(row=>`<tr><th>${h(row.line_id)} → ${h(row.cost_id)}</th><td data-label="操作/原金额">${row.operation==='CREATE_NEW'?'待新建（未写费用）':'已有只读引用'} · ${h(row.original_amount??'无金额')}（原币）</td><td data-label="待办">${h([...row.issues,...row.source_issues].join('；')||'本次未发现问题，仍未应用')}</td><td data-label="选择">${b('pair-remove-selection','移除选择（保留历史）',` data-pair-line="${h(row.line_id)}"`)}</td></tr>`).join('')??''}</tbody></table>`:'<p>先录入或打开独立账单，再捕获一份配对快照；未确认条件及未知口径保留待办。</p>'}
 </div></details>`;
}
