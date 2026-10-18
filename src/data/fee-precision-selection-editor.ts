import type {FeePrecisionSelection} from '../domain/fee-precision-selection.js';
import {FeePrecisionSelectionError} from '../domain/fee-precision-selection.js';
import {FEE_PRECISION_CHANNELS,type PrecisionChannel} from '../domain/fee-precision.js';
import {copyFeePrecisionSelectionJson as copy,parseFeePrecisionSelectionJson as json} from './fee-precision-selection-json.js';

export const FEE_PRECISION_EDITOR_BYTES=256*1024;
export const FEE_PRECISION_EDITOR_TEXT_BYTES=64*1024;
export interface FeePrecisionSelectionEditor {
 kind:'INTERNAL_FEE_PRECISION_SELECTION_EDITOR';version:'0.1';editor_id:string;
 selection_id:string;basis_revision:number;basis_sha256:string;
 pair_snapshot_sha256:string;attachment_snapshot_sha256:string;
 record_id:string|null;slot:null|{component_record_id:string;channel:PrecisionChannel};record_json:string;
}
function fail():never{throw new FeePrecisionSelectionError('EDITOR_INVALID');}
const id=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
export function validateFeePrecisionSelectionEditor(value:unknown):FeePrecisionSelectionEditor{
 const v=copy(value) as Record<string,unknown>,keys=['kind','version','editor_id','selection_id','basis_revision','basis_sha256','pair_snapshot_sha256','attachment_snapshot_sha256','record_id','slot','record_json'];
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();
 if(v.kind!=='INTERNAL_FEE_PRECISION_SELECTION_EDITOR'||v.version!=='0.1'||!id(v.editor_id)||!id(v.selection_id)||!Number.isSafeInteger(v.basis_revision)||(v.basis_revision as number)<1||(v.basis_revision as number)>1e9)fail();
 for(const k of['basis_sha256','pair_snapshot_sha256','attachment_snapshot_sha256'])if(!hash(v[k]))fail();
 if(v.record_id===null){if(v.slot!==null)fail();}
 else{if(!id(v.record_id)||!v.slot||typeof v.slot!=='object'||Array.isArray(v.slot))fail();const s=v.slot as Record<string,unknown>;if(Object.keys(s).length!==2||!Object.hasOwn(s,'component_record_id')||!Object.hasOwn(s,'channel')||!id(s.component_record_id)||!FEE_PRECISION_CHANNELS.includes(s.channel as PrecisionChannel))fail();}
 if(typeof v.record_json!=='string'||new TextEncoder().encode(v.record_json).length>FEE_PRECISION_EDITOR_TEXT_BYTES||new TextEncoder().encode(JSON.stringify(v)).length>FEE_PRECISION_EDITOR_BYTES)fail();
 return v as unknown as FeePrecisionSelectionEditor;
}
export function parseFeePrecisionSelectionEditor(text:string){return validateFeePrecisionSelectionEditor(json(text,FEE_PRECISION_EDITOR_BYTES));}
/** Metadata helper for an already validated file; it does not certify source documents. */
export function startFeePrecisionSelectionEditor(value:FeePrecisionSelection,record_id:string|null=null):FeePrecisionSelectionEditor{
 const a=copy(value) as FeePrecisionSelection;if(!a||!Array.isArray(a.records))fail();const r=record_id===null?null:a.records.find(r=>r.record_id===record_id);if(record_id!==null&&!r)fail();
 return validateFeePrecisionSelectionEditor({kind:'INTERNAL_FEE_PRECISION_SELECTION_EDITOR',version:'0.1',editor_id:'precision-editor-'+crypto.randomUUID(),selection_id:a.selection_id,basis_revision:a.revision,basis_sha256:a.content_sha256,pair_snapshot_sha256:a.pair_snapshot_sha256,attachment_snapshot_sha256:a.attachment_snapshot_sha256,record_id,slot:r?{component_record_id:r.component_record_id,channel:r.channel}:null,record_json:r?JSON.stringify(r.choice,null,2):''});
}
export function feePrecisionSelectionEditorIsCurrent(e:FeePrecisionSelectionEditor,a:FeePrecisionSelection):boolean{
 const r=e.record_id===null?null:a.records.find(r=>r.record_id===e.record_id);
 return e.selection_id===a.selection_id&&e.basis_revision===a.revision&&e.basis_sha256===a.content_sha256&&e.pair_snapshot_sha256===a.pair_snapshot_sha256&&e.attachment_snapshot_sha256===a.attachment_snapshot_sha256&&(e.record_id===null?e.slot===null:!!r&&!!e.slot&&r.component_record_id===e.slot.component_record_id&&r.channel===e.slot.channel);
}
/** Incomplete raw text is retained until explicit submission; existing records edit choice only. */
export function readFeePrecisionSelectionEditorInput(value:FeePrecisionSelectionEditor):unknown{const e=validateFeePrecisionSelectionEditor(value);return json(e.record_json,FEE_PRECISION_EDITOR_TEXT_BYTES);}
