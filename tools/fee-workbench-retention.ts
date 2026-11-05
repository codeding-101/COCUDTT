/** Bounded diagnostic evidence. A retirement removes a proven duplicate, never a saved/dirty declaration. */
import type {BufferSample} from './fee-workbench-dom-buffers';
import {feeBrowserNativeUtf8Bytes} from './fee-browser-native-codec';

export const RETENTION_LIMITS=Object.freeze({controls:4096,text_bytes:8*1024*1024,flags:65536,file_refs:128});
export interface RetentionLimits {readonly controls:number;readonly text_bytes:number;readonly flags:number;readonly file_refs:number}
export interface CommittedBufferWitness {readonly binding:string;readonly sample:BufferSample}
/** Trusted live model reader. Never populated from a project file or a serialized acknowledgement. */
export interface RetentionProofOwner {checkpoint():object;isCurrent(token:object):boolean;read(key:object):CommittedBufferWitness|null}
export class BufferRetentionError extends Error {constructor(readonly code:string){super('WORKBENCH_RETENTION_'+code);}}
function fail(code:string):never{throw new BufferRetentionError(code);}
const equal=(a:BufferSample,b:BufferSample)=>a.value===b.value&&a.badInput===b.badInput&&a.flags.length===b.flags.length&&a.flags.every((v,i)=>v===b.flags[i])&&a.files.length===b.files.length&&a.files.every((v,i)=>v===b.files[i]);
const zero=()=>({controls:0,text_bytes:0,flags:0,file_refs:0});
interface Stored {sample:BufferSample;bytes:number}
interface RecordEntry {baseline:Stored|null;last:Stored|null;connected:boolean;dirty:boolean;tainted:boolean;unreadable:boolean;initial_verified:boolean;binding:string|null}
export interface BufferRetirementChoice {readonly scope:'RETIRE_PROVEN_DETACHED_DUPLICATES';readonly controls:number;readonly text_bytes:number;readonly source_save_state_written:false;readonly switch_enabled:false}
interface Pending {token:BufferRetirementChoice;epoch:number;owner:object;records:readonly[object,RecordEntry][];acknowledged:boolean}

export class BoundedWorkbenchBufferLedger {
  private closed=false;private blocked:string|null=null;private epoch=0;private events=0;private mutations=0;private retired=0;
  private usage=zero();private readonly records=new Map<object,RecordEntry>();private pending:Pending|null=null;
  readonly limits:RetentionLimits;
  constructor(private readonly proof:RetentionProofOwner,limits:Partial<RetentionLimits>={}){
    const keys=Object.keys(RETENTION_LIMITS)as (keyof RetentionLimits)[];
    if(Object.keys(limits).some(k=>!keys.includes(k as keyof RetentionLimits)))fail('LIMITS');
    const checked={...RETENTION_LIMITS,...limits};for(const key of keys)if(!Number.isSafeInteger(checked[key])||checked[key]<(key==='controls'?1:0)||checked[key]>RETENTION_LIMITS[key])fail('LIMITS');
    this.limits=Object.freeze(checked);
  }
  private advance(){this.pending=null;if(this.epoch<Number.MAX_SAFE_INTEGER)this.epoch++;else this.blocked='EPOCH_LIMIT';}
  trip(reason:string){if(!this.closed&&!this.blocked){this.blocked=reason;this.advance();}return this.snapshot();}
  private witness(key:object):CommittedBufferWitness|null{
    try{const w=this.proof.read(key),s=w?.sample;if(!w||typeof w.binding!=='string'||!w.binding||w.binding.length>100||!s||typeof s.value!=='string'||typeof s.badInput!=='boolean'||!Array.isArray(s.flags)||!Array.isArray(s.files)||s.flags.length>this.limits.flags||s.files.length>this.limits.file_refs||s.flags.some(v=>typeof v!=='boolean')||s.files.some(v=>!v||typeof v!=='object'))return null;return w;}catch{return null;}
  }
  private size(r:RecordEntry){const samples=r.baseline===r.last?[r.baseline]:[r.baseline,r.last],s=zero();s.controls=1;for(const v of samples)if(v){s.text_bytes+=v.bytes;s.flags+=v.sample.flags.length;s.file_refs+=v.sample.files.length;}return s;}
  private sample(value:BufferSample):Stored|null{
    if(typeof value.value!=='string'||!Array.isArray(value.flags)||!Array.isArray(value.files)||typeof value.badInput!=='boolean')fail('SAMPLE');
    if(value.value.length>this.limits.text_bytes){this.trip('TEXT_LIMIT');return null;}
    if(value.flags.length>this.limits.flags){this.trip('FLAG_LIMIT');return null;}
    if(value.files.length>this.limits.file_refs){this.trip('FILE_LIMIT');return null;}
    const bytes=feeBrowserNativeUtf8Bytes(value.value);if(bytes>this.limits.text_bytes){this.trip('TEXT_LIMIT');return null;}
    if(value.flags.some(v=>typeof v!=='boolean')||value.files.some(v=>!v||typeof v!=='object'))fail('SAMPLE');
    return{sample:value,bytes};
  }
  update(key:object,value:BufferSample|null,connected:boolean){
    if(this.closed||this.blocked)return;if(!key||typeof key!=='object'||typeof connected!=='boolean')fail('SAMPLE');
    const old=this.records.get(key),initialEpoch=this.epoch;if(!old&&this.records.size===this.limits.controls){this.trip('CONTROL_LIMIT');return;}
    const sampled=value?this.sample(value):null;if(this.blocked)return;
    const same=!!old?.last&&!!sampled&&equal(old.last.sample,sampled.sample),baselineSame=!!old?.baseline&&!!sampled&&equal(old.baseline.sample,sampled.sample);
    if(old&&same&&old.connected===connected&&old.unreadable===(value===null))return;
    let initial_verified=false,binding:string|null=null;
    if(!old&&sampled&&!sampled.sample.badInput&&!sampled.sample.files.length){
      try{const checkpoint=this.proof.checkpoint(),w=this.witness(key);initial_verified=!!w&&equal(w.sample,sampled.sample)&&this.proof.isCurrent(checkpoint);if(initial_verified)binding=w!.binding;}catch{/* Unavailable source proof keeps initial evidence unknown. */}
    }
    if(this.closed||this.blocked)return;
    if(initialEpoch!==this.epoch||this.records.get(key)!==old){this.trip('REENTRANT_UPDATE');return;}
    const copy=(s:Stored):Stored=>({bytes:s.bytes,sample:Object.freeze({value:s.sample.value,flags:Object.freeze([...s.sample.flags]),files:Object.freeze([...s.sample.files]),badInput:s.sample.badInput})});
    // Count first, copy only after the entire proposed replacement fits.
    const last=sampled?(baselineSame?old!.baseline:same?old!.last:sampled):null;
    const next:RecordEntry={baseline:old?old.baseline:last,last,connected,dirty:sampled?!!old&&!baselineSame||sampled.sample.badInput||sampled.sample.files.length>0:old?.dirty??false,tainted:old?old.tainted||!same:!initial_verified||value===null||!!sampled?.sample.badInput||!!sampled?.sample.files.length,unreadable:value===null,initial_verified:old?.initial_verified??initial_verified,binding:old?.binding??binding};
    const before=old?this.size(old):zero(),after=this.size(next),proposed=zero();for(const k of Object.keys(proposed)as(keyof RetentionLimits)[])proposed[k]=this.usage[k]-before[k]+after[k];
    for(const[k,reason]of [['controls','CONTROL_LIMIT'],['text_bytes','TEXT_LIMIT'],['flags','FLAG_LIMIT'],['file_refs','FILE_LIMIT']]as const)if(proposed[k]>this.limits[k]){this.trip(reason);return;}
    if(last===sampled&&sampled){const stored=copy(sampled);next.last=stored;if(!old)next.baseline=stored;}
    this.records.set(key,next);this.usage=proposed;this.advance();
  }
  event(key:object|null){if(this.closed||this.blocked)return;this.events++;const record=key?this.records.get(key):undefined;if(record)record.tainted=true;else for(const r of this.records.values())r.tainted=true;this.advance();}
  structuralMutation(count:number,attributeKeys:readonly object[]=[]){if(this.closed||this.blocked||count<=0)return;this.mutations+=count;for(const key of attributeKeys){const r=this.records.get(key);if(r)r.tainted=true;}this.advance();}
  keys(){return [...this.records.keys()];}
  isObserving(){return !this.closed&&!this.blocked;}
  private eligible(key:object,r:RecordEntry){if(r.connected||r.tainted||r.unreadable||!r.initial_verified||!r.baseline||r.last!==r.baseline||r.last.sample.badInput||r.last.sample.files.length)return false;const w=this.witness(key);return!!w&&w.binding===r.binding&&equal(w.sample,r.last.sample);}
  prepareRetirement():BufferRetirementChoice{
    if(this.closed||this.blocked)fail('OBSERVATION_UNAVAILABLE');this.advance();
    const epoch=this.epoch,owner=this.proof.checkpoint(),records=[...this.records].filter(([key,r])=>this.eligible(key,r));
    const sourceCurrent=this.proof.isCurrent(owner);
    if(this.closed||this.blocked||epoch!==this.epoch||!sourceCurrent)fail('STALE');if(!records.length)fail('NO_ELIGIBLE');
    const token=Object.freeze({scope:'RETIRE_PROVEN_DETACHED_DUPLICATES' as const,controls:records.length,text_bytes:records.reduce((n,[,r])=>n+this.size(r).text_bytes,0),source_save_state_written:false as const,switch_enabled:false as const});this.pending={token,epoch,owner,records,acknowledged:false};return token;
  }
  private localCurrent(p:Pending){return !this.closed&&!this.blocked&&this.pending===p&&p.epoch===this.epoch;}
  private ready(token:BufferRetirementChoice){const p=this.pending;if(!p||p.token!==token||!this.localCurrent(p))fail('FOREIGN_OR_STALE');const sourceCurrent=this.proof.isCurrent(p.owner);if(!sourceCurrent||!this.localCurrent(p))fail('FOREIGN_OR_STALE');return p;}
  acknowledge(token:BufferRetirementChoice,checked:boolean){const p=this.ready(token);if(typeof checked!=='boolean')fail('ACKNOWLEDGEMENT');p.acknowledged=checked;}
  retire(token:BufferRetirementChoice){
    const p=this.ready(token);if(!p.acknowledged)fail('EXPLICIT_REVIEW_REQUIRED');
    for(const[key,r]of p.records)if(this.records.get(key)!==r||!this.eligible(key,r))fail('NO_LONGER_ELIGIBLE');
    const sourceCurrent=this.proof.isCurrent(p.owner);
    if(!sourceCurrent||!this.localCurrent(p))fail('FOREIGN_OR_STALE');
    if(!p.acknowledged)fail('EXPLICIT_REVIEW_REQUIRED');
    for(const[key,r]of p.records){const s=this.size(r);for(const k of Object.keys(s)as(keyof RetentionLimits)[])this.usage[k]-=s[k];this.records.delete(key);}this.retired+=p.records.length;this.advance();
    return Object.freeze({scope:'PROVEN_DETACHED_DUPLICATES_RETIRED',controls:p.records.length,source_save_state_written:false,financial_writes:0,switch_enabled:false});
  }
  cancelRetirement(){if(!this.closed)this.advance();}
  snapshot(){let dirty_attached=0,dirty_detached=0,unreadable=0,file_selected=0,protected_detached=0,initial_unknown=0,pending_current=false;for(const r of this.records.values()){if(r.dirty)r.connected?dirty_attached++:dirty_detached++;if(r.unreadable)unreadable++;if(r.last?.sample.files.length||r.baseline?.sample.files.length)file_selected++;if(!r.initial_verified)initial_unknown++;if(!r.connected&&(r.tainted||!r.initial_verified||r.unreadable))protected_detached++;}
    const p=this.pending;try{pending_current=!!p&&!this.closed&&!this.blocked&&p.epoch===this.epoch&&this.proof.isCurrent(p.owner)&&p===this.pending;}catch{/* Unknown source context never enables a retirement. */}
    return Object.freeze({scope:'BOUNDED_ROOT_INPUT_EVIDENCE',epoch:this.epoch,observing:!this.closed&&!this.blocked,closed:this.closed,blocked_reason:this.blocked,coverage_lost:this.blocked!==null,limits:this.limits,retained:Object.freeze({...this.usage}),controls:this.records.size,dirty_attached,dirty_detached,protected_detached,initial_unknown,unreadable,file_selected,events:this.events,structural_mutations:this.mutations,retired_duplicates:this.retired,pending_retirement:this.pending?.token??null,pending_current,pending_acknowledged:this.pending?.acknowledged??false,logical_evidence_budget:true,heap_or_dom_memory_limit:false,peak_memory_measured:false,initial_save_evidence_unknown:true,all_dom_buffers_covered:false,script_property_aba_covered:false,closed_shadow_controls_covered:false,financial_writes:0,switch_enabled:false});
  }
  isCurrent(epoch:number){return !this.closed&&!this.blocked&&epoch===this.epoch;}
  stop(){if(!this.closed){this.closed=true;this.records.clear();this.usage=zero();this.advance();}return this.snapshot();}
}
