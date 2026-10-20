import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {renderFeeWorkflowGuide, feeWorkflowTarget, feeWorkflowIssueTarget} from '../src/ui/fee-workflow-guide';
import {previewRuntimeFeeWorkbench} from '../src/ui/fee-workbench-preview';
import {runtimeCandidateFixture} from './fixtures/runtime-candidate';
import {transactionFixture, batchFixture} from './fixtures/fee-transaction';
import {adoptLegacyFeeEnvelope, serializeFeeEnvelope} from '../src/data/fee-envelope';

let fixture: Awaited<ReturnType<typeof transactionFixture>>;
beforeAll(async () => {fixture = await transactionFixture();}, 30000);
afterEach(() => {vi.unstubAllGlobals();});
describe('费用操作导航使用实际核对结果，不成为财务或来源权限', {timeout: 60000}, () => {
  it('未检查和忙碌时不把已有资料或八步说明呈现为业务通过', () => {
    const html = renderFeeWorkflowGuide(null, true, null);
    expect(html.match(/data-fee-workflow-step=/g)).toHaveLength(8);
    expect(html).toContain('尚无当前完整检查'); expect(html).not.toContain('本次完整预览通过');
    expect(html).toContain('data-action="fee-envelope-workbench-preview" disabled');
    expect(html).not.toContain('data-action="fee-envelope-workbench-apply"');
  });
  it.each(['new', 'reference', 'mixed'] as const)('%s 实际完整预览只展示检查状态，十组状态、文件、客户确认与缓存保持', async kind => {
    const f = kind === 'mixed' ? await batchFixture(true) : kind === 'reference' ? await transactionFixture('113', '1.0', true) : fixture;
    const w = await runtimeCandidateFixture(f.raw, true), before = JSON.stringify(w.capture()), checkpoint = w.owner.checkpoint();
    const result = await previewRuntimeFeeWorkbench(w.capture(), 'guide-' + kind);
    expect(result.status).toBe('STAGED'); const html = renderFeeWorkflowGuide(result, false, null);
    expect(html).toContain('本次完整预览通过；尚未应用'); expect(html).toContain('已有原文，仍须核对');
    expect(JSON.stringify(w.capture())).toBe(before); expect(w.owner.isCurrent(checkpoint)).toBe(true);
    expect(w.workflow.customerReviewed).toBe(true); expect(w.setItem).not.toHaveBeenCalled(); expect(w.compareAndSet).not.toHaveBeenCalled(); expect(w.write).not.toHaveBeenCalled();
    expect(html).not.toContain('KEEP_CUSTOMER80'); expect(html).not.toContain('KEEP_SETTLEMENT80'); expect(html).not.toContain('pair_snapshot_json');
  });
  it('真实缺少账单与未提交编辑分别保留待办和导航，不以到达页面代替确认', async () => {
    const w = await runtimeCandidateFixture(fixture.raw), c = structuredClone(w.capture());
    c.sources.bill_json = null; c.editors.attachment = 'broken {';
    const r = await previewRuntimeFeeWorkbench(c, 'missing'), html = renderFeeWorkflowGuide(r, false, null);
    expect(r.status).toBe('BLOCKED'); expect(html).toContain('缺少资料'); expect(html).toContain('MISSING_BILL'); expect(html).toContain('UNCOMMITTED_ATTACHMENT');
    expect(feeWorkflowIssueTarget('MISSING_BILL')).toBe('bill'); expect(feeWorkflowIssueTarget('UNCOMMITTED_ATTACHMENT')).toBe('attachment');
    expect(html).not.toContain('本次完整预览通过'); expect(c.editors.attachment).toBe('broken {');
  });
  it('真实历史未知仍阻断，导航说明不重写历史或提示复制以绕过', async () => {
    const w = await runtimeCandidateFixture(fixture.raw), c = structuredClone(w.capture());
    c.envelope_json = await serializeFeeEnvelope(await adoptLegacyFeeEnvelope(fixture.sources));
    const r = await previewRuntimeFeeWorkbench(c, 'unknown-history'), raw = c.envelope_json;
    expect(r.issues).toContain('HISTORY_NOT_ESTABLISHED');
    const html = renderFeeWorkflowGuide(r, false, null); expect(html).toContain('不能用来绕过旧业务历史'); expect(html).not.toContain('本次完整预览通过'); expect(c.envelope_json).toBe(raw);
  });
  it('真实应用后显示历史交接提醒，原来源、未知利润和客户旧确认的撤销保持', async () => {
    const w = await runtimeCandidateFixture(fixture.raw), before = w.capture(), p = await previewRuntimeFeeWorkbench(before, 'guide-applied'), summary = await w.preparer.prepare(p);
    const a = await w.preparer.apply(summary, () => true), current = w.capture();
    const html = renderFeeWorkflowGuide(null, false, a);
    expect(html).toContain('当时的事实'); expect(html).toContain('不证明后来修改或切换'); expect(html).toContain('分别另存项目、封套');
    expect(a.after.seller_profit).toBeNull(); expect(html).toContain('原利润未知仍为未知'); expect(w.workflow.customerReviewed).toBe(false);
    for (const key of ['pair_json', 'attachment_json', 'precision_json'] as const) expect(current.sources[key]).toBe(before.sources[key]);
    expect(html).not.toContain('INTERNAL_RUNTIME_FEE_APPLICATION_BACKUP'); expect(html).not.toContain('本次完整预览通过');
  });
  it('原文证据严格比较，不把已打开、下载发起、未知名或排版差异当成本轮另存', async () => {
    const w = await runtimeCandidateFixture(fixture.raw), c = structuredClone(w.capture());
    c.files.project = {name: null, saved_raw: c.sources.project_json, saved_at: null};
    c.files.bill = {name: 'old.json', saved_raw: c.sources.bill_json + '\n', saved_at: '2026-10-01'};
    const r = await previewRuntimeFeeWorkbench(c, 'file-evidence'), html = renderFeeWorkflowGuide(r, false, null);
    expect(html).toContain('项目：与已打开 / 已另存的原文证据相同；文件名未知'); expect(html).toContain('账单：缺少相同原文的打开 / 另存证据；old.json');
    expect(html).toContain('打开证据不等于本轮另存'); expect(html).toContain('下载发起不证明文件已落盘');
  });
  it('未知诊断、文件名和批次名转义，不泄露完整文件原文或恢复备份', async () => {
    const w = await runtimeCandidateFixture(fixture.raw), c = structuredClone(w.capture()); c.blockers.push('<img src=x onerror=alert(1)>'); c.files.project.name = '<svg onload=alert(2)>.json';
    const r = await previewRuntimeFeeWorkbench(c, 'escape'), html = renderFeeWorkflowGuide(r, false, {transaction_id: '<script>evil</script>', costs_added: 1, references_recorded: 0});
    expect(html).not.toMatch(/<img|<svg|<script>/); expect(html).toContain('&lt;img'); expect(html).toContain('&lt;svg'); expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('KEEP_CUSTOMER80');
    expect(feeWorkflowIssueTarget('<img src=x onerror=alert(1)>')).toBe('preview');
  });
  it.each(['__proto__', 'constructor', 'prototype', 'bill"] button', '', null, {}])('导航拒绝任意选择器和继承键 %s', key => {expect(feeWorkflowTarget(key)).toBeNull();});
  it('所有导航都指向固定的现有面板，不执行保存、确认或重绑', () => {
    for (const key of ['bill','pair','attachment','precision','envelope','preview','guide','customer']) {
      const target = feeWorkflowTarget(key)!; expect(target).not.toBeNull(); expect(target.selector).toMatch(/ > summary$/); expect(target.selector).not.toMatch(/apply|adopt|rebind|save/);
    }
  });
});
