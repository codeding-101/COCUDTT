import { validateDraftFxRows, validateProjectStructure } from './project-validation.js';
import { SUPPORTED_PROJECT_VERSIONS } from './project-versions.js';
import { validateSettlementPlan } from '../domain/settlement-validation.js';
import { CUSTOMER_QUOTE_FIELDS } from '../domain/customer-quote.js';

export const RECOVERY_REVIEW_MAX_BYTES = 5 * 1024 * 1024;
export type RecoveryPartStatus = 'STRUCTURE_OK' | 'INVALID' | 'ABSENT' | 'MISSING' | 'UNSUPPORTED';
export interface RecoveryPartReview { key: string; label: string; status: RecoveryPartStatus }
export interface RecoveryReview { stage: 'STARTUP' | 'RENDER' | 'INTERACTION'; parts: RecoveryPartReview[]; unknownFields: number }
const keys = ['kind','version','stage','project','fx_rows','settlement_plan','sensitivity','customer_fields','browser_draft_text'];
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function projectStatus(value: unknown): RecoveryPartStatus {
  if (!record(value) || typeof value.schema_version !== 'string') return 'INVALID';
  if (!(SUPPORTED_PROJECT_VERSIONS as readonly string[]).includes(value.schema_version)) return 'UNSUPPORTED';
  validateProjectStructure(value);
  return 'STRUCTURE_OK';
}

/** Read-only structural inspection. No migration, FX conversion, calculations or raw values in the report. */
export function inspectRecoveryText(text: string): RecoveryReview {
  if (new TextEncoder().encode(text).byteLength > RECOVERY_REVIEW_MAX_BYTES) throw Error('恢复文件超过5 MiB检查上限；请保留原文件，分开人工核对');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw Error('恢复文件不是合法JSON；请保留原文件'); }
  if (!record(value) || value.kind !== 'INTERNAL_RECOVERY_SNAPSHOT') throw Error('请选择内部恢复备份；项目、付款计划和报告不属于此文件格式');
  if (value.version !== '1.0') throw Error('恢复备份版本不受支持；请保留原文件，不按1.0解释');
  if (value.stage !== 'STARTUP' && value.stage !== 'RENDER' && value.stage !== 'INTERACTION') throw Error('恢复备份缺少有效异常阶段；请保留原文件');
  const parts: RecoveryPartReview[] = [];
  const check = (key: string, label: string, validate: (raw: unknown) => RecoveryPartStatus): void => {
    let status: RecoveryPartStatus;
    if (!Object.hasOwn(value, key)) status = 'MISSING';
    else if (value[key] === null) status = 'ABSENT';
    else { try { status = validate(value[key]); } catch { status = 'INVALID'; } }
    parts.push({key,label,status});
  };
  check('project','项目容器',projectStatus);
  check('fx_rows','原始汇率编辑行',raw => { validateDraftFxRows(raw); return 'STRUCTURE_OK'; });
  check('settlement_plan','独立付款及资金计划',raw => { validateSettlementPlan(raw); return 'STRUCTURE_OK'; });
  check('sensitivity','本页假设参数',raw => record(raw) && typeof raw.enabled === 'boolean' && typeof raw.kind === 'string' && ['FREIGHT','FX','RESPONSIBILITY'].includes(raw.kind) && ['target','from','to','step'].every(k => typeof raw[k] === 'string') ? 'STRUCTURE_OK' : 'INVALID');
  check('customer_fields','本页客户公开输入',raw => record(raw) && CUSTOMER_QUOTE_FIELDS.every(k => typeof raw[k] === 'string') ? 'STRUCTURE_OK' : 'INVALID');
  check('browser_draft_text','浏览器草稿原文',raw => {
    if (typeof raw !== 'string') return 'INVALID';
    const draft: unknown = JSON.parse(raw);
    if (!record(draft)) return 'INVALID';
    const status = projectStatus(draft.project);
    validateDraftFxRows(draft.fxRows);
    return status;
  });
  return {stage:value.stage,parts,unknownFields:Object.keys(value).filter(k => !keys.includes(k)).length};
}
