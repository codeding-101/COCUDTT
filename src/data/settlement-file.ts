import type { SettlementPlan } from '../domain/settlement.js';
import { validateSettlementPlan } from '../domain/settlement-validation.js';
export function parseSettlementPlan(text: string): SettlementPlan {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw Error('付款计划：文件不是合法JSON'); }
  validateSettlementPlan(value);
  return value;
}
export function serializeSettlementPlan(plan: SettlementPlan): string {
  validateSettlementPlan(plan);
  return JSON.stringify(plan, null, 2) + '\n';
}
