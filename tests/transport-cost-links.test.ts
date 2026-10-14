import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {evidenceKey,type SourceEvidence} from '../src/domain/source-evidence';
import {transportCostLinkEvidenceValues,type TransportCostLink,type TransportCostLinkInput} from '../src/domain/transport-cost-links';
import {reviewTransportCostLinks,validateTransportCostLinkInput} from '../src/engine/transport-cost-links';
import {logisticsProject} from './fixtures/logistics-project';
import {toScenario,toTrade,toScenarios,parseProject,serializeProject} from '../src/data/project-file';
import {analyze} from '../src/engine/analyze';
import {compare,scenarioWithDerivedInclusions} from '../src/engine/compare';
import {makeCostItem} from './helpers/factory';
function setup(){
 const project=logisticsProject('CPT');
 project.items.push(makeCostItem({cost_id:'through',cost_name:'任意名称，不能按名称判定',amount:'100',currency:'CNY'}));
 const trade=toTrade(project),scenario=toScenario(project),link:TransportCostLink={cost_id:'through',state:'LINKED',segment_ids:['road-origin','sea','road-destination'],charge_kind:'CARRIAGE',scope_id:'synthetic-through-contract'};
 const input:TransportCostLinkInput={target_cost_ids:['through'],links:[link]};
 const confirm=(l=link)=>{const evidence:SourceEvidence={status:'USER_CONFIRMED',reference:'合成运输合同费用范围001',valid_from:'2026-09-01',valid_to:'2026-09-30',checked_on:'2026-09-01'};evidence.values_key=evidenceKey(transportCostLinkEvidenceValues(trade.items.find(c=>c.cost_id===l.cost_id)!,scenario,l),evidence);l.evidence=evidence;};
 confirm();return{project,trade,scenario,input,link,confirm};
}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
describe('独立运输费用关联核对：引用，不分摊金额或改写业务规则',()=>{
 it('陆海陆通运报价关联三段，不按段数复制金额，不改变交货点或运费终点',()=>{
  const{trade,scenario,input}=setup(),raw=JSON.stringify({trade,scenario,input}),r=reviewTransportCostLinks(trade,scenario,input);
  expect(r).toMatchObject({version:'0.1',scope:'REFERENCE_CHECK_ONLY',requested:true,reference_checks_passed:true,review_required:false,active_target_cost_ids:['through'],unlinked_target_cost_ids:[],segments_without_links:[],potential_overlaps:[]});
  expect(r.links[0]!.segment_ids).toEqual(['road-origin','sea','road-destination']);expect(JSON.stringify({trade,scenario,input})).toBe(raw);expect(trade.items.find(c=>c.cost_id==='through')!.amount).toBe('100');expect(scenario.transport!.delivery_segment_id).toBe('road-origin');expect(scenario.transport!.paid_to).toBe('上海仓库');
 });
 it('空范围不视为检查通过，未关联段仅描述，不自动报缺费用或补零',()=>{
  const{trade,scenario}=setup(),r=reviewTransportCostLinks(trade,scenario,{target_cost_ids:[],links:[]});expect(r).toMatchObject({requested:false,reference_checks_passed:false,review_required:false,issues:[]});expect(r.segments_without_links).toHaveLength(3);
 });
 it.each(['absent','draft'])('明确核对范围中的%s关联保持待确认',kind=>{
  const{trade,scenario,input,link}=setup();if(kind==='absent')input.links=[];else link.state='UNCONFIRMED';const r=reviewTransportCostLinks(trade,scenario,input);expect(r.unlinked_target_cost_ids).toEqual(['through']);expect(r.reference_checks_passed).toBe(false);expect(r.issues.map(i=>i.code)).toContain('LINK_UNCONFIRMED');
 });
 it('非运输费用可明确不适用，须有依据且不保留隐藏段/类型/范围',()=>{
  const{trade,scenario,input,link,confirm}=setup();link.state='NOT_APPLICABLE';link.segment_ids=[];link.charge_kind='UNCONFIRMED';link.scope_id='';confirm();expect(reviewTransportCostLinks(trade,scenario,input).reference_checks_passed).toBe(true);link.segment_ids=['sea'];confirm();expect(reviewTransportCostLinks(trade,scenario,input).issues.map(i=>i.code)).toContain('NOT_APPLICABLE_HAS_LINKS');
 });
 it.each(['unknown-cost','unknown-segment','duplicate-segment','reverse','gap','empty-segments','missing-plan','kind','scope','route-gap','duplicate-cost','duplicate-route','trade'])('独立拒绝%s而不修补输入',kind=>{
  const{trade,scenario,input,link,confirm}=setup();let code='';
  if(kind==='unknown-cost'){input.target_cost_ids=['gone'];input.links=[];code='UNKNOWN_COST';}
  if(kind==='unknown-segment'){link.segment_ids=['gone'];code='UNKNOWN_SEGMENT';}
  if(kind==='duplicate-segment'){link.segment_ids=['sea','sea'];code='DUPLICATE_SEGMENT';}
  if(kind==='reverse'){link.segment_ids=['sea','road-origin'];code='NONCONTIGUOUS_SEGMENTS';}
  if(kind==='gap'){link.segment_ids=['road-origin','road-destination'];code='NONCONTIGUOUS_SEGMENTS';}
  if(kind==='empty-segments'){link.segment_ids=[];code='SEGMENTS_REQUIRED';}
  if(kind==='missing-plan'){delete scenario.transport;code='TRANSPORT_REQUIRED';}
  if(kind==='kind'){link.charge_kind='UNCONFIRMED';code='CHARGE_KIND_UNCONFIRMED';}
  if(kind==='scope'){link.scope_id='';code='CHARGE_SCOPE_REQUIRED';}
  if(kind==='route-gap'){scenario.transport!.segments[1]!.from='另一地点';code='ROUTE_GAP';}
  if(kind==='duplicate-cost'){trade.items.push(structuredClone(trade.items.find(c=>c.cost_id==='through')!));code='AMBIGUOUS_COST_ID';}
  if(kind==='duplicate-route'){scenario.transport!.segments[1]!.segment_id='road-origin';code='AMBIGUOUS_SEGMENT_ID';}
  if(kind==='trade'){scenario.trade_id='wrong';code='TRADE_MISMATCH';}
  if(kind!=='unknown-cost')confirm();const before=JSON.stringify({trade,scenario,input}),r=reviewTransportCostLinks(trade,scenario,input);expect(r.issues.map(i=>i.code)).toContain(code);expect(r.reference_checks_passed).toBe(false);expect(r.review_required).toBe(true);expect(JSON.stringify({trade,scenario,input})).toBe(before);
 });
 it.each(['missing','unverified','example','expiry','bad-date','missing-reference','snapshot'])('关联依据%s不能当核对通过',kind=>{
  const{trade,scenario,input,link}=setup();if(kind==='missing')delete link.evidence;if(kind==='unverified')link.evidence!.status='UNVERIFIED';if(kind==='example')link.evidence!.status='EXAMPLE';if(kind==='expiry')link.evidence!.valid_to='2026-08-31';if(kind==='bad-date')link.evidence!.checked_on='2026-02-30';if(kind==='missing-reference')link.evidence!.reference='';if(kind==='snapshot')link.evidence!.values_key='stale';expect(reviewTransportCostLinks(trade,scenario,input).issues.map(i=>i.code)).toContain('SOURCE_UNCONFIRMED');
 });
 it.each(['amount','currency','name','cost-node','inclusion','scope','link-ids','carrier','endpoint','contract','quote','term','delivery','evaluation-date'])('修改%s撤销原快照有效性，不自动重确认',kind=>{
  const{trade,scenario,input,link}=setup(),cost=trade.items.find(c=>c.cost_id==='through')!;
  if(kind==='amount')cost.amount='101';if(kind==='currency')cost.currency='EUR';if(kind==='name')cost.cost_name='新名称';if(kind==='cost-node')cost.trade_node='DESTINATION_TERMINAL';if(kind==='inclusion')cost.included_in_quoted_price=true;if(kind==='scope')link.scope_id='other';if(kind==='link-ids')link.segment_ids=['sea'];if(kind==='carrier')scenario.transport!.segments[1]!.carrier='新承运人';if(kind==='endpoint')scenario.transport!.segments[2]!.to='新仓库';if(kind==='contract')scenario.transport!.segments[1]!.contract_reference='新合同';if(kind==='quote')scenario.quote.amount='999';if(kind==='term')scenario.incoterm='CIP';if(kind==='delivery')scenario.transport!.delivery_location='新地点';if(kind==='evaluation-date')scenario.contract_review!.evaluation_date='2026-09-02';
  expect(reviewTransportCostLinks(trade,scenario,input).issues.map(i=>i.code)).toContain('SOURCE_UNCONFIRMED');expect(link.evidence!.status).toBe('USER_CONFIRMED');
 });
 it('不活跃替代费用的旧段引用保留但不参加当前核对或重叠；再次启用重新检查',()=>{
  const{trade,scenario,input,link,confirm}=setup();const cost=trade.items.find(c=>c.cost_id==='through')!;cost.applicable_incoterms=['CIP'];link.segment_ids=['removed'];confirm();let r=reviewTransportCostLinks(trade,scenario,input);expect(r).toMatchObject({active_target_cost_ids:[],inactive_target_cost_ids:['through'],issues:[],reference_checks_passed:false,potential_overlaps:[]});scenario.incoterm='CIP';r=reviewTransportCostLinks(trade,scenario,input);expect(r.issues.map(i=>i.code)).toContain('UNKNOWN_SEGMENT');expect(r.issues.map(i=>i.code)).toContain('SOURCE_UNCONFIRMED');
 });
 it('沿用现有互斥组和引用检查，不把不同术语的替代报价合并',()=>{
  const{trade,scenario,input}=setup();trade.items.push(makeCostItem({cost_id:'other',alternative_group:'same',amount:'1'}));trade.items.find(c=>c.cost_id==='through')!.alternative_group='same';expect(()=>reviewTransportCostLinks(trade,scenario,input)).toThrow('同时启用');
 });
 it.each(['NONE','DIRECT','COMMON_PARENT'] as const)('同类型/明确收费范围/相交段只报候选，保留%s原包含关系，不自动去重',relation=>{
  const{trade,scenario,input,link,confirm}=setup();const other=makeCostItem({cost_id:'other',amount:'20'});trade.items.push(other);if(relation==='DIRECT')other.contained_in_cost_id='through';if(relation==='COMMON_PARENT'){trade.items.push(makeCostItem({cost_id:'parent',amount:'150'}));other.contained_in_cost_id='parent';trade.items.find(c=>c.cost_id==='through')!.contained_in_cost_id='parent';}
  const second={...structuredClone(link),cost_id:'other',segment_ids:['sea']};input.target_cost_ids.push('other');input.links.push(second);confirm();confirm(second);const raw=JSON.stringify(trade),r=reviewTransportCostLinks(trade,scenario,input);expect(r.potential_overlaps).toEqual([{cost_ids:['through','other'],segment_ids:['sea'],charge_kind:'CARRIAGE',scope_id:'synthetic-through-contract',existing_containment:relation}]);expect(r.reference_checks_passed).toBe(true);expect(r.review_required).toBe(true);expect(JSON.stringify(trade)).toBe(raw);
 });
 it.each(['kind','scope','disjoint'])('%s不同不能按名称猜重叠或自动判已包含',kind=>{
  const{trade,scenario,input,link,confirm}=setup();trade.items.push(makeCostItem({cost_id:'other',cost_name:'任意名称，不能按名称判定',amount:'20'}));link.segment_ids=['road-origin'];const other={...structuredClone(link),cost_id:'other'};if(kind==='kind')other.charge_kind='HANDLING';if(kind==='scope')other.scope_id='another-contract';if(kind==='disjoint')other.segment_ids=['road-destination'];input.links.push(other);input.target_cost_ids.push('other');confirm();confirm(other);expect(reviewTransportCostLinks(trade,scenario,input).potential_overlaps).toEqual([]);
 });
 it('冻结输入可核对、输出不共享段数组；客户/运行工具未接入新模块',()=>{
  const{trade,scenario,input}=setup();freeze(trade);freeze(scenario);freeze(input);const r=reviewTransportCostLinks(trade,scenario,input);r.links[0]!.segment_ids.push('MUTATED_OUTPUT');expect(input.links[0]!.segment_ids).not.toContain('MUTATED_OUTPUT');expect(readFileSync(new URL('../src/ui/app.ts',import.meta.url),'utf8')).not.toContain('transport-cost-links');expect(readFileSync(new URL('../src/data/project-file.ts',import.meta.url),'utf8')).not.toContain('transport-cost-links');
 });
 it('关联核对前后既有金额/风险/排名及项目保存字节一致，不激活旧同名扩展',()=>{
  const{project}=setup();const restored=parseProject(serializeProject(project));Object.assign(restored,{transport_cost_links:{PRIVATE_LEGACY_EXTENSION:true}});const trade=toTrade(restored),template=toScenario(restored),args={trade,template,scenarios:toScenarios(restored),anchor:restored.anchor,taxProfile:restored.tax_profile,fxBooks:restored.fx_books},before=analyze({...args,scenario:scenarioWithDerivedInclusions(template,trade)}),comparison=compare(args),raw=serializeProject(restored);
  reviewTransportCostLinks(trade,template,{target_cost_ids:[],links:[]});expect(analyze({...args,scenario:scenarioWithDerivedInclusions(template,trade)})).toEqual(before);expect(compare(args)).toEqual(comparison);expect(serializeProject(restored)).toBe(raw);expect(raw).toContain('PRIVATE_LEGACY_EXTENSION');
 });
 it.each(['null','targets-type','target-duplicate','links-type','extra-link','duplicate-link','state','segment-type','segment-text','kind','scope','evidence','evidence-status','evidence-key','too-many-targets','too-many-segments'])('坏结构%s不能伪装草稿',kind=>{
  const{input}=setup(),value:Record<string,any>=JSON.parse(JSON.stringify(input));if(kind==='null'){expect(()=>validateTransportCostLinkInput(null)).toThrow('结构无效');return;}
  if(kind==='targets-type')value.target_cost_ids='through';if(kind==='target-duplicate')value.target_cost_ids.push('through');if(kind==='links-type')value.links={};if(kind==='extra-link')value.links[0].cost_id='outside';if(kind==='duplicate-link')value.links.push(structuredClone(value.links[0]));if(kind==='state')value.links[0].state='AUTO';if(kind==='segment-type')value.links[0].segment_ids='sea';if(kind==='segment-text')value.links[0].segment_ids=[1];if(kind==='kind')value.links[0].charge_kind='FREIGHT';if(kind==='scope')value.links[0].scope_id=1;if(kind==='evidence')value.links[0].evidence='confirmed';if(kind==='evidence-status')value.links[0].evidence.status='APPROVED';if(kind==='evidence-key')value.links[0].evidence.values_key=1;if(kind==='too-many-targets')value.target_cost_ids=Array.from({length:101},(_,n)=>'c'+n);if(kind==='too-many-segments')value.links[0].segment_ids=Array.from({length:101},(_,n)=>'s'+n);expect(()=>validateTransportCostLinkInput(value)).toThrow('结构无效');
 });
 it('最多100费用×100运输段可核对，最多4950对候选；无随机/当前日期依赖',()=>{
  const{trade,scenario}=setup();trade.items=Array.from({length:100},(_,n)=>makeCostItem({cost_id:'cost-'+n,amount:'1'}));scenario.transport!.segments=Array.from({length:100},(_,n)=>({segment_id:'s'+n,mode:'ROAD',from:'p'+n,to:'p'+(n+1),carrier:'synthetic',contract_reference:'synthetic'}));const input:TransportCostLinkInput={target_cost_ids:trade.items.map(c=>c.cost_id),links:trade.items.map(c=>({cost_id:c.cost_id,state:'LINKED',segment_ids:scenario.transport!.segments.map(s=>s.segment_id),charge_kind:'CARRIAGE',scope_id:'same-scope'}))};for(const link of input.links){const e:SourceEvidence={status:'USER_CONFIRMED',reference:'synthetic',valid_from:'2026-09-01',valid_to:'2026-09-30',checked_on:'2026-09-01'};e.values_key=evidenceKey(transportCostLinkEvidenceValues(trade.items.find(c=>c.cost_id===link.cost_id)!,scenario,link),e);link.evidence=e;}const r=reviewTransportCostLinks(trade,scenario,input);expect(r.reference_checks_passed).toBe(true);expect(r.potential_overlaps).toHaveLength(4950);expect(r.segments_without_links).toEqual([]);
 });
 it('36组连续范围按独立集合交集对照，不凭相同名称和金额判断',()=>{
  const ranges=[['road-origin'],['sea'],['road-destination'],['road-origin','sea'],['sea','road-destination'],['road-origin','sea','road-destination']];
  for(const first of ranges)for(const second of ranges){const{trade,scenario,input,link,confirm}=setup();trade.items.push(makeCostItem({cost_id:'other',cost_name:'完全不同的名称',amount:'999'}));link.segment_ids=[...first];const other={...structuredClone(link),cost_id:'other',segment_ids:[...second]};input.target_cost_ids.push('other');input.links.push(other);confirm();confirm(other);const common=first.filter(id=>new Set(second).has(id)),r=reviewTransportCostLinks(trade,scenario,input);expect(r.potential_overlaps.map(p=>p.segment_ids)).toEqual(common.length?[common]:[]);}
 });
});
