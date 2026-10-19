import {describe, expect, it, vi} from 'vitest';
import {createFeeEnvelopeBrowserStorage, FEE_ENVELOPE_LOCK, type FeeEnvelopeExclusive} from '../src/ui/fee-envelope-storage';
import {FEE_ENVELOPE_STORAGE_KEY as KEY} from '../src/ui/fee-envelope-controller';
function setup(available = true) {
  const map = new Map<string, string>(), storage = {getItem: vi.fn((k: string) => map.get(k) ?? null), setItem: vi.fn((k: string, v: string) => {map.set(k, v);}), removeItem: vi.fn((k: string) => {map.delete(k);})};
  let tail = Promise.resolve();
  const exclusive = vi.fn(<T>(_name: string, task: () => T) => {const p = tail.then(task); tail = p.then(() => {}, () => {}); return p;}) as FeeEnvelopeExclusive;
  const a = createFeeEnvelopeBrowserStorage(storage, available ? exclusive : null), b = createFeeEnvelopeBrowserStorage(storage, available ? exclusive : null);
  return {a, b, storage, map, exclusive};
}
describe('封套浏览器缓存适配契约', () => {
  it('构造不读写，读取只访问独立键', () => {const h = setup(); expect(h.storage.getItem).not.toHaveBeenCalled(); expect(h.a.getItem(KEY)).toBeNull(); expect(h.storage.setItem).not.toHaveBeenCalled();});
  it('两位写入者同预期值竞争，只能有一位成功', async () => {const h = setup(); expect(await Promise.all([h.a.compareAndSet(KEY, null, 'A'), h.b.compareAndSet(KEY, null, 'B')])).toEqual([true, false]); expect(h.map.get(KEY)).toBe('A'); expect(h.storage.setItem).toHaveBeenCalledTimes(1); expect(h.exclusive).toHaveBeenCalledWith(FEE_ENVELOPE_LOCK, expect.any(Function));});
  it('精确原文比较，空格换行不同不覆盖', async () => {const h = setup(); h.map.set(KEY, '\r\n RAW 😀'); expect(await h.a.compareAndSet(KEY, 'RAW 😀', 'next')).toBe(false); expect(h.map.get(KEY)).toBe('\r\n RAW 😀');});
  it('同值是无写入的成功比较，不发起多余缓存覆盖', async () => {const h = setup(); h.map.set(KEY, 'SAME'); expect(await h.a.compareAndSet(KEY, 'SAME', 'SAME')).toBe(true); expect(h.storage.setItem).not.toHaveBeenCalled();});
  it('明确移除也在同一锁内比较，不影响其他键', async () => {const h = setup(); h.map.set(KEY, 'old'); h.map.set('other', 'KEEP'); expect(await h.a.compareAndSet(KEY, 'old', null)).toBe(true); expect(h.map.has(KEY)).toBe(false); expect(h.map.get('other')).toBe('KEEP');});
  it('缺锁时只允许读取，写入与移除均无回退', async () => {const h = setup(false); h.map.set(KEY, 'old'); expect(h.a.getItem(KEY)).toBe('old'); await expect(h.a.compareAndSet(KEY, 'old', 'new')).rejects.toThrow('UNAVAILABLE'); await expect(h.a.compareAndSet(KEY, 'old', null)).rejects.toThrow(); expect(h.storage.setItem).not.toHaveBeenCalled(); expect(h.storage.removeItem).not.toHaveBeenCalled();});
  it.each(['get', 'write', 'remove'])('%s异常直接退出，不写回旧值', async kind => {const h = setup(); if (kind === 'get') h.storage.getItem.mockImplementation(() => {throw Error('denied');}); if (kind === 'write') h.storage.setItem.mockImplementation(() => {throw Error('quota');}); if (kind === 'remove') {h.map.set(KEY, 'old'); h.storage.removeItem.mockImplementation(() => {throw Error('denied');});} await expect(h.a.compareAndSet(KEY, kind === 'remove' ? 'old' : null, kind === 'remove' ? null : 'new')).rejects.toThrow(); expect(h.storage.setItem.mock.calls.length + h.storage.removeItem.mock.calls.length).toBeLessThanOrEqual(1);});
  it('读回不符不假装成功，不再二次覆盖', async () => {const h = setup(); h.storage.setItem.mockImplementation(k => {h.map.set(k, 'EXTERNAL');}); await expect(h.a.compareAndSet(KEY, null, 'new')).rejects.toThrow('READBACK'); expect(h.map.get(KEY)).toBe('EXTERNAL'); expect(h.storage.setItem).toHaveBeenCalledTimes(1);});
  it.each(['project-cache', KEY + '-other', ''])('拒绝其他缓存键%s', async key => {const h = setup(); expect(() => h.a.getItem(key)).toThrow('KEY_ONLY'); await expect(h.a.compareAndSet(key, null, 'x')).rejects.toThrow('KEY_ONLY'); expect(h.storage.getItem).not.toHaveBeenCalled();});
  it('错误类型在进入锁前拒绝，不规范化原文', async () => {const h = setup(); await expect(h.a.compareAndSet(KEY, {} as string, 'x')).rejects.toThrow(); expect(h.exclusive).not.toHaveBeenCalled();});
});
