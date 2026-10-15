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
const handledFields = matchAll(appTs, /^\s+case '([a-zA-Z_-]+)':/gm);
const renderedFields = new Set([
  ...matchAll(uiText, /data-item-field="([a-z_]+)"/g),
  ...matchAll(uiText, /data-fx-field="([a-z_]+)"/g),
  ...matchAll(uiText, /data-hs-field="([a-z_]+)"/g),
  ...matchAll(uiText, /itemAttr\([^,]+,\s*'([a-z_-]+)'\)/g),
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
const billUi=read(join(root,'src/ui/container-bill.ts')),billController=read(join(root,'src/ui/container-bill-controller.ts'));
for(const action of matchAll(billUi,/(?:button|scope)\('([a-z-]+)'/g))renderedActions.add(action);
const pairUi=read(join(root,'src/ui/container-cost-pair.ts'));
for(const action of matchAll(pairUi,/\bb\('([a-z-]+)'/g))renderedActions.add(action);
const billFields=matchAll(billUi,/(?:field|choose)\('([a-z_.]+)'/g);
for(const field of billFields){if(field.endsWith('.'))continue;if(['name','notes','review_date'].includes(field)?!billController.includes(`path==='${field}'`):!billController.includes(`'${field}'`))problems.push(`[账单字段未处理] ${field}没有对应白名单/处理分支`);}
for(const prefix of['source.','cost_source.'])for(const key of['reference','valid_from','valid_to','checked_on'])if(!billController.includes(`'${prefix+key}'`))problems.push(`[账单来源字段未处理] ${prefix+key}`);
const sensitivityFields = new Set([...matchAll(uiText, /data-sensitivity-field="([a-z_]+)"/g), 'from', 'to', 'step']);
const sensitivityHandler = appTs.slice(appTs.indexOf('if (target.dataset.sensitivityField !== undefined)'), appTs.indexOf("if (target.dataset.evidenceOwner !== undefined", appTs.indexOf('if (target.dataset.sensitivityField !== undefined)')));
for (const field of sensitivityFields) {
  if (!sensitivityHandler.includes(`field === '${field}'`)) problems.push(`[假设字段未处理] ${field} 没有对应处理分支`);
}
const contractFields = matchAll(uiText, /data-contract-field="([a-z_]+)"/g);
const settlementFields = new Set([
  ...matchAll(uiText, /data-settlement-field="([a-z_]+)"/g),
  ...matchAll(uiText, /input\('(?:payment|fee)',\s*index,\s*'([a-z_]+)'/g),
]);
const settlementHandler = appTs.slice(appTs.indexOf('function onSettlementField('), appTs.indexOf('async function saveSettlement('));
for (const field of settlementFields) {
  if (!settlementHandler.includes(`field === '${field}'`)) problems.push(`[付款字段未处理] ${field} 没有对应处理分支`);
}
const customerDomain = read(join(root, 'src/domain/customer-quote.ts'));
const customerFields = new Set([...matchAll(uiText, /data-customer-field="([a-z_]+)"/g), ...matchAll(customerDomain, /^\s+([a-z_]+): string;/gm)]);
for (const field of customerFields) {
  if (field === 'reviewed' ? !appTs.includes("field === 'reviewed'") : !customerDomain.includes(`'${field}'`) || !appTs.includes('CUSTOMER_QUOTE_FIELDS.some')) problems.push(`[客户字段未处理] ${field} 没有对应处理分支`);
}
const handledContractFields = matchAll(appTs, /field === '([a-z_]+)'/g);
for (const field of contractFields) {
  if (!handledContractFields.has(field)) problems.push(`[合同字段未处理] ${field} 没有对应处理分支`);
}
const logisticsFields = new Set([
  ...matchAll(uiText, /data-logistics-field="([a-z_.]+)"/g),
  ...matchAll(uiText, /textField\('(?:transport|insurance)',\s*'([a-z_.]+)'/g),
]);
const logisticsHandler = appTs.slice(appTs.indexOf('function onLogisticsField('), appTs.indexOf('function addTransportSegment('));
const handledLogisticsFields = matchAll(logisticsHandler, /'([a-z_.]+)'/g);
for (const field of logisticsFields) if (!handledLogisticsFields.has(field)) problems.push(`[物流字段未处理] ${field} 没有对应处理分支`);
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
  'goods.trade_value_basis',
  'quote.amount',
  'quote.currency',
  'quote.fx_type',
  'quote.fx_date',
  'evaluation_date', '${prefix}.amount', '${prefix}.currency', '${prefix}.fx_type', '${prefix}.fx_date', '${prefix}.named_place',
  'incoterm',
  'anchor.kind',
  'anchor.buyer_total',
  'anchor.currency',
  'anchor.margin_rate',
  'facts.delivery_place',
  'facts.loading_mode',
  'facts.shipping_terms',
  'facts.clearance_agent',
  'tax_profile.import.hsTable.basis',
  'tax_profile.import.calculationMode',
  'tax_profile.import.declarationDate',
  'tax_profile.import.dutyRates.fallback',
  'tax_profile.import.vatRate',
  'tax_profile.import.consumptionTax.rate',
  'tax_profile.import.vatDeductibleForBuyer',
  'route.export_country', 'route.import_country', 'route.origin_country', 'route.customs_regime',
  'tax_profile.import.eligibility.agreement_name', 'tax_profile.import.eligibility.vat_taxpayer', 'tax_profile.import.eligibility.vat_use',
]);
for (const path of matchAll(uiText, /data-path="([^"]+)"/g)) {
  if (!projectPaths.has(path)) problems.push(`[路径可疑] data-path="${path}" 不在已知的项目字段清单里，确认它真的存在`);
}

// ---------- 汇总 ----------
if (problems.length === 0) {
  console.log('静态审查通过：没有发现未处理的字段/动作、未使用的错误码或告警码。');
} else {
  process.exitCode = 1;
  console.log(`静态审查发现 ${problems.length} 项：`);
  for (const problem of problems) console.log(`  · ${problem}`);
}

console.log('');
console.log(`统计：错误码 ${declaredErrors.size} 个（抛出 ${thrownErrors.size}）、告警码 ${declaredWarnings.size} 个（发出 ${emittedWarnings.size}）`);
console.log(`      界面字段 ${renderedFields.size} 个、动作 ${renderedActions.size} 个、data-path ${matchAll(uiText, /data-path="([^"]+)"/g).size} 个`);
