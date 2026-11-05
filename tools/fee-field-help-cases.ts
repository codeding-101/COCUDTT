import{IsolatedResourceOwner}from'./fee-resource-owner';
import{FieldHelpEventPort}from'./fee-field-help-port';

export async function probeFieldHelpPorts(){
 const cases:{id:string;checks:Record<string,boolean>}[]=[];
 const owner=new IsolatedResourceOwner(),target=new EventTarget(),port=new FieldHelpEventPort(owner,target);let count=0,receiver=false;
 const listener:EventListener=function(this:EventTarget,event){count++;receiver=this===target;event.preventDefault();};
 const first=port.listen('close',listener),duplicate=port.listen('close',listener),event=new Event('close',{cancelable:true});
 const result=target.dispatchEvent(event);
 cases.push({id:'native-receiver-and-dedup',checks:{receiver,once:count===1,same_token:first===duplicate,cancelled:!result&&event.defaultPrevented,one_resource:owner.snapshot().resources===1}});
 const foreign=new FieldHelpEventPort(owner,new EventTarget());let refused=false;try{foreign.release(first);}catch{refused=true;}
 cases.push({id:'creator-private-binding',checks:{foreign_refused:refused,still_active:port.inspect().active===1}});
 port.release(first);target.dispatchEvent(new Event('close'));
 cases.push({id:'actual-removal-and-repeat',checks:{no_more_callbacks:count===1,repeat_harmless:port.release(first)===false,empty:port.inspect().bindings===0&&owner.snapshot().resources===0}});
 const failedOwner=new IsolatedResourceOwner(),failedTarget=new EventTarget();let fail=true,badCalls=0;
 const failedPort=new FieldHelpEventPort(failedOwner,failedTarget,{beforeRemove(){if(fail)throw Error('synthetic');}});
 failedPort.listen('keydown',()=>{badCalls++;});const choice=failedOwner.prepareClose();failedOwner.acknowledge(choice,true);
 const failed=await failedOwner.close(choice,'CLOSE_OWNED_STAGED_RESOURCES');failedTarget.dispatchEvent(new Event('keydown'));
 cases.push({id:'failed-removal-quiescence',checks:{failed:failed.phase==='FAILED',retained:failed.resources===1,inactive:failedPort.inspect().inactive===1,no_callback:badCalls===0}});
 fail=false;const closed=await failedOwner.retryCleanup('RETRY_FAILED_OWNED_RESOURCES');
 cases.push({id:'explicit-retry',checks:{closed:closed.phase==='CLOSED',empty:failedPort.inspect().bindings===0,resources_zero:closed.resources===0}});
 return{scope:'FIELD_HELP_CREATOR_EVENT_PORT',cases,financial_writes:0,save_authority:false,original_application_listeners_adopted:0};
}
