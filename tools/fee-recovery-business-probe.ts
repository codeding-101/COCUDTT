import {FeeRecoveryReopen} from './fee-recovery-reopen';
import {FeeRecoveryFormat} from './fee-recovery-format';
import {emptyCustomerQuoteFields} from '../src/domain/customer-quote';
import {parseFeeEnvelope} from '../src/data/fee-envelope';
import {feeEnvelopeSha256} from '../src/data/fee-envelope-json';
export async function probeFeeRecoveryBusiness(raw:string){
 const store=new FeeRecoveryReopen(),manifest=await store.stage(raw),readonly=store.confirm(manifest,'OPEN_SEPARATE_RECOVERY_SESSION'),before=JSON.stringify(readonly.capture()),a=readonly.archive;
 const business=await readonly.newBusinessSession(),candidate=await business.prepare(),fresh=business.state();let copied=false,unacknowledged=false;
 try{business.arm(JSON.parse(JSON.stringify(candidate)));}catch{copied=true;}
 const confirmation=business.arm(candidate);try{await business.apply(confirmation,'APPLY_NEW_RECOVERED_BATCH');}catch{unacknowledged=true;}
 const fields={...emptyCustomerQuoteFields(),issuer:'PUBLIC_SYNTHETIC_ISSUER',recipient:'PUBLIC_SYNTHETIC_CUSTOMER',reference:'PUBLIC_RECOVERED101',payment_terms:'PUBLIC 合同付款安排'};
 const publicBefore=business.stageCustomer(fields);business.confirmCustomer(publicBefore,'CONFIRM_PUBLIC_CONTENT');business.acknowledge(confirmation,true);
 const record=await business.apply(confirmation,'APPLY_NEW_RECOVERED_BATCH'),after=business.state(),capture=business.capture();let twice=false,oldCustomer=false,consumed=false;
 try{await business.apply(confirmation,'APPLY_NEW_RECOVERED_BATCH');}catch{twice=true;}
 try{business.exportCustomer(publicBefore);}catch{oldCustomer=true;}
 try{await business.prepare();}catch{consumed=true;}
 const files=await business.handoff(),origin=files.find(f=>f.name==='original-recovery.json')!,restored=await new FeeRecoveryFormat().decode(origin.text,new AbortController().signal),envelope=await parseFeeEnvelope(capture.envelope_json!),ledger=JSON.parse(envelope.ledger_json);
 const customer=business.stageCustomer(fields,'compact');let unreviewed=false;try{business.exportCustomer(customer);}catch{unreviewed=true;}business.confirmCustomer(customer,'CONFIRM_PUBLIC_CONTENT');const html=business.exportCustomer(customer);
 const checks=[];for(const f of files)checks.push(f.bytes===new TextEncoder().encode(f.text).length&&f.sha256===await feeEnvelopeSha256(f.text));
 const cases=[
  {id:'fresh_second_owner_and_new_candidate',checks:{readonly_unchanged:JSON.stringify(readonly.capture())===before,distinct_owner:business.capture()!==readonly.capture(),ten_participants:candidate.summary.participants.length===10,real_controllers:fresh.controller_types.length===5,new_private_copy_refused:copied,zero_before_choice:fresh.financial_writes===0&&fresh.cost_count===3}},
  {id:'explicit_single_atomic_application',checks:{unacknowledged_refused:unacknowledged,cost_delta:after.cost_count===4,one_financial_write:after.financial_writes===1,one_receipt:ledger.receipt_refs.length===1,one_added:record.costs_added===1,repeat_refused:twice,consumption_refused:consumed}},
  {id:'whole_history_and_original_recovery_preserved',checks:{all_files:files.length===5,hashes:checks.every(Boolean),source_exact:restored.source_wire===a.source_wire,supplement_exact:restored.supplement_json===a.supplement_json,origin_no_authority:restored.import_authority===false&&restored.confirmation_authority===false,old_readonly_still_three:readonly.diagnostics().cost_count===3}},
  {id:'customer_isolation_and_new_review',checks:{old_review_revoked:oldCustomer,unreviewed_refused:unreviewed,public_fields:html.includes('PUBLIC_RECOVERED101'),private_absent:!html.includes('PRIVATE_RECOVERED101')&&!html.includes('pending_patches')&&!html.includes('source_wire'),customer_reviewed:business.state().customer_reviewed,source_unchanged:JSON.stringify(business.capture().sources)===JSON.stringify(capture.sources)}},
  {id:'scope_and_no_external_effects',checks:{no_storage:fresh.storage_reads===0&&fresh.storage_writes===0,no_file_write:fresh.file_writes===0,no_notifications:fresh.notifications===0,no_replay:after.pending_patch_replays===0,no_production:after.production_integrated===false,no_full_reopen:after.full_live_workbench_reopen===false}}
 ];business.dispose();store.dispose();return{cases,application:{costs_added:record.costs_added,receipts_added:record.receipts_added},file_summaries:files.map(({name,bytes,sha256})=>({name,bytes,sha256})),origin_digests:{source_sha256:await feeEnvelopeSha256(a.source_wire),supplement_sha256:await feeEnvelopeSha256(a.supplement_json)}};
}
