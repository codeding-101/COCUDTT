import type { ComparisonAnchor } from '../domain/scenario.js';
import type { ProjectFile, QuoteTemplate } from './project-file.js';
import { SCHEMA_VERSION } from './project-file.js';
import { presetToCostItem, customCostItem, COST_PRESETS } from './cost-presets.js';
import { emptyEligibility, emptyRoute } from '../domain/import-context.js';

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
    quote: { ...DEMO_QUOTE },
    incoterm: 'CIF',
    anchor: { ...DEMO_ANCHOR },
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

/** 中国进口用例：税率、汇率与卖方成本均虚构，用于可复现的公式核对。 */
export function chinaImportSampleProjectFile(): ProjectFile {
  const project = sampleProjectFile();
  project.name = '示例：中国一般贸易进口（虚构税率）';
  project.route = { export_country: '德国（演示）', import_country: '中国', origin_country: '德国（演示）', customs_regime: 'GENERAL_TRADE' };
  delete project.export_date;
  project.goods.name = '演示商品（非真实税则归类）';
  project.goods.trade_value_basis = 'NET';
  project.goods.tax_key = 'DEMO-IMPORT';
  project.tax_profile.import = {
    ...project.tax_profile.import,
    calculationMode: 'CN_GENERAL_TRADE', declarationDate: '2026-09-10',
    dutyRates: { fallback: '0.05' }, hsTable: { basis: 'MFN', entries: [] },
    dutyExemptionThreshold: '50',
    vatDeductibleForBuyer: false,
    eligibility: { ...emptyEligibility(), duty_evidence: { status: 'EXAMPLE', reference: '虚构待遇条件，不对应实际原产地资格', valid_from: '2026-09-01', valid_to: '2026-09-30', checked_on: '' } },
    rateEvidence: { status: 'EXAMPLE', reference: '内置虚构税率，用于公式演示', valid_from: '2026-09-01', valid_to: '2026-09-30', checked_on: '' },
  };
  const customs = project.fx_books.find((book) => book.type === 'CUSTOMS');
  if (customs !== undefined) {
    customs.date = '2026-08-19';
    customs.name = '演示计征汇率（虚构，适用 2026-09）';
  }
  for (const book of project.fx_books) {
    book.evidence = Object.fromEntries(Object.keys(book.rates).map((pair) => [pair, {
      status: 'EXAMPLE' as const, reference: '内置虚构汇率，用于公式演示',
      valid_from: '2026-08-01', valid_to: '2026-09-30', checked_on: '',
    }]));
  }
  return project;
}

/** 空白中国进口交易：只有结构和用户所选模式，不填虚构业务数据。 */
export function newChinaImportProjectFile(): ProjectFile {
  return {
    schema_version: SCHEMA_VERSION, name: '', updated_at: new Date().toISOString(),
    base_currency: 'CNY', carriage_mode: 'SEA', route: emptyRoute(),
    goods: { name: '', quantity: '', unit: '', tax_key: '', trade_value_basis: 'UNCONFIRMED',
      trade_value: { amount: '', currency: 'CNY' }, seller_goods_cost: { amount: '', currency: 'CNY' } },
    items: [], fx_books: [], quote: { amount: '', currency: 'CNY', fx_type: 'CONTRACT' },
    incoterm: 'CIF', anchor: { kind: 'FIXED_QUOTE' }, facts: {},
    tax_profile: {
      id: 'china-general-trade', version: '1.0',
      import: { calculationMode: 'CN_GENERAL_TRADE', declarationDate: '', dutiableValueBasis: 'CIF',
        dutyRates: { fallback: '' }, hsTable: { basis: 'MFN', entries: [] }, vatRate: '',
        consumptionTax: null, vatDeductibleForBuyer: false, eligibility: emptyEligibility() },
      export: { dutiableValueBasis: 'FOB', dutyRates: { fallback: '0' },
        rebate: { entityType: 'TRADING', vatRates: { fallback: '0' }, rebateRates: { fallback: '0' } } },
      customsFx: { bookType: 'CUSTOMS', lockPeriod: 'MONTHLY' },
    },
  };
}
