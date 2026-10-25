import {describe,it,expect,vi,afterEach} from 'vitest';
import {FeeRecoveryFormat,type FeeRecoveryData} from '../tools/fee-recovery-format';
import {FeeRecoveryWorkspace} from '../tools/fee-recovery-workspace';
import {feeRecoveryFixture as fixture,FEE_RECOVERY_CASE_DATE as captured_at} from '../tools/fee-recovery-cases';
import {transactionFixture} from './fixtures/fee-transaction';
import {runtimeCandidateFixture} from './fixtures/runtime-candidate';
import {previewRuntimeFeeWorkbench} from '../src/ui/fee-workbench-preview';
import {parseProject,toTrade,toScenario} from '../src/data/project-file';
import {analyze} from '../src/engine/analyze';
import {scenarioWithDerivedInclusions} from '../src/engine/compare';
const signal=()=>new AbortController().signal;
const deferred=<T,>()=>{let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
async function archive(){const f=fixture();return new FeeRecoveryFormat().encode(f.parts,f.supplement,signal(),{captured_at});}
afterEach(()=>vi.unstubAllGlobals());
describe('independent restoration stages frozen data, then replaces only its quarantine owner',()=>{
  it('requires an explicit choice, stages without replacement, consumes private authority once',async()=>{
    const store=new FeeRecoveryWorkspace(),raw=await archive(),s=await store.stage(raw);expect(store.current()).toBeNull();expect(store.status()).toBe('READY');
    expect(()=>store.confirm(s,'AUTOMATIC' as never)).toThrow('CHOICE_REQUIRED');const current=store.confirm(s,'REPLACE_QUARANTINE_DATA');
    expect(store.current()).toBe(current);expect(store.status()).toBe('OPEN');expect(current).toMatchObject({fresh_owner:true,active_reads:0,pending_patch_replays:0,financial_writes:0,runtime_installed:false,customer_reviewed:false,source_storage_written:false,physical_disk_verified:false});
    expect(store.ownerStatus()).toMatchObject({participants:['recovered-data'],revision:1,fields:1,fee_application_entry:false});expect(()=>store.confirm(s,'REPLACE_QUARANTINE_DATA')).toThrow('CONSUMED');
  });
  it.each(['json','spread','clone','other-store'] as const)('refuses %s as an issued replacement',async kind=>{
    const raw=await archive(),store=new FeeRecoveryWorkspace(),s=await store.stage(raw),foreign=kind==='json'?JSON.parse(JSON.stringify(s)):kind==='spread'?{...s}:kind==='clone'?structuredClone(s):await new FeeRecoveryWorkspace().stage(raw);
    expect(()=>store.confirm(foreign,'REPLACE_QUARANTINE_DATA')).toThrow('FOREIGN');expect(store.current()).toBeNull();
  });
  it('keeps the entire previous data owner on every decode failure',async()=>{
    const store=new FeeRecoveryWorkspace(),s=await store.stage(await archive()),old=store.confirm(s,'REPLACE_QUARANTINE_DATA'),status=store.ownerStatus();
    for(const raw of ['broken {','null','{"kind":"INTERNAL_RECOVERY_SNAPSHOT","version":"1.0"}',JSON.stringify(old),'{"kind":"INTERNAL_RUNTIME_FEE_APPLICATION_BACKUP","version":"0.1","pending_patches":[{"apply":true}]}']){await expect(store.stage(raw)).rejects.toThrow('DECODE_FAILED');expect(store.current()).toBe(old);expect(store.ownerStatus()).toEqual(status);}
  });
  it('retains historical active flags and customer approval only inside the archive',async()=>{
    const f=fixture(),r=f.parts.retained_root as Record<string,unknown>;r.project_read_epoch=4;r.project_read_token=4;r.customer_reviewed=true;(r.bill as Record<string,unknown>).reading=true;
    f.parts.capture_shell.activity.project_read=true;f.parts.capture_shell.activity.bill_read=true;f.supplement.envelope_ui.workbench_busy=true;f.supplement.envelope_ui.workbench_confirmation={token:'OLD_PRIVATE_STRING',acknowledged:true};
    const raw=await new FeeRecoveryFormat().encode(f.parts,f.supplement,signal(),{captured_at}),store=new FeeRecoveryWorkspace(),s=await store.stage(raw),data=store.confirm(s,'REPLACE_QUARANTINE_DATA');
    expect(data).toMatchObject({active_reads:0,customer_reviewed:false,pending_patch_replays:0});expect(data.archive.restoration.retained_root).toMatchObject({project_read_token:4,customer_reviewed:true});expect(data.archive.supplement.envelope_ui.workbench_confirmation).toEqual(f.supplement.envelope_ui.workbench_confirmation);expect(Object.isFrozen(data.archive.restoration.capture.files.project)).toBe(true);
  });
  it.each(['cancel','signal','dispose','replace'] as const)('%s rejects promptly before an unresolved decoder returns',async action=>{
    const data=await new FeeRecoveryFormat().decode(await archive(),signal()),gate=deferred<FeeRecoveryData>(),external=new AbortController();let calls=0;
    const store=new FeeRecoveryWorkspace({decode:()=>++calls===1?gate.promise:Promise.resolve(data)}),old=store.stage('SYNTHETIC',external.signal).catch(e=>e.message);
    let latest;if(action==='cancel')store.cancel();else if(action==='signal')external.abort({get message(){throw Error('PRIVATE');}});else if(action==='dispose')store.dispose();else latest=await store.stage('NEW');
    expect(await old).toContain(action==='dispose'?'CLOSED':'CANCELLED');expect(store.current()).toBeNull();gate.resolve(data);await Promise.resolve();await Promise.resolve();
    if(latest)expect(store.confirm(latest,'REPLACE_QUARANTINE_DATA').archive).toBe(data);else expect(store.status()).toBe(action==='dispose'?'CLOSED':'EMPTY');
  });
  it('keeps old data after owner invalidation, including an edit followed by reversal',async()=>{
    const store=new FeeRecoveryWorkspace(),first=await store.stage(await archive()),old=store.confirm(first,'REPLACE_QUARANTINE_DATA'),next=await store.stage(await archive());
    store.invalidate();store.invalidate();expect(()=>store.confirm(next,'REPLACE_QUARANTINE_DATA')).toThrow('STALE');expect(store.current()).toBe(old);store.cancel();expect(store.status()).toBe('OPEN');
  });
  it('checks invalidation after async decode and ignores late decoder rejection',async()=>{
    const data=await new FeeRecoveryFormat().decode(await archive(),signal()),gate=deferred<FeeRecoveryData>(),store=new FeeRecoveryWorkspace({decode:()=>gate.promise});
    const result=store.stage('OLD').catch(e=>e.message);store.invalidate();gate.resolve(data);expect(await result).toContain('STALE');expect(store.current()).toBeNull();
    const rejected=deferred<FeeRecoveryData>(),late=new FeeRecoveryWorkspace({decode:()=>rejected.promise}),observed=late.stage('OLD').catch(e=>e.message);late.cancel();expect(await observed).toContain('CANCELLED');rejected.reject({private:'DO_NOT_LEAK'});await Promise.resolve();expect(late.current()).toBeNull();
  });
  it('keeps the newest request when a trusted cancellation listener reenters',async()=>{
    const data=await new FeeRecoveryFormat().decode(await archive(),signal()),gate=deferred<FeeRecoveryData>();let calls=0,newest!:ReturnType<FeeRecoveryWorkspace['stage']>;
    const store=new FeeRecoveryWorkspace({decode:(_raw,s)=>{if(++calls===1){s.addEventListener('abort',()=>{newest=store.stage('NEWEST');});return gate.promise;}return Promise.resolve(data);}});
    const old=store.stage('OLD').catch(e=>e.message),middle=store.stage('MIDDLE').catch(e=>e.message);expect(await old).toContain('CANCELLED');expect(await middle).toContain('CANCELLED');const issued=await newest;gate.resolve(data);expect(store.confirm(issued,'REPLACE_QUARANTINE_DATA').archive).toBe(data);
  });
  it('rejects unverified metadata without invoking accessors and redacts decoder errors',async()=>{
    const valid=await new FeeRecoveryFormat().decode(await archive(),signal());let reads=0;const bad={...valid};Object.defineProperty(bad,'import_authority',{enumerable:true,get(){reads++;return true;}});Object.freeze(bad);
    const store=new FeeRecoveryWorkspace({decode:async()=>bad});await expect(store.stage('RAW')).rejects.toThrow('DECODE_FAILED');expect(reads).toBe(0);
    const error={get message(){reads++;return 'PRIVATE';}},failed=new FeeRecoveryWorkspace({decode:async()=>{throw error;}});await expect(failed.stage('RAW')).rejects.toThrow('DECODE_FAILED');expect(reads).toBe(0);
  });
  it('rechecks the real owner after a metadata descriptor trap',async()=>{
    const valid=await new FeeRecoveryFormat().decode(await archive(),signal());let store!:FeeRecoveryWorkspace,touched=false;
    const proxy=new Proxy(valid,{ownKeys(target){if(!touched){touched=true;store.invalidate();}return Reflect.ownKeys(target);}});store=new FeeRecoveryWorkspace({decode:async()=>proxy});
    await expect(store.stage('RAW')).rejects.toThrow('STALE');expect(store.current()).toBeNull();
  });
  it('pre-abort never starts decoding, late abort invalidates a ready summary and closing prevents future work',async()=>{
    const format=new FeeRecoveryFormat(),decode=vi.spyOn(format,'decode'),store=new FeeRecoveryWorkspace(format),controller=new AbortController();controller.abort();await expect(store.stage('RAW',controller.signal)).rejects.toThrow('CANCELLED');expect(decode).not.toHaveBeenCalled();
    const next=new AbortController(),s=await store.stage(await archive(),next.signal);next.abort();expect(()=>store.confirm(s,'REPLACE_QUARANTINE_DATA')).toThrow('CANCELLED');store.dispose();await expect(store.stage('RAW')).rejects.toThrow('CLOSED');
  });
  it.each(['bad-input','file-selection'] as const)('keeps %s unavailable data explicit and requires reentry',async kind=>{
    const f=fixture(),control={tag:'INPUT',id:'synthetic',type:kind==='bad-input'?'number':'file',value:'',dataset:{},connected:true};
    (f.parts.retained_root as Record<string,unknown>).pending_control=control;f.parts.capture_shell.editors.pending_input=JSON.stringify({pending_calculation:false,control});
    f.supplement.pending_present=true;f.supplement.pending_control={...control,checked:null,selection_start:null,selection_end:null,selected_values:null,bad_input:kind==='bad-input',validation_message:kind==='bad-input'?'SYNTHETIC_BAD_INPUT':'',files:kind==='file-selection'?[{name:'unread.json',size:15,type:'application/json',last_modified:1}]:null};
    const format=new FeeRecoveryFormat(),raw=await format.encode(f.parts,f.supplement,signal(),{captured_at}),store=new FeeRecoveryWorkspace(format),staged=await store.stage(raw),data=store.confirm(staged,'REPLACE_QUARANTINE_DATA');
    expect(staged.browser_input_requires_reentry).toBe(true);expect(data).toMatchObject({requires_input_review:true,browser_input_requires_reentry:true,active_reads:0,runtime_installed:false});expect(data.archive.supplement.pending_control).toStrictEqual(f.supplement.pending_control);
  });
  it('recomputes the current valid project with the actual engine while old candidates and applied receipts remain inert',async()=>{
    const transaction=await transactionFixture(),f=await runtimeCandidateFixture(transaction.raw),preview=await previewRuntimeFeeWorkbench(f.capture(),'recovery98'),summary=await f.preparer.prepare(preview),candidateBackup=f.preparer.backup(summary),record=await f.preparer.apply(summary,()=>true);
    const capture=f.capture(),{retained_json:_,...capture_shell}=capture,base=fixture(),r=base.parts.retained_root as Record<string,unknown>;
    Object.assign(r,{project_raw:structuredClone(f.app.project),project_file:{name:null,saved_at:null,dirty:f.app.dirty,saved_raw_known:false},bill:f.bill.workbenchCapture(),pair:f.pair.workbenchCapture(),tax:f.taxUi.controller.workbenchCapture(),precision:f.precisionUi.controller.workbenchCapture(),envelope:f.envelopeUi.controller.workbenchCapture(),tax_workspace:f.taxUi.workbenchCapture(),precision_workspace:f.precisionUi.workbenchCapture(),envelope_workspace:f.envelopeUi.workbenchCapture(),customer_fields:f.workflow.customerFields,customer_reviewed:f.workflow.customerReviewed});
    base.parts.capture_shell=capture_shell;base.supplement.workflow.state_initialized=true;base.supplement.envelope_ui.workbench_application=record;base.supplement.envelope_ui.workbench_candidate={summary,backup_json:candidateBackup};
    const fees=f.app.project.items.length,currentRaw=f.envelopeUi.controller.state().current!.raw_json,ledger=JSON.parse(JSON.parse(currentRaw).ledger_json),before=JSON.stringify(f.capture()),apply=vi.spyOn(f.preparer,'apply');
    const format=new FeeRecoveryFormat(),raw=await format.encode(base.parts,base.supplement,signal(),{captured_at}),store=new FeeRecoveryWorkspace(format),staged=await store.stage(raw),d=store.confirm(staged,'REPLACE_QUARANTINE_DATA');
    const project=parseProject(capture.sources.project_json!),trade=toTrade(project),scenario=scenarioWithDerivedInclusions(toScenario(project),trade),expected=analyze({trade,scenario,taxProfile:project.tax_profile,fxBooks:project.fx_books,...(project.export_date?{today:project.export_date}:{})});
    expect(d.calculation).toMatchObject({status:'CALCULATED_FOR_REVIEW',seller_profit:expected.seller.margin?.toString()??null,buyer_total:expected.buyer.landed_cost_with_tax.toString(),cost_count:fees,business_approval:false});
    expect(JSON.parse(JSON.parse(d.archive.restoration.capture.envelope_json!).ledger_json)).toEqual(ledger);expect(ledger.receipt_refs).toHaveLength(1);expect(d.archive.supplement.envelope_ui.workbench_application).toStrictEqual(record);expect(apply).not.toHaveBeenCalled();expect(JSON.stringify(f.capture())).toBe(before);expect(f.setItem).not.toHaveBeenCalled();expect(f.write).not.toHaveBeenCalled();
    const again=await store.stage(raw);store.confirm(again,'REPLACE_QUARANTINE_DATA');expect(f.app.project.items).toHaveLength(fees);expect(JSON.parse(JSON.parse(f.envelopeUi.controller.state().current!.raw_json).ledger_json).receipt_refs).toHaveLength(1);
  },60000);
});
