import {afterEach, describe, expect, it, vi} from 'vitest';
import {transactionFixture} from './fixtures/fee-transaction';
import {runtimeCandidateFixture} from './fixtures/runtime-candidate';
import {previewRuntimeFeeWorkbench} from '../src/ui/fee-workbench-preview';
import {reviewFeeTaxAttachment} from '../src/data/fee-tax-attachment';
import {reviewFeePrecisionSelection} from '../src/data/fee-precision-selection';
import {parseFeeEnvelope} from '../src/data/fee-envelope';
import {parseFeeTaxAttachment} from '../src/data/fee-tax-attachment';
import {parseFeePrecisionSelection} from '../src/data/fee-precision-selection';
import {renderFeeWorkflowGuide} from '../src/ui/fee-workflow-guide';

afterEach(() => vi.unstubAllGlobals());

async function appliedReference() {
  const f = await transactionFixture(), w = await runtimeCandidateFixture(f.raw, true);
  const preview = await previewRuntimeFeeWorkbench(w.capture(), 'requote-first');
  const first = await w.preparer.apply(await w.preparer.prepare(preview), () => true);
  const original = w.capture(), oldMapping = w.pair.pair!.mapping.entries[0]!;
  const oldTax = w.taxUi.controller.state().attachment!.records[0]!;
  const oldPrecision = w.precisionUi.controller.state().selection!.records[0]!;
  w.pair.action('pair-remove-selection', {pairLine: oldMapping.line_id});
  w.bill.action('bill-rebind');
  w.bill.edit({billRow: '0', billField: 'cost_reference.cost_id'}, oldMapping.cost_id);
  w.bill.edit({billRow: '0', billField: 'cost_reference.note'}, '合成软件验收：已有费用只引用');
  for (const [key, value] of Object.entries({reference: '合成已有费用定位', valid_from: '2026-10-01', valid_to: '2026-10-31', checked_on: '2026-10-17'})) {
    w.bill.edit({billRow: '0', billField: 'cost_source.' + key}, value);
  }
  w.bill.action('bill-confirm-source', {billRow: '0'});
  w.bill.action('bill-confirm-reference', {billRow: '0'});
  w.pair.action('pair-add-references');
  expect(w.pair.liveIssues()).toEqual([]);
  expect(await w.taxUi.controller.rebindToCurrentPair()).toBe(true);
  return {w, first, original, oldMapping, oldTax, oldPrecision};
}

async function replaceTax(s: Awaited<ReturnType<typeof appliedReference>>) {
  const {w, oldTax} = s, tax = w.taxUi.controller;
  expect(await tax.removeRecord(oldTax.record_id)).toBe(true);
  expect(tax.beginEdit()).toBe(true);
  expect(tax.editText(JSON.stringify({target: w.pair.pair!.mapping.entries[0], input: oldTax.input, sources: oldTax.sources}))).toBe(true);
  expect(await tax.submitEditor()).toBe(true);
  return tax.state().attachment!.records[0]!;
}

async function replacePrecision(s: Awaited<ReturnType<typeof appliedReference>>, component: string) {
  const {w, oldPrecision} = s, precision = w.precisionUi.controller;
  expect(await precision.rebindToCurrentSources()).toBe(true);
  expect(await precision.removeRecord(oldPrecision.record_id)).toBe(true);
  expect(precision.beginEdit()).toBe(true);
  expect(precision.editText(JSON.stringify({component_record_id: component, channel: 'cash', choice: oldPrecision.choice}))).toBe(true);
  expect(await precision.submitEditor()).toBe(true);
  return precision.state().selection!.records[0]!;
}

async function syncEnvelope(w: Awaited<ReturnType<typeof runtimeCandidateFixture>>) {
  const capture = w.capture(), current = w.envelopeUi.controller.state().current!;
  expect(await w.envelopeUi.controller.updateSources(current.lease, capture.sources)).toBe(true);
}

async function confirmNewRecords(s: Awaited<ReturnType<typeof appliedReference>>, skip?: 'credit' | 'precision') {
  const tax = await replaceTax(s);
  for (const facet of ['tax', 'credit', 'customs'] as const) if (facet !== skip) expect(await s.w.taxUi.controller.acknowledge(tax.record_id, facet)).toBe(true);
  const precision = await replacePrecision(s, tax.record_id);
  if (skip !== 'precision') expect(await s.w.precisionUi.controller.acknowledge(precision.record_id)).toBe(true);
  return {tax, precision};
}

describe('应用后的新记录与再次核对引用', {timeout: 60000}, () => {
  it('显式替换两种记录并重新确认后仅记录引用回执，费用与金额保持', async () => {
    const s = await appliedReference(), {w} = s, tax = await replaceTax(s);
    expect(tax.record_id).not.toBe(s.oldTax.record_id);
    expect(Object.values(tax.acknowledgements)).toEqual([null, null, null]);
    expect(w.taxUi.controller.state().attachment!.retired_record_ids).toContain(s.oldTax.record_id);
    for (const facet of ['tax', 'credit', 'customs'] as const) expect(await w.taxUi.controller.acknowledge(tax.record_id, facet)).toBe(true);
    const precision = await replacePrecision(s, tax.record_id);
    expect(precision.record_id).not.toBe(s.oldPrecision.record_id);
    expect(precision.acknowledgement).toBeNull();
    expect(w.precisionUi.controller.state().selection!.retired_record_ids).toContain(s.oldPrecision.record_id);
    expect(await w.precisionUi.controller.acknowledge(precision.record_id)).toBe(true);
    const capture = w.capture();
    expect((await reviewFeeTaxAttachment(w.taxUi.controller.state().attachment!, capture.sources.pair_json!)).rows[0]!.issues).toEqual([]);
    expect((await reviewFeePrecisionSelection(w.precisionUi.controller.state().selection!, capture.sources.pair_json!, capture.sources.attachment_json!)).rows[0]!.business_issues).toEqual([]);
    await syncEnvelope(w);
    const preview = await previewRuntimeFeeWorkbench(w.capture(), 'requote-reference');
    expect(preview.issues).toEqual([]);
    expect(preview.status).toBe('STAGED');
    const summary = await w.preparer.prepare(preview);
    expect(summary.costs_added).toBe(0); expect(summary.before).toEqual(summary.after);
    const second = await w.preparer.apply(summary, () => true);
    expect(second.references_recorded).toBe(1);
    expect(w.capture().sources.project_json).toBe(s.original.sources.project_json);
    const oldReceipts = JSON.parse(JSON.parse(s.original.envelope_json!).ledger_json).receipt_refs;
    const receipts = JSON.parse(JSON.parse(w.capture().envelope_json!).ledger_json).receipt_refs;
    expect(receipts).toHaveLength(2); expect(receipts[0]).toEqual(oldReceipts[0]);
    expect(w.workflow.customerReviewed).toBe(false);
    expect(second.after.seller_profit).toBeNull();
    await expect(w.preparer.apply(summary, () => true)).rejects.toThrow();
    expect(JSON.parse(JSON.parse(w.capture().envelope_json!).ledger_json).receipt_refs).toEqual(receipts);
  });

  it.each(['credit', 'precision'] as const)('新记录缺少%s确认时完整预览仍阻断，旧回执和原金额保持', async missing => {
    const s = await appliedReference(); await confirmNewRecords(s, missing); await syncEnvelope(s.w);
    const before = s.w.capture(), preview = await previewRuntimeFeeWorkbench(before, 'missing-' + missing);
    expect(preview.status).toBe('BLOCKED'); expect(preview.issues.length).toBeGreaterThan(0);
    expect(s.w.capture()).toEqual(before);
    expect(before.sources.project_json).toBe(s.original.sources.project_json);
    expect(JSON.parse(JSON.parse(before.envelope_json!).ledger_json).receipt_refs).toHaveLength(1);
    const html = renderFeeWorkflowGuide(preview, false, s.first);
    expect(html).toContain('data-fee-workflow-requote'); expect(html).not.toContain('本次完整预览通过');
    expect(html).not.toContain('data-action="fee-envelope-workbench-apply"');
  });

  it('新记录的正式JSON交接保留退休编号及原历史，重新打开仍待本次客户确认', async () => {
    const s = await appliedReference(); await confirmNewRecords(s); await syncEnvelope(s.w);
    const capture = s.w.capture(), tax = await parseFeeTaxAttachment(capture.sources.attachment_json!);
    const precision = await parseFeePrecisionSelection(capture.sources.precision_json!);
    expect(tax.retired_record_ids).toContain(s.oldTax.record_id);
    expect(precision.retired_record_ids).toContain(s.oldPrecision.record_id);
    const envelope = await parseFeeEnvelope(capture.envelope_json!);
    expect(JSON.parse(envelope.ledger_json).receipt_refs).toHaveLength(1);
    const opened = await runtimeCandidateFixture(capture.envelope_json!, true);
    // The fixture intentionally supplies an old customer review; preparing is read-only,
    // and the actual reference application must revoke it again.
    const preview = await previewRuntimeFeeWorkbench(opened.capture(), 'reopened-reference');
    expect(preview.status).toBe('STAGED');
    const record = await opened.preparer.apply(await opened.preparer.prepare(preview), () => true);
    expect(record.costs_added).toBe(0); expect(record.references_recorded).toBe(1);
    expect(record.after).toEqual(record.before); expect(opened.workflow.customerReviewed).toBe(false);
    expect(opened.capture().sources.project_json).toBe(capture.sources.project_json);
  });

  it('再次确认期间成分编辑使旧候选失效，最新编辑与原应用备份保持', async () => {
    const s = await appliedReference(), {tax} = await confirmNewRecords(s); await syncEnvelope(s.w);
    const preview = await previewRuntimeFeeWorkbench(s.w.capture(), 'stale-requote'), candidate = await s.w.preparer.prepare(preview);
    expect(s.w.taxUi.controller.beginEdit(tax.record_id)).toBe(true);
    const edited = {...tax.input, line_id: 'explicit-new-edit-84'};
    expect(s.w.taxUi.controller.editText(JSON.stringify({target: tax.target, input: edited, sources: tax.sources}))).toBe(true);
    const before = s.w.capture();
    await expect(s.w.preparer.apply(candidate, () => true)).rejects.toThrow('STALE');
    expect(s.w.capture()).toEqual(before); expect(s.w.envelopeUi.applicationBackup()).toBe(s.first.backup_json);
    expect(JSON.parse(JSON.parse(before.envelope_json!).ledger_json).receipt_refs).toHaveLength(1);
  });
});
