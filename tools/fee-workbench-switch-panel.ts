import{escapeHtml as h}from'../src/ui/format';import{FeeWorkbenchSwitchCheck,SWITCH_GROUPS,type SwitchReview}from'./fee-workbench-switch';
const messages:Record<string,string>={UNSAVED:'有未另存资料',UNCOMMITTED:'有未提交输入',ACTIVE:'有进行中任务或候选',UNKNOWN:'当前状态无法完整核对',SAVE_EVIDENCE_UNKNOWN:'独立文件保存证据未知',HOLDER_COVERAGE_CHANGED:'状态字段与源码盘点不符',ROOT_NOT_CURRENT:'当前页面根无法匹配',DETACHED_UNCOMMITTED_CONTROL:'未提交控件已脱离页面',SELECTED_FILE_NOT_READ:'存在未读取的文件选择',OPEN_MODAL:'有尚未关闭的弹层',CAPTURE_UNAVAILABLE:'完整捕获未通过原校验'};
const gapText=['付款、敏感性和客户字段的完整重录','显示偏好及未绑定控制器的迁移','全部页面输入与未读文件的处理','监听器解绑、重新绑定和关闭保护','未绑定状态的往返变更追踪','完整工作台的原子安装','多次费用应用的完整备份设计'];
const groupLabel=(group:SwitchReview['issues'][number]['group'])=>group==='holders'?'状态覆盖':group==='root'?'工作台页面':SWITCH_GROUPS[group];
/** Read-only diagnostic outside the production root. No acknowledgement or switch button. */
export class FeeWorkbenchSwitchPanel{
 private closed=false;private last:SwitchReview|null=null;private error=false;
 private readonly click=(event:Event)=>{if(event.target instanceof Element&&event.target.closest('[data-switch-refresh]'))this.refresh();};
 constructor(private readonly host:HTMLElement,private readonly check:FeeWorkbenchSwitchCheck){host.addEventListener('click',this.click);this.refresh();}
 refresh(){if(this.closed)return;try{this.last=this.check.inspect();this.error=false;}catch{this.last=null;this.error=true;}this.paint();}
 private paint(){const r=this.last;this.host.innerHTML=`<h2>切换前状态检查</h2><p class="switch-note">本机只读开发验证。完整工作台切换尚未开放；检查结果不能确认费用、保存文件或批准客户报价。</p><button type="button" data-switch-refresh>重新检查当前状态</button><p role="status" data-switch-status>${this.error?'当前状态无法完整核对，请保留原工作台。':r?.issues.length?`发现 ${r.issues.length} 项需要处理或保全。`:'当前观测暂未发现输入阻断；仍需完成以下接入。'}</p>${r?`<p data-switch-roster>已盘点 ${r.observed_holder_count} 组状态、${r.observed_field_count} 个字段。</p><ul data-switch-issues>${r.issues.map(i=>`<li>${h(groupLabel(i.group))}：${h(messages[i.code]??'需要重新核对')}</li>`).join('')}</ul><details><summary>各表单当前状态</summary><table><thead><tr><th>范围</th><th>状态</th></tr></thead><tbody>${r.rows.map(row=>`<tr><td>${h(row.label)}</td><td>${h(row.condition==='QUIET'?'当前未发现输入阻断':messages[row.condition]??'待核对')}</td></tr>`).join('')}</tbody></table></details><details open><summary>正式切换仍待完成</summary><ul>${gapText.map(t=>`<li>${h(t)}</li>`).join('')}</ul></details>`:''}`;}
 current(){return this.last;}
 dispose(){if(this.closed)return;this.closed=true;this.host.removeEventListener('click',this.click);this.check.dispose();this.host.replaceChildren();}
}
