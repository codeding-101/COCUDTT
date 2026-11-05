/** Node-only synthetic archive builder, using existing untrusted test fixtures and original validators. Never served as executable browser code. */
import {fullSources,empty,seal} from '../tests/fixtures/fee-envelope';
import {source,lease as attachmentLease} from '../tests/fixtures/fee-tax-attachment';
import {serializeFeeEnvelope,parseFeeEnvelope,adoptLegacyFeeEnvelope} from '../src/data/fee-envelope';
import {createContainerCostPair,serializeContainerCostPair} from '../src/data/container-cost-pair';
import {confirmContainerCostIntent} from '../src/engine/container-cost-proposal';
import {createFeeTaxAttachment,setFeeTaxAttachmentRecord,acknowledgeFeeTaxAttachmentRecord,serializeFeeTaxAttachment} from '../src/data/fee-tax-attachment';
import {createFeePrecisionSelection,addFeePrecisionSelectionRecord,acknowledgeFeePrecisionSelectionRecord,serializeFeePrecisionSelection} from '../src/data/fee-precision-selection';
import {parseProject} from '../src/data/project-file';
import {parseFeeTaxAttachment} from '../src/data/fee-tax-attachment';
import {parseFeePrecisionSelection} from '../src/data/fee-precision-selection';
import {booksToRows} from '../src/ui/fx-rows';
import {feeReopenFixture} from './fee-recovery-reopen-cases';
import {FeeRecoveryFormat} from './fee-recovery-format';
import {FeeRecoveryReopen} from './fee-recovery-reopen';
import type {FeeEnvelope} from '../src/domain/fee-envelope';
export async function reconcileFixtureWires(){
  const s=await completeRuntimeSources(),base=empty(s).a,unknown=await adoptLegacyFeeEnvelope(s),wires:Record<string,string>={};
  for(const[kind,envelope]of[['baseline',base],['unknown',unknown],['missing',null]] as const){
    const f=feeReopenFixture(),r=f.parts.retained_root as Record<string,unknown>,c=f.parts.capture_shell;
    if(envelope){const raw=await serializeFeeEnvelope(envelope),sources=envelope.current_sources,project=parseProject(sources.project_json);r.project_raw=project;c.sources={...sources};c.envelope_json=raw;
      (r.tax as Record<string,unknown>).attachment=sources.attachment_json===null?null:await parseFeeTaxAttachment(sources.attachment_json);
      (r.precision as Record<string,unknown>).selection=sources.precision_json===null?null:await parseFeePrecisionSelection(sources.precision_json);
      (r.envelope as Record<string,unknown>).current={raw_json:raw,lease:envelopeLease(envelope),history_origin:envelope.history_origin};
      const rows=JSON.stringify(booksToRows(project.fx_books));c.fx={rows_json:rows,preserved_row_key:rows,preserved_books_json:JSON.stringify(project.fx_books)};
    }
    f.supplement.extensions={synthetic_private105:'PRIVATE_SYNTHETIC_RECONCILIATION105'};wires[kind]=await new FeeRecoveryFormat().encode(f.parts,f.supplement,new AbortController().signal,{captured_at:'2026-10-29T00:00:00.000Z'});
  }
  // Generate the receipt through the real ten-holder application path, not a hand-written transaction writer.
  const store=new FeeRecoveryReopen(),m=await store.stage(wires.baseline!),readonly=store.confirm(m,'OPEN_SEPARATE_RECOVERY_SESSION'),business=await readonly.newBusinessSession();
  try{const candidate=await business.prepare(),confirmation=business.arm(candidate);business.acknowledge(confirmation,true);const record=await business.apply(confirmation,'APPLY_NEW_RECOVERED_BATCH'),capture=business.capture(),a=await parseFeeEnvelope(capture.envelope_json!),ledger=JSON.parse(a.ledger_json);ledger.retired_cost_ids=['synthetic-retired105'];a.ledger_json=JSON.stringify(ledger);a.revision++;seal(a);
    const raw=await serializeFeeEnvelope(a),r=JSON.parse(capture.retained_json);r.envelope.current={raw_json:raw,lease:envelopeLease(a),history_origin:a.history_origin};const{retained_json,...shell}=capture,f=feeReopenFixture();f.parts.capture_shell={...shell,envelope_json:raw};f.parts.retained_root=r;f.supplement.envelope_ui.workbench_application=record;f.supplement.extensions={synthetic_private105:'PRIVATE_SYNTHETIC_RECONCILIATION105'};
    wires.applied=await new FeeRecoveryFormat().encode(f.parts,f.supplement,new AbortController().signal,{captured_at:'2026-10-29T00:00:00.000Z'});
  }finally{business.dispose();store.dispose();}
  return wires;
}
async function completeRuntimeSources(){
  const s=await fullSources(),intent=structuredClone(s.pair.selection.intents[0]!);if(intent.operation!=='CREATE_NEW')throw Error('Synthetic intent');intent.new_cost.fx_type='CONTRACT';intent.new_cost.fx_rate='7';
  const{provenance:_,...fields}=source(),confirmed=confirmContainerCostIntent(s.pair.project,s.pair.bill,intent,{...fields,status:'UNVERIFIED'}),pair=createContainerCostPair(s.pair.project,s.pair.bill,{version:'0.1',intents:[confirmed]}),raw=serializeContainerCostPair(pair);
  let attachment=await createFeeTaxAttachment(raw);attachment=await setFeeTaxAttachmentRecord(attachment,attachmentLease(attachment),{...s.record,target:{...pair.mapping.entries[0]!}});for(const facet of['tax','credit','customs'] as const)attachment=await acknowledgeFeeTaxAttachmentRecord(attachment,attachmentLease(attachment),raw,attachment.records[0]!.record_id,facet);
  const attachmentText=await serializeFeeTaxAttachment(attachment);let precision=await createFeePrecisionSelection(raw,attachmentText);const lease=()=>({revision:precision.revision,content_sha256:precision.content_sha256});
  precision=await addFeePrecisionSelectionRecord(precision,lease(),{component_record_id:attachment.records[0]!.record_id,channel:'cash',choice:{kind:'ROUND',policy:{kind:'EXPLICIT',unit:'0.01',mode:'HALF_UP',basis:'合成原额未改变'}}});precision=await acknowledgeFeePrecisionSelectionRecord(precision,lease(),raw,attachmentText,precision.records[0]!.record_id);
  return{...s.sources,pair_json:raw,attachment_json:attachmentText,precision_json:await serializeFeePrecisionSelection(precision)};
}
const envelopeLease=(e:FeeEnvelope)=>({envelope_id:e.envelope_id,business_id:e.business_id,revision:e.revision,content_sha256:e.content_sha256});
