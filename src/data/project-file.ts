import type { CostItem } from '../domain/cost-item.js';
import type { CarriageMode, CurrencyCode, DateStr, FxType, Incoterm } from '../domain/enums.js';
import type { FxBook } from '../domain/fx.js';
import type { Goods } from '../domain/goods.js';
import type { ScenarioFacts } from '../domain/rule.js';
import type { ComparisonAnchor, Scenario } from '../domain/scenario.js';
import type { TaxProfile } from '../domain/tax-profile.js';
import type { Trade } from '../domain/trade.js';
import type { TradeRoute } from '../domain/import-context.js';
import { EngineError } from '../engine/errors.js';
import { validateProjectStructure } from './project-validation.js';

export const SCHEMA_VERSION = '0.5';

export interface QuoteTemplate {
  amount: string;
  currency: CurrencyCode;
  fx_type: FxType;
  fx_date?: DateStr;
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

export function toScenario(project: ProjectFile): Scenario {
  return {
    id: 'scenario-1',
    name: `${project.incoterm} 方案`,
    trade_id: 'trade-1',
    incoterm: project.incoterm,
    base_currency: project.base_currency,
    quote: {
      amount: project.quote.amount,
      currency: project.quote.currency,
      incoterm: project.incoterm,
      included_cost_ids: [],
      fx_type: project.quote.fx_type,
      ...(project.quote.fx_date !== undefined ? { fx_date: project.quote.fx_date } : {}),
    },
    ...(project.facts !== undefined ? { facts: project.facts } : {}),
  };
}

export function serializeProject(project: ProjectFile): string {
  // 新语义必须用新版本落盘，旧程序应明确拒绝，而非忽略中国模式继续错算。
  return `${JSON.stringify({ ...project, schema_version: SCHEMA_VERSION }, null, 2)}\n`;
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
  if (![SCHEMA_VERSION, '0.1', '0.2', '0.3', '0.4'].includes(version)) {
    throw new EngineError(
      'PROJECT_VERSION_UNSUPPORTED',
      `项目文件版本为 ${version}，当前程序支持 0.1、0.2、0.3、0.4 及 ${SCHEMA_VERSION}，请先迁移`,
      { version, supported: SCHEMA_VERSION },
    );
  }

  validateProjectStructure(raw);
  // 旧项目只升级容器版本，不自动开启中国进口计算语义。
  raw.schema_version = SCHEMA_VERSION;
  return raw as unknown as ProjectFile;
}

export function touchProject(project: ProjectFile): ProjectFile {
  project.updated_at = new Date().toISOString();
  return project;
}
