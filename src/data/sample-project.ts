import type { ComparisonAnchor } from '../domain/scenario.js';
import type { ProjectFile, QuoteTemplate } from './project-file.js';
import { SCHEMA_VERSION } from './project-file.js';
import { presetToCostItem, customCostItem, COST_PRESETS } from './cost-presets.js';

function preset(key: string) {
  const found = COST_PRESETS.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`缺少费用预设: ${key}`);
  return found;
}

const DEMO_QUOTE: QuoteTemplate = {
  amount: '108300',
  currency: 'USD',
  fx_type: 'CONTRACT',
  fx_date: '2026-09-01',
};

const DEMO_ANCHOR: ComparisonAnchor = { kind: 'FIXED_QUOTE' };

/** 空项目：只有基本结构与一条商品货值项 */
export function newProjectFile(): ProjectFile {
  return {
    schema_version: SCHEMA_VERSION,
    name: '未命名交易',
    updated_at: new Date().toISOString(),
    base_currency: 'CNY',
    carriage_mode: 'SEA',
    export_date: new Date().toISOString().slice(0, 10),
    goods: {
      name: '示例商品',
      quantity: '1000',
      unit: 'PCS',
      trade_value: { amount: '100000', currency: 'USD' },
      seller_goods_cost: { amount: '620000', currency: 'CNY' },
      tax_key: '851830',
    },
    items: [
      presetToCostItem(preset('goods-value'), {
        cost_id: 'goods',
        currency: 'USD',
        base_currency: 'CNY',
        fx_type: 'CONTRACT',
        amount: '100000',
      }),
    ],
    fx_books: [
      {
        id: 'fx-contract',
        name: '合同约定汇率',
        type: 'CONTRACT',
        date: '2026-08-15',
        rates: { 'USD/CNY': '7.0000' },
      },
      {
        id: 'fx-customs',
        name: '海关适用汇率 2026-09',
        type: 'CUSTOMS',
        date: '2026-09-17',
        valid_from: '2026-09-01',
        valid_to: '2026-09-30',
        rates: { 'USD/CNY': '7.0800' },
      },
    ],
    tax_profile: {
      id: 'china-customs',
      version: '1.0',
      import: {
        dutiableValueBasis: 'CIF',
        dutyRates: { fallback: '0.05' },
        // 示例税率表：下级编码未维护时自动按上级编码计算
        hsTable: {
          basis: 'MFN',
          entries: [
            { code: '8518', description: '扬声器、耳机、扩音器', duty_rates: { MFN: '0.05' } },
            {
              code: '851830',
              description: '耳机、耳塞',
              duty_rates: { MFN: '0.037', AGREEMENT: '0.02' },
              vat_rate: '0.13',
            },
          ],
        },
        vatRate: '0.13',
        consumptionTax: null,
        vatDeductibleForBuyer: true,
      },
      export: {
        dutiableValueBasis: 'FOB',
        dutyRates: { fallback: '0' },
        rebate: {
          entityType: 'TRADING',
          vatRates: { fallback: '0.13' },
          rebateRates: { fallback: '0.13' },
        },
      },
      customsFx: { bookType: 'CUSTOMS', lockPeriod: 'MONTHLY' },
    },
    quote: DEMO_QUOTE,
    incoterm: 'CIF',
    anchor: DEMO_ANCHOR,
    facts: {},
  };
}

/**
 * 示例项目：需求里给出的 CIF 报价 108,300 用例本身。
 *
 * 三项之和恰好等于报价（100,000 + 8,000 + 300 = 108,300），
 * 因此报价勾稽校验可以通过；需要演示国内费用时用"从常用费用里选择"添加即可。
 */
export function sampleProjectFile(): ProjectFile {
  const base = newProjectFile();
  return {
    ...base,
    name: '示例：CIF 报价 USD 108,300',
    items: [
      presetToCostItem(preset('goods-value'), {
        cost_id: 'goods',
        currency: 'USD',
        base_currency: 'CNY',
        fx_type: 'CONTRACT',
        amount: '100000',
        overrides: { cost_name: '商品货值' },
      }),
      customCostItem({
        cost_id: 'freight',
        cost_name: '国际海运费',
        cost_category: 'MAIN_CARRIAGE',
        trade_node: 'MAIN_CARRIAGE',
        currency: 'USD',
        base_currency: 'CNY',
        fx_type: 'CONTRACT',
        amount: '8000',
      }),
      presetToCostItem(preset('cargo-insurance'), {
        cost_id: 'insurance',
        currency: 'USD',
        base_currency: 'CNY',
        fx_type: 'CONTRACT',
        amount: '300',
        // 示例直接给实际金额，而不是按报价比例计算
        overrides: { cost_name: '保险费', pricing_method: 'ACTUAL' },
      }),
    ],
  };
}
