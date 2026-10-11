import {
  CARRIAGE_MODES, COST_CATEGORIES, FX_TYPES, INCOTERMS, OCCURRENCE_REASONS,
  PRICING_METHODS, RESPONSIBILITIES, RESPONSIBILITY_SOURCES, TIER_BASES, TIER_MODES, TRADE_NODES,
} from '../domain/enums.js';
import { DUTY_RATE_BASES, DUTY_TYPES } from '../domain/hs-rate.js';
import { EngineError } from '../engine/errors.js';

type Validator = (value: unknown, path: string) => void;

function fail(path: string, expected: string): never {
  throw new EngineError('PROJECT_PARSE_FAILED', `项目文件字段 ${path} ${expected}`, { field: path });
}

const string: Validator = (value, path) => {
  if (typeof value !== 'string') fail(path, '应为文本');
};
const boolean: Validator = (value, path) => {
  if (typeof value !== 'boolean') fail(path, '应为布尔值');
};
// 结构校验允许空数值和未完成的输入原样存取。能否计算由引擎判断，不能因此丢弃草稿。
const numeric: Validator = (value, path) => {
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) {
    fail(path, '应为数值文本或有限数字');
  }
};
const number: Validator = (value, path) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, '应为有限数字');
};

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, '应为对象');
  return value as Record<string, unknown>;
}

const optional = (check: Validator): Validator => (value, path) => {
  if (value !== undefined) check(value, path);
};
const nullable = (check: Validator): Validator => (value, path) => {
  if (value !== null) check(value, path);
};
const oneOf = (values: readonly string[]): Validator => (value, path) => {
  if (typeof value !== 'string' || !values.includes(value)) fail(path, `应为 ${values.join(' / ')} 之一`);
};
const array = (check: Validator): Validator => (value, path) => {
  if (!Array.isArray(value)) fail(path, '应为数组');
  value.forEach((entry, index) => check(entry, `${path}[${index}]`));
};
const shape = (fields: Record<string, Validator>): Validator => (value, path) => {
  const object = record(value, path);
  for (const [key, check] of Object.entries(fields)) check(object[key], `${path}.${key}`);
};
const dictionary = (check: Validator): Validator => (value, path) => {
  for (const [key, entry] of Object.entries(record(value, path))) check(entry, `${path}.${key}`);
};

const money = shape({ amount: numeric, currency: string });
const evidence = shape({
  reference: string, valid_from: string, valid_to: string, checked_on: string,
  status: oneOf(['EXAMPLE', 'UNVERIFIED', 'USER_CONFIRMED']),
  values_key: optional(string),
});
const rateTable = shape({ fallback: numeric, byKey: optional(dictionary(numeric)) });
const baseRef: Validator = (value, path) => {
  const object = record(value, path);
  oneOf(['GOODS_VALUE', 'QUOTE_AMOUNT', 'COST_ITEMS', 'CUSTOMS_DUTIABLE_VALUE'])(object.kind, `${path}.kind`);
  if (object.kind === 'COST_ITEMS') array(string)(object.ids, `${path}.ids`);
};
const costItem = shape({
  cost_id: string, cost_name: string, cost_category: oneOf(COST_CATEGORIES), trade_node: oneOf(TRADE_NODES),
  applicable_incoterms: optional(array(oneOf(INCOTERMS))),
  alternative_group: optional(string),
  location: optional(string),
  timing: optional(shape({
    date: optional(string), start: optional(string), end: optional(string),
    phase: optional(oneOf(['PRE_SHIPMENT', 'IN_TRANSIT', 'POST_ARRIVAL'])),
  })),
  occurrence_reason: optional(oneOf(OCCURRENCE_REASONS)), pricing_method: oneOf(PRICING_METHODS),
  amount: optional(numeric), unit: optional(string), quantity: optional(numeric), rate: optional(numeric),
  days: optional(numeric), day_basis: optional(oneOf(['CALENDAR', 'WORKING'])),
  calculation_base: optional(baseRef), tiers: optional(array(shape({ up_to: nullable(numeric), rate: numeric }))),
  tier_mode: optional(oneOf(TIER_MODES)), tier_basis: optional(oneOf(TIER_BASES)), tier_charge_lower: optional(boolean),
  currency: string, fx_rate: optional(numeric), fx_type: oneOf(FX_TYPES), fx_date: optional(string),
  fx_evidence: optional(evidence),
  base_currency: string, base_amount: optional(numeric), tax_included: boolean, tax_rate_ref: optional(string),
  customs_value: optional(oneOf(['ADD', 'EXCLUDE'])),
  responsibility: oneOf(RESPONSIBILITIES), responsibility_source: oneOf(RESPONSIBILITY_SOURCES),
  payment_party: optional(oneOf(['SELLER', 'BUYER'])), economic_bearer: optional(oneOf(['SELLER', 'BUYER'])),
  included_in_quoted_price: boolean, contained_in_cost_id: optional(string), dedup_group: optional(string),
  is_goods_value: optional(boolean), includes_port_charges: optional(boolean),
  risk_relation: optional(oneOf(['BEFORE_TRANSFER', 'AFTER_TRANSFER', 'NOT_APPLICABLE'])),
  is_custom: boolean, source: oneOf(['USER', 'DERIVED']), notes: optional(string),
});
const fxBook = shape({
  id: string, name: string, type: oneOf(FX_TYPES), date: string,
  valid_from: optional(string), valid_to: optional(string), rates: dictionary(string),
  evidence: optional(dictionary(evidence)),
});
const hsTable = shape({
  basis: oneOf(DUTY_RATE_BASES),
  entries: array(shape({
    code: string, description: string, duty_type: optional(oneOf(DUTY_TYPES)),
    evidence: optional(evidence),
    duty_rates: optional(shape(Object.fromEntries(DUTY_RATE_BASES.map((basis) => [basis, optional(numeric)])))),
    specific_amount: optional(numeric), specific_unit: optional(string), vat_rate: optional(numeric),
    consumption_tax_rate: optional(numeric), notes: optional(string),
  })),
});
const anchor: Validator = (value, path) => {
  const object = record(value, path);
  oneOf(['ACTUAL_QUOTES', 'FIXED_QUOTE', 'FIXED_MARKET_PRICE', 'FIXED_MARGIN_RATE'])(object.kind, `${path}.kind`);
  if (object.kind === 'FIXED_MARKET_PRICE') {
    numeric(object.buyer_total, `${path}.buyer_total`);
    string(object.currency, `${path}.currency`);
  } else if (object.kind === 'FIXED_MARGIN_RATE') numeric(object.margin_rate, `${path}.margin_rate`);
};
const project = shape({
  schema_version: string, name: string, updated_at: string, base_currency: string,
  carriage_mode: oneOf(CARRIAGE_MODES), export_date: optional(string),
  route: optional(shape({
    export_country: string, import_country: string, origin_country: string,
    customs_regime: oneOf(['UNCONFIRMED', 'GENERAL_TRADE', 'OTHER']),
  })),
  goods: shape({
    name: string, quantity: numeric, unit: string, trade_value: money, seller_goods_cost: money, tax_key: optional(string),
    trade_value_basis: optional(oneOf(['UNCONFIRMED', 'NET', 'INCLUDES_FREIGHT_INSURANCE'])),
  }),
  items: array(costItem), fx_books: array(fxBook),
  tax_profile: shape({
    id: string, version: string,
    import: shape({
      calculationMode: optional(oneOf(['LEGACY', 'CN_GENERAL_TRADE'])), declarationDate: optional(string),
      rateEvidence: optional(evidence),
      eligibility: optional(shape({
        agreement_name: string, vat_taxpayer: oneOf(['UNCONFIRMED', 'GENERAL', 'OTHER']),
        vat_use: oneOf(['UNCONFIRMED', 'TAXABLE_BUSINESS', 'OTHER']),
        duty_evidence: optional(evidence), vat_evidence: optional(evidence),
      })),
      dutiableValueBasis: oneOf(['CIF']), insuranceFallbackRate: optional(numeric), dutyRates: rateTable,
      hsTable: optional(hsTable), dutyExemptionThreshold: optional(numeric),
      consumptionTax: optional(nullable(shape({ rate: numeric, basis: oneOf(['DUTIABLE_PLUS_DUTY']) }))),
      vatRate: numeric, vatDeductibleForBuyer: boolean,
    }),
    export: shape({
      dutiableValueBasis: oneOf(['FOB']), dutyRates: rateTable,
      rebate: shape({
        entityType: oneOf(['TRADING', 'MANUFACTURER']), rebateRates: rateTable, vatRates: rateTable,
        rebateLagDays: optional(number), sellerFundingRate: optional(numeric), endingCreditBalance: optional(numeric),
        consumption_tax_rebate_rate: optional(numeric),
      }),
    }),
    customsFx: shape({ bookType: oneOf(['CUSTOMS']), lockPeriod: oneOf(['MONTHLY']) }),
  }),
  quote: shape({ amount: string, currency: string, fx_type: oneOf(FX_TYPES), fx_date: optional(string), named_place: optional(string) }),
  evaluation_date: optional(string),
  term_scenarios: optional((value, path) => {
    const object = record(value, path);
    for (const [term, entry] of Object.entries(object)) {
      oneOf(INCOTERMS)(term, `${path}.${term}`);
      shape({
        quote: optional(shape({ amount: string, currency: string, fx_type: oneOf(FX_TYPES), fx_date: optional(string), named_place: optional(string) })),
        quote_evidence: optional(evidence),
        responsibility_overrides: optional(dictionary(shape({
          responsibility: oneOf(['SELLER', 'BUYER']), reason: optional(string), evidence: optional(evidence),
          payment_party: optional(oneOf(['SELLER', 'BUYER'])), economic_bearer: optional(oneOf(['SELLER', 'BUYER'])),
        }))),
      })(entry, `${path}.${term}`);
    }
  }),
  incoterm: oneOf(INCOTERMS), anchor,
  facts: optional(shape({
    delivery_place: optional(oneOf(['SELLER_PREMISES', 'OTHER'])),
    shipping_terms: optional(oneOf(['LINER', 'UNDER_TACKLE', 'STOWED', 'TRIMMED', 'STOWED_TRIMMED', 'EX_SHIP_HOLD', 'BULK'])),
    clearance_agent: optional(oneOf(['SELLER_ACTS_FOR_BUYER'])), loading_mode: optional(oneOf(['FCL', 'LCL'])),
  })),
});

/** 检查全部已知字段，但保留未知扩展字段，不静默改写文件内容。 */
export function validateProjectStructure(value: unknown): void {
  project(value, 'project');
  const object = record(value, 'project');
  const ids = new Set<string>();
  (object.items as Record<string, unknown>[]).forEach((item, index) => {
    const id = item.cost_id as string;
    if (id.trim() === '' || ['__proto__', 'constructor', 'prototype'].includes(id) || ids.has(id)) fail(`project.items[${index}].cost_id`, '不能为空、使用保留名称或与其他费用重复');
    ids.add(id);
    const terms = item.applicable_incoterms as string[] | undefined;
    if (terms !== undefined && new Set(terms).size !== terms.length) fail(`project.items[${index}].applicable_incoterms`, '术语不能重复');
  });
}

/** 草稿同时保存界面中的未完成汇率行，不允许坏行绕过项目文件的校验。 */
export function validateDraftFxRows(value: unknown): void {
  array(shape({
    row_id: string, type: oneOf(FX_TYPES), date: string, valid_from: optional(string), valid_to: optional(string),
    from: string, to: string, rate: string,
    evidence: optional(evidence),
  }))(value, 'draft.fxRows');
}
