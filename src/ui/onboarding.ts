import{escapeHtml as h}from'./format.js';

export const ONBOARDING_KEY='trade-cost-engine:onboarding-v1';
export const ONBOARDING_STEPS=[
 {title:'选择术语与运输方式',text:['先在“报价与方案”选择实际约定的贸易术语，在“交易与商品”填写运输方式。专业模式保留全部字段。','费用承担、货损风险与付款安排分别判断；界面选择不能替代实际合同约定。']},
 {title:'分别填写货值、数量和报价',text:['填入货值、币种、数量和单位，再填写合同报价；货值和报价是分别录入的两个金额。中国进口还要核对货物净价口径，已含运保费的整价需先拆分。','采购成本未知时不要当作零。主要运费和保险费可明确选择已有记录快捷修改，复杂费用在高级设置中录入。']},
 {title:'读懂本次计算',text:['金额或数量失焦、按回车后会重新计算。无法计算时先按错误提示修正；输入待更新时不沿用旧结果。','当前摘要使用录入报价；目标毛利率等反推结果在方案对比中查看。“参考测算”仍有待核对事项，计算完成也不代表真实业务已核验。']},
 {title:'按需核对并保存',text:['在高级设置核对费用、商业/海关汇率和税务；“读懂本次计算”与完整过程可查看金额依据。手机可进入高级设置全屏面板再返回。','数据仅在本机浏览器。草稿不是备份，请另存项目JSON；载入模板或示例会替换当前交易，先保存自己的资料。']},
]as const;

/** Presentation preferences only. This controller never receives business data. */
export class OnboardingController{
 private initialized=false;private active=false;private step=0;private hidden=false;
 private returnData:Record<string,string|undefined>|null=null;
 private bound=new WeakSet<HTMLDialogElement>();private message='';
 get isOpen():boolean{return this.active;}
 private read():void{try{this.hidden=localStorage.getItem(ONBOARDING_KEY)==='hidden';}catch{this.hidden=false;this.message='浏览器无法读取引导偏好；你仍可关闭引导，交易数据不受影响。';}}
 start(automatic:boolean):boolean{if(this.initialized)return false;this.initialized=true;this.read();return automatic&&!this.hidden?this.open():false;}
 entry():string{return `<div class="onboarding-entry"><button type="button" data-action="show-onboarding" aria-haspopup="dialog" aria-controls="onboarding-dialog">使用引导 · 四步了解工作台</button><span data-onboarding-status role="status">${h(this.message)}</span></div>`;}
 private contents():string{
  const current=ONBOARDING_STEPS[this.step]!;
  return `<header><p class="hint">使用引导 · 第${this.step+1}步，共${ONBOARDING_STEPS.length}步</p><button type="button" data-action="close-onboarding" aria-label="关闭使用引导">关闭</button></header><ol class="onboarding-progress" aria-label="引导步骤">${ONBOARDING_STEPS.map((s,i)=>`<li${i===this.step?' aria-current="step"':''}>${i+1}. ${h(s.title)}</li>`).join('')}</ol><div class="onboarding-content"><h2 id="onboarding-title" tabindex="-1">${h(current.title)}</h2>${current.text.map(t=>`<p>${h(t)}</p>`).join('')}<p class="hint">引导只作说明，保留当前交易，不会载入示例或代填业务确认。</p></div><footer><label class="onboarding-preference"><input type="checkbox" data-onboarding-field="hide"${this.hidden?' checked':''}>以后不再自动显示（仅此浏览器）</label><div class="onboarding-controls"><button type="button" data-action="onboarding-back"${this.step===0?' disabled':''}>上一步</button>${this.step===ONBOARDING_STEPS.length-1?'<button type="button" class="primary" data-action="close-onboarding">开始使用</button>':'<button type="button" class="primary" data-action="onboarding-next">下一步</button>'}</div><p class="hint">关闭后可从“使用引导”再次打开；偏好在关闭时保存。</p></footer>`;
 }
 render():string{return `<dialog id="onboarding-dialog" aria-labelledby="onboarding-title">${this.contents()}</dialog>`;}
 afterRender():void{
  const dialog=document.querySelector<HTMLDialogElement>('#onboarding-dialog');if(!dialog)return;
  if(!this.bound.has(dialog)){
   this.bound.add(dialog);
   dialog.addEventListener('cancel',event=>{event.preventDefault();this.dismiss();});
   dialog.addEventListener('close',()=>{if(dialog.isConnected&&!dialog.open&&this.active)this.dismiss();});
   dialog.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const controls=[...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')].filter(el=>el.getClientRects().length>0),first=controls[0],last=controls[controls.length-1];if(!first||!last)return;
    if(!controls.includes(document.activeElement as HTMLElement)){event.preventDefault();(event.shiftKey?last:first).focus();}
    else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
   });
  }
  if(this.active&&!dialog.open){try{if(typeof dialog.showModal!=='function')throw Error('Unavailable dialog');dialog.showModal();dialog.querySelector<HTMLElement>('#onboarding-title')?.focus({preventScroll:true});}catch{this.active=false;this.note('当前浏览器无法打开使用引导，请查看页面底部的项目说明；交易可继续编辑。');}}
 }
 open(trigger?:HTMLElement):boolean{
  if(this.active)return true;
  const dialog=document.querySelector<HTMLDialogElement>('#onboarding-dialog');if(!dialog||typeof dialog.showModal!=='function'){this.note('当前浏览器无法打开使用引导，请查看页面底部的项目说明；交易可继续编辑。');return false;}
  this.read();this.step=0;this.returnData=trigger?{...trigger.dataset}:{action:'show-onboarding'};this.active=true;dialog.innerHTML=this.contents();this.afterRender();return this.active;
 }
 setHidden(value:boolean):void{if(this.active)this.hidden=value;}
 move(direction:'next'|'back'):boolean{
  if(!this.active)return false;const step=this.step+(direction==='next'?1:-1);if(step<0||step>=ONBOARDING_STEPS.length)return false;
  const dialog=document.querySelector<HTMLDialogElement>('#onboarding-dialog');if(!dialog)return false;
  this.step=step;dialog.innerHTML=this.contents();dialog.scrollTop=0;dialog.querySelector<HTMLElement>('#onboarding-title')?.focus({preventScroll:true});return true;
 }
 dismiss(restore=true,persist=true):void{
  if(!this.active)return;this.active=false;
  if(persist){try{localStorage.setItem(ONBOARDING_KEY,this.hidden?'hidden':'show');this.note('');}catch{this.note('本次已关闭引导，但偏好未能保存；以后可能再次显示，可从“使用引导”打开。');}}
  const data=this.returnData;this.returnData=null;const dialog=document.querySelector<HTMLDialogElement>('#onboarding-dialog');if(dialog?.open)dialog.close();
  if(restore&&data){const entries=Object.entries(data);[...document.querySelectorAll<HTMLElement>('[data-action="show-onboarding"]')].find(el=>entries.every(([key,value])=>el.dataset[key]===value))?.focus({preventScroll:true});}
 }
 private note(message:string):void{this.message=message;const element=document.querySelector<HTMLElement>('[data-onboarding-status]');if(element)element.textContent=message;}
}
