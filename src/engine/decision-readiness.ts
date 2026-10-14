import { evidenceKey, hsEvidenceValues, taxEvidenceValues, type SourceEvidence } from '../domain/source-evidence.js';
import type { TaxProfile } from '../domain/tax-profile.js';
import type { Warning } from '../domain/warning.js';
import { findHsEntry } from '../domain/hs-rate.js';
import type { EnrichedCostItem } from './analyze.js';
import type { FxResolution } from './fx.js';
import type { DutiableComponent } from './tax/dutiable-value.js';
import { isChinaImport, isIsoDate } from './tax/china-import.js';
import type Decimal from 'decimal.js';
import type { TradeRoute } from '../domain/import-context.js';
import { eligibilityValues } from '../domain/import-context.js';
import { DUTY_RATE_BASIS_LABELS } from '../domain/hs-rate.js';

export interface SourceCheck {
  label: string;
  applicable_date: string;
  evidence?: SourceEvidence;
  issues: string[];
}

export interface DecisionReadiness {
  ready: boolean;
  issues: string[];
  sources: SourceCheck[];
  context: string[];
}

export function checkSource(label: string, date: string, evidence?: SourceEvidence, expectedKey?: string): SourceCheck {
  const issues: string[] = [];
  if (evidence === undefined) issues.push('缺少来源核对记录');
  else {
    if (evidence.status === 'EXAMPLE') issues.push('使用示例数据');
    else if (evidence.status !== 'USER_CONFIRMED') issues.push('用户尚未核对');
    if (evidence.status === 'USER_CONFIRMED' && (expectedKey === undefined || evidence.values_key !== expectedKey)) issues.push('数据或来源记录已变动，需要重新核对');
    if (evidence.reference.trim() === '') issues.push('来源链接或文件编号未填写');
    if (!isIsoDate(evidence.checked_on)) issues.push('核对日期未填写或无效');
    if (!isIsoDate(evidence.valid_from) || !isIsoDate(evidence.valid_to) || evidence.valid_from > evidence.valid_to) {
      issues.push('来源适用期未填写或无效');
    } else if (!isIsoDate(date) || date < evidence.valid_from || date > evidence.valid_to) {
      issues.push(`来源适用期不覆盖 ${date}`);
    }
  }
  return { label, applicable_date: date, ...(evidence !== undefined ? { evidence } : {}), issues };
}

export function checkFxSources(resolutions: readonly FxResolution[], fallbackDate = ''): SourceCheck[] {
  const checks = new Map<string, SourceCheck>();
  for (const [index, fx] of resolutions.entries()) {
    if (fx.source === 'IDENTITY') continue;
    const label = `${fx.fx_type === 'CUSTOMS' ? '海关计征' : '商业'}汇率 ${fx.from}/${fx.to}${fx.inverted ? '（反向折算）' : ''}`;
    // 不同费用项可使用相同显式汇率，但其人工来源记录必须分别通过核对。
    const key = `${label}|${fx.book_id ?? `manual:${index}`}|${fx.fx_date ?? ''}|${fx.rate.toString()}`;
    checks.set(key, checkSource(label, fx.fx_date ?? fallbackDate, fx.evidence, fx.evidence_key));
  }
  return [...checks.values()];
}

const incompleteWarnings = new Set<Warning['code']>([
  'DUTY_BASE_INCOMPLETE', 'CUSTOMS_FX_FALLBACK', 'HS_CODE_PARENT_MATCH', 'HS_CODE_NOT_FOUND',
  'HS_RATE_BASIS_FALLBACK', 'INSURANCE_REQUIRED_MISSING', 'INSURANCE_FALLBACK_APPLIED',
  'FCA_DELIVERY_UNCONFIRMED',
]);

export function assessDecision(input: {
  taxProfile: TaxProfile;
  taxKey?: string;
  goodsPriceBasis?: string | undefined;
  route?: TradeRoute;
  items: readonly EnrichedCostItem[];
  warnings: readonly Warning[];
  customsComponents: readonly DutiableComponent[];
  commercialFx: readonly FxResolution[];
  totals: readonly Decimal[];
}): DecisionReadiness {
  const issues: string[] = [];
  if (input.totals.some((value) => !value.isFinite())) issues.push('结果包含非有限金额，不能参与排名');
  if (input.items.some((item) => !item.base_amount.isZero() && (
    item.exclusion === 'CONDITIONAL_UNRESOLVED' || item.exclusion === 'SHARED_NOT_SPLIT'
  ))) issues.push('存在未计入双方成本的待确认或未拆分费用');
  for (const warning of input.warnings) {
    if (warning.level === 'ERROR' || incompleteWarnings.has(warning.code)) issues.push(warning.message);
  }

  const sources: SourceCheck[] = [];
  const context: string[] = [];
  if (isChinaImport(input.taxProfile)) {
    const rules = input.taxProfile.import;
    const date = rules.declarationDate ?? '';
    if (input.goodsPriceBasis !== 'NET') issues.push('请确认货物净价不含另列的运费及保险费，避免整价重复加计');
    context.push(`货值录入口径：${input.goodsPriceBasis === 'NET' ? '已确认货物净价不含运保费' : '尚未确认净价口径'}`);
    const route = input.route;
    const eligibility = rules.eligibility;
    const basis = rules.hsTable?.basis ?? 'MFN';
    if (!route?.export_country.trim()) issues.push('请填写出口国或地区，出口地不等于原产地');
    if (!route?.origin_country.trim()) issues.push('请填写原产国或地区并核对原产地依据');
    if (!['CN', 'CHINA', '中国', '中华人民共和国'].includes(route?.import_country.trim().toUpperCase() ?? '')) issues.push('进口国未确认或不属于当前中国进口模型范围');
    if (route?.customs_regime !== 'GENERAL_TRADE') issues.push('尚未确认一般贸易进口，其他申报制度不在本模型范围');
    if (basis === 'AGREEMENT' && !eligibility?.agreement_name.trim()) issues.push('选择协定税率时，请填写协定名称并核对优惠原产地及其他适用条件');
    context.push(`出口国/地区：${route?.export_country || '未填'}；进口国/地区：${route?.import_country || '未填'}；原产国/地区：${route?.origin_country || '未填'}`);
    context.push(`申报制度：${route?.customs_regime === 'GENERAL_TRADE' ? '一般贸易（人工录入）' : '未确认或其他制度'}；关税口径：${DUTY_RATE_BASIS_LABELS[basis]}${basis === 'AGREEMENT' ? `；协定：${eligibility?.agreement_name || '未填'}` : ''}`);
    const checkEligibility = (kind: 'duty' | 'vat', label: string): SourceCheck => {
      const evidence = kind === 'duty' ? eligibility?.duty_evidence : eligibility?.vat_evidence;
      const values = eligibilityValues(kind, route, input.taxKey, rules);
      return checkSource(label, date, evidence, evidence ? evidenceKey(values, evidence) : undefined);
    };
    sources.push(checkEligibility('duty', '原产地与关税待遇适用条件'));
    if (rules.vatDeductibleForBuyer) {
      if (eligibility?.vat_taxpayer !== 'GENERAL') issues.push('勾选进口VAT抵扣后，请核对买方一般纳税人身份；其他身份暂不支持全额抵扣测算');
      if (eligibility?.vat_use !== 'TAXABLE_BUSINESS') issues.push('勾选进口VAT抵扣后，请核对货物用于可抵扣的应税经营；混合用途或其他用途暂不支持全额抵扣测算');
      sources.push(checkEligibility('vat', '买方进口VAT抵扣资格与凭证条件'));
    }
    context.push(`买方进口VAT：${rules.vatDeductibleForBuyer ? '按全额可抵扣假设测算，资格及凭证需人工核对' : '按不可抵扣测算'}`);
    const entry = findHsEntry(rules.hsTable, input.taxKey)?.entry;
    const checkTax = (label: string, useEntry: boolean): SourceCheck => {
      const evidence = useEntry ? entry?.evidence : rules.rateEvidence;
      const values = useEntry && entry ? hsEvidenceValues(entry, rules.hsTable?.basis) : taxEvidenceValues(rules);
      return checkSource(label, date, evidence, evidence ? evidenceKey(values, evidence) : undefined);
    };
    sources.push(checkTax('关税税率', entry !== undefined));
    sources.push(checkTax('进口增值税率', entry?.vat_rate !== undefined));
    sources.push(checkTax('消费税适用性与税率', entry?.consumption_tax_rate !== undefined));
    sources.push(...checkFxSources([
      ...input.commercialFx,
      ...input.customsComponents.flatMap((component) => component.fx ? [component.fx] : []),
    ], date));
    for (const source of sources) {
      if (source.issues.length > 0) issues.push(`${source.label}：${source.issues.join('；')}`);
    }
  }
  return { ready: issues.length === 0, issues: [...new Set(issues)], sources, context };
}
