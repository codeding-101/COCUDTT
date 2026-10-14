import Decimal from 'decimal.js';
import { d, type Numeric } from '../../domain/decimal.js';
import type { TaxProfile } from '../../domain/tax-profile.js';
import { EngineError } from '../errors.js';

export function isChinaImport(profile: TaxProfile): boolean {
  return profile.import.calculationMode === 'CN_GENERAL_TRADE';
}

/** 第272号令第13、19条：人民币计税价格及应纳税额舍入至分。 */
export function toFen(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function isIsoDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export function validateChinaImportContext(profile: TaxProfile, baseCurrency: string): string {
  if (baseCurrency !== 'CNY') {
    throw new EngineError('CN_IMPORT_CONTEXT_INVALID', '中国一般贸易进口模式须以 CNY 核算计税价格和税款，请将核算币种改为 CNY');
  }
  const date = profile.import.declarationDate ?? '';
  if (!isIsoDate(date)) {
    throw new EngineError('CN_IMPORT_CONTEXT_INVALID', '请填写有效的进口完成申报日期（YYYY-MM-DD），用于选择海关计征汇率');
  }
  if (date < '2024-12-01') {
    throw new EngineError('CN_IMPORT_CONTEXT_INVALID', '中国进口模式采用 2024-12-01 起施行的征税管理口径，历史申报请另行核对');
  }
  return date;
}

/** 业务输入不能通过 NaN、负数或消费税分母为零，产生看似可用的税额。 */
export function taxNumber(value: Numeric | undefined, label: string, maxExclusive?: number): Decimal {
  let number: Decimal;
  try { number = d(value as Numeric); }
  catch { throw new EngineError('TAX_INPUT_INVALID', `「${label}」须为有效的非负数`); }
  if (!number.isFinite() || number.isNegative() || (maxExclusive !== undefined && number.greaterThanOrEqualTo(maxExclusive))) {
    throw new EngineError('TAX_INPUT_INVALID', `「${label}」须为有效的非负数${maxExclusive === undefined ? '' : `，且小于 ${maxExclusive}`}`);
  }
  return number;
}
