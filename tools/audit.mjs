import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * 静态审查脚本：找出"定义了但没人用"和"用了但没人处理"这类
 * 不会让编译或测试报错、却会静默失效的问题。
 *
 * 覆盖四类：
 *   1. 界面渲染出来的字段/动作，事件处理里没有对应分支（改了不生效）
 *   2. 声明过的错误码，没有任何地方抛出（要么是死代码，要么是漏了校验）
 *   3. 声明过的告警码，没有任何地方发出（同上）
 *   4. 界面里的 data-path，指向项目数据结构中不存在的路径（写了个不生效的字段）
 */

const root = resolve(import.meta.dirname, '..');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const srcFiles = walk(join(root, 'src'));
const read = (file) => readFileSync(file, 'utf8');
const rel = (file) => relative(root, file).replace(/\\/g, '/');

function matchAll(text, regex, group = 1) {
  const out = new Set();
  for (const match of text.matchAll(regex)) {
    const value = match[group];
    if (value !== undefined) out.add(value);
  }
  return out;
}

const problems = [];
const appTs = read(join(root, 'src/ui/app.ts'));
const uiText = srcFiles
  .filter((file) => rel(file).startsWith('src/ui/'))
  .map(read)
  .join('\n');
const allText = srcFiles.map((file) => ({ file, text: read(file) }));

// ---------- 1. 渲染字段 / 动作 是否都有处理分支 ----------
const handledFields = matchAll(appTs, /^\s+case '([a-zA-Z_]+)':/gm);
const renderedFields = new Set([
  ...matchAll(uiText, /data-item-field="([a-z_]+)"/g),
  ...matchAll(uiText, /data-fx-field="([a-z_]+)"/g),
  ...matchAll(uiText, /data-hs-field="([a-z_]+)"/g),
]);
for (const field of renderedFields) {
  if (!handledFields.has(field)) {
    problems.push(`[字段未处理] 界面渲染了 data-*-field="${field}"，但 app.ts 中没有对应分支——改它不会生效`);
  }
}

const handledActions = new Set([
  ...matchAll(appTs, /^\s+case '([a-z-]+)':/gm),
  // 下拉选择触发的动作不走 switch，而是直接比对 dataset.action
  ...matchAll(appTs, /dataset\.action === '([a-z-]+)'/g),
]);
const renderedActions = matchAll(uiText, /data-action="([a-z-]+)"/g);
for (const action of renderedActions) {
  if (!handledActions.has(action)) {
    problems.push(`[动作未处理] 界面渲染了 data-action="${action}"，但 app.ts 中没有对应分支`);
  }
}

// ---------- 2. 错误码 ----------
const declaredErrors = matchAll(read(join(root, 'src/engine/errors.ts')), /^\s*\|\s*'([A-Z_]+)'/gm);
const thrownErrors = new Set();
for (const { text } of allText) {
  for (const code of matchAll(text, /new EngineError\(\s*'([A-Z_]+)'/g)) thrownErrors.add(code);
}
for (const code of declaredErrors) {
  if (!thrownErrors.has(code)) problems.push(`[错误码未抛出] ${code} 已声明但没有任何地方抛出`);
}
for (const code of thrownErrors) {
  if (!declaredErrors.has(code)) problems.push(`[错误码未声明] ${code} 被抛出但不在 EngineErrorCode 里`);
}

// ---------- 3. 告警码 ----------
const declaredWarnings = matchAll(read(join(root, 'src/domain/warning.ts')), /^\s*\|\s*'([A-Z_]+)'/gm);
const emittedWarnings = new Set();
for (const { file, text } of allText) {
  if (rel(file).includes('warning.ts')) continue;
  for (const code of matchAll(text, /code:\s*'([A-Z_]+)'/g)) emittedWarnings.add(code);
}
for (const code of declaredWarnings) {
  if (!emittedWarnings.has(code)) problems.push(`[告警码未发出] ${code} 已声明但没有任何地方发出`);
}
for (const code of emittedWarnings) {
  if (!declaredWarnings.has(code)) problems.push(`[告警码未声明] ${code} 被发出但不在 WarningCode 里`);
}

// ---------- 4. data-path 是否指向真实存在的路径 ----------
const projectPaths = new Set([
  'name',
  'base_currency',
  'carriage_mode',
  'export_date',
  'goods.name',
  'goods.quantity',
  'goods.unit',
  'goods.trade_value.amount',
  'goods.trade_value.currency',
  'goods.seller_goods_cost.amount',
  'goods.seller_goods_cost.currency',
  'goods.tax_key',
  'quote.amount',
  'quote.currency',
  'quote.fx_type',
  'quote.fx_date',
  'incoterm',
  'anchor.kind',
  'anchor.buyer_total',
  'anchor.currency',
  'anchor.margin_rate',
  'facts.delivery_place',
  'facts.shipping_terms',
  'facts.clearance_agent',
  'tax_profile.import.hsTable.basis',
]);
for (const path of matchAll(uiText, /data-path="([^"]+)"/g)) {
  if (!projectPaths.has(path)) problems.push(`[路径可疑] data-path="${path}" 不在已知的项目字段清单里，确认它真的存在`);
}

// ---------- 汇总 ----------
if (problems.length === 0) {
  console.log('静态审查通过：没有发现未处理的字段/动作、未使用的错误码或告警码。');
} else {
  console.log(`静态审查发现 ${problems.length} 项：`);
  for (const problem of problems) console.log(`  · ${problem}`);
}

console.log('');
console.log(`统计：错误码 ${declaredErrors.size} 个（抛出 ${thrownErrors.size}）、告警码 ${declaredWarnings.size} 个（发出 ${emittedWarnings.size}）`);
console.log(`      界面字段 ${renderedFields.size} 个、动作 ${renderedActions.size} 个、data-path ${matchAll(uiText, /data-path="([^"]+)"/g).size} 个`);
