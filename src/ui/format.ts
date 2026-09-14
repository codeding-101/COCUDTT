import { toDisplay, type Numeric } from '../domain/decimal.js';
import type { Warning } from '../domain/warning.js';

/** 千分位分组：758100.00 → 758,100.00 */
function group(signed: string): string {
  const negative = signed.startsWith('-');
  const body = negative ? signed.slice(1) : signed;
  const [intPart = '', fracPart] = body.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fracPart !== undefined ? `.${fracPart}` : ''}`;
}

/** 金额：千分位 + 两位小数 */
export function dec(value: Numeric | undefined | null, scale = 2): string {
  if (value === undefined || value === null) return '—';
  return group(toDisplay(value, scale));
}

/** 比率，保留四位小数 */
export function pct(value: Numeric | undefined | null): string {
  if (value === undefined || value === null) return '—';
  return group(toDisplay(value, 4));
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const LEVEL_LABEL: Record<Warning['level'], string> = {
  ERROR: '错误',
  WARN: '提示',
  INFO: '说明',
};

export function warningClass(level: Warning['level']): string {
  return level === 'ERROR' ? 'warn-error' : level === 'WARN' ? 'warn-warn' : 'warn-info';
}

export function levelLabel(level: Warning['level']): string {
  return LEVEL_LABEL[level];
}
