import{observationFixture}from'./fee-workbench-observation-cases';
import{WorkbenchBoundaryObservation,FeeWorkbenchBoundaryCheck,type WorkbenchBoundarySite}from'./fee-workbench-boundaries';
import{WorkbenchBufferLedger}from'./fee-workbench-dom-buffers';
export const syntheticBoundarySites:readonly WorkbenchBoundarySite[]=[
 {id:'method',owner:'auxiliary',kind:'METHOD_ENTRY',method:'read',path:'synthetic.ts',line:1},
 {id:'set-add',owner:'sections',kind:'COLLECTION_CALL',method:'add',path:'synthetic.ts',line:2},
 {id:'set-delete',owner:'sections',kind:'COLLECTION_CALL',method:'delete',path:'synthetic.ts',line:3},
];
export const emptyBuffer=()=>({value:'',flags:[],files:[],badInput:false});
export function boundaryFixture(){
 const f=observationFixture(),sections=new Set<string>(),boundaries=new WorkbenchBoundaryObservation(syntheticBoundarySites,{auxiliary:f.target,sections}),buffers=new WorkbenchBufferLedger(),control={},check=new FeeWorkbenchBoundaryCheck(f.observation,boundaries,buffers);
 buffers.update(control,emptyBuffer(),true);
 return{...f,sections,boundaries,buffers,control,boundaryCheck:check,close:()=>{check.dispose();buffers.stop();boundaries.stop();f.close();}};
}
export function probeWorkbenchBoundaries(){
 const cases=[];
 for(const mode of['quiet','cached_method','collection_aba','dom_event_aba','detached_dirty','unknown_read','resource_unknown','stopped']as const){
  const f=boundaryFixture();try{
   const before=f.boundaryCheck.inspect();
   if(mode==='cached_method')f.boundaries.entry('method',f.target);
   if(mode==='collection_aba'){f.boundaries.collection('set-add',f.sections,'add',['synthetic']);f.boundaries.collection('set-delete',f.sections,'delete',['synthetic']);}
   if(mode==='dom_event_aba'){f.buffers.event();f.buffers.event();}
   if(mode==='detached_dirty'){f.buffers.update(f.control,{...emptyBuffer(),value:'SYNTHETIC_UNSAVED'},true);f.buffers.update(f.control,{...emptyBuffer(),value:'SYNTHETIC_UNSAVED'},false);}
   if(mode==='unknown_read')f.buffers.update(f.control,null,true);
   if(mode==='resource_unknown')f.resources.listen('unregistered',new EventTarget(),'synthetic',()=>{},{once:true});
   if(mode==='stopped')f.boundaries.stop();
   const after=mode==='stopped'?null:f.boundaryCheck.inspect();
   cases.push({id:mode,checks:{expected_freshness:f.boundaryCheck.matches(before)===(mode==='quiet'),detached_not_lost:mode!=='detached_dirty'||after!.buffers.dirty_detached===1&&after!.blockers.includes('DETACHED_EDITED_BUFFER'),unreadable_not_quiet:mode!=='unknown_read'||after!.blockers.includes('UNREADABLE_DOM_BUFFER'),resource_unknown_not_quiet:mode!=='resource_unknown'||after!.blockers.includes('RESOURCE_LIFETIME_UNKNOWN'),no_financial_write:before.financial_writes===0,no_authority:!before.switch_enabled&&!before.import_authority&&!before.confirmation_authority,no_full_claim:!before.full_freshness_verified&&!before.all_dom_buffers_covered,original_financial_value:f.target.active===false}});
  }finally{f.close();}
 }
 return{scope:'READ_ONLY_WORKBENCH_BOUNDARIES',cases,financial_writes:0,switch_enabled:false};
}
