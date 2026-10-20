import {vi} from 'vitest';
import {WorkbenchStateOwner} from '../../src/ui/workbench-state';
import {ContainerBillController} from '../../src/ui/container-bill-controller';
import {ContainerCostPairController} from '../../src/ui/container-cost-pair-controller';
import {FeeTaxAttachmentWorkspace} from '../../src/ui/fee-tax-attachment-workspace';
import {FeePrecisionSelectionWorkspace} from '../../src/ui/fee-precision-selection-workspace';
import {FeeEnvelopeWorkspace} from '../../src/ui/fee-envelope-workspace';
import {RuntimeFeeWorkbenchCandidatePreparer} from '../../src/ui/fee-workbench-candidate';
import {captureRuntimeFeeWorkbench} from '../../src/ui/fee-workbench-preview';
import {unknownFileEvidence} from '../../src/ui/file-evidence';
import {booksToRows} from '../../src/ui/fx-rows';
import {parseProject,serializeProject} from '../../src/data/project-file';
import {parseContainerBillDraft,serializeContainerBillDraft} from '../../src/data/container-bill-file';
import {parseContainerCostPair,serializeContainerCostPair} from '../../src/data/container-cost-pair';
import type {FeeEnvelopeSources} from '../../src/domain/fee-envelope';
export async function runtimeCandidateFixture(raw: string) {
  const owner = new WorkbenchStateOwner(), source = JSON.parse(raw).current_sources as FeeEnvelopeSources;
  const app = {project:parseProject(source.project_json),fxRows:booksToRows(parseProject(source.project_json).fx_books),result:null,comparison:null,error:null,dirty:true,status:'before',statusLevel:'info',fileEvidence:unknownFileEvidence()};
  const workflow = {projectReadEpoch:0,settlementEpoch:0,recoveryReviewEpoch:0,projectReadToken:null,pendingCalculation:false,editedControl:null,pairFxLease:{row_key:JSON.stringify(app.fxRows),books:app.project.fx_books},customerReviewed:true,customerPreview:{private:'OLD_CUSTOMER'},customerError:null,sensitivityAnalysis:null,sensitivityError:null,inputLocations:[],calculatedAt:'before',workspaceNote:'before',customerFields:{private:'KEEP_CUSTOMER80'},settlementPlan:{private:'KEEP_SETTLEMENT80'}};
  owner.bind(app,'app');owner.bind(workflow,'workflow');
  const data=new Map<string,string>(),getItem=vi.fn((key:string)=>data.get(key)??null),setItem=vi.fn((key:string,text:string)=>{data.set(key,text);}),render=vi.fn(),write=vi.fn(async(_name:string,_text:string|Uint8Array<ArrayBuffer>,_mime:string)=>'SAVED' as 'SAVED'|'DOWNLOAD_STARTED');
  vi.stubGlobal('localStorage',{getItem,setItem});
  const bill=new ContainerBillController({stateOwner:owner,project:()=>app.project,blocked:()=>false,render,write});bill.installPrepared(parseContainerBillDraft(source.bill_json),source.bill_json);
  const pair=new ContainerCostPairController({stateOwner:owner,project:()=>app.project,bill:()=>bill.draft,blocked:()=>false,render,write,install:()=>{},afterInstall:()=>{},cancelOtherReads:()=>{}});pair.pair=parseContainerCostPair(source.pair_json!);
  const pairText=()=>serializeContainerCostPair(pair.pair!);
  const taxUi=new FeeTaxAttachmentWorkspace({stateOwner:owner,storage:{getItem,setItem},currentPairText:pairText,blocked:()=>false,write});
  await taxUi.controller.openFile({name:'raw-tax.json',text:async()=>source.attachment_json!});await taxUi.controller.adoptPreview(taxUi.controller.state().preview!.token);
  const precisionUi=new FeePrecisionSelectionWorkspace({stateOwner:owner,storage:{getItem,setItem},currentSources:()=>({pair_json:pairText(),attachment_json:JSON.stringify(taxUi.controller.state().attachment,null,2)+'\n'}),blocked:()=>false,write});
  await precisionUi.controller.openFile({text:async()=>source.precision_json!});await precisionUi.controller.adoptPreview(precisionUi.controller.state().preview!.token);
  const envelopeUi=new FeeEnvelopeWorkspace({stateOwner:owner,storage:{getItem,compareAndSet:async()=>true},cacheWritable:true,currentSources:()=>source,blocked:()=>false,write});
  await envelopeUi.controller.openFile({arrayBuffer:async()=>new TextEncoder().encode(raw).buffer});await envelopeUi.controller.adoptIncoming(envelopeUi.controller.state().preview!.token,{acknowledge_unverifiable:true});
  function capture(){const tax=taxUi.controller.workbenchCapture(),precision=precisionUi.controller.workbenchCapture(),envelope=envelopeUi.controller.workbenchCapture();return captureRuntimeFeeWorkbench({scope:'RUNTIME_FEE_WORKBENCH_CAPTURE',envelope_json:envelope.current!.raw_json,
    sources:{project_json:serializeProject(app.project),bill_json:serializeContainerBillDraft(bill.draft!),pair_json:pairText(),attachment_json:JSON.stringify(tax.attachment,null,2)+'\n',precision_json:JSON.stringify(precision.selection,null,2)+'\n'},
    fx:{rows_json:JSON.stringify(app.fxRows),preserved_row_key:workflow.pairFxLease.row_key,preserved_books_json:JSON.stringify(workflow.pairFxLease.books)},
    files:{project:app.fileEvidence,bill:bill.workbenchCapture().file_evidence,pair:pair.workbenchCapture().file_evidence,attachment:tax.file_evidence,precision:precision.file_evidence,envelope:envelope.file_evidence},
    editors:{cost:null,review:null,attachment:null,precision:null,pending_input:null},activity:{project_read:false,bill_read:false,pair_read:false,attachment_mutation:false,precision_mutation:false,recovery:false},retained_json:JSON.stringify({workflow,project_file:{dirty:app.dirty},storage:Object.fromEntries(data)}),blockers:[]});}
  const targets={app,workflow,bill,pair,tax:taxUi.controller,precision:precisionUi.controller,envelope:envelopeUi.controller,taxUi,precisionUi,envelopeUi};
  const preparer=new RuntimeFeeWorkbenchCandidatePreparer({owner,capture,targets});render.mockClear();write.mockClear();setItem.mockClear();getItem.mockClear();return{owner,app,workflow,bill,pair,taxUi,precisionUi,envelopeUi,capture,preparer,targets,data,render,write,setItem};
}
