import{OnboardingPreferencePort}from'./fee-onboarding-preference';
export function probeOnboardingPreferences(){
 const cases:{id:string;checks:Record<string,boolean>}[]=[];const refused=(f:()=>unknown)=>{try{f();return false;}catch{return true;}};
 {const a=new OnboardingPreferencePort(),b=new OnboardingPreferencePort('hidden');a.write('show');cases.push({id:'independent',checks:{default_unknown:b.read()==='hidden'&&new OnboardingPreferencePort().read()===null,independent:a.read()==='show'}});}
 {const a=new OnboardingPreferencePort();a.write('hidden');a.write('show');cases.push({id:'bounded_values',checks:{value:a.read()==='show',writes:a.inspect().successful_writes===2,invalid_refused:refused(()=>a.write('other' as 'show'))}});}
 {const a=new OnboardingPreferencePort('hidden');a.failNextRead();a.failNextWrite();cases.push({id:'failure_keeps_value',checks:{read_refused:refused(()=>a.read()),write_refused:refused(()=>a.write('show')),original_kept:a.read()==='hidden',no_success:a.inspect().successful_writes===0}});}
 {let active=true;const a=new OnboardingPreferencePort('show',()=>active);active=false;cases.push({id:'closed_root',checks:{read_refused:refused(()=>a.read()),write_refused:refused(()=>a.write('hidden')),value_kept:a.inspect().value==='show'}});}
 {const a=new OnboardingPreferencePort('hidden');a.seal();a.seal();cases.push({id:'sealed',checks:{read_refused:refused(()=>a.read()),write_refused:refused(()=>a.write('show')),value_kept:a.inspect().value==='hidden',sealed:a.inspect().sealed}});}
 {let a:OnboardingPreferencePort;a=new OnboardingPreferencePort('show',()=>{a.seal();return true;});cases.push({id:'reentrant_guard',checks:{write_refused:refused(()=>a.write('hidden')),value_kept:a.inspect().value==='show'}});}
 return{cases,browser_storage_calls:0,financial_writes:0,source_save_state_written:false,original_preference_inherited:false};
}
