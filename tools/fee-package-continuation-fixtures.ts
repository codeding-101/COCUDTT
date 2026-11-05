/** Node-only synthetic input files. No held phase101 archive is read or served. */
import {packageSessionFixtures} from './fee-package-session-fixtures';
import {FeeRecoveryReopen} from './fee-recovery-reopen';
import {feeRecoveryFixture} from './fee-recovery-cases';
import {completePair} from '../tests/fixtures/fee-tax-attachment';
import {empty} from '../tests/fixtures/fee-envelope';
import {serializeProject} from '../src/data/project-file';
import {serializeContainerBillDraft} from '../src/data/container-bill-file';
import {serializeFeeEnvelope} from '../src/data/fee-envelope';
import {booksToRows} from '../src/ui/fx-rows';
import {FeeRecoveryFormat} from './fee-recovery-format';
import {recoveredHandoffFile} from './fee-recovery-business-files';
import {createRecoveredPackage} from './fee-recovery-package';
export async function continuationFixtures(){const files=await packageSessionFixtures(),origin=JSON.parse(files.baseline!.text).files.find((f:{name:string})=>f.name==='original-recovery.json').text,store=new FeeRecoveryReopen(),candidate=await store.stage(origin),source=store.confirm(candidate,'OPEN_SEPARATE_RECOVERY_SESSION'),b=await source.newBusinessSession();try{const c=await b.prepare(),a=b.arm(c);b.acknowledge(a,true);await b.apply(a,'APPLY_NEW_RECOVERED_BATCH');files.ready=await b.handoffPackage();}finally{b.dispose();store.dispose();}return files;}
/** Small complete packages for fresh portable gate checks; optional fee sources deliberately remain absent/unresolved. */
export async function continuationProbeFixtures(){const pair=completePair().pair,project=serializeProject(pair.project),bill=serializeContainerBillDraft(pair.bill),sources={project_json:project,bill_json:bill,pair_json:null,attachment_json:null,precision_json:null},files:Record<string,Awaited<ReturnType<typeof recoveredHandoffFile>>>={};
 for(const kind of['baseline','unknown','archived'] as const){const f=feeRecoveryFixture(),r=f.parts.retained_root as Record<string,unknown>,e=empty(sources,kind==='unknown'?'UNKNOWN_IMPORTED':'NEW_DECLARED').a,raw=await serializeFeeEnvelope(e),rows=JSON.stringify(booksToRows(pair.project.fx_books));r.project_raw=pair.project;r.project_file={name:null,saved_at:null,dirty:true,saved_raw_known:false};(r.envelope as Record<string,unknown>).current={raw_json:raw,lease:{envelope_id:e.envelope_id,business_id:e.business_id,revision:e.revision,content_sha256:e.content_sha256},history_origin:e.history_origin};f.parts.capture_shell.sources={...sources};f.parts.capture_shell.envelope_json=raw;f.parts.capture_shell.fx={rows_json:rows,preserved_row_key:rows,preserved_books_json:JSON.stringify(pair.project.fx_books)};f.supplement.workflow.state_initialized=true;
  if(kind==='archived'){r.customer_reviewed=true;r.customer_fields={synthetic_private:'PRIVATE_ARCHIVED_CUSTOMER108'};r.settlement_plan={synthetic_private:'PRIVATE_ARCHIVED_PAYMENT108'};f.supplement.envelope_ui.workbench_confirmation={synthetic_private:'PRIVATE_OLD_CONFIRMATION108'};}
  const original=await new FeeRecoveryFormat().encode(f.parts,f.supplement,new AbortController().signal,{captured_at:'2026-10-30T00:00:00.000Z'}),data=[await recoveredHandoffFile('recovered-project.json',project),await recoveredHandoffFile('recovered-envelope.json',raw),await recoveredHandoffFile('original-recovery.json',original)];data.push(await recoveredHandoffFile('internal-handoff-manifest.json',JSON.stringify({kind:'INTERNAL_RECOVERED_BUSINESS_HANDOFF',version:'0.1',original_captured_at:'2026-10-30T00:00:00.000Z',files:data.map(({name,bytes,sha256})=>({name,bytes,sha256})),new_financial_writes:0,pending_patch_replays:0,import_authority:false,customer_document:false})));files[kind]=await createRecoveredPackage(data,[]);
 }
 return files;
}
