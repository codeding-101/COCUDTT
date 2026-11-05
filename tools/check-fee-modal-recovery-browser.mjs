/** Original application and real form nodes. Failure probes describe limitations, not fixed behavior. */
import {createServer} from 'vite';
import {readFileSync, existsSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, join, relative} from 'node:path';
import {createHash} from 'node:crypto';
import {withDocumentNavigation} from './browser-document.mjs';
import {modalRecoveryFingerprints} from './fee-modal-recovery-evidence.mjs';

if (process.env.MODAL_RECOVERY_DEDICATED !== '1' || !/^\d{4,5}$/.test(process.env.BROWSER_CHECK_PORT ?? '')) {
  throw Error('Dedicated local browser required');
}
const root = resolve(import.meta.dirname, '..');
const out = resolve(process.env.BROWSER_CHECK_OUTPUT ?? 'benchmark-results/fee-mobile-settings');
const port = 4230;
await mkdir(out, {recursive: true});
if (['source-start.json','browser-progress.json','browser-failure.json','fee-modal-recovery-browser.json'].some(file => existsSync(join(out,file)))) {
  throw Error('Keep every browser attempt in a separate directory');
}
const fingerprints = modalRecoveryFingerprints();
await writeFile(join(out,'source-start.json'),JSON.stringify({phase:125,started_at:new Date().toISOString(),source_fingerprints:fingerprints},null,2)+'\n');
const blob = source => createHash('sha1').update('blob ' + Buffer.byteLength(source) + '\0').update(source).digest('hex');
const original = readFileSync(join(root, 'src/ui/app.ts'), 'utf8').replace(/\r\n/g, '\n');
if (blob(original) !== fingerprints['src/ui/app.ts']) throw Error('Original app pin');
const bridge = String.raw`
window.__modal125={controller:mobileSettings,ready:()=>workflow.stateInitialized&&!workflow.pendingCalculation&&!!captureCurrentFeeWorkbench(),pending:()=>workflow.pendingCalculation,project:()=>state.project,error:()=>state.error,files:()=>JSON.stringify(captureCurrentFeeWorkbench().files),recovery:()=>workflow.recoveryStage,render:()=>render(),localRefresh:()=>{feeTaxWorkspace.refresh();feePrecisionWorkspace.refresh();feeEnvelopeWorkspace.refresh();},newProject:()=>newProject('china-sample')};
`;
const server = await createServer({root, configFile: false, optimizeDeps: {noDiscovery: true, include: []},
  server: {host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null},
  plugins: [{name: 'mobile123-original-app-probe', enforce: 'pre', transform(code, id) {
    if (relative(root, id.split('?')[0]).replaceAll('\\', '/') !== 'src/ui/app.ts') return null;
    if (code.replace(/\r\n/g, '\n') !== original) throw Error('Unpinned application response');
    return {code: code + bridge, map: null};
  }}],
});
const states = [], checks = {}, findings = [], fixed = [], retained = [], exceptions = [], requests = [], layouts = [];
const navigationPrompts = [];
let browser, page, target, unexpectedDialog = false, navigating = false;
async function connect(url, events = () => {}) {
  const ws = new WebSocket(url);
  await new Promise((ok, bad) => {const timer=setTimeout(()=>bad(Error('CDP connection timeout')),10000);ws.onopen=()=>{clearTimeout(timer);ok();};ws.onerror=error=>{clearTimeout(timer);bad(error);};});
  const pending = new Map(); let serial = 0;
  ws.onmessage = event => {
    const result = JSON.parse(event.data), waiting = pending.get(result.id);
    if (waiting) {pending.delete(result.id); result.error ? waiting.reject(Error(JSON.stringify(result.error))) : waiting.resolve(result.result);}
    else events(result);
  };
  ws.onclose = () => {for(const waiting of pending.values())waiting.reject(Error('CDP socket closed'));pending.clear();};
  return {ws, call(method, params = {}) {return new Promise((resolve, reject) => {
    const id = ++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP command timeout: '+method));},30000);
    pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});ws.send(JSON.stringify({id,method,params}));
  });}};
}
const snapshot = String.raw`(()=>{
 const api=window.__modal125,d=document.querySelector('#mobile-settings-dialog'),p=document.querySelector('[data-evidence-section="advanced-settings"]'),h=d?.querySelector('[data-mobile-settings-host]'),m=document.querySelector('[data-mobile-settings-placeholder]'),a=document.activeElement;
 return{active:api.controller.isOpen,dialog_open:!!d?.open,panel_in_host:p?.parentElement===h,panel_connected:!!p?.isConnected,placeholder:!!m,overflow:document.body.style.getPropertyValue('overflow'),priority:document.body.style.getPropertyPriority('overflow'),window_scroll:[scrollX,scrollY],host_scroll:h?.scrollTop??0,focus_action:a?.dataset?.action??null,focus_in_panel:!!p?.contains(a),controls:p?.querySelectorAll('input,select,textarea').length??0,file_inputs:p?.querySelectorAll('input[type=file]').length??0,number_inputs:p?.querySelectorAll('input[type=number]').length??0,selected_files:[...p?.querySelectorAll('input[type=file]')??[]].reduce((n,e)=>n+(e.files?.length??0),0),pending:api.pending(),recovery:api.recovery(),project_quantity:String(api.project().goods.quantity),root_connected:!!document.querySelector('#app')?.isConnected};
})()`;

try {
  await server.listen();
  const endpoint = 'http://127.0.0.1:' + process.env.BROWSER_CHECK_PORT;
  const version = await (await fetch(endpoint + '/json/version',{signal:AbortSignal.timeout(10000)})).json();
  browser = await connect(version.webSocketDebuggerUrl);
  target = (await browser.call('Target.createTarget', {url: 'about:blank'})).targetId;
  const targets = await (await fetch(endpoint + '/json',{signal:AbortSignal.timeout(10000)})).json();
  page = await connect(targets.find(t => t.id === target).webSocketDebuggerUrl, event => {
    if (event.method === 'Runtime.exceptionThrown') exceptions.push(event.params);
    if (event.method === 'Network.requestWillBeSent') requests.push(event.params.request.url);
    if(event.method==='Page.javascriptDialogOpening'){
      const ownedNavigationPrompt=navigating&&event.params.type==='beforeunload';
      if(ownedNavigationPrompt)navigationPrompts.push({type:event.params.type,accepted_for_synthetic_navigation:true});else unexpectedDialog=true;
      void page.call('Page.handleJavaScriptDialog',{accept:ownedNavigationPrompt}).catch(error=>exceptions.push({driver_dialog_error:String(error)}));
    }
  });
  for (const method of ['Page.enable', 'Runtime.enable', 'Network.enable']) await page.call(method);
  await page.call('Page.addScriptToEvaluateOnNewDocument', {source: "localStorage.clear();localStorage.setItem('trade-cost-engine:onboarding-v1','hidden');"});
  const ev = async expression => {
    const r = await page.call('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 500; i++) {if (await ev(expression)) return; await new Promise(ok => setTimeout(ok, 20));}
    throw Error('State timeout: ' + expression);
  };
  const check = (name, value) => {checks[name] = value === true; if (!checks[name]) throw Error('Mobile contract: ' + name);};
  const collect = async label => {
    const state = {label, ...await ev(snapshot)}; states.push(state);
    await writeFile(join(out, 'browser-progress.json'), JSON.stringify({states, checks, findings, exceptions}, null, 2) + '\n');
    return state;
  };
  const width = async value => page.call('Emulation.setDeviceMetricsOverride', {width: value, height: 1000, deviceScaleFactor: 1, mobile: value <= 700});
  const navigate = withDocumentNavigation(page.call);
  const fresh = async (value = 390) => {
    navigating=true;
    try{await width(value);await navigate('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});await until('window.__modal125?.ready()??false');}
    finally{navigating=false;}
  };
  const key = async (name, code, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp']) await page.call('Input.dispatchKeyEvent', {type, key: name, code: name === 'a' ? 'KeyA' : name, windowsVirtualKeyCode: code, modifiers});
  };
  const click = async selector => {
    const point = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing target');for(let p=e.parentElement;p;p=p.parentElement)if(p instanceof HTMLDetailsElement)p.open=true;e.scrollIntoView({behavior:'instant',block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return{x,y,visible:r.width>0&&r.height>0,hit:hit===e||e.contains(hit)};})()`);
    if (!point.visible || !point.hit) throw Error('Native target obstructed ' + selector);
    for (const type of ['mousePressed', 'mouseReleased']) await page.call('Input.dispatchMouseEvent', {type, button: 'left', clickCount: 1, x: point.x, y: point.y});
  };
  const open = async () => {await click('[data-action="show-mobile-settings"]'); await until('window.__modal125.controller.isOpen&&document.querySelector("#mobile-settings-dialog").open');};
  const remember = async () => ev(String.raw`(()=>{
    const panel=document.querySelector('[data-evidence-section="advanced-settings"]'),file=panel.querySelector('input[type=file]'),transfer=new DataTransfer();transfer.items.add(new File(['SYNTHETIC_RAW123'],'local-contract123.json',{type:'application/json',lastModified:123}));file.files=transfer.files;
    window.__refs123={panel,parent:panel.parentNode,next:panel.nextSibling,file,fileObject:file.files[0],filesEvidence:window.__modal125.files(),project:window.__modal125.project(),controls:[...panel.querySelectorAll('input,select,textarea')].map(e=>({node:e,value:e.value,checked:e.checked,bad:e.validity?.badInput??false,files:e.files?[...e.files]:null}))};return{controls:window.__refs123.controls.length,file_id:file.id};
  })()`);
  const sameControls = async () => ev(String.raw`(()=>{const r=window.__refs123,p=document.querySelector('[data-evidence-section="advanced-settings"]'),current=[...p.querySelectorAll('input,select,textarea')];return{same_panel:r.panel===p,same_nodes:current.length===r.controls.length&&r.controls.every((v,i)=>v.node===current[i]),same_values:r.controls.every(v=>v.node.value===v.value&&v.node.checked===v.checked&&(v.node.validity?.badInput??false)===v.bad),same_file:r.file.files[0]===r.fileObject,file_in_form:p.contains(r.file)&&r.file.files[0]===r.fileObject,original_parent:p.parentNode===r.parent,files_evidence_unchanged:window.__modal125.files()===r.filesEvidence};})()`);
  const resolved = (id, observed, evidence) => {check('fixed_' + id, observed);retained.push({id,status:'FIXED_AND_REPLAYED',fixed:true,evidence});};
  const finding = (id, observed, evidence) => {check('fixed_' + id, !observed); fixed.push({id, status: 'FIXED_AND_REPLAYED', fixed: true, evidence});};

  await fresh(701);
  const desktop = await ev("window.__modal125.controller.open(document.querySelector('[data-action=\"show-mobile-settings\"]'))");
  check('701_rejects_modal', desktop === false && !(await collect('desktop_701')).active);
  await width(700); await remember();
  await open(); const opened = await collect('open_700'), during = await sameControls();
  check('700_uses_same_actual_form', opened.active && opened.dialog_open && opened.panel_in_host && opened.placeholder && opened.controls > 50 && during.same_panel && during.same_nodes && during.same_values && during.same_file && during.file_in_form);
  const savedReturn = await ev('({x:window.__modal125.controller.point.x,y:window.__modal125.controller.point.y})');
  await click('[data-action="close-mobile-settings"]'); await until('!window.__modal125.controller.isOpen');
  const closed = await collect('close_700'), after = await sameControls();
  check('close_keeps_raw_and_file_references', after.same_nodes && after.same_values && after.same_file && after.file_in_form && after.original_parent && after.files_evidence_unchanged);
  check('close_restores_focus_and_scroll', closed.focus_action === 'show-mobile-settings' && Math.abs(closed.window_scroll[0] - savedReturn.x) <= 1 && Math.abs(closed.window_scroll[1] - savedReturn.y) <= 1 && !closed.placeholder && closed.overflow === '');

  for (const value of [700, 390, 320]) {
    await width(value); await open();
    const layout = await ev(`(()=>{const d=document.querySelector('#mobile-settings-dialog'),h=d.querySelector('[data-mobile-settings-host]');return{width:${value},viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth,dialog_width:d.getBoundingClientRect().width,dialog_content:d.scrollWidth,dialog_client:d.clientWidth,host_content:h.scrollWidth,host_client:h.clientWidth,open:d.open};})()`);
    layouts.push(layout);
    check('layout_' + value, layout.open && layout.content <= layout.viewport && layout.dialog_width <= value && layout.dialog_content <= layout.dialog_client && layout.host_content <= layout.host_client);
    if (value === 390 || value === 320) await writeFile(join(out, 'mobile-panel-' + value + '.png'), Buffer.from((await page.call('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false})).data, 'base64'));
    await key('Escape', 27); await until('!window.__modal125.controller.isOpen');
  }
  await collect('layouts_escape_closed');
  await open();
  const collapsedBoundary = await ev("(()=>{const d=document.querySelector('#mobile-settings-dialog'),c=[...d.querySelectorAll('button:not(:disabled),input:not(:disabled):not([type=hidden]),select:not(:disabled),textarea:not(:disabled),summary,a[href]')].filter(e=>e.getClientRects().length);window.__collapsedTab123={first:c[0],last:c[c.length-1]};window.__collapsedTab123.last.focus();const receivesFocus=document.activeElement===window.__collapsedTab123.last;window.__collapsedTab123.first.focus();return{last_receives_focus:receivesFocus,last_tag:window.__collapsedTab123.last.tagName};})()");
  await key('Tab', 9, 8);
  const collapsedShift = await collect('collapsed_reverse_tab');
  resolved('collapsed_reverse_tab_stays_at_first', !collapsedBoundary.last_receives_focus && await ev('document.activeElement!==window.__collapsedTab123.first&&!!document.activeElement.closest("#mobile-settings-dialog")'), {state:collapsedShift.label,hidden_candidate_excluded:true});
  await ev("const d=document.querySelector('#mobile-settings-dialog');for(const e of d.querySelectorAll('details'))e.open=true;const c=[...d.querySelectorAll('button:not(:disabled),input:not(:disabled):not([type=hidden]),select:not(:disabled),textarea:not(:disabled),summary,a[href]')].filter(e=>e.getClientRects().length);window.__tab123={first:c[0],last:c[c.length-1]};window.__tab123.last.focus();if(document.activeElement!==window.__tab123.last)throw Error('Last native keyboard target did not receive focus');void 0");
  await key('Tab', 9); check('native_tab_wraps', await ev('document.activeElement===window.__tab123.first'));
  await key('Tab', 9, 8); check('native_shift_tab_wraps', await ev('document.activeElement===window.__tab123.last'));
  await collect('keyboard_wrapping');
  await ev("window.__modal125.controller.dismiss();window.__modal125.controller.open(document.querySelector('[data-action=\"show-mobile-settings\"]'));void 0");
  await new Promise(ok => setTimeout(ok, 40));
  const reopened = await collect('queued_close_reopened'); check('queued_close_does_not_dismiss_reopen', reopened.active && reopened.dialog_open);
  await ev('window.__modal125.controller.dismiss();void 0');

  await fresh(); await remember(); await open();
  await ev("document.querySelector('[data-mobile-settings-host]').scrollTop=600;window.__hostScroll123=document.querySelector('[data-mobile-settings-host]').scrollTop;window.__modal125.render();void 0");
  await until('window.__modal125.ready()');
  const redrawn = await collect('same_project_redraw');
  check('same_project_keeps_modal_and_host_scroll', redrawn.active && redrawn.dialog_open && redrawn.panel_in_host && await ev("Math.abs(document.querySelector('[data-mobile-settings-host]').scrollTop-window.__hostScroll123)<=1"));
  const redrawRetention = await sameControls();
  resolved('rerender_replaces_selected_file', !redrawRetention.same_panel&&redrawRetention.file_in_form&&redrawn.selected_files===1&&redrawRetention.same_file,{state:'same_project_redraw',original_file_node_connected:await ev('window.__refs123.file.isConnected'),file_retained_by_application:true});
  await ev('window.__modal125.newProject();void 0');
  await until('window.__modal125.ready()');
  const replaced = await collect('replacement_project');
  check('project_replacement_closes_and_resets_scroll', !replaced.active && !replaced.dialog_open && !replaced.placeholder && replaced.overflow === '' && replaced.window_scroll[1] === 0);

  await fresh(700); await open();
  await ev("window.__focus123=document.querySelector('[data-mobile-settings-host] input[data-item-field=amount]');for(let p=window.__focus123.parentElement;p;p=p.parentElement)if(p instanceof HTMLDetailsElement)p.open=true;window.__focus123.focus();void 0");
  await width(701); await until('!window.__modal125.controller.isOpen');
  const resized = await collect('resize_701');
  check('resize_restores_same_focused_control', !resized.dialog_open && !resized.placeholder && resized.overflow === '' && await ev('document.activeElement===window.__focus123&&window.__focus123.isConnected'));

  await fresh(); await open();
  await click('[data-mobile-settings-host] input[data-item-field="amount"]');
  const editedItem = await ev('document.activeElement.dataset.item');
  await key('a', 65, 2); await page.call('Input.insertText', {text: '123.456789'});
  const pending = await collect('pending_actual_amount');
  check('native_input_marks_pending', pending.pending);
  await key('Escape', 27); await until('window.__modal125.ready()&&!window.__modal125.controller.isOpen');
  const committed = await collect('escape_committed_actual_amount');
  check('escape_uses_host_commit_before_return', !committed.active && await ev(`String(window.__modal125.project().items.find(i=>i.cost_id===${JSON.stringify(editedItem)}).amount)==='123.456789'`));

  await fresh(); await open(); await click('[data-mobile-settings-host] input[data-item-field="amount"]');
  const invalidItem = await ev('document.activeElement.dataset.item');
  await key('a', 65, 2); await page.call('Input.insertText', {text: '-e'});
  await collect('invalid_text_pending');
  await key('Escape', 27); await until('!window.__modal125.pending()');
  const invalidResult = await collect('invalid_text_return');
  const invalidEvidence = await ev(`(()=>{const i=window.__modal125.project().items.find(i=>i.cost_id===${JSON.stringify(invalidItem)}),e=[...document.querySelectorAll('[data-item-field=amount]')].find(e=>e.dataset.item===${JSON.stringify(invalidItem)});return{model:String(i.amount),input:e.value,error:!!window.__modal125.error(),recovery:window.__modal125.recovery()};})()`);
  resolved('invalid_amount_uses_recovery',invalidEvidence.model==='-e'&&invalidEvidence.input==='-e'&&invalidEvidence.error&&invalidEvidence.recovery===null&&!invalidResult.pending,{state:invalidResult.label,raw_retained:true,error_code:await ev('window.__modal125.error().includes("PRICING_INPUT_INVALID")')});
  await click('[data-evidence-section="input-review"] [data-action="locate-input-review"]');await until('window.__modal125.controller.isOpen');check('error_locates_original_fee_field',await ev('document.activeElement.dataset.itemField==="amount"&&document.activeElement.value==="-e"'));await key('a',65,2);await page.call('Input.insertText',{text:'321.123456'});await key('Enter',13);await until('!window.__modal125.error()&&!window.__modal125.pending()');await collect('invalid_amount_corrected');

  await fresh(); await remember();
  await ev("document.body.style.setProperty('overflow','auto','important');void 0");
  await open(); await key('Escape', 27); await until('!window.__modal125.controller.isOpen');
  const important = await collect('important_overflow_return');
  finding('overflow_priority_not_restored', important.overflow === 'auto' && important.priority !== 'important', {state: important.label, before: {value: 'auto', priority: 'important'}, after: {value: important.overflow, priority: important.priority}});

  await fresh(); await open();
  await ev("document.body.style.setProperty('overflow','clip','important');window.__modal125.controller.dismiss();void 0");
  const foreign = await collect('foreign_overflow_return');
  finding('foreign_overflow_overwritten', foreign.overflow !== 'clip' || foreign.priority !== 'important', {state: foreign.label, foreign: {value: 'clip', priority: 'important'}, after: {value: foreign.overflow, priority: foreign.priority}});

  await fresh(); await remember(); await open();
  await ev("document.querySelector('[data-mobile-settings-placeholder]').remove();window.__modal125.controller.dismiss();void 0");
  const missingMarker = await collect('missing_placeholder_return'), markerRetention = await sameControls();
  finding('missing_placeholder_leaves_hidden_form', !missingMarker.active && !missingMarker.dialog_open && missingMarker.panel_in_host && markerRetention.same_nodes && markerRetention.same_file, {state: missingMarker.label, nodes_and_file_retained: true, form_visible: false});

  await fresh(); await remember();
  const missingHost = await ev("(()=>{document.querySelector('[data-mobile-settings-host]').remove();return window.__modal125.controller.open(document.querySelector('[data-action=\"show-mobile-settings\"]'));})()");
  const hostState = await collect('missing_host_open');
  finding('missing_host_reports_open', missingHost === true && hostState.active && !hostState.dialog_open, {state: hostState.label, return_value: missingHost});

  await fresh(); await remember();
  const modalError = await ev("(()=>{const d=document.querySelector('#mobile-settings-dialog');window.__originalShow123=d.showModal;d.showModal=()=>{throw new DOMException('Synthetic showModal failure','InvalidStateError');};try{window.__modal125.controller.open(document.querySelector('[data-action=\"show-mobile-settings\"]'));return null;}catch(e){return e.name;}})()");
  const failedShow = await collect('show_modal_failure_direct');
  finding('show_modal_failure_needs_host_recovery', modalError === 'InvalidStateError' && failedShow.active && failedShow.panel_in_host && !failedShow.dialog_open && failedShow.overflow === 'hidden', {state: failedShow.label, failure: modalError});
  await ev('window.__modal125.controller.dismiss(false);document.querySelector("#mobile-settings-dialog").showModal=window.__originalShow123;void 0');
  const repairedShow = await collect('explicit_recovery_after_show_failure');
  check('explicit_dismiss_recovers_show_failure', !repairedShow.active && !repairedShow.panel_in_host && repairedShow.overflow === '' && (await sameControls()).same_file);

  await fresh(); await remember();
  await ev("document.querySelector('#mobile-settings-dialog').showModal=()=>{throw new DOMException('Synthetic host showModal failure','InvalidStateError');};void 0");
  await click('[data-action="show-mobile-settings"]');
  await until('!window.__modal125.controller.isOpen');
  const hostRecovery = await collect('host_guard_after_show_failure');
  check('application_falls_back_without_full_page_recovery', !hostRecovery.active && hostRecovery.overflow !== 'hidden' && !hostRecovery.recovery && (await sameControls()).same_file && (await sameControls()).file_in_form);

  await fresh(); await remember(); await open();
  const closeError = await ev("(()=>{const d=document.querySelector('#mobile-settings-dialog');window.__originalClose123=d.close;d.close=()=>{throw Error('Synthetic close failure');};try{window.__modal125.controller.dismiss();return false;}catch{return true;}})()");
  const failedClose = await collect('dialog_close_failure');
  finding('close_failure_leaves_modal_lock', closeError === true && !failedClose.active && failedClose.dialog_open && failedClose.overflow === 'hidden', {state: failedClose.label, form_nodes_restored: (await sameControls()).original_parent});
  await ev('document.querySelector("#mobile-settings-dialog").close=window.__originalClose123;window.__modal125.controller.dismiss();void 0');
  const retriedClose=await collect('explicit_retry_after_close_failure');
  check('close_failure_keeps_form_open_and_retryable',closeError===false&&failedClose.active&&failedClose.dialog_open&&failedClose.panel_in_host&&failedClose.overflow==='hidden');
  check('close_retry_restores_original_nodes_and_file',!retriedClose.active&&!retriedClose.dialog_open&&(await sameControls()).original_parent&&(await sameControls()).same_file);


  check('priority_and_value_both_restored',important.overflow==='auto'&&important.priority==='important');
  check('foreign_style_and_priority_preserved',foreign.overflow==='clip'&&foreign.priority==='important');
  check('missing_marker_returns_visible_original_form',!missingMarker.active&&!missingMarker.dialog_open&&!missingMarker.panel_in_host&&missingMarker.panel_connected&&markerRetention.same_nodes&&markerRetention.same_values&&markerRetention.same_file&&markerRetention.original_parent);
  check('missing_host_never_claims_open',missingHost===false&&!hostState.active&&!hostState.dialog_open&&hostState.panel_connected);
  check('show_failure_rolls_back_without_host_guard',modalError===null&&!failedShow.active&&!failedShow.dialog_open&&!failedShow.panel_in_host&&failedShow.overflow==='');

  await fresh(); await remember(); await open();
  await ev("document.body.style.setProperty('overflow-x','clip','important');window.__modal125.controller.afterRender();window.__modal125.controller.dismiss();void 0");
  await collect('foreign_axis_return');
  check('foreign_axis_preserved_without_reapplying_lock',await ev("document.body.style.getPropertyValue('overflow-x')==='clip'&&document.body.style.getPropertyPriority('overflow-x')==='important'&&document.body.style.getPropertyValue('overflow-y')===''"));

  await fresh(); await remember();
  await ev("document.body.style.setProperty('overflow-x','scroll','important');document.body.style.setProperty('overflow-y','auto');document.body.style.setProperty('color','rgb(1, 2, 3)');void 0");
  await open(); await click('[data-action="close-mobile-settings"]');
  check('mixed_axis_priorities_and_other_styles_restored',await ev("document.body.style.getPropertyValue('overflow-x')==='scroll'&&document.body.style.getPropertyPriority('overflow-x')==='important'&&document.body.style.getPropertyValue('overflow-y')==='auto'&&document.body.style.getPropertyPriority('overflow-y')===''&&document.body.style.color==='rgb(1, 2, 3)'"));
  await collect('mixed_priorities_return');

  for(const mode of['moved-marker','substitute-marker','removed-home','removed-host','moved-panel','removed-dialog']){
   await fresh();await remember();await open();
   await ev('('+String(function(mode){const r=window.__refs123,c=window.__modal125.controller,m=document.querySelector('[data-mobile-settings-placeholder]'),d=document.querySelector('#mobile-settings-dialog');
    if(mode==='moved-marker'){const foreign=document.createElement('aside');document.body.append(foreign);foreign.append(m);window.__foreign125=foreign;}
    if(mode==='substitute-marker'){const foreign=document.createElement('div');foreign.dataset.mobileSettingsPlaceholder='';m.replaceWith(foreign);window.__foreign125=foreign;}
    if(mode==='removed-home'){r.parent.remove();}
    if(mode==='removed-host')d.querySelector('[data-mobile-settings-host]').remove();
    if(mode==='moved-panel')document.body.append(r.panel);
    if(mode==='removed-dialog')d.remove();
    if(mode==='removed-host'||mode==='moved-panel'||mode==='removed-dialog')c.afterRender();else c.dismiss();
   })+')('+JSON.stringify(mode)+')');
   const result=await collect(mode),same=await sameControls();
   check(mode+'_keeps_original_visible_inputs',!result.active&&result.panel_connected&&same.same_panel&&same.same_nodes&&same.same_values&&same.same_file&&await ev("!window.__refs123.panel.closest('dialog:not([open])')"));
   if(mode==='moved-marker')check('moved_marker_not_removed',await ev("window.__foreign125.querySelector('[data-mobile-settings-placeholder]')!==null"));
   if(mode==='substitute-marker')check('substitute_marker_not_replaced',await ev('window.__foreign125.isConnected'));
  }

  for(const mode of['throw','no-open','open-then-throw']){
   await fresh();await remember();
   await ev('('+String(function(mode){const d=document.querySelector('#mobile-settings-dialog'),original=d.showModal;window.__show125=original;d.showModal=function(){if(mode==='open-then-throw')original.call(this);if(mode!=='no-open')throw new DOMException('Controlled opening failure','InvalidStateError');};window.__opened125=window.__modal125.controller.open(document.querySelector('[data-action="show-mobile-settings"]'));})+')('+JSON.stringify(mode)+')');
   const failed=await collect('show_'+mode),same=await sameControls();
   check('show_'+mode+'_retains_inputs_and_status',!failed.active&&!failed.dialog_open&&same.original_parent&&same.same_file&&same.same_nodes&&await ev("window.__opened125===false&&[...document.querySelectorAll('[data-mobile-settings-feedback]')].some(e=>!e.hidden&&e.textContent.includes('重试'))"));
   await ev("document.querySelector('#mobile-settings-dialog').showModal=window.__show125;void 0");await open();check('show_'+mode+'_explicit_retry_succeeds',(await sameControls()).same_file);await key('Escape',27);
  }

  await fresh();await remember();await open();
  await ev("const d=document.querySelector('#mobile-settings-dialog');window.__close125=d.close;d.close=()=>{};void 0");
  await click('[data-action="close-mobile-settings"]');const blocked=await collect('native_close_noop');
  check('native_close_noop_preserves_modal_and_notice',blocked.active&&blocked.dialog_open&&blocked.panel_in_host&&(await sameControls()).same_file&&await ev("document.querySelector('#mobile-settings-dialog [data-mobile-settings-feedback]').textContent.includes('重试')"));
  await width(320);await writeFile(join(out,'close-retry-320.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
  await ev("document.querySelector('#mobile-settings-dialog').close=window.__close125;void 0");await click('[data-action="close-mobile-settings"]');await collect('native_close_noop_retried');
  check('native_close_noop_retry_keeps_original_file',!await ev('window.__modal125.controller.isOpen')&&(await sameControls()).same_file&&(await sameControls()).original_parent);

  await fresh();await remember();await open();
  await ev("const d=document.querySelector('#mobile-settings-dialog'),original=d.close;d.close=function(){original.call(this);throw Error('Controlled post-close failure');};window.__modal125.controller.dismiss();void 0");
  const postClose=await collect('native_close_then_throw');check('post_close_throw_settles_actual_native_state',!postClose.active&&!postClose.dialog_open&&(await sameControls()).same_file&&(await sameControls()).original_parent);


  await fresh();await remember();await open();
  await ev("document.querySelector('#mobile-settings-dialog').close=()=>{throw Error('Controlled close failure before replacement');};window.__modal125.controller.dismiss();void 0");
  const replacementBlocked=await collect('project_replacement_after_close_failure');
  check('project_replace_starts_from_actual_failed_close',replacementBlocked.active&&replacementBlocked.dialog_open&&(await sameControls()).same_file);
  await ev('window.__modal125.newProject();void 0');await until('window.__modal125.ready()');
  const nextProject=await collect('replacement_retires_disconnected_old_modal');
  check('project_replace_retires_only_disconnected_old_form',!nextProject.active&&!nextProject.dialog_open&&nextProject.overflow===''&&!nextProject.recovery&&await ev("!window.__refs123.file.isConnected&&[...document.querySelectorAll('#app input[type=file]')].every(e=>e.files.length===0)&&window.__refs123.project!==window.__modal125.project()"));

  await fresh();await remember();
  await ev("document.querySelector('#mobile-settings-dialog').showModal=()=>{document.body.style.setProperty('overflow','clip','important');throw Error('Controlled foreign style during open');};window.__modal125.controller.open(document.querySelector('[data-action=\"show-mobile-settings\"]'));void 0");
  const foreignOpen=await collect('foreign_style_during_open_failure');
  check('show_failure_preserves_foreign_overflow',!foreignOpen.active&&!foreignOpen.dialog_open&&foreignOpen.overflow==='clip'&&foreignOpen.priority==='important'&&(await sameControls()).same_file&&(await sameControls()).original_parent);

  for(const mode of['open','render','close-failure-render']){
   await fresh();await remember();await open();
   await ev('('+String(function(mode){const d=document.querySelector('#mobile-settings-dialog');d.querySelector('[data-mobile-settings-host]').remove();if(mode==='close-failure-render')d.close=()=>{throw Error('Controlled close failure during detached redraw');};if(mode==='open')window.__modal125.controller.open(document.querySelector('[data-action="show-mobile-settings"]'));else window.__modal125.render();})+')('+JSON.stringify(mode)+')');
   const state=await collect('detached_host_before_'+mode),same=await sameControls();
   check('detached_host_before_'+mode+'_retains_actual_file',state.panel_connected&&!state.recovery&&same.same_file&&same.file_in_form&&await ev('window.__refs123.file.isConnected')&&(mode==='close-failure-render'?state.active&&state.dialog_open:!state.active&&!state.dialog_open));
  }

  await fresh();
  await ev("window.__allSelected124=[...document.querySelectorAll('#app input[type=file]')].map((node,i)=>{const t=new DataTransfer();t.items.add(new File(['SYNTHETIC_FILE_'+i],'selection'+i+'.json',{type:'application/json'}));node.files=t.files;return{node,id:node.id,file:node.files[0]};});window.__modal125.render();void 0");
  check('all_actual_file_inputs_survive_redraw',await ev("window.__allSelected124.length>=7&&window.__allSelected124.every(r=>document.getElementById(r.id)===r.node&&r.node.files[0]===r.file&&r.node.isConnected)"));
  await collect('all_files_retained');
  await ev('window.__modal125.localRefresh();void 0');check('local_refreshes_keep_all_file_selections',await ev("window.__allSelected124.every(r=>document.getElementById(r.id)===r.node&&r.node.files[0]===r.file)"));await collect('local_refresh_files_retained');
  await ev('window.__modal125.newProject();void 0');
  check('replacement_project_does_not_inherit_files',await ev("[...document.querySelectorAll('#app input[type=file]')].every(e=>e.files.length===0)&&window.__allSelected124.every(r=>!r.node.isConnected)"));
  await collect('replacement_files_cleared');
  const fileCases=await ev(String.raw`(async()=>{const{replaceWorkspaceMarkup:install}=await import('/src/ui/file-input-retention.ts'),result=[];function run(id,markup,keep,failInstall=false){const root=document.createElement('section');root.innerHTML='<p>before</p><input id="file-probe124" type="file" accept=".json"><p>after</p>';document.body.append(root);const input=root.querySelector('input'),t=new DataTransfer();t.items.add(new File(['RAW124'],'raw124.json'));input.files=t.files;const file=input.files[0],old=root.innerHTML;if(failInstall)root.replaceChildren=()=>{throw Error('Synthetic install rejection');};let threw=false;try{install(root,markup,keep);}catch{threw=true;}const value={id,threw,original_connected:root.contains(input),same_file:input.files[0]===file,unchanged:root.innerHTML===old,new_file_count:root.querySelector('input')?.files?.length??null};result.push(value);root.remove();}const good='<p>new</p><input id="file-probe124" type="file" accept=".json">';run('same-project',good,true);run('missing-target','<p>no file</p>',true);run('ambiguous-target',good+good,true);run('changed-accept',good.replace('.json','.xlsx'),true);run('failed-install',good,true,true);run('explicit-replacement',good,false);return result;})()`);
  check('file_preflight_preserves_missing_and_ambiguous',fileCases.filter(c=>['missing-target','ambiguous-target','changed-accept','failed-install'].includes(c.id)).every(c=>c.threw&&c.original_connected&&c.same_file&&c.unchanged));
  check('file_install_keeps_node_without_fake_path',fileCases.find(c=>c.id==='same-project').same_file&&fileCases.find(c=>c.id==='same-project').original_connected&&!fileCases.find(c=>c.id==='same-project').threw);
  check('file_replacement_starts_empty',fileCases.find(c=>c.id==='explicit-replacement').new_file_count===0&&!fileCases.find(c=>c.id==='explicit-replacement').original_connected);

  const fileOwnership=await ev(String.raw`(async()=>{const{replaceWorkspaceMarkup:install,takeSelectedFile:take}=await import('/src/ui/file-input-retention.ts'),root=document.createElement('section'),markup='<input id="file-reader124" type="file">';root.innerHTML=markup;document.body.append(root);const input=root.querySelector('input'),transfer=new DataTransfer();transfer.items.add(new File(['RAW_READER124'],'reader124.json'));input.files=transfer.files;const original=input.files[0],owned=take(input),cleared=input.files.length===0;const next=new DataTransfer();next.items.add(original);input.files=next.files;install(root,markup,true);const reselected=root.querySelector('input')===input&&input.files[0]===original;root.remove();return{same_file_transferred:owned===original,cleared_after_handoff:cleared,new_list_with_same_file_retained:reselected};})()`);
  check('file_reader_takes_original_and_clears_selection',fileOwnership.same_file_transferred&&fileOwnership.cleared_after_handoff);
  check('new_selection_of_same_file_is_not_consumed',fileOwnership.new_list_with_same_file_retained);

  await fresh();await remember();await open();await click('[data-item="freight"][data-item-field="cost_name"]');
  await key('a',65,2);await page.call('Input.insertText',{text:'REENTRANT_MODAL125'});
  await ev("(()=>{const app=document.querySelector('#app'),original=app.replaceChildren;let once=true;app.replaceChildren=function(...nodes){const text=nodes.map(n=>n instanceof DocumentFragment?[...n.childNodes].map(c=>c.outerHTML??c.textContent??'').join(''):n.outerHTML??n.textContent??String(n)).join('');if(once&&text.includes('REENTRANT_MODAL125')){once=false;throw Error('PRIVATE_REENTRANT_MODAL125');}return original.apply(this,nodes);};document.activeElement.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await until("!!window.__modal125.recovery()&&!!document.querySelector('#recovery-retry')");
  const fatalClose=await collect('fatal_close_reentrant_recovery');
  check('fatal_recovery_closes_native_and_has_one_form',!fatalClose.active&&!fatalClose.dialog_open&&fatalClose.overflow===''&&await ev("document.querySelectorAll('[data-evidence-section=advanced-settings]').length===1&&!document.querySelector('#app-recovery').textContent.includes('PRIVATE_REENTRANT_MODAL125')"));
  await click('#recovery-retry');await until('window.__modal125.ready()&&!window.__modal125.recovery()');await collect('native_recovery_retry_retains_raw_file');
  const recoveredFile=await sameControls();check('native_recovery_retry_keeps_actual_file_and_edit',recoveredFile.same_file&&recoveredFile.file_in_form&&await ev("window.__refs123.file.isConnected&&window.__modal125.project().items.find(i=>i.cost_id==='freight').cost_name==='REENTRANT_MODAL125'"));
  check('source_unchanged_through_native_checks', JSON.stringify(fingerprints) === JSON.stringify(modalRecoveryFingerprints()));
  check('only_local_resources', requests.length > 0 && requests.every(url => url.startsWith('http://127.0.0.1:' + port + '/') || /^(data:|blob:)/.test(url)));
  check('no_uncaught_browser_exceptions', exceptions.length === 0 && !unexpectedDialog);
  const report = {phase:125, kind: 'CURRENT_MOBILE_MODAL_RECOVERY_BROWSER_EVIDENCE', source_fingerprints: fingerprints,
    original_app_blob: blob(original), app_probe_appended_only: true, component_source_transformed: false,
    checks,states,layouts,findings,fixed,retained_previous_fixes:retained,file_retention_cases:fileCases,file_read_ownership:fileOwnership,exceptions, unexpected_dialog: unexpectedDialog,navigation_prompts:navigationPrompts,driver_navigation_bounded:true,cdp_command_timeout_ms:30000,
    actual_form_nodes_used: true, invalid_text_evidence: invalidEvidence, file_reference_method: 'DataTransfer assignment without dispatch; not a native file picker',
    number_input_coverage: 'Inventory records actual numeric input count; no artificial number controls added',
    direct_fault_probes_distinct_from_app_fallback: true, synthetic_business_edits: true,
    production_source_changed: true, client_runtime_changed: true, original_application_listeners_wrapped: false,
    full_workbench_switch: false, isolated_mobile_component_installed: false, findings_fixed: true,
    real_phone_verified: false, professional_review_verified: false, remote_ci_executed: false,
    project_file_writes: 0, main_updated: false, pages_updated: false, publication_status: 'HELD_LOCAL_BY_USER', local_only: true};
  await writeFile(join(out, 'fee-modal-recovery-browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({checks: Object.keys(checks).length, states: states.length, layouts: layouts.length, reproducedFindings: findings.length, resolvedFindings:fixed.length,findingsFixed:true, complete: true}));
} catch (error) {
  let current = null; try {const result = await page?.call('Runtime.evaluate', {expression: `({state:${snapshot},tab:window.__tab123?{first:window.__tab123.first.outerHTML,last:window.__tab123.last.outerHTML,active:document.activeElement.outerHTML,lastIsActive:document.activeElement===window.__tab123.last}:null})`, returnByValue: true}); current = result?.result?.value;} catch {}
  await writeFile(join(out, 'browser-failure.json'), JSON.stringify({error: String(error),source_fingerprints:fingerprints,current,states,checks,findings,exceptions}, null, 2) + '\n');
  throw error;
} finally {
  try {if (browser && target) await browser.call('Target.closeTarget', {targetId: target});}
  finally {page?.ws.close(); browser?.ws.close(); await server.close();}
}
