/** Shared fresh Node/browser probe. Raw synthetic wires stay private to the driver. */
import {FeeRecoveryFormat,FEE_RECOVERY_LIMITS} from './fee-recovery-format';
import {FeeRecoveryWorkspace} from './fee-recovery-workspace';
import {feeRecoveryFixture,FEE_RECOVERY_CASE_DATE as captured_at} from './fee-recovery-cases';
const signal=()=>new AbortController().signal;
const deferred=<T,>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return{promise,resolve};};
export async function probeFeeRecoveryFormat(){
 const cases:{id:string;checks:Record<string,boolean>}[]=[],wires:{id:string;wire:string}[]=[],record=(id:string,checks:Record<string,boolean>)=>cases.push({id,checks});
 let plain='',gzip='';
 for(const compression of['NONE','GZIP'] as const){const f=feeRecoveryFixture();f.supplement.extensions={raw:'\ufeff 中😀\r\n"\\'.repeat(180),negative_zero:-0,history:'UNKNOWN_IMPORTED'};
  const format=new FeeRecoveryFormat(),wire=await format.encode(f.parts,f.supplement,signal(),{compression,captured_at}),data=await format.decode(wire,signal());wires.push({id:compression,wire});if(compression==='NONE')plain=wire;else gzip=wire;
  record('roundtrip-'+compression,{raw_exact:data.supplement.extensions.raw===f.supplement.extensions.raw,negative_zero_kept:Object.is(data.supplement.extensions.negative_zero,-0),history_unknown_kept:data.supplement.extensions.history==='UNKNOWN_IMPORTED',frozen:Object.isFrozen(data.supplement.extensions),no_authority:!data.import_authority&&!data.confirmation_authority&&!data.runtime_installed&&data.financial_writes===0});
 }
 for(const mutation of['version','authority','source_digest','supplement_digest']){const d=JSON.parse(plain);if(mutation==='version')d.version='1.0';if(mutation==='authority')d.import_authority=true;if(mutation==='source_digest')d.source_sha256='0'.repeat(64);if(mutation==='supplement_digest')d.supplement_json+=' ';
  let refused=false;try{await new FeeRecoveryFormat().decode(JSON.stringify(d),signal());}catch{refused=true;}record('corrupt-'+mutation,{refused});
 }
 for(const mutation of['checksum','truncated','trailing','members']){const d=JSON.parse(gzip),binary=atob(d.data),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));let raw:string;
  if(mutation==='checksum'){bytes[bytes.length-8]=bytes[bytes.length-8]!^1;raw=String.fromCharCode(...bytes);}else if(mutation==='truncated')raw=binary.slice(0,-3);else raw=binary+(mutation==='members'?binary:'\0');d.data=btoa(raw);
  let refused=false;try{await new FeeRecoveryFormat().decode(JSON.stringify(d),signal());}catch{refused=true;}record('gzip-'+mutation,{refused});
 }
 {
  const store=new FeeRecoveryWorkspace(),s=await store.stage(plain);let copied=false,twice=false,failed=false;
  try{store.confirm(JSON.parse(JSON.stringify(s)),'REPLACE_QUARANTINE_DATA');}catch{copied=true;}
  const data=store.confirm(s,'REPLACE_QUARANTINE_DATA');try{store.confirm(s,'REPLACE_QUARANTINE_DATA');}catch{twice=true;}try{await store.stage('BROKEN {');}catch{failed=true;}
  record('private-replacement-and-failure-preservation',{copy_refused:copied,consumed_once:twice,failure_refused:failed,old_owner_kept:store.current()===data,reads_not_revived:data.active_reads===0,patches_not_replayed:data.pending_patch_replays===0,customer_confirmation_not_revived:data.customer_reviewed===false,no_runtime_install:data.runtime_installed===false});
 }
 for(const kind of['bad-input','file-selection']){const f=feeRecoveryFixture(),control={tag:'INPUT',id:'synthetic',type:kind==='bad-input'?'number':'file',value:'',dataset:{},connected:true};
  (f.parts.retained_root as Record<string,unknown>).pending_control=control;f.parts.capture_shell.editors.pending_input=JSON.stringify({pending_calculation:false,control});f.supplement.pending_present=true;
  f.supplement.pending_control={...control,checked:null,selection_start:null,selection_end:null,selected_values:null,bad_input:kind==='bad-input',validation_message:'',files:kind==='file-selection'?[{name:'unread.json',size:15,type:'application/json',last_modified:1}]:null};
  const format=new FeeRecoveryFormat(),raw=await format.encode(f.parts,f.supplement,signal(),{captured_at}),store=new FeeRecoveryWorkspace(),s=await store.stage(raw),d=store.confirm(s,'REPLACE_QUARANTINE_DATA');
  record('unavailable-browser-data-'+kind,{reentry_required:d.browser_input_requires_reentry,input_review_required:d.requires_input_review,no_restarted_io:d.active_reads===0,data_kept:JSON.stringify(d.archive.supplement.pending_control)===JSON.stringify(f.supplement.pending_control)});
 }
 for(const action of['cancel','ABA']){const decoded=await new FeeRecoveryFormat().decode(plain,signal()),gate=deferred<typeof decoded>(),store=new FeeRecoveryWorkspace({decode:()=>gate.promise}),pending=store.stage('HELD').then(()=>'',e=>Object.getOwnPropertyDescriptor(e,'message')?.value);
  if(action==='cancel'){store.cancel();const result=await pending;gate.resolve(decoded);record('async-'+action,{prompt_rejection:result==='FEE_RECOVERY_WORKSPACE_CANCELLED',no_install:store.current()===null});}
  else{store.invalidate();store.invalidate();gate.resolve(decoded);record('async-'+action,{stale_refused:await pending==='FEE_RECOVERY_WORKSPACE_STALE',no_install:store.current()===null});}
 }
 {
  const block=new Uint8Array(1024*1024).fill(120);let at=0;
  const stream=new ReadableStream<Uint8Array<ArrayBuffer>>({pull(c){if(at<256){c.enqueue(block);at++;}else if(at++===256)c.enqueue(new Uint8Array([120]));else c.close();}}).pipeThrough(new CompressionStream('gzip'));
  const compressed=new Uint8Array(await new Response(stream).arrayBuffer());let binary='';for(let i=0;i<compressed.length;i+=32768)binary+=String.fromCharCode(...compressed.subarray(i,i+32768));
  const raw=JSON.stringify({kind:'INTERNAL_FEE_WORKBENCH_RECOVERY_ARCHIVE',version:'0.1',encoding:'GZIP_BASE64_UTF8',raw_bytes:FEE_RECOVERY_LIMITS.raw_bytes,sha256:'0'.repeat(64),data:btoa(binary),financial_writes:0,import_authority:false,confirmation_authority:false});
  let code='';try{await new FeeRecoveryFormat().decode(raw,signal());}catch(e){code=Object.getOwnPropertyDescriptor(e,'code')?.value??'UNKNOWN';}record('actual-256MiB-plus-one-expansion',{refused_at_expansion_limit:code==='EXPANSION_LIMIT'});
 }
 return{kind:'SYNTHETIC_FEE_RECOVERY_CONTROLLED_PROBE' as const,version:'0.1' as const,cases,wires,limits:FEE_RECOVERY_LIMITS,financial_writes:0 as const,runtime_installed:false as const,full_live_workbench_reopen_implemented:false as const};
}
