/** Keeps rejected raw text observable even if a reused child view normalizes or replaces its input. */
import type { FeeContractSettlementManager } from './fee-contract-settlement';
import type { RecoveredHandoffFile } from './fee-recovery-business-files';
import type { CustomerArtifact } from './fee-trade-forms-customer';
type Input=HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement;
export const lifecycleInput=(v:EventTarget|null):v is Input=>(v instanceof HTMLInputElement||v instanceof HTMLSelectElement||v instanceof HTMLTextAreaElement)&&!!(v.dataset.recoveredField||v.dataset.x110Quote||v.dataset.x110Plan||v.dataset.x110Payment||v.dataset.bfFee||v.dataset.bfFunding||v.dataset.tfSens||v.dataset.tfCustomer||v.dataset.tfView);
interface Raw {key:string;value:string|boolean;read:()=>unknown}
export class LifecycleRawInputs {
  private readonly records=new Map<string,Raw>();
  private readonly lastInput=new WeakMap<Input,string|boolean>();
  constructor(private readonly manager:FeeContractSettlementManager){}
  record(e:Input,eventType='input'){const d={...e.dataset},s=this.manager.current(),value=e instanceof HTMLInputElement&&e.type==='checkbox'?e.checked:e.value,key=JSON.stringify(d);
    // Native text change may arrive on blur after explicit discard rebuilt the child view.
    // Its preceding input was already observed; do not resurrect that discarded text.
    if(eventType==='change'&&!(e instanceof HTMLSelectElement)&&!(e instanceof HTMLInputElement&&e.type==='checkbox')&&this.lastInput.get(e)===value)return;
    this.lastInput.set(e,value);
    const read=()=>{if(!s||this.manager.current()!==s)return undefined;
      if(d.recoveredField)return(s.trade.view().values as Record<string,unknown>)[d.recoveredField];
      if(d.x110Quote)return(s.contract.view().values as Record<string,unknown>)[d.x110Quote];
      const p=s.settlement.view().plan;
      if(d.x110Plan)return(p as unknown as Record<string,unknown>|null)?.[d.x110Plan];
      if(d.x110Payment)return(p?.payments.find(r=>r.id===d.x110Payment)as unknown as Record<string,unknown>|undefined)?.[d.x110PaymentField??''];
      if(d.bfFee)return(p?.bank_fees.find(r=>r.id===d.bfFee)as unknown as Record<string,unknown>|undefined)?.[d.bfField??''];
      if(d.bfFunding)return(p?.funding as unknown as Record<string,unknown>|undefined)?.[d.bfFunding];
      const f=s.forms?.view().input;
      if(d.tfSens)return(f?.sensitivity as unknown as Record<string,unknown>|undefined)?.[d.tfSens];
      if(d.tfCustomer)return(f?.customer_fields as unknown as Record<string,unknown>|undefined)?.[d.tfCustomer];
      if(d.tfView)return f?.customer_view;
      return undefined;
    };
    this.records.set(key,{key,value,read});
  }
  unresolved(){for(const[k,r]of this.records){try{if(r.read()===r.value)this.records.delete(k);}catch{/* Unknown is retained, never treated as accepted. */}}return [...this.records.values()].map(r=>({field:r.key,value:r.value}));}
  clear(){this.records.clear();}
}

/** The original one-second download grace is part of the returned physical task. */
export async function startLifecycleDownload(file:RecoveredHandoffFile|CustomerArtifact):Promise<'DOWNLOAD_STARTED'>{
  const data='text'in file?file.text:new Uint8Array(file.data),url=URL.createObjectURL(new Blob([data],{type:file.mime})),anchor=document.createElement('a');let timer:ReturnType<typeof setTimeout>|undefined;
  try{anchor.href=url;anchor.download=file.name;anchor.hidden=true;document.body.append(anchor);try{anchor.click();}finally{anchor.remove();}await new Promise<void>(resolve=>{timer=setTimeout(resolve,1000);});return'DOWNLOAD_STARTED';}
  finally{if(timer!==undefined)clearTimeout(timer);anchor.remove();URL.revokeObjectURL(url);}
}
