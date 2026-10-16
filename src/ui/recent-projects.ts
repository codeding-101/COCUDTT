import { parseProject } from '../data/project-file.js';
import { recentProjectBytes } from '../data/recent-projects.js';
import { escapeHtml as h } from './format.js';
import type { RecentProjectsController } from './recent-projects-controller.js';

export function renderRecentProjectsBody(c: RecentProjectsController): string {
  c.guardContext();
  const attr = `data-recent-generation="${c.generation}"`, disabled = c.busy ? ' disabled' : '';
  const button = (action:string,label:string,id?:string) => `<button type="button" data-action="${action}" ${attr}${id ? ` data-recent-id="${h(id)}"` : ''}${disabled}>${label}</button>`;
  const read = c.read;
  const selected = c.prepared?.id && read?.status === 'ready' ? read.catalog.entries.find(e=>e.id===c.prepared!.id) : null;
  const selectedTitle = selected ? [...parseProject(selected.project_text).name].slice(0,80).join('') || '未命名项目' : '';
  return `<p>手动保留完整内部项目 JSON，可能含采购成本、来源和未知扩展中的客户资料。仅本机同一浏览器与来源可见，清除站点数据会丢失；缓存不是备份。最多3份、每份256 KiB，不自动加入、替换同名项目或淘汰旧条目。</p>
    <p>不收集独立付款计划、账单/配对及其编辑草稿、客户公开文字或界面偏好；项目未知扩展仍原样保留。加入时间不是交易或报价日期。</p>
    <div class="panel-actions">${button('recent-refresh',read ? '重新读取列表' : '读取本机列表')}${read && read.raw !== null ? button('recent-backup','导出内部缓存原文') : ''}${read && read.raw !== null ? button('recent-prepare-clear','准备清空此缓存') : ''}</div>
    ${!read ? '<p>尚未读取本机列表；打开此面板不会自动读取缓存。</p>' : read.status !== 'ready' ? `<p class="error">${h(read.error.message)}。${read.status === 'invalid' ? '可先导出完整原文，再明确选择丢弃；不会自动修复或覆盖。' : '请使用独立项目 JSON。'}</p>` : `
      <p>已保留 ${read.catalog.entries.length} / 3 份，按手动加入顺序排列；打开不改变顺序。</p>
      <label class="recent-consent"><input type="checkbox" data-recent-field="copy" ${attr}${c.copyAccepted ? ' checked' : ''}${disabled}>我接受在本机增加完整内部项目副本，并另存 JSON 备份。</label>
      ${button('recent-add','将当前交易加入本机快照')}
      <ul class="recent-project-list">${read.catalog.entries.map(entry => {
        const project = parseProject(entry.project_text), title = [...project.name].slice(0,80).join('') || '未命名项目';
        return `<li><strong>${h(title)}</strong><p>${h(project.incoterm)} · ${h(project.base_currency)} · ${(recentProjectBytes(entry.project_text)/1024).toFixed(1)} KiB<br>加入时间（UTC）${h(entry.added_at)}</p><div class="panel-actions">${button('recent-prepare-open','准备打开',entry.id)}${button('recent-prepare-delete','准备删除',entry.id)}</div></li>`;
      }).join('')}</ul>${read.catalog.entries.length ? '' : '<p>暂无手动快照。先填写交易，再接受副本范围并点击加入。</p>'}`}
    ${c.prepared ? `<div class="recent-confirm" role="group" aria-label="核对待执行操作">${selected ? `<p>所选快照：<strong>${h(selectedTitle)}</strong> · 加入时间（UTC）${h(selected.added_at)} · 标识 ${h(selected.id)}</p>` : ''}<p><strong>${c.prepared.kind === 'open' ? '打开所选快照会替换当前交易和原始汇率输入，并重置内存中的付款计划、客户公开文字和假设分析参数。独立账单与配对保留，须按新交易重新核对；不会恢复这些独立资料。请先保存当前项目和其他未保存资料。' : c.prepared.kind === 'delete' ? '仅删除所选本机快照，不删除当前交易或其他缓存。此操作不可撤销。' : '仅清空最近项目缓存，包括损坏或未来格式原文；不会清理当前交易、草稿及独立资料。请先导出原文，此操作不可撤销。'}</strong></p>
      <label class="recent-consent"><input type="checkbox" data-recent-field="action" ${attr}${c.actionAccepted ? ' checked' : ''}${disabled}>我已核对所选操作及影响，接受继续。</label><div class="panel-actions">${button('recent-execute','确认执行')}${button('recent-cancel','取消')}</div></div>` : ''}
    <p role="status" aria-live="polite" data-recent-message>${h(c.message)}</p>`;
}
export function renderRecentProjects(c: RecentProjectsController, open: boolean): string {
  return `<details class="panel recent-projects" data-evidence-section="recent-projects"${open ? ' open' : ''}><summary><span class="panel-title">最近项目 · 本机快照</span><span class="hint">手动加入 / 原文备份</span></summary><div class="panel-body" data-recent-host>${renderRecentProjectsBody(c)}</div></details>`;
}
