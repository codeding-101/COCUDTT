import type {ContainerCostPairController} from './container-cost-pair-controller.js';
import {containerReviewEditorIsCurrent,type ReviewEditorField} from '../data/container-review-editor.js';
import {escapeHtml as h} from './format.js';
const labels:Record<string,string>={QUOTE_INCLUDED:'报价已含（不代替海关判断）',KEEP_RECORDED_AMOUNT:'保持录入金额（不作税务调整）',FULL_PARENT_INCLUSION:'父项全额包含（需合同依据）',DIFFERENT_CHARGE_CONTENT:'不同收费内容（人工说明）',DISJOINT_COVERAGE:'选定箱日范围不交（程序检查）'};
export function renderContainerReview(controller:ContainerCostPairController):string {
 const p=controller.pair;if(!p)return'';
 const pending=!!controller.editor||!!controller.reviewEditor,blocked=controller.busy||controller.liveIssues().length>0;
 const button=(action:string,label:string,extra='',disabled=false)=>`<button data-action="${action}"${extra}${blocked||disabled?' disabled':''}>${h(label)}</button>`;
 if(p.version==='1.0')return`<section data-container-review><h3>费用核对记录</h3><p>可记录报价包含、父项、不同收费内容与金额假设，并另存到完整配对。启用后文件为1.1，旧程序不能读取；原费用与待办保持。</p>${button('pair-review-enable','明确启用核对记录（升级配对文件）','',pending)}</section>`;
 const report=controller.reviewState(),plan=p.review_plan!,editor=controller.reviewEditor;
 const page=Math.min(controller.reviewPage,Math.max(0,Math.ceil(plan.records.length/50)-1)),records=plan.records.slice(page*50,page*50+50);
 let form='';
 if(editor){
  const f=editor.fields,options=controller.reviewTargets(),stale=!containerReviewEditorIsCurrent(editor,p)||blocked;
  const field=(key:ReviewEditorField,label:string)=>`<label>${h(label)}<input data-pair-review-field="${key}" maxlength="4000" value="${h(f[key])}"></label>`;
  const targetOptions=[...options,...(f.target&&!options.some(o=>o.key===f.target)?[{key:f.target,label:'原目标当前不再可选，请保留原文并重新核对'}]:[])];
  form=`<section data-review-editor><h4>未提交核对记录</h4><p>${stale?'当前资料或修订失配；编辑原文保留，请放弃编辑、捕获修订后重新填写。':'绑定当前完整修订。'}编辑自动保存在本浏览器，尚未进入配对文件；提交或放弃后才能交接。</p>
  <div class="bill-fields"><label>核对类型<select data-pair-review-field="decision"${editor.original_record_id?' disabled':''}><option value="">请选择</option>${Object.entries(labels).map(([k,v])=>`<option value="${k}"${f.decision===k?' selected':''}>${h(v)}</option>`).join('')}</select></label>
  <label>当前核对目标<select data-pair-review-field="target"${editor.original_record_id?' disabled':''}><option value="">请选择目标，不自动猜测</option>${targetOptions.map(o=>`<option value="${h(o.key)}"${f.target===o.key?' selected':''}>${h(o.label)}</option>`).join('')}</select></label>
  <label>说明与合同定位<textarea data-pair-review-field="explanation" maxlength="4000">${h(f.explanation)}</textarea></label>
  ${f.decision==='FULL_PARENT_INCLUSION'?`<label>覆盖范围<select data-pair-review-field="coverage"><option value="">请明确选择</option><option value="FULL"${f.coverage==='FULL'?' selected':''}>合同全额覆盖（部分包含暂不支持）</option></select></label>`:''}
  ${f.decision==='DIFFERENT_CHARGE_CONTENT'?field('left_description','左侧收费内容')+field('right_description','右侧收费内容'):''}
  ${field('reference','来源文件 / 条款 / 页码')}${field('valid_from','依据有效开始 YYYY-MM-DD')}${field('valid_to','依据有效结束 YYYY-MM-DD')}${field('checked_on','核对日期 YYYY-MM-DD')}</div>
  <p>保存不会自动确认来源。含税、税额抵扣、精度或海关成分不支持时仍保留待办；不得用说明代替真实依据。修改已保存记录不换目标，换目标请新增记录并明确处理旧记录。</p>
  <div class="panel-actions">${button('pair-review-submit','保存核对记录（不应用费用）','',stale)}<button data-action="pair-review-discard"${controller.busy?' disabled':''}>放弃未提交核对编辑</button></div></section>`;
 }
 const audit=report?.boundary_review;
 return`<section data-container-review><h3>费用核对记录 · 配对 ${h(p.version)}</h3><p>业务修订${p.revision} · 核对记录修订${plan.revision}。这些是有来源的用户假设，不是合同或专业认证；确认不清除原提案、重叠、税务或精度待办，也不写费用。</p>
 <p data-review-live>${blocked?'当前资料失配，请先提交/放弃编辑并捕获当前完整修订。':report?'当前业务快照已匹配；下列金额和核对状态仍须分别检查。':'核对暂不可用，原记录保留；请检查资料范围与大小。'}</p>
 <div class="panel-actions">${button('pair-review-start','新增核对记录','',pending||!report)}</div>
 ${audit?`<p>检查目标${audit.target_count}项；原候选${audit.legacy_overlaps.length}对，箱日核对${audit.coverage.length}对，已有费用待核对${audit.existing_cost_candidates.length}项。范围不交仅针对这些输入，不证明全局无重复。</p>
 <table class="grid stackable"><thead><tr><th>账单行</th><th>原币账单假设</th><th>金额与税务边界</th></tr></thead><tbody>${audit.rows.map(r=>`<tr><th>${h(r.mapping.line_id)}</th><td data-label="原币账单假设">${h(r.original_amount??'未知')} ${h(r.currency??'')}</td><td data-label="金额与税务边界">${r.core_precision==='LOSS'?'超过核心精度，保留原值并阻断接入':r.core_precision==='UNKNOWN'?'金额尚不可计算':'与核心精度兼容'}；经济成本待确定，海关加计待确定${r.channels.tax_included?'；含税金额尚未拆税':''}。付款未核实。</td></tr>`).join('')}</tbody></table>`:''}
 <p data-review-count>已保存${plan.records.length}条，退休编号${plan.retired_record_ids.length}个。${plan.records.length?`当前显示第${page*50+1}–${page*50+records.length}条，全部记录随配对另存。`:'暂无核对记录。'}</p>
 <table class="grid stackable"><thead><tr><th>类型与目标</th><th>说明与来源</th><th>状态及操作</th></tr></thead><tbody>${records.map(r=>{const status=report?.records.find(x=>x.record_id===r.record_id);return`<tr data-review-record="${h(r.record_id)}"><th>${h(labels[r.decision]??r.decision)}<br>${h(r.target.kind==='BILL_PAIR'?r.target.line_ids.join(' ↔ '):r.target.line_id+' → '+r.target.cost_id)}</th><td data-label="说明与来源">${h(r.explanation)}<br>${h(r.evidence.reference)}<br>${h(r.evidence.valid_from)} 至 ${h(r.evidence.valid_to)}；核对 ${h(r.evidence.checked_on)}${r.decision==='DIFFERENT_CHARGE_CONTENT'?`<br>${h(r.left_description)} / ${h(r.right_description)}`:''}</td><td data-label="状态及操作"><strong>${status?.status==='RECORDED_ASSUMPTION'&&!blocked?'已记录来源假设（不清除待办）':'待重新核对'}</strong>${status?.issues.length?'<p>请核对来源、有效期、目标与当前修订；示例不能确认，核对日期不得晚于账单核对日。</p>':''}<div class="panel-actions">${button('pair-review-edit','编辑记录',` data-review-record="${h(r.record_id)}"`,pending)}${button('pair-review-confirm','确认此记录来源',` data-review-record="${h(r.record_id)}"`,pending)}${button('pair-review-remove','删除记录（保留编号）',` data-review-record="${h(r.record_id)}"`,pending)}</div></td></tr>`;}).join('')}</tbody></table>
 ${plan.records.length>50?`<div class="panel-actions">${button('pair-review-prev','上一页','',pending||page===0)}${button('pair-review-next','下一页','',pending||(page+1)*50>=plan.records.length)}</div>`:''}${form}</section>`;
}
