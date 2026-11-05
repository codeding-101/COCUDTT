/** Explicit bank-fee and constant-funding inputs sharing the existing internal payment draft. */
import { escapeHtml as h } from '../src/ui/format';
import { parseProject } from '../src/data/project-file';
import { settlementBinding } from '../src/data/settlement-context';
import { renderFundingResult } from '../src/ui/funding';
import { FeeContractSettlementManager } from './fee-contract-settlement';
import { FeeContractSettlementPanel } from './fee-contract-settlement-panel';
import type { BankFeeField, FundingField } from './fee-recovery-settlement';
import type { PackageWriter } from './fee-recovery-package-transfer';
import { startRecoveredPackageDownload } from './fee-recovery-package-panel';

const parties = [['UNCONFIRMED','待确认'],['BUYER','买方'],['SELLER','卖方']] as const;
const action = (key:string, text:string, disabled=false) => `<button type="button" data-bf-action="${h(key)}"${disabled?' disabled':''}>${text}</button>`;
const reason = (e:unknown) => e instanceof Error ? e.message : '输入未提交，当前付款计划保持。';

export class FeeBankFundingPanel {
  private readonly coreHost:HTMLElement;
  private readonly editorHost:HTMLElement;
  private readonly core:FeeContractSettlementPanel;
  private closed=false;
  private paintOnly=false;
  private coreBusy=false;
  private message='银行费与资金假设共用同一份内部付款草稿。';

  constructor(host:HTMLElement,readonly manager=new FeeContractSettlementManager(async()=>{},{bankFunding:true}),writer:PackageWriter=startRecoveredPackageDownload,afterOpen:()=>void=()=>{},private readonly afterPaint:(busy:boolean)=>void=()=>{}) {
    host.innerHTML='<section data-bf-core></section><section data-bf-editor></section>';
    this.coreHost=host.querySelector('[data-bf-core]')!;
    this.editorHost=host.querySelector('[data-bf-editor]')!;
    this.editorHost.addEventListener('input',this.input);
    this.editorHost.addEventListener('change',this.change);
    this.editorHost.addEventListener('blur',this.blur,true);
    this.editorHost.addEventListener('keydown',this.key);
    this.editorHost.addEventListener('mousedown',this.down);
    this.editorHost.addEventListener('click',this.click);
    this.core=new FeeContractSettlementPanel(this.coreHost,manager,writer,afterOpen,busy=>{this.coreBusy=busy;this.render();});
  }

  private input=(event:Event)=>{const e=event.target;if(e instanceof HTMLInputElement&&e.type!=='checkbox'&&(e.dataset.bfFee||e.dataset.bfFunding))this.edit(e);};
  private change=(event:Event)=>{const e=event.target;if((e instanceof HTMLSelectElement||e instanceof HTMLInputElement&&e.type==='checkbox')&&(e.dataset.bfFee||e.dataset.bfFunding)){this.edit(e);this.commit();}};
  private blur=(event:Event)=>{const e=event.target;if(e instanceof HTMLInputElement&&e.type!=='checkbox'&&(e.dataset.bfFee||e.dataset.bfFunding))this.commit(false);};
  private key=(event:Event)=>{const e=event.target;if(event instanceof KeyboardEvent&&event.key==='Enter'&&!event.isComposing&&e instanceof HTMLInputElement&&(e.dataset.bfFee||e.dataset.bfFunding)){event.preventDefault();this.commit();}};
  private down=(event:Event)=>{if(event.target instanceof Element&&event.target.closest('[data-bf-action]')&&this.manager.current()?.settlement.hasPending())event.preventDefault();};
  private click=(event:Event)=>{if(event.target instanceof Element){const button=event.target.closest<HTMLElement>('[data-bf-action]');if(button)this.act(button.dataset.bfAction!);}};

  lifecycleState(){return this.core.lifecycleState();}
  whenLifecycleIdle(){return this.core.whenLifecycleIdle();}
  cancelLifecycleTasks(){this.core.cancelLifecycleTasks();}
  formsChanged(){if(!this.closed)this.core.settlementChanged();}
  renderAll(){if(!this.closed)this.core.render();}
  private painted(){this.afterPaint(this.coreBusy||this.manager.busy()||!!this.manager.current()?.busy());}
  private refresh(fields=true) {
    this.paintOnly=!fields;
    try { this.core.settlementChanged(); } finally { this.paintOnly=false; }
  }
  private edit(e:HTMLInputElement|HTMLSelectElement) {
    if(this.closed)return;
    const s=this.manager.current();if(!s)return;
    try {
      if(e.dataset.bfFee)s.settlement.editBankFee(e.dataset.bfFee,e.dataset.bfField as BankFeeField,e instanceof HTMLInputElement&&e.type==='checkbox'?e.checked:e.value);
      else s.settlement.editFunding(e.dataset.bfFunding as FundingField,e.value);
      this.message='输入保留在未提交草稿中，旧交接候选和旧计算结果不再采用。';
    } catch(e) {this.message=reason(e);}
    this.refresh(false);
  }
  private commit(fields=true) {
    if(this.closed)return;
    try {if(this.manager.current()?.settlement.commit())this.message='内部付款草稿已提交；银行收付与资金假设按原规则分别核对。';}
    catch(e){this.message=reason(e);}
    this.refresh(fields);
  }
  private act(key:string) {
    if(this.closed)return;
    const s=this.manager.current();if(!s)return;
    try {
      if(key==='add')s.settlement.addBankFee();
      else if(key.startsWith('remove:'))s.settlement.removeBankFee(key.slice(7));
      else if(key==='commit'){this.commit();return;}
      else if(key==='discard')s.settlement.discard();
      else return;
      this.message=key==='discard'?'本次整份付款缓冲已放弃，已提交资料保持。':'银行费草稿已变化，请填写并提交。';
    }catch(e){this.message=reason(e);}
    this.refresh();
  }

  render() {
    if(this.closed)return;
    // The reused quote/payment card keeps the original enum values and gets readable labels here.
    const labels:Record<string,string>={UNCONFIRMED:'尚未核对',NO_FEES:'已核对无银行费用',LISTED:'按逐笔银行费清单核对',LC:'L/C（信用证）',TT:'TT（电汇）',OA:'OA（赊销）'};
    for(const select of this.coreHost.querySelectorAll<HTMLSelectElement>('[data-x110-plan="method"],[data-x110-plan="bank_status"]'))for(const option of select.options){const value=option.value;option.value=value;option.textContent=labels[value]??value;}
    const s=this.manager.current(),v=s?.settlement.view(),p=v?.plan;
    if(!s||!p){this.editorHost.innerHTML='<p class="x110-note">先明确打开独立副本并新建或载入付款计划，再填写银行费与资金假设。</p>';this.painted();return;}
    const note=[...this.coreHost.querySelectorAll('[data-x110-plan] > p')].find(p=>p.textContent?.startsWith('银行费逐笔清单及资金占用字段'));
    if(note&&!v!.funding_and_bank_rows_read_only)note.textContent='银行费与资金假设在下方独立表单填写，共用当前付款草稿；不写入项目费用。';
    // A routine refresh must not remove the focused draft input and accidentally trigger blur/commit.
    const focused=document.activeElement;
    if(this.paintOnly||v!.pending&&(focused instanceof HTMLInputElement||focused instanceof HTMLSelectElement)&&this.editorHost.contains(focused)){this.status();return;}
    const locked=this.coreBusy||this.manager.busy()||s.busy()||s.contract.hasPending()||s.trade.hasPending()||!!s.forms?.hasPending()||v!.funding_and_bank_rows_read_only;
    const text=(field:string,label:string,value:string,row?:string)=>`<label>${label}<input type="text"${['amount','principal','annual_rate'].includes(field)?' inputmode="decimal"':''} ${row?`data-bf-fee="${h(row)}" data-bf-field="${field}"`:`data-bf-funding="${field}"`} value="${h(value)}"${locked?' disabled':''}></label>`;
    const select=(field:string,label:string,values:readonly(readonly[string,string])[],value:string,row?:string)=>`<label>${label}<select ${row?`data-bf-fee="${h(row)}" data-bf-field="${field}"`:`data-bf-funding="${field}"`}${locked?' disabled':''}>${values.map(([key,label])=>`<option value="${key}"${key===value?' selected':''}>${label}</option>`).join('')}</select></label>`;
    const project=parseProject(s.capture().sources.project_json!);
    this.editorHost.innerHTML=`<h2>银行费与资金假设</h2><p class="x110-note">仅内部计划。未确认不当零；净收付、资金成本、贸易利润与海关税基分别处理。这里与上方合同价款共用一份草稿，提交或放弃会作用于整份付款缓冲。</p><p role="status" data-bf-status></p>${locked&&v!.funding_and_bank_rows_read_only?'<p>本表单仅编辑标准1.1。其他版本和未启用编辑的会话按原文保全，不自动升级；结果仍沿原标准版本核对。</p>':''}<div class="bf-grid">
      <article data-bf-bank><h3>逐笔银行费用</h3><p>付款方与承担方独立填写；代付或垫付尚未建模时拒算。关联已有费用不会再次写入成本。</p>${p.bank_fees.map(row=>`<fieldset><legend>${h(row.id)}</legend>${select('source','费用来源',[['EXISTING','关联项目已有银行费用'],['EXTRA','新增，仅列付款计划']],row.source,row.id)}${row.source==='EXISTING'?`<label>已有自定义费用（选择仍须原引擎核对）<select data-bf-fee="${h(row.id)}" data-bf-field="cost_id"${locked?' disabled':''}><option value="">请选择</option>${project.items.filter(item=>item.source==='USER'&&item.cost_category==='CUSTOM'&&!item.is_goods_value).map(item=>`<option value="${h(item.cost_id)}"${item.cost_id===row.cost_id?' selected':''}>${h(item.cost_name)} · ${h(item.currency)}</option>`).join('')}${row.cost_id&&!project.items.some(item=>item.cost_id===row.cost_id&&item.source==='USER'&&item.cost_category==='CUSTOM'&&!item.is_goods_value)?`<option value="${h(row.cost_id)}" selected>原引用已不在可选范围：${h(row.cost_id)}</option>`:''}</select></label><p>手填金额和币种保留，关联计算取当前原费用；不把保留值当已核对金额。</p>`:`${row.cost_id?text('cost_id','保留的原费用ID（新增费用须明确清空）',row.cost_id,row.id):''}${text('amount','费用原币金额（确认为零再填0）',row.amount,row.id)}${text('currency','费用币种（三位大写）',row.currency,row.id)}<label><input type="checkbox" data-bf-fee="${h(row.id)}" data-bf-field="not_in_project"${row.not_in_project?' checked':''}${locked?' disabled':''}>已核对这笔费用未录入项目费用清单（程序不能据此识别重复账单）</label>`}${select('bearer','经济承担方',parties,row.bearer,row.id)}${select('payer','计划实际付款方',parties,row.payer,row.id)}${text('date','约定费用付款日 YYYY-MM-DD',row.date,row.id)}${text('reference','银行收费与承担约定依据',row.reference,row.id)}${action('remove:'+row.id,'删除本笔银行费',locked)}</fieldset>`).join('')}${action('add','增加一笔银行费',locked||p.bank_fees.length>=100)}</article>
      <article data-bf-funding><h3>固定本金 · 单利假设</h3><p>本金、利率和日期均须独立填写，不从合同总价或付款方式推定。未启用的输入继续保留。</p>${p.funding?`${select('status','测算范围',[['UNCONFIRMED','待确认（不是零成本）'],['NOT_MODELED','明确选择本次不建模'],['PROVIDED','按下方明确假设测算']],p.funding.status)}${select('kind','成本性质',[['UNCONFIRMED','待确认'],['FINANCING','融资利息假设'],['OPPORTUNITY','资金机会成本假设']],p.funding.kind)}${select('party','测算方',parties,p.funding.party)}${text('principal','恒定本金（不自动取合同价）',p.funding.principal)}${text('currency','本金与成本币种（三位大写）',p.funding.currency)}${text('start_date','起始日 YYYY-MM-DD（含）',p.funding.start_date)}${text('end_date','截止日 YYYY-MM-DD（不含）',p.funding.end_date)}${text('annual_rate','年利率百分数（例如6；明确零利率填0）',p.funding.annual_rate)}${select('day_basis','计息基准',[['UNCONFIRMED','待确认'],['ACT_365F','Actual/365 Fixed（闰年也除365）'],['ACT_360','Actual/360']],p.funding.day_basis)}${text('reference','本金期间、利率与计息基准依据',p.funding.reference)}`:'<p>该标准版本没有资金假设，不自动增加字段。</p>'}<p>算头不算尾，同日为0天；不建模复利、负利率、还款冲抵顺序或实际扣款日。机会成本不表示银行账单，不改变计划收付、经营利润或买方落地成本。</p></article></div>
      <div class="x110-actions">${action('commit','提交整份付款草稿',locked||!v!.pending)}${action('discard','放弃本次整份付款缓冲',this.coreBusy||s.busy()||!v!.pending)}</div><section data-bf-results></section>`;
    this.status();
  }
  private status() {
    const s=this.manager.current(),v=s?.settlement.view(),p=v?.plan;
    const status=this.editorHost.querySelector('[data-bf-status]');if(status)status.textContent=this.message;
    if(s&&v){const locked=this.coreBusy||this.manager.busy()||s.busy()||s.contract.hasPending()||s.trade.hasPending()||!!s.forms?.hasPending()||v.funding_and_bank_rows_read_only;for(const button of this.editorHost.querySelectorAll<HTMLButtonElement>('[data-bf-action="commit"],[data-bf-action="discard"]'))button.disabled=!v.pending||(button.dataset.bfAction==='commit'?locked:this.coreBusy||s.busy());}
    const result=this.editorHost.querySelector('[data-bf-results]');if(!result||!s||!p){this.painted();return;}
    if(v!.pending){result.innerHTML='<p>整份付款输入未提交，银行收付和资金旧结果均暂不展示。</p>';this.painted();return;}
    let funding:string;
    try{funding=renderFundingResult(p,settlementBinding(parseProject(s.capture().sources.project_json!)));}catch(e){funding=`<p class="x110-error">${h(reason(e))}</p>`;}
    result.innerHTML=`<h3>分别核对的内部结果</h3>${v!.error?`<p class="x110-error" data-bf-bank-error>${h(v!.error)}</p>`:v!.result?`<div data-bf-bank-result>${v!.result.totals.map(t=>`<p>${h(t.currency)}：买方计划支出 ${h(t.buyer_outflow)}；卖方计划收款 ${h(t.seller_inflow)}；卖方银行付款 ${h(t.seller_outflow)}；卖方计划净收付 ${h(t.seller_net)}。</p>`).join('')}</div>`:''}<section data-bf-funding-result>${funding}</section><p>两类结果各自核对，资金结果可用不表示付款计划已通过。完整原值、公式和依据保留在内部资料中，不批准客户报价或付款。</p>`;this.painted();
  }
  dispose() {
    if(this.closed)return;this.closed=true;this.core.dispose();
    this.editorHost.removeEventListener('input',this.input);this.editorHost.removeEventListener('change',this.change);this.editorHost.removeEventListener('blur',this.blur,true);this.editorHost.removeEventListener('keydown',this.key);this.editorHost.removeEventListener('mousedown',this.down);this.editorHost.removeEventListener('click',this.click);
  }
}
