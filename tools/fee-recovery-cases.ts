/** Fixed synthetic complete-profile data for Node/browser equivalence. Not a business template. */
import {feeLayeredParts} from './fee-layered-capture-cases';
import {observeFeeSourceStorage} from '../src/ui/fee-workbench-source-readers';
import type {FeeRecoverySupplement} from './fee-recovery-supplement';
export const FEE_RECOVERY_CASE_DATE='2026-10-25T10:00:00.000Z';
export function feeRecoverySupplement():FeeRecoverySupplement {
  const review=()=>({export_message:'',review_key:'',review_generation:0,review_html:''});
  return {scope:'FEE_WORKBENCH_RECOVERY_SUPPLEMENT',version:'0.1',
    workflow:{state_initialized:false,pending_calculation:false,restored_from_draft:false,draft_failure:null,draft_storage_unavailable:false,workspace_mode:'beginner',workspace_note:'SYNTHETIC_ONLY',calculated_at:'',recovery_stage:null,recovery_review:null,recovery_review_error:null,recovery_review_epoch:0,recovery_review_busy:false,input_locations:[],sensitivity_error:null,customer_error:null,project_save_busy:false,project_resource_busy:false,settlement_busy:false,customer_summary_busy:false,customer_pdf_busy:false},
    app:{error:null,status:'',status_level:'info'},pair_ui:{review_page:0},tax_ui:review(),precision_ui:review(),
    envelope_ui:{message:'',business_name:'',choices:{},choice_token:-1,review_key:'',review_generation:0,review_html:'',workbench_result:null,workbench_candidate:null,workbench_confirmation:null,workbench_application:null,workbench_generation:0,workbench_busy:false,workbench_message:'',workbench_save_notice:null},
    view:{collapsed_sections:[],expanded_evidence_sections:[]},pending_present:false,pending_control:null,pending_other:null,extensions:{}};
}
export function feeRecoveryFixture(){
  const holder=()=>({file_evidence:{name:null,saved_raw:null,saved_at:null},epoch:0,reading:false,write_busy:false});
  const parts=feeLayeredParts({project_raw:null,project_file:{name:null,saved_at:null,dirty:null,saved_raw_known:false},bill:holder(),pair:holder(),tax:{...holder(),attachment:null,editor:null,preview:null,recovery:null,read_token:0,mutation_busy:false},precision:{...holder(),selection:null,editor:null,preview:null,recovery:null,read_token:0,mutation_busy:false},envelope:{...holder(),current:null,preview:null,read_token:0,mutation_busy:false,cache_busy:false},tax_workspace:{pending:null,export_busy:false},precision_workspace:{pending:null,export_busy:false},envelope_workspace:{pending:null,busy:false,exporting:false},project_read_epoch:0,project_read_token:null,settlement_epoch:0,settlement_plan:null,sensitivity:{},customer_fields:null,customer_view:'full',customer_reviewed:false,pending_control:null,storage:observeFeeSourceStorage(()=>null)});
  return {parts,supplement:feeRecoverySupplement()};
}
