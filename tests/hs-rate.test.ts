import { describe, expect, it } from 'vitest';
import { d, toStorage } from '../src/domain/decimal';
import type { HsRateTable } from '../src/domain/hs-rate';
import { findHsEntry } from '../src/domain/hs-rate';
import type { TaxProfile } from '../src/domain/tax-profile';
import { EngineError } from '../src/engine/errors';
import { computeImportTaxes } from '../src/engine/tax/import-tax';

/**
 * HS 税率表（设计文档 9.6）。
 *
 * 重点验证三件事：编码逐级回退、税率口径的取舍、从量/复合税的计征。
 * 所有回退都必须有提示，不允许静默换用一个数。
 */

const HS_TABLE: HsRateTable = {
  basis: 'MFN',
  entries: [
    { code: '85', description: '第85章 电机、电气设备', duty_rates: { MFN: '0.08' } },
    { code: '8518', description: '扬声器、耳机、扩音器', duty_rates: { MFN: '0.05' } },
    {
      code: '851830',
      description: '耳机、耳塞',
      duty_rates: { MFN: '0.037', AGREEMENT: '0.02' },
      vat_rate: '0.13',
    },
    {
      code: '2203000000',
      description: '麦芽酿造的啤酒',
      duty_type: 'SPECIFIC',
      specific_amount: '7.5',
      specific_unit: '升',
      vat_rate: '0.13',
    },
    {
      code: '2402200000',
      description: '烟草制的卷烟',
      duty_type: 'COMPOUND',
      duty_rates: { MFN: '0.25' },
      specific_amount: '0.6',
      specific_unit: '支',
      consumption_tax_rate: '0.36',
    },
  ],
};

function profileWith(hsTable: HsRateTable | undefined, overrides: Partial<TaxProfile['import']> = {}): TaxProfile {
  return {
    id: 'test',
    version: '1',
    import: {
      dutiableValueBasis: 'CIF',
      dutyRates: { fallback: '0.1' },
      vatRate: '0.13',
      consumptionTax: null,
      vatDeductibleForBuyer: true,
      ...(hsTable !== undefined ? { hsTable } : {}),
      ...overrides,
    },
    export: {
      dutiableValueBasis: 'FOB',
      dutyRates: { fallback: '0' },
      rebate: { entityType: 'TRADING', vatRates: { fallback: '0.13' }, rebateRates: { fallback: '0.13' } },
    },
    customsFx: { bookType: 'CUSTOMS', lockPeriod: 'MONTHLY' },
  };
}

function codes(result: { warnings: { code: string }[] }): string[] {
  return result.warnings.map((warning) => warning.code);
}

describe('HS 编码查询', () => {
  it('精确匹配', () => {
    const match = findHsEntry(HS_TABLE, '851830');
    expect(match?.level).toBe('EXACT');
    expect(match?.matched_code).toBe('851830');
  });

  it('输入 10 位、表中只有 6 位时逐级回退', () => {
    const match = findHsEntry(HS_TABLE, '8518300000');
    expect(match?.level).toBe('PARENT');
    expect(match?.matched_code).toBe('851830');
    expect(match?.entry.description).toBe('耳机、耳塞');
  });

  it('回退顺序是 10 → 8 → 6 → 4 → 2，取最接近的上级', () => {
    // 8518900000：8 位没有，6 位没有，4 位 8518 有
    const match = findHsEntry(HS_TABLE, '8518900000');
    expect(match?.matched_code).toBe('8518');
    // 8529000000：只能退到 2 位 85
    expect(findHsEntry(HS_TABLE, '8529000000')?.matched_code).toBe('85');
  });

  it('编码里的点、空格等非数字字符会被忽略', () => {
    expect(findHsEntry(HS_TABLE, '8518.30.00')?.matched_code).toBe('851830');
  });

  it('查不到时返回 undefined，不返回兜底值', () => {
    expect(findHsEntry(HS_TABLE, '9999999999')).toBeUndefined();
    expect(findHsEntry(HS_TABLE, undefined)).toBeUndefined();
    expect(findHsEntry(undefined, '851830')).toBeUndefined();
  });
});

describe('HS 税率表 · 关税计算', () => {
  it('命中 HS 编码时以其税率为准，不用兜底税率', () => {
    const result = computeImportTaxes({ profile: profileWith(HS_TABLE), dutiableValue: d('100000'), taxKey: '851830' });
    // 3.7% 而不是兜底的 10%
    expect(toStorage(result.duty)).toBe('3700.000000');
    expect(result.hs_code_matched).toBe('851830');
    expect(result.hs_match_level).toBe('EXACT');
  });

  it('按上级编码计算时给出提示', () => {
    const result = computeImportTaxes({
      profile: profileWith(HS_TABLE),
      dutiableValue: d('100000'),
      taxKey: '8518300000',
    });
    expect(toStorage(result.duty)).toBe('3700.000000');
    expect(codes(result)).toContain('HS_CODE_PARENT_MATCH');
    expect(result.hs_match_level).toBe('PARENT');
  });

  it('表里查不到该编码时回退兜底税率并告警', () => {
    const result = computeImportTaxes({ profile: profileWith(HS_TABLE), dutiableValue: d('100000'), taxKey: '9999999999' });
    expect(toStorage(result.duty)).toBe('10000.000000');
    expect(codes(result)).toContain('HS_CODE_NOT_FOUND');
  });

  it('编码重复时告警，并按最后一条计算', () => {
    const duplicated: HsRateTable = {
      basis: 'MFN',
      entries: [
        { code: '851830', description: '旧条目', duty_rates: { MFN: '0.01' } },
        { code: '851830', description: '新条目', duty_rates: { MFN: '0.037' } },
      ],
    };
    const result = computeImportTaxes({ profile: profileWith(duplicated), dutiableValue: d('100000'), taxKey: '851830' });
    expect(codes(result)).toContain('HS_CODE_DUPLICATE');
    expect(toStorage(result.duty)).toBe('3700.000000');
  });

  it('HS 表里的增值税率覆盖商品大类的增值税率', () => {
    const result = computeImportTaxes({ profile: profileWith(HS_TABLE), dutiableValue: d('100000'), taxKey: '851830' });
    expect(toStorage(result.vat_rate)).toBe('0.130000');
    expect(toStorage(result.vat)).toBe(
      // (100,000 + 3,700) × 13%
      '13481.000000',
    );
  });

  it('消费税率可来自 HS 条目', () => {
    const result = computeImportTaxes({
      profile: profileWith(HS_TABLE),
      dutiableValue: d('100000'),
      taxKey: '2402200000',
      quantity: '10000',
      unit: '支',
    });
    // (100,000 + 25,000 + 6,000) ÷ (1 − 36%) × 36% = 73,687.5
    expect(toStorage(result.consumption_tax)).toBe('73687.500000');
  });
});

describe('HS 税率表 · 税率口径', () => {
  const AGREEMENT_TABLE: HsRateTable = { ...HS_TABLE, basis: 'AGREEMENT' };

  it('按所选口径取税率', () => {
    const result = computeImportTaxes({
      profile: profileWith(AGREEMENT_TABLE),
      dutiableValue: d('100000'),
      taxKey: '851830',
    });
    // 协定税率 2%
    expect(toStorage(result.duty)).toBe('2000.000000');
  });

  it('该编码没有所选口径的税率时回退最惠国税率，并说明用了哪一档', () => {
    const result = computeImportTaxes({ profile: profileWith(AGREEMENT_TABLE), dutiableValue: d('100000'), taxKey: '8518' });
    // 8518 只有最惠国税率 5%
    expect(toStorage(result.duty)).toBe('5000.000000');
    expect(codes(result)).toContain('HS_RATE_BASIS_FALLBACK');
  });

  it('所选口径与最惠国税率都没有时回退商品大类兜底税率', () => {
    const noRates: HsRateTable = {
      basis: 'AGREEMENT',
      entries: [{ code: '851830', description: '耳机' }],
    };
    const result = computeImportTaxes({ profile: profileWith(noRates), dutiableValue: d('100000'), taxKey: '851830' });
    expect(toStorage(result.duty)).toBe('10000.000000');
    expect(codes(result)).toContain('HS_RATE_BASIS_FALLBACK');
  });
});

describe('HS 税率表 · 从量与复合税', () => {
  it('从量税按数量 × 单位税额计征，从价税率为 0', () => {
    const result = computeImportTaxes({
      profile: profileWith(HS_TABLE),
      dutiableValue: d('100000'),
      taxKey: '2203000000',
      quantity: '20000',
      unit: '升',
    });
    // 20,000 × 7.5 = 150,000
    expect(result.duty_type).toBe('SPECIFIC');
    expect(toStorage(result.specific_duty)).toBe('150000.000000');
    expect(toStorage(result.duty)).toBe('150000.000000');
    expect(toStorage(result.duty_rate)).toBe('0.000000');
  });

  it('从量税下增值税基数仍为 完税价格 + 关税', () => {
    const result = computeImportTaxes({
      profile: profileWith(HS_TABLE),
      dutiableValue: d('100000'),
      taxKey: '2203000000',
      quantity: '20000',
      unit: '升',
    });
    // (100,000 + 150,000) × 13%
    expect(toStorage(result.vat)).toBe('32500.000000');
  });

  it('复合税 = 从价 + 从量', () => {
    const result = computeImportTaxes({
      profile: profileWith(HS_TABLE),
      dutiableValue: d('100000'),
      taxKey: '2402200000',
      quantity: '10000',
      unit: '支',
    });
    // 从价 100,000 × 25% = 25,000；从量 10,000 × 0.6 = 6,000；合计 31,000
    expect(result.duty_type).toBe('COMPOUND');
    expect(toStorage(result.duty)).toBe('31000.000000');
    expect(toStorage(result.specific_duty)).toBe('6000.000000');
  });

  it('从量税缺少单位税额时报错', () => {
    const table: HsRateTable = {
      basis: 'MFN',
      entries: [{ code: '2203000000', description: '啤酒', duty_type: 'SPECIFIC' }],
    };
    expect(() =>
      computeImportTaxes({
        profile: profileWith(table),
        dutiableValue: d('100000'),
        taxKey: '2203000000',
        quantity: '1',
        unit: '升',
      }),
    ).toThrowError(EngineError);
  });

  it('从量税缺少数量时报错，不按 0 处理', () => {
    try {
      computeImportTaxes({ profile: profileWith(HS_TABLE), dutiableValue: d('100000'), taxKey: '2203000000' });
      throw new Error('预期抛错');
    } catch (error) {
      expect((error as EngineError).code).toBe('HS_SPECIFIC_QUANTITY_MISSING');
    }
  });

  it('从量税的计量单位与商品单位不一致时报错，不做隐含换算', () => {
    try {
      computeImportTaxes({
        profile: profileWith(HS_TABLE),
        dutiableValue: d('100000'),
        taxKey: '2203000000',
        quantity: '1000',
        unit: '箱',
      });
      throw new Error('预期抛错');
    } catch (error) {
      expect((error as EngineError).code).toBe('HS_SPECIFIC_UNIT_MISMATCH');
    }
  });
});

describe('HS 税率表 · 回归', () => {
  it('没有 HS 税率表时行为与以前完全一致', () => {
    const result = computeImportTaxes({ profile: profileWith(undefined), dutiableValue: d('766764'), taxKey: 'DEMO' });
    expect(toStorage(result.duty)).toBe('76676.400000');
    expect(result.duty_type).toBe('AD_VALOREM');
    expect(result.hs_code_matched).toBeNull();
    expect(result.warnings).toHaveLength(0);
  });

  it('商品编码未填时不影响计算', () => {
    const result = computeImportTaxes({ profile: profileWith(HS_TABLE), dutiableValue: d('100000') });
    expect(toStorage(result.duty)).toBe('10000.000000');
    expect(result.warnings.map((warning) => warning.code)).not.toContain('HS_CODE_NOT_FOUND');
  });
});
