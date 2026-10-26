/** Additional serializable data missing from the legacy two-root capture. Never executable controller state. */
import {copyFeeEnvelopeJson,parseFeeEnvelopeJson,canonicalFeeEnvelopeJson} from '../src/data/fee-envelope-json';
import type {RuntimeFeeWorkbenchCapture} from '../src/ui/fee-workbench-preview';
type Data = Record<string, unknown>;
export const FEE_RECOVERY_SUPPLEMENT_FIELDS = Object.freeze({
  workflow: ['state_initialized','pending_calculation','restored_from_draft','draft_failure','draft_storage_unavailable','workspace_mode','workspace_note','calculated_at','recovery_stage','recovery_review','recovery_review_error','recovery_review_epoch','recovery_review_busy','input_locations','sensitivity_error','customer_error','project_save_busy','project_resource_busy','settlement_busy','customer_summary_busy','customer_pdf_busy'],
  app: ['error','status','status_level'], pair_ui: ['review_page'],
  tax_ui: ['export_message','review_key','review_generation','review_html'],
  precision_ui: ['export_message','review_key','review_generation','review_html'],
  envelope_ui: ['message','business_name','choices','choice_token','review_key','review_generation','review_html','workbench_result','workbench_candidate','workbench_confirmation','workbench_application','workbench_generation','workbench_busy','workbench_message','workbench_save_notice'],
  view: ['collapsed_sections','expanded_evidence_sections'],
});
export interface FeeRecoverySupplement {
  scope: 'FEE_WORKBENCH_RECOVERY_SUPPLEMENT'; version: '0.1';
  workflow: Data; app: Data; pair_ui: Data; tax_ui: Data; precision_ui: Data; envelope_ui: Data; view: Data;
  pending_present:boolean;pending_control: Data | null;pending_other:Data|null; extensions: Data;
}
export const FEE_RECOVERY_RETAINED_FIELDS=Object.freeze(['project_raw','project_file','bill','pair','tax','precision','envelope','tax_workspace','precision_workspace','envelope_workspace','project_read_epoch','project_read_token','settlement_epoch','settlement_plan','sensitivity','customer_fields','customer_view','customer_reviewed','pending_control','storage']);
const fail = (): never => {throw Error('FEE_RECOVERY_SUPPLEMENT_INVALID');};
function record(value: unknown): Data {if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(); return value as Data;}
function fields(value: unknown, required: readonly string[]): Data {const d = record(value); if (required.some(k => !Object.hasOwn(d,k))) fail(); return d;}
function strings(d: Data, keys: readonly string[], nullable = false) {if (keys.some(k => typeof d[k] !== 'string' && !(nullable && d[k] === null))) fail();}
function bools(d: Data, keys: readonly string[]) {if (keys.some(k => typeof d[k] !== 'boolean')) fail();}
const count = (v: unknown) => Number.isSafeInteger(v) && !Object.is(v,-0) && (v as number) >= 0;
function texts(v: unknown) {if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) fail();}
export function freezeRecoveryData<T>(value: T): T {if (value && typeof value === 'object') {Object.values(value).forEach(freezeRecoveryData); Object.freeze(value);} return value;}
/** Required members must be present, even when null/empty. Unknown nested fields/extensions are retained as data. */
export function validateFeeRecoverySupplement(value: unknown): FeeRecoverySupplement {
  const d = fields(copyFeeEnvelopeJson(value), ['scope','version',...Object.keys(FEE_RECOVERY_SUPPLEMENT_FIELDS),'pending_present','pending_control','pending_other','extensions']);
  if (Object.keys(d).length !== 13 || d.scope !== 'FEE_WORKBENCH_RECOVERY_SUPPLEMENT' || d.version !== '0.1') fail();
  for (const [key, names] of Object.entries(FEE_RECOVERY_SUPPLEMENT_FIELDS)) fields(d[key],names);
  record(d.extensions); const w = record(d.workflow), app = record(d.app);
  bools(w,['state_initialized','pending_calculation','restored_from_draft','draft_storage_unavailable','recovery_review_busy','project_save_busy','project_resource_busy','settlement_busy','customer_summary_busy','customer_pdf_busy']);
  strings(w,['draft_failure','recovery_review_error','recovery_stage','sensitivity_error','customer_error'],true); strings(w,['workspace_note','calculated_at']);
  if (!['beginner','professional'].includes(w.workspace_mode as string) || !count(w.recovery_review_epoch) || !Array.isArray(w.input_locations)) fail();
  strings(app,['error'],true); strings(app,['status']); if (!['info','warn','error'].includes(app.status_level as string)) fail();
  if (!count(record(d.pair_ui).review_page)) fail();
  for (const group of [d.tax_ui,d.precision_ui]) {const ui = record(group); strings(ui,['export_message','review_key','review_html']); if (!count(ui.review_generation)) fail();}
  const e = record(d.envelope_ui); strings(e,['message','business_name','review_key','review_html','workbench_message']); bools(e,['workbench_busy']);
  if (!count(e.review_generation) || !count(e.workbench_generation) || !Number.isSafeInteger(e.choice_token) || (e.choice_token as number) < -1 || Object.values(record(e.choices)).some(v => typeof v !== 'boolean')) fail();
  for (const key of ['workbench_result','workbench_candidate','workbench_confirmation','workbench_application','workbench_save_notice']) if (e[key] !== null) record(e[key]);
  if (w.recovery_review !== null) record(w.recovery_review);
  if (d.pending_control !== null) {
    const p = fields(d.pending_control,['tag','id','type','value','dataset','connected','checked','selection_start','selection_end','selected_values','bad_input','validation_message','files']);
    strings(p,['tag','id','type','value','validation_message']); bools(p,['connected','bad_input']); if (Object.values(record(p.dataset)).some(v => typeof v !== 'string') || p.checked !== null && typeof p.checked !== 'boolean') fail();
    for (const key of ['selection_start','selection_end']) if (p[key] !== null && !count(p[key])) fail();
    if (p.selected_values !== null) texts(p.selected_values);
    if(p.files!==null){if(!Array.isArray(p.files))fail();for(const file of p.files as unknown[]){const f=fields(file,['name','size','type','last_modified']);strings(f,['name','type']);if(!count(f.size)||!count(f.last_modified))fail();}}
  }
  if(typeof d.pending_present!=='boolean'||d.pending_control!==null&&d.pending_other!==null||d.pending_present!==(d.pending_control!==null||d.pending_other!==null))fail();
  if(d.pending_other!==null){const p=fields(d.pending_other,['tag','id','dataset','connected','text_content','content_editable']);strings(p,['tag','id','text_content']);bools(p,['connected','content_editable']);if(Object.values(record(p.dataset)).some(v=>typeof v!=='string'))fail();}
  const view = record(d.view); texts(view.collapsed_sections); texts(view.expanded_evidence_sections);
  return freezeRecoveryData(d as unknown as FeeRecoverySupplement);
}
/** Called only on validated, detached JSON roots. Completeness is data coverage, never trade readiness. */
export function checkFeeRecoveryConsistency(root:unknown,capture:Omit<RuntimeFeeWorkbenchCapture,'retained_json'>,supplement:FeeRecoverySupplement):void {
  const r=fields(root,FEE_RECOVERY_RETAINED_FIELDS),p=fields(r.project_file,['name','saved_at','dirty','saved_raw_known']);
  strings(p,['name','saved_at'],true);bools(p,['saved_raw_known']);
  if(supplement.workflow.state_initialized){record(r.project_raw);if(typeof p.dirty!=='boolean')fail();}
  else if(r.project_raw!==null||p.dirty!==null||capture.sources.project_json!==null)fail();
  if(p.saved_raw_known!==(capture.files.project.saved_raw!==null))fail();
  if(capture.activity.recovery!==(supplement.workflow.recovery_stage!==null||supplement.workflow.recovery_review_busy))fail();
  const pending=supplement.pending_control;
  if((r.pending_control===null)!==(pending===null))fail();
  if(pending!==null){const original=fields(r.pending_control,['tag','id','type','value','dataset','connected']);
    const pick=(d:Data)=>Object.fromEntries(['tag','id','type','value','dataset','connected'].map(k=>[k,d[k]]));
    if(canonicalFeeEnvelopeJson(pick(original))!==canonicalFeeEnvelopeJson(pick(pending)))fail();
  }
  if(supplement.workflow.pending_calculation||supplement.pending_present){
    const editor=fields(parseFeeEnvelopeJson(capture.editors.pending_input),['pending_calculation','control']);
    if(editor.pending_calculation!==supplement.workflow.pending_calculation||canonicalFeeEnvelopeJson(editor.control)!==canonicalFeeEnvelopeJson(r.pending_control))fail();
  }else if(capture.editors.pending_input!==null)fail();
  for(const name of ['bill','pair','tax','precision','envelope']){const c=fields(r[name],['file_evidence','epoch','reading','write_busy']);bools(c,['reading','write_busy']);if(!count(c.epoch))fail();}
  if(!count(r.project_read_epoch)||r.project_read_token!==null&&!count(r.project_read_token)||!count(r.settlement_epoch)||typeof r.customer_view!=='string'||typeof r.customer_reviewed!=='boolean')fail();
}
