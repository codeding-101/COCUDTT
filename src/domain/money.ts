import type { CurrencyCode } from './enums.js';
import type { Numeric } from './decimal.js';

/**
 * 带币种的金额。落盘时 amount 使用 decimal 模块的 toStorage() 输出字符串，
 * 保证无浮点误差且可读。
 */
export interface Money {
  amount: Numeric;
  currency: CurrencyCode;
}
