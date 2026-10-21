/** Synthetic Node fixture only. Browser equality is checked separately against actual app.ts. */
import {feePerformanceFixture} from './fee-performance-fixture';
import {feePerformanceHarness} from './fee-performance-harness';
import {observeFeeSourceStorage, type FeeSourceReaders, type FeeSourceWorkflow, type FeeSourcePending} from '../src/ui/fee-workbench-source-adapter';

export async function feeSourceAdapterFixture() {
  const fixture = await feePerformanceFixture(1), h = await feePerformanceHarness(fixture.raw), source = new Map(h.sourceViewReaders().map(r => [r.producer, r.read]));
  const options: {workflow: Partial<FeeSourceWorkflow>; pending: FeeSourcePending; storage: Map<string,string>} = {workflow: {}, pending: {present:false,control:null}, storage:new Map()};
  const readers: FeeSourceReaders = {
    project: () => ({project:h.app.project,fxRows:h.app.fxRows,fileEvidence:h.app.fileEvidence,fileName:null,savedAt:null,dirty:h.app.dirty}),
    workflow: () => ({stateInitialized:true,pendingCalculation:h.workflow.pendingCalculation,pairFxLease:h.workflow.pairFxLease,
      projectReadEpoch:h.workflow.projectReadEpoch,projectReadToken:h.workflow.projectReadToken,settlementEpoch:h.workflow.settlementEpoch,settlementPlan:h.workflow.settlementPlan,
      sensitivityControls:{scope:'SYNTHETIC_ADAPTER_INPUT'},customerFields:h.workflow.customerFields,customerView:'full',customerReviewed:h.workflow.customerReviewed,
      recoveryStage:null,recoveryReviewBusy:false,projectSaveBusy:false,projectResourceBusy:false,settlementBusy:false,customerSummaryBusy:false,customerPdfBusy:false,...options.workflow}),
    bill: () => {const {draft,...capture} = source.get('bill')!() as ReturnType<FeeSourceReaders['bill']>['capture'] & {draft: ReturnType<FeeSourceReaders['bill']>['draft']}; return {capture,draft};},
    pair: () => {const {pair,editor,review_editor,...capture} = source.get('pair')!() as ReturnType<FeeSourceReaders['pair']>['capture'] & {pair: ReturnType<FeeSourceReaders['pair']>['pair']; editor: ReturnType<FeeSourceReaders['pair']>['editor']; review_editor: ReturnType<FeeSourceReaders['pair']>['reviewEditor']}; return {capture,pair,editor,reviewEditor:review_editor};},
    attachment: () => h.taxUi.controller.workbenchCapture(), precision: () => h.precisionUi.controller.workbenchCapture(), envelope: () => h.envelopeUi.controller.workbenchCapture(),
    attachment_workspace: () => h.taxUi.workbenchCapture(), precision_workspace: () => h.precisionUi.workbenchCapture(), envelope_workspace: () => h.envelopeUi.workbenchCapture(),
    pending: () => options.pending, storage: () => observeFeeSourceStorage(key => options.storage.get(key)??null),
  };
  return {h,readers,options};
}
