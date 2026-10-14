import type { SourceEvidence } from '../domain/source-evidence.js';
import { escapeHtml } from './format.js';

export const SOURCE_STATUS_LABELS: Record<SourceEvidence['status'], string> = {
  EXAMPLE: '示例数据', UNVERIFIED: '尚未核对', USER_CONFIRMED: '用户已核对',
};

export function renderSourceEditor(evidence: SourceEvidence | undefined, owner: string, id = ''): string {
  const binding = `data-evidence-owner="${escapeHtml(owner)}" data-evidence-id="${escapeHtml(id)}"`;
  const fields = [
    ['reference', '来源链接或文件编号', '例如税率查询页面、合同编号'],
    ['valid_from', '来源适用期起', 'YYYY-MM-DD'],
    ['valid_to', '来源适用期止', 'YYYY-MM-DD'],
    ['checked_on', '核对日期', 'YYYY-MM-DD'],
  ] as const;
  return `<details class="evidence source-editor" data-evidence-section="${escapeHtml(`${owner}:${id}`)}">
    <summary>来源核对 · ${SOURCE_STATUS_LABELS[evidence?.status ?? 'UNVERIFIED']}</summary>
    <div class="field-grid">
      ${fields.map(([field, label, placeholder]) => `<label class="field${field === 'reference' ? ' wide' : ''}">${label}<input type="text" value="${escapeHtml(evidence?.[field] ?? '')}" placeholder="${placeholder}" ${binding} data-evidence-field="${field}" /></label>`).join('')}
      <label class="field">核对状态<select ${binding} data-evidence-field="status">${Object.entries(SOURCE_STATUS_LABELS).map(([value, label]) => `<option value="${value}"${value === (evidence?.status ?? 'UNVERIFIED') ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
    </div>
    <p class="hint block">核对记录由你填写，程序不自动认证来源。修改已核对数据或来源记录后，需要重新确认。</p>
  </details>`;
}
