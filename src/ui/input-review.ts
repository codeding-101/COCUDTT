import type {ProjectFile} from '../data/project-file.js';
import type {FxRow} from './fx-rows.js';
import {SCALE} from '../domain/decimal.js';
import {escapeHtml as h} from './format.js';

type Target={kind:'path';path:string}|{kind:'item';id:string;field:string;tier?:number}|{kind:'fx';id:string};
type ReviewCode='FORMAT'|'SCALE'|'CAPACITY'|'TINY_FX'|'UNIT';
export interface InputReview {key:string;code:ReviewCode;label:string;raw:string;message:string;target:Target;}
/** Lexical inspection only: no float conversion, rounding, currency conversion or business validation. */
export function numericShape(raw:string):{integerDigits:number;significantDigits:number;fraction:string;nonzero:boolean}|null{
 const text=raw.trim();if(!/^-?\d+(\.\d+)?$/.test(text))return null;
 const [whole='',fraction='']=text.replace(/^-/,'').split('.');const integer=whole.replace(/^0+/,'');const digits=(whole+fraction).replace(/^0+/,'').replace(/0+$/,'');
 return {integerDigits:integer.length,significantDigits:digits.length||1,fraction,nonzero:/[1-9]/.test(whole+fraction)};
}
export function inputReviews(project:ProjectFile,rows:readonly FxRow[]):InputReview[]{
 const issues:InputReview[]=[];
 const hint=(code:InputReview['code'],label:string,raw:string,message:string,target:Target)=>issues.push({key:JSON.stringify([target,code]),code,label,raw,message,target});
 const number=(value:unknown,label:string,target:Target,context:'amount'|'operand'|'fx'='operand')=>{
  if(value===undefined||value===null)return;const raw=String(value);if(!raw.trim())return;const shape=numericShape(raw);
  if(!shape){hint('FORMAT',label,raw,'不是通常的纯十进制文本，请核对逗号、货币符号或科学记数法；是否可计算仍以原校验为准，不自动清理输入。',target);return;}
  if(shape.significantDigits>40||shape.integerDigits+SCALE>40)hint('CAPACITY',label,raw,`当前算术采用40位有效数字；此输入有${shape.integerDigits}位整数、${shape.significantDigits}位有效数字，涉及小数或后续运算时不能保证末位。请核对数量级、单位和币种；这不是法定金额上限，也不代表已经溢出。`,target);
  if(shape.fraction.length>SCALE&&/[1-9]/.test(shape.fraction.slice(SCALE)))hint('SCALE',label,raw,context==='fx'?'这条汇率记录若用于常规解析，会按6位小数处理；原始文本保留，不以显示汇率或倒数替换原始报价。':context==='amount'?'本笔固定／实际计费金额按6位小数处理；原始文本保留，请核对是否满足原单据精度。':'含第7位及以后非零小数。金额或乘积可能按6位小数处理；不表示此操作数会先舍入，具体请看实际公式。',target);
  if(context==='fx'&&shape.nonzero&&shape.integerDigits===0&&!/[1-9]/.test(shape.fraction.slice(0,SCALE))&&(shape.fraction[SCALE]??'0')<'5')hint('TINY_FX',label,raw,'这条汇率文本按6位小数舍入会归零，请核对报价方向和精度；不自动取倒数，不代表当前交易已使用此记录。',target);
 };
 const path=(value:unknown,label:string,name:string)=>number(value,label,{kind:'path',path:name});
 path(project.goods.quantity,'商品数量','goods.quantity');path(project.goods.trade_value.amount,'成交货值','goods.trade_value.amount');path(project.goods.seller_goods_cost.amount,'卖方采购成本','goods.seller_goods_cost.amount');
 path(project.quote.amount,project.anchor.kind==='ACTUAL_QUOTES'?'项目报价基值（独立方案模式下定位比较基准）':'当前报价',project.anchor.kind==='ACTUAL_QUOTES'?'anchor.kind':'quote.amount');
 if(project.anchor.kind==='FIXED_MARGIN_RATE')path(project.anchor.margin_rate,'目标毛利率','anchor.margin_rate');
 if(project.anchor.kind==='FIXED_MARKET_PRICE')path(project.anchor.buyer_total,'目标买方支付','anchor.buyer_total');
 const currencies=new Set([project.base_currency,project.goods.trade_value.currency,project.goods.seller_goods_cost.currency,project.quote.currency,...project.items.map(item=>item.currency)].map(code=>code.trim().toUpperCase()).filter(Boolean));
 const unit=(raw:string,label:string,target:Target)=>{const text=raw.trim();if(!text)hint('UNIT',label,raw,'数量单位未填写，请按实际商品或计费口径核对；系统不会自动把件、箱、千克相互换算。',target);else if(currencies.has(text.toUpperCase())||['$','€','¥','￥'].includes(text))hint('UNIT',label,raw,'单位与本项目币种相同或像货币符号，请核对数量单位；这只是提醒，不自动判错或改成件。',target);};
 unit(project.goods.unit,'商品数量单位',{kind:'path',path:'goods.unit'});
 for(const item of project.items){
  if(item.source!=='USER'||item.applicable_incoterms!==undefined&&!item.applicable_incoterms.includes(project.incoterm))continue;
  const fee=(field:string,value:unknown,label:string,context:'amount'|'operand'|'fx'='operand',tier?:number)=>number(value,`${item.cost_name} · ${label}`,{kind:'item',id:item.cost_id,field,...(tier!==undefined?{tier}:{})},context);
  if(item.pricing_method==='FIXED'||item.pricing_method==='ACTUAL')fee('amount',item.amount,'原币金额','amount');
  if(item.pricing_method==='QTY_X_UNIT'){fee('quantity',item.quantity,'计费数量');fee('rate',item.rate,'单价');unit(item.unit??'',`${item.cost_name} · 计费单位`,{kind:'item',id:item.cost_id,field:'unit'});}
  if(item.pricing_method==='PER_DAY'){fee('days',item.days,'计费天数');fee('rate',item.rate,'日费率');}
  if(item.pricing_method==='PERCENT')fee('rate',item.rate,'比率');
  if(item.pricing_method==='TIERED'){const field=item.tier_basis==='DAYS'?'days':'quantity';fee(field,item[field],'计费量');item.tiers?.forEach((tier,i)=>{if(tier.up_to!==null)fee('tier-up',tier.up_to,`第${i+1}档上界`,'operand',i);fee('tier-rate',tier.rate,`第${i+1}档费率`,'operand',i);});}
  // Explicit FX is file-backed in this UI; point truthfully to the fee record, not an invented input.
  if(item.fx_rate!==undefined)fee('cost_name',item.fx_rate,'项目文件中的显式汇率（定位费用记录）','fx');
 }
 for(const row of rows)number(row.rate,`${row.from}/${row.to} ${row.type}汇率记录`,{kind:'fx',id:row.row_id},'fx');
 return issues;
}
export function renderInputReview(issues:readonly InputReview[]):string{
 return `<details class="panel input-review" data-evidence-section="input-review"><summary><span class="panel-title">输入精度与单位核对</span><span class="hint input-review-count">${issues.length?`${issues.length}项提醒`:'精度说明与核对范围'}</span></summary><div class="panel-body"><p>常规金额中间处理保留6位小数，当前算术为40位有效数字，卡片通常展示2位。中国进口税款等有独立舍入路径，仍按实际公式核对。</p><p class="hint">这里是只读提醒，不更改计算状态、排名、业务确认或原始文本。极端数值不属于本轮已验证的金额范围；未发现提醒也不保证所有中间运算精度。商业日期不按任意天数差判错，海关有效期仍按原规则检查。</p>${issues.length?`<ul class="input-review-list">${issues.slice(0,30).map(issue=>`<li data-input-review-code="${issue.code}"><strong>${h(issue.label)}</strong><p class="input-review-raw">原始输入：${h(issue.raw.length>80?issue.raw.slice(0,80)+`…（共${issue.raw.length}字符）`:issue.raw||'未填写')}</p><p>${h(issue.message)}</p><button type="button" data-action="locate-input-review" data-review-key="${h(issue.key)}">${issue.target.kind==='item'&&issue.target.field==='cost_name'?'定位费用记录':'定位原字段'} →</button></li>`).join('')}</ul>${issues.length>30?`<p>当前显示前30项，另有${issues.length-30}项；先核对前面输入，修改后会重新检查。</p>`:''}`:'<p class="hint">当前检查范围内没有额外提醒。必填项、税率、费用依赖及业务条件仍由原校验和实际资料核对。</p>'}<p class="hint">检查范围：核心数量/金额/单位、当前比较目标、当前术语启用的USER费用及六类计费参数、汇率记录。税率、其他术语独立合同报价、保险、账单和付款文件不在本面板的完整检查范围；未启用费用不解析，也不当作零费用。</p></div></details>`;
}
export function inputReviewElement(issue:InputReview):HTMLElement|null{
 const target=issue.target;const matches=[...document.querySelectorAll<HTMLElement>('[data-path],[data-item-field],[data-fx-field]')].filter(el=>target.kind==='path'?el.dataset.path===target.path:target.kind==='fx'?el.dataset.fx===target.id&&el.dataset.fxField==='rate':el.dataset.item===target.id&&el.dataset.itemField===target.field&&(target.tier===undefined||el.dataset.tierIndex===String(target.tier)));
 return matches.length===1?matches[0]!:null;
}
