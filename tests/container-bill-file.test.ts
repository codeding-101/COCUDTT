import {readFileSync} from 'node:fs';
import Ajv from 'ajv';
import Decimal from 'decimal.js';
import {describe,expect,it} from 'vitest';
import {emptyContainerBillDraft,type ContainerBillDraft} from '../src/domain/container-bill-draft';
import {containerBillDraftSchema,parseContainerBillDraft,serializeContainerBillDraft,validateContainerBillDraft,CONTAINER_BILL_FILE_BYTES} from '../src/data/container-bill-file';
import {CONTAINER_BILL_TEMPLATES,containerBillTemplate,containerBillTemplateText} from '../src/data/container-bill-templates';
import {bindContainerBillDraft,containerBillBinding,invalidateContainerBillConfirmations} from '../src/data/container-bill-context';
import {confirmContainerBillLine,confirmContainerBillCostReference,reviewContainerBillDraft} from '../src/engine/container-bill-draft';
import {calculateContainerBill} from '../src/engine/container-bill';
import type {SourceEvidence} from '../src/domain/source-evidence';
import {logisticsProject} from './fixtures/logistics-project';
import {makeCostItem} from './helpers/factory';
import {parseProject,serializeProject,toScenario,toTrade} from '../src/data/project-file';
import {parseSettlementPlan} from '../src/data/settlement-file';
import {analyze} from '../src/engine/analyze';

const schema=new Ajv({strict:true,allErrors:true}).compile(containerBillDraftSchema());
const example=()=>containerBillTemplate('container-bill-synthetic-example');
const source=():SourceEvidence=>({reference:'人工测试核对依据',valid_from:'2026-10-01',valid_to:'2026-10-31',checked_on:'2026-10-14',status:'UNVERIFIED'});
const confirms=(file=example())=>confirmContainerBillLine(file,file.rows[0]!.input.line_id,source());
function freeze<T>(v:T):T{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
function referenceSetup(){
 const project=logisticsProject('CIF');project.evaluation_date='2026-10-14';
 project.fx_books=[{id:'synthetic-fx',name:'合成原币对照汇率，非实时市场数据',type:'CONTRACT',date:'2026-10-14',rates:{'USD/CNY':'7'}},{id:'synthetic-customs-fx',name:'合成税务汇率',type:'CUSTOMS',date:'2026-09-01',valid_from:'2026-09-01',valid_to:'2026-10-31',rates:{'USD/CNY':'7'}}];
 const cost=makeCostItem({cost_id:'bill-cost',cost_name:'任意费用名，不据名称匹配',pricing_method:'FIXED',amount:'240.000000000000000000',currency:'USD',fx_type:'CONTRACT',container_charge:'DEMURRAGE',container_charge_scope:'synthetic-dd',included_in_quoted_price:false});
 project.items.push(cost);
 let file=bindContainerBillDraft(example(),project);file=confirms(file);file.rows[0]!.cost_reference={cost_id:cost.cost_id,note:'人工核对已存在的合成两箱费用，非新增费用'};
 return{file,project,cost,id:file.rows[0]!.input.line_id};
}

describe('独立账单草稿与结构Schema：保存不等于可算/确认',()=>{
 it.each(CONTAINER_BILL_TEMPLATES)('%s可复建/回读，副本隔离和格式1.0保持',id=>{
  const text=containerBillTemplateText(id),file=parseContainerBillDraft(text);expect(schema(file)).toBe(true);expect(serializeContainerBillDraft(file)).toBe(text);
  expect(readFileSync(new URL('../templates/'+id+'.json',import.meta.url),'utf8')).toBe(text);file.rows[0]!.input.line_id='CHANGED';expect(containerBillTemplateText(id)).toBe(text);
 });
 it('空模板不造日期、币种、免费天、费率、端点或确认',()=>{
  const f=containerBillTemplate('container-bill-empty');expect(f.binding).toBeNull();expect(f.review_date).toBe('');expect(f.rows[0]!.input).toEqual({line_id:'bill-1'});
  expect(f.rows[0]!.evidence?.status).toBe('UNVERIFIED');expect(reviewContainerBillDraft(f).rows[0]!.calculation).toBeNull();
 });
 it('合成模板固定每箱120/两箱240，来源仍EXAMPLE，不写入费用',()=>{
  const f=example(),r=reviewContainerBillDraft(f);expect(r.rows[0]!.calculation).toMatchObject({amount:'240',per_container_amount:'120',billable_days:6});expect(r.rows[0]!.source_current).toBe(false);expect(r.rows[0]!.source_issues).toContain('使用示例数据');expect(r.rows[0]!.cost_reference).toBeNull();expect(r).not.toHaveProperty('total');expect(r).not.toHaveProperty('ready');
 });
 it('Schema与源码相同，每次取新的对象，不共享修改',()=>{
  expect(readFileSync(new URL('../schemas/container-bill-1.0.schema.json',import.meta.url),'utf8')).toBe(JSON.stringify(containerBillDraftSchema(),null,2)+'\n');
  const a=containerBillDraftSchema();a.title='CHANGED';expect(containerBillDraftSchema().title).not.toBe('CHANGED');
 });
 it('不支持口径、坏数值文本及null可保存，不改成已支持口径/零',()=>{
  const f=example(),input=f.rows[0]!.input;input.daily!.free_day_basis='WORKING_DAYS';input.daily!.free_days=null;input.daily!.tiers![0]!.rate='unknown';input.period!.start_included=null;
  const restored=parseContainerBillDraft(serializeContainerBillDraft(f));expect(restored).toEqual(f);expect(schema(f)).toBe(true);expect(reviewContainerBillDraft(restored).rows[0]!.calculation).toBeNull();
 });
 it('完整行可保留参考审计，坏行无金额，原API仍整份拒绝',()=>{
  const f=example();f.rows.push({input:{line_id:'draft',mode:'PER_SHIPMENT'}});const r=reviewContainerBillDraft(f);
  expect(r.rows[0]!.calculation?.amount).toBe('240');expect(r.rows[1]!.calculation).toBeNull();expect(r.rows[1]!.input_issue).toMatch(/^CONTAINER_BILL_INVALID:/);expect(r.issues).toContain('OVERLAP_SCOPE_INCOMPLETE');
  expect(()=>calculateContainerBill({version:'0.1',lines:f.rows.map(r=>r.input)})).toThrow(/^CONTAINER_BILL_INVALID:/);
 });
 it('空范围不是零成本或检查通过',()=>{expect(reviewContainerBillDraft(emptyContainerBillDraft('empty'))).toEqual({scope:'DRAFT_REFERENCE_ONLY',issues:['EMPTY_REVIEW_SCOPE'],rows:[],potential_overlaps:[]});});
 it('扩展原样保留但同名来源、规则及费用不被激活',()=>{
  const f=example();f.extensions=JSON.parse('{"__proto__":{"polluted":true},"rows":[{"input":{"line_id":"hidden"}}],"evidence":{"status":"USER_CONFIRMED"},"version":"2.0","rate":"999"}');
  const before=reviewContainerBillDraft(f),copy=parseContainerBillDraft(serializeContainerBillDraft(f));expect(copy.extensions).toEqual(f.extensions);expect(reviewContainerBillDraft(copy)).toEqual(before);expect(({} as any).polluted).toBeUndefined();expect(copy.rows).toHaveLength(1);
 });
 it('18位费率文字以及emoji/公式样文本按原值存，不经浮点或执行',()=>{
  const f=example();f.rows[0]!.input.daily!.tiers=[{through_day:null,rate:'0.000000000000000001'}];f.notes='=HYPERLINK("private") 😀 <script>payload</script>';
  const copy=parseContainerBillDraft(serializeContainerBillDraft(f));expect(copy).toEqual(f);expect(reviewContainerBillDraft(copy).rows[0]!.calculation?.amount).toBe('0.000000000000000012');
 });
 it('草稿Unicode字符长度与Schema一致，严格计算仍独立核对其上限',()=>{
  const f=example();f.name='😀'.repeat(4000);f.rows[0]!.input.equipment_type='😀'.repeat(200);expect(schema(f)).toBe(true);expect(()=>validateContainerBillDraft(f)).not.toThrow();expect(reviewContainerBillDraft(f).rows[0]!.calculation).toBeNull();
 });
 it('50行/50箱/20阶可留存，坏业务条件不被结构验证修复',()=>{
  const f=example(),row=f.rows[0]!;row.input.container_ids=Array.from({length:50},(_,n)=>'BOX'+n);row.input.daily!.tiers=Array.from({length:20},()=>({through_day:0,rate:''}));f.rows=Array.from({length:50},(_,n)=>({...structuredClone(row),input:{...structuredClone(row.input),line_id:'L'+n}}));
  expect(schema(f)).toBe(true);expect(parseContainerBillDraft(serializeContainerBillDraft(f))).toEqual(f);
 });
 it('项目、付款、旧独立API和未来账单容器互不误读',()=>{
  const f=example(),text=serializeContainerBillDraft(f);expect(()=>parseProject(text)).toThrow();expect(()=>parseSettlementPlan(text)).toThrow();
  const project=logisticsProject('CIF');expect(()=>parseContainerBillDraft(serializeProject(project))).toThrow();
  expect(()=>parseContainerBillDraft(JSON.stringify({version:'0.1',lines:[f.rows[0]!.input]}))).toThrow();
  for(const version of ['0.9','1.1','2.0'])expect(()=>parseContainerBillDraft(JSON.stringify({...f,version}))).toThrow('CONTAINER_BILL_FILE_INVALID:kind/version');
 });
 it('未知模板不退回默认；解析异常不回显原文',()=>{
  expect(()=>containerBillTemplate('UNKNOWN')).toThrow('CONTAINER_BILL_TEMPLATE_UNKNOWN');expect(()=>parseContainerBillDraft('PRIVATE_PATH invalid-json')).toThrow('CONTAINER_BILL_FILE_INVALID:JSON');
 });
});

const structural:[string,(f:any)=>void][]=[
 ['missing-kind',f=>delete f.kind],['future-kind',f=>f.kind='PROJECT'],['number-version',f=>f.version=1],['blank-id',f=>f.id=' '],['reserved-id',f=>f.id='__proto__'],
 ['unknown-root',f=>f.evidence={status:'USER_CONFIRMED'}],['null-rows',f=>f.rows=null],['too-many-rows',f=>f.rows=Array.from({length:51},(_,n)=>({input:{line_id:'L'+n}}))],
 ['missing-input',f=>delete f.rows[0].input],['unknown-row',f=>f.rows[0].amount='240'],['long-rate',f=>f.rows[0].input.daily.tiers[0].rate='1'.repeat(201)],
 ['numeric-rate',f=>f.rows[0].input.daily.tiers[0].rate=0.1],['unknown-input',f=>f.rows[0].input.tax_rate='13'],['unknown-period',f=>f.rows[0].input.period.hour=8],
 ['wrong-period',f=>f.rows[0].input.period=[]],['string-boolean',f=>f.rows[0].input.period.start_included='true'],['fractional-free',f=>f.rows[0].input.daily.free_days=1.5],
 ['unsafe-free',f=>f.rows[0].input.daily.free_days=Number.MAX_SAFE_INTEGER+1],['wrong-daily',f=>f.rows[0].input.daily=false],['string-tiers',f=>f.rows[0].input.daily.tiers='1'],
 ['too-many-tiers',f=>f.rows[0].input.daily.tiers=Array.from({length:21},()=>({}))],['numeric-source',f=>f.rows[0].evidence.reference=1],['fake-status',f=>f.rows[0].evidence.status='CERTIFIED'],
 ['unknown-source',f=>f.rows[0].evidence.signature='fake'],['too-long-key',f=>f.rows[0].evidence.values_key='k'.repeat(1048577)],['null-reference',f=>f.rows[0].cost_reference=null],
 ['missing-ref-note',f=>f.rows[0].cost_reference={cost_id:'X'}],['unknown-binding',f=>f.binding={term:'CIF',context_key:'',cost_id:'X'}],['wrong-extensions',f=>f.extensions=[]],
 ['too-many-containers',f=>f.rows[0].input.container_ids=Array.from({length:51},()=>'' )],['numeric-container',f=>f.rows[0].input.container_ids=[1]],['missing-line-id',f=>delete f.rows[0].input.line_id],
 ['reserved-line-id',f=>f.rows[0].input.line_id='constructor'],['fractional-cut',f=>f.rows[0].input.daily.tiers[0].through_day=2.5],['unknown-tier',f=>f.rows[0].input.daily.tiers[0].minimum='1'],
];
describe('结构、可移植JSON及范围保护',()=>{
 it.each(structural)('Schema和运行时拒绝%s',(name,mutate)=>{const f=example();mutate(f);expect(schema(f)).toBe(false);expect(()=>validateContainerBillDraft(f)).toThrow(/^CONTAINER_BILL_FILE_INVALID:/);});
 it('跨行ID唯一由运行时核对，不以Schema uniqueItems代替',()=>{
  const f=example();f.rows.push(structuredClone(f.rows[0]!));expect(schema(f)).toBe(true);expect(()=>validateContainerBillDraft(f)).toThrow(/line_id/);
 });
 it('ID空白和原型保留名按完整原值核验，尾部换行不造成Schema漂移',()=>{
  for(const id of ['constructor','constructor\n','abc\n',' \n']){const f=example();f.id=id;let accepted=true;try{validateContainerBillDraft(f);}catch{accepted=false;}expect(schema(f)).toBe(accepted);}
 });
 it.each(['NaN','Infinity','BigInt','undefined','function','sparse','cycle','date','getter','symbol','non-enumerable','array-property','array-getter'])('拒绝有损JSON值%s',kind=>{
  const f=example(),e:any={};f.extensions=e;
  if(kind==='NaN')e.value=NaN;if(kind==='Infinity')e.value=Infinity;if(kind==='BigInt')e.value=1n;if(kind==='undefined')e.value=undefined;
  if(kind==='function')e.value=()=>1;if(kind==='sparse')e.value=Array(1);if(kind==='cycle')e.value=e;if(kind==='date')e.value=new Date();
  if(kind==='getter')Object.defineProperty(e,'value',{enumerable:true,get(){throw Error('Getter must not run');}});
  if(kind==='symbol')e[Symbol('private')]=1;if(kind==='non-enumerable')Object.defineProperty(e,'value',{value:1});
  if(kind==='array-property'){e.value=[];e.value.extra=1;}
  if(kind==='array-getter'){e.value=[1];Object.defineProperty(e.value,'0',{enumerable:true,get(){throw Error('Getter must not run');}});}
  expect(()=>serializeContainerBillDraft(f)).toThrow('CONTAINER_BILL_FILE_INVALID:JSON_CONTENT');
 });
 it('扩展8层边界、节点/UTF-8字节各自受限',()=>{
  const f=example();f.extensions={};let cursor:any=f.extensions;for(let i=0;i<8;i++){cursor.child={};cursor=cursor.child;}expect(()=>validateContainerBillDraft(f)).not.toThrow();cursor.child={};expect(()=>validateContainerBillDraft(f)).toThrow(/JSON_CONTENT/);
  f.extensions={nodes:Array(10000).fill(null)};expect(()=>validateContainerBillDraft(f)).toThrow(/JSON_CONTENT/);
  f.extensions={text:'😀'.repeat(65400)};expect(()=>validateContainerBillDraft(f)).not.toThrow();f.extensions.text='😀'.repeat(65536);expect(()=>validateContainerBillDraft(f)).toThrow(/extensions.size/);
 });
 it('整体5MiB按UTF-8拒绝；序列化也拒绝不可回读的大快照集合',()=>{
  expect(()=>parseContainerBillDraft(' '.repeat(CONTAINER_BILL_FILE_BYTES+1))).toThrow(/size/);
  expect(()=>parseContainerBillDraft('😀'.repeat(1400000))).toThrow(/size/);
  const f=example(),row=f.rows[0]!;row.evidence!.values_key='k'.repeat(1000000);f.rows=Array.from({length:6},(_,n)=>({...structuredClone(row),input:{...row.input,line_id:'L'+n}}));expect(()=>serializeContainerBillDraft(f)).toThrow('CONTAINER_BILL_FILE_INVALID:size');
 });
});

describe('人工来源、变更快照和副本隔离',()=>{
 it('完整条件明确确认后快照有效，可另存回读但不是推荐标志',()=>{
  const f=confirms(freeze(example())),r=reviewContainerBillDraft(parseContainerBillDraft(serializeContainerBillDraft(f)));expect(r.rows[0]!.source_current).toBe(true);expect(r.scope).toBe('DRAFT_REFERENCE_ONLY');expect(r).not.toHaveProperty('ready');
 });
 it.each(['amount','currency','box','free','endpoint','tier','event','scope','id','binding','review-date','source-text','source-period','source-date'])('修改%s不能沿用旧确认',kind=>{
  const f=confirms(),row=f.rows[0]!,input=row.input;
  if(kind==='amount')input.daily!.tiers![0]!.rate='11';if(kind==='currency')input.currency='CNY';if(kind==='box')input.container_ids!.push('NEW');
  if(kind==='free')input.daily!.free_days=3;if(kind==='endpoint')input.period!.end_included=false;if(kind==='tier')input.daily!.tier_basis='FROM_PERIOD_START';
  if(kind==='event')input.period!.start_event='changed';if(kind==='scope')input.scope_id='changed';if(kind==='id')f.id='new-file';
  if(kind==='binding')f.binding={term:'CIF',context_key:'changed'};if(kind==='review-date')f.review_date='2026-10-15';
  if(kind==='source-text')row.evidence!.reference='changed';if(kind==='source-period')row.evidence!.valid_to='2026-10-30';if(kind==='source-date')row.evidence!.checked_on='2026-10-15';
  expect(reviewContainerBillDraft(f).rows[0]!.source_current).toBe(false);const changed=invalidateContainerBillConfirmations(f);expect(changed.rows[0]!.evidence!.status).toBe('UNVERIFIED');expect(f.rows[0]!.evidence!.status).toBe('USER_CONFIRMED');expect(changed.rows[0]!.evidence!.values_key).toBe(f.rows[0]!.evidence!.values_key);
 });
 it('仅备注/名称/扩展/行顺序不替换账单条件；另一行改变不撤销本行来源',()=>{
  const f=confirms();f.name='changed';f.notes='changed';f.extensions={rate:'999'};f.rows.unshift({input:{line_id:'new'}});expect(reviewContainerBillDraft(f).rows[1]!.source_current).toBe(true);expect(invalidateContainerBillConfirmations(f).rows[1]!.evidence?.status).toBe('USER_CONFIRMED');
 });
 it.each(['example','empty-reference','invalid-checked','invalid-period','expired','unknown-status','extra-field'])('确认拒绝%s',kind=>{
  const f=example(),e:any=source();if(kind==='example')e.status='EXAMPLE';if(kind==='empty-reference')e.reference='';if(kind==='invalid-checked')e.checked_on='2026-02-30';if(kind==='invalid-period')e.valid_to='2026-09-30';if(kind==='expired')e.valid_to='2026-10-13';if(kind==='unknown-status')e.status='CERTIFIED';if(kind==='extra-field')e.secret='private';
  const before=JSON.stringify(f);expect(()=>confirmContainerBillLine(f,f.rows[0]!.input.line_id,e)).toThrow(/^CONTAINER_BILL_/);expect(JSON.stringify(f)).toBe(before);
 });
 it('空核对日、坏输入和未知行不能确认，返回审计副本不会改文件',()=>{
  const f=example();f.review_date='';expect(()=>confirms(f)).toThrow();f.review_date='2026-10-14';f.rows[0]!.input.daily!.free_days=null;expect(()=>confirms(f)).toThrow();expect(()=>confirmContainerBillLine(f,'absent',source())).toThrow(/line/);
  const good=example(),r=reviewContainerBillDraft(freeze(good));r.rows[0]!.calculation!.input.container_ids[0]='MODIFIED';expect(good.rows[0]!.input.container_ids).toEqual(['SYNTHETIC-A','SYNTHETIC-B']);
 });
 it('联合/分开候选不会因来源确认消失或产生总额',()=>{
  const f=confirms(),row=structuredClone(f.rows[0]!);row.input.line_id='combined';row.input.charge_kind='COMBINED_DD';f.rows.push(row);
  const copy=confirmContainerBillLine(f,'combined',source()),r=reviewContainerBillDraft(copy);expect(r.rows.every(x=>x.source_current)).toBe(true);expect(r.potential_overlaps).toHaveLength(1);expect(r.rows.map(x=>x.calculation!.amount)).toEqual(['240','240']);expect(r).not.toHaveProperty('total');
 });
});

describe('已有费用只读引用：不自动入账/去重/改变税务',()=>{
 it('明确绑定和精确原币FIXED匹配可记录来源，费用和分析完全保持',()=>{
  const {file,project,id}=referenceSetup(),json=serializeProject(project),args={trade:toTrade(project),scenario:toScenario(project),taxProfile:project.tax_profile,fxBooks:project.fx_books},before=analyze(args);
  const copy=confirmContainerBillCostReference(freeze(file),id,freeze(project),source()),r=reviewContainerBillDraft(copy,project);expect(r.rows[0]!.cost_reference).toMatchObject({issues:[],source_issues:[],existing_containment:null,included_in_quoted_price:false});
  expect(serializeProject(project)).toBe(json);expect(analyze(args)).toEqual(before);expect(file.rows[0]!.cost_reference?.evidence).toBeUndefined();expect(copy.rows[0]!.cost_reference?.evidence?.status).toBe('USER_CONFIRMED');
 });
 it.each(['name','quantity','quote','transport','term','date'])('项目%s改变使绑定不匹配，不重新绑定',kind=>{
  const {file,project}=referenceSetup();if(kind==='name')project.name+=' changed';if(kind==='quantity')project.goods.quantity='999';if(kind==='quote')project.term_scenarios!.CIF!.quote!.amount='999';
  if(kind==='transport')project.term_scenarios!.CIF!.transport!.paid_to='changed';if(kind==='term')project.incoterm='CIP';if(kind==='date')project.evaluation_date='2026-10-15';
  const raw=JSON.stringify(file);expect(reviewContainerBillDraft(file,project).issues).toContain('PROJECT_BINDING_MISMATCH');expect(JSON.stringify(file)).toBe(raw);
 });
 it('绑定采用原始事实，不由六位量化或模拟金额产生，JSON键顺序不影响稳定快照',()=>{
  const {project}=referenceSetup(),b=containerBillBinding(project),copy=JSON.parse(JSON.stringify(project));copy.term_scenarios.CIF.quote=Object.fromEntries(Object.entries(copy.term_scenarios.CIF.quote).reverse());expect(containerBillBinding(copy)).toEqual(b);
 });
 it.each(['amount','currency','scope','type','bearer','containment','quote-inclusion','override','port-inclusion','ref-note'])('费用引用%s变更使其来源失效',kind=>{
  const {file,project,cost,id}=referenceSetup();const confirmed=confirmContainerBillCostReference(file,id,project,source());
  if(kind==='amount')cost.amount='241';if(kind==='currency')cost.currency='CNY';if(kind==='scope')cost.container_charge_scope='changed';if(kind==='type')cost.container_charge='DETENTION';if(kind==='bearer')cost.responsibility='BUYER';
  if(kind==='containment')cost.contained_in_cost_id=project.items[0]!.cost_id;if(kind==='quote-inclusion')cost.included_in_quoted_price=true;
  if(kind==='override')project.term_scenarios!.CIF!.responsibility_overrides={...project.term_scenarios!.CIF!.responsibility_overrides,[cost.cost_id]:{responsibility:'BUYER',reason:'changed'}};
  if(kind==='port-inclusion')project.items[0]!.includes_port_charges=true;if(kind==='ref-note')confirmed.rows[0]!.cost_reference!.note='changed';
  expect(reviewContainerBillDraft(confirmed,project).rows[0]!.cost_reference!.source_issues).toContain('数据或来源记录已变动，需要重新核对');expect(invalidateContainerBillConfirmations(confirmed,project).rows[0]!.cost_reference!.evidence!.status).toBe('UNVERIFIED');
 });
 it('其他税率/费用不改写账单来源；无当前项目时引用须待核对',()=>{
  const {file,project,id}=referenceSetup(),confirmed=confirmContainerBillCostReference(file,id,project,source());project.tax_profile.import.vatRate='0.09';project.items[0]!.notes='unrelated';
  expect(invalidateContainerBillConfirmations(confirmed,project).rows[0]!.evidence?.status).toBe('USER_CONFIRMED');expect(reviewContainerBillDraft(confirmed).rows[0]!.cost_reference?.issues).toContain('PROJECT_REQUIRED');
 });
 it.each(['missing','duplicate','inactive','amount','currency','scope','pricing','included','contained','no-note','multi-line','unbound','source'])('引用%s待办不能确认为费用引用',kind=>{
  const {file,project,cost,id}=referenceSetup();let expected='';
  if(kind==='missing'){project.items.pop();expected='UNKNOWN_COST';}if(kind==='duplicate'){project.items.push(structuredClone(cost));expected='AMBIGUOUS_COST';}
  if(kind==='inactive'){cost.applicable_incoterms=['FOB'];expected='COST_NOT_ACTIVE_OR_SELECTION_INVALID';}if(kind==='amount'){cost.amount='239.999999999999999999';expected='COST_AMOUNT_MISMATCH';}
  if(kind==='currency'){cost.currency='CNY';expected='COST_CURRENCY_MISMATCH';}if(kind==='scope'){delete cost.container_charge;expected='COST_SCOPE_REVIEW_REQUIRED';}
  if(kind==='pricing'){cost.pricing_method='QTY_X_UNIT';cost.rate='120';cost.quantity='2';expected='NON_FIXED_AMOUNT_REVIEW_REQUIRED';}
  if(kind==='included'){cost.included_in_quoted_price=true;expected='EXISTING_INCLUSION_REVIEW_REQUIRED';}if(kind==='contained'){cost.contained_in_cost_id=project.items[0]!.cost_id;expected='EXISTING_INCLUSION_REVIEW_REQUIRED';}
  if(kind==='no-note'){file.rows[0]!.cost_reference!.note='';expected='REFERENCE_NOTE_REQUIRED';}if(kind==='multi-line'){const row=structuredClone(file.rows[0]!);row.input.line_id='second';file.rows.push(row);expected='MULTIPLE_LINES_REFERENCE_SAME_COST';}
  if(kind==='unbound'){file.binding=null;expected='PROJECT_BINDING_MISMATCH';}if(kind==='source')file.rows[0]!.evidence!.status='UNVERIFIED';
  const r=reviewContainerBillDraft(file,project);if(expected)expect(r.rows[0]!.cost_reference!.issues).toContain(expected);expect(()=>confirmContainerBillCostReference(file,id,project,source())).toThrow('CONTAINER_BILL_CONFIRM_INVALID:cost_reference');
 });
 it('已含THC的主运费提醒保留，不因费用范围不同就自动放行',()=>{
  const {file,project,cost,id}=referenceSetup();file.rows[0]!.input.charge_kind='THC_DESTINATION';file.rows[0]!.input.mode='PER_CONTAINER';file.rows[0]!.input.rate='120';delete file.rows[0]!.input.period;delete file.rows[0]!.input.daily;cost.container_charge='THC_DESTINATION';project.items[0]!.includes_port_charges=true;
  const confirmed=confirms(file);expect(reviewContainerBillDraft(confirmed,project).rows[0]!.cost_reference!.issues).toContain('PORT_CHARGE_INCLUSION_REVIEW_REQUIRED');expect(()=>confirmContainerBillCostReference(confirmed,id,project,source())).toThrow();
 });
 it('引用删除后保留原cost_id；坏替代费用选择仅给受控待办，不泄露底层私有名称',()=>{
  const {file,project}=referenceSetup();project.items[0]!.alternative_group='X';project.items.at(-1)!.alternative_group='X';const r=reviewContainerBillDraft(file,project);expect(r.issues).toContain('PROJECT_COST_SELECTION_INVALID');expect(r.rows[0]!.cost_reference!.cost_id).toBe('bill-cost');
 });
 it.each([240,9007199254740992])('原费用金额数字%s不冒充精确文本匹配',value=>{
  const {file,project,cost,id}=referenceSetup();cost.amount=value;expect(reviewContainerBillDraft(file,project).rows[0]!.cost_reference!.issues).toContain('ORIGINAL_AMOUNT_TEXT_REQUIRED');expect(()=>confirmContainerBillCostReference(file,id,project,source())).toThrow();
 });
 it('精确匹配不依赖全局Decimal精度，不以六位舍入掩盖差额',()=>{
  const {file,project,cost}=referenceSetup(),previous=Decimal.precision;
  try{Decimal.set({precision:4});cost.amount='239.999999999999999999';expect(reviewContainerBillDraft(file,project).rows[0]!.cost_reference!.issues).toContain('COST_AMOUNT_MISMATCH');cost.amount='240.000000000000000000';expect(reviewContainerBillDraft(file,project).rows[0]!.cost_reference!.issues).toEqual([]);}finally{Decimal.set({precision:previous});}
 });
 it('重新绑定克隆并撤销相关确认，不改变原文件或自动重新确认',()=>{
  const {file,project}=referenceSetup();project.name='new';const copy=bindContainerBillDraft(freeze(file),project);expect(copy.binding).toEqual(containerBillBinding(project));expect(copy.rows[0]!.evidence!.status).toBe('UNVERIFIED');expect(file.rows[0]!.evidence!.status).toBe('USER_CONFIRMED');
 });
});
