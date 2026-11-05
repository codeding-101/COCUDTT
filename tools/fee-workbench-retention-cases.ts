import{BoundedWorkbenchBufferLedger,type RetentionLimits,type CommittedBufferWitness}from'./fee-workbench-retention';import type{BufferSample}from'./fee-workbench-dom-buffers';
export const retentionSample=(value='A'):BufferSample=>({value,flags:[],files:[],badInput:false});
export function retentionFixture(limits:Partial<RetentionLimits>={}){
 const model=new Map<object,CommittedBufferWitness>(),issued=new WeakMap<object,number>();let revision=0;
 const proof={checkpoint(){const t=Object.freeze({});issued.set(t,revision);return t;},isCurrent(t:object){return issued.get(t)===revision;},read(key:object){return model.get(key)??null;}};
 const ledger=new BoundedWorkbenchBufferLedger(proof,limits),key={};
 return{ledger,key,model,proof,change:()=>{revision++;},known(key:object,value='A',binding='quantity'){model.set(key,{binding,sample:retentionSample(value)});},attachKnown(value='A'){model.set(key,{binding:'quantity',sample:retentionSample(value)});ledger.update(key,retentionSample(value),true);},detach(value='A'){ledger.update(key,retentionSample(value),false);}};
}
export function probeWorkbenchRetention(){const cases=[];for(const mode of['unknown','retired','changed_restored','file','control_limit','text_limit','owner_aba','copied_token']as const){const f=retentionFixture(mode==='control_limit'?{controls:1}:mode==='text_limit'?{text_bytes:3}:{});let retired=false,rejected=false;try{
 if(mode==='unknown')f.ledger.update(f.key,retentionSample(),false);else if(mode==='file')f.ledger.update(f.key,{...retentionSample(),files:[{}]},false);else{f.attachKnown();f.detach();}
 if(mode==='changed_restored'){f.ledger.update(f.key,retentionSample('B'),false);f.detach();}
 if(mode==='control_limit')f.ledger.update({},retentionSample(),true);
 if(mode==='text_limit')f.ledger.update(f.key,retentionSample('BBBB'),false);
 try{const t=f.ledger.prepareRetirement();if(mode==='owner_aba'){f.change();f.change();}f.ledger.acknowledge(mode==='copied_token'?{...t}:t,true);f.ledger.retire(t);retired=true;}catch{rejected=true;}
 const s=f.ledger.snapshot();cases.push({id:mode,checks:{expected_retirement:retired===(mode==='retired'),expected_rejection:rejected===(mode!=='retired'),protected_not_deleted:mode==='retired'||s.controls===1,budget_respected:s.retained.controls<=s.limits.controls&&s.retained.text_bytes<=s.limits.text_bytes&&s.retained.flags<=s.limits.flags&&s.retained.file_refs<=s.limits.file_refs,overflow_invalid:!mode.endsWith('limit')||s.coverage_lost&&!s.observing&&!f.ledger.isCurrent(s.epoch),no_source_write:s.financial_writes===0,no_switch:!s.switch_enabled,no_full_dom_claim:!s.all_dom_buffers_covered,no_heap_claim:!s.heap_or_dom_memory_limit&&!s.peak_memory_measured}});
 }finally{f.ledger.stop();}}return{scope:'BOUNDED_ROOT_INPUT_EVIDENCE',cases,financial_writes:0,switch_enabled:false};}
