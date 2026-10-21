// Test-only source appended in memory after the phase88 bridge. Never added to app.ts.
export const feeSourceCompatibilityBridge=String.raw`
import {inspectFeeSourceCompatibility as inspectSource89,feeCompatibilityNodes as nodesSource89} from '../../tools/fee-source-compatibility.ts';
import {FEE_COMPATIBILITY_VALUE_CASES as valueCases89,feeCompatibilityValue as valueSource89,feeCompatibilityCategory as categorySource89} from '../../tools/fee-source-compatibility-cases.ts';
const holders89={bill:containerBill,pair:containerPair,attachment:feeTaxWorkspace.controller,precision:feePrecisionWorkspace.controller,envelope:feeEnvelopeWorkspace.controller,attachment_workspace:feeTaxWorkspace,precision_workspace:feePrecisionWorkspace,envelope_workspace:feeEnvelopeWorkspace};
function scenarioSource89(id){
 const originalSensitivity=workflow.sensitivityControls,originalProject=state.project,restores=[];
 const get=Object.getOwnPropertyDescriptor(Storage.prototype,'getItem'),set=Object.getOwnPropertyDescriptor(Storage.prototype,'setItem'),remove=Object.getOwnPropertyDescriptor(Storage.prototype,'removeItem');
 let reads=0,writes=0,legacy=null,callsAfterLegacy=0,factory={value:null,calls:()=>0},targetNodes=null,predictedFrameNodes=null;
 const baseLegacy=captureCurrentFeeWorkbench(),baseFrame=captureSource88(workbenchState,readers88());
 const baseRetainedNodes=nodesSource89(JSON.parse(baseLegacy.retained_json)),baseFrameNodes=nodesSource89(baseFrame),delta=baseFrameNodes-baseRetainedNodes;
 try{
  if(id.startsWith('nodes_')){
   if(delta<=1)throw Error('Expected measured frame wrapper overhead');
   targetNodes=id==='nodes_frame_at'?300000-delta:id==='nodes_frame_over'?300001-delta:id==='nodes_retained_at'?300000:300001;
   factory={value:Array.from({length:targetNodes-baseRetainedNodes-1},()=>0),calls:()=>0};
   predictedFrameNodes=baseFrameNodes+nodesSource89(factory.value);
   workflow.sensitivityControls={...originalSensitivity,compatibility_extension:factory.value};
  }else if(id.startsWith('holder_')){
   const holder=id.slice(7);factory=valueSource89('plain');
   if(holder==='project')state.project={...originalProject,compatibility_extension:factory.value};
   else{
    const target=holders89[holder];if(!target)throw Error('Unknown holder');
    const descriptor=Object.getOwnPropertyDescriptor(target,'workbenchCapture'),original=target.workbenchCapture;
    Object.defineProperty(target,'workbenchCapture',{configurable:true,value:function(){return {...original.call(this),compatibility_extension:factory.value};}});
    restores.push(()=>{if(descriptor)Object.defineProperty(target,'workbenchCapture',descriptor);else delete target.workbenchCapture;});
   }
  }else if(id!=='baseline'){
   factory=valueSource89(id);workflow.sensitivityControls={...originalSensitivity,compatibility_extension:factory.value};
  }
  workbenchState.touch();const checkpoint=workbenchState.checkpoint(),beforeProject=JSON.stringify(state.project),beforeEnvelope=feeEnvelopeWorkspace.controller.state().current?.raw_json??null,beforeReview=workflow.customerReviewed;
  Object.defineProperty(Storage.prototype,'getItem',{...get,value:function(key){reads++;return get.value.call(this,key);}});
  Object.defineProperty(Storage.prototype,'setItem',{...set,value:function(){writes++;throw Error('COMPATIBILITY_MUST_NOT_WRITE');}});
  Object.defineProperty(Storage.prototype,'removeItem',{...remove,value:function(){writes++;throw Error('COMPATIBILITY_MUST_NOT_REMOVE');}});
  const diagnostic=inspectSource89(workbenchState,()=>{try{legacy=captureCurrentFeeWorkbench();return legacy;}finally{callsAfterLegacy=factory.calls();}},readers88());
  const stable=workbenchState.isCurrent(checkpoint)&&beforeProject===JSON.stringify(state.project)&&beforeEnvelope===(feeEnvelopeWorkspace.controller.state().current?.raw_json??null)&&beforeReview===workflow.customerReviewed;
  if(!stable||writes!==0||reads!==20||factory.calls()!==callsAfterLegacy)throw Error('COMPATIBILITY_OBSERVATION_SIDE_EFFECT '+id);
  const retainedNodes=legacy?nodesSource89(JSON.parse(legacy.retained_json)):null;
  if(targetNodes!==null&&retainedNodes!==targetNodes)throw Error('Controlled node count differs');
  return{id,category:categorySource89(id),...diagnostic,baseline_retained_nodes:baseRetainedNodes,baseline_frame_nodes:baseFrameNodes,requested_retained_nodes:targetNodes,actual_retained_nodes:retainedNodes,predicted_frame_nodes:predictedFrameNodes,
   legacy_accessor_or_tojson_calls:callsAfterLegacy,adapter_accessor_or_tojson_calls:factory.calls()-callsAfterLegacy,storage_reads:reads,storage_writes:writes,project_and_receipts_unchanged:true,customer_review_unchanged:true};
 }finally{
  Object.defineProperty(Storage.prototype,'getItem',get);Object.defineProperty(Storage.prototype,'setItem',set);Object.defineProperty(Storage.prototype,'removeItem',remove);
  for(const restore of restores.reverse())restore();workflow.sensitivityControls=originalSensitivity;state.project=originalProject;workbenchState.touch();
 }
}
Object.defineProperty(window,'__feeSourceCompatibility89',{value:Object.freeze({ids:['baseline',...valueCases89,...['project',...Object.keys(holders89)].map(k=>'holder_'+k),'nodes_frame_at','nodes_frame_over','nodes_retained_at','nodes_retained_over'],scenario:scenarioSource89}),configurable:true});
`;
