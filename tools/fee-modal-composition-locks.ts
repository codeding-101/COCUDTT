/** Tokens cover registered modal owners only; foreign same-value style ABA remains unknown. */
export interface ModalScrollStyle{getPropertyValue(name:string):string;getPropertyPriority(name:string):string;setProperty(name:string,value:string,priority?:string):void;removeProperty(name:string):unknown;}
export interface ModalScrollLease{readonly scope:'REGISTERED_MODAL_SCROLL';}
export class ModalScrollError extends Error{constructor(readonly code:string,readonly lease?:ModalScrollLease){super('MODAL_SCROLL_'+code);}}
export class ModalScrollLocks{
 private readonly active=new Map<ModalScrollLease,object>();private readonly issued=new WeakMap<object,object>();
 private baseline:{name:string;value:string;priority:string}[]|null=null;private busy=false;private failed=false;
 readonly limit:number;
 constructor(private readonly style:ModalScrollStyle,limit=16){if(!Number.isSafeInteger(limit)||limit<1||limit>16||!style||['getPropertyValue','getPropertyPriority','setProperty','removeProperty'].some(k=>typeof Reflect.get(style,k)!=='function'))throw new ModalScrollError('PORTS');this.limit=limit;}
 private available(){if(this.busy)throw new ModalScrollError('REENTRANT');}
 acquire(owner:object):ModalScrollLease{
  this.available();if(!owner||typeof owner!=='object')throw new ModalScrollError('OWNER');if(this.failed)throw new ModalScrollError('NEEDS_CLEANUP');if(this.active.size>=this.limit)throw new ModalScrollError('LIMIT');
  this.busy=true;try{
   const first=this.active.size===0;
   if(first)this.baseline=['overflow-x','overflow-y'].map(name=>({name,value:this.style.getPropertyValue(name),priority:this.style.getPropertyPriority(name)}));
   const lease=Object.freeze({scope:'REGISTERED_MODAL_SCROLL' as const});this.active.set(lease,owner);this.issued.set(lease,owner);
   if(first)try{this.style.setProperty('overflow','hidden');}catch{this.failed=true;throw new ModalScrollError('WRITE_FAILED',lease);}
   return lease;
  }finally{this.busy=false;}
 }
 release(owner:object,lease:ModalScrollLease):boolean{
  this.available();if(!lease||this.issued.get(lease)!==owner)throw new ModalScrollError('FOREIGN');if(!this.active.has(lease))return false;
  this.busy=true;try{
   if(this.active.size===1)try{for(const axis of this.baseline??[]){if(this.style.getPropertyValue(axis.name)!=='hidden'||this.style.getPropertyPriority(axis.name)!=='')continue;if(axis.value)this.style.setProperty(axis.name,axis.value,axis.priority);else this.style.removeProperty(axis.name);}}catch{this.failed=true;throw new ModalScrollError('RESTORE_FAILED',lease);}
   this.active.delete(lease);if(!this.active.size){this.baseline=null;this.failed=false;}return true;
  }finally{this.busy=false;}
 }
 inspect(){return Object.freeze({leases:this.active.size,limit:this.limit,needs_cleanup:this.failed,registered_ownership:true,foreign_same_value_aba_detected:false,browser_memory_limit_claimed:false});}
}
