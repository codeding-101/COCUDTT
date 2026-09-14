import type { DateStr } from './enums.js';

/**
 * 日期字符串按 YYYY-MM-DD 字典序比较，语义等同于时间先后。
 * 不要用 decimal 的比较函数处理日期。
 */
export function compareDate(a: DateStr, b: DateStr): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
