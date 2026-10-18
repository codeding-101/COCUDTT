import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import Decimal from 'decimal.js';
import {proposeFeeApplication} from '../src/data/fee-application-proposal';
import type {FeeApplicationProposalSources} from '../src/domain/fee-application-proposal';
import type {FeeTaxComponentInput} from '../src/domain/fee-tax-components';
import type {FeePrecisionChoice,FeePrecisionSelection} from '../src/domain/fee-precision-selection';
import {completePair,source,lease as taxLease,freeze} from './fixtures/fee-tax-attachment';
import {createContainerCostPair,serializeContainerCostPair,parseContainerCostPair} from '../src/data/container-cost-pair';
import {createFeeTaxAttachment,setFeeTaxAttachmentRecord,acknowledgeFeeTaxAttachmentRecord,serializeFeeTaxAttachment} from '../src/data/fee-tax-attachment';
import {createFeePrecisionSelection,addFeePrecisionSelectionRecord,acknowledgeFeePrecisionSelectionRecord,serializeFeePrecisionSelection} from '../src/data/fee-precision-selection';
import {serializeProject,parseProject,toTrade,toScenario} from '../src/data/project-file';
import {serializeContainerBillDraft} from '../src/data/container-bill-file';
import {confirmContainerBillCostReference} from '../src/engine/container-bill-draft';
import {analyze} from '../src/engine/analyze';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const lease=(a:FeePrecisionSelection)=>({revision:a.revision,content_sha256:a.content_sha256});
const round=(unit='0.01'):FeePrecisionChoice=>({kind:'ROUND',policy:{kind:'EXPLICIT',unit,mode:'HALF_UP',basis:'合成政策，仅测试'}});
const fx=():FeePrecisionChoice=>({kind:'FX',to:'CNY',purpose:'COMMERCIAL_REVIEW',as_of:'2026-10-17',rate_source:{base:'USD',quote:'CNY',rate:'7',type:'CONTRACT',rate_date:'2026-10-01',valid_from:'2026-10-01',valid_to:'2026-10-31',reference:'合成汇率'},policy:{kind:'EXPLICIT',unit:'0.01',mode:'HALF_UP',basis:'仅测试'}});
interface Options {amount?:string;version?:'1.0'|'1.1';tax?:FeeTaxComponentInput['tax'];credit?:FeeTaxComponentInput['credit'];customs?:FeeTaxComponentInput['customs'];choice?:FeePrecisionChoice;ack?:boolean;reference?:boolean;mutate?:(s:ReturnType<typeof completePair>)=>void}
async function setup(o:Options={}){
 const s=completePair(o.amount??'113',o.version??'1.0');o.mutate?.(s);
 if(o.reference){
  const intent=s.pair.selection.intents[0]!;if(intent.operation!=='CREATE_NEW')throw Error();s.pair.project.items.push(structuredClone(intent.new_cost));
  s.pair.bill.rows[0]!.cost_reference={cost_id:intent.new_cost.cost_id,note:'只读引用'};
  const {provenance:_,...fields}=source();s.pair.bill=confirmContainerBillCostReference(s.pair.bill,intent.line_id,s.pair.project,{...fields,status:'UNVERIFIED'});
  s.pair.selection.intents=[{line_id:intent.line_id,operation:'REFERENCE_EXISTING',cost_id:intent.new_cost.cost_id,note:'不重新插入'}];
 }
 const pair=o.mutate||o.reference?createContainerCostPair(s.pair.project,s.pair.bill,s.pair.selection):s.pair,raw=serializeContainerCostPair(pair);
 const record=structuredClone(s.record);record.target={...pair.mapping.entries[0]!};if(o.tax)record.input.tax=o.tax;if(o.credit)record.input.credit=o.credit;if(o.customs)record.input.customs=o.customs;
 let attachment=await createFeeTaxAttachment(raw);attachment=await setFeeTaxAttachmentRecord(attachment,taxLease(attachment),record);
 if(o.ack!==false)for(const f of ['tax','credit','customs'] as const)attachment=await acknowledgeFeeTaxAttachmentRecord(attachment,taxLease(attachment),raw,attachment.records[0]!.record_id,f);
 const attachmentText=await serializeFeeTaxAttachment(attachment);let precision=await createFeePrecisionSelection(raw,attachmentText);
 precision=await addFeePrecisionSelectionRecord(precision,lease(precision),{component_record_id:attachment.records[0]!.record_id,channel:'cash',choice:o.choice??round()});
 if(o.ack!==false)precision=await acknowledgeFeePrecisionSelectionRecord(precision,lease(precision),raw,attachmentText,precision.records[0]!.record_id);
 const sources:FeeApplicationProposalSources={project_json:serializeProject(pair.project),bill_json:serializeContainerBillDraft(pair.bill),pair_json:raw,attachment_json:attachmentText,precision_json:await serializeFeePrecisionSelection(precision),history_json:null};
 return{pair,attachment,precision,sources};
}
describe('完整真实来源只读应用提案',()=>{
 it.each(['1.0','1.1'] as const)('配对%s重算、数值兼容仍无应用资格或业务身份',async version=>{
  const s=await setup({version}),before=JSON.stringify(s.sources),r=await proposeFeeApplication(freeze(s.sources));
  expect(r.scope).toBe('READ_ONLY_FEE_APPLICATION_PROPOSAL');expect(r.effect).toBe('NO_WRITE');expect(r.financial_writes).toBe(0);
  expect(r.rows[0]!.numeric_projection.status).toBe('MODEL_COMPATIBLE');expect(r.rows[0]!.blockers).toEqual([]);
  expect(r.rows[0]!.numeric_projection.channels?.economic).toEqual({numerator:'113',denominator:'1'});
  expect(r.issues).toEqual(expect.arrayContaining(['BUSINESS_IDENTITY_NOT_ESTABLISHED','HISTORY_NOT_ESTABLISHED','NO_GLOBAL_DUPLICATE_PROOF']));
  expect(r.rows[0]!.source_identity).toEqual({business_id:null,bill_id:s.pair.bill.id,line_id:'bill-line',consumption_status:'NOT_VERIFIED'});
  expect(r.rows[0]!.preserved_issues).toEqual(expect.arrayContaining(['CASH_PAYMENT_NOT_VERIFIED','ECONOMIC_COST_NOT_DETERMINED','CUSTOMS_COMPONENT_NOT_DETERMINED']));
  for(const k of ['ready','eligible','apply','transaction_id','receipt','new_costs'])expect(r).not.toHaveProperty(k);
  expect(JSON.stringify(s.sources)).toBe(before);expect(await proposeFeeApplication(s.sources)).toEqual(r);
 },20000);
 it('只读引用不形成新费用或改写原金额/归属',async()=>{const s=await setup({reference:true}),before=serializeProject(s.pair.project),r=await proposeFeeApplication(s.sources);expect(r.rows[0]!.reference_only).toBe(true);expect(r.rows[0]!.existing_target?.amount).toBe('113');expect(r.rows[0]!.numeric_projection.proposed_amount).toBeNull();expect(r.financial_writes).toBe(0);expect(serializeProject(s.pair.project)).toBe(before);});
 it('全部原文和每个单独指纹均冻结，不借缩减字段或候选代替',async()=>{
  const s=await setup(),r=await proposeFeeApplication(s.sources);
  for(const k of Object.keys(s.sources) as (keyof FeeApplicationProposalSources)[])expect(r.basis.fingerprints[k]).toBe(s.sources[k]===null?null:sha(s.sources[k]));
  r.rows[0]!.numeric_projection.channels!.cash!.numerator='999';r.reviews.pair.mapping.entries[0]!.cost_id='changed';expect((await proposeFeeApplication(s.sources)).rows[0]!.mapping.cost_id).toBe('new-proposed-service');
 });
 it('异步前捕获输入，迟到修改不能替换提案依据',async()=>{const s=await setup(),before=structuredClone(s.sources),pending=proposeFeeApplication(s.sources);s.sources.project_json='{}';s.sources.history_json='{"consumed":[]}';const r=await pending;expect(r.basis.sources).toEqual(before);expect(r.history_status).toBe('NOT_ESTABLISHED');});
 it.each(['project_json','bill_json','pair_json','attachment_json','precision_json','history_json'] as const)('六份来源 %s 的空白变化均改变完整上下文',async k=>{
  const s=await setup();s.sources.history_json='{"untrusted":true}';const before=await proposeFeeApplication(s.sources),changed={...s.sources,[k]:s.sources[k]+'\n'},after=await proposeFeeApplication(changed);
  expect(after.basis.context_sha256).not.toBe(before.basis.context_sha256);expect(after.basis.fingerprints[k]).not.toBe(before.basis.fingerprints[k]);
  if(k==='pair_json')expect(after.issues).toContain('ATTACHMENT_PAIR_NOT_CURRENT');if(k==='attachment_json')expect(after.issues).toContain('PRECISION_SOURCE_NOT_CURRENT:attachment_current');
 });
 it.each(['{}','{"business_id":"fake","consumed":[],"verified":true}','{"business_id":"fake","consumed":[{"bill_id":"x","line_id":"bill-line"}]}'])('调用方历史 %s 不能宣称全未消费或通过',async history=>{const s=await setup(),r=await proposeFeeApplication({...s.sources,history_json:history});expect(r.history_status).toBe('UNSUPPORTED_FORMAT');expect(r.issues).toContain('HISTORY_FORMAT_UNSUPPORTED');expect(r.rows[0]!.source_identity.business_id).toBeNull();expect(r.rows[0]!.source_identity.consumption_status).toBe('NOT_VERIFIED');});
 it.each(['project','bill'] as const)('完整当前%s变化被检出并保留原来源',async which=>{const s=await setup();if(which==='project'){const p=parseProject(s.sources.project_json);p.items[0]!.cost_name+=' 未选中变化';s.sources.project_json=serializeProject(p);}else{const b=JSON.parse(s.sources.bill_json);b.notes+=' 新注释';s.sources.bill_json=JSON.stringify(b);}const r=await proposeFeeApplication(s.sources);expect(r.issues).toContain(which==='project'?'PROJECT_SNAPSHOT_MISMATCH':'BILL_SNAPSHOT_MISMATCH');expect(r.reviews.pair.mapping).toEqual(s.pair.mapping);});
 it('假定历史扩展保持惰性，未改变实际财务结果',async()=>{const s=await setup(),p={...s.pair.project,fee_application:{verified:true,business_id:'fake',consumed:[]}},run=(x:typeof p)=>analyze({trade:toTrade(x),scenario:toScenario(x),taxProfile:x.tax_profile,fxBooks:x.fx_books}),before=run(p);s.sources.project_json=serializeProject(p);const r=await proposeFeeApplication(s.sources);expect(r.issues).toContain('BUSINESS_IDENTITY_NOT_ESTABLISHED');expect(parseProject(r.basis.sources.project_json)).toHaveProperty('fee_application',p.fee_application);expect(run(p)).toEqual(before);});
});
describe('单金额模型的受限映射与原待办',()=>{
 it('明确不拆分保留N/T未知，不能转为零',async()=>{const s=await setup({tax:{kind:'NO_SEPARATION'}}),r=await proposeFeeApplication(s.sources);expect(r.rows[0]!.numeric_projection.status).toBe('MODEL_COMPATIBLE');expect(r.rows[0]!.numeric_projection.channels?.net).toBeNull();expect(r.rows[0]!.numeric_projection.channels?.tax).toBeNull();expect(r.reviews.attachment.rows[0]!.calculation.issues).toContain('TAX_NOT_SEPARATED');});
 it.each([
  ['credit',{credit:{kind:'ASSUMED',amount:'13',basis:'合成',document_ref:'TEST',eligibility_ref:'TEST'}},'SEPARATE_ECONOMIC_MODEL_REQUIRED'],
  ['partial-customs',{customs:{kind:'ADD_COMPONENT',amount:'40',basis:'合成部分C'}},'PARTIAL_CUSTOMS_MODEL_REQUIRED'],
  ['unknown-credit',{credit:{kind:'UNKNOWN'},ack:false},'SEPARATE_ECONOMIC_MODEL_REQUIRED'],
  ['unknown-customs',{customs:{kind:'UNKNOWN'},ack:false},'CUSTOMS_COMPONENT_UNKNOWN'],
  ['unknown-tax',{tax:{kind:'UNKNOWN'},ack:false},'TAX_SPLIT_UNKNOWN'],
 ] as const)('%s不能误映射完整G',async(_,options,issue)=>{const s=await setup(options as Options),r=await proposeFeeApplication(s.sources);expect(r.rows[0]!.numeric_projection.issues).toContain(issue);expect(r.rows[0]!.blockers).toContain(issue);expect(r.financial_writes).toBe(0);});
 it('全额C与EXCLUDE冲突保留，不从术语改成ADD',async()=>{const s=await setup({customs:{kind:'ADD_COMPONENT',amount:'113',basis:'仅测试'}}),r=await proposeFeeApplication(s.sources);expect(r.rows[0]!.blockers).toContain('CUSTOMS_FLAG_MISMATCH');expect(r.rows[0]!.field_comparison.customs_flag).toBe('EXCLUDE');});
 it.each(['ADD','EXCLUDE'] as const)('G=C=0允许明确%s但不补默认',async flag=>{const s=await setup({amount:'0',ack:false,mutate:s=>{const i=s.pair.selection.intents[0]!;if(i.operation==='CREATE_NEW')i.new_cost.customs_value=flag;}}),r=await proposeFeeApplication(s.sources);expect(r.rows[0]!.numeric_projection.status).toBe('MODEL_COMPATIBLE');expect(r.rows[0]!.field_comparison.customs_flag).toBe(flag);});
 it('明确全额ADD可数值映射但来源旧回执不因此恢复',async()=>{const s=await setup({ack:false,customs:{kind:'ADD_COMPONENT',amount:'113',basis:'仅测试'},mutate:s=>{const i=s.pair.selection.intents[0]!;if(i.operation==='CREATE_NEW')i.new_cost.customs_value='ADD';}}),r=await proposeFeeApplication(s.sources);expect(r.rows[0]!.numeric_projection.status).toBe('MODEL_COMPATIBLE');expect(r.rows[0]!.blockers).toContain('COMPONENT_ASSUMPTION_NOT_CURRENT:tax');expect(r.rows[0]!.preserved_issues.length).toBeGreaterThan(3);});
 it.each([['0.1234567','0.01','CORE_PRECISION_LOSS'],['0.123456','0.01','ROUNDING_CHANGED_OR_UNKNOWN'],['0.000000000000000001','0.01','CORE_PRECISION_LOSS']] as const)('原额%s不被候选清洗',async(amount,unit,issue)=>{const s=await setup({amount,choice:round(unit),ack:false}),r=await proposeFeeApplication(s.sources);expect(r.rows[0]!.blockers).toContain(issue);expect(r.rows[0]!.numeric_projection.original_amount).toBe(amount);expect(r.basis.sources.pair_json).toBe(s.sources.pair_json);});
 it('大整数及6位尾数精确相等不使用JS Number或当前Decimal精度',async()=>{const s=await setup({amount:'123456789012345678.123456',choice:round('0.000001')}),saved=Decimal.precision;try{Decimal.set({precision:2});const r=await proposeFeeApplication(s.sources);expect(r.rows[0]!.numeric_projection.status).toBe('MODEL_COMPATIBLE');expect(r.rows[0]!.numeric_projection.original_amount).toBe('123456789012345678.123456');}finally{Decimal.set({precision:saved});}});
 it('FX候选保留诊断但不能用作原币amount',async()=>{const s=await setup({choice:fx()}),r=await proposeFeeApplication(s.sources);expect(r.rows[0]!.blockers).toEqual(expect.arrayContaining(['FX_APPLICATION_UNSUPPORTED','ORIGINAL_CURRENCY_ROUND_POLICY_REQUIRED','ROUNDING_CHANGED_OR_UNKNOWN']));expect(r.rows[0]!.numeric_projection.currency).toBe('USD');expect(r.rows[0]!.numeric_projection.candidate).toEqual({numerator:'791',denominator:'1'});});
 it.each(['payment_party','economic_bearer'] as const)('垫付/承担错位%s阻断',async field=>{const s=await setup({ack:false,mutate:s=>{const i=s.pair.selection.intents[0]!;if(i.operation==='CREATE_NEW')i.new_cost[field]='SELLER';}}),r=await proposeFeeApplication(s.sources);expect(r.rows[0]!.blockers).toContain('PAYER_BEARER_RESPONSIBILITY_NOT_ALIGNED');expect(r.rows[0]!.field_comparison[field]).toBe('SELLER');});
 it('新增目标现已存在时阻断，仍保留当前费用和原CREATE_NEW',async()=>{const s=await setup(),p=structuredClone(s.pair.project),intent=s.pair.selection.intents[0]!;if(intent.operation!=='CREATE_NEW')throw Error();p.items.push(intent.new_cost);s.sources.project_json=serializeProject(p);const r=await proposeFeeApplication(s.sources);expect(r.rows[0]!.blockers).toContain('TARGET_ALREADY_EXISTS');expect(r.rows[0]!.mapping.operation).toBe('CREATE_NEW');expect(r.rows[0]!.existing_target?.amount).toBe('113');expect(r.issues).toContain('PROJECT_SNAPSHOT_MISMATCH');});
 it('引用目标从当前项目删除仍阻断，不复建原费用',async()=>{const s=await setup({reference:true}),p=structuredClone(s.pair.project);p.items=p.items.filter(c=>c.cost_id!=='new-proposed-service');const r=await proposeFeeApplication({...s.sources,project_json:serializeProject(p)});expect(r.rows[0]!.blockers).toContain('REFERENCE_TARGET_MISSING');expect(r.rows[0]!.existing_target).toBeNull();expect(r.rows[0]!.reference_only).toBe(true);expect(r.financial_writes).toBe(0);});
 it('完整成分回执被改动会使精度来源失效，即使金额完全未变',async()=>{const s=await setup(),a=structuredClone(s.attachment);a.records[0]!.acknowledgements.credit=null;const {content_sha256:_,...body}=a;const stable=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);a.content_sha256=sha(stable(body));const r=await proposeFeeApplication({...s.sources,attachment_json:await serializeFeeTaxAttachment(a)});expect(r.issues).toContain('PRECISION_SOURCE_NOT_CURRENT:attachment_current');expect(r.rows[0]!.blockers).toContain('COMPONENT_ASSUMPTION_NOT_CURRENT:credit');expect(r.rows[0]!.blockers).toContain('STALE_ATTACHMENT_SOURCE');expect(r.rows[0]!.numeric_projection.status).toBe('MODEL_COMPATIBLE');});
 it('多行完整来源不遗漏无成分的行，任一异常仍无金融写入',async()=>{const s=await setup({ack:false,mutate:s=>{const b=structuredClone(s.pair.bill.rows[0]!),i=structuredClone(s.pair.selection.intents[0]!);b.input.line_id='second-line';b.input.scope_id='second-scope';i.line_id='second-line';if(i.operation!=='CREATE_NEW')throw Error();i.new_cost.cost_id='second-cost';i.new_cost.container_charge_scope='second-scope';s.pair.bill.rows.push(b);s.pair.selection.intents.push(i);}}),r=await proposeFeeApplication(s.sources);expect(r.rows).toHaveLength(2);expect(r.rows[1]!.blockers).toEqual(expect.arrayContaining(['COMPONENT_MISSING','CASH_POLICY_MISSING']));expect(r.reviews.boundary.coverage).toHaveLength(1);expect(r.financial_writes).toBe(0);});
 it.each(['tax_included','tax_rate_ref','contained_in_cost_id','included_in_quoted_price'] as const)('旧%s问题不能被精度候选替代',async key=>{const s=await setup({ack:false,mutate:s=>{const i=s.pair.selection.intents[0]!;if(i.operation!=='CREATE_NEW')throw Error();if(key==='tax_included'||key==='included_in_quoted_price')i.new_cost[key]=true;else i.new_cost[key]=key==='tax_rate_ref'?'service-tax':'insurance';}}),r=await proposeFeeApplication(s.sources);expect(r.rows[0]!.blockers.length).toBeGreaterThan(0);expect(r.rows[0]!.preserved_issues.length).toBeGreaterThan(3);});
});
describe('严格边界输入与坏来源',()=>{
 it.each(['project_json','bill_json','pair_json','attachment_json','precision_json','history_json'] as const)('%s重复JSON键不能被JSON.parse静默清洗',async key=>{const s=await setup();await expect(proposeFeeApplication({...s.sources,[key]:'{"x":1,"x":2}'})).rejects.toThrow('STRICT_SOURCE:'+key);});
 it.each(['project_json','bill_json','pair_json','attachment_json','precision_json'] as const)('%s格式替换不能视为真实来源',async key=>{const s=await setup();await expect(proposeFeeApplication({...s.sources,[key]:'{}'})).rejects.toThrow();});
 it('嵌套来源指纹被篡改时拒绝，不只看表层ID',async()=>{const s=await setup(),a=JSON.parse(s.sources.precision_json);a.pair_snapshot_sha256='0'.repeat(64);await expect(proposeFeeApplication({...s.sources,precision_json:JSON.stringify(a)})).rejects.toThrow('PAIR_DIGEST');});
 it('对象访问器、循环、额外证明字段和缺少槽位拒绝，getter不运行',async()=>{const s=await setup();let reads=0;const getter={...s.sources};Object.defineProperty(getter,'project_json',{enumerable:true,get(){reads++;return s.sources.project_json;}});await expect(proposeFeeApplication(getter)).rejects.toThrow('STRICT_INPUT');expect(reads).toBe(0);await expect(proposeFeeApplication({...s.sources,historyFacts:{verified:true}})).rejects.toThrow('SOURCE_FIELDS');const missing={...s.sources} as Partial<FeeApplicationProposalSources>;delete missing.history_json;await expect(proposeFeeApplication(missing)).rejects.toThrow('SOURCE_FIELDS');const cycle:any={...s.sources};cycle.history_json=cycle;await expect(proposeFeeApplication(cycle)).rejects.toThrow('STRICT_INPUT');});
 it('UTF-16坏字符与超限历史拒绝',async()=>{const s=await setup();await expect(proposeFeeApplication({...s.sources,history_json:'"\ud800"'})).rejects.toThrow('STRICT_INPUT');await expect(proposeFeeApplication({...s.sources,history_json:'"'+'x'.repeat(5*1024*1024)+'"'})).rejects.toThrow('STRICT_SOURCE:history_json');});
 it('完整配对重复目标拒绝，不能漏过其中一行生成可用提案',async()=>{const s=await setup(),p=JSON.parse(s.sources.pair_json);p.mapping.entries.push(p.mapping.entries[0]);await expect(proposeFeeApplication({...s.sources,pair_json:JSON.stringify(p)})).rejects.toThrow();expect(parseContainerCostPair(s.sources.pair_json).mapping.entries).toHaveLength(1);});
});
