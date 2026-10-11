import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const root = process.env.BROWSER_CHECK_OUTPUT ?? join(tmpdir(), 'cocudtt-browser-check');
await mkdir(root, { recursive: true });
const port = process.env.BROWSER_CHECK_PORT ?? '9317';
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
const exceptions = [];
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
  const request = pending.get(message.id);
  if (request) {
    pending.delete(message.id);
    message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
  }
};
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const request = ++id;
    pending.set(request, { resolve, reject });
    ws.send(JSON.stringify({ id: request, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(expression) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`页面状态未满足: ${expression}`);
}
try {
  await call('Runtime.enable');
  await call('Page.enable');
  // Runtime.enable会重放当前旧页面异常，只检查本次导航后的异常。
  exceptions.length = 0;
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: pathToFileURL(resolve(import.meta.dirname, '../trade-cost-engine.html')).href });
  await until("!!document.querySelector('[data-action=\"new-china-import\"]')");
  await evaluate("document.querySelector('[data-action=\"new-china-import\"]').click()");
  await until("document.body.innerText.includes('901,101.49')");
  const sampleReferenceOnly = await evaluate("document.body.innerText.includes('当前没有可参与排名的方案') && document.body.innerText.includes('参考测算，仍待核对')");
  if (!sampleReferenceOnly) throw new Error('示例应排除排名');
  const sourceFlow = await evaluate(`(async () => {
    const setField = (owner, id, field, value) => {
      const element = [...document.querySelectorAll('[data-evidence-owner]')].find(e => e.dataset.evidenceOwner === owner && e.dataset.evidenceId === id && e.dataset.evidenceField === field);
      if (!element) throw new Error('找不到来源字段 ' + owner + ':' + id + ':' + field);
      element.value = value; element.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const groups = [...document.querySelectorAll('details.source-editor')].filter(e => e.dataset.evidenceSection.startsWith('tax:') || e.dataset.evidenceSection.startsWith('fx:') || e.dataset.evidenceSection.startsWith('duty-eligibility:')).map(e => e.dataset.evidenceSection);
    for (const section of groups) {
      const [owner, ...ids] = section.split(':'); const id = ids.join(':');
      [...document.querySelectorAll('details.source-editor')].find(e => e.dataset.evidenceSection === section).open = true;
      await new Promise(resolve => setTimeout(resolve, 50));
      for (const [field, value] of Object.entries({ reference: '用于浏览器验证的合成核对记录', valid_from: '2026-08-01', valid_to: '2026-09-30', checked_on: '2026-10-11', status: 'USER_CONFIRMED' })) setField(owner, id, field, value);
      if (![...document.querySelectorAll('details.source-editor')].find(e => e.dataset.evidenceSection === section).open) throw new Error('编辑后来源面板意外关闭');
    }
    const confirmed = document.body.innerText.includes('符合当前排名检查条件') && !document.body.innerText.includes('当前没有可参与排名的方案');
    const sellerCostInput = document.querySelector('[data-path="goods.seller_goods_cost.amount"]');
    sellerCostInput.value = ''; sellerCostInput.dispatchEvent(new Event('change', { bubbles: true }));
    const unknownSellerCost = document.body.innerText.includes('无法评估') && document.body.innerText.includes('901,101.49') && document.body.innerText.includes('可排名方案中买方总支付最低') && !document.body.innerText.includes('可排名方案中卖方利润最高');
    const rateInput = document.querySelector('[data-fx][data-fx-field="rate"]');
    const rateBefore = rateInput.value; const rowId = rateInput.dataset.fx;
    rateInput.value = '7.01'; rateInput.dispatchEvent(new Event('change', { bubbles: true }));
    const invalidated = document.body.innerText.includes('当前没有可参与排名的方案') && JSON.parse(localStorage.getItem('trade-cost-engine:draft-v1')).fxRows.find(row => row.row_id === rowId).evidence.status === 'UNVERIFIED';
    const restoredInput = [...document.querySelectorAll('[data-fx][data-fx-field="rate"]')].find(e => e.dataset.fx === rowId);
    restoredInput.value = rateBefore; restoredInput.dispatchEvent(new Event('change', { bubbles: true }));
    setField('fx', rowId, 'status', 'USER_CONFIRMED');
    const restored = document.body.innerText.includes('符合当前排名检查条件');
    const setPath = (path, value, checked = false) => {
      const element = document.querySelector('[data-path="' + path + '"]');
      element.value = value; element.checked = checked; element.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setPath('route.origin_country', '法国（浏览器合成案例）');
    const originInvalidated = document.body.innerText.includes('当前没有可参与排名的方案') && JSON.parse(localStorage.getItem('trade-cost-engine:draft-v1')).project.tax_profile.import.eligibility.duty_evidence.status === 'UNVERIFIED';
    setField('duty-eligibility', '', 'status', 'USER_CONFIRMED');
    const originReconfirmed = document.body.innerText.includes('符合当前排名检查条件');
    setPath('route.import_country', '德国');
    const wrongCountryBlocked = document.body.innerText.includes('当前没有可参与排名的方案') && document.querySelector('#app').textContent.includes('不属于当前中国进口模型范围');
    setPath('route.import_country', '中国'); setField('duty-eligibility', '', 'status', 'USER_CONFIRMED');
    setPath('tax_profile.import.vatDeductibleForBuyer', '', true);
    const deductionBlocked = document.body.innerText.includes('当前没有可参与排名的方案');
    setPath('tax_profile.import.eligibility.vat_taxpayer', 'GENERAL');
    setPath('tax_profile.import.eligibility.vat_use', 'TAXABLE_BUSINESS');
    for (const [field, value] of Object.entries({ reference: '浏览器合成身份与凭证记录', valid_from: '2026-08-01', valid_to: '2026-09-30', checked_on: '2026-10-11', status: 'USER_CONFIRMED' })) setField('vat-eligibility', '', field, value);
    const deductionConfirmed = document.body.innerText.includes('符合当前排名检查条件');
    let reportHtml = '';
    const draftBeforeReport = localStorage.getItem('trade-cost-engine:draft-v1');
    window.showSaveFilePicker = async () => ({ name: 'browser-report.html', createWritable: async () => ({ write: async value => { reportHtml = value; }, close: async () => {} }) });
    document.querySelector('[data-action="export-report"]').click();
    await new Promise(resolve => setTimeout(resolve, 150));
    const reportExported = reportHtml.includes('901,101.49') && reportHtml.includes('无法评估') && reportHtml.includes('完整项目输入快照') && !reportHtml.includes('<script') && localStorage.getItem('trade-cost-engine:draft-v1') === draftBeforeReport;
    window.__verifiedReport = reportHtml;
    setPath('tax_profile.import.eligibility.vat_use', 'OTHER');
    const useInvalidated = document.body.innerText.includes('当前没有可参与排名的方案') && JSON.parse(localStorage.getItem('trade-cost-engine:draft-v1')).project.tax_profile.import.eligibility.vat_evidence.status === 'UNVERIFIED';
    setPath('tax_profile.import.eligibility.vat_use', 'TAXABLE_BUSINESS'); setField('vat-eligibility', '', 'status', 'USER_CONFIRMED');
    let saved = '';
    window.showSaveFilePicker = async () => ({ name: 'browser-verified.json', createWritable: async () => ({ write: async value => { saved = value; }, close: async () => {} }) });
    document.querySelector('[data-action="save"]').click();
    await new Promise(resolve => setTimeout(resolve, 150));
    const file = JSON.parse(saved);
    const persisted = file.schema_version === '0.5' && file.tax_profile.import.rateEvidence.status === 'USER_CONFIRMED' && file.tax_profile.import.eligibility.duty_evidence.values_key && file.route.origin_country && file.fx_books.every(book => book.evidence['USD/CNY'].values_key);
    const transfer = new DataTransfer(); transfer.items.add(new File([saved], 'browser-verified.json', { type: 'application/json' }));
    const input = document.querySelector('#file-input'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 150));
    return { groups: groups.length, confirmed, unknownSellerCost, invalidated, restored, originInvalidated, originReconfirmed, wrongCountryBlocked, deductionBlocked, deductionConfirmed, reportExported, useInvalidated, persisted: !!persisted, reopened: document.body.innerText.includes('符合当前排名检查条件') && document.body.innerText.includes('无法评估'), panelStayedOpen: true };
  })()`);
  if (Object.values(sourceFlow).some(value => value === false)) throw new Error(JSON.stringify(sourceFlow));
  const verifiedReport = await evaluate('window.__verifiedReport');
  await writeFile(join(root, 'import-report-example.html'), verifiedReport);
  const desktop = await evaluate("({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, mode: document.body.innerText.includes('中国一般贸易进口 · CNY'), quote: document.body.innerText.includes('901,101.49') })");
  const image = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(root, 'china-import-desktop.png'), Buffer.from(image.data, 'base64'));
  await evaluate("var dateField = document.querySelector('[data-path=\"tax_profile.import.declarationDate\"]'); dateField.value = '2026-10-01'; dateField.dispatchEvent(new Event('change', {bubbles: true}))");
  await until("document.body.innerText.includes('FX_MISSING') && document.body.innerText.includes('无法计算')");
  await evaluate("var dateField = document.querySelector('[data-path=\"tax_profile.import.declarationDate\"]'); dateField.value = '2026-09-10'; dateField.dispatchEvent(new Event('change', {bubbles: true}))");
  await until("document.body.innerText.includes('901,101.49')");
  const badFile = await evaluate(`(async () => {
    const before = localStorage.getItem('trade-cost-engine:draft-v1');
    const broken = JSON.parse(before).project; broken.fx_books = null;
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(broken)], 'broken.json', { type: 'application/json' }));
    const input = document.querySelector('#file-input'); input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { error: document.body.innerText.includes('PROJECT_PARSE_FAILED'), unchanged: localStorage.getItem('trade-cost-engine:draft-v1') === before, keptResult: document.body.innerText.includes('901,101.49') };
  })()`);
  if (!badFile.error || !badFile.unchanged || !badFile.keptResult) throw new Error('坏文件处理验证失败');
  const blankWorkflow = await evaluate(`(async () => {
    document.querySelector('[data-action="new-china-blank"]').click();
    const blank = JSON.parse(localStorage.getItem('trade-cost-engine:draft-v1')).project;
    const empty = blank.goods.trade_value.amount === '' && blank.quote.amount === '' && blank.fx_books.length === 0 && blank.items.length === 0 && blank.tax_profile.import.vatRate === '' && blank.route.origin_country === '';
    const change = (path, value) => { const element = document.querySelector('[data-path="' + path + '"]'); element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); };
    for (const [path, value] of Object.entries({ name:'浏览器合成空白录入案例', 'goods.name':'合成商品', 'goods.quantity':'1', 'goods.unit':'KG', 'goods.trade_value.amount':'10000', 'goods.trade_value_basis':'NET', 'quote.amount':'10500', 'tax_profile.import.declarationDate':'2026-09-10', 'tax_profile.import.dutyRates.fallback':'0.05', 'tax_profile.import.vatRate':'0.13' })) change(path,value);
    const add = document.querySelector('[data-action="add-preset"]'); add.value = 'ocean-freight'; add.dispatchEvent(new Event('change',{bubbles:true}));
    const first = JSON.parse(localStorage.getItem('trade-cost-engine:draft-v1')).project.items[0];
    const feeStartsEmpty = first.amount === '' && document.body.innerText.includes('无法计算');
    const freight = document.querySelector('[data-item="' + first.cost_id + '"][data-item-field="amount"]'); freight.value = '500'; freight.dispatchEvent(new Event('change',{bubbles:true}));
    const addInsurance = document.querySelector('[data-action="add-preset"]'); addInsurance.value = 'cargo-insurance'; addInsurance.dispatchEvent(new Event('change',{bubbles:true}));
    const insurance = JSON.parse(localStorage.getItem('trade-cost-engine:draft-v1')).project.items[1];
    const method = document.querySelector('[data-item="' + insurance.cost_id + '"][data-item-field="pricing_method"]'); method.value = 'ACTUAL'; method.dispatchEvent(new Event('change',{bubbles:true}));
    const insuranceAmount = document.querySelector('[data-item="' + insurance.cost_id + '"][data-item-field="amount"]'); insuranceAmount.value = '0'; insuranceAmount.dispatchEvent(new Event('change',{bubbles:true}));
    const calculated = document.body.innerText.includes('12,458.25') && document.body.innerText.includes('无法评估') && !document.querySelector('#app').textContent.includes('QUOTE_NOT_RECONCILED');
    change('goods.trade_value_basis','INCLUDES_FREIGHT_INSURANCE');
    const bundledBlocked = document.body.innerText.includes('无法计算') && document.body.innerText.includes('先拆出货物净价');
    change('goods.trade_value_basis','NET');
    const recovered = document.body.innerText.includes('12,458.25');
    return { empty, feeStartsEmpty, calculated, bundledBlocked, recovered };
  })()`);
  if (Object.values(blankWorkflow).some(value => value === false)) throw new Error(JSON.stringify(blankWorkflow));
  await evaluate("document.querySelector('[data-action=\"new-china-import\"]').click()");
  await evaluate("var vat = document.querySelector('[data-path=\"tax_profile.import.vatDeductibleForBuyer\"]'); vat.checked = true; vat.dispatchEvent(new Event('change', {bubbles:true}));");
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate("document.querySelectorAll('details').forEach(e => { e.open = true; })");
  const mobile = await evaluate("({ width: innerWidth, viewportWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, mode: document.body.innerText.includes('中国一般贸易进口 · CNY'), quote: document.body.innerText.includes('901,101.49'), overflow: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).map(e => ({tag:e.tagName, cls:e.className, right:e.getBoundingClientRect().right, text:e.innerText?.slice(0,70)})).slice(0,12) })");
  const mobileImage = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(root, 'china-import-mobile.png'), Buffer.from(mobileImage.data, 'base64'));
  await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 844, deviceScaleFactor: 1, mobile: true });
  const narrow = await evaluate("({ viewportWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).map(e => ({tag:e.tagName, cls:e.className, right:e.getBoundingClientRect().right, text:e.innerText?.slice(0,70)})).slice(0,12) })");
  const report = { desktop, mobile, narrow, badFile, sampleReferenceOnly, sourceFlow, blankWorkflow, sourcePanelsExpandedOnMobile: true, expiredFxBlocks: true, recoveredAfterDateCorrection: true, exceptions, protocol: 'file://', browser: 'Microsoft Edge' };
  await writeFile(join(root, 'china-import-browser-report.json'), JSON.stringify(report, null, 2));
  if (desktop.scrollWidth > desktop.width || mobile.scrollWidth > mobile.viewportWidth || narrow.scrollWidth > narrow.viewportWidth || exceptions.length) throw new Error(JSON.stringify(report));
  console.log(JSON.stringify(report, null, 2));
} finally {
  ws.close();
}
