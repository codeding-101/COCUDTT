import type {ContainerBillDraft} from '../domain/container-bill-draft.js';
import type {ProjectFile} from '../data/project-file.js';
import {reviewContainerBillDraft} from '../engine/container-bill-draft.js';
import {escapeHtml as h} from './format.js';

const kinds:[string,string][]=[['','待确认'],['THC_ORIGIN','起运地THC'],['THC_DESTINATION','目的地THC'],['INSPECTION','查验（仅明确每箱）'],['DEMURRAGE','Demurrage 港区内占箱'],['DETENTION','Detention 港区外占箱'],['COMBINED_DD','联合D&D']];
function select(values:[string,string][],value:string):string {
 return(!values.some(([key])=>key===value)?`<option value="${h(value)}" selected>${h(value)}（原值，须核对）</option>`:'')+values.map(([key,label])=>`<option value="${h(key)}"${key===value?' selected':''}>${h(label)}</option>`).join('');
}
export function renderContainerBillAudit(file:ContainerBillDraft,project:ProjectFile):string {
 const r=reviewContainerBillDraft(file,project);
 return `<div data-bill-audit><p>独立账单参考：${r.rows.length}行 · 重叠候选${r.potential_overlaps.length}对；${r.issues.length?h(r.issues.join('；')):'仍须核对合同及完整费用'}</p><p class="hint">来源通过仅指本账单的人工记录与快照一致，不代表已入账、专业认证或确定推荐。不同币种/联合与分开D&amp;D不自动合计；未知条件不补零。</p>${r.rows.map(row=>{
  const a=row.calculation;
  return `<details data-evidence-section="bill-audit:${h(row.line_id)}"><summary>${h(row.line_id)} · ${a?h(a.amount)+' '+h(a.input.currency)+'（假设）':'条件待补，无金额'} · ${row.source_current?'账单来源已核对':'账单来源待核对'}</summary>
   <p>${h([row.input_issue??'',...row.source_issues].filter(Boolean).join('；'))}</p>
   ${row.cost_reference?`<p>已有费用只读引用 ${h(row.cost_reference.cost_id)}：${h([...row.cost_reference.issues,...row.cost_reference.source_issues].join('；')||'本次只读检查未发现问题，仍未写入费用')}；已含于${h(row.cost_reference.existing_containment??'未指定父费用')}；报价内含${row.cost_reference.included_in_quoted_price?'是':'否/未指定'}</p>`:''}
   ${a?`<p>箱数${a.container_count}，每箱${h(a.per_container_amount)} ${h(a.input.currency)}；所选${a.selected_days??'不按日'}天，消耗免费${a.consumed_free_days??'不适用'}天，收费${a.billable_days??'不按日'}天。未用免费${a.unused_free_days??'不适用'}天。</p>
    <table class="grid stackable"><thead><tr><th>阶</th><th>收费天数</th><th>原日率/箱</th><th>每箱/整行金额</th></tr></thead><tbody>${a.tier_totals.map(t=>`<tr><th>${t.tier_index+1}</th><td data-label="天数">${t.days}</td><td data-label="原日率">${h(t.rate)}</td><td data-label="金额">${h(t.per_container_amount)} / ${h(t.amount)}</td></tr>`).join('')}</tbody></table>
    <p>逐日预览前${Math.min(30,a.days.length)}天，共${a.days.length}天；完整记录见内部Excel。</p><table class="grid stackable"><thead><tr><th>日期</th><th>期间/收费序号</th><th>状态/阶</th><th>日率/整行金额</th></tr></thead><tbody>${a.days.slice(0,30).map(d=>`<tr><th>${h(d.date)}</th><td data-label="序号">${d.period_day} / ${d.billable_day??'—'}</td><td data-label="状态">${d.status==='FREE'?'免费':'收费'} / ${d.tier_index===null?'—':d.tier_index+1}</td><td data-label="日率/金额">${h(d.rate??'不适用')} / ${h(d.amount)}</td></tr>`).join('')}</tbody></table>`:''}</details>`;
 }).join('')}
 <p>候选预览前50对（完整候选随内部Excel）：</p><ul>${r.potential_overlaps.slice(0,50).map(p=>`<li>${h(p.line_ids.join(' ↔ '))} · ${h(p.reason)} · ${h(p.container_ids.join('、'))} · ${h(p.start_date??'固定项')} → ${h(p.end_date??'固定项')}；保留待核对，不减金额</li>`).join('')}</ul></div>`;
}
export function renderContainerBillSnapshot(file:ContainerBillDraft,project:ProjectFile):string {
 return `<section class="panel container-bill-panel"><div class="panel-body"><h2>集装箱账单 · 独立内部假设快照</h2>${renderContainerBillAudit(file,project)}<details><summary>完整账单草稿1.0（内部资料）</summary><pre>${h(JSON.stringify(file,null,2))}</pre></details></div></section>`;
}
export function renderContainerBillPanel(file:ContainerBillDraft|null,project:ProjectFile,busy:boolean,message:string):string {
 const disabled=busy?' disabled':'',button=(action:string,label:string,extra='')=>`<button data-action="${action}"${extra}${disabled}>${label}</button>`;
 const field=(path:string,label:string,value:unknown,row?:number,tier?:number,area=false)=>{
  const attrs=`data-bill-field="${path}"${row===undefined?'':` data-bill-row="${row}"`}${tier===undefined?'':` data-bill-tier="${tier}"`}`;
  return `<label>${label}${area?`<textarea ${attrs}>${h(String(value??''))}</textarea>`:`<input type="text" ${attrs} value="${h(String(value??''))}">`}</label>`;
 };
 const choose=(path:string,label:string,value:unknown,options:[string,string][],row:number)=>`<label>${label}<select data-bill-field="${path}" data-bill-row="${row}">${select(options,value===null||value===undefined?'':String(value))}</select></label>`;
 let content=`<p>账单独立1.0 JSON，与项目和付款文件分别保存；本面板只读核对已有费用，不写入成本。保存前保留自己的文件，载入示例/新建会替换本面板输入。修改条件后须重新核对，原始账单与合同口径优先。</p><p class="hint">仅明确日历日免费/收费与边际阶梯；工作日、小时截点、按票或其他口径保留原值待核对，不套默认规则。箱组须箱型、起止和费率相同，不同则拆行；免费期须从完整适用期起算，不截取已耗免费期后的账段。</p><p data-bill-status role="status">${h(message)}</p>
  <div class="panel-actions">${button('bill-new','新建空账单（先另存）')}${button('bill-example','载入合成账单（先另存）')}${button('bill-open','打开独立账单 JSON')}${file?button('bill-save','另存独立账单 JSON'):''}${file?button('bill-rebind','核对后绑定当前项目（保留输入）'):''}</div><input id="bill-file-input" type="file" accept=".json,application/json" hidden>
  <div class="panel-actions">${button('bill-schema','下载账单 Schema')}${button('bill-empty-template','下载空草稿模板')}${button('bill-example-template','下载合成模板')}</div>`;
 if(file){
  content+=`<p>草稿 ${h(file.id)} · 当前绑定 ${h(file.binding?.term??'未绑定')}；项目打开/新建不会丢弃本账单，绑定须重新核对。自动草稿与异常备份属于内部资料，不能代替另存文件。</p><div class="bill-fields">${field('name','账单名称',file.name)}${field('review_date','明确核对日期 YYYY-MM-DD',file.review_date)}${field('notes','内部备注',file.notes,undefined,undefined,true)}</div>`;
  content+=file.rows.map((r,i)=>{
   const a=r.input,scope=(action:string,label:string)=>button(action,label,` data-bill-row="${i}"`);
   return `<fieldset><legend>账单行${i+1} · ${h(a.line_id)}</legend><div class="bill-fields">
    ${field('scope_id','收费范围ID（人工区分合同/期间等）',a.scope_id,i)}${choose('direction','进出口方向',a.direction,[['','待确认'],['IMPORT','进口'],['EXPORT','出口']],i)}${field('equipment_type','箱型（人工填写）',a.equipment_type,i)}${field('container_ids','箱ID，每行一个（稳定标识，不验证ISO箱号）',a.container_ids?.join('\n'),i,undefined,true)}${field('currency','原币，三位大写',a.currency,i)}${field('reference','原计费条件/账单依据',a.reference,i)}
    ${choose('charge_kind','收费类型',a.charge_kind,kinds,i)}${choose('mode','计费模式（切换不会删除原字段）',a.mode,[['','待确认'],['DAILY','每箱每日'],['PER_CONTAINER','每箱固定']],i)}
    ${a.mode==='PER_CONTAINER'?field('rate','明确每箱原币金额',a.rate,i):''}
    ${a.mode==='DAILY'?`${field('period.start_date','计期起日',a.period?.start_date,i)}${field('period.end_date','计期止日',a.period?.end_date,i)}${choose('period.start_included','起日计入',a.period?.start_included,[['','待确认'],['true','计入'],['false','不计入']],i)}${choose('period.end_included','止日计入',a.period?.end_included,[['','待确认'],['true','计入'],['false','不计入']],i)}${field('period.start_event','原始起始事件',a.period?.start_event,i)}${field('period.end_event','原始结束事件',a.period?.end_event,i)}${choose('daily.free_day_basis','免费天数口径',a.daily?.free_day_basis,[['','待确认'],['CALENDAR_DAYS','日历日']],i)}${choose('daily.charge_day_basis','收费天数口径',a.daily?.charge_day_basis,[['','待确认'],['CALENDAR_DAYS','日历日']],i)}${field('daily.free_days','明确免费天数，0须人工填写',a.daily?.free_days,i)}${choose('daily.tier_mode','阶梯模式',a.daily?.tier_mode,[['','待确认'],['MARGINAL','逐日边际']],i)}${choose('daily.tier_basis','阶梯序号起算',a.daily?.tier_basis,[['','待确认'],['AFTER_FREE_TIME','免费期后收费日起算'],['FROM_PERIOD_START','所选期间日起算（含免费日）']],i)}`:''}</div>
    ${a.mode==='DAILY'?(a.daily?.tiers??[]).map((t,j)=>`<div class="bill-fields">${field('tier.through_day','第'+(j+1)+'阶含上界（留空表示无上限，仅最后阶可用）',t.through_day,i,j)}${field('tier.rate','原币日率/箱（未确认留空）',t.rate,i,j)}${button('bill-remove-tier','删除此阶',` data-bill-row="${i}" data-bill-tier="${j}"`)}</div>`).join('')+scope('bill-add-tier','新增空费率阶梯'):''}
    ${scope('bill-clean-mode','明确清除其他计费模式的旧字段')}
    <div class="bill-fields">${(['reference','valid_from','valid_to','checked_on'] as const).map(k=>field('source.'+k,({reference:'核对依据',valid_from:'依据适用期起',valid_to:'依据适用期止',checked_on:'人工核对日'})[k],r.evidence?.[k],i)).join('')}${choose('source.status','来源标记',r.evidence?.status??'UNVERIFIED',[['UNVERIFIED','待核对'],['EXAMPLE','示例数据'],['USER_CONFIRMED','已确认（修改须点确认按钮）']],i)}</div>
    ${scope('bill-confirm-source','明确核对本行条件与来源')}
    <details data-evidence-section="bill-ref:${i}"><summary>已有费用只读引用（不写入成本）</summary><div class="bill-fields">${field('cost_reference.cost_id','已有费用ID（删除后保留待修正）',r.cost_reference?.cost_id,i)}${field('cost_reference.note','范围/金额与重复计入核对说明',r.cost_reference?.note,i)}${(['reference','valid_from','valid_to','checked_on'] as const).map(k=>field('cost_source.'+k,'费用引用依据 '+k,r.cost_reference?.evidence?.[k],i)).join('')}</div>${scope('bill-confirm-reference','明确核对已有费用引用')}${scope('bill-clear-reference','清除本行费用引用')}</details>${scope('bill-remove-line','删除本行')}</fieldset>`;
  }).join('');content+=`<div class="panel-actions">${button('bill-add-line','增加空账单行')}${button('bill-clear','清空账单面板（先另存）')}</div>${renderContainerBillAudit(file,project)}<p>内部测算HTML/Excel可记录完整账单快照；项目JSON和客户HTML/Excel/PDF不包含此账单。来源不是专业认证；原币假设不改变经营利润或买方落地成本。</p>`;
 }
 return `<details class="panel container-bill-panel" data-evidence-section="container-bill"><summary><span class="panel-title">集装箱账单 · 独立录入与内部审计</span></summary><div class="panel-body">${content}</div></details>`;
}
