/** Session-local close authority. Never an import, financial write, saved receipt or root switch. */
import { FeeContractSettlementManager } from './fee-contract-settlement';

export class SessionLifecycleError extends Error {constructor(readonly code:string){super('SESSION_LIFECYCLE_'+code);}}
function fail(code:string):never{throw new SessionLifecycleError(code);}
export interface LifecycleExternal {
  inspect():{physical:boolean;unaccepted:number;import_candidate:boolean};
  cancel():void;whenIdle():Promise<void>;dispose():void;
}
const none:LifecycleExternal={inspect:()=>({physical:false,unaccepted:0,import_candidate:false}),cancel:()=>{},whenIdle:async()=>{},dispose:()=>{}};
export interface CloseChoice {readonly scope:'INDEPENDENT_SESSION_CLOSE';readonly pending_inputs:boolean;readonly unsaved:boolean;readonly unaccepted_inputs:number;readonly candidates:number;readonly requires_discard:boolean;readonly financial_writes:0}
interface Pending {token:CloseChoice;context:()=>boolean;revision:number;signature:string;acknowledged:boolean}
export class FeeSessionLifecycle {
  private closed=false;private settling=false;private revision=0;private pending:Pending|null=null;
  constructor(readonly manager:FeeContractSettlementManager,private readonly external:LifecycleExternal=none){}
  private advance(){if(this.revision===Number.MAX_SAFE_INTEGER)fail('REVISION_LIMIT');this.revision++;this.pending=null;}
  /** Trusted UI interaction boundary, including raw text that the business controller rejects. */
  changed(){if(this.closed)fail('CLOSED');this.advance();}
  view(){
    if(this.closed)return Object.freeze({scope:'INDEPENDENT_SESSION_LIFECYCLE',phase:'CLOSED' as const,has_session:false,pending_inputs:false,unsaved:false,unaccepted_inputs:0,physical:false,candidates:0,unknown:false,needs_warning:false,financial_writes:0,full_workbench_switch:false});
    try{const s=this.manager.current(),x=this.external.inspect();if(typeof x.physical!=='boolean'||typeof x.import_candidate!=='boolean'||!Number.isSafeInteger(x.unaccepted)||x.unaccepted<0)fail('OBSERVATION');
      const pending_inputs=!!s?.hasPending(),unsaved=!!s?.hasUnsaved(),physical=this.settling||this.manager.busy()||!!s?.busy()||x.physical,candidates=Number(!!this.manager.pending())+Number(!!s?.pending())+Number(!!s?.sources.pending())+Number(!!s?.forms?.pendingReview())+Number(x.import_candidate);
      return Object.freeze({scope:'INDEPENDENT_SESSION_LIFECYCLE',phase:this.settling?'SETTLING' as const:'OPEN' as const,has_session:!!s,pending_inputs,unsaved,unaccepted_inputs:x.unaccepted,physical,candidates,unknown:false,needs_warning:pending_inputs||unsaved||physical||x.unaccepted>0,financial_writes:0,full_workbench_switch:false});
    }catch{return Object.freeze({scope:'INDEPENDENT_SESSION_LIFECYCLE',phase:this.settling?'SETTLING' as const:'OPEN' as const,has_session:true,pending_inputs:false,unsaved:false,unaccepted_inputs:0,physical:true,candidates:0,unknown:true,needs_warning:true,financial_writes:0,full_workbench_switch:false});}
  }
  private signature(){const v=this.view();if(v.unknown)fail('UNKNOWN_STATE');if(v.phase==='CLOSED')fail('CLOSED');return JSON.stringify(v);}
  prepareClose():CloseChoice {const signature=this.signature(),v=this.view();if(v.physical)fail('BUSY');this.advance();const token=Object.freeze({scope:'INDEPENDENT_SESSION_CLOSE' as const,pending_inputs:v.pending_inputs,unsaved:v.unsaved,unaccepted_inputs:v.unaccepted_inputs,candidates:v.candidates,requires_discard:v.pending_inputs||v.unsaved||v.unaccepted_inputs>0,financial_writes:0 as const});this.pending={token,context:this.manager.lifecycleContext(),revision:this.revision,signature,acknowledged:false};return token;}
  private ready(token:CloseChoice){const p=this.pending;if(this.closed||!p||p.token!==token||p.revision!==this.revision||!p.context()||p.signature!==this.signature())fail('FOREIGN_OR_STALE');return p;}
  acknowledge(token:CloseChoice,checked:boolean){const p=this.ready(token);if(typeof checked!=='boolean')fail('ACKNOWLEDGEMENT');p.acknowledged=checked;}
  confirm(token:CloseChoice,choice:'CLOSE_SAVED_SESSION'|'DISCARD_UNSAVED_SESSION'){
    const p=this.ready(token);if(this.view().physical)fail('BUSY');if(token.requires_discard){if(choice!=='DISCARD_UNSAVED_SESSION'||!p.acknowledged)fail('EXPLICIT_DISCARD_REQUIRED');}else if(choice!=='CLOSE_SAVED_SESSION')fail('EXPLICIT_CLOSE_REQUIRED');
    this.closed=true;this.pending=null;
    // All physical work was checked synchronously. Cleanup is trusted and has no await/install step.
    try{this.external.dispose();}finally{this.manager.dispose();}
    return Object.freeze({scope:'INDEPENDENT_SESSION_CLOSED',discarded_unsaved:token.requires_discard,financial_writes:0,full_workbench_switch:false});
  }
  cancelClose(){if(!this.closed)this.advance();}
  async cancelTasks(){if(this.closed)fail('CLOSED');if(this.settling)fail('BUSY');this.advance();this.settling=true;const s=this.manager.current();
    try{this.manager.cancel();s?.cancelHandoff();s?.forms?.cancelCustomer();s?.sources.cancel();this.external.cancel();await Promise.all([this.manager.whenIdle(),s?.whenIdle(),this.external.whenIdle()]);}
    finally{this.settling=false;if(!this.closed)this.advance();}
  }
}
