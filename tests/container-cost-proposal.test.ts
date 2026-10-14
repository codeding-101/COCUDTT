import {describe,expect,it} from 'vitest';
import Decimal from 'decimal.js';
import {containerBillTemplate} from '../src/data/container-bill-templates';
import {bindContainerBillDraft} from '../src/data/container-bill-context';
import {confirmContainerBillLine,confirmContainerBillCostReference} from '../src/engine/container-bill-draft';
import {proposeContainerCosts,confirmContainerCostIntent,containerCostProposalIsCurrent} from '../src/engine/container-cost-proposal';
import type {ContainerCostIntent,ContainerCostProposalInput} from '../src/domain/container-cost-proposal';
import {logisticsProject} from './fixtures/logistics-project';
import {makeCostItem} from './helpers/factory';
import {emptyEvidence} from '../src/domain/source-evidence';
import {serializeProject} from '../src/data/project-file';
import {serializeContainerBillDraft} from '../src/data/container-bill-file';
const source=()=>({...emptyEvidence(),reference:'人工核对合成账单与合同',valid_from:'2026-10-01',valid_to:'2026-10-31',checked_on:'2026-10-14'});
function setup(amount='240'){
 const project=logisticsProject('CIF');let bill=bindContainerBillDraft(containerBillTemplate('container-bill-synthetic-example'),project);
 // Fixed literal fixtures: two containers, per-container rate explicitly half the target amount.
 if(amount!=='240'){
  const input=bill.rows[0]!.input;delete input.period;delete input.daily;input.mode='PER_CONTAINER';input.charge_kind='INSPECTION';input.container_ids=['A'];input.rate=amount;
 }
 bill=confirmContainerBillLine(bill,bill.rows[0]!.input.line_id,source());
 const cost=makeCostItem({cost_id:'proposed',cost_name:'人工合同费用',amount,currency:'USD',container_charge:bill.rows[0]!.input.charge_kind as any,
  container_charge_scope:'synthetic-dd',applicable_incoterms:['CIF'],occurrence_reason:'NORMAL_OPERATION',responsibility:'BUYER',responsibility_source:'CONTRACT',payment_party:'BUYER',economic_bearer:'BUYER',customs_value:'EXCLUDE'});
 let intent:Extract<ContainerCostIntent,{operation:'CREATE_NEW'}>={operation:'CREATE_NEW',line_id:bill.rows[0]!.input.line_id,new_cost:cost,note:'明确原币、范围和合同承担；不是术语推定'};
 intent=confirmContainerCostIntent(project,bill,intent,source());
 const input:ContainerCostProposalInput={version:'0.1',intents:[intent]};return{project,bill,input,intent};
}
function freeze<T>(value:T):T {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
describe('费用提案：明确原金额与无金融写入',()=>{
 it('完整新费用只生成独立提案，冻结输入不变且输出副本隔离',()=>{
  const{project,bill,input}=setup(),before=[serializeProject(project),serializeContainerBillDraft(bill),JSON.stringify(input)];freeze(project);freeze(bill);freeze(input);
  const p=proposeContainerCosts(project,bill,input);expect(p.scope).toBe('NO_WRITE_PROPOSAL');expect(p.issues).toEqual([]);expect(p.rows[0]!.issues).toEqual([]);expect(p.rows[0]!.source_issues).toEqual([]);expect(p.rows[0]!.original_amount).toBe('240');expect(p).not.toHaveProperty('ready');expect(p).not.toHaveProperty('total');
  p.rows[0]!.proposed_cost!.amount='999';expect([serializeProject(project),serializeContainerBillDraft(bill),JSON.stringify(input)]).toEqual(before);
 });
 it.each([['0','0',false],['0.000001','0.000001',false],['0.000001000000000000','0.000001',false],['0.0000001','0.0000001',true],['0.1234567','0.1234567',true],['0.000000000000000001','0.000000000000000001',true],['123456789012345678.123456','123456789012345678.123456',false]])('固定手算 %s 精度边界不擅自舍入',(amount,original,loss)=>{
  const{project,bill,input}=setup(amount);const p=proposeContainerCosts(project,bill,input);expect(p.rows[0]!.original_amount).toBe(original);expect(p.rows[0]!.issues.includes('CORE_PRECISION_LOSS')).toBe(loss);expect(p.rows[0]!.proposed_cost!.amount).toBe(amount);
 });
 it('全局Decimal精度改低不影响提案原金额、匹配和精度阻断',()=>{const saved=Decimal.precision;try{Decimal.set({precision:2});const{project,bill,input}=setup('123456789012345678.123456');const p=proposeContainerCosts(project,bill,input);expect(p.rows[0]!.original_amount).toBe('123456789012345678.123456');expect(p.rows[0]!.issues).toEqual([]);}finally{Decimal.set({precision:saved});}});
 it.each(['numeric','exponent','rounded','different','negative'])('拒绝%s金额代替完整原币文本',kind=>{const{project,bill,input,intent}=setup('0.1234567');intent.new_cost.amount=kind==='numeric'?0.1234567:kind==='exponent'?'1.234567e-1':kind==='rounded'?'0.123457':kind==='negative'?'-0.1234567':'1';expect(proposeContainerCosts(project,bill,input).rows[0]!.issues).toContain('EXACT_ORIGINAL_AMOUNT_REQUIRED');});
});
describe('包含与范围不能按忽略处理',()=>{
 it.each(['existing-id','same-scope','combined-scope','included-quote','contained','thc-included','other-term','all-terms','group','goods','derived'])('阻断%s而不修改已有成本',kind=>{
  const{project,bill,input,intent}=setup(),cost=intent.new_cost;
  if(kind==='existing-id')project.items.push(makeCostItem({cost_id:cost.cost_id}));
  if(['same-scope','combined-scope'].includes(kind))project.items.push(makeCostItem({cost_id:'old',container_charge:kind==='same-scope'?'DEMURRAGE':'COMBINED_DD',container_charge_scope:'synthetic-dd'}));
  if(kind==='included-quote')cost.included_in_quoted_price=true;if(kind==='contained')cost.contained_in_cost_id='insurance';
  if(kind==='thc-included'){cost.container_charge='THC_DESTINATION';project.items.push(makeCostItem({cost_id:'thc-included',includes_port_charges:true}));}
  if(kind==='other-term')cost.applicable_incoterms=['CIP'];if(kind==='all-terms')delete cost.applicable_incoterms;if(kind==='group')cost.alternative_group='G';if(kind==='goods')cost.is_goods_value=true;if(kind==='derived')cost.base_amount='1680';
  const expected=kind==='existing-id'?'COST_ID_ALREADY_EXISTS':['same-scope','combined-scope'].includes(kind)?'EXISTING_COST_SCOPE_REVIEW_REQUIRED':kind==='thc-included'?'PORT_CHARGE_INCLUSION_REVIEW_REQUIRED':['other-term','all-terms'].includes(kind)?'CURRENT_TERM_ONLY_REQUIRED':'INCLUSION_OR_DERIVED_FIELDS_REVIEW_REQUIRED';
  const before=serializeProject(project);expect(proposeContainerCosts(project,bill,input).rows[0]!.issues).toContain(expected);expect(serializeProject(project)).toBe(before);
 });
 it('不活跃费用不错误阻断当前收费范围，但快照仍记录其变化',()=>{const{project,bill,input}=setup();project.items.push(makeCostItem({cost_id:'inactive',applicable_incoterms:['CIP'],container_charge:'DEMURRAGE',container_charge_scope:'synthetic-dd'}));expect(proposeContainerCosts(project,bill,input).rows[0]!.issues).not.toContain('EXISTING_COST_SCOPE_REVIEW_REQUIRED');});
 it.each(['combined','same','separate','incomplete'])('账单%s候选/不完整范围不丢失',kind=>{const{project,bill,input}=setup();const other=structuredClone(bill.rows[0]!);other.input.line_id='other';if(kind==='combined')other.input.charge_kind='COMBINED_DD';if(kind==='separate')other.input.charge_kind='DETENTION';if(kind==='incomplete')delete other.input.currency;bill.rows.push(other);const p=proposeContainerCosts(project,bill,input);expect(kind==='incomplete'?p.issues:p.rows[0]!.issues).toContain(kind==='incomplete'?'OVERLAP_SCOPE_INCOMPLETE':'BILL_OVERLAP_REVIEW_REQUIRED');});
 it.each(['responsibility','cause','payment','bearer','customs','note','currency','scope','type','source'])('缺少明确%s不能从术语补造',kind=>{const{project,bill,input,intent}=setup(),c=intent.new_cost;
  if(kind==='responsibility')c.responsibility='CONDITIONAL';if(kind==='cause')delete c.occurrence_reason;if(kind==='payment')delete c.payment_party;if(kind==='bearer')delete c.economic_bearer;if(kind==='customs')delete c.customs_value;if(kind==='note')intent.note='';if(kind==='currency')c.currency='CNY';if(kind==='scope')c.container_charge_scope='changed';if(kind==='type')c.container_charge='DETENTION';if(kind==='source')delete intent.evidence;
  const r=proposeContainerCosts(project,bill,input).rows[0]!;expect(r.issues.length+r.source_issues.length).toBeGreaterThan(0);
 });
});
describe('只读引用与完整快照重验证',()=>{
 function existing(){const{project,bill,input,intent}=setup();project.items.push(structuredClone(intent.new_cost));bill.rows[0]!.cost_reference={cost_id:'proposed',note:'同一原账单'};let confirmed=confirmContainerBillCostReference(bill,bill.rows[0]!.input.line_id,project,source());input.intents=[{operation:'REFERENCE_EXISTING',line_id:confirmed.rows[0]!.input.line_id,cost_id:'proposed',note:'只读引用，禁止再次新增'}];return{project,bill:confirmed,input};}
 it('已有费用匹配及独立来源确认仅返回引用，反复调用不会新增',()=>{const{project,bill,input}=existing(),before=serializeProject(project);const p=proposeContainerCosts(project,bill,input);expect(p.rows[0]!.issues).toEqual([]);expect(p.rows[0]!.source_issues).toEqual([]);expect(p.rows[0]!.proposed_cost).toBeNull();expect(containerCostProposalIsCurrent(p,project,bill,input)).toBe(true);expect(proposeContainerCosts(project,bill,input)).toEqual(p);expect(serializeProject(project)).toBe(before);});
 it.each(['included','contained','changed-amount','wrong-reference','removed'])('已有引用%s须复核',kind=>{const{project,bill,input}=existing();if(kind==='included')project.items.at(-1)!.included_in_quoted_price=true;if(kind==='contained')project.items.at(-1)!.contained_in_cost_id='insurance';if(kind==='changed-amount')project.items.at(-1)!.amount='241';if(kind==='wrong-reference')(input.intents[0] as any).cost_id='insurance';if(kind==='removed')project.items.pop();const r=proposeContainerCosts(project,bill,input).rows[0]!;expect(r.issues.length+r.source_issues.length).toBeGreaterThan(0);});
 it.each(['quote','term','fx','other-cost','deleted-row','copied-row','bill-id','source','intent','output-amount','output-issues','snapshot'])('提案后改变%s必须重新生成',kind=>{
  const{project,bill,input,intent}=setup(),p=proposeContainerCosts(project,bill,input);
  if(kind==='quote')project.term_scenarios!.CIF!.quote!.amount='11000';if(kind==='term')project.incoterm='CIP';if(kind==='fx')project.term_scenarios!.CIF!.quote!.fx_date='2026-10-15';if(kind==='other-cost')project.items[0]!.included_in_quoted_price=true;if(kind==='deleted-row')bill.rows=[];if(kind==='copied-row'){const r=structuredClone(bill.rows[0]!);r.input.line_id='copy';bill.rows.push(r);}if(kind==='bill-id')bill.id='copy';if(kind==='source')bill.rows[0]!.evidence!.reference='changed';if(kind==='intent')intent.note='changed';if(kind==='output-amount')p.rows[0]!.proposed_cost!.amount='999';if(kind==='output-issues')p.rows[0]!.issues.push('fake');if(kind==='snapshot')p.snapshot_key='fake';
  expect(containerCostProposalIsCurrent(p,project,bill,input)).toBe(false);
 });
 it('新费用确认来源绑定整个项目/账单/选择，EXAMPLE不可确认',()=>{const{project,bill,input,intent}=setup();expect(()=>confirmContainerCostIntent(project,bill,intent,{...source(),status:'EXAMPLE'})).toThrow(/example_source/);project.items[0]!.notes='changed';expect(proposeContainerCosts(project,bill,input).rows[0]!.source_issues.length).toBeGreaterThan(0);});
 it('同一行或同一目标费用多次选择均待核对',()=>{const{project,bill,input}=setup();input.intents.push(structuredClone(input.intents[0]!));const p=proposeContainerCosts(project,bill,input);for(const r of p.rows){expect(r.issues).toContain('DUPLICATE_LINE_INTENT');expect(r.issues).toContain('MULTIPLE_LINES_TARGET_SAME_COST');}});
 it('缺少绑定/未知行/空提案不被当作零费用或完成',()=>{const{project,bill,input,intent}=setup();bill.binding=null;intent.line_id='unknown';expect(proposeContainerCosts(project,bill,input).issues).toContain('PROJECT_BINDING_MISMATCH');expect(proposeContainerCosts(project,bill,input).rows[0]!.issues).toContain('UNKNOWN_BILL_LINE');input.intents=[];expect(proposeContainerCosts(project,bill,input).issues).toContain('EMPTY_PROPOSAL_SCOPE');});
});
describe('新API结构与旧容器不静默激活',()=>{
 it.each([['input',11],['output',6]])('%s超过10MiB拒绝，避免生成无法重验证的大提案',(_kind,size)=>{const{project,bill,input,intent}=setup();intent.new_cost.notes='x'.repeat(size as number*1024*1024);expect(()=>proposeContainerCosts(project,bill,input)).toThrow('CONTAINER_COST_PROPOSAL_INVALID:size');});
 it('新费用的未知字段不能随提案悄悄带入项目',()=>{const{project,bill,input,intent}=setup();(intent.new_cost as any).future_apply={enabled:true};expect(()=>proposeContainerCosts(project,bill,input)).toThrow(/shape/);});
 it('FIXED费用仍有其他计费字段时保留但要求明确清理',()=>{const{project,bill,input,intent}=setup();intent.new_cost.rate='10';expect(proposeContainerCosts(project,bill,input).rows[0]!.issues).toContain('INACTIVE_PRICING_FIELDS_REVIEW_REQUIRED');expect(intent.new_cost.rate).toBe('10');});
 it.each(['version','root-field','intent-field','unknown-operation','null-intent','too-many','lossy','getter','cycle','sparse','array-extra','symbol'])('明确拒绝%s',kind=>{
  const{project,bill,input}=setup();const raw:any=input;
  if(kind==='version')raw.version='1.0';if(kind==='root-field')raw.apply=true;if(kind==='intent-field')raw.intents[0].skip_overlap=true;if(kind==='unknown-operation')raw.intents[0].operation='APPLY';if(kind==='null-intent')raw.intents=[null];if(kind==='too-many')raw.intents=Array(51).fill(raw.intents[0]);if(kind==='lossy')raw.intents[0].new_cost.notes=undefined;if(kind==='getter')Object.defineProperty(raw,'hidden',{enumerable:true,get(){throw Error('must not execute');}});if(kind==='cycle')raw.cycle=raw;if(kind==='sparse')raw.intents=Array(1);if(kind==='array-extra')Object.defineProperty(raw.intents,'hidden',{value:1});if(kind==='symbol')raw[Symbol('hidden')]=1;
  expect(()=>proposeContainerCosts(project,bill,input)).toThrow(/^CONTAINER_COST_PROPOSAL_INVALID:/);
 });
 it('旧项目/账单同名扩展无效，文件版本保持原样',()=>{const{project,bill,input}=setup();const before=proposeContainerCosts(project,bill,input).rows;(project as any).container_cost_proposals={apply:true,cost_id:'hidden'};bill.extensions={container_cost_proposals:{apply:true,amount:'999'}};expect(proposeContainerCosts(project,bill,input).rows.map(r=>r.issues)).toEqual(before.map(r=>r.issues));expect(project.schema_version).toBe('0.8');expect(bill.version).toBe('1.0');expect(project.items.some(c=>c.cost_id==='hidden')).toBe(false);});
});
