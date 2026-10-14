import type Decimal from 'decimal.js';

/** 在实际计算处记录操作数与最终值；展示层不得重新求值或推断税率。 */
export interface CalculationStep {
  id: string;
  label: string;
  formula: string;
  substitution: string;
  value: Decimal | null;
  note?: string;
}

export interface CalculationGroup {
  id: string;
  label: string;
  steps: CalculationStep[];
}
