/** Narrow production observations. No protocol frame or financial write entry. */
import {BILL_STORAGE_KEY} from './container-bill-controller.js';
import {PAIR_STORAGE_KEY} from './container-cost-pair-controller.js';
import {COST_EDITOR_STORAGE_KEY} from '../data/container-cost-editor.js';
import {REVIEW_EDITOR_STORAGE_KEY} from '../data/container-review-editor.js';
import {FEE_TAX_ATTACHMENT_STORAGE_KEYS} from './fee-tax-attachment-controller.js';
import {FEE_PRECISION_SELECTION_STORAGE_KEYS} from './fee-precision-selection-controller.js';
import {FEE_ENVELOPE_STORAGE_KEY} from './fee-envelope-controller.js';
import type {FeeSourcePending,FeeSourceStorage} from './fee-workbench-source-adapter.js';
export type {FeeSourceReaders,FeeSourceProject,FeeSourceWorkflow} from './fee-workbench-source-adapter.js';

export const FEE_SOURCE_STORAGE_KEYS = Object.freeze(['trade-cost-engine:draft-v1',BILL_STORAGE_KEY,PAIR_STORAGE_KEY,COST_EDITOR_STORAGE_KEY,
 REVIEW_EDITOR_STORAGE_KEY,...Object.values(FEE_TAX_ATTACHMENT_STORAGE_KEYS),...Object.values(FEE_PRECISION_SELECTION_STORAGE_KEYS),FEE_ENVELOPE_STORAGE_KEY]);
export function observeFeeSourcePending(control:HTMLElement|null):FeeSourcePending{
 const form=typeof HTMLInputElement!=='undefined'&&control instanceof HTMLInputElement||typeof HTMLSelectElement!=='undefined'&&control instanceof HTMLSelectElement||typeof HTMLTextAreaElement!=='undefined'&&control instanceof HTMLTextAreaElement;
 return{present:control!==null,control:form?{tag:control!.tagName,id:control!.id,type:(control as HTMLInputElement).type,value:(control as HTMLInputElement).value,dataset:{...control!.dataset},connected:control!.isConnected}:null};
}
export function observeFeeSourceStorage(getItem:(key:string)=>string|null):FeeSourceStorage{
 return Object.fromEntries(FEE_SOURCE_STORAGE_KEYS.map(key=>{
  let raw:string|null;try{raw=getItem(key);}catch{return[key,{raw:null,available:false}];}
  if(raw!==null&&typeof raw!=='string')throw Error('FEE_SOURCE_ADAPTER_STORAGE_VALUE');
  return[key,{raw,available:true}];
 }));
}
