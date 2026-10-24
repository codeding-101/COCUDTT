/** Developer recovery policy. No file writer, decompressor, importer, owner mutation or financial action. */
import {FEE_ENVELOPE_BYTES} from '../src/domain/fee-envelope';
import {RECOVERY_REVIEW_MAX_BYTES} from '../src/data/recovery-review';
import type {RuntimeFeeWorkbenchCapture} from '../src/ui/fee-workbench-preview';

export const FEE_BROWSER_RECOVERY_DESIGN_LIMITS = Object.freeze({capture_semantic_bytes: FEE_ENVELOPE_BYTES, backup_raw_bytes: 256 * 1024 * 1024,
  backup_plain_bytes: 48 * 1024 * 1024, backup_encoded_bytes: 64 * 1024 * 1024, exception_review_bytes: RECOVERY_REVIEW_MAX_BYTES});
export type FeeBrowserCaptureOutcome = 'NOT_CHECKED' | 'ACCEPTED' | 'WHOLE_CAPTURE_REFUSED' | 'RETAINED_ROOT_REFUSED';
export type FeeBrowserBackupOutcome = 'NOT_CREATED' | 'DATA_GENERATED' | 'DOWNLOAD_STARTED' | 'SAVE_CANCELLED' | 'SAVE_UNCONFIRMED' | 'WRITER_ACKNOWLEDGED';
export interface FeeBrowserRecoveryFacts {capture: FeeBrowserCaptureOutcome; backup: FeeBrowserBackupOutcome}
export const FEE_BROWSER_SOURCE_KEYS = ['project','bill','pair','attachment','precision','envelope'] as const;
const source = {project: 'project_json', bill: 'bill_json', pair: 'pair_json', attachment: 'attachment_json', precision: 'precision_json'} as const;
export function planFeeBrowserRecovery(shell: Omit<RuntimeFeeWorkbenchCapture, 'retained_json'>, facts: FeeBrowserRecoveryFacts) {
  if (!['NOT_CHECKED','ACCEPTED','WHOLE_CAPTURE_REFUSED','RETAINED_ROOT_REFUSED'].includes(facts.capture) ||
    !['NOT_CREATED','DATA_GENERATED','DOWNLOAD_STARTED','SAVE_CANCELLED','SAVE_UNCONFIRMED','WRITER_ACKNOWLEDGED'].includes(facts.backup) ||
    facts.capture !== 'ACCEPTED' && facts.backup !== 'NOT_CREATED') throw Error('FEE_BROWSER_RECOVERY_INCONSISTENT_FACTS');
  const files = FEE_BROWSER_SOURCE_KEYS.map(key => {
    const raw = key === 'envelope' ? shell.envelope_json : shell.sources[source[key]], evidence = shell.files[key];
    const current = raw !== null, known = evidence.saved_raw !== null, matches = current && known ? raw === evidence.saved_raw : null;
    return Object.freeze({key, current_text_available: current, known_file_text_available: known, matches_known_file_text: matches,
      known_file_name: evidence.name !== null, historical_writer_time_known: evidence.saved_at !== null,
      state: !current ? 'CURRENT_TEXT_UNAVAILABLE' as const : !known ? 'NO_KNOWN_FILE_TEXT' as const : matches ? 'MATCHES_KNOWN_FILE_TEXT' as const : 'CURRENT_DIFFERS_FROM_KNOWN_TEXT' as const});
  });
  const pending = Object.entries(shell.editors).filter(([, value]) => value !== null).map(([key]) => key);
  return Object.freeze({kind: 'INTERNAL_FEE_BROWSER_RECOVERY_PLAN' as const, version: '0.1' as const, capture: facts.capture, backup: facts.backup,
    files: Object.freeze(files), uncommitted_editors: Object.freeze(pending), all_six_match_known_file_text: files.every(f => f.matches_known_file_text === true),
    source_file_opening: 'EXISTING_EXPLICIT_OPEN_AND_REVIEW' as const, full_workbench_reopen: 'NOT_IMPLEMENTED' as const,
    source_files_are_complete_workbench_backup: false as const, private_authority_recovered: false as const, physical_disk_verified: false as const,
    uncovered: Object.freeze(['UNCOMMITTED_INPUTS','WORKSPACE_DRAFTS_AND_RECOVERY','RAW_FX_EDIT_ROWS_AND_LEASE','BROWSER_STORAGE_AND_AVAILABILITY',
      'READ_EPOCHS_AND_PENDING_IO','CUSTOMER_REVIEW_AND_LOCAL_ASSUMPTIONS','FILE_EVIDENCE_AND_SAVE_FACTS','PRIVATE_SESSION_TOKENS'] as const),
    next: Object.freeze(['KEEP_CURRENT_WORKBENCH_OPEN','SAVE_AVAILABLE_SOURCE_FILES','RETAIN_UNCOMMITTED_INPUTS_SEPARATELY','FULL_WORKBENCH_RESTORE_NOT_AVAILABLE'] as const),
    financial_writes: 0 as const, import_authority: false as const, confirmation_authority: false as const, runtime_integrated: false as const});
}
