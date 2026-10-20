import {describe, expect, it} from 'vitest';
import {projectedJsonBytes} from '../tools/fee-performance-size';
import {durationSummary, measureFeePerformanceCase} from '../tools/fee-performance-metrics';
import {feePerformanceFixture} from '../tools/fee-performance-fixture';
import {FEE_ENVELOPE_BYTES} from '../src/domain/fee-envelope';

describe('tooling-only fee performance evidence', () => {
  it.each([
    null, true, false, 0, -0, 1e-8, 1e22,
    '中文😀€', '"\\\b\t\n\f\r\u0000\u0001\u001f',
    '\ud800', '\udfff', '\ud800\ud800\udfff\udfff',
    {'键😀"\\': ['\ud800', 4, false, null, {a: '多字节'}]},
  ])('counts exact JSON UTF-8 bytes for ordinary data %#', value => {
    expect(projectedJsonBytes(value)).toBe(Buffer.byteLength(JSON.stringify(value), 'utf8'));
  });
  it('counts the existing capture limit without its outer string and refuses incomplete arrays', () => {
    const raw = '"'.repeat(1024 * 1024), value = {copies: Array(65).fill(raw)};
    expect(projectedJsonBytes(value)).toBeGreaterThan(FEE_ENVELOPE_BYTES);
    expect(projectedJsonBytes({copies: Array(2).fill(raw)})).toBe(Buffer.byteLength(JSON.stringify({copies: Array(2).fill(raw)})));
    expect(() => projectedJsonBytes(Array(1))).toThrow('PERFORMANCE_SIZE_JSON_ONLY');
  });
  it.each([undefined, NaN, Infinity, 1n, new Date(0), {missing: undefined}])('refuses non-ordinary JSON inputs %#', value => {
    expect(() => projectedJsonBytes(value)).toThrow('PERFORMANCE_SIZE_JSON_ONLY');
  });
  it('keeps the first sample separate, preserves order and reports a real median', () => {
    const repeated = [9, 3, 5];
    expect(durationSummary(1000, repeated)).toEqual({first_ms: 1000, repeated_ms: [9, 3, 5], repeated_min_ms: 3, repeated_median_ms: 5, repeated_max_ms: 9});
    expect(repeated).toEqual([9, 3, 5]);
    expect(durationSummary(0, [2, 8]).repeated_median_ms).toBe(5);
  });
  it.each([[0, []], [-1, [1]], [0, [Infinity]], [0, [1, 2, 3, 4, 5, 6]]])('rejects invalid timing samples %#', (first, repeated) => {
    expect(() => durationSummary(first as number, repeated as number[])).toThrow('PERFORMANCE_SAMPLES');
  });
  it('rejects unsupported fixture sizes before constructing business data', async () => {
    await expect(feePerformanceFixture(0)).rejects.toThrow('PERFORMANCE_FIXTURE_COUNT');
    await expect(feePerformanceFixture(2)).rejects.toThrow('PERFORMANCE_FIXTURE_COUNT');
    await expect(measureFeePerformanceCase(1, 0)).rejects.toThrow('PERFORMANCE_REPEAT_BOUND');
  });
  it('measures the complete single-row preparation without changing fees, receipts or review', async () => {
    const report = await measureFeePerformanceCase(1, 1);
    expect(report.status).toBe('MEASURED');
    expect(report.capacity.limit_exceeded).toBe(false);
    expect(report.verified).toEqual({complete_ten_participants: true, all_rows_staged: true, original_amounts_preserved: true, synthetic_buyer_delta: true, seller_profit_remains_unknown: true, no_owner_revision_change: true, no_project_or_receipt_write: true, customer_review_unchanged: true, no_application_backup: true});
    expect(report.phases.complete_preview!.status).toBe('MEASURED');
    expect(report.phases.complete_preview!.repeated_ms).toHaveLength(1);
    expect(report.sizes.prepared_backup_utf8_bytes).toBeGreaterThan(report.sizes.envelope_utf8_bytes);
  }, 90000);
});
