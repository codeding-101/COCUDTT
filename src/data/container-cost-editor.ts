import type {ContainerCostPair} from '../domain/container-cost-pair.js';
import type {ContainerCostIntent} from '../domain/container-cost-proposal.js';
import type {CostItem} from '../domain/cost-item.js';
import {COST_CATEGORIES,TRADE_NODES,OCCURRENCE_REASONS,FX_TYPES} from '../domain/enums.js';
import {emptyEvidence,evidenceKey,invalidateEvidence} from '../domain/source-evidence.js';
import {validateContainerBillEvidence} from './container-bill-file.js';
import {validateContainerCostProposalInput,validateContainerCostProposalJson} from '../engine/container-cost-proposal.js';

type NewIntent=Extract<ContainerCostIntent,{operation:'CREATE_NEW'}>;
export const COST_EDITOR_STORAGE_KEY='trade-cost-engine:container-cost-editor-v1';
export const COST_EDITOR_FIELDS=['cost_id','cost_name','cost_category','trade_node','amount','currency','base_currency','fx_type','tax_included','responsibility','occurrence_reason','payment_party','economic_bearer','customs_value','container_charge','container_charge_scope','applicable_term','basis','note','reference','valid_from','valid_to','checked_on'] as const;
export type CostEditorField=(typeof COST_EDITOR_FIELDS)[number];
export interface ContainerCostEditor {
 kind:'INTERNAL_CONTAINER_COST_EDITOR';version:'0.1';pair_id:string;revision:number;pair_key:string;line_id:string;
 original:NewIntent|null;fields:Record<CostEditorField,string>;
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function validateContainerCostEditor(value:unknown):asserts value is ContainerCostEditor {
 validateContainerCostProposalJson(value);
 if(!object(value)||Object.keys(value).sort().join(',')!==['kind','version','pair_id','revision','pair_key','line_id','original','fields'].sort().join(',')||value.kind!=='INTERNAL_CONTAINER_COST_EDITOR'||value.version!=='0.1'||!Number.isSafeInteger(value.revision)||Number(value.revision)<1||Number(value.revision)>1000000000||!['pair_id','pair_key','line_id'].every(k=>typeof value[k]==='string'&&(value[k] as string).length>0)||!['pair_id','line_id'].every(k=>Array.from(value[k] as string).length<=200&&!['__proto__','constructor','prototype'].includes(value[k] as string)))throw Error('EDITOR_STRUCTURE');
 const fields=value.fields;
 if(!object(fields)||Object.keys(fields).length!==COST_EDITOR_FIELDS.length||!COST_EDITOR_FIELDS.every(k=>Object.hasOwn(fields,k)&&typeof fields[k]==='string'&&Array.from(fields[k] as string).length<=4000))throw Error('EDITOR_FIELDS');
 if(value.original!==null){const i=value.original;if(!object(i)||Object.keys(i).some(k=>!['operation','line_id','new_cost','note','evidence'].includes(k))||i.operation!=='CREATE_NEW'||i.line_id!==value.line_id||typeof i.note!=='string'||!object(i.new_cost)||typeof i.new_cost.cost_id!=='string')throw Error('EDITOR_ORIGINAL');if(i.evidence!==undefined)validateContainerBillEvidence(i.evidence);}
}
function initialFields(intent:NewIntent|null):Record<CostEditorField,string>{
 const fields=Object.fromEntries(COST_EDITOR_FIELDS.map(k=>[k,''])) as Record<CostEditorField,string>;
 if(!intent)return fields;
 for(const k of COST_EDITOR_FIELDS)if(Object.hasOwn(intent.new_cost,k))fields[k]=String(intent.new_cost[k as keyof CostItem]);
 fields.applicable_term=intent.new_cost.applicable_incoterms?.length===1?intent.new_cost.applicable_incoterms[0]!:'';
 fields.note=intent.note;fields.basis='ACCEPT';
 for(const k of ['reference','valid_from','valid_to','checked_on'] as const)fields[k]=intent.evidence?.[k]??'';
 return fields;
}
export function startContainerCostEditor(pair:ContainerCostPair,line_id:string):ContainerCostEditor {
 if(!pair.bill.rows.some(r=>r.input.line_id===line_id))throw Error('EDITOR_LINE');
 const selected=pair.selection.intents.find(i=>i.line_id===line_id);
 if(selected?.operation==='REFERENCE_EXISTING')throw Error('EDITOR_REFERENCE');
 const original=selected?structuredClone(selected):null,fields=initialFields(original);
 if(!original)fields.cost_id='container-cost-'+crypto.randomUUID();
 return{kind:'INTERNAL_CONTAINER_COST_EDITOR',version:'0.1',pair_id:pair.pair_id,revision:pair.revision,pair_key:pair.content_key,line_id,original,fields};
}
export function containerCostEditorIsCurrent(editor:ContainerCostEditor,pair:ContainerCostPair):boolean {
 return editor.pair_id===pair.pair_id&&editor.revision===pair.revision&&editor.pair_key===pair.content_key;
}
/** Explicit bill facts only. Never copies responsibility, tax, source confirmation or FX rate. */
export function copyContainerCostFacts(editor:ContainerCostEditor,pair:ContainerCostPair,amount:string|null):ContainerCostEditor {
 if(!containerCostEditorIsCurrent(editor,pair)||amount===null)throw Error('EDITOR_FACTS');
 const row=pair.bill.rows.find(r=>r.input.line_id===editor.line_id);if(!row)throw Error('EDITOR_LINE');
 const result=structuredClone(editor),f=result.fields;
 f.amount=amount;f.currency=row.input.currency??'';f.base_currency=pair.project.base_currency;
 f.container_charge=row.input.charge_kind??'';f.container_charge_scope=row.input.scope_id??'';f.applicable_term=pair.project.incoterm;
 return result;
}
/** Full input is checked before a complete intent replaces one selection. No application API. */
export function buildContainerCostIntent(editor:ContainerCostEditor,pair:ContainerCostPair):NewIntent {
 validateContainerCostEditor(editor);if(!containerCostEditorIsCurrent(editor,pair))throw Error('EDITOR_STALE');
 const f=editor.fields;
 if(COST_EDITOR_FIELDS.filter(k=>!['reference','valid_from','valid_to','checked_on'].includes(k)).some(k=>!f[k].trim())||f.basis!=='ACCEPT'||!(COST_CATEGORIES as readonly string[]).includes(f.cost_category)||!(TRADE_NODES as readonly string[]).includes(f.trade_node)||!(OCCURRENCE_REASONS as readonly string[]).includes(f.occurrence_reason)||!(FX_TYPES as readonly string[]).includes(f.fx_type)||!['true','false'].includes(f.tax_included)||!['SELLER','BUYER'].includes(f.responsibility)||!['SELLER','BUYER'].includes(f.payment_party)||!['SELLER','BUYER'].includes(f.economic_bearer)||!['ADD','EXCLUDE'].includes(f.customs_value))throw Error('EDITOR_INCOMPLETE');
 const original=editor.original,initial=initialFields(original);
 const cost:Record<string,unknown>=original?structuredClone(original.new_cost) as unknown as Record<string,unknown>:{pricing_method:'FIXED',responsibility_source:'CONTRACT',included_in_quoted_price:false,is_custom:true,source:'USER'};
 for(const k of COST_EDITOR_FIELDS){
  if(['basis','note','reference','valid_from','valid_to','checked_on','applicable_term'].includes(k)||original&&f[k]===initial[k])continue;
  cost[k]=k==='tax_included'?f[k]==='true':f[k];
 }
 if(!original||f.applicable_term!==initial.applicable_term)cost.applicable_incoterms=[f.applicable_term];
 const intent:NewIntent={operation:'CREATE_NEW',line_id:editor.line_id,new_cost:cost as unknown as CostItem,note:f.note};
 const previous=original?.evidence;
 const evidence={...(previous?structuredClone(previous):emptyEvidence()),reference:f.reference,valid_from:f.valid_from,valid_to:f.valid_to,checked_on:f.checked_on};
 const sameSelection=original&&evidenceKey({...original,evidence:null},emptyEvidence())===evidenceKey({...intent,evidence:null},emptyEvidence());
 const sameSource=previous&&['reference','valid_from','valid_to','checked_on'].every(k=>previous[k as keyof typeof previous]===evidence[k as keyof typeof evidence]);
 if(!sameSelection||!sameSource&&(previous||['reference','valid_from','valid_to','checked_on'].some(k=>f[k as CostEditorField]!==''))){intent.evidence=evidence;invalidateEvidence(intent.evidence);delete intent.evidence.values_key;}else if(previous)intent.evidence=evidence;
 validateContainerCostProposalInput(pair.project,pair.bill,{version:'0.1',intents:[intent]});
 return intent;
}
