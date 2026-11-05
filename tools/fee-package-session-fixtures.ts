/** Node-only synthetic package builder. Never loads or serves the held phase101 archive. */
import {reconcileFixtureWires} from './fee-recovery-reconcile-fixtures';
import {openReconcileCase} from './fee-recovery-reconcile-cases';
import {synchronizePackageCase} from './fee-recovery-package-cases';
import type {RecoveredHandoffFile} from './fee-recovery-business-files';
import {recoveredHandoffFile} from './fee-recovery-business-files';
import {FeeRecoveryFormat} from './fee-recovery-format';
import {createRecoveredPackage} from './fee-recovery-package';
import {emptyCustomerQuoteFields} from '../src/domain/customer-quote';
export async function packageSessionFixtures(){
 const wires=await reconcileFixtureWires(),files:Record<string,RecoveredHandoffFile>={};
 for(const kind of['baseline','unknown','applied','application'] as const){const f=await openReconcileCase(wires[kind==='application'?'baseline':kind]!);try{
  if(kind==='application'){const c=await f.business.prepare(),a=f.business.arm(c);f.business.acknowledge(a,true);await f.business.apply(a,'APPLY_NEW_RECOVERED_BATCH');}
  for(let i=0;i<(kind==='unknown'?2:kind==='baseline'?0:1);i++)await synchronizePackageCase(f,'完整包独立会话107 '+kind+' '+(i+1));
  files[kind]=await f.business.handoffPackage();
 }finally{f.close();}}
 // Deliberately untrusted archived UI data: valid package, never an instruction to restore those forms.
 const origin=await new FeeRecoveryFormat().decode(JSON.parse(files.baseline!.text).files.find((f:RecoveredHandoffFile)=>f.name==='original-recovery.json').text,new AbortController().signal),root=structuredClone(origin.restoration.retained_root) as Record<string,unknown>,{retained_json:_,...shell}=structuredClone(origin.restoration.capture),supplement=structuredClone(origin.supplement);
 root.settlement_plan={synthetic_private:'PRIVATE_OLD_PAYMENT107'};root.sensitivity={synthetic_private:'PRIVATE_OLD_SENSITIVITY107'};root.customer_fields={...emptyCustomerQuoteFields(),remarks:'PRIVATE_OLD_CUSTOMER107'};root.customer_reviewed=true;
 const pending={tag:'INPUT',id:'archived-only',type:'number',value:'-',dataset:{synthetic_private:'PRIVATE_DRAFT107'},connected:true};root.pending_control=pending;supplement.workflow.pending_calculation=true;supplement.pending_present=true;supplement.pending_control={...pending,checked:null,selection_start:null,selection_end:null,selected_values:null,bad_input:true,validation_message:'PRIVATE_INVALID107',files:[{name:'PRIVATE_UNREAD107.json',size:7,type:'application/json',last_modified:0}]};shell.editors.pending_input=JSON.stringify({pending_calculation:true,control:pending});supplement.envelope_ui.workbench_candidate={synthetic_private:'PRIVATE_CANDIDATE107'};supplement.envelope_ui.workbench_confirmation={synthetic_private:'PRIVATE_CONFIRMATION107'};
 const raw=await new FeeRecoveryFormat().encode({retained_root:root,capture_shell:shell,retained_format:'PRETTY_LF'},supplement,new AbortController().signal,{captured_at:origin.captured_at}),legacy=JSON.parse(files.baseline!.text).files.filter((f:RecoveredHandoffFile)=>!['source-update-audit.json','internal-handoff-manifest.json'].includes(f.name)) as RecoveredHandoffFile[];
 legacy[legacy.findIndex(f=>f.name==='original-recovery.json')]=await recoveredHandoffFile('original-recovery.json',raw);legacy.push(await recoveredHandoffFile('internal-handoff-manifest.json',JSON.stringify({kind:'INTERNAL_RECOVERED_BUSINESS_HANDOFF',version:'0.1',original_captured_at:origin.captured_at,files:legacy.map(({name,bytes,sha256})=>({name,bytes,sha256})),new_financial_writes:0,pending_patch_replays:0,import_authority:false,customer_document:false})));
 files.archived=await createRecoveredPackage(legacy,[]);return files;
}
