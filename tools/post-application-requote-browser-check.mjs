import {readRuntimeFeeBackup} from './runtime-fee-backup-reader.mjs';
import {withDocumentNavigation} from './browser-document.mjs';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'vite';
import {unzipSync, strFromU8} from 'fflate';
import {PDFDocument} from 'pdf-lib';

const out = resolve(process.env.BROWSER_CHECK_OUTPUT ?? 'browser-results/post-application-requote');
const downloads = join(out, 'downloads', String(Date.now()));
await mkdir(downloads, {recursive: true});
const server = await createServer({configFile: false, optimizeDeps: {noDiscovery: true, include: []}, server: {middlewareMode: true}, appType: 'custom'});
let fixture, rows, parsers;
try {
  fixture = await (await server.ssrLoadModule('/tests/fixtures/fee-transaction.ts')).transactionFixture();
  rows = (await server.ssrLoadModule('/src/ui/fx-rows.ts')).booksToRows(fixture.pair.project.fx_books);
  parsers = {
    project: (await server.ssrLoadModule('/src/data/project-file.ts')).parseProject,
    bill: (await server.ssrLoadModule('/src/data/container-bill-file.ts')).parseContainerBillDraft,
    pair: (await server.ssrLoadModule('/src/data/container-cost-pair.ts')).parseContainerCostPair,
    attachment: (await server.ssrLoadModule('/src/data/fee-tax-attachment.ts')).parseFeeTaxAttachment,
    precision: (await server.ssrLoadModule('/src/data/fee-precision-selection.ts')).parseFeePrecisionSelection,
    envelope: (await server.ssrLoadModule('/src/data/fee-envelope.ts')).parseFeeEnvelope,
  };
} finally { await server.close(); }
const targets = await (await fetch(`http://127.0.0.1:${process.env.BROWSER_CHECK_PORT ?? '9457'}/json`)).json();
const target = targets.find(t => t.type === 'page' && !t.url.startsWith('edge:'));
if (!target) throw Error('Dedicated browser required');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
let serial = 0;
const pending = new Map(), checks = {}, layouts = [], exceptions = [], requests = [];
ws.onclose = e => { for (const p of pending.values()) p.reject(Error('CDP closed ' + e.code)); pending.clear(); };
ws.onmessage = e => {
  const r = JSON.parse(e.data);
  if (r.method === 'Runtime.exceptionThrown') exceptions.push(r.params.exceptionDetails.text);
  if (r.method === 'Network.requestWillBeSent') requests.push(r.params.request.url);
  if (r.method === 'Page.javascriptDialogOpening') void send('Page.handleJavaScriptDialog', {accept: true});
  const p = pending.get(r.id);
  if (p) { pending.delete(r.id); r.error ? p.reject(Error(JSON.stringify(r.error))) : p.resolve(r.result); }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++serial; pending.set(id, {resolve, reject}); ws.send(JSON.stringify({id, method, params}));
});
const call = withDocumentNavigation(send);
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function until(expression) {
  for (let i = 0; i < 300; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); }
  throw Error('Timeout ' + expression);
}
async function native(selector) {
  const point = await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e)throw Error('Missing '+${JSON.stringify(selector)}); for(let p=e.parentElement;p;p=p.parentElement)if(p instanceof HTMLDetailsElement)p.open=true; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return{x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', {type, button: 'left', clickCount: 1, ...point});
}
const action = key => native('[data-action="' + key + '"]');
async function field(selector, value) {
  await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e)throw Error('Missing field '+${JSON.stringify(selector)}); e.value=${JSON.stringify(value)}; e.dispatchEvent(new Event('change',{bubbles:true})); })()`);
}
async function upload(id, raw) {
  await evaluate(`(() => { const e=document.querySelector('#${id}'),d=new DataTransfer(); d.items.add(new File([${JSON.stringify(raw)}],'synthetic-handoff.json',{type:'application/json'})); e.files=d.files; e.dispatchEvent(new Event('change',{bubbles:true})); })()`);
}
async function adoptTax(raw) {
  await upload('fee-tax-file-input', raw); await until("!!document.querySelector('[data-action=fee-tax-adopt]')");
  await action('fee-tax-adopt'); await until("!document.querySelector('[data-action=fee-tax-adopt]')");
}
async function adoptPrecision(raw) {
  await upload('fee-precision-file-input', raw); await until("!!document.querySelector('[data-action=fee-precision-adopt]')");
  await action('fee-precision-adopt'); await action('fee-precision-confirm'); await until("!document.querySelector('[data-action=fee-precision-adopt]')");
}
async function adoptEnvelope(raw) {
  await upload('fee-envelope-file-input', raw); await until("!!document.querySelector('[data-fee-envelope-preview]')");
  for (const choice of await evaluate("[...document.querySelectorAll('[data-fee-envelope-choice]')].map(e=>e.dataset.feeEnvelopeChoice)")) await native('[data-fee-envelope-choice="' + choice + '"]');
  await action('fee-envelope-adopt'); await until("!document.querySelector('[data-fee-envelope-preview]')");
}
async function capture() {
  await evaluate("window.capture84=null; window.showSaveFilePicker=async o=>({name:o.suggestedName,createWritable:async()=>({write:async b=>{window.capture84=JSON.parse(await b.text())},close:async()=>{}})})");
  await action('fee-envelope-workbench-backup'); await until('!!window.capture84');
  return readRuntimeFeeBackup(await evaluate('window.capture84'));
}
const captureProject = c => JSON.parse(c.capture.sources.project_json);
const receipts = c => JSON.parse(JSON.parse(c.capture.envelope_json).ledger_json).receipt_refs;
async function apply() {
  await action('fee-envelope-workbench-preview'); await until("!!document.querySelector('[data-action=fee-envelope-workbench-arm]')");
  await action('fee-envelope-workbench-arm'); await native('[data-fee-envelope-choice="apply-batch"]');
  await action('fee-envelope-workbench-apply'); await until("!document.querySelector('[data-fee-workbench-confirmation]')&&!!document.querySelector('[data-fee-workflow-applied]')");
}
async function download(key, extension, name) {
  const folder = join(downloads, name); await mkdir(folder, {recursive: true});
  await send('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: folder});
  await evaluate('window.showSaveFilePicker=undefined'); await action(key);
  for (let i = 0; i < 300; i++) {
    const files = (await readdir(folder)).filter(p => p.endsWith('.' + extension));
    if (files.length === 1) return {name: files[0], bytes: await readFile(join(folder, files[0]))};
    await new Promise(r => setTimeout(r, 100));
  }
  throw Error('No actual download ' + key);
}
const url = process.env.FEE_REQUOTE_BROWSER_URL ?? pathToFileURL(resolve('trade-cost-engine.html')).href;
try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false});
  await call('Page.navigate', {url}); await until("document.readyState==='complete'&&!!document.querySelector('[data-fee-workflow-guide]')");
  if (await evaluate("!!document.querySelector('#onboarding-dialog[open]')")) await action('close-onboarding');
  await evaluate(`localStorage.clear();localStorage.setItem('trade-cost-engine:workspace-mode-v1','professional');localStorage.setItem('trade-cost-engine:onboarding-v1','hidden');localStorage.setItem('trade-cost-engine:draft-v1',${JSON.stringify(JSON.stringify({project: fixture.pair.project, fxRows: rows, pair_fx_row_key: JSON.stringify(rows)}))});localStorage.setItem('trade-cost-engine:container-bill-v1',${JSON.stringify(fixture.sources.bill_json)});localStorage.setItem('trade-cost-engine:container-cost-pair-v1',${JSON.stringify(fixture.sources.pair_json)});`);
  await call('Page.reload'); await until("document.readyState==='complete'&&!!document.querySelector('[data-fee-workflow-guide]')");
  await adoptTax(fixture.sources.attachment_json); await adoptPrecision(fixture.sources.precision_json); await adoptEnvelope(fixture.raw);
  await native('[data-customer-field="reviewed"]'); const before = await capture();
  checks.oldCustomerExplicitlyReviewed = JSON.parse(before.capture.retained_json).customer_reviewed === true;
  await apply(); const applied = await capture(), old = JSON.parse(applied.capture.sources.pair_json).mapping.entries[0];
  const oldTax = JSON.parse(applied.capture.sources.attachment_json).records[0], oldPrecision = JSON.parse(applied.capture.sources.precision_json).records[0];
  checks.firstApplyAddsOneFeeAndReceipt = captureProject(applied).items.length === captureProject(before).items.length + 1 && receipts(applied).length === 1;
  checks.applicationRevokesCustomerReview = JSON.parse(applied.capture.retained_json).customer_reviewed === false;
  await native('[data-action=pair-remove-selection][data-pair-line="' + old.line_id + '"]'); await action('bill-rebind');
  const billField = (key, value) => field('[data-bill-row="0"][data-bill-field="' + key + '"]', value);
  await billField('cost_reference.cost_id', old.cost_id); await billField('cost_reference.note', 'PRIVATE_REQUOTE84 已有费用只引用');
  for (const [key, value] of Object.entries({reference: 'PRIVATE_REQUOTE84 合成来源定位', valid_from: '2026-10-01', valid_to: '2026-10-31', checked_on: '2026-10-17'})) await billField('cost_source.' + key, value);
  await native('[data-action=bill-confirm-source][data-bill-row="0"]'); await native('[data-action=bill-confirm-reference][data-bill-row="0"]'); await action('pair-add-references');
  await action('fee-tax-rebind'); await action('fee-tax-confirm'); await until("document.querySelector('[data-fee-tax-host]').textContent.includes('ORPHAN_TARGET')");
  await native('[data-action=fee-tax-remove][data-fee-tax-record="' + oldTax.record_id + '"]'); await action('fee-tax-confirm');
  await until("document.querySelector('[data-fee-tax-host]').textContent.includes('附件暂无成分记录')");
  await action('fee-tax-add'); const mapping = JSON.parse((await capture()).capture.sources.pair_json).mapping.entries[0];
  await field('[data-fee-tax-field="target"]', mapping.mapping_id); await action('fee-tax-facts');
  const taxField = (key, value) => field('[data-fee-tax-field="' + key + '"]', value);
  await taxField('input.tax.kind', 'GROSS_RATE'); await taxField('input.tax.rate', '0.13');
  await taxField('input.credit.kind', 'NONE'); await taxField('input.credit.basis', '合成本次无抵扣调整');
  await taxField('input.customs.kind', 'NOT_ADDED'); await taxField('input.customs.basis', '合成本成分不加计');
  for (const facet of ['tax', 'credit', 'customs']) for (const [key, value] of Object.entries({provenance: 'USER_SUPPLIED', reference: 'PRIVATE_REQUOTE84 软件验收，非业务证明', valid_from: '2026-10-01', valid_to: '2026-10-31', checked_on: '2026-10-17'})) await taxField('sources.' + facet + '.' + key, value);
  await action('fee-tax-submit'); await until("!document.querySelector('[data-fee-tax-editor]')");
  const taxCapture = await capture(), tax = JSON.parse(taxCapture.capture.sources.attachment_json), record = tax.records[0];
  checks.newTaxIdentityAndRetiredOldId = record.record_id !== oldTax.record_id && tax.retired_record_ids.includes(oldTax.record_id);
  checks.newTargetExplicit = record.target.mapping_id === mapping.mapping_id && mapping.mapping_id !== old.mapping_id;
  checks.newTaxNeverInheritsConfirmation = Object.values(record.acknowledgements).every(v => v === null);
  for (const facet of ['tax', 'credit', 'customs']) await native('[data-action=fee-tax-ack][data-fee-tax-record="' + record.record_id + '"][data-fee-tax-facet="' + facet + '"]');
  await action('fee-precision-rebind'); await action('fee-precision-confirm'); await until("!document.querySelector('[data-fee-precision-host] .fee-precision-confirm')");
  await native('[data-action=fee-precision-remove][data-fee-precision-id="' + oldPrecision.record_id + '"]'); await action('fee-precision-confirm');
  await until("!document.querySelector('[data-fee-precision-host] .fee-precision-record')"); await action('fee-precision-add'); await action('fee-precision-start');
  const precisionField = (key, value) => field('[data-fee-precision-field="' + key + '"]', value);
  await precisionField('component_record_id', record.record_id); await precisionField('channel', 'cash'); await precisionField('choice.kind', 'ROUND');
  await precisionField('policy.unit', '0.01'); await precisionField('policy.mode', 'HALF_UP'); await precisionField('policy.basis', '合成原币不变核对');
  await action('fee-precision-submit'); await until("!document.querySelector('[data-fee-precision-editor]')");
  const precisionCapture = await capture(), precision = JSON.parse(precisionCapture.capture.sources.precision_json), policy = precision.records[0];
  checks.newPrecisionIdentityAndRetiredOldId = policy.record_id !== oldPrecision.record_id && precision.retired_record_ids.includes(oldPrecision.record_id);
  checks.newPolicyNeverInheritsConfirmation = policy.acknowledgement === null && policy.component_record_id === record.record_id;
  await action('fee-envelope-update'); await action('fee-envelope-confirm');
  await until("!document.querySelector('[data-fee-envelope-host] .fee-envelope-confirm')");
  await action('fee-envelope-workbench-preview'); await until("!!document.querySelector('[data-fee-workbench-result]')");
  checks.missingNewPolicyStillBlocks = await evaluate("document.querySelector('[data-fee-workbench-result]').dataset.status==='BLOCKED'&&!document.querySelector('[data-action=fee-envelope-workbench-arm]')");
  await native('[data-action=fee-precision-ack][data-fee-precision-id="' + policy.record_id + '"]');
  await action('fee-envelope-update'); await action('fee-envelope-confirm');
  await until("!document.querySelector('[data-fee-envelope-host] .fee-envelope-confirm')");
  await action('fee-envelope-workbench-preview'); await until("!!document.querySelector('[data-action=fee-envelope-workbench-arm]')");
  const ready = await capture();
  checks.editingRecordsNeverChangesProject = ready.capture.sources.project_json === applied.capture.sources.project_json;
  checks.firstReceiptRetainedBeforeReference = JSON.stringify(receipts(ready)) === JSON.stringify(receipts(applied));
  checks.onlyReferenceCandidate = await evaluate("document.querySelector('[data-fee-workbench-result]').textContent.includes('拟新增 0 笔费用、记录 1 笔已有费用引用')");
  checks.unknownProfitNotZero = await evaluate("document.querySelector('[data-fee-workbench-candidate]').textContent.includes('未知 → 未知')");
  await action('fee-envelope-workbench-arm'); await native('[data-fee-envelope-choice="apply-batch"]'); await action('fee-envelope-workbench-apply');
  await until("!document.querySelector('[data-fee-workbench-confirmation]')"); const referenced = await capture();
  checks.referenceNoDuplicateFee = referenced.capture.sources.project_json === applied.capture.sources.project_json;
  checks.referenceAddsOneReceiptRetainsOriginal = receipts(referenced).length === 2 && JSON.stringify(receipts(referenced)[0]) === JSON.stringify(receipts(applied)[0]);
  checks.customerStillNeedsReview = JSON.parse(referenced.capture.retained_json).customer_reviewed === false && await evaluate("document.querySelector('[data-action=export-customer-quote]').disabled");
  const formal = {};
  for (const [key, button] of [['project', 'save'], ['bill', 'bill-save'], ['pair', 'pair-save'], ['attachment', 'fee-tax-save'], ['precision', 'fee-precision-save'], ['envelope', 'fee-envelope-save']]) {
    const saved = await download(button, 'json', key); formal[key] = saved.bytes.toString('utf8'); await parsers[key](formal[key]);
    if (formal[key] !== (key === 'envelope' ? referenced.capture.envelope_json : referenced.capture.sources[key + '_json'])) throw Error('Actual file differs ' + key);
  }
  checks.sixActualFormalDownloadsMatchCurrentBytes = true;
  checks.savedRetiredIdsAndTwoReceipts = JSON.parse(formal.attachment).retired_record_ids.includes(oldTax.record_id) && JSON.parse(formal.precision).retired_record_ids.includes(oldPrecision.record_id) && JSON.parse(JSON.parse(formal.envelope).ledger_json).receipt_refs.length === 2;
  await field('[data-customer-field="reference"]', 'PUBLIC_REQUOTE84'); await field('[data-customer-field="payment_terms"]', 'PUBLIC_PAYMENT84 按双方约定');
  await native('[data-customer-field="reviewed"]'); checks.explicitNewCustomerReview = await evaluate("document.querySelector('[data-customer-field=reviewed]').checked&&!document.querySelector('[data-action=export-customer-quote]').disabled");
  const customerBefore = await capture(), html = await download('export-customer-quote', 'html', 'customer-html');
  const excel = await download('export-customer-xlsx', 'xlsx', 'customer-xlsx'), pdf = await download('export-customer-pdf', 'pdf', 'customer-pdf');
  const htmlText = html.bytes.toString('utf8'), excelText = Object.values(unzipSync(excel.bytes)).map(v => strFromU8(v)).join('\n'), doc = await PDFDocument.load(pdf.bytes);
  checks.actualCustomerHtmlAndExcelPublicFields = htmlText.includes('PUBLIC_REQUOTE84') && htmlText.includes('PUBLIC_PAYMENT84') && excelText.includes('PUBLIC_REQUOTE84') && excelText.includes('PUBLIC_PAYMENT84');
  checks.internalSourcesAndLedgerExcluded = !/PRIVATE_REQUOTE84|retired_record_ids|receipt_refs|seller_goods_cost/.test(htmlText + excelText);
  checks.actualCustomerPdfValid = pdf.bytes.subarray(0, 5).toString() === '%PDF-' && doc.getPageCount() > 0 && !/PRIVATE_REQUOTE84/.test(doc.getTitle() ?? '');
  checks.customerContractQuoteUnchanged = JSON.stringify(captureProject(before).term_scenarios) === JSON.stringify(captureProject(referenced).term_scenarios);
  const customerAfter = await capture();
  checks.exportKeepsProjectReceiptAndReview = customerAfter.capture.sources.project_json === customerBefore.capture.sources.project_json && customerAfter.capture.envelope_json === customerBefore.capture.envelope_json && JSON.parse(customerAfter.capture.retained_json).customer_reviewed === true;
  const reminder = await evaluate("document.querySelector('[data-fee-workflow-applied]').textContent");
  checks.fiveManualHandoffSteps = await evaluate("document.querySelectorAll('[data-fee-workflow-requote] li').length===5");
  for (const width of [1440, 768, 390, 320]) {
    await send('Emulation.setDeviceMetricsOverride', {width, height: 1000, deviceScaleFactor: 1, mobile: width < 701});
    await native('[data-fee-workflow-target="guide"]'); await native('[data-fee-workflow-requote] > summary');
    await evaluate("document.querySelector('[data-fee-workflow-requote]').open=true;document.querySelector('[data-fee-workflow-requote]').scrollIntoView({block:'start'})");
    layouts.push(await evaluate(`({width:${width},viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth,buttonHeight:document.querySelector('[data-action=download-fee-exercises]').getBoundingClientRect().height})`));
    await writeFile(join(out, 'requote-' + width + '.png'), Buffer.from((await send('Page.captureScreenshot', {format: 'png'})).data, 'base64'));
    if (width < 701) await action('close-mobile-settings');
  }
  await send('Emulation.setDeviceMetricsOverride', {width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await upload('file-input', formal.project); await until("!document.querySelector('[data-customer-field=reviewed]').checked");
  await upload('bill-file-input', formal.bill); await upload('pair-file-input', formal.pair);
  await until(`document.querySelector('[data-path=name]').value===${JSON.stringify(captureProject(referenced).name)}`);
  await adoptTax(formal.attachment); await adoptPrecision(formal.precision); await adoptEnvelope(formal.envelope);
  const reopened = await capture();
  checks.sixOriginalInputsReopenSavedFiles = Object.entries(formal).filter(([k]) => k !== 'envelope').every(([k, raw]) => reopened.capture.sources[k + '_json'] === raw);
  checks.reopenPreservesTwoReceipts = JSON.stringify(receipts(reopened)) === JSON.stringify(receipts(referenced));
  checks.reopenResetsCustomerFieldsAndReview = await evaluate("document.querySelector('[data-customer-field=reference]').value===''&&!document.querySelector('[data-customer-field=reviewed]').checked&&document.querySelector('[data-action=export-customer-quote]').disabled");
  // Same-page re-open retains the real historical application; a fresh load must
  // not infer a new local application from the saved receipt or cache alone.
  checks.samePageReopenKeepsHistoricalReminder = await evaluate("document.querySelector('[data-fee-workflow-applied]').textContent") === reminder;
  await call('Page.reload'); await until("document.readyState==='complete'&&!!document.querySelector('[data-fee-workflow-guide]')");
  checks.freshLoadDoesNotInventApplicationReminder = await evaluate("!document.querySelector('[data-fee-workflow-requote]')&&!document.querySelector('[data-fee-workflow-applied]')");
  checks.resourcesLocalOnly = requests.every(u => /^(file:|blob:|data:)/.test(u) || process.env.FEE_REQUOTE_BROWSER_URL && u.startsWith(new URL('./', process.env.FEE_REQUOTE_BROWSER_URL).href));
  const report = {checks, layouts, exceptions, transport: process.env.FEE_REQUOTE_BROWSER_URL ? 'PUBLIC_HTTPS' : 'FILE_OFFLINE', actualJsonDownloads: 6, actualCustomerDownloads: 3, fixtureSynthetic: true, realPhoneVerified: false, fileUploadUsesApiSubstitute: true, backupInspectionUsesSaveApiSubstitute: true, customerPdfCheck: 'Actual downloaded PDF structure and metadata; existing full PDF suite retains layout and text checks'};
  await writeFile(join(out, 'post-application-requote-browser-report.json'), JSON.stringify(report, null, 2));
  if (Object.values(checks).some(v => v !== true) || layouts.some(l => l.content > l.viewport || l.buttonHeight < 44) || exceptions.length) throw Error(JSON.stringify(report));
  console.log(JSON.stringify({checks: Object.keys(checks).length, layouts: layouts.length, actualJsonDownloads: 6, actualCustomerDownloads: 3, passed: true}));
} catch (error) {
  await writeFile(join(out, 'partial-failure.json'), JSON.stringify({checks, layouts, exceptions, error: String(error)}, null, 2)); throw error;
} finally { ws.close(); }
