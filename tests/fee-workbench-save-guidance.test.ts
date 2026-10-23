import {afterEach, describe, expect, it, vi} from 'vitest';
import {FeeEnvelopeWorkspace} from '../src/ui/fee-envelope-workspace';
import {feeWorkflowTarget} from '../src/ui/fee-workflow-guide';
import {renderFeeWorkbenchSaveGuidance, type FeeWorkbenchSaveNotice} from '../src/ui/fee-workbench-save-guidance';
import {WorkbenchStateOwner} from '../src/ui/workbench-state';
import type {RuntimeFeeWorkbenchCapture} from '../src/ui/fee-workbench-preview';
import * as backupModule from '../src/data/runtime-fee-backup';

const deferred = <T>() => {let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((ok, bad) => {resolve = ok; reject = bad;}); return {promise, resolve, reject};};
function setup() {
  const input: RuntimeFeeWorkbenchCapture = {
    scope: 'RUNTIME_FEE_WORKBENCH_CAPTURE', envelope_json: null,
    sources: {project_json: null, bill_json: null, pair_json: null, attachment_json: null, precision_json: null},
    fx: {rows_json: '[]', preserved_row_key: null, preserved_books_json: null},
    files: Object.fromEntries(['project','bill','pair','attachment','precision','envelope'].map(key => [key, {name: null, saved_raw: null, saved_at: null}])) as RuntimeFeeWorkbenchCapture['files'],
    editors: {cost: null, review: null, attachment: 'PRIVATE93 unfinished {', precision: null, pending_input: ''},
    activity: {project_read: false, bill_read: false, pair_read: false, attachment_mutation: false, precision_mutation: false, recovery: false},
    retained_json: '{"customer_reviewed":true,"unknown":null,"private":"PRIVATE93 原文😀"}', blockers: [],
  };
  const owner = new WorkbenchStateOwner(), capture = vi.fn(() => input), getItem = vi.fn(() => null), compareAndSet = vi.fn(() => true);
  const write = vi.fn(async (_name: string, _raw: string | Uint8Array<ArrayBuffer>, _mime: string): Promise<'SAVED' | 'DOWNLOAD_STARTED'> => 'SAVED');
  let blocked = false;
  const panel = new FeeEnvelopeWorkspace({stateOwner: owner, storage: {getItem, compareAndSet}, cacheWritable: true, blocked: () => blocked, currentSources: () => null, captureWorkbench: capture, write});
  const controllerData = () => {const {message: _, ...data} = panel.controller.state(); return JSON.stringify(data);};
  const before = JSON.stringify(input), checkpoint = owner.checkpoint(), controllerBefore = controllerData();
  // Display/operation fields deliberately advance the bound owner; cancellation may update its status text.
  const unchanged = (actionRan = true) => {expect(JSON.stringify(input)).toBe(before); expect(controllerData()).toBe(controllerBefore); expect(owner.isCurrent(checkpoint)).toBe(!actionRan); expect(getItem).not.toHaveBeenCalled(); expect(compareAndSet).not.toHaveBeenCalled();};
  return {panel, input, capture, write, unchanged, setBlocked: (v: boolean) => {blocked = v;}, action: (key: string) => panel.action('fee-envelope-workbench-' + key, {})};
}
afterEach(() => vi.restoreAllMocks());
describe('完整检查与备份失败后的保存指引', () => {
  it('原严格复制拒绝超深状态时保留输入、客户状态和原入口，不误报业务通过', async () => {
    const t = setup(); let deep: unknown = 'PRIVATE93'; for (let i = 0; i < 34; i++) deep = {child: deep};
    t.capture.mockImplementation(() => ({...t.input, deep}) as RuntimeFeeWorkbenchCapture);
    await t.action('preview'); const html = t.panel.render();
    expect(html).toContain('完整检查未完成'); expect(html).toContain('整份检查备份也可能无法生成');
    expect(html).toContain('data-fee-workbench-save-guidance'); expect(html).not.toContain('data-fee-workbench-confirmation');
    expect(html).not.toContain('data-fee-workbench-candidate'); expect(html).not.toContain('PRIVATE93'); expect(t.write).not.toHaveBeenCalled(); t.unchanged();
  });
  it('捕获失败时检查备份不调用写入器，提示显示在原工作台状态区', async () => {
    const t = setup(); t.capture.mockImplementation(() => {throw Error('FEE_ENVELOPE_INVALID:STRICT_JSON PRIVATE93');});
    await t.action('backup'); const html = t.panel.render();
    expect(html).toMatch(/data-fee-workbench-status>工作台检查备份未生成/); expect(html).toContain('六类 JSON 不等于完整工作台备份');
    expect(t.write).not.toHaveBeenCalled(); expect(html).not.toContain('PRIVATE93'); t.unchanged();
  });
  it('编码失败与捕获失败都在写入前停止，不建议反复生成同一整份备份', async () => {
    const t = setup(); vi.spyOn(backupModule, 'encodeRuntimeFeeBackup').mockImplementation(() => {throw Error('RUNTIME_BACKUP_RAW_SIZE PRIVATE93');});
    await t.action('backup'); expect(t.panel.render()).toContain('检查备份未生成：逐份保留源文件');
    expect(t.write).not.toHaveBeenCalled(); t.unchanged();
  });
  it.each([Object.assign(Error('PRIVATE93 cancelled'), {name: 'AbortError'}), new DOMException('PRIVATE93 cancelled', 'AbortError')])('原生和普通取消异常都不标记文件已保存 %#', async error => {
    const t = setup(); t.write.mockRejectedValue(error); await t.action('backup');
    const html = t.panel.render(); expect(html).toContain('已取消工作台检查备份另存'); expect(html).toContain('不标记项目或封套已保存');
    expect(html).not.toContain('已另存点击时'); expect(html).not.toContain('PRIVATE93'); t.unchanged();
  });
  it.each(['throw', 'invalid-result'] as const)('保存%s保持未确认，不把异常消息或任意返回值当成功', async kind => {
    const t = setup(); if (kind === 'throw') t.write.mockRejectedValue(Error('PRIVATE93 disk <img onerror=bad()>')); else t.write.mockResolvedValue('PRIVATE93' as 'SAVED');
    await t.action('backup'); const html = t.panel.render();
    expect(html).toContain('无法确认文件已保存'); expect(html).toContain('请核对目标文件后重试'); expect(html).not.toContain('PRIVATE93');
    expect(html).not.toContain('已另存点击时'); expect(html).not.toContain('已发起内部检查资料下载'); t.unchanged();
  });
  it.each(['SAVED', 'DOWNLOAD_STARTED'] as const)('成功返回%s仍不更改六类源文件证据或客户确认', async status => {
    const t = setup(); t.write.mockResolvedValue(status); await t.action('backup');
    const raw = t.write.mock.calls[0]![1] as string, saved = JSON.parse(raw);
    expect(saved.capture).toEqual(t.input); expect(saved).toMatchObject({financial_writes: 0, import_authority: false});
    expect(t.panel.render()).toContain(status === 'SAVED' ? '当前项目保存状态保持' : '不标记项目或封套已保存');
    expect(t.panel.render()).not.toContain('data-fee-workbench-save-guidance'); t.unchanged();
  });
  it.each(['SAVED', 'DOWNLOAD_STARTED', 'cancel', 'failure'] as const)('取消及ABA变化之后，迟到%s不覆盖新状态', async outcome => {
    const t = setup(), gate = deferred<'SAVED' | 'DOWNLOAD_STARTED'>(); t.write.mockImplementation(() => gate.promise);
    const pending = t.action('backup'); await vi.waitFor(() => expect(t.write).toHaveBeenCalledTimes(1));
    t.panel.externalChanged(); t.panel.externalChanged(); await t.action('cancel');
    if (outcome === 'cancel') gate.reject(Object.assign(Error('PRIVATE93'), {name: 'AbortError'}));
    else if (outcome === 'failure') gate.reject(Error('PRIVATE93')); else gate.resolve(outcome);
    await pending; const html = t.panel.render();
    expect(html).toContain('本次预览已清除'); expect(html).not.toContain('已另存点击时'); expect(html).not.toContain('无法确认文件已保存');
    expect(html).not.toContain('data-fee-workbench-save-guidance'); expect(t.panel.workbenchCapture().exporting).toBe(false); t.unchanged();
  });
  it('另存期间连点只调用一次写入器，保留点击时完整输入', async () => {
    const t = setup(), gate = deferred<'SAVED'>(); t.write.mockImplementation(() => gate.promise);
    const pending = t.action('backup'); await vi.waitFor(() => expect(t.write).toHaveBeenCalledTimes(1));
    await t.action('backup'); expect(t.write).toHaveBeenCalledTimes(1); expect(t.capture).toHaveBeenCalledTimes(1);
    gate.resolve('SAVED'); await pending; expect(JSON.parse(t.write.mock.calls[0]![1] as string).capture).toEqual(t.input); t.unchanged();
  });
  it('失败后可明确重试备份和检查，成功不沿用旧失败说明', async () => {
    const t = setup(); t.capture.mockImplementationOnce(() => {throw Error('PRIVATE93');});
    await t.action('backup'); expect(t.panel.render()).toContain('data-fee-workbench-save-guidance');
    await t.action('backup'); expect(t.write).toHaveBeenCalledTimes(1); expect(t.panel.render()).not.toContain('data-fee-workbench-save-guidance');
    t.capture.mockImplementationOnce(() => {throw Error('PRIVATE93');}); await t.action('preview');
    expect(t.panel.render()).toContain('data-fee-workbench-save-guidance'); await t.action('preview');
    expect(t.panel.render()).toContain('暂不能形成完整候选'); expect(t.panel.render()).not.toContain('data-fee-workbench-save-guidance'); t.unchanged();
  });
  it('故障恢复阻断状态不启动新捕获或保存', async () => {
    const t = setup(); t.setBlocked(true); await t.action('backup'); await t.action('preview');
    expect(t.capture).not.toHaveBeenCalled(); expect(t.write).not.toHaveBeenCalled(); t.unchanged(false);
  });
});

describe('六类源文件导航只定位原控件', () => {
  it.each(['CHECK_UNAVAILABLE','BACKUP_UNAVAILABLE','SAVE_CANCELLED','SAVE_UNCONFIRMED'] as const)('%s不读取原文、不产生确认或直接另存动作', notice => {
    const html = renderFeeWorkbenchSaveGuidance(notice);
    expect(html.match(/data-action="fee-workflow-go"/g)).toHaveLength(6);
    expect(html).not.toMatch(/data-action="(?:save|bill-save|pair-save|fee-tax-save|fee-precision-save|fee-envelope-save|[^" ]*apply|[^" ]*adopt)"/);
    expect(html).toContain('不包含全部未提交状态'); expect(html).toContain('内部资料请勿直接发送客户');
  });
  it.each([['project','save'],['bill','bill-save'],['pair','pair-save'],['attachment','fee-tax-save'],['precision','fee-precision-save'],['envelope','fee-envelope-save']])('定位%s使用固定原另存按钮', (target, action) => {
    expect(feeWorkflowTarget('save-' + target)?.selector).toBe('[data-action="' + action + '"]');
  });
  it('未知输入及继承键不能变成HTML、任意选择器或新操作', () => {
    expect(renderFeeWorkbenchSaveGuidance(null)).toBe('');
    for (const value of ['__proto__', '<img onerror=bad()>', 'save-project"] button']) {
      expect(renderFeeWorkbenchSaveGuidance(value as FeeWorkbenchSaveNotice)).toBe(''); expect(feeWorkflowTarget(value)).toBeNull();
    }
  });
});
