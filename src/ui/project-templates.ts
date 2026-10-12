import { PROJECT_TEMPLATES } from '../data/project-templates.js';
import { escapeHtml } from './format.js';
export function renderProjectTemplatePanel(busy=false):string {
 return `<details class="panel" data-evidence-section="project-templates"><summary><span class="panel-title">项目模板与文件格式</span></summary><div class="panel-body">
 <p>先下载独立模板，再用“打开项目”导入。下载不替换当前交易；打开前请先保存当前改动。</p>
 ${busy?'<p role="status">正在导出模板或结构文件…</p>':''}
 ${PROJECT_TEMPLATES.map(t=>`<section><h3>${escapeHtml(t.title)} · ${escapeHtml(t.kind)}</h3><p>${escapeHtml(t.description)}</p><button data-action="download-project-template" data-template-id="${t.id}"${busy?' disabled':''}>下载此模板（JSON）</button></section>`).join('')}
 <p>文件格式0.8，接受结构兼容的0.1–0.7旧容器。打开旧文件仅升级容器版本，保存为新的0.8文件；保留空输入及未知扩展，不补税率、汇率或业务资格。客户公开字段和预览检查目前不写入项目JSON。</p>
 <button data-action="download-project-schema" data-schema-kind="current"${busy?' disabled':''}>下载0.8结构 Schema</button>
 <button data-action="download-project-schema" data-schema-kind="legacy"${busy?' disabled':''}>下载旧容器导入 Schema</button>
 <p class="hint">Schema是结构说明，不能作为交易项目打开。它不证明可计算或适用法规；跨费用ID重复由应用另核，金额、日期、来源和业务条件仍须完成核对。</p>
 </div></details>`;
}
