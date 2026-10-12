import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const root = process.env.BROWSER_CHECK_OUTPUT ?? join(tmpdir(), 'cocudtt-explanations');
await mkdir(root, { recursive: true });
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
let fixture, ddp;
try {
  const { logisticsProject } = await server.ssrLoadModule('/tests/fixtures/logistics-project.ts'); fixture = logisticsProject();
  const { chinaImportSampleProjectFile } = await server.ssrLoadModule('/src/data/sample-project.ts'); ddp = chinaImportSampleProjectFile(); ddp.incoterm = 'DDP'; ddp.tax_profile.import.vatDeductibleForBuyer = true;
} finally { await server.close(); }
const rounding = JSON.parse(await readFile(resolve('tests/fixtures/import-cases/consumption-rounding.project.json'), 'utf8'));
const dualFx = JSON.parse(await readFile(resolve('tests/fixtures/import-cases/cif-dual-fx.project.json'), 'utf8'));
const targets = await (await fetch(`http://127.0.0.1:${process.env.BROWSER_CHECK_PORT ?? '9356'}/json`)).json();
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0; const pending = new Map(), exceptions = [];
ws.onmessage = event => {
  const response = JSON.parse(event.data);
  if (response.method === 'Runtime.exceptionThrown') exceptions.push(response.params.exceptionDetails.text);
  const request = pending.get(response.id);
  if (request) { pending.delete(response.id); response.error ? request.reject(new Error(JSON.stringify(response.error))) : request.resolve(response.result); }
};
const call = (method, params = {}) => new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); ws.send(JSON.stringify({ id: next, method, params })); });
async function evaluate(expression) {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function until(expression) { for (let n = 0; n < 80; n++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); } throw new Error(expression); }
async function upload(project) {
  await evaluate(`(async()=>{const input=document.querySelector('#file-input'),data=new DataTransfer();data.items.add(new File([${JSON.stringify(JSON.stringify(project))}],'synthetic-explanation.json',{type:'application/json'}));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,150));})()`);
}
try {
  await call('Runtime.enable'); await call('Page.enable');
  await call('Page.navigate', { url: pathToFileURL(resolve('trade-cost-engine.html')).href });
  await until("!!document.querySelector('#file-input')"); await upload(fixture);
  const checks = {};
  checks.initial = await evaluate(`document.querySelectorAll('[data-visualization]').length===4&&document.querySelector('[data-visualization="seller-fees"]').innerText.includes('700.00')&&document.querySelector('[data-visualization="buyer-payment"]').innerText.includes('12,695.55')&&document.querySelector('[data-visualization="customs-base"]').innerText.includes('10,700.00')`);
  await evaluate(`document.querySelector('[data-evidence-section="calculation-import-tax"] summary').focus()`);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  checks.keyboard = await evaluate(`document.querySelector('[data-evidence-section="calculation-import-tax"]').open`);
  await evaluate(`document.querySelector('[data-evidence-section="reasoning-seller-freight"]').open=true`);
  await new Promise(r => setTimeout(r, 100));
  checks.reasoning = await evaluate(`document.querySelector('[data-reasoning="seller-freight"]').innerText.includes('术语规则 · 命中')&&document.querySelector('[data-reasoning="seller-freight"]').innerText.includes('汇总去向：计入卖方费用')`);
  await evaluate(`const amount=document.querySelector('[data-item="seller-freight"][data-item-field="amount"]');amount.value='800';amount.dispatchEvent(new Event('change',{bubbles:true}))`);
  checks.recalculation = await evaluate(`document.querySelector('[data-visualization="seller-fees"]').innerText.includes('900.00')&&document.querySelector('[data-visualization="customs-base"]').innerText.includes('10,900.00')&&document.querySelector('[data-visualization="buyer-payment"]').innerText.includes('12,732.85')&&document.querySelector('[data-calculation="vat-raw"]').innerText.includes('(10900 + 545 + 0) × 0.13')`);
  checks.openState = await evaluate(`document.querySelector('[data-evidence-section="calculation-import-tax"]').open&&document.querySelector('[data-evidence-section="reasoning-seller-freight"]').open`);
  await evaluate(`document.querySelector('[data-evidence-section="calculation-totals"]').open=true`);
  checks.unknownProfit = await evaluate(`document.querySelector('[data-calculation="profit"]').innerText.includes('未知')&&document.querySelector('[data-calculation="profit"]').innerText.includes('无法计算')`);
  const layouts = [];
  await evaluate(`document.querySelectorAll('details').forEach(e=>e.open=true)`);
  for (const width of [1440, 768, 390, 320]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    layouts.push(await evaluate(`({viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth,barWidthsValid:[...document.querySelectorAll('.chart-bar')].every(e=>{const v=parseFloat(e.style.width);return Number.isFinite(v)&&v>=0&&v<=100})})`));
    await evaluate(`document.querySelector('[data-visualization="buyer-payment"]').scrollIntoView()`);
    await writeFile(join(root, `explanation-${width}.png`), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  }
  // 1440px浏览器200%缩放的布局等效宽度；另核对实际大字体换行，均不声称真实手机验收。
  await call('Emulation.setDeviceMetricsOverride', { width: 720, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.documentElement.style.fontSize='200%'`);
  checks.enlargedText = await evaluate(`document.documentElement.scrollWidth<=document.documentElement.clientWidth`);
  await evaluate(`document.documentElement.style.fontSize=''`);
  await upload(rounding);
  checks.rounding = await evaluate(`document.querySelector('[data-calculation="vat-raw"]').textContent.includes('(1234.56 + 61.73 + 144.03) × 0.13')&&document.querySelector('[data-visualization="buyer-payment"]').textContent.includes('1,627.56')`);
  await upload(dualFx);
  checks.dualFx = await evaluate(`document.querySelector('[data-calculation="goods-value"]').textContent.includes('100000 × 7.08')&&document.querySelector('[data-calculation="quote"]').textContent.includes('108300 × 7')&&document.querySelector('[data-visualization="customs-base"]').textContent.includes('766,764.00')`);
  await upload(ddp);
  checks.ddp = await evaluate(`const rows=[...document.querySelectorAll('[data-visualization="buyer-payment"] .chart-rows li')].filter(e=>e.textContent.includes('承担'));rows.length===3&&rows.every(e=>e.dataset.chartAmount==='0')`);
  const negative = structuredClone(fixture);
  negative.items.push({ ...negative.items[0], cost_id: 'refund', cost_name: '合成退款', applicable_incoterms: ['CIP'], alternative_group: undefined, cost_category: 'IMPORT_CLEARANCE', trade_node: 'IMPORT_CLEARANCE', amount: '-10' });
  await upload(negative);
  checks.negative = await evaluate(`document.querySelector('[data-visualization="buyer-payment"]').textContent.includes('冲减')&&document.querySelector('[data-visualization="buyer-payment"]').textContent.includes('-10.00')`);
  await upload(fixture);
  const reportSaved = await evaluate(`(async()=>{let report='';window.showSaveFilePicker=async()=>({name:'explanation.html',createWritable:async()=>({write:async text=>{report=text},close:async()=>{}})});document.querySelector('[data-action="export-report"]').click();await new Promise(r=>setTimeout(r,150));window.__explanationReport=report;return report.includes('data-calculation="buyer-total"')&&report.includes('费用与税基可视化')&&report.includes('术语规则 · 命中')&&report.includes('12,695.55')&&!report.includes('<script')})()`);
  checks.report = reportSaved;
  const reportHtml = await evaluate('window.__explanationReport');
  await writeFile(join(root, 'example-internal-report.html'), reportHtml);
  await writeFile(join(root, 'explanation-example.json'), JSON.stringify(fixture, null, 2));
  await call('Page.navigate', { url: pathToFileURL(join(root, 'example-internal-report.html')).href });
  await until(`!!document.querySelector('[data-visualization]')`);
  checks.reportOpen = await evaluate(`document.querySelectorAll('.calculation-group').length===4&&[...document.querySelectorAll('.calculation-group')].every(e=>e.open)&&document.querySelectorAll('script,iframe,form').length===0&&document.documentElement.scrollWidth<=document.documentElement.clientWidth`);
  const report = { checks, layouts, exceptions, browser: 'Microsoft Edge', protocol: 'file://', saveUsesApiSubstitute: true, actualMobileVerified: false, realPrintPaginationVerified: false, actualBrowserZoomVerified: false };
  await writeFile(join(root, 'explanation-browser-report.json'), JSON.stringify(report, null, 2));
  if (Object.values(checks).some(v => v !== true) || layouts.some(l => l.content > l.viewport || !l.barWidthsValid) || exceptions.length) throw new Error(JSON.stringify(report));
  console.log(JSON.stringify(report, null, 2));
} finally { ws.close(); }
