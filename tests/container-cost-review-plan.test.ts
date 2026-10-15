import {readFileSync} from 'node:fs';
import Ajv from 'ajv';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createContainerCostReviewPlan,setContainerReviewRecord,confirmContainerReviewRecord,removeContainerReviewRecord,rebaseContainerCostReviewPlan,reviewContainerCostReviewPlan,serializeContainerCostReviewPlan,parseContainerCostReviewPlan,validateContainerCostReviewPlan,containerCostReviewPlanSchema,CONTAINER_REVIEW_PLAN_BYTES} from '../src/data/container-cost-review-plan';
import {createContainerCostPair,updateContainerCostPair,parseContainerCostPair,serializeContainerCostPair} from '../src/data/container-cost-pair';
import {containerBillTemplate} from '../src/data/container-bill-templates';
import {bindContainerBillDraft} from '../src/data/container-bill-context';
import {reviewContainerCostBoundaries} from '../src/engine/container-cost-review';
import {copyContainerBusiness} from '../src/data/container-business-copy';
import {emptyEvidence,evidenceKey} from '../src/domain/source-evidence';
import type {ContainerCostPair} from '../src/domain/container-cost-pair';
import type {ContainerCostReviewPlan,ContainerReviewRecordInput} from '../src/domain/container-cost-review-plan';
import {makeCostItem} from './helpers/factory';
import {logisticsProject} from './fixtures/logistics-project';
import {parseProject,toTrade,toScenario} from '../src/data/project-file';
import {parseContainerBillDraft} from '../src/data/container-bill-file';
import {parseSettlementPlan} from '../src/data/settlement-file';
import {analyze} from '../src/engine/analyze';
const schema=new Ajv({strict:true,allErrors:true}).compile(containerCostReviewPlanSchema());
const source=()=>({...emptyEvidence(),reference:'Synthetic contract A section 1',valid_from:'2026-10-01',valid_to:'2026-10-31',checked_on:'2026-10-14'});
function setup(kind='INTERSECTION'){
 const project=logisticsProject('CIF'),bill=bindContainerBillDraft(containerBillTemplate('container-bill-synthetic-example'),project);bill.review_date='2026-10-15';
 const line=(id:string)=>({line_id:id,scope_id:id==='A'?'S1':'OTHER',direction:'IMPORT',equipment_type:'20GP',container_ids:[id==='B'&&kind==='DISJOINT'?'BOX2':'BOX1'],currency:'USD',reference:'Synthetic bill',charge_kind:'DEMURRAGE',mode:'DAILY',period:{start_date:'2026-10-01',end_date:'2026-10-03',start_included:true,end_included:true,start_event:'Start',end_event:'End'},daily:{free_day_basis:'CALENDAR_DAYS',charge_day_basis:'CALENDAR_DAYS',free_days:0,tier_mode:'MARGINAL',tier_basis:'AFTER_FREE_TIME',tiers:[{through_day:null,rate:kind==='LOSS'?'0.0000005':'1'}]}});
 bill.rows=[{input:line('A')},{input:line('B')}];
 if(kind==='PARENT')project.items.push(makeCostItem({cost_id:'P',amount:'30',currency:'USD'}));
 if(kind==='EXISTING')project.items.push(makeCostItem({cost_id:'old-dd',amount:'20',currency:'USD',container_charge:'DEMURRAGE',container_charge_scope:'OTHER'}));
 const cost=makeCostItem({cost_id:'new-cost',amount:kind==='LOSS'?'0.0000015':'3',currency:'USD',included_in_quoted_price:true,container_charge:'DEMURRAGE',container_charge_scope:'S1',applicable_incoterms:['CIF'],occurrence_reason:'NORMAL_OPERATION',responsibility:'BUYER',responsibility_source:'CONTRACT',payment_party:'BUYER',economic_bearer:'BUYER',customs_value:'EXCLUDE',...(kind==='PARENT'?{contained_in_cost_id:'P'}:{})});
 const pair=createContainerCostPair(project,bill,{version:'0.1',intents:[{operation:'CREATE_NEW',line_id:'A',new_cost:cost,note:'Synthetic only'}]});
 return{pair,project,bill,cost,plan:createContainerCostReviewPlan(pair,pair.content_key)};
}
function input(pair:ContainerCostPair,decision:ContainerReviewRecordInput['decision'],existing=false):ContainerReviewRecordInput {
 const m=pair.mapping.entries[0]!,target={kind:'ROW' as const,mapping_id:m.mapping_id,line_id:m.line_id,cost_id:m.cost_id},common={explanation:'Synthetic assumption, contract section 1',evidence:source()};
 if(decision==='FULL_PARENT_INCLUSION')return{...common,decision,target:{...target,kind:'PARENT',parent_cost_id:'P'},coverage:'FULL'};
 if(decision==='DIFFERENT_CHARGE_CONTENT')return{...common,decision,target:existing?{...target,kind:'EXISTING_COST',target_cost_id:'old-dd'}:{kind:'BILL_PAIR',line_ids:['A','B']},left_description:'Cargo storage service',right_description:'Equipment use service'};
 if(decision==='DISJOINT_COVERAGE')return{...common,decision,target:{kind:'BILL_PAIR',line_ids:['A','B']}};
 return{...common,decision,target};
}
const add=(p:ContainerCostReviewPlan,pair:ContainerCostPair,decision:ContainerReviewRecordInput['decision'])=>setContainerReviewRecord(p,p.content_key,pair,input(pair,decision));
const confirm=(p:ContainerCostReviewPlan,pair:ContainerCostPair,id=p.records[0]!.record_id)=>confirmContainerReviewRecord(p,p.content_key,pair,id);
function resign(p:ContainerCostReviewPlan){const{content_key:_key,...v}=p;p.content_key=evidenceKey(v,emptyEvidence());return p;}
function freeze<T>(v:T):T{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
afterEach(()=>vi.restoreAllMocks());

describe('独立记录层：五类假设、持久化与确认边界',()=>{
 it.each(['QUOTE_INCLUDED','KEEP_RECORDED_AMOUNT','FULL_PARENT_INCLUSION','DIFFERENT_CHARGE_CONTENT','DISJOINT_COVERAGE'] as const)('%s明确记录、确认、往返',decision=>{
  const{pair,plan}=setup(decision==='FULL_PARENT_INCLUSION'?'PARENT':decision==='DISJOINT_COVERAGE'?'DISJOINT':'INTERSECTION');
  const recorded=add(plan,pair,decision);expect(schema(recorded)).toBe(true);expect(recorded.records[0]!.evidence.status).toBe('UNVERIFIED');
  const checked=confirm(recorded,pair),r=reviewContainerCostReviewPlan(parseContainerCostReviewPlan(serializeContainerCostReviewPlan(checked)),pair);
  expect(r.records[0]).toMatchObject({status:'RECORDED_ASSUMPTION',issues:[]});expect(r.boundary_review).toEqual(reviewContainerCostBoundaries(pair,pair.content_key));
  expect(r.issues).toEqual(['NO_FEE_APPLICATION']);expect(r).not.toHaveProperty('ready');
 });
 it('已有费用的不同收费内容只能针对当前候选',()=>{
  const{pair,plan}=setup('EXISTING'),p=setContainerReviewRecord(plan,plan.content_key,pair,input(pair,'DIFFERENT_CHARGE_CONTENT',true));expect(reviewContainerCostReviewPlan(confirm(p,pair),pair).records[0]!.status).toBe('RECORDED_ASSUMPTION');
 });
 it('不同记录修订不进入确认依据，确认第二条不使第一条失效',()=>{
  const{pair,plan}=setup();const first=confirm(add(plan,pair,'QUOTE_INCLUDED'),pair),next=add(first,pair,'KEEP_RECORDED_AMOUNT');
  expect(reviewContainerCostReviewPlan(next,pair).records.map(r=>r.status)).toEqual(['RECORDED_ASSUMPTION','NEEDS_REVIEW']);
  const all=confirm(next,pair,next.records[1]!.record_id);expect(reviewContainerCostReviewPlan(all,pair).records.every(r=>r.status==='RECORDED_ASSUMPTION')).toBe(true);expect(all.revision).toBe(5);
 });
 it('编辑保持同一记录ID，只撤销该条来源，不丢另一条确认',()=>{
  const{pair,plan}=setup(),first=confirm(add(plan,pair,'QUOTE_INCLUDED'),pair),two=add(first,pair,'KEEP_RECORDED_AMOUNT'),both=confirm(two,pair,two.records[1]!.record_id);
  const edit=input(pair,'QUOTE_INCLUDED');edit.explanation='Updated assumption';const p=setContainerReviewRecord(both,both.content_key,pair,edit);
  expect(p.records[0]!.record_id).toBe(both.records[0]!.record_id);expect(p.records[0]!.evidence).not.toHaveProperty('values_key');expect(reviewContainerCostReviewPlan(p,pair).records.map(r=>r.status)).toEqual(['NEEDS_REVIEW','RECORDED_ASSUMPTION']);
 });
 it('修改来源会撤销确认，输入USER_CONFIRMED也不能伪造点击确认',()=>{
  const{pair,plan}=setup(),p=confirm(add(plan,pair,'QUOTE_INCLUDED'),pair),edit=input(pair,'QUOTE_INCLUDED');edit.evidence={...p.records[0]!.evidence,reference:'New source'};
  const next=setContainerReviewRecord(p,p.content_key,pair,edit);expect(next.records[0]!.evidence.status).toBe('UNVERIFIED');expect(next.records[0]!.evidence.values_key).toBeUndefined();
 });
 it('EXAMPLE可保留但不能确认',()=>{const{pair,plan}=setup(),i=input(pair,'QUOTE_INCLUDED');i.evidence.status='EXAMPLE';const p=setContainerReviewRecord(plan,plan.content_key,pair,i);expect(()=>confirm(p,pair)).toThrow(/confirmation/);expect(p.records[0]!.evidence.status).toBe('EXAMPLE');});
 it('超6位原金额即使记录并确认仍保留LOSS及旧提案阻断',()=>{
  const{pair,plan}=setup('LOSS'),p=confirm(add(plan,pair,'KEEP_RECORDED_AMOUNT'),pair),r=reviewContainerCostReviewPlan(p,pair);
  expect(r.boundary_review.rows[0]!.core_precision).toBe('LOSS');expect(r.boundary_review.proposal.rows[0]!.issues).toContain('CORE_PRECISION_LOSS');expect(r.boundary_review.rows[0]!.original_amount).toBe('0.0000015');
 });
 it('含税保留假设不变成拆税/抵扣或海关金额',()=>{
  const{pair,project,bill,cost}=setup();cost.tax_included=true;cost.tax_rate_ref='Synthetic only';const p=createContainerCostPair(project,bill,{version:'0.1',intents:[{...pair.selection.intents[0]!,operation:'CREATE_NEW',new_cost:cost}]});
  const plan=createContainerCostReviewPlan(p,p.content_key),r=reviewContainerCostReviewPlan(confirm(add(plan,p,'KEEP_RECORDED_AMOUNT'),p),p);
  expect(r.boundary_review.rows[0]!.channels).toMatchObject({cash_amount:'3',economic_cost:null,customs_adjustment:null});expect(r.boundary_review.rows[0]!.issues).toContain('TAX_INCLUSIVE_TREATMENT_UNSUPPORTED');
 });
 it('内部原文往返不执行HTML或解释扩展',()=>{
  const{pair,plan}=setup(),i=input(pair,'QUOTE_INCLUDED');i.explanation='<script>private</script> & 中文';const p=add(plan,pair,'KEEP_RECORDED_AMOUNT'),next=setContainerReviewRecord(p,p.content_key,pair,i);
  expect(parseContainerCostReviewPlan(serializeContainerCostReviewPlan(next))).toEqual(next);
 });
});

describe('完整业务快照与来源失效',()=>{
 it.each(['amount','term','source','mapping','quote','fx','review-date','unknown-extension'])('%s修改必须显式重绑并重新确认',kind=>{
  const{pair,plan}=setup(),p=confirm(add(plan,pair,'QUOTE_INCLUDED'),pair),project=structuredClone(pair.project),bill=structuredClone(pair.bill),selection=structuredClone(pair.selection);
  if(kind==='amount'&&selection.intents[0]!.operation==='CREATE_NEW')selection.intents[0]!.new_cost.amount='4';if(kind==='term')project.incoterm='CIP';if(kind==='source')bill.notes='Source changed';
  if(kind==='mapping'&&selection.intents[0]!.operation==='CREATE_NEW')selection.intents[0]!.new_cost.cost_id='new-target';if(kind==='quote')project.quote.amount='123';if(kind==='fx')project.fx_books.push({id:'fx',name:'Synthetic',date:'2026-10-15',type:'MARKET',rates:{'USD/CNY':'7'}});if(kind==='review-date')bill.review_date='2026-10-16';if(kind==='unknown-extension')(project as any).review_plan={ignore:true};
  const current=updateContainerCostPair(pair,pair.content_key,project,bill,selection);expect(reviewContainerCostReviewPlan(p,current).records[0]!.status).toBe('NEEDS_REVIEW');
  expect(()=>setContainerReviewRecord(p,p.content_key,current,input(current,'QUOTE_INCLUDED'))).toThrow(/stale_basis/);
  const rebound=rebaseContainerCostReviewPlan(p,p.content_key,current,current.content_key);expect(rebound.records[0]!.evidence.status).toBe('UNVERIFIED');expect(rebound.records[0]!.evidence.values_key).toBeUndefined();expect(rebound.records[0]!.explanation).toBe(p.records[0]!.explanation);
 });
 it('删除目标后重绑保留原文和坏目标待办，不默默删除记录',()=>{
  const{pair,plan}=setup(),p=confirm(add(plan,pair,'QUOTE_INCLUDED'),pair),current=updateContainerCostPair(pair,pair.content_key,pair.project,pair.bill,{version:'0.1',intents:[]});
  const r=rebaseContainerCostReviewPlan(p,p.content_key,current,current.content_key);expect(r.records).toHaveLength(1);expect(reviewContainerCostReviewPlan(r,current).records[0]!.issues).toContain('MAPPING_TARGET_MISSING');expect(()=>confirm(r,current)).toThrow(/confirmation/);
 });
 it('同一业务不变时重绑不增修订或清除确认',()=>{const{pair,plan}=setup(),p=confirm(add(plan,pair,'QUOTE_INCLUDED'),pair);expect(rebaseContainerCostReviewPlan(p,p.content_key,pair,pair.content_key)).toEqual(p);});
 it('新业务副本不能继承旧核对记录',()=>{
  const{pair,plan}=setup(),copy=copyContainerBusiness(pair,pair.content_key,'New synthetic business','2026-10-15T00:00:00.000Z');expect(()=>rebaseContainerCostReviewPlan(plan,plan.content_key,copy,copy.content_key)).toThrow(/different_business/);
 });
 it.each(['missing-reference','missing-from','missing-to','invalid-checked','future-checked','reversed','outdated'])('%s不能确认来源',kind=>{
  const{pair,plan}=setup(),i=input(pair,'QUOTE_INCLUDED');if(kind==='missing-reference')i.evidence.reference='';if(kind==='missing-from')i.evidence.valid_from='';if(kind==='missing-to')i.evidence.valid_to='';if(kind==='invalid-checked')i.evidence.checked_on='2026-02-30';if(kind==='future-checked')i.evidence.checked_on='2026-10-16';if(kind==='reversed')i.evidence.valid_from='2026-11-01';if(kind==='outdated')i.evidence.valid_to='2026-09-30';
  const p=setContainerReviewRecord(plan,plan.content_key,pair,i);expect(()=>confirm(p,pair)).toThrow(/source/);expect(p.records[0]!.evidence.status).toBe('UNVERIFIED');
 });
 it.each(['explanation','reference','target','basis','plan-identity','checked-on','record-id'])('重算内容键不能让篡改%s继续确认',kind=>{
  const{pair,plan}=setup(),p=confirm(add(plan,pair,'QUOTE_INCLUDED'),pair);if(kind==='explanation')p.records[0]!.explanation='Changed';if(kind==='reference')p.records[0]!.evidence.reference='Changed';
  if(kind==='target')(p.records[0]!.target as any).cost_id='other';if(kind==='basis')p.basis.pair_revision++;if(kind==='plan-identity')p.plan_id='other-plan';if(kind==='checked-on')p.records[0]!.evidence.checked_on='2026-10-13';if(kind==='record-id')p.records[0]!.record_id='other-record';resign(p);
  expect(schema(p)).toBe(true);expect(reviewContainerCostReviewPlan(p,pair).records[0]!.status).toBe('NEEDS_REVIEW');
 });
});

describe('目标资格与不能通过的假设',()=>{
 it.each(['intersection','mixed','unknown','non-selected'])('%s不能记录为程序证明范围不交',kind=>{
  const{pair,plan,project,bill}=setup();if(kind==='intersection'){expect(()=>add(plan,pair,'DISJOINT_COVERAGE')).toThrow(/unsupported_target/);return;}
  if(kind==='mixed')bill.rows[1]!.input={line_id:'B',scope_id:'S1',direction:'IMPORT',equipment_type:'20GP',container_ids:['BOX1'],currency:'USD',reference:'Synthetic',charge_kind:'INSPECTION',mode:'PER_CONTAINER',rate:'1'};
  if(kind==='unknown')delete bill.rows[1]!.input.period!.end_included;if(kind==='non-selected')bill.rows.push({...structuredClone(bill.rows[1]!),input:{...bill.rows[1]!.input,line_id:'C'}});
  const p=createContainerCostPair(project,bill,pair.selection),q=createContainerCostReviewPlan(p,p.content_key),i=input(p,'DISJOINT_COVERAGE');if(kind==='non-selected')(i.target as any).line_ids=['B','C'];expect(()=>setContainerReviewRecord(q,q.content_key,p,i)).toThrow(/unsupported_target/);
 });
 it.each(['missing','inactive','cycle','self','cross-currency','partial'])('%s父项不能被确认成全额包含',kind=>{
  const{project,bill,pair,cost}=setup('PARENT');if(kind==='missing')project.items=project.items.filter(c=>c.cost_id!=='P');if(kind==='inactive')project.items.find(c=>c.cost_id==='P')!.applicable_incoterms=['FOB'];if(kind==='cycle')project.items.find(c=>c.cost_id==='P')!.contained_in_cost_id=cost.cost_id;if(kind==='self')cost.contained_in_cost_id=cost.cost_id;if(kind==='cross-currency')project.items.find(c=>c.cost_id==='P')!.currency='CNY';
  const p=createContainerCostPair(project,bill,{version:'0.1',intents:[{...pair.selection.intents[0]!,operation:'CREATE_NEW',new_cost:cost}]}),q=createContainerCostReviewPlan(p,p.content_key),i:any=input(p,'FULL_PARENT_INCLUSION');if(kind==='partial')i.coverage='PARTIAL';expect(()=>setContainerReviewRecord(q,q.content_key,p,i)).toThrow();
 });
 it('当前没有包含标记时不捏造报价包含记录',()=>{
  const{project,bill,pair,cost}=setup();cost.included_in_quoted_price=false;const p=createContainerCostPair(project,bill,{version:'0.1',intents:[{...pair.selection.intents[0]!,operation:'CREATE_NEW',new_cost:cost}]}),q=createContainerCostReviewPlan(p,p.content_key);expect(()=>add(q,p,'QUOTE_INCLUDED')).toThrow(/unsupported_target/);
 });
 it.each(['mapping','cost','line','existing-cost'])('%s坏目标不能用说明绕过',kind=>{
  const{pair,plan}=setup('EXISTING'),i:any=input(pair,kind==='existing-cost'?'DIFFERENT_CHARGE_CONTENT':'QUOTE_INCLUDED',true);
  if(kind==='mapping')i.target.mapping_id='missing';if(kind==='cost')i.target.cost_id='missing';if(kind==='line')i.target.line_id='missing';if(kind==='existing-cost')i.target.target_cost_id='unrelated';expect(()=>setContainerReviewRecord(plan,plan.content_key,pair,i)).toThrow(/unsupported_target/);
 });
 it.each(['same','trimmed','NFC'])('%s服务说明不能证明不同收费内容',kind=>{
  const{pair,plan}=setup(),i:any=input(pair,'DIFFERENT_CHARGE_CONTENT');i.left_description=kind==='NFC'?'é':'same';i.right_description=kind==='NFC'?'e\u0301':kind==='trimmed'?' same ':'same';expect(()=>setContainerReviewRecord(plan,plan.content_key,pair,i)).toThrow(/same_description/);
 });
 it('反向行序不能默默交换两边说明',()=>{const{pair,plan}=setup(),i:any=input(pair,'DIFFERENT_CHARGE_CONTENT');i.target.line_ids=['B','A'];expect(()=>setContainerReviewRecord(plan,plan.content_key,pair,i)).toThrow(/line_order/);});
 it.each(['IGNORE','ROUND_AMOUNT','DEDUCT_VAT'])('%s不受支持',decision=>{const{pair,plan}=setup(),i:any=input(pair,'KEEP_RECORDED_AMOUNT');i.decision=decision;expect(()=>setContainerReviewRecord(plan,plan.content_key,pair,i)).toThrow();});
 it('含分隔符的行ID不能伪造另一组覆盖目标',()=>{
  const{project,bill,cost}=setup();bill.rows[0]!.input.line_id='A\0B';bill.rows[1]!.input.line_id='C';
  const pair=createContainerCostPair(project,bill,{version:'0.1',intents:[{operation:'CREATE_NEW',line_id:'A\0B',new_cost:cost,note:'Synthetic'}]}),plan=createContainerCostReviewPlan(pair,pair.content_key),i:any=input(pair,'DIFFERENT_CHARGE_CONTENT');
  i.target.line_ids=['A','B\0C'];expect(()=>setContainerReviewRecord(plan,plan.content_key,pair,i)).toThrow(/unsupported_target/);
 });
 it('不可计算账单不能以保持录入金额代替缺失金额',()=>{
  const{project,bill,pair}=setup();delete bill.rows[0]!.input.daily!.tiers;const p=createContainerCostPair(project,bill,pair.selection),plan=createContainerCostReviewPlan(p,p.content_key);expect(()=>add(plan,p,'KEEP_RECORDED_AMOUNT')).toThrow(/unsupported_target/);
 });
});

describe('修订、删除与严格文件边界',()=>{
 it('旧记录租约不能覆盖新修订，失败不改变原记录',()=>{const{pair,plan}=setup(),p=add(plan,pair,'QUOTE_INCLUDED'),raw=serializeContainerCostReviewPlan(p);expect(()=>setContainerReviewRecord(freeze(p),plan.content_key,pair,input(pair,'KEEP_RECORDED_AMOUNT'))).toThrow(/stale_plan/);expect(serializeContainerCostReviewPlan(p)).toBe(raw);});
 it('删除保留身份，新建不得复用退休ID',()=>{
  const{pair,plan}=setup(),p=add(plan,pair,'QUOTE_INCLUDED'),id=p.records[0]!.record_id,removed=removeContainerReviewRecord(p,p.content_key,id);expect(removed.retired_record_ids).toEqual([id]);
  vi.spyOn(crypto,'randomUUID').mockReturnValue(id.slice(7) as `${string}-${string}-${string}-${string}-${string}`);expect(()=>add(removed,pair,'QUOTE_INCLUDED')).toThrow(/identity_collision/);expect(removed.records).toEqual([]);
 });
 it('来源确认、记录保存不改变原配对、旧分析、包含或费用',()=>{
  const{pair,plan}=setup(),raw=serializeContainerCostPair(pair),args={trade:toTrade(pair.project),scenario:toScenario(pair.project),taxProfile:pair.project.tax_profile,fxBooks:pair.project.fx_books},before=analyze(args);
  const p=confirm(add(freeze(plan),freeze(pair),'QUOTE_INCLUDED'),pair);serializeContainerCostReviewPlan(p);expect(serializeContainerCostPair(pair)).toBe(raw);expect(analyze(args)).toEqual(before);
 });
 it.each(['undefined','NaN','getter','cycle','sparse','symbol'])('有损JSON %s不能得到内容键',kind=>{
  const{plan}=setup();let called=false;const p:any=plan;if(kind==='undefined')p.extra=undefined;if(kind==='NaN')p.extra=NaN;if(kind==='getter')Object.defineProperty(p,'extra',{enumerable:true,get(){called=true;throw Error('private');}});if(kind==='cycle')p.extra=p;if(kind==='sparse')p.records=Array(1);if(kind==='symbol')p[Symbol('extra')]=1;expect(()=>serializeContainerCostReviewPlan(p)).toThrow(/JSON_CONTENT/);expect(called).toBe(false);
 });
 it.each(['root','basis','record','target','future-version','revision','duplicate-record','duplicate-facet','retired-active'])('%s结构或跨引用非法被拒绝',kind=>{
  const{pair,plan}=setup(),p:any=add(plan,pair,'QUOTE_INCLUDED');if(kind==='root')p.apply=true;if(kind==='basis')p.basis.ignore=true;if(kind==='record')p.records[0].ready=true;if(kind==='target')p.records[0].target.ignore=true;if(kind==='future-version')p.version='0.2';if(kind==='revision')p.revision=0;if(kind==='duplicate-record')p.records.push(structuredClone(p.records[0]));if(kind==='duplicate-facet')p.records.push({...structuredClone(p.records[0]),record_id:'other'});if(kind==='retired-active')p.retired_record_ids.push(p.records[0].record_id);resign(p);expect(()=>validateContainerCostReviewPlan(p)).toThrow();
 });
 it('同一覆盖目标切换分类保留ID并撤销确认',()=>{
  const{pair,plan}=setup('DISJOINT'),p=confirm(add(plan,pair,'DISJOINT_COVERAGE'),pair),q=setContainerReviewRecord(p,p.content_key,pair,input(pair,'DIFFERENT_CHARGE_CONTENT'));expect(q.records).toHaveLength(1);expect(q.records[0]!.record_id).toBe(p.records[0]!.record_id);expect(q.records[0]!.evidence.status).toBe('UNVERIFIED');
 });
 it('2000退休ID边界通过，2001整体拒绝',()=>{
  const{plan}=setup();plan.retired_record_ids=Array.from({length:2000},(_,n)=>'old-'+n);resign(plan);expect(()=>validateContainerCostReviewPlan(plan)).not.toThrow();plan.retired_record_ids.push('extra');resign(plan);expect(()=>validateContainerCostReviewPlan(plan)).toThrow(/records/);
 });
 it('2000记录保留，2001不截断；导入不使短伪造确认变有效',()=>{
  const{pair,plan}=setup(),base=add(plan,pair,'QUOTE_INCLUDED').records[0]!;
  plan.records=Array.from({length:2000},(_,n)=>({...structuredClone(base),record_id:'R'+n,target:{...base.target,kind:'ROW',mapping_id:'M'+n,line_id:'L'+n,cost_id:'C'+n},decision:'QUOTE_INCLUDED',evidence:{...source(),status:'USER_CONFIRMED',values_key:'bad'}}));resign(plan);
  expect(parseContainerCostReviewPlan(serializeContainerCostReviewPlan(plan)).records).toHaveLength(2000);const report=reviewContainerCostReviewPlan(plan,pair);expect(report.records).toHaveLength(2000);expect(report.records.every(r=>r.status==='NEEDS_REVIEW')).toBe(true);
  plan.records.push({...structuredClone(base),record_id:'extra'});resign(plan);expect(()=>validateContainerCostReviewPlan(plan)).toThrow(/records/);
 });
 it('修订上限拒绝后续编辑，原计划保持',()=>{const{pair,plan}=setup();plan.revision=1000000000;resign(plan);expect(()=>add(plan,pair,'QUOTE_INCLUDED')).toThrow(/revision_limit/);expect(plan.revision).toBe(1000000000);});
 it('10MiB UTF-8限制、解析错误不泄漏原文',()=>{
  expect(()=>parseContainerCostReviewPlan(' '.repeat(CONTAINER_REVIEW_PLAN_BYTES+1))).toThrow(/size/);expect(()=>parseContainerCostReviewPlan('😀'.repeat(2700000))).toThrow(/size/);expect(()=>parseContainerCostReviewPlan('PRIVATE invalid')).toThrow('CONTAINER_COST_REVIEW_PLAN_INVALID:JSON');
 });
 it('新记录文件不能混入配对、项目、账单或付款入口',()=>{
  const{plan,pair}=setup(),raw=serializeContainerCostReviewPlan(plan);for(const parser of [parseContainerCostPair,parseProject,parseContainerBillDraft,parseSettlementPlan])expect(()=>parser(raw)).toThrow();expect(()=>parseContainerCostReviewPlan(serializeContainerCostPair(pair))).toThrow();expect(()=>parseContainerCostPair(JSON.stringify({...pair,review_plan:plan}))).toThrow();
 });
 it('旧扩展保留且不激活人工核对',()=>{const{pair,project,bill}=setup();(project as any).review_plan={ready:true};const p=createContainerCostPair(project,bill,pair.selection),plan=createContainerCostReviewPlan(p,p.content_key);expect(plan.records).toEqual([]);expect((p.project as any).review_plan).toEqual({ready:true});});
 it('新离线Schema与生成器一致',()=>{expect(readFileSync(new URL('../schemas/container-cost-review-plan-0.1.schema.json',import.meta.url),'utf8')).toBe(JSON.stringify(containerCostReviewPlanSchema(),null,2)+'\n');});
 it('旧配对预期键不能创建或重绑记录层',()=>{
  const{pair,plan}=setup();expect(()=>createContainerCostReviewPlan(pair,'old')).toThrow(/stale_pair/);expect(()=>rebaseContainerCostReviewPlan(plan,plan.content_key,pair,'old')).toThrow(/stale_pair/);
 });
 it('删除一条记录不撤销其他记录确认',()=>{
  const{pair,plan}=setup(),one=confirm(add(plan,pair,'QUOTE_INCLUDED'),pair),two=add(one,pair,'KEEP_RECORDED_AMOUNT'),all=confirm(two,pair,two.records[1]!.record_id),removed=removeContainerReviewRecord(all,all.content_key,all.records[0]!.record_id);
  expect(reviewContainerCostReviewPlan(removed,pair).records).toMatchObject([{status:'RECORDED_ASSUMPTION'}]);
 });
});
