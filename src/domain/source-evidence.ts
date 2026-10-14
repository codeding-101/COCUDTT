/** 人工核对记录；用户确认不等于程序或海关对数据作出认证。 */
export interface SourceEvidence {
  reference: string;
  valid_from: string;
  valid_to: string;
  checked_on: string;
  status: 'EXAMPLE' | 'UNVERIFIED' | 'USER_CONFIRMED';
  /** 核对时的数据与来源快照，用于识别导入文件中已被改动的记录；不是认证签名。 */
  values_key?: string;
}

export function emptyEvidence(): SourceEvidence {
  return { reference: '', valid_from: '', valid_to: '', checked_on: '', status: 'UNVERIFIED' };
}

export function invalidateEvidence(evidence: SourceEvidence | undefined): void {
  if (evidence?.status === 'USER_CONFIRMED') evidence.status = 'UNVERIFIED';
}

export function evidenceKey(values: unknown, evidence: SourceEvidence): string {
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (value !== null && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sort(entry)]),
    );
    return value;
  };
  // 先经过JSON序列化，将Decimal等数值统一成文件存储形式，再稳定排序。
  const data = JSON.parse(JSON.stringify({ values, reference: evidence.reference, valid_from: evidence.valid_from, valid_to: evidence.valid_to, checked_on: evidence.checked_on }));
  return JSON.stringify(sort(data));
}

export function taxEvidenceValues(rules: { dutyRates: unknown; vatRate: unknown; consumptionTax?: unknown }): unknown {
  return { dutyRates: rules.dutyRates, vatRate: rules.vatRate, consumptionTax: rules.consumptionTax ?? null };
}

export function hsEvidenceValues(entry: object, basis?: string): unknown {
  const { evidence: _evidence, ...values } = entry as Record<string, unknown>;
  return { basis, ...values };
}

export function fxEvidenceValues(row: { type: string; date: string; valid_from?: string; valid_to?: string; from: string; to: string; rate: unknown }): unknown {
  return { type: row.type, date: row.date, valid_from: row.valid_from, valid_to: row.valid_to, from: row.from, to: row.to, rate: row.rate };
}
