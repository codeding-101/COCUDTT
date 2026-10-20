import {feePerformanceFixture} from './fee-performance-fixture';
import {feePerformanceHarness} from './fee-performance-harness';
import {previewRuntimeFeeWorkbench} from '../src/ui/fee-workbench-preview';
import {parseFeeEnvelope} from '../src/data/fee-envelope';
import {canonicalFeeEnvelopeJson} from '../src/data/fee-envelope-json';
import {encodeRuntimeFeeBackup} from '../src/data/runtime-fee-backup';
import {d} from '../src/domain/decimal';
import {FEE_ENVELOPE_BYTES} from '../src/domain/fee-envelope';
import {projectedJsonBytes} from './fee-performance-size';

export function durationSummary(first: number, repeated: readonly number[]) {
  if (![first, ...repeated].every(n => Number.isFinite(n) && n >= 0) || repeated.length < 1 || repeated.length > 5) throw Error('PERFORMANCE_SAMPLES');
  const sorted = [...repeated].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return {first_ms: first, repeated_ms: [...repeated], repeated_min_ms: sorted[0]!, repeated_median_ms: sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2, repeated_max_ms: sorted.at(-1)!};
}
const bytes = (text: string) => new TextEncoder().encode(text).length;
async function timed<T>(task: () => T | Promise<T>) {const start = performance.now(), value = await task(); return {ms: performance.now() - start, value};}

/** Read-only preparation; timings overlap and must not be added as independent costs. */
export async function measureFeePerformanceCase(count: number, repeats = 3) {
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5) throw Error('PERFORMANCE_REPEAT_BOUND');
  const setupStart = performance.now(), fixture = await feePerformanceFixture(count), harness = await feePerformanceHarness(fixture.raw);
  const fixture_setup_ms = performance.now() - setupStart;
  const projection = await timed(() => harness.captureInput()), projectedBytes = projectedJsonBytes(projection.value), checkpoint = harness.owner.checkpoint();
  const topBytes = Object.fromEntries(Object.entries(projection.value).map(([key, value]) => [key, projectedJsonBytes(value)]));
  const capacityLimited = projectedBytes > FEE_ENVELOPE_BYTES;
  const initial = capacityLimited ? null : harness.capture(), baseline = initial ? JSON.stringify(initial) : null;
  const envelope = JSON.parse(fixture.raw), {content_sha256, ...body} = envelope;
  const canonical = canonicalFeeEnvelopeJson(body);
  const samples: Record<string, number[]> = {controller_capture: [], canonical_sha256: [], strict_envelope_parse: [], complete_preview: [], candidate_prepare: [], capture_backup_encode: []};
  let preparedBytes = 0, plainBackupBytes = 0, encodedBackupBytes = 0;
  for (let run = 0; run <= repeats; run++) {
    const fingerprint = await timed(async () => {
      const raw = canonicalFeeEnvelopeJson(body), digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    });
    samples.canonical_sha256!.push(fingerprint.ms);
    if (fingerprint.value !== content_sha256) throw Error('PERFORMANCE_FINGERPRINT');
    const parsed = await timed(() => parseFeeEnvelope(fixture.raw)); samples.strict_envelope_parse!.push(parsed.ms);
    if (parsed.value.current_sources.pair_json !== fixture.sources.pair_json) throw Error('PERFORMANCE_SOURCE_CHANGED');
    if (capacityLimited) {
      if (!harness.owner.isCurrent(checkpoint) || harness.workflow.customerReviewed !== true || harness.envelopeUi.applicationBackup() !== null) throw Error('PERFORMANCE_READ_ONLY_INVARIANT');
      continue;
    }
    const capture = await timed(() => harness.capture()); samples.controller_capture!.push(capture.ms);
    const preview = await timed(() => previewRuntimeFeeWorkbench(capture.value, 'performance-' + count + '-' + run)); samples.complete_preview!.push(preview.ms);
    if (preview.value.status !== 'STAGED' || preview.value.rows.length !== count || preview.value.preview!.costs_added !== count) throw Error('PERFORMANCE_PREVIEW_BLOCKED:' + preview.value.issues.join(','));
    const prepared = await timed(() => harness.preparer.prepare(preview.value)); samples.candidate_prepare!.push(prepared.ms);
    if (prepared.value.participants.length !== 10 || prepared.value.costs_added !== count || !d(prepared.value.after.buyer_total).minus(prepared.value.before.buyer_total).eq(d(791).mul(count)) || prepared.value.before.seller_profit !== null || prepared.value.after.seller_profit !== null) throw Error('PERFORMANCE_FINANCIAL_INVARIANT');
    preparedBytes = bytes(harness.preparer.backup(prepared.value));
    const backup = await timed(() => {
      const raw = JSON.stringify({kind: 'INTERNAL_RUNTIME_FEE_WORKBENCH_CHECK_BACKUP', version: '0.1', capture: capture.value, financial_writes: 0, import_authority: false}, null, 2) + '\n';
      plainBackupBytes = bytes(raw); return encodeRuntimeFeeBackup(raw);
    });
    samples.capture_backup_encode!.push(backup.ms); encodedBackupBytes = bytes(backup.value);
    harness.preparer.discard(prepared.value);
    if (JSON.stringify(harness.capture()) !== baseline || !harness.owner.isCurrent(checkpoint) || harness.workflow.customerReviewed !== true || harness.envelopeUi.applicationBackup() !== null) throw Error('PERFORMANCE_READ_ONLY_INVARIANT');
  }
  return {count, status: capacityLimited ? 'CAPACITY_BLOCKED' as const : 'MEASURED' as const, fixture_setup_ms,
    capacity: {existing_limit_bytes: FEE_ENVELOPE_BYTES, projected_capture_bytes: projectedBytes, limit_exceeded: capacityLimited, oversized_capture_attempted: false, projection_once_ms: projection.ms, projection_method: 'Unprotected tooling-only input construction and exact JSON byte count; never installed or used as a preview', top_level_utf8_bytes: topBytes},
    sizes: {sources_utf8_bytes: Object.fromEntries(Object.entries(fixture.sources).map(([key, raw]) => [key, raw === null ? 0 : bytes(raw)])), envelope_utf8_bytes: bytes(fixture.raw), envelope_canonical_utf8_bytes: bytes(canonical), capture_utf8_bytes: projectedBytes, check_backup_raw_utf8_bytes: capacityLimited ? null : plainBackupBytes, check_backup_encoded_utf8_bytes: capacityLimited ? null : encodedBackupBytes, prepared_backup_utf8_bytes: capacityLimited ? null : preparedBytes},
    phases: Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, values.length ? {status: 'MEASURED', ...durationSummary(values[0]!, values.slice(1))} : {status: 'NOT_RUN_EXISTING_CAPTURE_LIMIT', first_ms: null, repeated_ms: [], repeated_min_ms: null, repeated_median_ms: null, repeated_max_ms: null}])),
    verified: {complete_ten_participants: capacityLimited ? null : true, all_rows_staged: capacityLimited ? null : true, original_amounts_preserved: true, synthetic_buyer_delta: capacityLimited ? null : true, seller_profit_remains_unknown: capacityLimited ? null : true, no_owner_revision_change: true, no_project_or_receipt_write: true, customer_review_unchanged: true, no_application_backup: true}};
}
