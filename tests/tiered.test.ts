import { describe, expect, it } from 'vitest';
import { toStorage } from '../src/domain/decimal';
import type { Tier } from '../src/domain/cost-item';
import { computeGrossAmount, type PricingContext } from '../src/engine/pricing';
import { EngineError } from '../src/engine/errors';
import { makeCostItem } from './helpers/factory';

const ctx: PricingContext = { resolveBase: () => '0' };

function amountOf(partial: Parameters<typeof makeCostItem>[0]): string {
  return toStorage(computeGrossAmount(makeCostItem(partial), ctx));
}

function errorCodeOf(partial: Parameters<typeof makeCostItem>[0]): string {
  try {
    computeGrossAmount(makeCostItem(partial), ctx);
  } catch (error) {
    expect(error).toBeInstanceOf(EngineError);
    return (error as EngineError).code;
  }
  throw new Error('预期抛错，但没有抛出');
}

/** 累进：0–100 每单位 10，100–500 每单位 8，500 以上每单位 6 */
const PROGRESSIVE: Tier[] = [
  { up_to: '100', rate: '10' },
  { up_to: '500', rate: '8' },
  { up_to: null, rate: '6' },
];

describe('阶梯计费 · 累进（MARGINAL）', () => {
  it('每档费率只作用于落在该档内的部分', () => {
    // 100×10 + 400×8 + 100×6 = 4,800
    expect(amountOf({ cost_id: 'a', pricing_method: 'TIERED', quantity: '600', tiers: PROGRESSIVE })).toBe(
      '4800.000000',
    );
  });

  it('计费量落在中间档时只算到那一档', () => {
    expect(amountOf({ cost_id: 'a', pricing_method: 'TIERED', quantity: '250', tiers: PROGRESSIVE })).toBe(
      '2200.000000',
    );
  });

  it('正好落在档位边界时按该档上界计算', () => {
    expect(amountOf({ cost_id: 'a', pricing_method: 'TIERED', quantity: '100', tiers: PROGRESSIVE })).toBe(
      '1000.000000',
    );
    expect(amountOf({ cost_id: 'a', pricing_method: 'TIERED', quantity: '500', tiers: PROGRESSIVE })).toBe(
      '4200.000000',
    );
  });

  it('计费量为 0 时结果为 0', () => {
    expect(amountOf({ cost_id: 'a', pricing_method: 'TIERED', quantity: '0', tiers: PROGRESSIVE })).toBe(
      '0.000000',
    );
  });

  it('只有一个无上界的档位时等价于数量 × 费率', () => {
    expect(
      amountOf({
        cost_id: 'a',
        pricing_method: 'TIERED',
        quantity: '37',
        tiers: [{ up_to: null, rate: '12.5' }],
      }),
    ).toBe('462.500000');
  });

  it('档位乱序填写也能算出同样结果（引擎会排序）', () => {
    const shuffled: Tier[] = [
      { up_to: null, rate: '6' },
      { up_to: '500', rate: '8' },
      { up_to: '100', rate: '10' },
    ];
    expect(amountOf({ cost_id: 'a', pricing_method: 'TIERED', quantity: '600', tiers: shuffled })).toBe('4800.000000');
  });

  it('按天数分档：滞箱费前 7 天免费、8–15 天每天 120、16 天起每天 200', () => {
    const demurrage: Tier[] = [
      { up_to: '7', rate: '0' },
      { up_to: '15', rate: '120' },
      { up_to: null, rate: '200' },
    ];
    // 7×0 + 8×120 + 5×200 = 1,960
    expect(
      amountOf({
        cost_id: 'a',
        pricing_method: 'TIERED',
        tier_basis: 'DAYS',
        days: '20',
        tiers: demurrage,
      }),
    ).toBe('1960.000000');
  });

  it('按天数分档时可由 timing 推导天数', () => {
    const withDays: PricingContext = { resolveBase: () => '0', resolveDays: () => '10' };
    const item = makeCostItem({
      cost_id: 'a',
      pricing_method: 'TIERED',
      tier_basis: 'DAYS',
      tiers: [
        { up_to: '7', rate: '0' },
        { up_to: null, rate: '120' },
      ],
    });
    expect(toStorage(computeGrossAmount(item, withDays))).toBe('360.000000');
  });
});

describe('阶梯计费 · 分档（FLAT）', () => {
  /** 空运重量等级运价：45kg 以下 35，45–100 每公斤 30.5，100–300 每公斤 25 */
  const AIR: Tier[] = [
    { up_to: '45', rate: '35' },
    { up_to: '100', rate: '30.5' },
    { up_to: null, rate: '25' },
  ];

  it('全量按所在档的费率计算', () => {
    // 40 × 35
    expect(
      amountOf({ cost_id: 'a', pricing_method: 'TIERED', tier_mode: 'FLAT', quantity: '40', tiers: AIR }),
    ).toBe('1400.000000');
  });

  it('勾选"按高一档择低"后按空运规则取低值', () => {
    // min(40×35 = 1,400, 45×30.5 = 1,372.5) = 1,372.5
    expect(
      amountOf({
        cost_id: 'a',
        pricing_method: 'TIERED',
        tier_mode: 'FLAT',
        tier_charge_lower: true,
        quantity: '40',
        tiers: AIR,
      }),
    ).toBe('1372.500000');
  });

  it('择低不会把更贵的高档位算进来', () => {
    // 80×30.5 = 2,440 已低于 100×25 = 2,500，应取 2,440
    expect(
      amountOf({
        cost_id: 'a',
        pricing_method: 'TIERED',
        tier_mode: 'FLAT',
        tier_charge_lower: true,
        quantity: '80',
        tiers: AIR,
      }),
    ).toBe('2440.000000');
  });

  it('计费量正好落在分界点上时按高一档计算', () => {
    // 45 落在 45–100 档 → 45×30.5 = 1,372.5
    expect(
      amountOf({
        cost_id: 'a',
        pricing_method: 'TIERED',
        tier_mode: 'FLAT',
        tier_charge_lower: true,
        quantity: '45',
        tiers: AIR,
      }),
    ).toBe('1372.500000');
  });

  it('不勾选择低时就是全量 × 所在档费率', () => {
    expect(
      amountOf({ cost_id: 'a', pricing_method: 'TIERED', tier_mode: 'FLAT', quantity: '45', tiers: AIR }),
    ).toBe('1575.000000');
  });
});

describe('阶梯计费 · 输入校验', () => {
  it('没有档位时报错', () => {
    expect(errorCodeOf({ cost_id: 'a', pricing_method: 'TIERED', quantity: '10' })).toBe('PRICING_TIER_INVALID');
  });

  it('出现两个无上界档位时报错，不猜用哪个', () => {
    expect(
      errorCodeOf({
        cost_id: 'a',
        pricing_method: 'TIERED',
        quantity: '10',
        tiers: [
          { up_to: null, rate: '1' },
          { up_to: null, rate: '2' },
        ],
      }),
    ).toBe('PRICING_TIER_INVALID');
  });

  it('上界重复时报错', () => {
    expect(
      errorCodeOf({
        cost_id: 'a',
        pricing_method: 'TIERED',
        quantity: '10',
        tiers: [
          { up_to: '100', rate: '1' },
          { up_to: '100', rate: '2' },
        ],
      }),
    ).toBe('PRICING_TIER_INVALID');
  });

  it('费率为负时报错', () => {
    expect(
      errorCodeOf({
        cost_id: 'a',
        pricing_method: 'TIERED',
        quantity: '10',
        tiers: [{ up_to: null, rate: '-1' }],
      }),
    ).toBe('PRICING_TIER_INVALID');
  });

  it('上界为 0 时报错', () => {
    expect(
      errorCodeOf({
        cost_id: 'a',
        pricing_method: 'TIERED',
        quantity: '10',
        tiers: [{ up_to: '0', rate: '1' }],
      }),
    ).toBe('PRICING_TIER_INVALID');
  });

  it('计费量超出最后一个有上界的档位时报错，提示补无上界档位', () => {
    expect(
      errorCodeOf({
        cost_id: 'a',
        pricing_method: 'TIERED',
        quantity: '500',
        tiers: [{ up_to: '100', rate: '1' }],
      }),
    ).toBe('PRICING_TIER_NOT_COVERED');
  });

  it('按数量分档但未填数量时报错', () => {
    expect(errorCodeOf({ cost_id: 'a', pricing_method: 'TIERED', tiers: PROGRESSIVE })).toBe(
      'PRICING_INPUT_MISSING',
    );
  });

  it('按天数分档但无法确定天数时报错', () => {
    expect(
      errorCodeOf({
        cost_id: 'a',
        pricing_method: 'TIERED',
        tier_basis: 'DAYS',
        tiers: PROGRESSIVE,
      }),
    ).toBe('PRICING_BASE_MISSING');
  });
});
