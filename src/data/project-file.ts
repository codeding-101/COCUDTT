import type { CostItem } from '../domain/cost-item.js';
import { INCOTERMS, type CarriageMode, type CurrencyCode, type DateStr, type FxType, type Incoterm } from '../domain/enums.js';
import type { FxBook } from '../domain/fx.js';
import type { Goods } from '../domain/goods.js';
import type { ScenarioFacts } from '../domain/rule.js';
import type { ComparisonAnchor, ResponsibilityOverride, Scenario } from '../domain/scenario.js';
import type { SourceEvidence } from '../domain/source-evidence.js';
import type { TaxProfile } from '../domain/tax-profile.js';
import type { Trade } from '../domain/trade.js';
import type { TradeRoute } from '../domain/import-context.js';
import type { InsurancePlan, TransportPlan } from '../domain/logistics.js';
import { EngineError } from '../engine/errors.js';
import { validateProjectStructure } from './project-validation.js';
import { SCHEMA_VERSION, SUPPORTED_PROJECT_VERSIONS } from './project-versions.js';
import type {TransportCostLinkInput} from '../domain/transport-cost-links.js';

export { SCHEMA_VERSION } from './project-versions.js';

export interface QuoteTemplate {
  amount: string;
  currency: CurrencyCode;
  fx_type: FxType;
  fx_date?: DateStr;
  named_place?: string;
}

export interface TermScenario {
  /** Interpreted in 0.9 only; old same-name extensions remain inert. */
  transport_cost_links?:TransportCostLinkInput;
  transport?: TransportPlan;
  insurance?: InsurancePlan;
  quote?: QuoteTemplate;
  quote_evidence?: SourceEvidence;
  responsibility_overrides?: Record<string, ResponsibilityOverride>;
}

/**
 * 项目文件。一个文件装下全部输入，可归档、可邮件发送、可纳入版本管理。
 * 无服务器、无登录，因此项目文件是数据的**唯一权威来源**（设计文档 12.2）。
 */
export interface ProjectFile {
  schema_version: string;
  name: string;
  updated_at: string;
  base_currency: CurrencyCode;
  carriage_mode: CarriageMode;
  export_date?: DateStr;
  route?: TradeRoute;
  goods: Goods;
  items: CostItem[];
  fx_books: FxBook[];
  tax_profile: TaxProfile;
  quote: QuoteTemplate;
  /** 单方案结果与对比所用的贸易术语 */
  incoterm: Incoterm;
  anchor: ComparisonAnchor;
  facts?: ScenarioFacts;
  evaluation_date?: DateStr;
  term_scenarios?: Partial<Record<Incoterm, TermScenario>>;
}

export function toTrade(project: ProjectFile): Trade {
  return {
    id: 'trade-1',
    name: project.name,
    ...(project.route !== undefined ? { route: project.route } : {}),
    goods: project.goods,
    carriage_mode: project.carriage_mode,
    items: project.items,
    base_currency: project.base_currency,
    ...(project.export_date !== undefined ? { export_date: project.export_date } : {}),
  };
}

export function toScenario(project: ProjectFile, term: Incoterm = project.incoterm): Scenario {
  const actual = project.anchor.kind === 'ACTUAL_QUOTES';
  const record = project.term_scenarios?.[term];
  // 未录入的实际报价保持缺失，绝不回退到公共模拟报价。
  const quote = actual ? record?.quote ?? { amount: '', currency: project.base_currency, fx_type: 'CONTRACT' } : project.quote;
  const scenario:Scenario = {
    id: 'scenario-1',
    name: `${term} 方案`,
    trade_id: 'trade-1',
    incoterm: term,
    base_currency: project.base_currency,
    quote: {
      amount: quote.amount,
      currency: quote.currency,
      incoterm: term,
      included_cost_ids: [],
      fx_type: quote.fx_type,
      ...(quote.fx_date !== undefined ? { fx_date: quote.fx_date } : {}),
      ...(quote.named_place !== undefined ? { named_place: quote.named_place } : {}),
      ...(actual && record?.quote_evidence ? { evidence: record.quote_evidence } : {}),
    },
    ...(project.facts !== undefined ? { facts: project.facts } : {}),
    ...(record?.transport ? { transport: record.transport } : {}),
    ...(record?.insurance ? { insurance: record.insurance } : {}),
    ...((record?.insurance || record?.transport) && record.quote ? { logistics_quote: { ...record.quote, incoterm: term, included_cost_ids: [] } } : {}),
    ...(record?.responsibility_overrides ? { responsibility_overrides: record.responsibility_overrides } : {}),
    ...(actual || record?.responsibility_overrides || record?.transport || record?.insurance ? { contract_review: { require_quote: actual,
      ...(project.evaluation_date !== undefined ? { evaluation_date: project.evaluation_date } : {}) } } : {}),
  };
  if(project.schema_version==='0.9'&&record?.transport_cost_links){scenario.transport_cost_link_basis={...scenario};scenario.transport_cost_links=record.transport_cost_links;}
  return scenario;
}

export function toScenarios(project: ProjectFile): Partial<Record<Incoterm, Scenario>> {
  return Object.fromEntries(INCOTERMS.map(term => [term, toScenario(project, term)]));
}

export function serializeProject(project: ProjectFile): string {
  // 新语义必须用新版本落盘，旧程序应明确拒绝，而非忽略中国模式继续错算。
  return `${JSON.stringify({ ...project, schema_version: project.schema_version==='0.9'?'0.9':SCHEMA_VERSION }, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 解析项目文件。结构与版本不符时直接报错，不做静默修补——
 * 静默修补会让"看起来打开了"的项目悄悄丢数据。
 */
export function parseProject(text: string): ProjectFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new EngineError('PROJECT_PARSE_FAILED', '文件不是合法的 JSON，无法打开');
  }
  if (!isRecord(raw)) {
    throw new EngineError('PROJECT_PARSE_FAILED', '项目文件的顶层结构应为对象');
  }

  const version = raw.schema_version;
  if (typeof version !== 'string') {
    throw new EngineError('PROJECT_PARSE_FAILED', '项目文件缺少 schema_version，无法确认格式版本');
  }
  if (!(SUPPORTED_PROJECT_VERSIONS as readonly string[]).includes(version)) {
    throw new EngineError(
      'PROJECT_VERSION_UNSUPPORTED',
      `项目文件版本为 ${version}，当前程序支持 0.1–0.9，请先核对格式`,
      { version, supported: SCHEMA_VERSION },
    );
  }

  validateProjectStructure(raw);
  // 旧项目只升级容器版本，不自动开启中国进口计算语义。
  if(version!=='0.9')raw.schema_version = SCHEMA_VERSION;
  return raw as unknown as ProjectFile;
}

export function touchProject(project: ProjectFile): ProjectFile {
  project.updated_at = new Date().toISOString();
  return project;
}
