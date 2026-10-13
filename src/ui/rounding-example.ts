import {ROUNDING_EXAMPLE_FILES,roundingExampleJson,roundingExampleRecord,type RoundingExampleKind} from '../data/rounding-example.js';
import {FUNDING_EXAMPLE_GUIDE_STYLES} from './funding-example.js';
import {escapeHtml as e} from './format.js';
export function roundingExampleGuideBody():string{
  const r=roundingExampleRecord().expected;
  return `<p><strong>这是合成舍入手算案例，不是真实贸易、报关或银行账单验收。</strong>本金6 USD、年利率36%是刻意设定；108300 USD合成CIF报价与本金独立，来源仍为示例，不推定实际融资或收付。</p>
    <ol><li>先分别保存自己的项目及本页付款计划，再下载四份配套文件。下载不会载入或替换当前交易。</li><li>用“打开项目”选择${e(ROUNDING_EXAMPLE_FILES.project)}，再用付款面板打开${e(ROUNDING_EXAMPLE_FILES.plan)}。核对名称、商品、数量、CIF地点及原币报价；不要用重新绑定掩盖文件错配。</li><li>核对9月1日至4日（含起日、不含止日），本金6、年利率36%、ACT/360。9月2日和3日仍为36%的合成记录人为形成三个1天区间，不能当作银行结息日。</li><li>默认按合计后、步长0.01、HALF_UP应用：原始单利0.018 USD，舍入假设金额0.02 USD，调整0.002 USD。逐区间比较0.03 USD仅是对照，默认未确认该边界。</li><li>做逐区间试验：选择“逐计算区间舍入再相加”，重新选择“应用下列明确舍入假设”，先查看边界待确认提示；读懂区间含义后勾选本合成试验的边界确认。得到0.03 USD，原始0.018仍保留。不要把这次试验确认带入真实银行合同。</li><li>依下表切换HALF_EVEN与DOWN；修改生效日或增删事件会清除边界确认。明确不应用舍入时保留原始0.018，不表示银行不舍入。恢复默认：选择合计后、HALF_UP、步长0.01并重新确认应用，或重新打开配套付款文件。</li><li>导出内部HTML和内部Excel，核对原始单利、舍入金额、层级差额、精确分数、逐段比较及舍入依据。客户文件仍采用公开白名单，分享前检查预览；公开文字手填敏感内容仍需人工检查。</li></ol>
    <table class="grid stackable"><thead><tr><th>计算区间</th><th>本金 / 年利率 / 天数</th><th>未舍入成本USD</th></tr></thead><tbody>${r.segments.map(s=>`<tr><th>${s.start_date} → ${s.end_date}</th><td data-label="显式输入">6 USD / 36% / ${s.days}天</td><td data-label="未舍入">${s.cost} = ${s.cost_exact}</td></tr>`).join('')}</tbody></table>
    <p>${e(r.formula)} USD。原始精确分数 ${r.cost_exact}；合计后调整 ${r.adjustment} = ${r.adjustment_exact} USD。期间结束不推定本金已归还。</p>
    <table class="grid stackable"><thead><tr><th>方式，步长0.01</th><th>合计后</th><th>每段 / 逐区间合计</th><th>逐区间−合计USD</th></tr></thead><tbody>${r.comparisons.map(c=>`<tr><th>${c.mode}</th><td data-label="合计后">${c.total}</td><td data-label="逐区间">${c.per_interval} × 3 = ${c.interval_sum}</td><td data-label="差额">${c.interval_minus_total}</td></tr>`).join('')}</tbody></table>
    <p>HALF_UP就近、恰半向上（本模型非负）；HALF_EVEN恰半取偶数个步长；DOWN向零截断。本例0.006不是恰半，因此前两方式相同。另一个独立口算：0.005按0.01，HALF_UP为0.01、HALF_EVEN为0.00。方式不自动从币种或付款方法推定。</p>
    <h3>保存、交接及错误处理</h3><ul><li>项目JSON保存交易输入；付款1.4另存本金、利率及舍入假设。跨设备需传递这两份文件；页面刷新/打开项目会重置本页计划。</li><li>内部HTML/Excel是含敏感输入的生成时快照，不能再导入为项目或付款。修改Excel单元格不会重跑引擎；原始值与舍入值分列。</li><li>手算记录和本说明不是可导入业务文件，预期固定，修改例题后不会自动变成正确答案。</li><li>错配、坏结构或未来版本先保留原文件并核对；不能直接重新绑定或补零消除错误。发起下载后确认浏览器实际保存。</li></ul>
    <p class="hint">按原始十进制输入的精确分数判断舍入，不重复舍入12位近似展示值。原始/调整十进制最多256有效位，精确分数另列，超Excel数值精度以文本保留。逐区间结果不等于实际扣款，单利/舍入假设独立于贸易利润、税费和价款收付；自定义结息日、逐日舍入、复利及最低收费未建模。真实资料、专业和真实手机验收尚未完成。</p>`;
}
export function renderRoundingExamplePanel(busy=false):string{
  const buttons:[RoundingExampleKind,string][]=[['project','下载舍入配套项目JSON'],['plan','下载舍入配套付款JSON'],['record','下载舍入手算核对记录'],['guide','下载舍入离线说明页']];
  return `<details class="panel" data-evidence-section="rounding-example"><summary><span class="panel-title">合成案例 · 金额舍入层级与操作指引</span></summary><div class="panel-body"><p>独立于原本金案例；四份文件不读取当前交易、付款、客户或草稿，不自动载入。</p><div class="panel-actions">${buttons.map(([kind,label])=>`<button data-action="download-rounding-example" data-rounding-kind="${kind}"${busy?' disabled':''}>${label}</button>`).join('')}</div>${busy?'<p role="status">正在导出模板、案例或结构文件…</p>':''}${roundingExampleGuideBody()}</div></details>`;
}
export function roundingExampleResource(kind:string):{name:string;mime:string;text:string}{
  if(!Object.hasOwn(ROUNDING_EXAMPLE_FILES,kind))throw Error('请选择目录中的舍入合成案例文件');
  const key=kind as RoundingExampleKind,name=ROUNDING_EXAMPLE_FILES[key];
  if(key!=='guide')return{name,mime:'application/json',text:roundingExampleJson(key)};
  return{name,mime:'text/html',text:`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>合成舍入案例 · 手算核对与操作指引</title><style>${FUNDING_EXAMPLE_GUIDE_STYLES}</style></head><body><main class="panel guide"><div class="panel-body"><h1>合成舍入案例 · 手算核对与操作指引</h1>${roundingExampleGuideBody()}</div></main></body></html>\n`};
}
