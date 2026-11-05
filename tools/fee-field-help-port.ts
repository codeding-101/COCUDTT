/** Creator-supplied targets only. This port never discovers or adopts application listeners. */
import{IsolatedResourceOwner,type OwnedResourceToken}from'./fee-resource-owner';

export interface FieldHelpEventHooks{
 canRun?:()=>boolean;
 beforeRemove?:(type:string)=>void;
}
interface Binding{
 type:string;
 original:EventListener;
 guarded:EventListener;
 active:boolean;
 token:OwnedResourceToken;
}
export class FieldHelpPortError extends Error{
 constructor(readonly code:string){super('FIELD_HELP_PORT_'+code);}
}

export class FieldHelpEventPort{
 private readonly bindings=new Map<OwnedResourceToken,Binding>();
 private readonly issued=new WeakSet<object>();
 constructor(private readonly owner:IsolatedResourceOwner,private readonly target:EventTarget,private readonly hooks:FieldHelpEventHooks={}){}

 listen(type:string,original:EventListener):OwnedResourceToken{
  if(!this.owner.isOpen())throw new FieldHelpPortError('NOT_OPEN');
  if(typeof type!=='string'||!type||type.length>64||typeof original!=='function')throw new FieldHelpPortError('LISTENER');
  for(const record of this.bindings.values())if(record.type===type&&record.original===original){
   if(!record.active)throw new FieldHelpPortError('CLEANUP_PENDING');
   return record.token;
  }
  let record:Binding;
  const owner=this.owner,hooks=this.hooks;
  const guarded:EventListener=function(this:EventTarget,event){
   if(!record.active||!owner.isOpen())return;
   let allowed=true;
   try{allowed=hooks.canRun?.()??true;}catch{allowed=false;}
   if(!allowed||!record.active||!owner.isOpen())return;
   Reflect.apply(original,this,[event]);
  };
  // Reserve cleanup capacity before touching the native target.
  const token=this.owner.own('LISTENER',()=>{
   record.active=false;
   this.hooks.beforeRemove?.(type);
   this.target.removeEventListener(type,guarded);
   this.bindings.delete(record.token);
  });
  record={type,original,guarded,active:false,token};
  this.bindings.set(token,record);
  this.issued.add(token);
  try{
   this.target.addEventListener(type,guarded);
   if(!owner.isOpen()||!this.bindings.has(token))throw new FieldHelpPortError('NOT_OPEN');
   record.active=true;
   return token;
  }catch(error){
   record.active=false;
   // A failed native rollback remains a known inactive capability for explicit cleanup.
   try{if(this.bindings.has(token))owner.release(token);else this.target.removeEventListener(type,guarded);}catch{}
   throw error;
  }
 }

 release(token:OwnedResourceToken):boolean{
  if(!this.issued.has(token))throw new FieldHelpPortError('FOREIGN_BINDING');
  return this.owner.release(token);
 }

 inspect(){
  return Object.freeze({bindings:this.bindings.size,active:[...this.bindings.values()].filter(v=>v.active).length,
   inactive:[...this.bindings.values()].filter(v=>!v.active).length,original_application_listeners_adopted:0});
 }
}
