import {describe, expect, it} from 'vitest';
import {planFeeBrowserRecovery as plan, FEE_BROWSER_SOURCE_KEYS as keys, FEE_BROWSER_RECOVERY_DESIGN_LIMITS as limits} from '../tools/fee-browser-recovery-plan';
import {feeLayeredParts} from '../tools/fee-layered-capture-cases';
import {openedFileEvidence, savedFileEvidence} from '../src/ui/file-evidence';
import {encodeRuntimeFeeBackup} from '../src/data/runtime-fee-backup';
import {inspectRecoveryText} from '../src/data/recovery-review';
import {encodeFeeLayeredCapturePrototype} from '../tools/fee-layered-capture-prototype';

const facts = {capture: 'ACCEPTED', backup: 'NOT_CREATED'} as const;
function sources() {const shell = feeLayeredParts().capture_shell; for (const key of keys) {const raw = '\ufeff \r\nSYNTHETIC_PRIVATE_' + key + '😀'; if (key === 'envelope') shell.envelope_json = raw; else shell.sources[`${key}_json`] = raw; shell.files[key] = openedFileEvidence(raw, key + '.json');} return shell;}
describe('recovery design does not confuse known text, acknowledged saves and complete reopening', () => {
  it.each(keys)('compares %s as opaque original text, without normalization or input mutation', key => {
    const shell = sources(), before = JSON.stringify(shell), raw = key === 'envelope' ? shell.envelope_json! : shell.sources[`${key}_json`]!;
    const result = plan(shell, facts), row = result.files.find(f => f.key === key)!;
    expect(row).toMatchObject({state: 'MATCHES_KNOWN_FILE_TEXT', current_text_available: true, known_file_text_available: true, matches_known_file_text: true, historical_writer_time_known: false});
    shell.files[key] = openedFileEvidence(raw.trim(), key + '.json'); expect(plan(shell, facts).files.find(f => f.key === key)!.state).toBe('CURRENT_DIFFERS_FROM_KNOWN_TEXT');
    shell.files[key] = openedFileEvidence(raw, key + '.json'); expect(JSON.stringify(shell)).toBe(before); expect(Object.isFrozen(shell)).toBe(false);
  });
  it.each(keys)('retains unknown versus unavailable versus empty text for %s', key => {
    const shell = sources(); shell.files[key] = {name: null, saved_raw: null, saved_at: null}; expect(plan(shell, facts).files.find(f => f.key === key)!.state).toBe('NO_KNOWN_FILE_TEXT');
    if (key === 'envelope') shell.envelope_json = null; else shell.sources[`${key}_json`] = null;
    expect(plan(shell, facts).files.find(f => f.key === key)).toMatchObject({state: 'CURRENT_TEXT_UNAVAILABLE', matches_known_file_text: null});
    if (key === 'envelope') shell.envelope_json = ''; else shell.sources[`${key}_json`] = '';
    shell.files[key] = openedFileEvidence('', ''); expect(plan(shell, facts).files.find(f => f.key === key)).toMatchObject({state: 'MATCHES_KNOWN_FILE_TEXT', matches_known_file_text: true, known_file_name: true});
  });
  it.each(['NOT_CREATED','DATA_GENERATED','DOWNLOAD_STARTED','SAVE_CANCELLED','SAVE_UNCONFIRMED','WRITER_ACKNOWLEDGED'] as const)('%s never becomes complete-workbench or private recovery', backup => {
    const result = plan(sources(), {...facts, backup}); expect(result.all_six_match_known_file_text).toBe(true);
    expect(result).toMatchObject({backup, source_files_are_complete_workbench_backup: false, full_workbench_reopen: 'NOT_IMPLEMENTED', private_authority_recovered: false,
      physical_disk_verified: false, financial_writes: 0, import_authority: false, confirmation_authority: false, runtime_integrated: false});
    expect(result.uncovered).toContain('RAW_FX_EDIT_ROWS_AND_LEASE'); expect(result.uncovered).toContain('PRIVATE_SESSION_TOKENS');
  });
  for (const capture of ['NOT_CHECKED','WHOLE_CAPTURE_REFUSED','RETAINED_ROOT_REFUSED'] as const) {
    it.each(['DATA_GENERATED','DOWNLOAD_STARTED','SAVE_CANCELLED','SAVE_UNCONFIRMED','WRITER_ACKNOWLEDGED'] as const)(capture + ': rejects contradictory full-backup %s facts', backup => {
      expect(() => plan(sources(), {capture, backup})).toThrow('INCONSISTENT_FACTS');
    });
    it(capture + ': preserves source-file salvage without claiming a full backup', () => {const result = plan(sources(), {capture, backup: 'NOT_CREATED'}); expect(result.files).toHaveLength(6); expect(result.full_workbench_reopen).toBe('NOT_IMPLEMENTED');});
  }
  it('distinguishes opened text and historical writer acknowledgement without claiming physical disk', () => {
    const shell = sources(), raw = shell.sources.project_json!; shell.files.project = savedFileEvidence(raw, 'project.json');
    expect(plan(shell, facts).files[0]).toMatchObject({matches_known_file_text: true, historical_writer_time_known: true}); expect(plan(shell, facts).physical_disk_verified).toBe(false);
    shell.sources.project_json = raw + ' '; expect(plan(shell, facts).files[0]).toMatchObject({matches_known_file_text: false, historical_writer_time_known: true});
  });
  it('keeps empty uncommitted input distinct from null and excludes all source/field values from its summary', () => {
    const shell = sources(); shell.editors.pending_input = ''; shell.editors.cost = 'PRIVATE_COST'; const before = JSON.stringify(shell), result = plan(shell, facts);
    expect(result.uncommitted_editors).toEqual(['cost','pending_input']); expect(JSON.stringify(result)).not.toMatch(/SYNTHETIC_PRIVATE_|PRIVATE_COST|😀/); expect(JSON.stringify(shell)).toBe(before);
    expect(result.uncovered).toContain('UNCOMMITTED_INPUTS'); expect(Object.isFrozen(result.files)).toBe(true);
  });
  it('keeps the existing five different byte ceilings separate', () => {
    expect(limits).toEqual({capture_semantic_bytes: 128 * 1024 * 1024, backup_raw_bytes: 256 * 1024 * 1024, backup_plain_bytes: 48 * 1024 * 1024,
      backup_encoded_bytes: 64 * 1024 * 1024, exception_review_bytes: 5 * 1024 * 1024});
  });
  it.each([['INTERNAL_RUNTIME_FEE_WORKBENCH_CHECK_BACKUP','0.1'],['INTERNAL_RUNTIME_FEE_WORKBENCH_CHECK_BACKUP','0.2'],['INTERNAL_RUNTIME_FEE_APPLICATION_BACKUP','0.1'],['INTERNAL_RUNTIME_FEE_BACKUP_ARCHIVE','0.1']])('actual exception inspector refuses %s %s, even below 5MiB', (kind, version) => {
    const raw = JSON.stringify({kind, version, import_authority: false}); expect(encodeRuntimeFeeBackup(raw)).toBe(raw); expect(() => inspectRecoveryText(raw)).toThrow('内部恢复备份');
  });
  it('refuses the actual layered protocol in the existing exception inspector', () => {
    const wire = encodeFeeLayeredCapturePrototype(feeLayeredParts()); expect(() => inspectRecoveryText(wire)).toThrow('内部恢复备份');
  });
  it('recognizes the exception format only as structural inspection with missing parts', () => {
    const raw = JSON.stringify({kind: 'INTERNAL_RECOVERY_SNAPSHOT', version: '1.0', stage: 'INTERACTION'}), result = inspectRecoveryText(raw);
    expect(result.parts.every(p => p.status === 'MISSING')).toBe(true); expect(raw).toContain('INTERNAL_RECOVERY_SNAPSHOT');
    expect(plan(sources(), facts).full_workbench_reopen).toBe('NOT_IMPLEMENTED');
  });
});
