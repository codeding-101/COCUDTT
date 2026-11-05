/** Synthetic local cases only. Does not import or publish the held phase101 archive. */
import {feeReopenFixture} from './fee-recovery-reopen-cases';
import {FeeRecoveryFormat} from './fee-recovery-format';
import {FeeRecoveryReview} from './fee-recovery-review';
export type RecoveryReadingCase = 'baseline' | 'drafts' | 'bad-number' | 'unread-file' | 'other-input' | 'old-authority' | 'unknown';
export function recoveryReadingFixture(kind: RecoveryReadingCase = 'baseline') {
  const f = feeReopenFixture(), r = f.parts.retained_root as Record<string, unknown>, c = f.parts.capture_shell, s = f.supplement;
  if (kind === 'drafts') {
    c.editors.cost = '{"cost_id":"SYNTHETIC_DRAFT102","amount":"-0"}'; c.editors.review = '{"note":"未提交核对"}';
    c.editors.attachment = '{"gross":"113.123456789123"}'; c.editors.precision = '{"policy":"UNRESOLVED"}';
    r.settlement_plan = {kind: 'SYNTHETIC_PAYMENT_DRAFT', instalments: [{amount: '70'}]}; r.sensitivity = {freight: '-20'};
    r.customer_fields = {reference: 'PRIVATE_CUSTOMER102', issuer: '<img src=x onerror="window.archiveExecuted102=true">'};
    s.view.collapsed_sections = ['advanced-settings']; s.view.expanded_evidence_sections = ['fee-envelope'];
  }
  if (kind === 'bad-number' || kind === 'unread-file') {
    const control = {tag: 'INPUT', id: 'synthetic-input102', type: kind === 'bad-number' ? 'number' : 'file', value: '', dataset: {path: 'quantity'}, connected: true};
    r.pending_control = control; c.editors.pending_input = JSON.stringify({pending_calculation: false, control}); s.pending_present = true;
    s.pending_control = {...control, checked: false, selection_start: null, selection_end: null, selected_values: null,
      bad_input: kind === 'bad-number', validation_message: 'SYNTHETIC_BROWSER_BUFFER', files: kind === 'unread-file' ? [{name: 'SYNTHETIC_UNREAD102.json', size: 42, type: 'application/json', last_modified: 1}] : null};
  }
  if (kind === 'other-input') {s.pending_present = true; s.pending_other = {tag: 'DIV', id: 'synthetic-other102', dataset: {}, connected: true, text_content: '<script>window.archiveExecuted102=true</script>', content_editable: true}; c.editors.pending_input = JSON.stringify({pending_calculation: false, control: null});}
  if (kind === 'old-authority') {
    r.customer_reviewed = true; r.project_read_epoch = 3; r.project_read_token = 3; c.activity.project_read = true;
    s.envelope_ui.workbench_candidate = {pending_patches: [{amount: '999999'}]}; s.envelope_ui.workbench_confirmation = {acknowledged: true, token: 'SYNTHETIC_OLD102'};
    s.envelope_ui.workbench_application = {backup_json: 'SYNTHETIC_HISTORY_NOT_EXECUTABLE'}; s.tax_ui.review_html = '<script>window.archiveExecuted102=true</script>';
  }
  if (kind === 'unknown') {r['future/a~b'] = {opaque: -0}; Object.defineProperty(r, 'toString', {value: {opaque: 'not a policy'}, enumerable: true}); s.workflow.future_field102 = {raw: '\ufeff未知\r\n😀'}; s.extensions = {future: {amount: -0, source: '\ufeff保留\r\n😀'}};}
  return f;
}
export async function recoveryReadingWire(kind: RecoveryReadingCase = 'baseline') {
  const f = recoveryReadingFixture(kind); return new FeeRecoveryFormat().encode(f.parts, f.supplement, new AbortController().signal, {captured_at: '2026-10-28T00:00:00.000Z'});
}
export async function probeRecoveryReading() {
  const cases = [];
  for (const kind of ['baseline','drafts','bad-number','unread-file','other-input','old-authority','unknown'] as const) {
    const wire = await recoveryReadingWire(kind), review = new FeeRecoveryReview(), m = await review.stage(wire), before = review.archive();
    review.confirm(m, 'OPEN_ARCHIVE_READING_ONLY'); const a = review.archive()!, source = a.source_wire, supplement = a.supplement_json;
    for (const row of m.rows) review.markRead(m, row.id, true, 'READ_ONLY_NOT_ADOPT');
    const policies = m.rows.filter(r => r.requires_attention).map(r => r.policy);
    cases.push({id: kind, rows: m.rows.length, checks: {no_implicit_selection: before === null, exact_original_text: review.archive()!.source_wire === source && review.archive()!.supplement_json === supplement,
      all_rows_read: review.state().read_count === m.rows.length, no_installation: review.state().installation_authority === false, no_financial_write: review.state().financial_writes === 0,
      no_customer_approval: review.state().customer_reviewed === false, reentry_not_cleared: kind !== 'bad-number' && kind !== 'unread-file' || review.state().input_reentry_required,
      expected_policy: kind === 'drafts' || kind === 'other-input' ? policies.includes('REVIEW_AND_REENTER') : kind === 'old-authority' ? policies.includes('NEVER_REPLAY') : kind === 'unknown' ? policies.includes('UNKNOWN_ARCHIVE') : true}});
    review.dispose();
  }
  return {scope: 'INDEPENDENT_ARCHIVE_READING_ONLY', cases, installation_authority: false, financial_writes: 0, customer_approval: false};
}
