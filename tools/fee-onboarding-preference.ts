/** Ephemeral presentation preference. No browser storage, keys or business data. */
export type OnboardingPreference='hidden'|'show'|null;
export class OnboardingPreferencePort{
 private value:OnboardingPreference;private sealed=false;private readFailure=false;private writeFailure=false;private checking=false;
 private reads=0;private writes=0;private successfulWrites=0;
 constructor(initial:OnboardingPreference=null,private readonly canUse:()=>boolean=()=>true){
  if(initial!==null&&initial!=='hidden'&&initial!=='show'||typeof canUse!=='function')throw Error('ONBOARDING_PREFERENCE_INITIAL');
  this.value=initial;
 }
 private usable(){
  if(this.sealed)throw Error('ONBOARDING_PREFERENCE_SEALED');
  if(this.checking)throw Error('ONBOARDING_PREFERENCE_REENTRANT');
  let allowed=false;this.checking=true;try{allowed=this.canUse()===true;}catch{}finally{this.checking=false;}
  if(!allowed||this.sealed)throw Error('ONBOARDING_PREFERENCE_UNAVAILABLE');
 }
 read():OnboardingPreference{
  this.usable();this.reads++;
  if(this.readFailure){this.readFailure=false;throw Error('ONBOARDING_PREFERENCE_READ_FAILURE');}
  return this.value;
 }
 write(value:'hidden'|'show'){
  if(value!=='hidden'&&value!=='show')throw Error('ONBOARDING_PREFERENCE_VALUE');
  this.usable();this.writes++;
  if(this.writeFailure){this.writeFailure=false;throw Error('ONBOARDING_PREFERENCE_WRITE_FAILURE');}
  this.value=value;this.successfulWrites++;
 }
 failNextRead(){this.usable();this.readFailure=true;}
 failNextWrite(){this.usable();this.writeFailure=true;}
 seal(){this.sealed=true;this.readFailure=false;this.writeFailure=false;}
 inspect(){return Object.freeze({value:this.value,sealed:this.sealed,reads:this.reads,writes:this.writes,successful_writes:this.successfulWrites,browser_storage_calls:0,browser_persistence:false,source_save_state_written:false});}
}
