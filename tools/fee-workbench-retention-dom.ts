import type{BufferSample}from'./fee-workbench-dom-buffers';import{BoundedWorkbenchBufferLedger,type RetentionProofOwner,type RetentionLimits,type BufferRetirementChoice}from'./fee-workbench-retention';

/** Uses native root inputs only. Overflow pauses diagnostics; the original application is retained. */
export class BoundedWorkbenchDomObservation {
  private readonly ledger:BoundedWorkbenchBufferLedger;private readonly observer:MutationObserver;private closed=false;private listening=false;
  private readonly types=['beforeinput','input','change','reset','compositionstart','compositionend'];
  private readonly handler=(event:Event)=>{this.sync();if(!this.ledger.isObserving())return;this.ledger.event(event.type==='reset'?null:event.target instanceof this.view.Element?event.target:null);this.pauseIfBlocked();};
  private readonly view:Window&typeof globalThis;
  constructor(private readonly root:HTMLElement,proof:RetentionProofOwner,limits:Partial<RetentionLimits>={}){
    const view=root.ownerDocument.defaultView;if(!view)throw Error('WORKBENCH_RETENTION_DOM_VIEW');this.view=view;this.ledger=new BoundedWorkbenchBufferLedger(proof,limits);
    this.observer=new view.MutationObserver(records=>{this.mutations(records);this.scan();this.pauseIfBlocked();});
    for(const type of this.types)root.addEventListener(type,this.handler,true);this.listening=true;
    this.observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['value','checked','selected','type','data-path']});this.scan();this.pauseIfBlocked();
  }
  private sample(control:Element):BufferSample|null{
    try{
      if(['value','checked','indeterminate','files','validity','options','type'].some(k=>Object.hasOwn(control,k)))return null;
      if(control instanceof this.view.HTMLInputElement){const files=control.files;if(files&&files.length>this.ledger.limits.file_refs){this.ledger.trip('FILE_LIMIT');return null;}return{value:control.value,flags:[control.checked,control.indeterminate],files:files?[...files]:[],badInput:control.validity.badInput};}
      if(control instanceof this.view.HTMLSelectElement){if(control.options.length>this.ledger.limits.flags){this.ledger.trip('FLAG_LIMIT');return null;}return{value:control.value,flags:[...control.options].map(o=>o.selected),files:[],badInput:false};}
      if(control instanceof this.view.HTMLTextAreaElement)return{value:control.value,flags:[],files:[],badInput:control.validity.badInput};
    }catch{return null;}return null;
  }
  private mutations(records:readonly MutationRecord[]){this.ledger.structuralMutation(records.length,records.filter(r=>r.type==='attributes').map(r=>r.target instanceof this.view.HTMLOptionElement?r.target.closest('select')??r.target:r.target));}
  private scan(){
    if(this.closed||!this.ledger.isObserving())return;const current=new Set<Element>();
    // A live iterator avoids retaining an unbounded array of newly added controls.
    const walker=this.root.ownerDocument.createTreeWalker(this.root,this.view.NodeFilter.SHOW_ELEMENT);let node=walker.nextNode();
    while(node){if(node instanceof this.view.HTMLInputElement||node instanceof this.view.HTMLSelectElement||node instanceof this.view.HTMLTextAreaElement){current.add(node);this.ledger.update(node,this.sample(node),node.isConnected&&this.root.isConnected);if(!this.ledger.isObserving())return;}node=walker.nextNode();}
    for(const key of this.ledger.keys())if(!current.has(key as Element)){this.ledger.update(key,this.sample(key as Element),false);if(!this.ledger.isObserving())return;}
  }
  private sync(){if(this.closed||!this.ledger.isObserving())return;this.mutations(this.observer.takeRecords());this.scan();this.pauseIfBlocked();}
  private pauseIfBlocked(){if(!this.ledger.isObserving()&&this.listening){for(const type of this.types)this.root.removeEventListener(type,this.handler,true);this.observer.disconnect();this.listening=false;}}
  snapshot(){this.sync();return Object.freeze({...this.ledger.snapshot(),owned_root_listeners:this.listening?this.types.length:0,owned_observer:this.listening});}
  isCurrent(epoch:number){this.sync();return this.ledger.isCurrent(epoch);}
  prepareRetirement(){this.sync();return this.ledger.prepareRetirement();}
  acknowledge(token:BufferRetirementChoice,checked:boolean){this.sync();this.ledger.acknowledge(token,checked);}
  retire(token:BufferRetirementChoice){this.sync();return this.ledger.retire(token);}
  cancelRetirement(){this.ledger.cancelRetirement();}
  stop(){if(!this.closed){this.sync();this.closed=true;for(const type of this.types)this.root.removeEventListener(type,this.handler,true);this.observer.disconnect();this.listening=false;}return this.ledger.stop();}
}
