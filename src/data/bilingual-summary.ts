import type { CustomerQuote } from '../domain/customer-quote.js';
import { incotermBasics } from '../domain/incoterm-basics.js';
import { resolveRisk } from '../engine/risk.js';
import { customerDocument } from './customer-document.js';

export interface LanguagePair { zh:string; en:string }
export interface BilingualSummary {
  version:'1.0'; reference:string; generatedAt:string;
  rows:{label:LanguagePair;value:string}[];
  standard:LanguagePair[];pending:(LanguagePair & {translated:boolean})[];
  disclaimer:LanguagePair;precision:LanguagePair;
}
const pair=(zh:string,en:string):LanguagePair=>({zh,en});
const LABELS=['Quotation issuer','Customer / recipient','Public reference','Goods','Quantity and unit','Total quotation (original currency)','Trade term and named place / port','Quotation validity','Delivery arrangements','Payment arrangements','Included scope','Excluded scope','Insurance arrangements','Tax treatment and conditions','Public remarks'] as const;
// Match the actual engine wording as well as the term. A changed/unrecognised branch
// must not silently inherit an English statement for another delivery condition.
const RISK_EN:Record<string,string>={
 '卖方在指定交货地点将货物置于买方处置之下、尚未装货时':'When the goods are placed at the buyer’s disposal at the named delivery place, not loaded on the collecting vehicle.',
 '在卖方场所将货物装上买方安排的运输工具，装货完成时':'When loading is completed on the transport arranged by the buyer at the seller’s premises.',
 '在其他指定地点，货物仍在卖方运输工具上、准备卸货并交由买方指定的承运人或其他人处置时':'At the other named place, when the goods remain on the seller’s transport, ready for unloading and at the disposal of the carrier or other person nominated by the buyer.',
 'FCA交货地点未确认：卖方场所为装货完成时；其他指定地点为在卖方运输工具上准备卸货并交由买方指定人员处置时':'FCA delivery place remains unconfirmed: loading completed at the seller’s premises, or ready for unloading on the seller’s transport at the other named place for the buyer’s nominated person.',
 '卖方将货物置于指定装运港船边时':'When the goods are placed alongside the vessel at the named port of shipment.',
 '货物在指定装运港装上船时':'When the goods are on board the vessel at the named port of shipment.',
 '卖方将货物交给承运人时':'When the goods are delivered to the carrier at the agreed delivery point.',
 '卖方在指定目的地将货物置于买方处置之下、尚未卸货时':'When the goods are placed at the buyer’s disposal on the arriving transport at the named destination, ready for unloading.',
 '卖方在指定目的地卸货完成时':'When the goods have been unloaded and placed at the buyer’s disposal at the named destination.',
};
const PENDING_EN:Record<string,string>={
 '报价有效期未完整或有效录入，须双方确认':'The quotation validity period is incomplete or invalid and requires confirmation by both parties.',
 '报价及有效期的核对尚未完成或已失效，须重新确认':'The quotation and validity review is incomplete or no longer valid; reconfirmation is required.',
 '方案仍有费用、税务或运输资料待核对，不能据此作确定承诺':'Cost, tax or transport information still requires review; this scenario cannot support firm commitments.',
 '方案测算未完成，须核对费用和适用条件后再确认条款':'Scenario calculation is incomplete; review costs and applicable conditions before confirming terms.',
 '具体交货地点及风险转移条件尚待确认':'The delivery place and conditions for risk transfer remain to be confirmed.',
 '报价提供方或接收方尚待填写':'The quotation issuer or recipient remains to be specified.',
 '具体交付时间及安排尚待约定':'The delivery schedule and arrangements remain to be agreed.',
 '付款方式、时间及币种安排尚待约定':'Payment method, timing and currency remain to be agreed.',
 '报价包含和不包含的费用范围尚待明确，不能只凭术语推定全部费用':'Included and excluded cost scopes remain to be specified; the trade term alone does not establish all cost items.',
 '实际保险安排或无需另行安排的约定尚待确认':'Actual insurance arrangements or an agreement that no separate arrangement is needed remain to be confirmed.',
 '税费口径及适用条件尚待双方核对':'Tax treatment and applicable conditions require review by both parties.',
 '文档生成日期不在所列报价有效期内，需重新确认报价，不能自动延长有效期':'The document date is outside the stated quotation validity period; reconfirm the quotation. The validity period is not automatically extended.',
};

export function bilingualSummary(quote:CustomerQuote,generatedAt=new Date().toISOString()):BilingualSummary {
 if(Number.isNaN(new Date(generatedAt).getTime()))throw Error('摘要生成时间无效');
 const term=quote.quote.incoterm,basics=incotermBasics(term);
 const candidates=term==='FCA'?[resolveRisk(term),resolveRisk(term,{delivery_place:'SELLER_PREMISES'}),resolveRisk(term,{delivery_place:'OTHER'})]:[resolveRisk(term)];
 const risk=candidates.find(r=>r.transfer_point===quote.standard.risk_point&&r.needs_confirmation===quote.standard.risk_pending);
 if(!risk||!RISK_EN[risk.transfer_point]||quote.standard.freight_risk_separated!==basics.freight_risk_separated||quote.standard.insurance_obligation!==basics.required_seller_insurance||quote.standard.import_cost_bearer!==basics.import_clearance_and_tax_costs)throw Error('公开术语提示与当前模板不一致，请核对后再生成中英文摘要');
 const source=customerDocument(quote,generatedAt);
 if(source.rows.length!==LABELS.length)throw Error('公开字段模板已变更，请核对中英文对应关系');
 const standard=[pair(`风险转移：${risk.transfer_point}。具体交货事实和双方另约仍须确认。`,`Risk transfer: ${RISK_EN[risk.transfer_point]} Actual delivery facts and any separate agreement require confirmation.`)];
 if(basics.freight_risk_separated)standard.push(pair('卖方支付运费至约定目的地，不代表货损风险持续由卖方承担至该目的地。','Seller-paid carriage to the agreed destination does not mean that the seller bears the risk of loss or damage until that destination.'));
 if(term==='CPT'||term==='CIP')standard.push(pair('采用多个承运人且未另约明确交货点时，通常在交给第一承运人时转移风险；各运输段与交货事实仍须核对。','Where multiple carriers are used and no specific delivery point is separately agreed, risk normally transfers on delivery to the first carrier. Transport legs and actual delivery facts still require review.'));
 if(basics.required_seller_insurance){const clause=term==='CIF'?'C':'A';standard.push(pair(`标准保险基线：卖方投保，默认协会货物条款(${clause})或等效保障，保额至少合同价110%，使用合同币种。另约及实际保单须单独核对；本摘要不证明保单合格。`,`Standard insurance baseline: the seller arranges cover under Institute Cargo Clauses (${clause}) or equivalent, for at least 110% of the contract price in the contract currency. Separate agreements and the actual policy require review; this summary does not certify coverage.`));}
 else standard.push(pair('本术语未规定双方须向对方订立保险合同；实际投保及保费承担依双方约定。','This trade term does not require either party to arrange insurance for the other. Actual insurance and premium allocation depend on their agreement.'));
 standard.push(pair(`标准进口清关及税费费用承担：${basics.import_clearance_and_tax_costs==='SELLER'?'卖方':'买方'}。费用承担不自动确定法定纳税人或抵扣资格；卸货费用另核合同。`,`Standard allocation of import clearance and tax costs: ${basics.import_clearance_and_tax_costs==='SELLER'?'seller':'buyer'}. Cost allocation does not determine the statutory taxpayer or entitlement to tax credits. Unloading costs require separate contract review.`));
 standard.push(pair('所有权、付款、违约处理及语言优先顺序须另约，本摘要不指定哪种语言优先。','Ownership, payment, remedies for breach and language precedence require separate agreement. This summary does not designate a prevailing language.'));
 return {version:'1.0',reference:source.reference,generatedAt:source.generatedAt,rows:source.rows.map(([zh,value],i)=>({label:pair(zh,LABELS[i]!),value})),standard,pending:source.pending.map(zh=>({zh,en:PENDING_EN[zh]??'Original pending notice is retained; English wording requires confirmation.',translated:!!PENDING_EN[zh]})),disclaimer:pair(source.disclaimer,'For learning and internal estimates only; this tool does not provide legal or professional trade advice. Actual contracts should follow the official Incoterms® text and applicable local law.'),precision:pair(source.precision,'Original-currency quotation precision is retained. Unit prices, tax amounts and binding commitments are not generated automatically.')};
}
