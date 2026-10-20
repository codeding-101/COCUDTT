import {FeeWorkbenchTransaction} from '../data/fee-workbench.js';
import {copyFeeEnvelopeJson} from '../data/fee-envelope-json.js';
import {parseProject} from '../data/project-file.js';
import type {FeeEnvelopePlan, FeeEnvelopeSources} from '../domain/fee-envelope.js';
import type {FeeWorkbenchInput, FeeWorkbenchPreview} from '../domain/fee-workbench.js';
import {escapeHtml as h} from './format.js';

/** Actual runtime projection. Missing sources and unknown save evidence remain explicit. */
export interface RuntimeFeeWorkbenchCapture {
  scope: 'RUNTIME_FEE_WORKBENCH_CAPTURE';
  envelope_json: string | null;
  sources: {[K in keyof FeeEnvelopeSources]: string | null};
  fx: FeeWorkbenchInput['fx'];
  files: FeeWorkbenchInput['files'];
  editors: FeeWorkbenchInput['editors'];
  activity: FeeWorkbenchInput['activity'];
  retained_json: string;
  blockers: string[];
}
export interface RuntimeFeeWorkbenchPreview {
  capture: RuntimeFeeWorkbenchCapture;
  status: 'STAGED' | 'BLOCKED';
  issues: readonly string[];
  preview: FeeWorkbenchPreview | null;
  rows: readonly {mapping_id: string; bill_id: string; line_id: string; cost_id: string; operation: 'CREATE_NEW' | 'REFERENCE_EXISTING'; name: string; amount: string; currency: string}[];
  runtime_writes: 0;
}
function freeze<T>(v: T): T {if (v && typeof v === 'object') {Object.values(v).forEach(freeze); Object.freeze(v);} return v;}
export function captureRuntimeFeeWorkbench(value: RuntimeFeeWorkbenchCapture): RuntimeFeeWorkbenchCapture {
  const c = copyFeeEnvelopeJson(value) as RuntimeFeeWorkbenchCapture;
  if (c.scope !== 'RUNTIME_FEE_WORKBENCH_CAPTURE' || !Array.isArray(c.blockers) || c.blockers.some(v => typeof v !== 'string')) throw Error('RUNTIME_CAPTURE_SHAPE');
  return freeze(c);
}
/** The transaction owner stays private and is discarded. No confirm, cache, save or runtime installation. */
export async function previewRuntimeFeeWorkbench(value: RuntimeFeeWorkbenchCapture, transaction_id: string): Promise<RuntimeFeeWorkbenchPreview> {
  const capture = captureRuntimeFeeWorkbench(value), issues = [...capture.blockers];
  if (capture.envelope_json === null) issues.push('MISSING_ENVELOPE');
  if (capture.sources.project_json === null) issues.push('MISSING_PROJECT');
  if (capture.sources.bill_json === null) issues.push('MISSING_BILL');
  for (const [key, value] of Object.entries(capture.editors)) if (value !== null) issues.push('UNCOMMITTED_' + key.toUpperCase());
  for (const [key, value] of Object.entries(capture.activity)) if (value) issues.push('ACTIVE_' + key.toUpperCase());
  if (issues.length) return freeze({capture, status: 'BLOCKED', issues: [...new Set(issues)], preview: null, rows: [], runtime_writes: 0});
  const {scope: _, blockers: __, ...input} = capture;
  const owner = await FeeWorkbenchTransaction.open(input as FeeWorkbenchInput);
  const preview = await owner.preview(transaction_id), rows: RuntimeFeeWorkbenchPreview['rows'][number][] = [];
  if (preview.status === 'STAGED') {
    if (!preview.plan_json || !preview.after_sources) throw Error('RUNTIME_PREVIEW_INCOMPLETE');
    const plan = JSON.parse(preview.plan_json) as FeeEnvelopePlan, project = parseProject(preview.after_sources.project_json);
    for (const row of plan.rows) {
      const cost = project.items.find(c => c.cost_id === row.cost_id);
      if (!cost || cost.amount === undefined) throw Error('RUNTIME_PREVIEW_TARGET');
      rows.push({...row, name: cost.cost_name, amount: String(cost.amount), currency: cost.currency});
    }
  }
  return freeze({capture, status: preview.status, issues: [...preview.issues], preview, rows, runtime_writes: 0});
}
const labels: Record<string, string> = {
  MISSING_ENVELOPE: '尚未明确采用项目资料封套。', MISSING_PROJECT: '尚无当前项目。', MISSING_BILL: '尚无当前独立账单。',
  WORKBENCH_SOURCES_DIFFER: '工作台与封套内的完整来源原文不同，请逐项核对；不会用封套覆盖当前资料。',
  UNCOMMITTED_COST: '费用编辑尚未提交。', UNCOMMITTED_REVIEW: '核对记录编辑尚未提交。', UNCOMMITTED_ATTACHMENT: '成分附件编辑尚未提交。', UNCOMMITTED_PRECISION: '精度选择编辑尚未提交。', UNCOMMITTED_PENDING_INPUT: '页面还有未提交输入，请先完成或修正该字段。',
  ACTIVE_PROJECT_READ: '项目文件仍在读取。', ACTIVE_BILL_READ: '账单文件仍在读取。', ACTIVE_PAIR_READ: '配对文件仍在读取。', ACTIVE_ATTACHMENT_MUTATION: '成分附件仍有读取、候选或写入操作。', ACTIVE_PRECISION_MUTATION: '精度选择仍有读取、候选或写入操作。', ACTIVE_RECOVERY: '当前处于故障恢复或恢复资料检查。',
  ACTIVE_ENVELOPE: '封套仍有读取、候选、写入或缓存操作。', ACTIVE_FILE_WRITE: '其他文件操作尚未完成。',
  INCOMPLETE_FX_ROWS: '汇率编辑行未填写完整，原行保留。', DUPLICATE_FX_ROW_ID: '汇率行编号重复。', DUPLICATE_FX_PAIR: '汇率币种对与适用期重复。', STALE_FX_LEASE: '保留汇率簿与原始编辑行不一致。', FX_ROWS_DIFFER_FROM_PROJECT: '原始汇率编辑行与项目汇率簿不一致。', INVALID_FX_OR_PROJECT: '项目或原始汇率未通过校验。',
  HISTORY_NOT_ESTABLISHED: '封套历史未知，不能推定费用从未使用。', COMPLETE_CURRENT_SOURCES_REQUIRED: '还需完整配对、成分附件与精度选择资料。', EMPTY_BATCH: '没有可预览的完整费用批次。',
};
export function runtimeFeeWorkbenchIssue(code: string) {return labels[code] ?? '需继续核对：' + code;}
export function renderRuntimeFeeWorkbenchPreview(result: RuntimeFeeWorkbenchPreview | null, busy: boolean, message: string): string {
  return `<details class="fee-workbench-preview" data-fee-workbench-panel><summary>整批费用预览</summary><p>适用场景：核对当前工作台与封套是否一致，再逐笔查看整批候选。预览不会新增费用或回执，也不证明真实业务或全局未重复。</p><div class="panel-actions"><button type="button" data-action="fee-envelope-workbench-preview"${busy ? ' disabled' : ''}>${busy ? '正在核对完整批次…' : '核对当前工作台并预览'}</button><button type="button" data-action="fee-envelope-workbench-cancel">清除本次预览</button><button type="button" data-action="fee-envelope-workbench-backup">另存当前工作台检查备份</button></div><p role="status" aria-live="polite" data-fee-workbench-status>${h(message)}</p>${result ? `<section data-fee-workbench-result data-status="${result.status}"><h3>${result.status === 'STAGED' ? `批次检查通过：拟新增 ${result.preview!.costs_added} 笔费用、记录 ${result.preview!.references_recorded} 笔已有费用引用` : '暂不能形成完整候选'}</h3>${result.issues.length ? `<ul>${result.issues.map(code => `<li>${h(runtimeFeeWorkbenchIssue(code))} <small>（${h(code)}）</small></li>`).join('')}</ul>` : ''}${result.rows.length ? `<ol class="fee-workbench-rows">${result.rows.map(row => `<li><strong>${h(row.name)}</strong><span>${h(row.amount)} ${h(row.currency)} · ${row.operation === 'CREATE_NEW' ? '拟新增，保持原币原金额' : '仅引用已有费用，不重复新增'}</span><small>账单 ${h(row.bill_id)} / 行 ${h(row.line_id)} → 费用 ${h(row.cost_id)}；映射 ${h(row.mapping_id)}</small></li>`).join('')}</ol><p>若后续实际新增费用，原配对、成分附件与精度选择将保留为历史资料；原确认不能自动沿用。所有金额仍以实际业务依据为准。</p>` : ''}<p>当前项目费用、回执、客户报价及文件保存状态均保持。实际应用入口待整批提交与故障验收完成后开放。</p></section>` : ''}</details>`;
}
