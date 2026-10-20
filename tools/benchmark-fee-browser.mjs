import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createServer} from 'vite';
import {withDocumentNavigation} from './browser-document.mjs';

// Only an explicitly isolated test profile may be cleared. No application profiling hooks are shipped.
if (process.env.FEE_PERFORMANCE_DEDICATED !== '1' || !/^\d{4,5}$/.test(process.env.BROWSER_CHECK_PORT ?? '')) throw Error('Set FEE_PERFORMANCE_DEDICATED=1 and BROWSER_CHECK_PORT for a disposable test browser profile');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), out = resolve(process.env.BROWSER_CHECK_OUTPUT ?? 'benchmark-results/fee-browser');
const counts = (process.env.FEE_PERFORMANCE_COUNTS ?? '1,4,8').split(',').map(Number), repeats = Number(process.env.FEE_PERFORMANCE_REPEAT ?? 3);
if (counts.some(n => ![1, 4, 8].includes(n)) || new Set(counts).size !== counts.length || !Number.isInteger(repeats) || repeats < 1 || repeats > 5) throw Error('Unique counts 1/4/8 and repeat 1..5 required');
const server = await createServer({root, configFile: false, optimizeDeps: {noDiscovery: true, include: []}, server: {middlewareMode: true, hmr: false, watch: null}, appType: 'custom'});
const {feePerformanceFixture} = await server.ssrLoadModule('/tools/fee-performance-fixture.ts');
const {booksToRows} = await server.ssrLoadModule('/src/ui/fx-rows.ts');
const {durationSummary} = await server.ssrLoadModule('/tools/fee-performance-metrics.ts');
const targets = await (await fetch('http://127.0.0.1:' + process.env.BROWSER_CHECK_PORT + '/json')).json();
const target = targets.find(t => t.type === 'page' && !t.url.startsWith('edge:'));
if (!target) {await server.close(); throw Error('No dedicated browser page');}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok, fail) => {ws.onopen = ok; ws.onerror = fail;});
let serial = 0;
const pending = new Map(), exceptions = [], requests = [], cases = [];
ws.onclose = () => {for (const p of pending.values()) p.reject(Error('Dedicated browser disconnected')); pending.clear();};
ws.onmessage = e => {const r = JSON.parse(e.data); if (r.method === 'Runtime.exceptionThrown') exceptions.push(r.params.exceptionDetails.text); if (r.method === 'Network.requestWillBeSent') requests.push(r.params.request.url); const p = pending.get(r.id); if (p) {pending.delete(r.id); r.error ? p.reject(Error(JSON.stringify(r.error))) : p.resolve(r.result);}};
const send = (method, params = {}) => new Promise((ok, fail) => {const id = ++serial; pending.set(id, {resolve: ok, reject: fail}); ws.send(JSON.stringify({id, method, params}));});
const call = withDocumentNavigation(send);
async function evaluate(expression) {const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value;}
async function until(expression) {for (let i = 0; i < 600; i++) {if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100));} throw Error('Timeout ' + expression);}
async function native(selector) {
  const point = await evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Missing/disabled test control');for(let p=e.parentElement;p;p=p.parentElement)if(p instanceof HTMLDetailsElement)p.open=true;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', {type, button: 'left', clickCount: 1, ...point});
}
const action = key => native('[data-action="' + key + '"]');
async function upload(id, raw) {await evaluate(`(() => {const d=new DataTransfer();d.items.add(new File([${JSON.stringify(raw)}],'synthetic-performance.json',{type:'application/json'}));const e=document.querySelector('#${id}');e.files=d.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
async function adopt(f) {
  await upload('fee-tax-file-input', f.sources.attachment_json); await until("!!document.querySelector('[data-action=fee-tax-adopt]')"); await action('fee-tax-adopt'); await until("!document.querySelector('[data-action=fee-tax-adopt]')");
  await upload('fee-precision-file-input', f.sources.precision_json); await until("!!document.querySelector('[data-action=fee-precision-adopt]')"); await action('fee-precision-adopt'); await action('fee-precision-confirm'); await until("!document.querySelector('[data-action=fee-precision-adopt]')");
  await upload('fee-envelope-file-input', f.raw); await until("!!document.querySelector('[data-fee-envelope-preview]')");
  for (const key of await evaluate("[...document.querySelectorAll('[data-fee-envelope-choice]')].map(e=>e.dataset.feeEnvelopeChoice)")) await native('[data-fee-envelope-choice="' + key + '"]');
  await action('fee-envelope-adopt'); await until("!document.querySelector('[data-fee-envelope-preview]')");
}
async function observe(key) {
  await evaluate(`(() => {window.perf85={finished:false};document.addEventListener('click',function start(e){if(!e.target.closest('[data-action=${key}]'))return;document.removeEventListener('click',start,true);window.perf85.started=performance.now();if(${JSON.stringify(key)}!=='fee-envelope-workbench-preview')return;const observer=new MutationObserver(()=>{const b=document.querySelector('[data-action=fee-envelope-workbench-preview]'),s=document.querySelector('[data-fee-workbench-status]');if(!b||b.disabled||!s||!(/完整批次已准备|完整检查未完成|请处理以下具体待办/.test(s.textContent)))return;observer.disconnect();requestAnimationFrame(()=>requestAnimationFrame(()=>{window.perf85.ms=performance.now()-window.perf85.started;window.perf85.status=document.querySelector('[data-fee-workbench-result]')?.dataset.status??'REFUSED';window.perf85.message=s.textContent;window.perf85.finished=true;}));});observer.observe(document.body,{childList:true,subtree:true});},true);window.showSaveFilePicker=async o=>({name:o.suggestedName,createWritable:async()=>({write:async b=>{const raw=typeof b==="string"?b:await b.text();window.perf85.backupBytes=new TextEncoder().encode(raw).length;window.perf85.backupKind=JSON.parse(raw).kind??'PROJECT';window.perf85.sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(v=>v.toString(16).padStart(2,'0')).join('');},close:async()=>{requestAnimationFrame(()=>requestAnimationFrame(()=>{window.perf85.ms=performance.now()-window.perf85.started;window.perf85.finished=true;}));}})});})()`);
  await action(key); await until('window.perf85.finished'); return evaluate('window.perf85');
}
async function editName(name) {
  return evaluate(`new Promise(resolve=>{const e=document.querySelector('[data-path=name]');if(!e)throw Error('No project name input');const start=performance.now();e.value=${JSON.stringify(name)};e.dispatchEvent(new Event('change',{bubbles:true}));requestAnimationFrame(()=>requestAnimationFrame(()=>resolve({ms:performance.now()-start,candidate_cleared:!document.querySelector('[data-fee-workbench-candidate]'),review_cleared:!document.querySelector('[data-customer-field=reviewed]').checked,value:document.querySelector('[data-path=name]').value})));})`);
}
const url = pathToFileURL(join(root, 'trade-cost-engine.html')).href;
await mkdir(out, {recursive: true});
try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  const browser = await send('Browser.getVersion');
  await send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false});
  await call('Page.navigate', {url}); await until("!!document.querySelector('[data-fee-workflow-guide]')");
  for (const count of counts) {
    console.log('Measuring actual app with ' + count + ' synthetic component(s)…');
    const f = await feePerformanceFixture(count), rows = booksToRows(f.pair.project.fx_books);
    await evaluate(`localStorage.clear();localStorage.setItem('trade-cost-engine:workspace-mode-v1','professional');localStorage.setItem('trade-cost-engine:onboarding-v1','hidden');localStorage.setItem('trade-cost-engine:draft-v1',${JSON.stringify(JSON.stringify({project: f.pair.project, fxRows: rows, pair_fx_row_key: JSON.stringify(rows)}))});localStorage.setItem('trade-cost-engine:container-bill-v1',${JSON.stringify(f.sources.bill_json)});localStorage.setItem('trade-cost-engine:container-cost-pair-v1',${JSON.stringify(f.sources.pair_json)});`);
    await call('Page.reload'); await until("!!document.querySelector('[data-fee-workflow-guide]')"); await adopt(f);
    const beforeProject = await observe('save'), beforeEnvelope = await observe('fee-envelope-save');
    await native('[data-customer-field="reviewed"]');
    const previews = [], backups = [], statuses = []; let lastPreview;
    for (let run = 0; run <= repeats; run++) {
      const result = await observe('fee-envelope-workbench-preview'); lastPreview = result; previews.push(result.ms); statuses.push(result.status);
      if (result.status === 'STAGED') backups.push(await observe('fee-envelope-workbench-backup'));
    }
    const customerReviewKept = await evaluate("document.querySelector('[data-customer-field=reviewed]').checked");
    const candidateText = await evaluate("document.querySelector('[data-fee-workbench-candidate]')?.textContent??null");
    let edit = null;
    if (statuses[0] === 'STAGED') {
      const originalName = await evaluate("document.querySelector('[data-path=name]').value"), samples = [];
      for (let run = 0; run <= repeats; run++) {
        const name = 'SYNTHETIC_PERFORMANCE_EDIT_' + run, result = await editName(name);
        if (!result.candidate_cleared || !result.review_cleared || result.value !== name) throw Error('Editing retained an old candidate or review');
        samples.push(result.ms);
      }
      await editName(originalName); await native('[data-customer-field="reviewed"]');
      edit = {change_event_to_two_frames: durationSummary(samples[0], samples.slice(1)), first_edit_invalidates_candidate: true, all_edits_revoke_customer_review: true, original_name_restored: true, customer_review_explicitly_rechecked: true};
    }
    const afterProject = await observe('save'), afterEnvelope = await observe('fee-envelope-save');
    if (!customerReviewKept || beforeProject.sha256 !== afterProject.sha256 || beforeEnvelope.sha256 !== afterEnvelope.sha256 || statuses.some(s => s !== statuses[0]) || statuses[0] === 'STAGED' && !candidateText?.includes('未知 → 未知')) throw Error('Read-only benchmark invariant failed');
    cases.push({count, status: statuses[0] === 'STAGED' ? 'MEASURED' : 'APP_REFUSED', preview_including_capture_prepare_render: durationSummary(previews[0], previews.slice(1)), preview_statuses: statuses,
      prepared_backup_including_capture_encode_save_api: backups.length ? durationSummary(backups[0].ms, backups.slice(1).map(b => b.ms)) : null,
      backup_encoded_utf8_bytes: backups.map(b => b.backupBytes), backup_kinds: backups.map(b => b.backupKind), candidate_profit_unknown: candidateText === null ? null : candidateText.includes('未知 → 未知'),
      temporary_project_name_edit: edit,
      verified: {project_bytes_unchanged: true, envelope_including_receipts_bytes_unchanged: true, customer_review_unchanged: true, application_confirmation_never_used: true}, refusal_message: statuses[0] === 'STAGED' ? null : lastPreview.message});
    await writeFile(join(out, 'progress.json'), JSON.stringify({cases, exceptions}, null, 2));
  }
  const runtime = await readFile(join(root, 'trade-cost-engine.html'));
  const report = {kind: 'SYNTHETIC_FEE_BROWSER_PERFORMANCE_BASELINE', version: '1.0', generated_at: new Date().toISOString(), browser: {product: browser.product, js_version: browser.jsVersion}, offline_runtime_blob: createHash('sha1').update('blob ' + runtime.length + '\0').update(runtime).digest('hex'),
    methodology: {viewport: [1440, 1000], first: 'First timed preview after explicit file adoption and structural checks; not cold browser start', repeated: repeats, scope: 'Native mouse event to DOM result plus two animation frames; preview includes full production capture, strict validation, hashing, candidate preparation and rendering', backup: 'Original backup action with substitute Save API; includes blob inspection/hash and two frames, excludes physical disk I/O', edit: 'Synthetic change event through original project-name control to two frames; first invalidates a prepared candidate, later edits have no candidate. Name restored and customer explicitly rechecked; no financial application', fixture_setup_excluded: true, latency_thresholds: false, timings_overlap: true, synthetic_evidence_only: true, isolated_profile_storage_reset: true, file_upload_api_substitute: true, real_phone_verified: false},
    cases, exceptions, financial_writes: 0, confirmation_authority: false, resources_local_only: requests.every(u => /^(file:|blob:|data:)/.test(u)), all_sizes_supported: cases.every(c => c.status === 'MEASURED')};
  await writeFile(join(out, 'fee-browser-performance.json'), JSON.stringify(report, null, 2) + '\n');
  if (exceptions.length || !report.resources_local_only) throw Error('Unexpected browser exception/network request');
  console.log(JSON.stringify({cases: cases.map(c => ({count: c.count, status: c.status})), financialWrites: 0, reportComplete: true, allSizesSupported: report.all_sizes_supported}));
} finally {ws.close(); await server.close();}
