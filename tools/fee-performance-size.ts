/** Exact UTF-8 size of ordinary JSON data, without materializing a second huge escaped string. Not a validator or capture API. */
export function projectedJsonBytes(value: unknown): number {
  const stringBytes = (text: string) => {
    let size = Buffer.byteLength(text, 'utf8') + 2;
    for (const match of text.matchAll(/["\\\u0000-\u001f\ud800-\udfff]/g)) {
      const at = match.index, point = text.charCodeAt(at);
      if (point >= 0xd800 && point <= 0xdbff && text.charCodeAt(at + 1) >= 0xdc00 && text.charCodeAt(at + 1) <= 0xdfff) continue;
      if (point >= 0xdc00 && point <= 0xdfff && text.charCodeAt(at - 1) >= 0xd800 && text.charCodeAt(at - 1) <= 0xdbff) continue;
      size += point >= 0xd800 && point <= 0xdfff ? 3 : point < 32 && ![8, 9, 10, 12, 13].includes(point) ? 5 : 1;
    }
    return size;
  };
  const visit = (v: unknown): number => {
    if (v === null) return 4;
    if (typeof v === 'string') return stringBytes(v);
    if (typeof v === 'boolean') return v ? 4 : 5;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v).length;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) if (!Object.hasOwn(v, i)) throw Error('PERFORMANCE_SIZE_JSON_ONLY');
      return 2 + Math.max(0, v.length - 1) + v.reduce((sum: number, item) => sum + visit(item), 0);
    }
    if (v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v))) {
      const entries = Object.entries(v); return 2 + Math.max(0, entries.length - 1) + entries.reduce((sum, [key, item]) => sum + stringBytes(key) + 1 + visit(item), 0);
    }
    throw Error('PERFORMANCE_SIZE_JSON_ONLY');
  };
  return visit(value);
}
