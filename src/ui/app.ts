import { COST_PRESETS, customCostItem, presetToCostItem } from '../data/cost-presets.js';
import {
  parseProject,
  serializeProject,
  toScenario,
  toTrade,
  touchProject,
  type ProjectFile,
} from '../data/project-file.js';
import { sampleProjectFile } from '../data/sample-project.js';
import type { BaseRef, CostItem } from '../domain/cost-item.js';
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
import { analyze, type AnalysisResult } from '../engine/analyze.js';
import { compare, scenarioWithDerivedInclusions, type Comparison } from '../engine/compare.js';
import { isEngineError } from '../engine/errors.js';
import { booksToRows, rowsToBooks, type FxRow } from './fx-rows.js';
import { escapeHtml } from './format.js';
import { nextCostId, renderFormsRow, renderFxPanel, renderHsPanel, renderItemsPanel, type ItemEnrichment } from './views-input.js';
import { renderKpis, renderOutputColumn } from './views-output.js';

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
    return { payload: { project: parseProject(JSON.stringify(parsed.project)), fxRows: parsed.fxRows }, failure: null };
  } catch (error) {
    const detail = isEngineError(error) ? `（${error.code}）` : '';
    return { payload: null, failure: `上次的草稿无法读取${detail}，已改为载入示例数据；如果你之前没保存成项目文件，那份编辑内容已经丢失` };
  }
}

function saveDraft(project: ProjectFile, fxRows: readonly FxRow[]): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ project, fxRows }));
  } catch {
    // 浏览器存储不可用时静默跳过：项目文件才是权威数据源
  }
}

/** 启动时是否从草稿恢复，必须在 initialState() 之前声明 */
let restoredFromDraft = false;
/** 草稿读取失败的说明，启动时展示 */
let draftFailure: string | null = null;

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

function currentProject(): ProjectFile {
  return { ...state.project, fx_books: rowsToBooks(state.fxRows) };
}

function recompute(): void {
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
    state.status = '输入不足以完成计算';
    state.statusLevel = 'error';
  }
  saveDraft(state.project, state.fxRows);
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
  if (dataset.path !== undefined) return `path:${dataset.path}`;
  if (dataset.item !== undefined && dataset.itemField !== undefined) {
    return `item:${dataset.item}:${dataset.itemField}`;
  }
  if (dataset.fx !== undefined && dataset.fxField !== undefined) {
    return `fx:${dataset.fx}:${dataset.fxField}`;
  }
  return null;
}

function restoreFocus(key: string | null): void {
  if (key === null) return;
  const element = Array.from(document.querySelectorAll<HTMLElement>('[data-path],[data-item],[data-fx]')).find(
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
  if (path === 'anchor.kind') {
    const kind = target.value as ComparisonAnchor['kind'];
    const fallbackTotal = state.result?.buyer.landed_cost_with_tax.toFixed(2) ?? '900000.00';
    state.project.anchor =
      kind === 'FIXED_MARKET_PRICE'
        ? { kind, buyer_total: fallbackTotal, currency: state.project.base_currency }
        : kind === 'FIXED_MARGIN_RATE'
          ? { kind, margin_rate: '0.2' }
          : { kind: 'FIXED_QUOTE' };
    return;
  }
  setPath(path, target.value);
}

function onItemField(costId: string, field: string, target: HTMLInputElement | HTMLSelectElement): void {
  const item = state.project.items.find((candidate) => candidate.cost_id === costId);
  if (item === undefined) return;
  const value = target.value;
  const isCheckbox = target instanceof HTMLInputElement && target.type === 'checkbox';
  switch (field) {
    case 'cost_name':
      item.cost_name = value;
      break;
    case 'trade_node':
      item.trade_node = value as TradeNode;
      break;
    case 'cost_category':
      item.cost_category = value as CostCategory;
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

function onFxField(rowId: string, field: string, target: HTMLInputElement | HTMLSelectElement): void {  const row = state.fxRows.find((candidate) => candidate.row_id === rowId);
  if (row === undefined) return;
  const value = target.value;
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

// ---------- 动作 ----------

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
      ...(preset.pricing_method === 'FIXED' || preset.pricing_method === 'ACTUAL' ? { amount: '0' } : {}),
      ...(preset.pricing_method === 'QTY_X_UNIT' ? { quantity: '1', rate: '0' } : {}),
      ...(preset.pricing_method === 'PER_DAY' ? { days: '1', rate: '0' } : {}),
      ...(preset.pricing_method === 'PERCENT' ? { rate: '0' } : {}),
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
      amount: '0',
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

function downloadText(fileName: string, text: string): void {  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** 去掉在 Windows 上非法的文件名字符，避免建议文件名被浏览器截断 */
function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '-').trim();
  return `${cleaned === '' ? 'trade-cost' : cleaned}.json`;
}

interface SaveFilePickerWindow extends Window {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{
    name: string;
    createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
  }>;
}

async function saveProject(): Promise<void> {
  const project = touchProject(currentProject());
  const text = serializeProject(project);
  const suggested = safeFileName(project.name);
  const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (picker !== undefined) {
    try {
      const handle = await picker({
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
    } catch {
      // 用户取消或浏览器拒绝，退回下载
    }
  }
  downloadText(suggested, text);
  state.savedAt = new Date().toLocaleTimeString();
  state.dirty = false;
  state.status = '当前浏览器不支持直接写盘，已改为下载项目文件';
  state.statusLevel = 'info';
  render();
}

function openProjectFromText(text: string, fileName: string): void {
  try {
    const project = parseProject(text);
    state.project = project;
    state.fxRows = booksToRows(project.fx_books);
    state.fileName = fileName;
    state.dirty = false;
    state.status = `已打开 ${fileName}`;
    state.statusLevel = 'info';
  } catch (error) {
    state.status = isEngineError(error) ? `[${error.code}] ${error.message}` : `打开失败：${String(error)}`;
    state.statusLevel = 'error';
  }
  recompute();
  render();
}

function newProject(): void {
  state.project = sampleProjectFile();
  state.fxRows = booksToRows(state.project.fx_books);
  state.fileName = null;
  state.dirty = true;
  state.status = '已载入示例数据';
  state.statusLevel = 'info';
  recompute();
  render();
}

// ---------- 渲染 ----------

function saveStateText(): { text: string; className: string } {
  if (state.statusLevel === 'error') return { text: state.status, className: 'save-state error' };
  const target = state.fileName ?? '尚未保存为文件';
  const when = state.savedAt !== null ? ` · 上次保存 ${state.savedAt}` : '';
  const dirtyMark = state.dirty ? ' · 有未保存改动' : '';
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
        <button data-action="open">打开项目</button>
        <button class="primary" data-action="save">保存项目</button>
        <input type="file" id="file-input" accept=".json,application/json" style="display:none" />
      </div>
      <span class="spacer"></span>
      ${renderKpis({ result: state.result, comparison: state.comparison, error: state.error })}
      <span class="${saveState.className}">${saveState.text}</span>
    </header>
    <main class="layout">
      ${renderFormsRow(state.project)}
      ${renderFxPanel(state.fxRows)}
      ${renderHsPanel(state.project)}
      ${renderItemsPanel(state.project, enrichmentMap())}
      ${renderOutputColumn({ result: state.result, comparison: state.comparison, error: state.error })}
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
  restoreFocus(focused);
}

function commit(): void {
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
      void file.text().then((text) => openProjectFromText(text, file.name));
      return;
    }

    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;

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
      case 'open':
        document.querySelector<HTMLInputElement>('#file-input')?.click();
        break;
      case 'new':
        newProject();
        break;
      default:
        break;
    }
  });
}

export function start(): void {
  bind();
  recompute();
  if (draftFailure !== null) {
    state.status = draftFailure;
    state.statusLevel = 'warn';
  } else if (restoredFromDraft) {
    state.status = `已恢复草稿 · ${state.status}`;
  }
  render();
}
