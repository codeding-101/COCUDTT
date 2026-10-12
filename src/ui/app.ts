import { COST_PRESETS, customCostItem, presetToCostItem } from '../data/cost-presets.js';
import {
  parseProject,
  serializeProject,
  toScenario,
  toScenarios,
  toTrade,
  touchProject,
  type ProjectFile,
} from '../data/project-file.js';
import { chinaImportSampleProjectFile, newChinaImportProjectFile, sampleProjectFile } from '../data/sample-project.js';
import { validateDraftFxRows } from '../data/project-validation.js';
import { emptyEvidence, evidenceKey, fxEvidenceValues, hsEvidenceValues, invalidateEvidence, taxEvidenceValues, type SourceEvidence } from '../domain/source-evidence.js';
import { eligibilityValues, emptyEligibility, emptyRoute } from '../domain/import-context.js';
import type { BaseRef, CostItem } from '../domain/cost-item.js';
import { INCOTERMS, type Incoterm } from '../domain/enums.js';
import type { DutyType, HsRateTable } from '../domain/hs-rate.js';
import type {
  CostCategory,
  FxType,
  OccurrenceReason,
  PricingMethod,
  TierBasis,
  TierMode,
  TradeNode,
} from '../domain/enums.js';
import type { ComparisonAnchor } from '../domain/scenario.js';
import { overrideEvidenceValues, quoteEvidenceValues } from '../domain/contract-evidence.js';
import { emptyContractQuote } from './contracts-input.js';
import { emptyInsurancePlan, emptyTransportPlan, insuranceEvidenceValues, transportEvidenceValues } from '../domain/logistics-evidence.js';
import type { ContainerCharge } from '../domain/logistics.js';
import { analyze, type AnalysisResult } from '../engine/analyze.js';
import { compare, scenarioWithDerivedInclusions, type Comparison } from '../engine/compare.js';
import { isEngineError } from '../engine/errors.js';
import { booksToRows, rowsToBooks, type FxRow } from './fx-rows.js';
import { escapeHtml } from './format.js';
import { nextCostId, renderFormsRow, renderFxPanel, renderHsPanel, renderImportTaxPanel, renderItemsPanel, type ItemEnrichment } from './views-input.js';
import { createProjectReport } from './project-report.js';
import { renderKpis, renderOutputColumn } from './views-output.js';
import { newSensitivityControls, projectSensitivity, renderSensitivityPanel, sensitivityOptions } from './sensitivity.js';
import type { SensitivityResult } from '../engine/sensitivity.js';
import { emptyCustomerQuoteFields, CUSTOMER_QUOTE_FIELDS, type CustomerQuote } from '../domain/customer-quote.js';
import { createCustomerQuoteDocument, customerQuoteFileName, projectCustomerQuote, renderCustomerQuotePanel } from './customer-quote.js';
import { createCustomerWorkbook, createInternalWorkbook } from './workbook-export.js';
import { XLSX_MIME } from '../data/xlsx-file.js';
import fontLicense from '../assets/fonts/LICENSE-OFL.txt?raw';
import fontProvenance from '../assets/fonts/provenance.json?raw';

const DRAFT_KEY = 'trade-cost-engine:draft-v1';

interface AppState {
  project: ProjectFile;
  fxRows: FxRow[];
  result: AnalysisResult | null;
  comparison: Comparison | null;
  error: string | null;
  status: string;
  statusLevel: 'info' | 'warn' | 'error';
  fileName: string | null;
  savedAt: string | null;
  dirty: boolean;
}

interface DraftPayload {
  project: ProjectFile;
  fxRows: FxRow[];
}

/** 折叠的面板；跨渲染保留 */
const collapsedSections = new Set<string>();
const expandedEvidenceSections = new Set<string>();

interface DraftLoad {
  payload: DraftPayload | null;
  /** 草稿存在但读不出来时的说明；有值就必须告诉用户 */
  failure: string | null;
}

/**
 * 读取草稿。两种失败要分清：
 * - 浏览器禁用了本地存储 → 草稿功能不可用，与用户数据无关，静默跳过
 * - 草稿存在但解析失败 → 用户的未保存内容丢了，必须明说，不能装作无事发生
 */
function loadDraft(): DraftLoad {
  let raw: string | null;
  try {
    raw = localStorage.getItem(DRAFT_KEY);
  } catch {
    return { payload: null, failure: null };
  }
  if (raw === null) return { payload: null, failure: null };

  try {
    const parsed = JSON.parse(raw) as DraftPayload;
    validateDraftFxRows(parsed.fxRows);
    return { payload: { project: parseProject(JSON.stringify(parsed.project)), fxRows: parsed.fxRows }, failure: null };
  } catch (error) {
    const detail = isEngineError(error) ? `（${error.code}）` : '';
    return { payload: null, failure: `上次的草稿无法读取${detail}，已载入示例数据；原草稿暂未覆盖，请先备份浏览器本地存储。继续编辑或打开其他项目将更新草稿` };
  }
}

function saveDraft(project: ProjectFile, fxRows: readonly FxRow[]): boolean {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ project, fxRows }));
    return true;
  } catch {
    return false;
  }
}

/** 启动时是否从草稿恢复，必须在 initialState() 之前声明 */
let restoredFromDraft = false;
/** 草稿读取失败的说明，启动时展示 */
let draftFailure: string | null = null;
let draftStorageUnavailable = false;

function initialState(): AppState {
  const draft = loadDraft();
  const project = draft.payload?.project ?? sampleProjectFile();
  const fxRows = draft.payload?.fxRows ?? booksToRows(project.fx_books);
  restoredFromDraft = draft.payload !== null;
  draftFailure = draft.failure;
  return {
    project,
    fxRows,
    result: null,
    comparison: null,
    error: null,
    status: '',
    statusLevel: 'info',
    fileName: null,
    savedAt: null,
    dirty: draft.payload !== null,
  };
}

let state: AppState = initialState();
let sensitivityControls = newSensitivityControls();
let sensitivityAnalysis: SensitivityResult | null = null;
let sensitivityError: string | null = null;
let customerFields = emptyCustomerQuoteFields();
let customerReviewed = false;
let customerPreview: CustomerQuote | null = null;
let customerError: string | null = null;
let customerPdfBusy = false;

function recomputeCustomerPreview(): void {
  customerPreview = null;
  customerError = null;
  try { customerPreview = projectCustomerQuote(currentProject(), customerFields); }
  catch (error) { customerError = error instanceof Error ? error.message : '公开报价数据未完成，请核对'; }
}

function recomputeSensitivity(): void {
  sensitivityAnalysis = null;
  sensitivityError = null;
  if (!sensitivityControls.enabled) return;
  try { sensitivityAnalysis = projectSensitivity(currentProject(), sensitivityControls); }
  catch (error) { sensitivityError = error instanceof Error ? error.message : String(error); }
}

function currentProject(): ProjectFile {
  return { ...state.project, fx_books: rowsToBooks(state.fxRows) };
}

function recompute(persistDraft = true): void {
  const project = currentProject();
  try {
    const trade = toTrade(project);
    const template = toScenario(project);
    const scenario = scenarioWithDerivedInclusions(template, trade);
    state.result = analyze({
      trade,
      scenario,
      taxProfile: project.tax_profile,
      fxBooks: project.fx_books,
      ...(project.export_date !== undefined ? { today: project.export_date } : {}),
    });
    state.comparison = compare({
      trade,
      template,
      scenarios: toScenarios(project),
      anchor: project.anchor,
      taxProfile: project.tax_profile,
      fxBooks: project.fx_books,
      ...(project.export_date !== undefined ? { today: project.export_date } : {}),
    });
    state.error = null;
    const errors = state.result.warnings.filter((warning) => warning.level === 'ERROR').length;
    const warns = state.result.warnings.filter((warning) => warning.level === 'WARN').length;
    const infos = state.result.warnings.filter((warning) => warning.level === 'INFO').length;
    state.status =
      errors > 0 ? `${errors} 条错误级提示` : `${warns} 条提示 · ${infos} 条说明`;
    state.statusLevel = errors > 0 ? 'error' : 'info';
  } catch (error) {
    state.result = null;
    state.comparison = null;
    state.error = isEngineError(error) ? `[${error.code}] ${error.message}` : `[未知错误] ${String(error)}`;
    if (isEngineError(error) && (project.anchor.kind === 'ACTUAL_QUOTES' || project.term_scenarios !== undefined || project.items.some(item => item.applicable_incoterms !== undefined || item.alternative_group?.trim()))) {
      try {
        state.comparison = compare({ trade: toTrade(project), template: toScenario(project), anchor: project.anchor,
          scenarios: toScenarios(project),
          taxProfile: project.tax_profile, fxBooks: project.fx_books,
          ...(project.export_date !== undefined ? { today: project.export_date } : {}) });
      } catch { /* 公共输入不完整时仍显示错误，不沿用旧结果。 */ }
    }
    state.status = '输入不足以完成计算';
    state.statusLevel = 'error';
  }
  if (persistDraft) draftStorageUnavailable = !saveDraft(state.project, state.fxRows);
  recomputeSensitivity();
  recomputeCustomerPreview();
}

/** 把计算结果回填到录入区：金额与归属，让用户边录边看到结果 */
function enrichmentMap(): Map<string, ItemEnrichment> {
  const map = new Map<string, ItemEnrichment>();
  if (state.result === null) return map;
  for (const enriched of state.result.items) {
    map.set(enriched.item.cost_id, {
      base_amount: enriched.base_amount,
      responsibility: enriched.responsibility,
      exclusion: enriched.exclusion,
      rule_id: enriched.rule_id,
      note: enriched.note,
    });
  }
  return map;
}

// ---------- 输入绑定 ----------

function focusKeyOf(element: Element): string | null {
  const dataset = (element as HTMLElement).dataset;
  if (dataset.sensitivityField !== undefined) return `sensitivity:${dataset.sensitivityField}`;
  if (dataset.customerField !== undefined) return `customer:${dataset.customerField}`;
  if (dataset.evidenceOwner !== undefined && dataset.evidenceField !== undefined) {
    return `evidence:${dataset.evidenceOwner}:${dataset.evidenceId ?? ''}:${dataset.evidenceField}`;
  }
  if (dataset.path !== undefined) return `path:${dataset.path}`;
  if (dataset.logisticsKind !== undefined) return `logistics:${dataset.logisticsKind}:${dataset.logisticsField}:${dataset.segmentIndex ?? ''}`;
  if (dataset.contractCost !== undefined) return `contract:${dataset.contractCost}:${dataset.contractField}`;
  if (dataset.item !== undefined && dataset.itemField !== undefined) {
    return `item:${dataset.item}:${dataset.itemField}${dataset.term === undefined ? '' : `:${dataset.term}`}`;
  }
  if (dataset.fx !== undefined && dataset.fxField !== undefined) {
    return `fx:${dataset.fx}:${dataset.fxField}`;
  }
  return null;
}

function restoreFocus(key: string | null): void {
  if (key === null) return;
  const element = Array.from(document.querySelectorAll<HTMLElement>('[data-path],[data-item],[data-fx],[data-evidence-owner],[data-contract-cost],[data-logistics-kind],[data-sensitivity-field],[data-customer-field]')).find(
    (candidate) => focusKeyOf(candidate) === key,
  );
  element?.focus();
}

function setPath(path: string, raw: string): void {
  const parts = path.split('.');
  let cursor = state.project as unknown as Record<string, unknown>;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (key === undefined) return;
    const next = cursor[key];
    if (typeof next !== 'object' || next === null) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  if (last === undefined) return;
  const trimmed = raw.trim();
  const optional =
    path.startsWith('facts.') || path.endsWith('_date') || path === 'goods.tax_key' || path === 'export_date';
  cursor[last] = optional && trimmed === '' ? undefined : trimmed;
}

function onProjectField(path: string, target: HTMLInputElement | HTMLSelectElement): void {
  if (path.startsWith('term_scenarios.')) {
    const term = path.split('.')[1] as Incoterm;
    if (!INCOTERMS.includes(term)) return;
    const record = (state.project.term_scenarios ??= {})[term] ??= {};
    record.quote ??= emptyContractQuote(state.project);
    invalidateEvidence(record.quote_evidence);
    invalidateEvidence(record.insurance?.evidence);
    if (path.endsWith('.named_place')) invalidateEvidence(record.transport?.evidence);
  }
  if (path.startsWith('goods.') || path.startsWith('facts.') || path === 'base_currency') {
    for (const record of Object.values(state.project.term_scenarios ?? {})) {
      invalidateEvidence(record.quote_evidence);
      invalidateEvidence(record.insurance?.evidence);
      invalidateEvidence(record.transport?.evidence);
      if (path.startsWith('facts.') || path === 'base_currency') Object.values(record.responsibility_overrides ?? {}).forEach(override => invalidateEvidence(override.evidence));
    }
  }
  const rules = state.project.tax_profile.import;
  if (path.startsWith('route.')) state.project.route ??= emptyRoute();
  if (path.startsWith('tax_profile.import.eligibility.')) rules.eligibility ??= emptyEligibility();
  if (path.startsWith('route.') || ['goods.tax_key', 'tax_profile.import.declarationDate', 'tax_profile.import.calculationMode'].includes(path)) {
    invalidateEvidence(rules.eligibility?.duty_evidence);
    invalidateEvidence(rules.eligibility?.vat_evidence);
  }
  if (['tax_profile.import.hsTable.basis', 'tax_profile.import.eligibility.agreement_name'].includes(path)) invalidateEvidence(rules.eligibility?.duty_evidence);
  if (['tax_profile.import.vatDeductibleForBuyer', 'tax_profile.import.eligibility.vat_taxpayer', 'tax_profile.import.eligibility.vat_use'].includes(path)) invalidateEvidence(rules.eligibility?.vat_evidence);
  if (['tax_profile.import.dutyRates.fallback', 'tax_profile.import.vatRate', 'tax_profile.import.consumptionTax.rate'].includes(path)) {
    invalidateEvidence(state.project.tax_profile.import.rateEvidence);
  }
  if (path === 'tax_profile.import.hsTable.basis') {
    ensureHsTable(state.project).entries.forEach((entry) => invalidateEvidence(entry.evidence));
  }
  if (path === 'tax_profile.import.consumptionTax.rate') {
    state.project.tax_profile.import.consumptionTax = target.value.trim() === '' ? null : {
      rate: target.value.trim(), basis: 'DUTIABLE_PLUS_DUTY',
    };
    return;
  }
  if (path === 'tax_profile.import.vatDeductibleForBuyer' && target instanceof HTMLInputElement) {
    state.project.tax_profile.import.vatDeductibleForBuyer = target.checked;
    return;
  }
  if (path === 'anchor.kind') {
    const kind = target.value as ComparisonAnchor['kind'];
    const fallbackTotal = state.result?.buyer.landed_cost_with_tax.toFixed(2) ?? '900000.00';
    state.project.anchor =
      kind === 'FIXED_MARKET_PRICE'
        ? { kind, buyer_total: fallbackTotal, currency: state.project.base_currency }
        : kind === 'FIXED_MARGIN_RATE'
          ? { kind, margin_rate: '0.2' }
          : kind === 'ACTUAL_QUOTES' ? { kind } : { kind: 'FIXED_QUOTE' };
    return;
  }
  setPath(path, target.value);
}

function onItemField(costId: string, field: string, target: HTMLInputElement | HTMLSelectElement): void {
  const item = state.project.items.find((candidate) => candidate.cost_id === costId);
  if (item === undefined) return;
  for (const record of Object.values(state.project.term_scenarios ?? {})) invalidateEvidence(record.responsibility_overrides?.[costId]?.evidence);
  const value = target.value;
  if (['currency', 'fx_type', 'fx_date'].includes(field)) invalidateEvidence(item.fx_evidence);
  const isCheckbox = target instanceof HTMLInputElement && target.type === 'checkbox';
  switch (field) {
    case 'container_charge': item.container_charge = value.trim() ? value as ContainerCharge : undefined; break;
    case 'container_charge_scope': item.container_charge_scope = value.trim() || undefined; break;
    case 'applicability':
      item.applicable_incoterms = value === 'ALL' ? undefined : value === 'NONE' ? []
        : value === 'SELLER' ? ['CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP']
        : value === 'BUYER' ? ['EXW', 'FCA', 'FAS', 'FOB'] : [state.project.incoterm];
      break;
    case 'applicable_term': {
      if (!(target instanceof HTMLInputElement)) break;
      const term = target.dataset.term as Incoterm;
      if (!INCOTERMS.includes(term)) break;
      const terms = new Set(item.applicable_incoterms ?? INCOTERMS);
      if (target.checked) terms.add(term); else terms.delete(term);
      item.applicable_incoterms = INCOTERMS.filter(t => terms.has(t));
      break;
    }
    case 'alternative_group':
      item.alternative_group = value.trim() || undefined;
      break;
    case 'cost_name':
      item.cost_name = value;
      break;
    case 'trade_node':
      item.trade_node = value as TradeNode;
      break;
    case 'cost_category':
      item.cost_category = value as CostCategory;
      break;
    case 'customs_value':
      item.customs_value = value === '' ? undefined : value as CostItem['customs_value'];
      break;
    case 'pricing_method':
      item.pricing_method = value as PricingMethod;
      if (item.pricing_method === 'PERCENT' && item.calculation_base === undefined) {
        item.calculation_base = { kind: 'QUOTE_AMOUNT' };
      }
      if (item.pricing_method === 'TIERED') {
        item.tier_mode ??= 'MARGINAL';
        item.tier_basis ??= 'QUANTITY';
        ensureTiers(item);
      }
      break;
    case 'tier_mode':
      item.tier_mode = value as TierMode;
      break;
    case 'tier_basis':
      item.tier_basis = value as TierBasis;
      break;
    case 'tier_charge_lower':
      item.tier_charge_lower = isCheckbox ? target.checked : value === 'true';
      break;
    case 'tier-up':
    case 'tier-rate': {
      const index = Number(target.dataset.tierIndex ?? '-1');
      const tier = item.tiers?.[index];
      if (tier === undefined) break;
      if (field === 'tier-up') {
        const trimmed = value.trim();
        tier.up_to = trimmed === '' ? null : trimmed;
      } else {
        tier.rate = value.trim();
      }
      break;
    }
    case 'amount':
      item.amount = value.trim();
      break;
    case 'quantity':
      item.quantity = value.trim();
      break;
    case 'rate':
      item.rate = value.trim();
      break;
    case 'days':
      item.days = value.trim();
      break;
    case 'unit':
      item.unit = value.trim();
      break;
    case 'currency':
      item.currency = value.trim();
      break;
    case 'fx_type':
      item.fx_type = value as FxType;
      break;
    case 'fx_date':
      item.fx_date = value.trim() === '' ? undefined : value.trim();
      break;
    case 'occurrence_reason':
      item.occurrence_reason = value === '' ? undefined : (value as OccurrenceReason);
      break;
    case 'contained_in':
      item.contained_in_cost_id = value === '' ? undefined : value;
      break;
    case 'base':
      switch (value) {
        case 'GOODS_VALUE':
          item.calculation_base = { kind: 'GOODS_VALUE' };
          break;
        case 'QUOTE_AMOUNT':
          item.calculation_base = { kind: 'QUOTE_AMOUNT' };
          break;
        case 'CUSTOMS_DUTIABLE_VALUE':
          item.calculation_base = { kind: 'CUSTOMS_DUTIABLE_VALUE' };
          break;
        default:
          break;
      }
      break;
    case 'included_in_quoted_price':
      item.included_in_quoted_price = isCheckbox ? target.checked : value === 'true';
      break;
    case 'is_goods_value':
      item.is_goods_value = isCheckbox ? target.checked : false;
      break;
    case 'includes_port_charges':
      item.includes_port_charges = isCheckbox ? target.checked : false;
      break;
    default:
      break;
  }
}

/** HS 税率表：没有表结构时按需创建，避免用户先手动建一层空壳 */
function ensureHsTable(project: ProjectFile): HsRateTable {
  const rules = project.tax_profile.import;
  rules.hsTable ??= { basis: 'MFN', entries: [] };
  return rules.hsTable;
}

function onHsField(index: number, field: string, target: HTMLInputElement | HTMLSelectElement): void {
  const table = ensureHsTable(state.project);
  const entry = table.entries[index];
  if (entry === undefined) return;
  const value = target.value;
  const trimmed = value.trim();
  invalidateEvidence(entry.evidence);
  switch (field) {
    case 'code':
      entry.code = trimmed;
      break;
    case 'description':
      entry.description = value;
      break;
    case 'duty_type':
      entry.duty_type = value as DutyType;
      break;
    case 'duty_rate': {
      // 只维护当前口径的税率，避免让用户在一个单元格里填四个口径
      entry.duty_rates ??= {};
      if (trimmed === '') delete entry.duty_rates[table.basis];
      else entry.duty_rates[table.basis] = trimmed;
      break;
    }
    case 'vat_rate':
      entry.vat_rate = trimmed === '' ? undefined : trimmed;
      break;
    case 'consumption_tax_rate':
      entry.consumption_tax_rate = trimmed === '' ? undefined : trimmed;
      break;
    case 'specific_amount':
      entry.specific_amount = trimmed === '' ? undefined : trimmed;
      break;
    case 'specific_unit':
      entry.specific_unit = trimmed === '' ? undefined : trimmed;
      break;
    default:
      break;
  }
}

function onFxField(rowId: string, field: string, target: HTMLInputElement | HTMLSelectElement): void {
  const row = state.fxRows.find((candidate) => candidate.row_id === rowId);
  if (row === undefined) return;
  const value = target.value;
  invalidateEvidence(row.evidence);
  switch (field) {
    case 'type':
      row.type = value as FxType;
      break;
    case 'date':
      row.date = value.trim();
      break;
    case 'valid_from':
      row.valid_from = value.trim() === '' ? undefined : value.trim();
      break;
    case 'valid_to':
      row.valid_to = value.trim() === '' ? undefined : value.trim();
      break;
    case 'from':
      row.from = value.trim().toUpperCase();
      break;
    case 'to':
      row.to = value.trim().toUpperCase();
      break;
    case 'rate':
      row.rate = value.trim();
      break;
    default:
      break;
  }
}

function onEvidenceField(owner: string, id: string, field: string, value: string): void {
  let evidence: SourceEvidence;
  let values: unknown;
  if (owner === 'transport' || owner === 'insurance') {
    const term = id as Incoterm;
    if (!INCOTERMS.includes(term)) return;
    const record = state.project.term_scenarios?.[term];
    if (!record?.[owner]) return;
    evidence = record[owner]!.evidence ??= emptyEvidence();
    const scenario = toScenario(state.project, term);
    values = owner === 'transport' ? transportEvidenceValues(scenario) : insuranceEvidenceValues(scenario, state.project.goods);
  } else if (owner === 'quote') {
    const term = id as Incoterm;
    if (!INCOTERMS.includes(term)) return;
    const record = (state.project.term_scenarios ??= {})[term] ??= {};
    record.quote ??= emptyContractQuote(state.project);
    evidence = record.quote_evidence ??= emptyEvidence();
    values = quoteEvidenceValues(toTrade(state.project), toScenario(state.project, term));
  } else if (owner === 'contract-cost') {
    const [term, costId] = JSON.parse(id) as [Incoterm, string];
    const override = state.project.term_scenarios?.[term]?.responsibility_overrides?.[costId];
    if (!override) return;
    evidence = override.evidence ??= emptyEvidence();
    values = overrideEvidenceValues(toTrade(state.project), toScenario(state.project, term), costId);
  } else if (owner === 'tax') {
    evidence = state.project.tax_profile.import.rateEvidence ??= emptyEvidence();
    values = taxEvidenceValues(state.project.tax_profile.import);
  }
  else if (owner === 'duty-eligibility' || owner === 'vat-eligibility') {
    const rules = state.project.tax_profile.import;
    const eligibility = rules.eligibility ??= emptyEligibility();
    const kind = owner === 'duty-eligibility' ? 'duty' : 'vat';
    evidence = kind === 'duty' ? eligibility.duty_evidence ??= emptyEvidence() : eligibility.vat_evidence ??= emptyEvidence();
    values = eligibilityValues(kind, state.project.route, state.project.goods.tax_key, rules);
  }
  else if (owner === 'fx') {
    const row = state.fxRows.find((candidate) => candidate.row_id === id);
    if (row === undefined) return;
    evidence = row.evidence ??= emptyEvidence();
    values = fxEvidenceValues(row);
  } else if (owner === 'hs') {
    const entry = state.project.tax_profile.import.hsTable?.entries[Number(id)];
    if (entry === undefined) return;
    evidence = entry.evidence ??= emptyEvidence();
    values = hsEvidenceValues(entry, state.project.tax_profile.import.hsTable?.basis);
  } else if (owner === 'cost') {
    const item = state.project.items.find((candidate) => candidate.cost_id === id);
    if (item === undefined) return;
    evidence = item.fx_evidence ??= emptyEvidence();
    values = { from: item.currency, to: state.project.base_currency, rate: item.fx_rate, type: item.fx_type, date: item.fx_date };
  } else return;
  if (field !== 'status') invalidateEvidence(evidence);
  switch (field) {
    case 'reference': evidence.reference = value.trim(); break;
    case 'valid_from': evidence.valid_from = value.trim(); break;
    case 'valid_to': evidence.valid_to = value.trim(); break;
    case 'checked_on': evidence.checked_on = value.trim(); break;
    case 'status':
      evidence.status = value === 'EXAMPLE' || value === 'USER_CONFIRMED' ? value : 'UNVERIFIED';
      if (evidence.status === 'USER_CONFIRMED') evidence.values_key = evidenceKey(values, evidence);
      break;
  }
}

// ---------- 动作 ----------

function onLogisticsField(kind: string, field: string, target: HTMLInputElement | HTMLSelectElement): void {
  const record = (state.project.term_scenarios ??= {})[state.project.incoterm] ??= {};
  if (kind === 'transport') {
    const plan = record.transport ??= emptyTransportPlan();
    invalidateEvidence(plan.evidence); invalidateEvidence(record.insurance?.evidence);
    if (target.dataset.segmentIndex !== undefined) {
      const segment = plan.segments[Number(target.dataset.segmentIndex)];
      if (segment && ['mode', 'from', 'to', 'carrier', 'contract_reference'].includes(field)) (segment as unknown as Record<string, unknown>)[field] = target.value.trim();
    } else if (['delivery_segment_id', 'delivery_location', 'delivery_at', 'delivery_event', 'handover_basis', 'agreement_note', 'paid_to'].includes(field)) (plan as unknown as Record<string, unknown>)[field] = target.value.trim();
  } else if (kind === 'insurance') {
    const policy = record.insurance ??= emptyInsurancePlan((record.quote ?? state.project.quote).currency);
    invalidateEvidence(policy.evidence);
    if (field === 'sum_insured.amount' || field === 'sum_insured.currency') policy.sum_insured[field === 'sum_insured.amount' ? 'amount' : 'currency'] = target.value.trim();
    else if (['scope_confirmed', 'direct_claim_confirmed'].includes(field) && target instanceof HTMLInputElement) (policy as unknown as Record<string, unknown>)[field] = target.checked;
    else if (['cover', 'clause_version', 'insured_from', 'insured_to', 'insurer', 'policy_reference', 'deductible', 'exclusions', 'agreed_cover_note'].includes(field)) (policy as unknown as Record<string, unknown>)[field] = target.value.trim();
  }
}

function addTransportSegment(): void {
  const record = (state.project.term_scenarios ??= {})[state.project.incoterm] ??= {};
  const plan = record.transport ??= emptyTransportPlan();
  let number = 1; while (plan.segments.some(segment => segment.segment_id === `leg-${number}`)) number++;
  plan.segments.push({ segment_id: `leg-${number}`, mode: 'ROAD', from: plan.segments[plan.segments.length - 1]?.to ?? '', to: '', carrier: '', contract_reference: '' });
  invalidateEvidence(plan.evidence); invalidateEvidence(record.insurance?.evidence);
}

function onContractField(costId: string, field: string, value: string): void {
  if (!state.project.items.some(item => item.cost_id === costId) && value !== 'DEFAULT') return;
  const record = (state.project.term_scenarios ??= {})[state.project.incoterm] ??= {};
  const overrides = record.responsibility_overrides ??= {};
  if (field === 'responsibility' && value === 'DEFAULT') { delete overrides[costId]; return; }
  if (field === 'responsibility' && (value === 'SELLER' || value === 'BUYER')) {
    overrides[costId] = { ...overrides[costId], responsibility: value };
  } else if (field === 'reason' && overrides[costId]) overrides[costId]!.reason = value.trim();
  invalidateEvidence(overrides[costId]?.evidence);
}

function addPresetItem(presetKey: string): void {
  const preset = COST_PRESETS.find((candidate) => candidate.key === presetKey);
  if (preset === undefined) return;
  const costId = nextCostId(state.project, preset.key);
  const isGoods = preset.cost_category === 'GOODS_AND_PACKING';
  const currency = isGoods ? state.project.quote.currency : state.project.base_currency;
  state.project.items.push(
    presetToCostItem(preset, {
      cost_id: costId,
      currency,
      base_currency: state.project.base_currency,
      fx_type: currency === state.project.base_currency ? 'MARKET' : 'CONTRACT',
      ...(preset.pricing_method === 'FIXED' || preset.pricing_method === 'ACTUAL' ? { amount: '' } : {}),
      ...(preset.pricing_method === 'QTY_X_UNIT' ? { quantity: '', rate: '' } : {}),
      ...(preset.pricing_method === 'PER_DAY' ? { days: '', rate: '' } : {}),
      ...(preset.pricing_method === 'PERCENT' ? { rate: '' } : {}),
    }),
  );
  state.status = `已添加：${preset.name}`;
}

function addCustomItem(): void {
  const costId = nextCostId(state.project, 'custom');
  state.project.items.push(
    customCostItem({
      cost_id: costId,
      cost_name: '新自定义费用',
      cost_category: 'CUSTOM',
      trade_node: 'SELLER_PREMISES',
      currency: state.project.base_currency,
      base_currency: state.project.base_currency,
      pricing_method: 'ACTUAL',
      amount: '',
    }),
  );
  state.status = '已添加自定义费用：请填写名称、节点与类别';
}

/** 阶梯档位：没有任何档位时给一个可直接编辑的初始结构 */
function ensureTiers(item: CostItem): NonNullable<CostItem['tiers']> {
  if (item.tiers === undefined || item.tiers.length === 0) {
    item.tiers = [
      { up_to: '100', rate: '0' },
      { up_to: null, rate: '0' },
    ];
  }
  return item.tiers;
}

function addTier(item: CostItem): void {
  const tiers = ensureTiers(item);
  const last = tiers[tiers.length - 1];
  // 只能有一个无上界的档位：追加前先把原来的"以上"档补一个上界
  if (last !== undefined && last.up_to === null) {
    const previous = tiers[tiers.length - 2]?.up_to ?? null;
    last.up_to = previous === null ? '200' : String(Number(previous) * 2);
  }
  tiers.push({ up_to: null, rate: last?.rate ?? '0' });
}

function removeTier(item: CostItem, index: number): void {
  if (item.tiers === undefined) return;
  item.tiers.splice(index, 1);
  // 删掉无上界的那一档后，把最后一档改为无上界，避免计费量落在所有档位之外
  if (item.tiers.length > 0 && !item.tiers.some((tier) => tier.up_to === null)) {
    const last = item.tiers[item.tiers.length - 1];
    if (last !== undefined) last.up_to = null;
  }
}

function removeItem(costId: string): void {
  for (const record of Object.values(state.project.term_scenarios ?? {})) {
    if (record.responsibility_overrides) delete record.responsibility_overrides[costId];
  }
  state.project.items = state.project.items.filter((item) => item.cost_id !== costId);
  state.project.items.forEach((item) => {
    if (item.contained_in_cost_id === costId) item.contained_in_cost_id = undefined;
  });
}

function addFxRow(): void {
  state.fxRows.push({
    row_id: `fx-row-${Date.now()}`,
    type: 'MARKET',
    date: new Date().toISOString().slice(0, 10),
    from: state.project.quote.currency,
    to: state.project.base_currency,
    rate: '',
  });
}

function addHsEntry(): void {
  ensureHsTable(state.project).entries.push({
    code: '',
    description: '新编码',
    duty_type: 'AD_VALOREM',
    duty_rates: {},
  });
}

function downloadText(fileName: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** 去掉在 Windows 上非法的文件名字符，避免建议文件名被浏览器截断 */
function safeFileName(name: string, extension = 'json'): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '-').trim();
  return `${cleaned === '' ? 'trade-cost' : cleaned}.${extension}`;
}

interface SaveFilePickerWindow extends Window {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{
    name: string;
    createWritable: () => Promise<{ write: (data: string | Blob) => Promise<void>; close: () => Promise<void> }>;
  }>;
}

async function saveProject(): Promise<void> {
  const project = touchProject(currentProject());
  const text = serializeProject(project);
  const suggested = safeFileName(project.name);
  const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (picker !== undefined) {
    try {
      const handle = await picker.call(window, {
        suggestedName: suggested,
        types: [{ description: '项目文件', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      state.fileName = handle.name;
      state.savedAt = new Date().toLocaleTimeString();
      state.dirty = false;
      state.status = `已保存到 ${handle.name}`;
      state.statusLevel = 'info';
      render();
      return;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        state.status = '已取消保存，当前改动尚未写入项目文件';
        state.statusLevel = 'warn';
      } else {
        state.status = `保存失败，当前改动尚未写入项目文件：${String(error)}`;
        state.statusLevel = 'error';
      }
      render();
      return;
    }
  }
  try {
    downloadText(suggested, text);
  } catch (error) {
    state.status = `下载项目文件失败：${String(error)}`;
    state.statusLevel = 'error';
    render();
    return;
  }
  state.savedAt = new Date().toLocaleTimeString();
  state.dirty = false;
  state.status = '当前浏览器不支持直接写盘，已改为下载项目文件';
  state.statusLevel = 'info';
  render();
}

async function exportReport(): Promise<void> {
  try {
    const project = currentProject();
    const html = createProjectReport(project, undefined, sensitivityControls.enabled ? sensitivityControls : undefined);
    const name = safeFileName(`${project.name || 'trade-cost'}-内部测算报告`, 'html');
    const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
    if (picker !== undefined) {
      const handle = await picker.call(window, { suggestedName: name, types: [{ description: '内部测算报告', accept: { 'text/html': ['.html'] } }] });
      const writable = await handle.createWritable(); await writable.write(html); await writable.close();
      state.status = `已导出报告 ${handle.name}；项目文件仍需单独保存${state.dirty ? '；有未保存改动' : ''}`;
    } else {
      downloadText(name, html, 'text/html');
      state.status = `已发起报告下载，请确认文件已保存；项目文件仍需单独保存${state.dirty ? '；有未保存改动' : ''}`;
    }
    state.statusLevel = 'warn';
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      state.status = '已取消报告导出，项目保存状态未改变'; state.statusLevel = 'warn';
    } else {
      state.status = `报告导出失败：${isEngineError(error) ? error.message : String(error)}`; state.statusLevel = 'error';
    }
  }
  // 报告导出不是项目保存，不更改dirty、fileName、savedAt或草稿。
  render();
}

async function exportWorkbook(customer: boolean): Promise<void> {
  const label = customer ? '客户报价 Excel 草稿' : '内部成本 Excel';
  try {
    if (customer && !customerReviewed) throw new Error('请先检查客户预览中的公开内容');
    const project = currentProject();
    const quote = customer ? projectCustomerQuote(project, customerFields) : null;
    const bytes = quote ? createCustomerWorkbook(quote) : createInternalWorkbook(project, undefined, sensitivityControls.enabled ? sensitivityControls : undefined);
    const name = quote ? customerQuoteFileName(quote).replace(/\.html$/, '.xlsx') : safeFileName(`${project.name || 'trade-cost'}-内部成本`, 'xlsx');
    const blob = new Blob([bytes], { type: XLSX_MIME });
    const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
    if (picker !== undefined) {
      const handle = await picker.call(window, { suggestedName: name, types: [{ description: label, accept: { [XLSX_MIME]: ['.xlsx'] } }] });
      const writable = await handle.createWritable(); await writable.write(blob); await writable.close();
      state.status = `已导出${label} ${handle.name}；项目文件仍需单独保存${state.dirty ? '；有未保存改动' : ''}`;
    } else {
      const url = URL.createObjectURL(blob);
      try { const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); }
      finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
      state.status = `已发起${label}下载，请确认文件已保存；项目保存状态未改变`;
    }
    state.statusLevel = 'warn';
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      state.status = `已取消${label}导出，项目保存状态未改变`; state.statusLevel = 'warn';
    } else {
      state.status = `${label}导出失败：${isEngineError(error) ? error.message : String(error)}`; state.statusLevel = 'error';
    }
  }
  render();
}

async function exportCustomerPdf(): Promise<void> {
  if (customerPdfBusy) return;
  try {
    if (!customerReviewed) throw new Error('请先检查客户预览中的公开内容');
    const quote = projectCustomerQuote(currentProject(), customerFields);
    const generatedAt = new Date().toISOString();
    const name = customerQuoteFileName(quote).replace(/\.html$/, '.pdf').replace(/[\u0000-\u001F]/g, '-');
    customerPdfBusy = true; render();
    // Open the picker while the click still has user activation; generation starts only after selection.
    const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
    const handle = picker === undefined ? null : await picker.call(window, { suggestedName: name, types: [{ description: '客户报价 PDF 草稿', accept: { 'application/pdf': ['.pdf'] } }] });
    const { createCustomerPdf } = await import('./customer-pdf.js');
    const bytes = await createCustomerPdf(quote, generatedAt);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    if (handle) {
      const writable = await handle.createWritable(); await writable.write(blob); await writable.close();
      state.status = `已导出客户报价 PDF 草稿 ${handle.name}；项目文件仍需单独保存${state.dirty ? '；有未保存改动' : ''}`;
    } else {
      const url = URL.createObjectURL(blob);
      try { const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); }
      finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
      state.status = '已发起客户报价 PDF 草稿下载，请确认文件已保存；项目保存状态未改变';
    }
    state.statusLevel = 'warn';
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') { state.status = '已取消客户报价 PDF 导出，项目保存状态未改变'; state.statusLevel = 'warn'; }
    else { state.status = `客户报价 PDF 导出失败：${error instanceof Error ? error.message : '文件未写入'}`; state.statusLevel = 'error'; }
  } finally { customerPdfBusy = false; render(); }
}

async function exportCustomerQuote(): Promise<void> {
  try {
    if (!customerReviewed) throw new Error('请先检查客户预览中的公开内容');
    const quote = projectCustomerQuote(currentProject(), customerFields);
    const html = createCustomerQuoteDocument(quote);
    const name = customerQuoteFileName(quote);
    const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
    if (picker !== undefined) {
      const handle = await picker.call(window, { suggestedName: name, types: [{ description: '客户报价说明草稿', accept: { 'text/html': ['.html'] } }] });
      const writable = await handle.createWritable(); await writable.write(html); await writable.close();
      state.status = `已导出客户报价草稿 ${handle.name}；项目文件仍需单独保存${state.dirty ? '；有未保存改动' : ''}`;
    } else {
      downloadText(name, html, 'text/html');
      state.status = '已发起客户报价草稿下载，请确认文件已保存；项目保存状态未改变';
    }
    state.statusLevel = 'warn';
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') { state.status = '已取消客户报价导出，项目保存状态未改变'; state.statusLevel = 'warn'; }
    else { state.status = `客户报价导出失败：${error instanceof Error ? error.message : '文件未写入'}`; state.statusLevel = 'error'; }
  }
  render();
}

function showFileError(error: unknown): void {
  state.status = isEngineError(error) ? `[${error.code}] ${error.message}` : `打开失败：${String(error)}`;
  state.statusLevel = 'error';
  render();
}

function openProjectFromText(text: string, fileName: string): void {
  try {
    const project = parseProject(text);
    // 所有可能失败的准备步骤完成后，才替换当前编辑内容。
    const fxRows = booksToRows(project.fx_books);
    state.project = project;
    sensitivityControls = newSensitivityControls();
    customerFields = emptyCustomerQuoteFields();
    customerReviewed = false;
    state.fxRows = fxRows;
    state.fileName = fileName;
    state.savedAt = null;
    state.dirty = false;
  } catch (error) {
    showFileError(error);
    return;
  }
  recompute();
  render();
}

function newProject(mode: 'sample' | 'china-sample' | 'china-blank' = 'sample'): void {
  sensitivityControls = newSensitivityControls();
  customerFields = emptyCustomerQuoteFields();
  customerReviewed = false;
  state.project = mode === 'china-blank' ? newChinaImportProjectFile() : mode === 'china-sample' ? chinaImportSampleProjectFile() : sampleProjectFile();
  state.fxRows = booksToRows(state.project.fx_books);
  state.fileName = null;
  state.savedAt = null;
  state.dirty = true;
  state.status = mode === 'china-blank' ? '已新建空白中国进口交易，请按录入提示填写' : '已载入示例数据';
  state.statusLevel = 'info';
  recompute();
  render();
}

// ---------- 渲染 ----------

function saveStateText(): { text: string; className: string } {
  if (state.statusLevel === 'error') return { text: state.status, className: 'save-state error' };
  if (state.statusLevel === 'warn') return { text: state.status, className: 'save-state dirty' };
  const target = state.fileName ?? '尚未保存为文件';
  const when = state.savedAt !== null ? ` · 上次保存 ${state.savedAt}` : '';
  const dirtyMark = state.dirty ? ' · 有未保存改动' : '';
  if (draftStorageUnavailable) {
    return { text: `${target}${dirtyMark} · 自动草稿保存失败，请保存项目文件`, className: 'save-state dirty' };
  }
  return {
    text: `${target}${when}${dirtyMark}`,
    className: `save-state${state.dirty ? ' dirty' : ''}`,
  };
}

function render(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (app === null) return;
  const focused = focusKeyOf(document.activeElement ?? document.body);
  const saveState = saveStateText();

  app.innerHTML = `
    <header class="app-bar">
      <div class="brand">国际贸易成本与贸易术语分析<span class="sub">本地运行 · 数据不出本机</span></div>
      <div class="file-actions">
        <button data-action="new">载入示例</button>
        <button data-action="new-china-import">中国进口示例</button>
        <button data-action="new-china-blank">新建中国进口</button>
        <button data-action="open">打开项目</button>
        <button class="primary" data-action="save">保存项目</button>
        <button data-action="export-report"${state.result === null || state.comparison === null ? ' disabled' : ''}>导出内部测算报告</button>
        <button data-action="export-internal-xlsx"${state.comparison === null ? ' disabled' : ''}>导出内部成本 Excel</button>
        <button data-action="preview-customer-quote">客户报价预览</button>
        <input type="file" id="file-input" accept=".json,application/json" style="display:none" />
      </div>
      <span class="spacer"></span>
      ${renderKpis({ result: state.result, comparison: state.comparison, error: state.error })}
      <span class="${saveState.className}" role="status" aria-live="polite">${escapeHtml(saveState.text)}</span>
    </header>
    <main class="layout">
      <aside class="responsibility-notice" aria-label="责任声明">本工具仅供学习与内部测算参考，不构成法律或专业贸易建议。实际合同请以 Incoterms® 官方文本及当地法规为准。</aside>
      <details class="panel" data-evidence-section="project-introduction">
        <summary><span class="panel-title">项目说明 · 适用范围与使用方法</span></summary>
        <div class="panel-body">
          <p>面向外贸业务人员的本地成本测算工具，当前重点是中国一般贸易进口、单商品一票。录入货物净价与费用，记录税率、汇率及业务条件，再比较贸易术语下的买方支付和费用承担。</p>
          <p>项目以标准 JSON 保存，带版本号；计算、项目文件与内部 HTML 报告均在本机处理。请先打开“中国进口示例”理解口径，再用“新建中国进口”录入自己的数据。</p>
          <p>结果中的费用依据可展开查看归属规则、候选条件与汇总去重；计算过程保留真实操作数、税款舍入和免征前后值。四张费用与税基图使用本次测算，内部报告同步保留解释。</p>
          <p>来源未核对、条件未确认和未知卖方成本会明确提示。现有模型及测试不能替代专业复核和真实单据验收；多商品、其他国家专用税制、资金成本及可下载 Excel/PDF 仍属后续范围。</p>
          <p>工程采用严格 TypeScript、decimal.js、Vite 与 Vitest，分开维护领域类型、规则与计算、文件校验和界面。<a href="project-introduction.html">完整项目介绍</a>介绍设计取舍及验证证据；该独立页面与工具放在同一目录时可打开，本说明无需额外文件。</p>
          <details><summary>PDF 字体许可与来源</summary><pre class="font-license">${escapeHtml(fontProvenance)}\n${escapeHtml(fontLicense)}</pre></details>
        </div>
      </details>
      ${renderFormsRow(state.project)}
      ${renderImportTaxPanel(state.project)}
      ${renderFxPanel(state.fxRows)}
      ${renderHsPanel(state.project)}
      ${renderItemsPanel(state.project, enrichmentMap())}
      ${renderOutputColumn({ result: state.result, comparison: state.comparison, error: state.error })}
      ${renderSensitivityPanel(currentProject(), state.result, sensitivityControls, sensitivityAnalysis, sensitivityError)}
      ${renderCustomerQuotePanel(currentProject(), customerFields, customerReviewed, customerPreview, customerError, customerPdfBusy)}
      <footer class="app-footer">
        <span>费用 ${state.project.items.length} 项 · 11 术语对比 · 核算币种 ${escapeHtml(state.project.base_currency)}</span>
        <span>数据保存在本机，不上传任何服务器</span>
        <span>计算逻辑、规则表与校验清单见 docs/design.md</span>
      </footer>
    </main>
  `;

  document.querySelectorAll<HTMLDetailsElement>('details.panel').forEach((element) => {
    const key = element.dataset.section;
    if (key !== undefined && collapsedSections.has(key)) element.open = false;
  });
  document.querySelectorAll<HTMLDetailsElement>('details[data-evidence-section]').forEach((element) => {
    if (element.dataset.evidenceSection !== undefined && expandedEvidenceSections.has(element.dataset.evidenceSection)) element.open = true;
  });
  restoreFocus(focused);
}

function commit(): void {
  customerReviewed = false;
  state.dirty = true;
  recompute();
  render();
}

/**
 * 补全"已含于"下拉的候选列表。
 *
 * 费用项可能有几百笔，若在渲染时为每一笔都列出其余全部费用项，
 * 就变成 O(n²) 个 option（300 笔约 9 万个），界面会卡到无法使用。
 * 因此渲染时只放当前值，用户真正要选的时候才把候选填进去。
 */
function populateContainedIn(select: HTMLSelectElement, costId: string): void {
  if (select.dataset.populated === '1') return;
  const current = select.value;
  const fragment = document.createDocumentFragment();
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '未含于他项';
  fragment.append(none);
  for (const candidate of state.project.items) {
    if (candidate.cost_id === costId) continue;
    const option = document.createElement('option');
    option.value = candidate.cost_id;
    option.textContent = candidate.cost_name;
    fragment.append(option);
  }
  select.replaceChildren(fragment);
  select.value = current;
  select.dataset.populated = '1';
}

function bind(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (app === null) return;

  app.addEventListener('focusin', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.dataset.lazyOptions !== 'contained-in') return;
    const costId = target.dataset.item;
    if (costId !== undefined) populateContainedIn(target, costId);
  });

  // details 的 toggle 不冒泡，用捕获阶段监听
  app.addEventListener(
    'toggle',
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLDetailsElement)) return;
      const evidenceSection = target.dataset.evidenceSection;
      if (evidenceSection !== undefined) {
        if (target.open) expandedEvidenceSections.add(evidenceSection);
        else expandedEvidenceSections.delete(evidenceSection);
        return;
      }
      const key = target.dataset.section;
      if (key === undefined) return;
      if (target.open) collapsedSections.delete(key);
      else collapsedSections.add(key);
    },
    true,
  );

  app.addEventListener('change', (event) => {
    const target = event.target;

    if (target instanceof HTMLInputElement && target.id === 'file-input') {
      const file = target.files?.[0];
      if (file === undefined) return;
      void file.text().then((text) => openProjectFromText(text, file.name)).catch(showFileError);
      return;
    }

    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;

    if (target.dataset.customerField !== undefined) {
      const field = target.dataset.customerField;
      if (field === 'reviewed') customerReviewed = target instanceof HTMLInputElement && target.checked && customerPreview !== null;
      else if (CUSTOMER_QUOTE_FIELDS.some(key => key === field)) {
        customerFields[field as keyof typeof customerFields] = target.value;
        customerReviewed = false;
        recomputeCustomerPreview();
      }
      render();
      return;
    }

    // 客户公开文字使用textarea；其余既有录入仍只接受input/select。
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;

    if (target.dataset.sensitivityField !== undefined) {
      const field = target.dataset.sensitivityField;
      if (field === 'enabled') sensitivityControls.enabled = target instanceof HTMLInputElement && target.checked;
      else if (field === 'kind' && ['FREIGHT', 'FX', 'RESPONSIBILITY'].includes(target.value)) {
        sensitivityControls.kind = target.value as typeof sensitivityControls.kind;
        sensitivityControls.target = sensitivityOptions(currentProject(), state.result, sensitivityControls.kind)[0]?.value ?? '';
      } else if (field === 'target' || field === 'from' || field === 'to' || field === 'step') sensitivityControls[field] = target.value;
      recomputeSensitivity();
      render();
      return;
    }

    if (target.dataset.evidenceOwner !== undefined && target.dataset.evidenceField !== undefined) {
      onEvidenceField(target.dataset.evidenceOwner, target.dataset.evidenceId ?? '', target.dataset.evidenceField, target.value);
      commit();
      return;
    }
    if (target.dataset.contractCost !== undefined && target.dataset.contractField !== undefined) {
      onContractField(target.dataset.contractCost, target.dataset.contractField, target.value);
      commit();
      return;
    }
    if (target.dataset.logisticsKind !== undefined && target.dataset.logisticsField !== undefined) {
      onLogisticsField(target.dataset.logisticsKind, target.dataset.logisticsField, target);
      commit();
      return;
    }

    if (target.dataset.action === 'add-preset') {
      if (target.value !== '') addPresetItem(target.value);
      commit();
      return;
    }

    const path = target.dataset.path;
    const itemId = target.dataset.item;
    const itemField = target.dataset.itemField;
    const fxId = target.dataset.fx;
    const fxField = target.dataset.fxField;
    const hsIndex = target.dataset.hs;
    const hsField = target.dataset.hsField;

    if (path !== undefined) onProjectField(path, target);
    else if (itemId !== undefined && itemField !== undefined) onItemField(itemId, itemField, target);
    else if (fxId !== undefined && fxField !== undefined) onFxField(fxId, fxField, target);
    else if (hsIndex !== undefined && hsField !== undefined) onHsField(Number(hsIndex), hsField, target);
    else return;
    commit();
  });

  app.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;
    if (action === undefined) return;
    switch (action) {
      case 'preview-customer-quote':
        expandedEvidenceSections.add('customer-quote'); render();
        document.querySelector('[data-evidence-section="customer-quote"]')?.scrollIntoView({ block: 'start' });
        break;
      case 'export-customer-quote': void exportCustomerQuote(); break;
      case 'export-customer-xlsx': void exportWorkbook(true); break;
      case 'export-customer-pdf': void exportCustomerPdf(); break;
      case 'export-internal-xlsx': void exportWorkbook(false); break;
      case 'add-transport-segment': addTransportSegment(); commit(); break;
      case 'remove-transport-segment': {
        const record = state.project.term_scenarios?.[state.project.incoterm]; const plan = record?.transport;
        const index = Number(target.dataset.segmentIndex);
        if (plan && Number.isInteger(index) && index >= 0 && index < plan.segments.length) {
          plan.segments.splice(index, 1); invalidateEvidence(plan.evidence); invalidateEvidence(record?.insurance?.evidence);
        }
        commit(); break;
      }
      case 'clear-transport-plan': {
        const record = state.project.term_scenarios?.[state.project.incoterm];
        if (record) { delete record.transport; invalidateEvidence(record.insurance?.evidence); }
        commit(); break;
      }
      case 'create-insurance-plan': {
        const record = (state.project.term_scenarios ??= {})[state.project.incoterm] ??= {};
        record.insurance ??= emptyInsurancePlan((record.quote ?? state.project.quote).currency);
        commit(); break;
      }
      case 'clear-insurance-plan': {
        const record = state.project.term_scenarios?.[state.project.incoterm]; if (record) delete record.insurance;
        commit(); break;
      }
      case 'add-container-preset': {
        const before = state.project.items.length;
        addPresetItem(target.dataset.preset ?? '');
        if (state.project.items.length > before) state.project.items[state.project.items.length - 1]!.applicable_incoterms = [state.project.incoterm];
        commit(); break;
      }
      case 'remove-contract-override': {
        if (target.dataset.contractCost) onContractField(target.dataset.contractCost, 'responsibility', 'DEFAULT');
        commit();
        break;
      }
      case 'clear-contract-quote': {
        const record = state.project.term_scenarios?.[state.project.incoterm];
        if (record) { delete record.quote; delete record.quote_evidence; }
        commit();
        break;
      }
      case 'add-custom':
        addCustomItem();
        commit();
        break;
      case 'remove-item': {
        const costId = target.dataset.item;
        if (costId !== undefined) removeItem(costId);
        commit();
        break;
      }
      case 'add-tier': {
        const costId = target.dataset.item;
        const item = costId === undefined ? undefined : state.project.items.find((c) => c.cost_id === costId);
        if (item !== undefined) addTier(item);
        commit();
        break;
      }
      case 'remove-tier': {
        const costId = target.dataset.item;
        const index = Number(target.dataset.tierIndex ?? '-1');
        const item = costId === undefined ? undefined : state.project.items.find((c) => c.cost_id === costId);
        if (item !== undefined && index >= 0) removeTier(item, index);
        commit();
        break;
      }
      case 'add-fx':
        addFxRow();
        commit();
        break;
      case 'remove-fx': {
        const rowId = target.dataset.fx;
        if (rowId !== undefined) state.fxRows = state.fxRows.filter((row) => row.row_id !== rowId);
        commit();
        break;
      }
      case 'add-hs':
        addHsEntry();
        commit();
        break;
      case 'remove-hs': {
        const index = Number(target.dataset.hs ?? '-1');
        const table = ensureHsTable(state.project);
        if (index >= 0) table.entries.splice(index, 1);
        commit();
        break;
      }
      case 'save':
        void saveProject();
        break;
      case 'export-report':
        void exportReport();
        break;
      case 'open':
        document.querySelector<HTMLInputElement>('#file-input')?.click();
        break;
      case 'new':
        newProject();
        break;
      case 'new-china-import':
        newProject('china-sample');
        break;
      case 'new-china-blank':
        newProject('china-blank');
        break;
      default:
        break;
    }
  });
}

export function start(): void {
  bind();
  recompute(draftFailure === null);
  if (draftFailure !== null) {
    state.status = draftFailure;
    state.statusLevel = 'warn';
  } else if (restoredFromDraft) {
    state.status = `已恢复草稿 · ${state.status}`;
  }
  render();
}
