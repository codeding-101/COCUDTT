import {FeeRecoveryFormat} from './fee-recovery-format';
import {FeeRecoveryReopen} from './fee-recovery-reopen';
import {feeReopenFixture} from './fee-recovery-reopen-cases';
import {renderFeeRecoveryManifest} from './fee-recovery-reopen-panel';
export async function probeFeeRecoveryReopen(){
 const f=feeReopenFixture(),format=new FeeRecoveryFormat(),wire=await format.encode(f.parts,f.supplement,new AbortController().signal,{captured_at:'2026-10-27T00:00:00.000Z'}),store=new FeeRecoveryReopen(),m=await store.stage(wire),before=store.current();
 let copyRefused=false,twice=false,failed=false;try{store.confirm(JSON.parse(JSON.stringify(m)),'OPEN_SEPARATE_RECOVERY_SESSION');}catch{copyRefused=true;}
 const session=store.confirm(m,'OPEN_SEPARATE_RECOVERY_SESSION'),d=session.diagnostics(),capture=session.capture();try{store.confirm(m,'OPEN_SEPARATE_RECOVERY_SESSION');}catch{twice=true;}
 try{await store.stage('BROKEN {');}catch{failed=store.current()===session;}
 const next=await store.stage(wire);store.invalidate();store.invalidate();let stale=false;try{store.confirm(next,'OPEN_SEPARATE_RECOVERY_SESSION');}catch{stale=store.current()===session;}store.cancel();
 const pending=feeReopenFixture();pending.supplement.workflow.pending_calculation=true;pending.parts.capture_shell.editors.pending_input=JSON.stringify({pending_calculation:true,control:null});const pendingWire=await new FeeRecoveryFormat().encode(pending.parts,pending.supplement,new AbortController().signal,{captured_at:'2026-10-27T00:00:00.000Z'}),blocked=await store.stage(pendingWire);let guarded=false;try{store.confirm(blocked,'OPEN_SEPARATE_RECOVERY_SESSION');}catch{guarded=store.current()===session;}
 const html=renderFeeRecoveryManifest(m),cases=[
  {id:'separate_ten_real_participants',checks:{manifest_ready:m.can_open,not_open_before_choice:before===null,participants:d.owner.participants.length===10,real_controllers:d.controller_types.length===5,quiet:d.storage_reads===0&&d.storage_writes===0&&d.file_writes===0&&d.notifications===0}},
  {id:'calculated_from_committed_sources',checks:{project_exact:capture.sources.project_json===f.parts.capture_shell.sources.project_json,fx_exact:JSON.stringify(capture.fx)===JSON.stringify(f.parts.capture_shell.fx),profit_known:d.seller_profit!==null,buyer_known:d.buyer_total!==null,unapproved:d.customer_reviewed===false,no_writes:d.financial_writes===0}},
  {id:'private_choice_and_failure_preservation',checks:{copy_refused:copyRefused,twice_refused:twice,invalid_kept:failed,aba_kept:stale,pending_not_adopted:!blocked.can_open&&guarded}},
  {id:'scope_and_manifest',checks:{six_sources:m.sources.length===6,no_production:m.production_integrated===false&&d.production_integrated===false,no_full_reopen:m.full_live_workbench_reopen===false&&d.full_live_workbench_reopen===false,no_markup:!html.includes('<script'),clear_scope:html.includes('正式工作台不替换')}}
 ];store.dispose();return{cases,wire,diagnostics:d};
}
