/** Portable Node/browser probes over identical small synthetic archive wires. No held phase101 file is needed. */
import {FeeRecoveryReopen} from './fee-recovery-reopen';
import {parseFeeEnvelope,inspectFeeEnvelopeConsumption} from '../src/data/fee-envelope';
import {predictReconciledCapture} from './fee-recovery-reconcile';
import {emptyCustomerQuoteFields} from '../src/domain/customer-quote';
export async function openReconcileCase(raw:string,afterPrepare?:()=>Promise<void>){
  const store=new FeeRecoveryReopen(),m=await store.stage(raw),readonly=store.confirm(m,'OPEN_SEPARATE_RECOVERY_SESSION'),business=await readonly.newBusinessSession(),manager=business.reconcile(afterPrepare);
  return{raw,store,readonly,business,manager,trade:business.trade(),close:()=>{business.dispose();store.dispose();}};
}
async function editName(f:Awaited<ReturnType<typeof openReconcileCase>>){f.trade.edit('name',f.trade.view().values.name+' · 重新录入105');f.trade.commit();}
async function update(f:Awaited<ReturnType<typeof openReconcileCase>>){const candidate=await f.manager.stage(['project_json']);f.manager.acknowledge(candidate,true);return f.manager.confirm(candidate,'UPDATE_CURRENT_SOURCES_KEEP_HISTORY');}
export async function probeRecoveryReconcile(wires:Record<string,string>){
  const cases=[];
  {
    const f=await openReconcileCase(wires.baseline!),original=JSON.stringify(f.readonly.capture());await editName(f);const before=f.business.capture(),candidate=await f.manager.stage(['project_json']);let copied=false,unchecked=false;try{f.manager.acknowledge(structuredClone(candidate),true);}catch{copied=true;}try{await f.manager.confirm(candidate,'UPDATE_CURRENT_SOURCES_KEEP_HISTORY');}catch{unchecked=true;}
    f.manager.acknowledge(candidate,true);const revision=f.business.state().owner.revision,record=await f.manager.confirm(candidate,'UPDATE_CURRENT_SOURCES_KEEP_HISTORY'),after=f.business.capture(),next=await parseFeeEnvelope(after.envelope_json!);let repeat=false;try{await f.manager.confirm(candidate,'UPDATE_CURRENT_SOURCES_KEEP_HISTORY');}catch{repeat=true;}
    cases.push({id:'explicit_atomic_sources',checks:{copied,unchecked,repeat,one_root:f.business.state().owner.revision===revision+1,all_sources_match:JSON.stringify(next.current_sources)===JSON.stringify(after.sources),project_exact:after.sources.project_json===before.sources.project_json,exact_preflight:JSON.stringify(after)===JSON.stringify(predictReconciledCapture(before,record.after_envelope_json,next)),one_source_update:f.manager.state().source_updates===1,no_fee:f.business.state().financial_writes===0,readonly_exact:JSON.stringify(f.readonly.capture())===original}});f.close();
  }
  for(const kind of['unknown','applied'] as const){
    const f=await openReconcileCase(wires[kind]!),before=await parseFeeEnvelope(f.business.capture().envelope_json!);await editName(f);const record=await update(f),after=await parseFeeEnvelope(f.business.capture().envelope_json!);
    let consumed=true;if(kind==='applied'){const review=JSON.parse(before.ledger_json),receipt=before.archives.find(a=>a.sha256===review.receipt_refs[0])!,row=JSON.parse(receipt.raw_json).rows[0];consumed=(await inspectFeeEnvelopeConsumption(after,{bill_id:row.bill_id,line_id:row.line_id})).status==='RECORDED_IN_THIS_LINEAGE';}
    cases.push({id:kind+'_history_preserved',checks:{origin:after.history_origin===before.history_origin,ledger_exact:after.ledger_json===before.ledger_json,archives_exact:JSON.stringify(after.archives)===JSON.stringify(before.archives),receipt_and_retired_counts:kind==='applied'?JSON.parse(after.ledger_json).receipt_refs.length===1&&JSON.parse(after.ledger_json).retired_cost_ids.length===1:record.unresolved_issues.includes('HISTORY_NOT_ESTABLISHED'),consumed,not_cleared:record.unresolved_issues.length>0,no_fee:f.business.state().financial_writes===0}});f.close();
  }
  {
    const f=await openReconcileCase(wires.baseline!);await editName(f);const candidate=await f.manager.stage(['project_json']),before=f.business.capture().envelope_json,name=f.trade.view().values.name;f.trade.edit('name','ABA105');f.trade.edit('name',name);f.trade.commit();let refused=false;try{f.manager.acknowledge(candidate,true);}catch{refused=true;}
    cases.push({id:'source_aba_revokes',checks:{refused,old_envelope_kept:f.business.capture().envelope_json===before,no_source_update:f.manager.state().source_updates===0,no_fee:f.business.state().financial_writes===0}});f.close();
  }
  {
    const f=await openReconcileCase(wires.baseline!);await editName(f);const before=f.business.capture().envelope_json;let rejected=false;try{await f.manager.stage(['project_json','bill_json']);}catch{rejected=true;}f.manager.cancel();cases.push({id:'selection_and_cancel',checks:{rejected,original_kept:f.business.capture().envelope_json===before,no_source_update:f.manager.state().source_updates===0,no_candidate:f.manager.pending()===null}});f.close();
  }
  {
    const f=await openReconcileCase(wires.baseline!);await editName(f);const record=await update(f),files=await f.business.handoff(),project=files.find(v=>v.name==='recovered-project.json')!,envelope=files.find(v=>v.name==='recovered-envelope.json')!,parsed=await parseFeeEnvelope(envelope.text);
    cases.push({id:'existing_file_set_consistent',checks:{four_files:files.length===4,project_matches:parsed.current_sources.project_json===project.text,approved_envelope:envelope.text===record.after_envelope_json,original_record_kept:record.before_envelope_json!==record.after_envelope_json,not_complete_reopen:!f.business.state().full_live_workbench_reopen,private_not_customer:JSON.parse(files.at(-1)!.text).customer_document===false}});f.close();
  }
  {
    const f=await openReconcileCase(wires.baseline!),fields=emptyCustomerQuoteFields(),old=f.business.stageCustomer(fields);f.business.confirmCustomer(old,'CONFIRM_PUBLIC_CONTENT');await editName(f);await update(f);let rejected=false;try{f.business.exportCustomer(old);}catch{rejected=true;}
    const fresh=f.business.stageCustomer(fields);let notApproved=false;try{f.business.exportCustomer(fresh);}catch{notApproved=true;}
    cases.push({id:'customer_and_no_effects',checks:{rejected,notApproved,storage:f.business.state().storage_reads===0&&f.business.state().storage_writes===0,files:f.business.state().file_writes===0,notifications:f.business.state().notifications===0,old_archive_no_install:f.readonly.archive.runtime_installed===false,no_production:!f.business.state().production_integrated}});f.close();
  }
  {
    const f=await openReconcileCase(wires.missing!);let rejected=false;try{await f.manager.stage(['project_json']);}catch{rejected=true;}cases.push({id:'missing_envelope_refused',checks:{rejected,not_available:!f.manager.overview().available,no_source_update:f.manager.state().source_updates===0,no_fee:f.business.state().financial_writes===0}});f.close();
  }
  return{scope:'EXPLICIT_INDEPENDENT_SOURCE_RECONCILIATION',cases,production_integrated:false,full_live_workbench_reopen:false,archives_uploaded:0};
}
