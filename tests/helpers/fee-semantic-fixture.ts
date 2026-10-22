import {observeFeeSourceStorage,type FeeSourceReaders,type FeeWorkbenchSourceFrame} from '../../src/ui/fee-workbench-source-adapter';
import {projectFeeSourceFrameToLegacy} from '../../src/ui/fee-workbench-source-adapter';
import {captureRuntimeFeeWorkbench} from '../../src/ui/fee-workbench-preview';
import {WorkbenchStateOwner} from '../../src/ui/workbench-state';

/** Small controlled protocol state. Actual app.ts supplies the independent browser oracle. */
export function semanticFixture(){
  const owner=new WorkbenchStateOwner(),common=()=>({file_evidence:{name:null,saved_raw:null,saved_at:null},epoch:0,reading:false,write_busy:false});
  const f={kind:'INTERNAL_FEE_WORKBENCH_SOURCE_FRAME',version:'0.1',financial_writes:0,import_authority:false,confirmation_authority:false,
    producers:{project:null,workflow:{stateInitialized:false,pendingCalculation:false,pairFxLease:null,projectReadEpoch:0,projectReadToken:null,settlementEpoch:0,settlementPlan:null,sensitivityControls:{private:'SYNTHETIC_PRIVATE'},customerFields:null,customerView:'full',customerReviewed:false,recoveryStage:null,recoveryReviewBusy:false,projectSaveBusy:false,projectResourceBusy:false,settlementBusy:false,customerSummaryBusy:false,customerPdfBusy:false},
      bill:{capture:common(),draft:null},pair:{capture:common(),pair:null,editor:null,reviewEditor:null},
      attachment:{...common(),attachment:null,editor:null,mutation_busy:false,preview:null,recovery:null,read_token:0},precision:{...common(),selection:null,editor:null,mutation_busy:false,preview:null,recovery:null,read_token:0},
      envelope:{...common(),current:null,mutation_busy:false,cache_busy:false,preview:null,read_token:0},attachment_workspace:{pending:null,export_busy:false},precision_workspace:{pending:null,export_busy:false},envelope_workspace:{pending:null,busy:false,exporting:false}},
    pending:{present:false,control:null},storage:observeFeeSourceStorage(()=>null)} as unknown as FeeWorkbenchSourceFrame;
  const p=f.producers,baseline=projectFeeSourceFrameToLegacy(f),retained=JSON.parse(baseline.retained_json);
  const readers:FeeSourceReaders={project:()=>{throw Error('UNINITIALIZED_PROJECT_READ');},workflow:()=>p.workflow,bill:()=>p.bill,pair:()=>p.pair,attachment:()=>p.attachment,precision:()=>p.precision,envelope:()=>p.envelope,attachment_workspace:()=>p.attachment_workspace,precision_workspace:()=>p.precision_workspace,envelope_workspace:()=>p.envelope_workspace,pending:()=>f.pending,storage:()=>f.storage};
  // This oracle varies only the controlled sensitivity/storage fields; all other mapping evidence is native-browser evidence.
  const original=()=>captureRuntimeFeeWorkbench({...baseline,retained_json:JSON.stringify({...retained,sensitivity:p.workflow.sensitivityControls,storage:f.storage},null,2)+'\n'});
  return {owner,f,readers,baseline,retained,original};
}
