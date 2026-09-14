import type Decimal from 'decimal.js';
import { add, mul, q, sum, toStorage, type Numeric } from '../../domain/decimal.js';
import type { CostItem } from '../../domain/cost-item.js';
import type { CurrencyCode, DateStr } from '../../domain/enums.js';
import type { FxBook } from '../../domain/fx.js';
import type { Goods } from '../../domain/goods.js';
import type { TaxProfile } from '../../domain/tax-profile.js';
import type { Warning } from '../../domain/warning.js';
import { isEngineError } from '../errors.js';
import { convertAmount, resolveFxRate } from '../fx.js';

export interface DutiableComponent {
  cost_id: string;
  label: string;
  amount: Decimal;
  basis: 'GOODS' | 'FREIGHT' | 'INSURANCE' | 'INSURANCE_FALLBACK';
}

export interface DutiableValueResult {
  value: Decimal;
  components: DutiableComponent[];
  warnings: Warning[];
}

export interface DutiableValueInput {
  goods: Goods;
  items: readonly CostItem[];
  baseCurrency: CurrencyCode;
  books: readonly FxBook[];
  fxDate?: DateStr;
  profile: TaxProfile;
  /** 货值在核算币种下的金额（商业口径），作为海关汇率缺失时的兜底 */
  goodsValueBase: Decimal;
  /** 原币金额 */
  grossOf: (costId: string) => Decimal;
  /** 核算币种金额（商业汇率） */
  amountBase: (costId: string) => Decimal;
}

/**
 * 完税价格 = 货值 + 运抵境内输入地点起卸前的运费 + 保险费（设计文档 9.2）。
 *
 * 海关适用汇率与商业汇率是两套体系，因此这里对每笔外币费用单独按 CUSTOMS 类型的汇率折算；
 * 缺失海关汇率时不静默套用商业汇率，而是给出告警并在结果中标注口径不一致。
 */
export function computeDutiableValue(input: DutiableValueInput): DutiableValueResult {
  const warnings: Warning[] = [];
  const components: DutiableComponent[] = [];

  const customsConvert = (label: string, currency: CurrencyCode, gross: Numeric, fallback: Numeric, costId: string): Decimal => {
    if (currency === input.baseCurrency) return q(gross);
    try {
      const fx = resolveFxRate({
        from: currency,
        to: input.baseCurrency,
        fxType: 'CUSTOMS',
        fxDate: input.fxDate,
        books: input.books,
      });
      return convertAmount(gross, fx);
    } catch (error) {
      if (isEngineError(error) && error.code === 'FX_MISSING') {
        warnings.push({
          code: 'CUSTOMS_FX_FALLBACK',
          level: 'WARN',
          message: `${label} 缺少海关适用汇率（${currency}→${input.baseCurrency}），完税价格暂按该费用自身汇率折算，结果可能与海关口径不一致`,
          cost_id: costId,
        });
        return q(fallback);
      }
      throw error;
    }
  };

  const goodsCurrency = input.goods.trade_value.currency;
  const goodsAmount = customsConvert(
    '货值',
    goodsCurrency,
    input.goods.trade_value.amount,
    input.goodsValueBase,
    'goods-value',
  );
  components.push({ cost_id: 'goods-value', label: '货值', amount: goodsAmount, basis: 'GOODS' });

  const deductible = (item: CostItem): boolean =>
    item.contained_in_cost_id === undefined && item.source !== 'DERIVED' && item.is_goods_value !== true;

  const freightItems = input.items.filter((item) => item.cost_category === 'MAIN_CARRIAGE' && deductible(item));
  const insuranceItems = input.items.filter((item) => item.cost_category === 'INSURANCE' && deductible(item));

  const freightTotal = sum(
    freightItems.map((item) => {
      const amount = customsConvert(`运费「${item.cost_name}」`, item.currency, input.grossOf(item.cost_id), input.amountBase(item.cost_id), item.cost_id);
      components.push({ cost_id: item.cost_id, label: item.cost_name, amount, basis: 'FREIGHT' });
      return amount;
    }),
  );

  let insuranceTotal = sum(
    insuranceItems.map((item) => {
      const amount = customsConvert(
        `保险费「${item.cost_name}」`,
        item.currency,
        input.grossOf(item.cost_id),
        input.amountBase(item.cost_id),
        item.cost_id,
      );
      components.push({ cost_id: item.cost_id, label: item.cost_name, amount, basis: 'INSURANCE' });
      return amount;
    }),
  );

  const fallbackRate = input.profile.import.insuranceFallbackRate;
  if (insuranceItems.length === 0 && fallbackRate !== undefined) {
    const fallback = mul(add(goodsAmount, freightTotal), fallbackRate);
    insuranceTotal = fallback;
    components.push({
      cost_id: 'insurance-fallback',
      label: '保险费（按货价加运费比例计提）',
      amount: fallback,
      basis: 'INSURANCE_FALLBACK',
    });
    warnings.push({
      code: 'INSURANCE_FALLBACK_APPLIED',
      level: 'INFO',
      message: `未录入保险费，按货价加运费的 ${toStorage(mul(fallbackRate, '100'))}% 计提，计入完税价格`,
    });
  }

  if (input.profile.import.dutiableValueBasis === 'CIF' && freightItems.length === 0) {
    warnings.push({
      code: 'DUTY_BASE_INCOMPLETE',
      level: 'WARN',
      message: '完税价格以到岸价为基础，但未找到国际主运输费用项，完税价格可能被低估',
    });
  }

  return { value: sum([goodsAmount, freightTotal, insuranceTotal]), components, warnings };
}
