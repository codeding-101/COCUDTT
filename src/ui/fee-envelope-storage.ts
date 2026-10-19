import {FEE_ENVELOPE_STORAGE_KEY, type FeeEnvelopeStorage} from './fee-envelope-controller.js';

export type FeeEnvelopeExclusive = <T>(name: string, task: () => T) => Promise<T>;
export const FEE_ENVELOPE_LOCK = FEE_ENVELOPE_STORAGE_KEY + ':exclusive';
/** Only writers using this same origin/lock cooperate. No ordinary read/write fallback. */
export function createFeeEnvelopeBrowserStorage(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, exclusive: FeeEnvelopeExclusive | null): FeeEnvelopeStorage {
  const keyOnly = (key: string) => { if (key !== FEE_ENVELOPE_STORAGE_KEY) throw Error('ENVELOPE_KEY_ONLY'); };
  return {
    getItem(key) { keyOnly(key); return storage.getItem(key); },
    async compareAndSet(key, expected, next) {
      keyOnly(key);
      if (!exclusive || expected !== null && typeof expected !== 'string' || next !== null && typeof next !== 'string') throw Error('ENVELOPE_ATOMIC_STORAGE_UNAVAILABLE');
      return exclusive(FEE_ENVELOPE_LOCK, () => {
        if (storage.getItem(key) !== expected) return false;
        if (next !== expected) { if (next === null) storage.removeItem(key); else storage.setItem(key, next); }
        if (storage.getItem(key) !== next) throw Error('ENVELOPE_STORAGE_READBACK');
        return true;
      });
    },
  };
}
