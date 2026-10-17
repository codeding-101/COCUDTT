import type {FeeTaxAttachment,FeeTaxAttachmentRecordInput} from '../domain/fee-tax-attachment.js';
import {FeeTaxAttachmentError} from '../domain/fee-tax-attachment.js';
import {copyFeeTaxAttachmentJson,parseFeeTaxAttachmentJson} from './fee-tax-attachment-json.js';

export const FEE_TAX_EDITOR_BYTES=256*1024;
export const FEE_TAX_EDITOR_TEXT_BYTES=64*1024;
export interface FeeTaxAttachmentEditor {
 kind:'INTERNAL_FEE_TAX_ATTACHMENT_EDITOR';version:'0.1';editor_id:string;
 attachment_id:string;basis_revision:number;basis_sha256:string;
 record_id:string|null;record_json:string;
}
const fail=():never=>{throw new FeeTaxAttachmentError('EDITOR_INVALID')};
export function validateFeeTaxAttachmentEditor(value:unknown):FeeTaxAttachmentEditor{
 const v=copyFeeTaxAttachmentJson(value) as Record<string,unknown>;
 const keys=['kind','version','editor_id','attachment_id','basis_revision','basis_sha256','record_id','record_json'];
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))return fail();
 if(v.kind!=='INTERNAL_FEE_TAX_ATTACHMENT_EDITOR'||v.version!=='0.1')return fail();
 for(const k of['editor_id','attachment_id'])if(typeof v[k]!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(v[k]))return fail();
 if(!Number.isSafeInteger(v.basis_revision)||(v.basis_revision as number)<1||(v.basis_revision as number)>1e9||typeof v.basis_sha256!=='string'||!/^[0-9a-f]{64}$/.test(v.basis_sha256))return fail();
 if(v.record_id!==null&&(typeof v.record_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(v.record_id)))return fail();
 if(typeof v.record_json!=='string'||new TextEncoder().encode(v.record_json).length>FEE_TAX_EDITOR_TEXT_BYTES||new TextEncoder().encode(JSON.stringify(v)).length>FEE_TAX_EDITOR_BYTES)return fail();
 return v as unknown as FeeTaxAttachmentEditor;
}
export function parseFeeTaxAttachmentEditor(text:string):FeeTaxAttachmentEditor{return validateFeeTaxAttachmentEditor(parseFeeTaxAttachmentJson(text,FEE_TAX_EDITOR_BYTES));}
export function feeTaxAttachmentEditorIsCurrent(editor:FeeTaxAttachmentEditor,a:FeeTaxAttachment):boolean{
 return editor.attachment_id===a.attachment_id&&editor.basis_revision===a.revision&&editor.basis_sha256===a.content_sha256&&(editor.record_id===null||a.records.some(r=>r.record_id===editor.record_id));
}
export function startFeeTaxAttachmentEditor(a:FeeTaxAttachment,record_id:string|null=null):FeeTaxAttachmentEditor{
 const r=record_id===null?null:a.records.find(r=>r.record_id===record_id);if(record_id!==null&&!r)return fail();
 return validateFeeTaxAttachmentEditor({kind:'INTERNAL_FEE_TAX_ATTACHMENT_EDITOR',version:'0.1',editor_id:'tax-editor-'+crypto.randomUUID(),attachment_id:a.attachment_id,basis_revision:a.revision,basis_sha256:a.content_sha256,record_id,record_json:r?JSON.stringify({target:r.target,input:r.input,sources:r.sources},null,2):''});
}
/** The unsubmitted text may be incomplete; only the explicit submit action parses it. */
export function readFeeTaxAttachmentEditorInput(editor:FeeTaxAttachmentEditor):FeeTaxAttachmentRecordInput{
 const e=validateFeeTaxAttachmentEditor(editor);return parseFeeTaxAttachmentJson(e.record_json,FEE_TAX_EDITOR_TEXT_BYTES) as FeeTaxAttachmentRecordInput;
}
