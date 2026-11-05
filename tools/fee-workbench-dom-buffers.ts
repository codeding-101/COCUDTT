/** Read-only input evidence; observations never flush, commit, discard or certify a save. */
export interface BufferSample {readonly value:string;readonly flags:readonly boolean[];readonly files:readonly object[];readonly badInput:boolean}
const equal=(a:BufferSample,b:BufferSample)=>a.value===b.value&&a.badInput===b.badInput&&a.flags.length===b.flags.length&&a.flags.every((v,i)=>v===b.flags[i])&&a.files.length===b.files.length&&a.files.every((v,i)=>v===b.files[i]);
interface BufferRecord {baseline:BufferSample|null;last:BufferSample|null;connected:boolean;dirty:boolean;unreadable:boolean}
export class WorkbenchBufferLedger {
  private closed=false;private epoch=0;private events=0;private mutations=0;
  private readonly records=new Map<object,BufferRecord>();
  private copy(s:BufferSample){return Object.freeze({value:s.value,flags:Object.freeze([...s.flags]),files:Object.freeze([...s.files]),badInput:s.badInput});}
  update(key:object,sample:BufferSample|null,connected:boolean){
    if(this.closed)return;
    const next=sample?this.copy(sample):null,old=this.records.get(key);
    if(!old){this.records.set(key,{baseline:next,last:next,connected,dirty:!!next?.files.length||!!next?.badInput,unreadable:!next});this.epoch++;return;}
    if(old.connected!==connected||old.unreadable!==!next||!!old.last!==!!next||old.last&&next&&!equal(old.last,next))this.epoch++;
    old.connected=connected;old.unreadable=!next;old.last=next;
    // A failed read must retain earlier dirty evidence, not clear it.
    if(next)old.dirty=!old.baseline||!equal(old.baseline,next)||!!next.files.length||next.badInput;
  }
  event(){if(!this.closed){this.events++;this.epoch++;}}
  structuralMutation(count:number){if(!this.closed&&count>0){this.mutations+=count;this.epoch++;}}
  keys(){return [...this.records.keys()];}
  snapshot(){let dirty_attached=0,dirty_detached=0,unreadable=0,file_selected=0;for(const r of this.records.values()){if(r.dirty)r.connected?dirty_attached++:dirty_detached++;if(r.unreadable)unreadable++;if(r.last?.files.length)file_selected++;}return Object.freeze({scope:'ROOT_NATIVE_INPUT_BUFFERS',epoch:this.epoch,observing:!this.closed,controls:this.records.size,dirty_attached,dirty_detached,unreadable,file_selected,events:this.events,structural_mutations:this.mutations,all_dom_buffers_covered:false,script_property_aba_covered:false,closed_shadow_controls_covered:false,initial_save_evidence_unknown:true,financial_writes:0});}
  isCurrent(epoch:number){return !this.closed&&epoch===this.epoch;}
  stop(){this.closed=true;this.epoch++;this.records.clear();return this.snapshot();}
}
export class WorkbenchDomBufferObservation {
  private readonly ledger=new WorkbenchBufferLedger();
  private readonly observer:MutationObserver;
  private closed=false;
  private readonly types=['beforeinput','input','change','reset','compositionstart','compositionend'];
  private readonly handler=()=>{this.ledger.event();this.sync();};
  constructor(private readonly root:HTMLElement){
    const view=root.ownerDocument.defaultView;if(!view)throw Error('WORKBENCH_DOM_VIEW');
    this.observer=new view.MutationObserver(records=>{this.ledger.structuralMutation(records.length);this.scan();});
    for(const type of this.types)root.addEventListener(type,this.handler,true);
    this.observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['value','checked','selected','type']});this.scan();
  }
  private sample(control:Element):BufferSample|null{
    try{
      const view=this.root.ownerDocument.defaultView!;
      if(control instanceof view.HTMLInputElement)return{value:control.value,flags:[control.checked,control.indeterminate],files:control.files?[...control.files]:[],badInput:control.validity.badInput};
      if(control instanceof view.HTMLSelectElement)return{value:control.value,flags:[...control.options].map(o=>o.selected),files:[],badInput:false};
      if(control instanceof view.HTMLTextAreaElement)return{value:control.value,flags:[],files:[],badInput:control.validity.badInput};
    }catch{return null;}return null;
  }
  private scan(){
    if(this.closed)return;
    const current=new Set<Element>(this.root.querySelectorAll('input,select,textarea'));
    for(const control of current)this.ledger.update(control,this.sample(control),control.isConnected&&this.root.isConnected);
    for(const key of this.ledger.keys())if(!current.has(key as Element))this.ledger.update(key,this.sample(key as Element),false);
  }
  private sync(){if(this.closed)return;this.ledger.structuralMutation(this.observer.takeRecords().length);this.scan();}
  snapshot(){this.sync();return this.ledger.snapshot();}
  isCurrent(epoch:number){this.sync();return this.ledger.isCurrent(epoch);}
  stop(){if(this.closed)return this.ledger.snapshot();this.sync();this.closed=true;for(const type of this.types)this.root.removeEventListener(type,this.handler,true);this.observer.disconnect();return this.ledger.stop();}
}
