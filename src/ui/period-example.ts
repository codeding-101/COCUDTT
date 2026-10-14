import {PERIOD_EXAMPLE_FILES,periodExampleJson,periodExampleRecord,type PeriodExampleKind} from '../data/period-example.js';
import {FUNDING_EXAMPLE_GUIDE_STYLES} from './funding-example.js';
import {escapeHtml as e} from './format.js';
export function periodExampleGuideBody():string{
 const r=periodExampleRecord().expected;
 return `<p><strong>合成手算案例，不是真实贸易、银行账单或专业复核。</strong>本金6/12 USD、36%/18%年利率刻意设定，与108300 USD合成CIF报价独立；来源保持EXAMPLE。就绪、应用和期间确认仅是例题设定，不是用户交易的事实确认。</p>
 <ol><li>先分别保存自己的项目及本页付款计划，再下载四份配套文件；下载不替换当前输入。</li><li>用“打开项目”选择${e(PERIOD_EXAMPLE_FILES.project)}，再在付款面板打开${e(PERIOD_EXAMPLE_FILES.plan)}。核对名称、报价、商品及地点，不要用重新绑定掩盖文件错配。</li><li>付款1.5：本金6 USD，9月2日计息前增加6至12，9月3日计息前年利率36%改18%；ACT/360，9月1日含、5日不含，共4天。原始单利0.03 USD，截止日不推定还本。</li><li>打开“按明确期间汇总与舍入审计”。默认两期为9月1日至4日、4日至5日；首期0.024 → 0.02，尾期0.006 → 0.01，按期相加0.03 USD。展开每期及原段交集：原计算段3段，交集4片，归集切点不改变原本金/利率分段。</li><li>确认失效试验：修改本期依据，结果应被待确认提示替代。核对整体依据、完整覆盖、每期边界与短尾期处理，再勾选独立期间确认。修改方式、步长或舍入依据，还须重新选择“应用下列明确舍入假设”。旧逐区间确认不能代替期间确认。</li><li>独立比较四个一天归集期：先保存当前计划，再删除两期、按顺序新增9月1→2、2→3、3→4、4→5；每期填写“合成内部每日应计假设，不是银行结息事实”，重新复核并确认。HALF_UP得到0.04 USD，原始单利仍0.03；这只是手工设置四个期间，没有自动逐日结息功能。恢复默认请重新打开配套付款文件。</li><li>切换HALF_EVEN或DOWN，重新确认应用和期间后依下表核对。旧TOTAL/INTERVALS也可作独立试验；INTERVALS须单独确认计算区间边界，不代表银行约定。不要把试验确认带入真实业务。</li><li>分别保存项目JSON和付款JSON，跨设备携带两份；页面刷新或打开项目会重置本页付款计划。内部HTML/Excel核对精确分数、原段交集、依据链及原始输入；客户版沿公开白名单，分享前仍需预览检查。</li></ol>
 <h3>固定手算</h3><p>${e(r.formula)} USD = ${r.cost_exact}。每段含起日、不含止日；先按原始输入精确汇总，不能先舍入交集再相加。</p>
 <table class="grid stackable"><thead><tr><th>原计算段</th><th>本金 / 年利率 / 天数</th><th>原值 USD</th></tr></thead><tbody>${r.segments.map((s,i)=>`<tr><th>${i+1}：${s.start_date} → ${s.end_date}</th><td data-label="输入">${s.principal} / ${s.annual_rate}% / ${s.days}天</td><td data-label="原值">${s.cost} = ${s.cost_exact}</td></tr>`).join('')}</tbody></table>
 <table class="grid stackable"><thead><tr><th>明确归集期</th><th>原值 → HALF_UP</th><th>来源及调整 USD</th></tr></thead><tbody>${r.periods.map(p=>`<tr><th>${p.start_date} → ${p.end_date}，${p.days}天</th><td data-label="原值→舍入">${p.cost} = ${p.cost_exact} → ${p.rounded}</td><td data-label="来源/调整">原段 ${p.source_segments.join('、')}；交集 ${p.fragment_costs.join(' + ')}；调整 ${p.adjustment} = ${p.adjustment_exact}</td></tr>`).join('')}</tbody></table>
 <table class="grid stackable"><thead><tr><th>方式 / 步长0.01</th><th>合计后 / 原3段</th><th>明确2期 / 人为4期</th><th>2期−合计 / 4期−合计 USD</th></tr></thead><tbody>${r.comparisons.map(c=>`<tr><th>${c.mode}</th><td data-label="合计/原段">${c.total} / ${c.calculation_intervals}</td><td data-label="2期/4期">${c.explicit_periods} / ${c.daily_periods}</td><td data-label="层级差额">${c.period_minus_total} / ${c.daily_minus_total}</td></tr>`).join('')}</tbody></table>
 <p>HALF_UP就近恰半向上，HALF_EVEN恰半取偶数个步长，DOWN向零截断；本例非负且没有恰半。每期只舍入一次，相加后不再次舍入。本例两期调整互抵为0，不表示其他期间划分也无差额。</p>
 <h3>保存与异常处理</h3><ul><li>付款1.5保留期表、各项依据和确认。修改例题后固定手算记录不会更新，不能继续当新输入的正确答案。</li><li>内部报告是含敏感信息的生成时快照；不能重新导入为项目/付款，修改Excel单元格不会重跑引擎。手算记录和说明页也不可导入。</li><li>错配、未来版本、坏结构或覆盖缺口先保留原文件，不补零或重新绑定来消除错误。取消或保存失败后输入保留；下载后检查浏览器实际保存。</li><li>恢复备份先只读检查，不自动载入；原始备份含项目及付款敏感信息，分享前检查。</li></ul>
 <p class="hint">明确归集期用于内部应计假设，尤其短尾期不能称已结息。模型不生成银行扣款、实际清偿、复利、最低收费或业务日调整；资金假设不加进税费、经营利润和价款收付。真实单据、专业及真实手机验收尚未完成。本工具仅供学习与内部测算参考，不构成法律或专业贸易建议；实际合同以Incoterms®官方文本及当地法规为准。</p>`;
}
export function renderPeriodExamplePanel(busy=false):string{
 const buttons:[PeriodExampleKind,string][]=[['project','下载期间配套项目JSON'],['plan','下载期间配套付款JSON'],['record','下载期间手算核对记录'],['guide','下载期间离线说明页']];
 return `<details class="panel" data-evidence-section="period-example"><summary><span class="panel-title">合成案例 · 计算分段与明确归集期</span></summary><div class="panel-body"><p>四份固定文件不读取当前交易、付款、客户或草稿，不自动载入。</p><div class="panel-actions">${buttons.map(([kind,label])=>`<button data-action="download-period-example" data-period-kind="${kind}"${busy?' disabled':''}>${label}</button>`).join('')}</div>${busy?'<p role="status">正在导出模板、案例或结构文件…</p>':''}${periodExampleGuideBody()}</div></details>`;
}
export function periodExampleResource(kind:string):{name:string;mime:string;text:string}{
 if(!Object.hasOwn(PERIOD_EXAMPLE_FILES,kind))throw Error('请选择目录中的期间合成案例文件');
 const key=kind as PeriodExampleKind,name=PERIOD_EXAMPLE_FILES[key];
 if(key!=='guide')return{name,mime:'application/json',text:periodExampleJson(key)};
 return{name,mime:'text/html',text:`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>合成期间案例 · 手算核对与操作指引</title><style>${FUNDING_EXAMPLE_GUIDE_STYLES}</style></head><body><main class="panel guide"><div class="panel-body"><h1>合成期间案例 · 手算核对与操作指引</h1>${periodExampleGuideBody()}</div></main></body></html>\n`};
}
