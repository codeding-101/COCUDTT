import type {ProjectFile} from './project-file.js';
import type {ContainerBillBinding,ContainerBillDraft,ContainerBillDraftRow} from '../domain/container-bill-draft.js';
import {containerBillSourceValues} from '../domain/container-bill-draft.js';
import {emptyEvidence,evidenceKey} from '../domain/source-evidence.js';
import {validateContainerBillDraft} from './container-bill-file.js';

/** Raw facts only, not derived simulated prices or a globally unique project identity. */
export function containerBillBinding(project:ProjectFile):ContainerBillBinding {
 const term=project.incoterm,record=project.term_scenarios?.[term];
 const quote=project.anchor.kind==='ACTUAL_QUOTES'?record?.quote??null:project.quote;
 return{term,context_key:evidenceKey({project_name:project.name,goods:{name:project.goods.name,quantity:project.goods.quantity,unit:project.goods.unit},route:project.route??null,carriage_mode:project.carriage_mode,
  anchor:project.anchor,quote,transport:record?.transport??null,evaluation_date:project.evaluation_date??null},emptyEvidence())};
}
export function containerBillCostSourceValues(file:ContainerBillDraft,row:ContainerBillDraftRow,project:ProjectFile):unknown {
 const candidates=project.items.filter(item=>item.cost_id===row.cost_reference?.cost_id);
 const item=candidates.length===1?candidates[0]:undefined;
 const cost=item?(({base_amount:_derived,...raw})=>raw)(item):null;
 return{bill:containerBillSourceValues(file,row),project_binding:containerBillBinding(project),cost,
  override:project.term_scenarios?.[project.incoterm]?.responsibility_overrides?.[row.cost_reference?.cost_id??'']??null,facts:project.facts??null,
  port_charge_inclusions:project.items.filter(c=>c.includes_port_charges).map(({base_amount:_derived,...raw})=>raw),
  reference:row.cost_reference?{cost_id:row.cost_reference.cost_id,note:row.cost_reference.note}:null};
}
/** Clone before any edit; stale confirmations stay available as unverified audit records. */
export function invalidateContainerBillConfirmations(file:ContainerBillDraft,project?:ProjectFile):ContainerBillDraft {
 validateContainerBillDraft(file);const copy=structuredClone(file);
 for(const row of copy.rows){
  const source=row.evidence;
  if(source?.status==='USER_CONFIRMED'&&source.values_key!==evidenceKey(containerBillSourceValues(copy,row),source))source.status='UNVERIFIED';
  const ref=row.cost_reference?.evidence;
  if(ref?.status==='USER_CONFIRMED'&&(!project||ref.values_key!==evidenceKey(containerBillCostSourceValues(copy,row,project),ref)))ref.status='UNVERIFIED';
 }
 return copy;
}
export function bindContainerBillDraft(file:ContainerBillDraft,project:ProjectFile):ContainerBillDraft {
 validateContainerBillDraft(file);const copy=structuredClone(file);copy.binding=containerBillBinding(project);
 return invalidateContainerBillConfirmations(copy,project);
}
