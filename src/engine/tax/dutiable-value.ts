import type Decimal from 'decimal.js';
import { add, d, mul, q, sum, toStorage, type Numeric } from '../../domain/decimal.js';
import type { CostItem } from '../../domain/cost-item.js';
import type { CurrencyCode, DateStr } from '../../domain/enums.js';
import type { FxBook } from '../../domain/fx.js';
import type { Goods } from '../../domain/goods.js';
import type { TaxProfile } from '../../domain/tax-profile.js';
import type { Warning } from '../../domain/warning.js';
import { isEngineError } from '../errors.js';
import { convertAmount, resolveFxRate, type FxResolution } from '../fx.js';
import { isChinaImport, isIsoDate, taxNumber, toFen, validateChinaImportContext } from './china-import.js';
import type { CalculationStep } from '../calculation.js';

export interface DutiableComponent {
  calculation?: CalculationStep;
  fx?: FxResolution;
  cost_id: string;
  label: string;
  amount: Decimal;
  basis: 'GOODS' | 'FREIGHT' | 'INSURANCE' | 'INSURANCE_FALLBACK' | 'ADJUSTMENT';
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
  const china = isChinaImport(input.profile);
  const fxDate = china ? validateChinaImportContext(input.profile, input.baseCurrency) : input.fxDate;
  // 中国模式只使用明确覆盖申报日期的汇率簿，不拿过期簿或无有效期的簿推断。
  const books = china ? input.books.filter((book) =>
    book.type === 'CUSTOMS' && book.valid_from !== undefined && book.valid_to !== undefined &&
    isIsoDate(book.valid_from) && isIsoDate(book.valid_to) &&
    book.valid_from <= (fxDate ?? '') && (fxDate ?? '') <= book.valid_to,
  ) : input.books;
  const warnings: Warning[] = [];
  const components: DutiableComponent[] = [];
  const usedFx = new Map<string, FxResolution>();
  const calculations = new Map<string, CalculationStep>();

  const customsConvert = (label: string, currency: CurrencyCode, gross: Numeric, fallback: Numeric, costId: string): Decimal => {
    if (china) taxNumber(gross, label);
    if (currency === input.baseCurrency) {
      const value = china ? toFen(d(gross)) : q(gross);
      calculations.set(costId, { id: costId, label, formula: '本币金额', substitution: `${gross} ${currency}`, value });
      return value;
    }
    try {
      const fx = resolveFxRate({
        from: currency,
        to: input.baseCurrency,
        fxType: 'CUSTOMS',
        fxDate,
        books,
      });
      usedFx.set(costId, fx);
      const value = china ? toFen(d(gross).times(fx.rate)) : convertAmount(gross, fx);
      calculations.set(costId, { id: costId, label, formula: '原币金额 × 海关解析汇率', substitution: `${gross} × ${fx.rate}`, value,
        note: `${fx.from}→${fx.to}，来源 ${fx.source}；汇率簿 ${fx.book_id ?? '无'}；适用日 ${fxDate ?? '未录入'}。` });
      return value;
    } catch (error) {
      if (isEngineError(error) && error.code === 'FX_MISSING') {
        if (china) throw error;
        warnings.push({
          code: 'CUSTOMS_FX_FALLBACK',
          level: 'WARN',
          message: `${label} 缺少海关适用汇率（${currency}→${input.baseCurrency}），完税价格暂按该费用自身汇率折算，结果可能与海关口径不一致`,
          cost_id: costId,
        });
        const value = q(fallback);
        calculations.set(costId, { id: costId, label, formula: '缺海关汇率，沿用商业核算金额（通用模式回退）', substitution: `${fallback}`, value,
          note: '不是海关汇率换算；结果可能与海关口径不一致，详见告警。中国模式不允许此回退。' });
        return value;
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

  const eligible = (item: CostItem): boolean => deductible(item) && !(china && item.customs_value === 'EXCLUDE');
  const freightItems = input.items.filter((item) => item.cost_category === 'MAIN_CARRIAGE' && eligible(item));
  const insuranceItems = input.items.filter((item) => item.cost_category === 'INSURANCE' && eligible(item));

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
    const fallback = china
      ? toFen(add(goodsAmount, freightTotal).times(taxNumber(fallbackRate, '保险估算比率')))
      : mul(add(goodsAmount, freightTotal), fallbackRate);
    insuranceTotal = fallback;
    components.push({
      calculation: { id: 'insurance-fallback', label: '保险费估算', formula: '(计税货值 + 计税运费) × 录入估算比率', substitution: `(${goodsAmount} + ${freightTotal}) × ${fallbackRate}`, value: fallback,
        note: '此项仅为税基中的估算保费，不新增商业保费或保额。' },
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

  const adjustments = china ? sum(input.items
    .filter((item) => item.customs_value === 'ADD' && eligible(item) && item.cost_category !== 'MAIN_CARRIAGE' && item.cost_category !== 'INSURANCE')
    .map((item) => {
      const amount = customsConvert(`计税调整「${item.cost_name}」`, item.currency, input.grossOf(item.cost_id), input.amountBase(item.cost_id), item.cost_id);
      components.push({ cost_id: item.cost_id, label: item.cost_name, amount, basis: 'ADJUSTMENT' });
      return amount;
    })) : d(0);
  return {
    value: sum([goodsAmount, freightTotal, insuranceTotal, adjustments]),
    components: components.map((component) => ({ ...component,
      ...(calculations.has(component.cost_id) ? { calculation: { ...calculations.get(component.cost_id)!, note: `${calculations.get(component.cost_id)?.note ?? ''}${china ? '中国模式各组成金额四舍五入至分。' : '通用模式保留6位小数。'}` } } : {}),
      ...(usedFx.has(component.cost_id) ? { fx: usedFx.get(component.cost_id) } : {}) })),
    warnings,
  };
}
