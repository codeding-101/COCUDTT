import{escapeHtml as h}from'../src/ui/format';import{FeeWorkbenchObservationCheck}from'./fee-workbench-observation';
export class FeeWorkbenchObservationPanel{
  private closed=false;private review:ReturnType<FeeWorkbenchObservationCheck['inspect']>|null=null;
  private readonly click=(event:Event)=>{if(event.target instanceof Element&&event.target.closest('[data-observation-recheck]'))this.refresh();};
  constructor(private readonly host:HTMLElement,private readonly check:FeeWorkbenchObservationCheck){host.addEventListener('click',this.click);this.refresh();}
  current(){return this.review;}
  refresh(){if(this.closed)return;try{const r=this.check.inspect();this.review=r;this.host.innerHTML=`<h2>工作台状态与资源观测</h2><p>仅核对变化，不替换项目，不代表完整恢复或允许切换。</p><button type="button" data-observation-recheck>重新检查当前观测</button><p>未绑定控制器 ${r.controllers.holders} 组、字段 ${r.controllers.fields} 项、方法入口 ${r.controllers.methods} 项；变化代次 ${r.controllers.epoch}。</p><p>已观测资源 ${r.resources.active} 项；未完整核对 ${r.resources.unknown} 项。原应用监听器、任务和文件保持。</p><table><thead><tr><th>范围</th><th>当前状态</th></tr></thead><tbody>${r.legacy.rows.map(row=>`<tr><th>${h(row.label)}</th><td>${h(row.condition)} · ${h(row.save_evidence)}</td></tr>`).join('')}</tbody></table><p>普通字段赋值与登记的方法入口已观测；外部直接修改嵌套对象、未登记资源和自动移除监听器仍需单独验证。完整新鲜性及切换均未授权。</p>`;}catch{this.review=null;this.host.innerHTML='<h2>工作台状态与资源观测</h2><p>观测不完整，请保留当前资料；不允许据此切换。</p><button type="button" data-observation-recheck>重新检查</button>';}}
  dispose(){if(this.closed)return;this.closed=true;this.host.removeEventListener('click',this.click);this.review=null;this.host.innerHTML='';}
}
