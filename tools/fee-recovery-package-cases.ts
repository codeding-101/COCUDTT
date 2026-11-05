/** Portable package checks over the same synthetic source wires in Node and native browsers. */
import {openReconcileCase} from './fee-recovery-reconcile-cases';
import {parseRecoveredPackage} from './fee-recovery-package';
import {RecoveredPackageTransfer,type RecoveredPackageFileSource} from './fee-recovery-package-transfer';
import type {RecoveredHandoffFile} from './fee-recovery-business-files';
export function recoveredPackageSource(file:RecoveredHandoffFile):RecoveredPackageFileSource{const bytes=new TextEncoder().encode(file.text);return{name:file.name,size:bytes.byteLength,arrayBuffer:async()=>bytes.slice().buffer};}
export function recoveredPackageTransfer(b:Awaited<ReturnType<typeof openReconcileCase>>['business'],afterPrepare?:()=>Promise<void>){return new RecoveredPackageTransfer({build:()=>b.handoffPackage(),lease:()=>b.handoffLease(),current:t=>b.isHandoffLeaseCurrent(t)},afterPrepare);}
export async function synchronizePackageCase(f:Awaited<ReturnType<typeof openReconcileCase>>,name:string){f.trade.edit('name',name);f.trade.commit();const c=await f.manager.stage(['project_json']);f.manager.acknowledge(c,true);await f.manager.confirm(c,'UPDATE_CURRENT_SOURCES_KEEP_HISTORY');}
export async function probeRecoveryPackage(wires:Record<string,string>){
 const cases=[];let baseline:RecoveredHandoffFile|null=null;
 for(const kind of['baseline','unknown','applied','new-application'] as const){const f=await openReconcileCase(wires[kind==='new-application'?'baseline':kind]!);try{
  const original=JSON.stringify(f.readonly.capture());if(kind==='new-application'){const c=await f.business.prepare(),a=f.business.arm(c);f.business.acknowledge(a,true);await f.business.apply(a,'APPLY_NEW_RECOVERED_BATCH');}
  if(kind!=='baseline')await synchronizePackageCase(f,'内部交接106 '+kind);if(kind==='unknown')await synchronizePackageCase(f,'内部交接106 unknown · 二次');
  const before=JSON.stringify(f.business.capture()),file=await f.business.handoffPackage(),parsed=await parseRecoveredPackage(file.text),r=parsed.review;if(kind==='baseline')baseline=file;
  cases.push({id:kind+'_complete_package',checks:{file_count:parsed.files.length===(kind==='new-application'?6:5),all_source_updates:r.source_updates===(kind==='unknown'?2:kind==='baseline'?0:1),all_receipts:r.historical_receipts===(['applied','new-application'].includes(kind)?1:0),retired_ids:r.retired_cost_ids===(kind==='applied'?1:0),application_backup:r.new_fee_applications===(kind==='new-application'?1:0),unknown_stays_unknown:kind!=='unknown'||r.unresolved_issues.includes('HISTORY_NOT_ESTABLISHED'),original_exact:JSON.stringify(f.readonly.capture())===original,producer_exact:JSON.stringify(f.business.capture())===before,no_authority:!r.import_authority&&!r.confirmation_authority&&!r.customer_reviewed&&!r.full_live_workbench_reopen,runtime_not_integrated:!f.business.state().production_integrated}});
 }finally{f.close();}}
 if(!baseline)throw Error('Synthetic package missing');
 {
  const f=await openReconcileCase(wires.baseline!),t=recoveredPackageTransfer(f.business);try{const before=JSON.stringify(f.business.capture()),c=await t.stageFile(recoveredPackageSource(baseline));let copied=false,wrong=false;try{t.openReadOnly(structuredClone(c),'OPEN_READ_ONLY_PACKAGE');}catch{copied=true;}try{t.openReadOnly(c,'AUTO' as never);}catch{wrong=true;}t.openReadOnly(c,'OPEN_READ_ONLY_PACKAGE');let repeat=false;try{t.openReadOnly(c,'OPEN_READ_ONLY_PACKAGE');}catch{repeat=true;}const prior=t.currentReview();let corrupt=false;try{await t.stageFile({name:'corrupt.json',size:1,arrayBuffer:async()=>new Uint8Array([0xff]).buffer});}catch{corrupt=true;}
   cases.push({id:'explicit_readonly_and_failure',checks:{copied,wrong,repeat,corrupt,old_review_kept:t.currentReview()===prior,producer_exact:JSON.stringify(f.business.capture())===before,no_fee:f.business.state().financial_writes===0,not_reopen:!t.state().full_live_workbench_reopen}});
  }finally{t.dispose();f.close();}
 }
 {
  const f=await openReconcileCase(wires.baseline!),t=new RecoveredPackageTransfer({build:async()=>baseline!,lease:()=>f.business.handoffLease(),current:x=>f.business.isHandoffLeaseCurrent(x)});try{const before=JSON.stringify(f.business.capture()),c=await t.prepareExport(),delivery=await t.deliver(c,'EXPORT_INTERNAL_PACKAGE',async()=>'DOWNLOAD_STARTED');let repeat=false;try{await t.deliver(c,'EXPORT_INTERNAL_PACKAGE',async()=>'SAVED');}catch{repeat=true;}const d=await t.prepareExport();f.trade.edit('name','ABA106');f.trade.discard();let stale=false;try{await t.deliver(d,'EXPORT_INTERNAL_PACKAGE',async()=>'SAVED');}catch{stale=true;}
   cases.push({id:'download_acknowledgement_and_staleness',checks:{repeat,stale,download_started:delivery.result==='DOWNLOAD_STARTED',producer_project_exact:f.business.capture().sources.project_json===JSON.parse(before).sources.project_json,no_fee:f.business.state().financial_writes===0,no_files_claim:f.business.state().file_writes===0,customer_not_approved:!f.business.state().customer_reviewed}});
  }finally{t.dispose();f.close();}
 }
 return{scope:'COMPLETE_INTERNAL_PACKAGE_READONLY_HANDOFF',cases,archives_uploaded:0,production_integrated:false,full_live_workbench_reopen:false};
}
