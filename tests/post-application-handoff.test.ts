import {afterEach, describe, expect, it, vi} from 'vitest';
import {transactionFixture} from './fixtures/fee-transaction';
import {runtimeCandidateFixture} from './fixtures/runtime-candidate';
import {previewRuntimeFeeWorkbench} from '../src/ui/fee-workbench-preview';
import {reviewFeeTaxAttachment} from '../src/data/fee-tax-attachment';
import {reviewFeePrecisionSelection} from '../src/data/fee-precision-selection';
afterEach(()=>vi.unstubAllGlobals());
describe('真实应用后显式修订与重绑，不自动改映射或重放费用', {timeout:60000},()=>{
 it('移除旧选择、加入已有引用、两份附件重绑后保留回执并撤销确认；旧目标仍悬空',async()=>{
  const f=await transactionFixture(),w=await runtimeCandidateFixture(f.raw,true),before=w.capture(),p=await previewRuntimeFeeWorkbench(before,'handoff83'),summary=await w.preparer.prepare(p),applied=await w.preparer.apply(summary,()=>true),backup=applied.backup_json;
  const original=w.pair.pair!,mapping=original.mapping.entries[0]!,costCount=w.app.project.items.length,ledger=w.capture().envelope_json;
  expect(w.pair.liveIssues()).toContain('PROJECT_SNAPSHOT_MISMATCH');
  w.pair.action('pair-remove-selection',{pairLine:mapping.line_id});expect(w.pair.pair!.retired_mappings).toContainEqual(mapping);
  w.bill.action('bill-rebind');w.bill.edit({billRow:'0',billField:'cost_reference.cost_id'},mapping.cost_id);w.bill.edit({billRow:'0',billField:'cost_reference.note'},'合成回归：明确核对已计入费用，未新增');
  for(const[key,value]of Object.entries({reference:'合成测试的当前已有费用引用依据',valid_from:'2026-10-01',valid_to:'2026-10-31',checked_on:'2026-10-17'}))w.bill.edit({billRow:'0',billField:'cost_source.'+key},value);
  w.bill.action('bill-confirm-source',{billRow:'0'});w.bill.action('bill-confirm-reference',{billRow:'0'});w.pair.action('pair-add-references');
  const ref=w.pair.pair!.mapping.entries[0]!;expect(ref.operation).toBe('REFERENCE_EXISTING');expect(ref.mapping_id).not.toBe(mapping.mapping_id);expect(ref.cost_id).toBe(mapping.cost_id);expect(w.pair.liveIssues()).toEqual([]);
  expect(await w.taxUi.controller.rebindToCurrentPair()).toBe(true);let tax=w.taxUi.controller.state().attachment!;expect(Object.values(tax.records[0]!.acknowledgements)).toEqual([null,null,null]);expect(tax.records[0]!.target).toEqual(mapping);
  const current=w.capture(),taxReview=await reviewFeeTaxAttachment(tax,current.sources.pair_json!);expect(taxReview.rows[0]!.issues).toContain('ORPHAN_TARGET');
  expect(await w.precisionUi.controller.rebindToCurrentSources()).toBe(true);const selection=w.precisionUi.controller.state().selection!;expect(selection.records[0]!.acknowledgement).toBeNull();expect(selection.records[0]!.target).toEqual(mapping);
  const after=w.capture(),precisionReview=await reviewFeePrecisionSelection(selection,after.sources.pair_json!,after.sources.attachment_json!);expect(precisionReview.rows[0]!.business_issues).toContain('ORPHAN_TARGET');
  expect(w.app.project.items.length).toBe(costCount);expect(after.envelope_json).toBe(ledger);expect(w.workflow.customerReviewed).toBe(false);expect(w.envelopeUi.applicationBackup()).toBe(backup);
  expect((await previewRuntimeFeeWorkbench(after,'handoff-blocked')).issues).toContain('WORKBENCH_SOURCES_DIFFER');
  const envelope=w.envelopeUi.controller.state().current!;expect(await w.envelopeUi.controller.updateSources(envelope.lease,after.sources)).toBe(true);
  const updated=w.capture();expect(JSON.parse(JSON.parse(updated.envelope_json!).ledger_json).receipt_refs).toHaveLength(1);expect(w.app.project.items.length).toBe(costCount);expect((await previewRuntimeFeeWorkbench(updated,'still-orphan')).status).toBe('BLOCKED');
  expect(w.envelopeUi.applicationBackup()).toBe(backup);expect(w.pair.pair!.retired_mappings).toContainEqual(mapping);expect(JSON.parse(before.sources.pair_json!).selection.intents[0].operation).toBe('CREATE_NEW');
 });
});
