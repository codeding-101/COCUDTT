/** Bounded rendering and explicit close review for the independent business copy. */
export type BusinessPaint='FULL'|'RESULT';
export interface BusinessCloseFacts{usable:boolean;pendingTrade:boolean;unsavedBusiness:boolean;unreadFiles:number;physicalTasks:number;deferredPaint:boolean;pendingHandoff:boolean;}
export class BusinessModalError extends Error{constructor(readonly code:string){super('BUSINESS_MODAL_'+code);this.name='BusinessModalError';}}
function fail(code:string):never{throw new BusinessModalError(code);}
export class BusinessModalPaint{
 private pending:{kind:BusinessPaint;paint:()=>void}|null=null;private revision=0;
 constructor(private readonly usable:()=>boolean,private readonly blocked:()=>boolean,private readonly mask:()=>void){}
 request(kind:BusinessPaint,paint:()=>void){if(!this.usable())fail('CONTEXT_CHANGED');if(this.blocked()||this.pending){if(kind==='FULL'||this.pending?.kind!=='FULL')this.pending={kind,paint};this.revision++;this.mask();return;}paint();this.revision++;}
 retry(){if(!this.usable())fail('CONTEXT_CHANGED');if(this.blocked())fail('CLOSE_UPPER_MODAL_FIRST');const p=this.pending;if(!p)return false;this.pending=null;try{p.paint();this.revision++;return true;}catch(error){this.pending=p;this.mask();throw error;}}
 inspect(){return{pending:this.pending!==null,kind:this.pending?.kind??null,revision:this.revision,retained_jobs:this.pending?1:0};}
}
export interface BusinessModalCloseChoice{readonly scope:'CLOSE_INDEPENDENT_BUSINESS_MODAL';readonly source_saved:false;readonly raw_retained:true;}
export class BusinessModalCloseGuard{
 private version=0;private review:{token:BusinessModalCloseChoice;basis:string;version:number;checked:boolean}|null=null;private consumed=false;
 constructor(private readonly facts:()=>BusinessCloseFacts,private readonly basis:()=>string){}
 touch(){this.version++;}
 private safe(){const f=this.facts();if(this.consumed)fail('CLOSE_CONSUMED');if(!f.usable)fail('CONTEXT_CHANGED');if(f.physicalTasks)fail('WAIT_PHYSICAL_TASKS');if(f.pendingTrade)fail('UNCOMMITTED_TRADE_INPUT');if(f.unreadFiles)fail('UNREAD_FILE');if(f.deferredPaint)fail('RETRY_DEFERRED_PAINT');if(f.unsavedBusiness)fail('UNSAVED_BUSINESS');if(f.pendingHandoff)fail('HANDOFF_NOT_FINISHED');}
 prepare(){this.safe();const token=Object.freeze({scope:'CLOSE_INDEPENDENT_BUSINESS_MODAL' as const,source_saved:false as const,raw_retained:true as const});this.review={token,basis:this.basis(),version:this.version,checked:false};return token;}
 private current(token:BusinessModalCloseChoice){this.safe();const r=this.review;if(!r||r.token!==token||r.version!==this.version||r.basis!==this.basis())fail('FOREIGN_OR_STALE_CLOSE');return r;}
 acknowledge(token:BusinessModalCloseChoice,checked:boolean){const r=this.current(token);if(typeof checked!=='boolean')fail('ACKNOWLEDGEMENT');r.checked=checked;}
 consume(token:BusinessModalCloseChoice,choice:'CLOSE_SAVED_INDEPENDENT_BUSINESS_VIEW'){const r=this.current(token);if(!r.checked||choice!=='CLOSE_SAVED_INDEPENDENT_BUSINESS_VIEW')fail('EXPLICIT_CLOSE_REQUIRED');this.consumed=true;this.review=null;}
 inspect(){return{review_pending:!!this.review,consumed:this.consumed,version:this.version,source_saved:false};}
}
