import type {ProjectFile} from './project-file.js';
import type {ContainerBillDraft} from '../domain/container-bill-draft.js';
import type {ContainerCostPair,ContainerCostMapping} from '../domain/container-cost-pair.js';
import type {ContainerCostIntent,ContainerCostProposalInput} from '../domain/container-cost-proposal.js';
import {emptyEvidence,evidenceKey} from '../domain/source-evidence.js';
import {proposeContainerCosts,validateContainerCostProposalInput,validateContainerCostProposalJson} from '../engine/container-cost-proposal.js';
import {projectJsonSchema,type JsonSchema} from './project-validation.js';
import {transportProjectSchema} from './transport-project-schema.js';
import {containerBillDraftSchema} from './container-bill-file.js';

export const CONTAINER_COST_PAIR_BYTES=10*1024*1024;
const key=(value:unknown)=>evidenceKey(value,emptyEvidence());
const target=(intent:ContainerCostIntent)=>intent.operation==='CREATE_NEW'?intent.new_cost.cost_id:intent.cost_id;
function fail(path:string):never {throw Error('CONTAINER_COST_PAIR_INVALID:'+path);}
function object(value:unknown,required:string[]):asserts value is Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>!required.includes(k)))fail('shape');
}
function id(value:unknown):asserts value is string {
 if(typeof value!=='string'||Array.from(value).length>200||!value.trim()||['__proto__','constructor','prototype'].includes(value))fail('id');
}
function contentKey(pair:Omit<ContainerCostPair,'content_key'>|ContainerCostPair):string {
 const {content_key:_content,...values}=pair as ContainerCostPair;return key(values);
}
function validatePayload(project:ProjectFile,bill:ContainerBillDraft,selection:ContainerCostProposalInput):void {
 validateContainerCostProposalInput(project,bill,selection);
 if(!['0.8','0.9'].includes(project.schema_version))fail('project_version');
 const lines=new Set<string>(),costs=new Set<string>();
 for(const intent of selection.intents){
  if(!bill.rows.some(r=>r.input.line_id===intent.line_id))fail('unknown_line');
  if(lines.has(intent.line_id)||costs.has(target(intent)))fail('duplicate_selection');
  lines.add(intent.line_id);costs.add(target(intent));
 }
}
/** Runtime cross-reference and snapshot checks supplement the offline structural schema. */
export function validateContainerCostPair(value:unknown):asserts value is ContainerCostPair {
 validateContainerCostProposalJson(value);
 object(value,['kind','version','pair_id','revision','project','bill','selection','mapping','retired_mappings','content_key']);
 if(value.kind!=='INTERNAL_CONTAINER_COST_PAIR'||value.version!=='1.0')fail('kind/version');id(value.pair_id);
 if(!Number.isSafeInteger(value.revision)||Number(value.revision)<1||Number(value.revision)>1000000000)fail('revision');
 if(typeof value.content_key!=='string')fail('content_key');
 validatePayload(value.project as ProjectFile,value.bill as ContainerBillDraft,value.selection as ContainerCostProposalInput);
 object(value.mapping,['version','entries']);if(value.mapping.version!=='0.1'||!Array.isArray(value.mapping.entries)||value.mapping.entries.length>50)fail('mapping');
 if(!Array.isArray(value.retired_mappings)||value.retired_mappings.length>200)fail('retired_mappings');
 const seen=new Set<string>(),retiredNew=new Set<string>();
 for(const entries of [value.mapping.entries,value.retired_mappings])for(const entry of entries){
  object(entry,['mapping_id','bill_id','line_id','cost_id','operation']);for(const k of ['mapping_id','bill_id','line_id','cost_id'])id(entry[k]);
  if(!['CREATE_NEW','REFERENCE_EXISTING'].includes(entry.operation as string)||seen.has(entry.mapping_id as string))fail('mapping_identity');seen.add(entry.mapping_id as string);
  if(entries===value.retired_mappings&&entry.operation==='CREATE_NEW'){if(retiredNew.has(entry.cost_id as string))fail('retired_new_cost_id');retiredNew.add(entry.cost_id as string);}
 }
 const pair=value as unknown as ContainerCostPair;
 if(pair.mapping.entries.length!==pair.selection.intents.length)fail('mapping_count');
 const activeLines=new Set<string>();
 for(const entry of pair.mapping.entries){
  const intent=pair.selection.intents.find(i=>i.line_id===entry.line_id);
  if(!intent||activeLines.has(entry.line_id)||entry.bill_id!==pair.bill.id||entry.cost_id!==target(intent)||entry.operation!==intent.operation)fail('mapping_reference');activeLines.add(entry.line_id);
  if(entry.operation==='CREATE_NEW'&&retiredNew.has(entry.cost_id))fail('retired_new_cost_id');
 }
 if(pair.content_key!==contentKey(pair))fail('snapshot_mismatch');
 if(new TextEncoder().encode(JSON.stringify(pair,null,2)+'\n').length>CONTAINER_COST_PAIR_BYTES)fail('size');
}
function seal(values:Omit<ContainerCostPair,'content_key'>):ContainerCostPair {
 const copy=structuredClone(values),pair={...copy,content_key:contentKey(copy)};validateContainerCostPair(pair);return pair;
}
function mapping(bill:ContainerBillDraft,intent:ContainerCostIntent):ContainerCostMapping {
 return{mapping_id:'mapping-'+crypto.randomUUID(),bill_id:bill.id,line_id:intent.line_id,cost_id:target(intent),operation:intent.operation};
}
export function createContainerCostPair(project:ProjectFile,bill:ContainerBillDraft,selection:ContainerCostProposalInput):ContainerCostPair {
 validatePayload(project,bill,selection);
 return seal({kind:'INTERNAL_CONTAINER_COST_PAIR',version:'1.0',pair_id:'pair-'+crypto.randomUUID(),revision:1,project,bill,selection,mapping:{version:'0.1',entries:selection.intents.map(i=>mapping(bill,i))},retired_mappings:[]});
}
/** Expected key must refer to the caller's current state. No mutations, writes or global lock. */
export function updateContainerCostPair(current:ContainerCostPair,expected_key:string,project:ProjectFile,bill:ContainerBillDraft,selection:ContainerCostProposalInput):ContainerCostPair {
 validateContainerCostPair(current);if(expected_key!==current.content_key)fail('stale_update');validatePayload(project,bill,selection);
 if(key({project,bill,selection})===key({project:current.project,bill:current.bill,selection:current.selection}))return structuredClone(current);
 const keep=current.mapping.entries.filter(e=>e.bill_id===bill.id&&selection.intents.some(i=>i.line_id===e.line_id&&target(i)===e.cost_id&&i.operation===e.operation));
 const retired=[...current.retired_mappings,...current.mapping.entries.filter(e=>!keep.includes(e))];
 return seal({kind:current.kind,version:current.version,pair_id:current.pair_id,revision:current.revision+1,project,bill,selection,
  mapping:{version:'0.1',entries:selection.intents.map(i=>keep.find(e=>e.line_id===i.line_id)??mapping(bill,i))},retired_mappings:retired});
}
export function serializeContainerCostPair(pair:ContainerCostPair):string {
 validateContainerCostPair(pair);const text=JSON.stringify(pair,null,2)+'\n';if(new TextEncoder().encode(text).length>CONTAINER_COST_PAIR_BYTES)fail('size');return text;
}
export function parseContainerCostPair(text:string):ContainerCostPair {
 if(typeof text!=='string'||new TextEncoder().encode(text).length>CONTAINER_COST_PAIR_BYTES)fail('size');let value:unknown;
 try{value=JSON.parse(text);}catch{fail('JSON');}validateContainerCostPair(value);return value;
}
/** Paired review compares full raw snapshots; no readiness or fee-application flag. */
export function reviewContainerCostPair(pair:ContainerCostPair,currentProject=pair.project,currentBill=pair.bill){
 validateContainerCostPair(pair);validateContainerCostProposalJson({currentProject,currentBill});
 const issues:string[]=[];
 if(key(currentProject)!==key(pair.project))issues.push('PROJECT_SNAPSHOT_MISMATCH');
 if(key(currentBill)!==key(pair.bill))issues.push('BILL_SNAPSHOT_MISMATCH');
 return{scope:'PAIRED_REFERENCE_ONLY' as const,pair_id:pair.pair_id,revision:pair.revision,issues,
  proposal:proposeContainerCosts(pair.project,pair.bill,pair.selection),mapping:structuredClone(pair.mapping),retired_mappings:structuredClone(pair.retired_mappings)};
}
/** Offline shape only. Runtime additionally verifies unique IDs, mappings, snapshots and UTF-8 bounds. */
export function containerCostPairSchema():JsonSchema {
 const idSchema={type:'string',maxLength:200,pattern:'\\S',not:{enum:['__proto__','constructor','prototype']}},text={type:'string',maxLength:4000};
 const obj=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
 const embedded=(schema:JsonSchema)=>{const {$schema:_schema,$id:_id,...inner}=schema;return inner;};
 const project08=projectJsonSchema(),project09=transportProjectSchema();
 const cost=structuredClone((project08.properties as Record<string,JsonSchema>).items!.items as JsonSchema);cost.additionalProperties=false;
 (cost.properties as Record<string,JsonSchema>).cost_id=idSchema;
 const bill=containerBillDraftSchema(),evidence=((bill.properties as Record<string,JsonSchema>).rows!.items as JsonSchema).properties as Record<string,JsonSchema>;
 const common={line_id:idSchema,note:text};
 const selection=obj({version:{const:'0.1'},intents:{type:'array',maxItems:50,items:{oneOf:[obj({...common,operation:{const:'REFERENCE_EXISTING'},cost_id:idSchema}),obj({...common,operation:{const:'CREATE_NEW'},new_cost:cost,evidence:evidence.evidence},['line_id','note','operation','new_cost'])]}}});
 const entry=obj({mapping_id:idSchema,bill_id:idSchema,line_id:idSchema,cost_id:idSchema,operation:{enum:['CREATE_NEW','REFERENCE_EXISTING']}});
 return{$schema:'http://json-schema.org/draft-07/schema#',$id:'urn:cocudtt:internal-container-cost-pair:1.0',title:'COCUDTT internal container cost pair 1.0',description:'Independent paired snapshots and proposed mappings only. Cross-ID checks, content snapshot, JSON/UTF-8 limits and business review require runtime validation. Does not write fees.',
  ...obj({kind:{const:'INTERNAL_CONTAINER_COST_PAIR'},version:{const:'1.0'},pair_id:idSchema,revision:{type:'integer',minimum:1,maximum:1000000000},project:{anyOf:[embedded(project08),embedded(project09)]},bill:embedded(bill),selection,
   mapping:obj({version:{const:'0.1'},entries:{type:'array',maxItems:50,items:entry}}),retired_mappings:{type:'array',maxItems:200,items:entry},content_key:{type:'string'}})};
}
