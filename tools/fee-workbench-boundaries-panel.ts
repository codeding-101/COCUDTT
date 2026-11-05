import{escapeHtml as h}from'../src/ui/format';import{FeeWorkbenchBoundaryCheck}from'./fee-workbench-boundaries';
export class FeeWorkbenchBoundaryPanel{
 private closed=false;private review:ReturnType<FeeWorkbenchBoundaryCheck['inspect']>|null=null;
 private readonly click=(event:Event)=>{if(event.target instanceof Element&&event.target.closest('[data-boundary-recheck]'))this.refresh();};
 constructor(private readonly host:HTMLElement,private readonly check:FeeWorkbenchBoundaryCheck){host.addEventListener('click',this.click);this.refresh();}
 current(){return this.review;}
 refresh(){if(this.closed)return;try{const r=this.check.inspect();this.review=r;this.host.innerHTML=`<h2>输入与变动边界核对</h2><p>只读本地诊断。不会提交输入、替换项目或批准报价。</p><button type="button" data-boundary-recheck>重新核对</button><dl><dt>已登记源码边界</dt><dd>${r.boundaries.sites} 处 · 变化代次 ${r.boundaries.epoch}</dd><dt>页面输入</dt><dd>${r.buffers.dirty_attached} 项已变动；${r.buffers.dirty_detached} 项变动后离开页面</dd><dt>读取待核对</dt><dd>${r.buffers.unreadable} 项；文件选择 ${r.buffers.file_selected} 项</dd></dl><ul>${r.blockers.map(s=>`<li>${h(({EDITED_DOM_BUFFER:'输入已变动，请核对保存状态',DETACHED_EDITED_BUFFER:'变动的输入已移出页面，资料仍需核对',UNREADABLE_DOM_BUFFER:'部分输入无法读取',FILE_SELECTION_REQUIRES_REVIEW:'存在已选文件，尚未证明读取或保存',RESOURCE_LIFETIME_UNKNOWN:'监听器生命周期未完整核对'}as Record<string,string>)[s]??s)}</li>`).join('')||'<li>当前登记范围没有新增待办；初始保存证据仍未核实。</li>'}</ul><p>提前缓存的登记方法、指定集合调用及原生输入事件已观测。无事件的脚本往返、任意外部修改、自动移除监听器和所有页面缓冲仍未完整覆盖。完整新鲜性及切换继续关闭。</p>`;}catch{this.review=null;this.host.innerHTML='<h2>输入与变动边界核对</h2><p>当前观测无法完整核对，请保留资料。</p><button type="button" data-boundary-recheck>重新核对</button>';}}
 dispose(){if(this.closed)return;this.closed=true;this.host.removeEventListener('click',this.click);this.review=null;this.host.innerHTML='';}
}
