import { d, type Numeric } from '../domain/decimal.js';
import { CUSTOMER_QUOTE_FIELDS, type CustomerQuote, type CustomerQuoteFields } from '../domain/customer-quote.js';
import { isIncotermAvailable } from '../domain/enums.js';
import { incotermBasics } from '../domain/incoterm-basics.js';
import { quoteEvidenceValues } from '../domain/contract-evidence.js';
import { evidenceKey } from '../domain/source-evidence.js';
import { compare } from '../engine/compare.js';
import { checkSource } from '../engine/decision-readiness.js';
import { resolveRisk } from '../engine/risk.js';
import { isIsoDate } from '../engine/tax/china-import.js';
import { toScenario, toScenarios, toTrade, type ProjectFile } from './project-file.js';

export class CustomerQuoteInputError extends Error {}
const fail=(message:string):never=>{throw new CustomerQuoteInputError(message);};
function publicText(value:unknown,label:string):string {
  if(typeof value!=='string')return fail(`${label}须为文字`);
  if(value.length>4000)return fail(`${label}超过4000字符，请缩短公开说明`);
  return value.trim();
}
function positive(value:Numeric,label:string):string {
  // 与货物/报价录入的纯数字语义一致，不接受货币符号、千分位或特殊值。
  const text=String(value).trim();if(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text))return fail(`${label}须为正数，请核对原始报价`);
  try {const n=d(text);if(n.isFinite()&&n.gt(0))return n.toFixed();}catch{/* 对外错误不回显内部值。 */}
  return fail(`${label}须大于零`);
}

/** 从零构建白名单，不将内部计算对象、来源对象、异常或备注传给客户渲染器。 */
export function projectCustomerQuote(project:ProjectFile,fields:CustomerQuoteFields):CustomerQuote {
  if(project.anchor.kind!=='ACTUAL_QUOTES')return fail('客户报价说明仅支持独立录入的实际报价；请先切换比较基准并录入该术语报价');
  if(!isIncotermAvailable(project.carriage_mode,project.incoterm))return fail('所选术语不适用于当前运输方式，请先核对');
  const record=project.term_scenarios?.[project.incoterm],quote=record?.quote;
  if(!quote)return fail('当前术语没有实际报价，请先填写');
  const named_place=publicText(quote.named_place??'','指定地点或港口');if(!named_place)return fail('实际报价须填写指定地点或港口');
  if(!/^[A-Z]{3}$/.test(quote.currency))return fail('报价币种须为三位大写币种代码');
  const amount=positive(quote.amount,'报价总额'),quantity=positive(project.goods.quantity,'商品数量');
  const unit=publicText(project.goods.unit,'商品单位');if(!unit)return fail('商品单位尚未填写');
  // 逐字段取值，运行时传入额外属性也不能进入返回对象。
  const get=(key:keyof CustomerQuoteFields):string=>publicText(fields[key],'公开字段');
  for(const key of CUSTOMER_QUOTE_FIELDS)get(key);
  const description=get('goods_description')||publicText(project.goods.name,'商品名称');if(!description)return fail('商品名称或公开商品说明尚未填写');
  const evidence=record.quote_evidence,date=project.evaluation_date??'';
  const periodValid=!!evidence&&isIsoDate(evidence.valid_from)&&isIsoDate(evidence.valid_to)&&evidence.valid_from<=evidence.valid_to;
  const pending:string[]=[];
  if(!periodValid)pending.push('报价有效期未完整或有效录入，须双方确认');
  const scenario=toScenario(project),trade=toTrade(project);
  if(checkSource('报价',date,evidence,evidence?evidenceKey(quoteEvidenceValues(trade,scenario),evidence):undefined).issues.length)pending.push('报价及有效期的核对尚未完成或已失效，须重新确认');
  try {
    const comparison=compare({trade,template:scenario,scenarios:toScenarios(project),anchor:project.anchor,incoterms:[project.incoterm],taxProfile:project.tax_profile,fxBooks:project.fx_books,
      ...(project.export_date!==undefined?{today:project.export_date}:{})});
    if(!comparison.columns[0]?.decision_ready)pending.push('方案仍有费用、税务或运输资料待核对，不能据此作确定承诺');
  }catch{pending.push('方案测算未完成，须核对费用和适用条件后再确认条款');}
  const basics=incotermBasics(project.incoterm),risk=resolveRisk(project.incoterm,project.facts);
  if(risk.needs_confirmation)pending.push('具体交货地点及风险转移条件尚待确认');
  if(!get('issuer')||!get('recipient'))pending.push('报价提供方或接收方尚待填写');
  if(!get('delivery_terms'))pending.push('具体交付时间及安排尚待约定');
  if(!get('payment_terms'))pending.push('付款方式、时间及币种安排尚待约定');
  if(!get('included_scope')||!get('excluded_scope'))pending.push('报价包含和不包含的费用范围尚待明确，不能只凭术语推定全部费用');
  if(!get('insurance_terms'))pending.push('实际保险安排或无需另行安排的约定尚待确认');
  if(!get('tax_terms'))pending.push('税费口径及适用条件尚待双方核对');
  return {version:'1.0',kind:'CUSTOMER_QUOTE_DRAFT',issuer:get('issuer'),recipient:get('recipient'),reference:get('reference'),
    goods:{description,quantity,unit},quote:{amount,currency:quote.currency,incoterm:project.incoterm,named_place,incoterms_version:'2020',valid_from:periodValid?evidence!.valid_from:null,valid_to:periodValid?evidence!.valid_to:null},
    terms:{delivery:get('delivery_terms'),payment:get('payment_terms'),included:get('included_scope'),excluded:get('excluded_scope'),insurance:get('insurance_terms'),tax:get('tax_terms'),remarks:get('remarks')},
    standard:{risk_point:risk.transfer_point,risk_pending:risk.needs_confirmation,freight_risk_separated:basics.freight_risk_separated,insurance_obligation:basics.required_seller_insurance,import_cost_bearer:basics.import_clearance_and_tax_costs},pending};
}
