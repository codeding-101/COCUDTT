import { describe, expect, it } from 'vitest';
import { d, toStorage } from '../src/domain/decimal';
import type { RebateProfile } from '../src/domain/rebate';
import { computeRebate, noExportRebate, restoreFobValue } from '../src/engine/tax/rebate';

const TRADING: RebateProfile = {
  entityType: 'TRADING',
  vatRates: { fallback: '0.13' },
  rebateRates: { fallback: '0.13' },
};

const MANUFACTURER: RebateProfile = {
  entityType: 'MANUFACTURER',
  vatRates: { fallback: '0.13' },
  rebateRates: { fallback: '0.13' },
};

describe('离岸价还原', () => {
  it('CIF 报价扣除运费与保险费还原为离岸价', () => {
    const { fob, warnings } = restoreFobValue({
      profile: TRADING,
      seller_goods_cost_base: d('620000'),
      quote_amount_base: d('108300'),
      post_shipment_included_base: d('8300'),
      pre_shipment_excluded_base: d('0'),
    });
    expect(toStorage(fob)).toBe('100000.000000');
    expect(warnings).toHaveLength(0);
  });

  it('FOB 报价无需扣除', () => {
    const { fob } = restoreFobValue({
      profile: TRADING,
      seller_goods_cost_base: d('620000'),
      quote_amount_base: d('108300'),
      post_shipment_included_base: d('0'),
      pre_shipment_excluded_base: d('0'),
    });
    expect(toStorage(fob)).toBe('108300.000000');
  });

  it('EXW 报价需加回报价外、装船前由买方承担的费用', () => {
    const { fob } = restoreFobValue({
      profile: TRADING,
      seller_goods_cost_base: d('620000'),
      quote_amount_base: d('100000'),
      post_shipment_included_base: d('0'),
      pre_shipment_excluded_base: d('3400'),
    });
    expect(toStorage(fob)).toBe('103400.000000');
  });

  it('还原结果为负时按 0 处理并告警', () => {
    const { fob, warnings } = restoreFobValue({
      profile: TRADING,
      seller_goods_cost_base: d('620000'),
      quote_amount_base: d('1000'),
      post_shipment_included_base: d('8300'),
      pre_shipment_excluded_base: d('0'),
    });
    expect(toStorage(fob)).toBe('0.000000');
    expect(warnings.map((warning) => warning.code)).toContain('REBATE_FOB_NEGATIVE');
  });
});

describe('出口退税', () => {
  it('外贸企业：依据为采购发票不含税金额，与出口售价无关', () => {
    const result = computeRebate({
      profile: TRADING,
      seller_goods_cost_base: d('620000'),
      quote_amount_base: d('108300'),
      post_shipment_included_base: d('8300'),
      pre_shipment_excluded_base: d('0'),
    });
    // 620,000 ÷ 1.13 = 548,672.566372；× 13% = 71,327.433628
    expect(toStorage(result.basis)).toBe('548672.566372');
    expect(toStorage(result.rebate_total)).toBe('71327.433628');
    expect(toStorage(result.non_refundable_vat)).toBe('0.000000');
    // 离岸价仍然计算，供展示与核对
    expect(toStorage(result.fob_value)).toBe('100000.000000');
  });

  it('外贸企业：换个报价，退税额不变', () => {
    const low = computeRebate({
      profile: TRADING,
      seller_goods_cost_base: d('620000'),
      quote_amount_base: d('90000'),
      post_shipment_included_base: d('0'),
      pre_shipment_excluded_base: d('0'),
    });
    expect(toStorage(low.rebate_total)).toBe('71327.433628');
  });

  it('生产企业：依据为离岸价，随术语变化', () => {
    const cif = computeRebate({
      profile: MANUFACTURER,
      seller_goods_cost_base: d('620000'),
      quote_amount_base: d('108300'),
      post_shipment_included_base: d('8300'),
      pre_shipment_excluded_base: d('0'),
    });
    expect(toStorage(cif.basis)).toBe('100000.000000');
    expect(toStorage(cif.rebate_total)).toBe('13000.000000');

    const fob = computeRebate({
      profile: MANUFACTURER,
      seller_goods_cost_base: d('620000'),
      quote_amount_base: d('108300'),
      post_shipment_included_base: d('0'),
      pre_shipment_excluded_base: d('0'),
    });
    expect(toStorage(fob.basis)).toBe('108300.000000');
    expect(toStorage(fob.rebate_total)).toBe('14079.000000');
  });

  it('生产企业退税额受期末留抵税额限制', () => {
    const result = computeRebate({
      profile: { ...MANUFACTURER, endingCreditBalance: '10000' },
      seller_goods_cost_base: d('620000'),
      quote_amount_base: d('108300'),
      post_shipment_included_base: d('8300'),
      pre_shipment_excluded_base: d('0'),
    });
    expect(toStorage(result.rebate_total)).toBe('10000.000000');
    expect(toStorage(result.theoretical_rebate)).toBe('13000.000000');
    expect(result.is_capped_by_credit).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toContain('REBATE_CAPPED_BY_CREDIT');
  });

  it('征退税率差转入成本', () => {
    const result = computeRebate({
      profile: { ...TRADING, rebateRates: { fallback: '0.09' } },
      seller_goods_cost_base: d('620000'),
      quote_amount_base: d('108300'),
      post_shipment_included_base: d('8300'),
      pre_shipment_excluded_base: d('0'),
    });
    expect(toStorage(result.rebate_total)).toBe('49380.530973');
    // 548,672.566372 × (13% − 9%) = 21,946.902655
    expect(toStorage(result.non_refundable_vat)).toBe('21946.902655');
  });

  it('退税率为 0 时提示不计退税', () => {
    const result = computeRebate({
      profile: { ...TRADING, rebateRates: { fallback: '0' } },
      seller_goods_cost_base: d('620000'),
      quote_amount_base: d('108300'),
      post_shipment_included_base: d('8300'),
      pre_shipment_excluded_base: d('0'),
    });
    expect(toStorage(result.rebate_total)).toBe('0.000000');
    expect(result.warnings.map((warning) => warning.code)).toContain('REBATE_RATE_ZERO');
  });

  it('启用到账周期后计提资金占用成本', () => {
    const result = computeRebate({
      profile: { ...TRADING, rebateLagDays: 90, sellerFundingRate: '0.06' },
      seller_goods_cost_base: d('620000'),
      quote_amount_base: d('108300'),
      post_shipment_included_base: d('8300'),
      pre_shipment_excluded_base: d('0'),
    });
    // 71,327.433628 × 6% × 90 ÷ 365 = 1,055.255183
    expect(toStorage(result.lag_cost)).toBe('1055.255183');
    expect(result.warnings.map((warning) => warning.code)).toContain('REBATE_LAG_COST');
  });

  it.each(['2027-04-30', '2027-05-10', '2030-05-10'])('仅凭2026出口日期与当前日期%s不判定退税逾期或内销征税', (today) => {
    const result = computeRebate({
      profile: TRADING,
      seller_goods_cost_base: d('620000'),
      quote_amount_base: d('108300'),
      post_shipment_included_base: d('8300'),
      pre_shipment_excluded_base: d('0'),
      export_date: '2026-03-01',
      today,
    });
    const review = result.warnings.find((warning) => warning.code === 'REBATE_DEADLINE');
    expect(review?.level).toBe('WARN');
    expect(review?.message).toContain('2026年第11号');
    expect(review?.message).toContain('36个月');
    expect(review?.message).toContain('不判定是否逾期');
    expect(review?.message).not.toContain('期限（2027-04-30）已过');
    expect(review?.message).not.toContain('逾期未申报可能视同内销征税');
    // 条件提示不改写理论金额，也不将未核实的退税权利认定为零。
    expect(toStorage(result.rebate_total)).toBe('71327.433628');
  });

  it.each(['TRADING', 'MANUFACTURER'] as const)('2025年末%s出口业务适用过渡提示，不套用2026新期限', (entityType) => {
    const result = computeRebate({
      profile: { ...TRADING, entityType },
      seller_goods_cost_base: d('620000'),
      quote_amount_base: d('108300'),
      post_shipment_included_base: d('8300'),
      pre_shipment_excluded_base: d('0'),
      export_date: '2025-12-31',
      today: '2030-05-10',
    });
    const review = result.warnings.find((warning) => warning.code === 'REBATE_DEADLINE');
    expect(review?.message).toContain('仍按原政策执行');
    expect(review?.message).toContain('不适用新增36个月期限');
    expect(review?.message).toContain('不判定是否逾期');
    expect(review?.message).not.toContain('期限（2026-04-30）已过');
  });

  it('2026年首日业务即使没有当前日期也显示申报及收汇条件核对', () => {
    const result = computeRebate({
      profile: TRADING,
      seller_goods_cost_base: d('620000'),
      quote_amount_base: d('108300'),
      post_shipment_included_base: d('8300'),
      pre_shipment_excluded_base: d('0'),
      export_date: '2026-01-01',
    });
    const review = result.warnings.find((warning) => warning.code === 'REBATE_DEADLINE');
    expect(review?.message).toContain('2026年起的业务');
    expect(review?.message).toContain('凭证及收汇状态');
    expect(review?.message).not.toContain('仍按原政策执行');
  });

  it.each([undefined, '', 'invalid', '2026-02-30'])('出口日期%s缺失或无效时不假定政策年份', (exportDate) => {
    const result = computeRebate({
      profile: TRADING,
      seller_goods_cost_base: d('620000'),
      quote_amount_base: d('108300'),
      post_shipment_included_base: d('8300'),
      pre_shipment_excluded_base: d('0'),
      ...(exportDate !== undefined ? { export_date: exportDate } : {}),
      today: '2030-05-10',
    });
    const review = result.warnings.find((warning) => warning.code === 'REBATE_DEADLINE');
    expect(review?.message).toContain('缺少有效出口日期');
    expect(review?.message).not.toContain('仍按原政策执行');
    expect(review?.message).not.toContain('期限已过');
    expect(toStorage(result.rebate_total)).toBe('71327.433628');
  });

  it('中国进口不产生中国出口退税申报条件提示', () => {
    const result = noExportRebate(TRADING);
    expect(result.applicable).toBe(false);
    expect(toStorage(result.rebate_total)).toBe('0.000000');
    expect(result.warnings).toHaveLength(0);
  });
});
