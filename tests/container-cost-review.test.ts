import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {reviewContainerCostBoundaries,containerCostBoundaryReviewIsCurrent,CONTAINER_REVIEW_TARGET_LIMIT} from '../src/engine/container-cost-review';
import {createContainerCostPair,updateContainerCostPair,serializeContainerCostPair,parseContainerCostPair} from '../src/data/container-cost-pair';
import {containerBillTemplate} from '../src/data/container-bill-templates';
import {bindContainerBillDraft} from '../src/data/container-bill-context';
import {proposeContainerCosts} from '../src/engine/container-cost-proposal';
import {copyContainerBusiness} from '../src/data/container-business-copy';
import {analyze} from '../src/engine/analyze';
import {toScenario,toTrade} from '../src/data/project-file';
import {logisticsProject} from './fixtures/logistics-project';
import {makeCostItem} from './helpers/factory';
import type {ProjectFile} from '../src/data/project-file';
import type {ContainerBillDraft,ContainerBillDraftLine} from '../src/domain/container-bill-draft';
import type {CostItem} from '../src/domain/cost-item';
import type {ContainerCostIntent} from '../src/domain/container-cost-proposal';
const fixture:{cases:{id:string;family:string;reject?:boolean;input:any;expected:any}[]}=JSON.parse(readFileSync(new URL('../docs/cases/container-cost-review-design.json',import.meta.url),'utf8'));
const fixed=(amount='240'):ContainerBillDraftLine=>({line_id:'line-A',scope_id:'S1',direction:'IMPORT',equipment_type:'20GP',container_ids:['A'],currency:'USD',reference:'Synthetic',charge_kind:'INSPECTION',mode:'PER_CONTAINER',rate:amount});
function setup(edit?:(p:ProjectFile,b:ContainerBillDraft,c:CostItem)=>void){
 const project=logisticsProject('CIF'),bill=bindContainerBillDraft(containerBillTemplate('container-bill-synthetic-example'),project);
 bill.rows=[{input:fixed()}];const cost=makeCostItem({cost_id:'new-cost',amount:'240',currency:'USD',container_charge:'INSPECTION',container_charge_scope:'S1',applicable_incoterms:['CIF'],occurrence_reason:'NORMAL_OPERATION',responsibility:'BUYER',responsibility_source:'CONTRACT',payment_party:'BUYER',economic_bearer:'BUYER',customs_value:'EXCLUDE'});
 edit?.(project,bill,cost);
 const intent:ContainerCostIntent={operation:'CREATE_NEW',line_id:'line-A',new_cost:cost,note:'Synthetic only'};
 const pair=createContainerCostPair(project,bill,{version:'0.1',intents:[intent]});return{pair,project,bill,cost};
}
const review=(p:ReturnType<typeof setup>['pair'])=>reviewContainerCostBoundaries(p,p.content_key);
function freeze<T>(value:T):T {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
const daily=(x:any,id:string):ContainerBillDraftLine=>({line_id:id,scope_id:x.scope,direction:'IMPORT',equipment_type:'20GP',container_ids:x.boxes,currency:x.currency,reference:'Synthetic coverage',charge_kind:x.kind==='COMBINED'?'COMBINED_DD':x.kind,mode:'DAILY',period:{start_date:x.start,end_date:x.end,...(x.startIncluded===undefined?{}:{start_included:x.startIncluded}),end_included:x.endIncluded,start_event:'Explicit start',end_event:'Explicit end'},daily:{free_day_basis:'CALENDAR_DAYS',charge_day_basis:'CALENDAR_DAYS',free_days:0,tier_mode:'MARGINAL',tier_basis:'AFTER_FREE_TIME',tiers:[{through_day:null,rate:'1'}]}});

describe('只读核对：固定手算与原边界',()=>{
 it.each(fixture.cases.filter((c:any)=>c.family==='PRECISION'&&!c.reject))('$id不舍入原金额',(c:any)=>{
  const{pair}=setup((_p,b,cost)=>{b.rows[0]!.input=fixed(c.input.amount);cost.amount=c.input.amount;});const r=review(pair);
  expect(r.rows[0]).toMatchObject({original_amount:c.expected.exact,core_precision:c.expected.coreExact?'EXACT':'LOSS'});
  expect(r.rows[0]!.channels).toMatchObject({cash_amount:c.expected.exact,economic_cost:null,customs_adjustment:null});
 });
 it.each(fixture.cases.filter((c:any)=>c.family==='COVERAGE'&&!c.reject))('$id独立箱日手算对照',(c:any)=>{
  const{pair}=setup((_p,b)=>{b.rows=[{input:daily(c.input.left,'line-A')},{input:daily(c.input.right,'line-B')}];});const r=review(pair),a=r.coverage[0]!;
  expect(a.shared_box_days).toBe(c.expected.sharedCells);expect(a.status==='BOX_DAY_INTERSECTION').toBe(c.expected.sharedCells>0);
  expect(r.proposal).toEqual(proposeContainerCosts(pair.project,pair.bill,pair.selection));
 });
 it.each(fixture.cases.filter((c:any)=>c.family==='PARENT_GRAPH'&&!c.reject))('$id活跃父项核对只保留待办',(c:any)=>{
  const{pair}=setup((p)=>{p.items=c.input.nodes.map((n:any)=>makeCostItem({cost_id:n.id,amount:'1',currency:'USD',...(n.parent===null?{}:{contained_in_cost_id:n.parent}),applicable_incoterms:n.active?['CIF']:['FOB']}));});
  const r=review(pair);for(const relation of r.parent_relationships)expect(relation.issues).toEqual(['FULL_COVERAGE_EVIDENCE_REQUIRED']);
 });
 it.each(fixture.cases.filter(c=>c.family==='COVERAGE'&&c.reject))('$id区分设计检验器小范围与生产边界',(c)=>{
  const {pair}=setup((_p,b)=>{b.rows=[{input:daily(c.input.left,'line-A')},{input:daily(c.input.right,'line-B')}];});
  expect(review(pair).coverage[0]!.status).toBe(c.id==='invalid-coverage-bound'?'BOX_DAY_INTERSECTION':'UNSUPPORTED');
 });
 it('旧提案和旧候选完整保留，没有应用或ready标记',()=>{
  const{pair}=setup(),r=review(pair);expect(r.scope).toBe('READ_ONLY_BOUNDARIES');expect(r.proposal).toEqual(proposeContainerCosts(pair.project,pair.bill,pair.selection));
  expect(r.issues).toEqual(['NO_FEE_APPLICATION','NO_GLOBAL_DUPLICATE_PROOF']);expect(r).not.toHaveProperty('ready');expect(r).not.toHaveProperty('total');
 });
 it.each([false,true])('含税旗%s不拆税或自动抵扣',tax_included=>{
  const{pair}=setup((_p,b,c)=>{b.rows[0]!.input.rate='113';c.amount='113';c.tax_included=tax_included;c.tax_rate_ref='synthetic-rate';});const r=review(pair);
  expect(r.rows[0]!.channels).toEqual({cash_amount:'113',economic_cost:null,customs_adjustment:null,tax_included,tax_rate_ref:'synthetic-rate',customs_value:'EXCLUDE'});
  expect(r.rows[0]!.issues).toContain('SERVICE_TAX_REFERENCE_NOT_INTERPRETED');expect(r.rows[0]!.issues.includes('TAX_INCLUSIVE_TREATMENT_UNSUPPORTED')).toBe(tax_included);
 });
 it.each(['ADD','EXCLUDE'] as const)('海关%s元数据不生成计税金额',customs_value=>{
  const{pair}=setup((_p,_b,c)=>{c.customs_value=customs_value;});expect(review(pair).rows[0]!.channels.customs_adjustment).toBeNull();
 });
 it('新建提案包含旗不冒充已应用方案的实际报价依据',()=>{
  const{pair}=setup((_p,_b,c)=>{c.included_in_quoted_price=true;});const row=review(pair).rows[0]!;
  expect(row.quote_inclusion).toMatchObject({recorded:true,basis:'PROPOSED_ITEM_FLAG'});expect(row.issues).toContain('QUOTE_INCLUSION_NOT_CUSTOMS_EXCLUSION');
 });
 it('已有费用以当前方案推导清单为口径，保留其来源性质',()=>{
  const{pair,project,bill}=setup();const id=project.items.find(c=>c.cost_category==='MAIN_CARRIAGE')!.cost_id;
  const p=createContainerCostPair(project,bill,{version:'0.1',intents:[{operation:'REFERENCE_EXISTING',line_id:'line-A',cost_id:id,note:'Synthetic mapping'}]});
  expect(review(p).rows[0]!.quote_inclusion).toMatchObject({recorded:true,basis:'CURRENT_SCENARIO_DERIVATION'});expect(pair.project).toEqual(project);
 });
});

describe('候选是待核对范围，不是自动重复扣减',()=>{
 const base={boxes:['A'],start:'2026-10-01',end:'2026-10-03',startIncluded:true,endIncluded:true,scope:'S1',currency:'USD',kind:'DEMURRAGE'};
 const pairFor=(left:any,right:any)=>setup((_p,b)=>{b.rows=[{input:daily(left,'line-A')},{input:daily(right,'line-B')}];}).pair;
 it('跨标签补充覆盖，原候选仍为空且旧提案待办不被改',()=>{
  const p=pairFor(base,{...base,scope:'OTHER'}),r=review(p);expect(r.legacy_overlaps).toEqual([]);expect(r.coverage[0]!.shared_box_days).toBe(3);expect(r.rows[0]!.issues).toContain('BOX_DAY_COVERAGE_REVIEW_REQUIRED');
 });
 it('同标签保留原候选，不用补充结果覆盖',()=>{
  const r=review(pairFor(base,base));expect(r.legacy_overlaps).toHaveLength(1);expect(r.proposal.rows[0]!.issues).toContain('BILL_OVERLAP_REVIEW_REQUIRED');
 });
 it('免费日仍有交集，零金额不消除候选',()=>{
  const{pair}=setup((_p,b)=>{b.rows=[{input:daily(base,'line-A')},{input:daily(base,'line-B')}];b.rows.forEach(r=>{r.input.daily!.free_days=10;});});const r=review(pair);
  expect(r.rows[0]!.original_amount).toBe('0');expect(r.coverage[0]!.shared_box_days).toBe(3);
 });
 it.each(['direction','mixed','fixed','invalid'])('%s范围不能证明无重复',kind=>{
  const{pair}=setup((_p,b)=>{b.rows=[{input:daily(base,'line-A')},{input:daily(base,'line-B')}];const right=b.rows[1]!.input;
   if(kind==='direction')right.direction='EXPORT';if(kind==='mixed')b.rows[1]!.input={...fixed(),line_id:'line-B'};
   if(kind==='fixed'){b.rows[0]!.input=fixed();b.rows[1]!.input={...fixed(),line_id:'line-B'};}if(kind==='invalid')delete right.period!.end_included;
  });expect(review(pair).coverage[0]!.status).toBe('UNSUPPORTED');expect(review(pair).rows[0]!.issues).toContain('COVERAGE_UNSUPPORTED');
 });
 it('未被选择的账单行也与选中行比较，不漏掉另一半候选',()=>{expect(review(pairFor(base,base)).coverage).toHaveLength(1);});
 it('两行均选择时只记录一对',()=>{
  const{pair,project,bill}=setup((_p,b)=>{b.rows=[{input:daily(base,'line-A')},{input:daily(base,'line-B')}];});
  const p=createContainerCostPair(project,bill,{version:'0.1',intents:[...pair.selection.intents,{operation:'REFERENCE_EXISTING',line_id:'line-B',cost_id:project.items[0]!.cost_id,note:'Explicit'}]});expect(review(p).coverage).toHaveLength(1);
 });
 it.each(['other-scope','other-currency','combined'])('已有费用%s缺箱日范围时保留保守候选',kind=>{
  const{pair}=setup((p,b)=>{b.rows[0]!.input=daily(base,'line-A');p.items.push(makeCostItem({cost_id:'old-dd',amount:'20',currency:kind==='other-currency'?'CNY':'USD',container_charge:kind==='combined'?'COMBINED_DD':'DEMURRAGE',container_charge_scope:'OTHER'}));});
  expect(review(pair).existing_cost_candidates).toContainEqual({line_id:'line-A',cost_id:'old-dd',issues:['EXISTING_COST_HAS_NO_BOX_DAY_COVERAGE']});
 });
 it('非当前术语的已有费用不参加候选',()=>{
  const{pair}=setup((p,b)=>{b.rows[0]!.input=daily(base,'line-A');p.items.push(makeCostItem({cost_id:'inactive',amount:'1',container_charge:'DEMURRAGE',applicable_incoterms:['FOB']}));});expect(review(pair).existing_cost_candidates.some(c=>c.cost_id==='inactive')).toBe(false);
 });
 it('运费已含港杂时，THC保留包含核对，不自动扣减',()=>{
  const{pair}=setup((p,b,c)=>{p.items[0]!.includes_port_charges=true;b.rows[0]!.input.charge_kind='THC_DESTINATION';c.container_charge='THC_DESTINATION';});expect(review(pair).existing_cost_candidates.some(c=>c.issues.includes('PORT_CHARGE_INCLUSION_REVIEW_REQUIRED'))).toBe(true);
 });
 it('同去重组保留独立费用候选与行待办',()=>{
  const{pair}=setup((p,_b,c)=>{p.items[0]!.dedup_group='G';c.dedup_group='G';});const r=review(pair);
  expect(r.existing_cost_candidates.some(c=>c.issues.includes('SAME_DEDUP_GROUP_REVIEW_REQUIRED'))).toBe(true);expect(r.rows[0]!.issues).toContain('EXISTING_COST_COVERAGE_REVIEW_REQUIRED');
 });
 it('50行全部选择的1225对覆盖完整保留，不截断为预览前50',()=>{
  const{project,bill}=setup();project.items=[];bill.rows=Array.from({length:50},(_,n)=>({input:daily(base,'L'+n)}));
  const pair=createContainerCostPair(project,bill,{version:'0.1',intents:bill.rows.map((r,n)=>({operation:'REFERENCE_EXISTING',line_id:r.input.line_id,cost_id:'missing-'+n,note:'Synthetic mapping'}))});
  const result=review(pair);expect(result.coverage).toHaveLength(1225);expect(result.coverage.every(c=>c.shared_box_days===3)).toBe(true);expect(result.legacy_overlaps).toHaveLength(1225);
 });
});

describe('父项、修订和资源门槛',()=>{
 it.each([['missing','PARENT_MISSING'],['self','SELF_PARENT'],['cycle','PARENT_CYCLE'],['inactive','PARENT_NOT_ACTIVE'],['currency','CROSS_CURRENCY_CONTAINMENT_UNSUPPORTED']] as const)('%s父项关系不能通过', (kind,issue)=>{
  const{pair}=setup((p,_b,c)=>{c.contained_in_cost_id=kind==='self'?c.cost_id:'P';if(kind!=='missing'&&kind!=='self')p.items.push(makeCostItem({cost_id:'P',amount:'1',currency:kind==='currency'?'CNY':'USD',...(kind==='cycle'?{contained_in_cost_id:c.cost_id}:{}),...(kind==='inactive'?{applicable_incoterms:['FOB'] as const}:{} )}));});
  expect(review(pair).parent_relationships.find(r=>r.cost_id==='new-cost')!.issues).toContain(issue);
 });
 it('引用另一未应用提案不是引用活跃项目父项',()=>{
  const{project,bill,cost}=setup();bill.rows.push({input:{...fixed(),line_id:'line-B'}});cost.contained_in_cost_id='other';
  const {contained_in_cost_id:_parent,...other}=cost;
  const p=createContainerCostPair(project,bill,{version:'0.1',intents:[{operation:'CREATE_NEW',line_id:'line-A',new_cost:cost,note:'Explicit'},{operation:'CREATE_NEW',line_id:'line-B',new_cost:{...other,cost_id:'other'},note:'Explicit'}]});
  expect(review(p).parent_relationships[0]!.issues).toContain('PARENT_IS_UNAPPLIED_PROPOSAL');
 });
 it('当前术语集合出错仍诊断，不把空集合当无风险',()=>{
  const{pair}=setup(p=>{for(const c of p.items.slice(0,2)){c.alternative_group='same';c.applicable_incoterms=['CIF'];}});expect(review(pair).issues).toContain('PROJECT_COST_SELECTION_INVALID');expect(review(pair).issues).toContain('QUOTE_INCLUSION_CONTEXT_UNAVAILABLE');
 });
 it('过期调用键整体拒绝，冻结原对象保持',()=>{const{pair}=setup();const raw=serializeContainerCostPair(pair);expect(()=>reviewContainerCostBoundaries(freeze(pair),'old')).toThrow(/stale_pair/);expect(serializeContainerCostPair(pair)).toBe(raw);});
 it.each(['amount','term','source','mapping','revision','quote','fx','review-date'])('%s变更使整份结果失效',kind=>{
  const{pair}=setup(),r=review(pair);let p=structuredClone(pair.project),b=structuredClone(pair.bill),s=structuredClone(pair.selection);
  if(kind==='amount')(s.intents[0] as Extract<ContainerCostIntent,{operation:'CREATE_NEW'}>).new_cost.amount='241';if(kind==='term')p.incoterm='CIP';if(kind==='source')b.notes='changed source context';
  if(kind==='mapping')(s.intents[0] as Extract<ContainerCostIntent,{operation:'CREATE_NEW'}>).new_cost.cost_id='new-target';if(kind==='revision')p.name='new revision';if(kind==='quote')p.quote.amount='123';if(kind==='fx')p.fx_books.push({id:'new-fx',name:'Synthetic',type:'MARKET',date:'2026-10-15',rates:{'USD/CNY':'7'}});if(kind==='review-date')b.review_date='2026-10-16';
  const updated=updateContainerCostPair(pair,pair.content_key,p,b,s);expect(containerCostBoundaryReviewIsCurrent(r,updated)).toBe(false);
 });
 it('修改输出的待办、覆盖或原金额不能冒充原核对结果',()=>{const{pair}=setup(),r=review(pair);expect(containerCostBoundaryReviewIsCurrent(r,pair)).toBe(true);r.rows[0]!.channels.cash_amount='0';expect(containerCostBoundaryReviewIsCurrent(r,pair)).toBe(false);});
 it('业务副本不继承核对结果，旧确认不能跨身份重用',()=>{const{pair}=setup(),r=review(pair);const copy=copyContainerBusiness(pair,pair.content_key,'New synthetic business','2026-10-15T00:00:00.000Z');expect(containerCostBoundaryReviewIsCurrent(r,copy)).toBe(false);});
 it('没有选择仍不产生就绪或应用状态',()=>{const{project,bill}=setup(),p=createContainerCostPair(project,bill,{version:'0.1',intents:[]});const r=review(p);expect(r.rows).toEqual([]);expect(r.coverage).toEqual([]);expect(r.proposal.issues).toContain('EMPTY_PROPOSAL_SCOPE');});
 it('冻结数据与原分析结果不变，输出引用隔离',()=>{
  const{pair}=setup(),raw=serializeContainerCostPair(pair),args={trade:toTrade(pair.project),scenario:toScenario(pair.project),taxProfile:pair.project.tax_profile,fxBooks:pair.project.fx_books},before=analyze(args);
  const r=review(freeze(pair));r.rows[0]!.mapping.mapping_id='edited';r.proposal.rows[0]!.issues.length=0;expect(serializeContainerCostPair(pair)).toBe(raw);expect(analyze(args)).toEqual(before);
 });
 it('正好2000目标完整返回，2001整体拒绝且不截断',()=>{
  const{project,bill}=setup();project.items=Array.from({length:999},(_,n)=>makeCostItem({cost_id:'C'+n,amount:'1',currency:'USD'}));
  bill.rows.push({input:{...fixed(),line_id:'line-B'}});
  const p=createContainerCostPair(project,bill,{version:'0.1',intents:[{operation:'REFERENCE_EXISTING',line_id:'line-A',cost_id:'C0',note:'Explicit'}]});
  expect(review(p).target_count).toBe(CONTAINER_REVIEW_TARGET_LIMIT-1);
  // 999 graph nodes + one proposed node + one bill pair + 999 cost comparisons = 2000.
  const s=structuredClone(p.selection);s.intents[0]={operation:'CREATE_NEW',line_id:'line-A',new_cost:makeCostItem({cost_id:'fresh',amount:'240',currency:'USD'}),note:'Explicit'};
  const at=createContainerCostPair(project,bill,s);expect(review(at).target_count).toBe(2000);
  bill.rows.push({input:{...fixed(),line_id:'line-C'}});const over=createContainerCostPair(project,bill,s);expect(()=>review(over)).toThrow(/target_limit/);
 });
 it('核对结果不能当配对或新review_plan活动字段导入',()=>{const{pair}=setup();expect(()=>parseContainerCostPair(JSON.stringify(review(pair)))).toThrow();expect(()=>parseContainerCostPair(JSON.stringify({...pair,review_plan:{version:'0.1'}}))).toThrow();});
 it.each(['getter','sparse','NaN','cycle','future-version'])('坏输入%s在生成核对前拒绝',kind=>{
  const{pair}=setup();let called=false;
  if(kind==='getter')Object.defineProperty(pair.project,'private',{enumerable:true,get(){called=true;throw Error('private getter must not run');}});
  if(kind==='sparse')pair.selection.intents=Array(1);if(kind==='NaN')(pair.project as any).private=NaN;
  if(kind==='cycle')(pair.project as any).private=pair.project;if(kind==='future-version')(pair as any).version='1.1';
  expect(()=>review(pair)).toThrow();expect(called).toBe(false);
 });
 it('旧同名扩展不激活核对语义且原样保留',()=>{
  const{pair}=setup(p=>{(p as any).review_plan={ready:true,ignore:['all']};});const before=serializeContainerCostPair(pair),r=review(pair);
  expect(r.issues).toContain('NO_FEE_APPLICATION');expect(serializeContainerCostPair(pair)).toBe(before);expect(r).not.toHaveProperty('ready');
 });
 it('取消适用术语的新提案不能作为活跃父项',()=>{
  const{pair}=setup((_p,_b,c)=>{c.applicable_incoterms=['FOB'];c.contained_in_cost_id='missing';});const r=review(pair);
  expect(r.rows[0]!.issues).toContain('TARGET_COST_NOT_ACTIVE');expect(r.parent_relationships.some(p=>p.cost_id==='new-cost')).toBe(false);
 });
 it('缺失已有目标既不生成税务值也不宣称报价不包含',()=>{
  const{project,bill}=setup(),p=createContainerCostPair(project,bill,{version:'0.1',intents:[{operation:'REFERENCE_EXISTING',line_id:'line-A',cost_id:'missing',note:'Explicit'}]});
  expect(review(p).rows[0]).toMatchObject({quote_inclusion:{recorded:null,basis:'UNAVAILABLE',effect:'UNKNOWN'},channels:{economic_cost:null,customs_adjustment:null}});
 });
 it('来源为示例的旧提案待办在只读结果中保留',()=>{
  const{pair}=setup(),r=review(pair);expect(r.proposal.rows[0]!.source_issues.length).toBeGreaterThan(0);expect(containerCostBoundaryReviewIsCurrent(r,pair)).toBe(true);
 });
 it.each(['issues','ready','mapping','coverage'])('篡改输出%s使整份结果失效',kind=>{
  const{pair}=setup(),r=review(pair);if(kind==='issues')r.issues=[];if(kind==='ready')(r as any).ready=true;
  if(kind==='mapping')r.rows[0]!.mapping.cost_id='other';if(kind==='coverage')r.coverage.push({line_ids:['fake','pair'],status:'DISJOINT_DAYS',container_ids:[],start_date:null,end_date:null,shared_box_days:0,issues:[]});
  expect(containerCostBoundaryReviewIsCurrent(r,pair)).toBe(false);
 });
 it('已有衍生税或费用引用保留独立税务核对',()=>{
  const{project,bill}=setup();project.items.push(makeCostItem({cost_id:'derived-tax',amount:'13',source:'DERIVED'}));
  const p=createContainerCostPair(project,bill,{version:'0.1',intents:[{operation:'REFERENCE_EXISTING',line_id:'line-A',cost_id:'derived-tax',note:'Synthetic'}]});expect(review(p).rows[0]!.issues).toContain('DERIVED_TAX_OR_COST_REFERENCE_REVIEW_REQUIRED');
 });
 it('不活跃已有费用的报价状态保持未知',()=>{
  const{project,bill}=setup();project.items.push(makeCostItem({cost_id:'inactive-ref',amount:'1',included_in_quoted_price:true,applicable_incoterms:['FOB']}));
  const p=createContainerCostPair(project,bill,{version:'0.1',intents:[{operation:'REFERENCE_EXISTING',line_id:'line-A',cost_id:'inactive-ref',note:'Synthetic'}]});expect(review(p).rows[0]!.quote_inclusion).toEqual({recorded:null,basis:'UNAVAILABLE',effect:'UNKNOWN'});
 });
});
