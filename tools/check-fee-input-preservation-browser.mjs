/** Original application and real form nodes. Failure probes describe limitations, not fixed behavior. */
import {createServer} from 'vite';
import {readFileSync, existsSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, join, relative} from 'node:path';
import {createHash} from 'node:crypto';
import {withDocumentNavigation} from './browser-document.mjs';
import {inputPreservationFingerprints} from './fee-input-preservation-evidence.mjs';

if (process.env.INPUT_PRESERVATION_DEDICATED !== '1' || !/^\d{4,5}$/.test(process.env.BROWSER_CHECK_PORT ?? '')) {
  throw Error('Dedicated local browser required');
}
const root = resolve(import.meta.dirname, '..');
const out = resolve(process.env.BROWSER_CHECK_OUTPUT ?? 'benchmark-results/fee-mobile-settings');
const port = 4230;
await mkdir(out, {recursive: true});
if (['source-start.json','browser-progress.json','browser-failure.json','fee-input-preservation-browser.json'].some(file => existsSync(join(out,file)))) {
  throw Error('Keep every browser attempt in a separate directory');
}
const fingerprints = inputPreservationFingerprints();
await writeFile(join(out,'source-start.json'),JSON.stringify({phase:124,started_at:new Date().toISOString(),source_fingerprints:fingerprints},null,2)+'\n');
const blob = source => createHash('sha1').update('blob ' + Buffer.byteLength(source) + '\0').update(source).digest('hex');
const original = readFileSync(join(root, 'src/ui/app.ts'), 'utf8').replace(/\r\n/g, '\n');
if (blob(original) !== fingerprints['src/ui/app.ts']) throw Error('Original app pin');
const bridge = String.raw`
window.__mobile123={controller:mobileSettings,ready:()=>workflow.stateInitialized&&!workflow.pendingCalculation&&!!captureCurrentFeeWorkbench(),pending:()=>workflow.pendingCalculation,project:()=>state.project,error:()=>state.error,files:()=>JSON.stringify(captureCurrentFeeWorkbench().files),recovery:()=>workflow.recoveryStage,render:()=>render(),localRefresh:()=>{feeTaxWorkspace.refresh();feePrecisionWorkspace.refresh();feeEnvelopeWorkspace.refresh();},newProject:()=>newProject('china-sample')};
`;
const server = await createServer({root, configFile: false, optimizeDeps: {noDiscovery: true, include: []},
  server: {host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null},
  plugins: [{name: 'mobile123-original-app-probe', enforce: 'pre', transform(code, id) {
    if (relative(root, id.split('?')[0]).replaceAll('\\', '/') !== 'src/ui/app.ts') return null;
    if (code.replace(/\r\n/g, '\n') !== original) throw Error('Unpinned application response');
    return {code: code + bridge, map: null};
  }}],
});
const states = [], checks = {}, findings = [], fixed = [], exceptions = [], requests = [], layouts = [];
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
 const api=window.__mobile123,d=document.querySelector('#mobile-settings-dialog'),p=document.querySelector('[data-evidence-section="advanced-settings"]'),h=d?.querySelector('[data-mobile-settings-host]'),m=document.querySelector('[data-mobile-settings-placeholder]'),a=document.activeElement;
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
    try{await width(value);await navigate('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});await until('window.__mobile123?.ready()??false');}
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
  const open = async () => {await click('[data-action="show-mobile-settings"]'); await until('window.__mobile123.controller.isOpen&&document.querySelector("#mobile-settings-dialog").open');};
  const remember = async () => ev(String.raw`(()=>{
    const panel=document.querySelector('[data-evidence-section="advanced-settings"]'),file=panel.querySelector('input[type=file]'),transfer=new DataTransfer();transfer.items.add(new File(['SYNTHETIC_RAW123'],'local-contract123.json',{type:'application/json',lastModified:123}));file.files=transfer.files;
    window.__refs123={panel,parent:panel.parentNode,next:panel.nextSibling,file,fileObject:file.files[0],filesEvidence:window.__mobile123.files(),project:window.__mobile123.project(),controls:[...panel.querySelectorAll('input,select,textarea')].map(e=>({node:e,value:e.value,checked:e.checked,bad:e.validity?.badInput??false,files:e.files?[...e.files]:null}))};return{controls:window.__refs123.controls.length,file_id:file.id};
  })()`);
  const sameControls = async () => ev(String.raw`(()=>{const r=window.__refs123,p=document.querySelector('[data-evidence-section="advanced-settings"]'),current=[...p.querySelectorAll('input,select,textarea')];return{same_panel:r.panel===p,same_nodes:current.length===r.controls.length&&r.controls.every((v,i)=>v.node===current[i]),same_values:r.controls.every(v=>v.node.value===v.value&&v.node.checked===v.checked&&(v.node.validity?.badInput??false)===v.bad),same_file:r.file.files[0]===r.fileObject,file_in_form:p.contains(r.file)&&r.file.files[0]===r.fileObject,original_parent:p.parentNode===r.parent,files_evidence_unchanged:window.__mobile123.files()===r.filesEvidence};})()`);
  const resolved = (id, observed, evidence) => {check('fixed_' + id, observed);fixed.push({id,status:'FIXED_AND_REPLAYED',fixed:true,evidence});};
  const finding = (id, observed, evidence) => {check('finding_' + id, observed); findings.push({id, status: 'REPRODUCED_ON_UNCHANGED_SOURCE', fixed: false, evidence});};

  await fresh(701);
  const desktop = await ev("window.__mobile123.controller.open(document.querySelector('[data-action=\"show-mobile-settings\"]'))");
  check('701_rejects_modal', desktop === false && !(await collect('desktop_701')).active);
  await width(700); await remember();
  await open(); const opened = await collect('open_700'), during = await sameControls();
  check('700_uses_same_actual_form', opened.active && opened.dialog_open && opened.panel_in_host && opened.placeholder && opened.controls > 50 && during.same_panel && during.same_nodes && during.same_values && during.same_file && during.file_in_form);
  const savedReturn = await ev('({x:window.__mobile123.controller.point.x,y:window.__mobile123.controller.point.y})');
  await click('[data-action="close-mobile-settings"]'); await until('!window.__mobile123.controller.isOpen');
  const closed = await collect('close_700'), after = await sameControls();
  check('close_keeps_raw_and_file_references', after.same_nodes && after.same_values && after.same_file && after.file_in_form && after.original_parent && after.files_evidence_unchanged);
  check('close_restores_focus_and_scroll', closed.focus_action === 'show-mobile-settings' && Math.abs(closed.window_scroll[0] - savedReturn.x) <= 1 && Math.abs(closed.window_scroll[1] - savedReturn.y) <= 1 && !closed.placeholder && closed.overflow === '');

  for (const value of [700, 390, 320]) {
    await width(value); await open();
    const layout = await ev(`(()=>{const d=document.querySelector('#mobile-settings-dialog'),h=d.querySelector('[data-mobile-settings-host]');return{width:${value},viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth,dialog_width:d.getBoundingClientRect().width,dialog_content:d.scrollWidth,dialog_client:d.clientWidth,host_content:h.scrollWidth,host_client:h.clientWidth,open:d.open};})()`);
    layouts.push(layout);
    check('layout_' + value, layout.open && layout.content <= layout.viewport && layout.dialog_width <= value && layout.dialog_content <= layout.dialog_client && layout.host_content <= layout.host_client);
    if (value === 390 || value === 320) await writeFile(join(out, 'mobile-panel-' + value + '.png'), Buffer.from((await page.call('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false})).data, 'base64'));
    await key('Escape', 27); await until('!window.__mobile123.controller.isOpen');
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
  await ev("window.__mobile123.controller.dismiss();window.__mobile123.controller.open(document.querySelector('[data-action=\"show-mobile-settings\"]'));void 0");
  await new Promise(ok => setTimeout(ok, 40));
  const reopened = await collect('queued_close_reopened'); check('queued_close_does_not_dismiss_reopen', reopened.active && reopened.dialog_open);
  await ev('window.__mobile123.controller.dismiss();void 0');

  await fresh(); await remember(); await open();
  await ev("document.querySelector('[data-mobile-settings-host]').scrollTop=600;window.__hostScroll123=document.querySelector('[data-mobile-settings-host]').scrollTop;window.__mobile123.render();void 0");
  await until('window.__mobile123.ready()');
  const redrawn = await collect('same_project_redraw');
  check('same_project_keeps_modal_and_host_scroll', redrawn.active && redrawn.dialog_open && redrawn.panel_in_host && await ev("Math.abs(document.querySelector('[data-mobile-settings-host]').scrollTop-window.__hostScroll123)<=1"));
  const redrawRetention = await sameControls();
  resolved('rerender_replaces_selected_file', !redrawRetention.same_panel&&redrawRetention.file_in_form&&redrawn.selected_files===1&&redrawRetention.same_file,{state:'same_project_redraw',original_file_node_connected:await ev('window.__refs123.file.isConnected'),file_retained_by_application:true});
  await ev('window.__mobile123.newProject();void 0');
  await until('window.__mobile123.ready()');
  const replaced = await collect('replacement_project');
  check('project_replacement_closes_and_resets_scroll', !replaced.active && !replaced.dialog_open && !replaced.placeholder && replaced.overflow === '' && replaced.window_scroll[1] === 0);

  await fresh(700); await open();
  await ev("window.__focus123=document.querySelector('[data-mobile-settings-host] input[data-item-field=amount]');for(let p=window.__focus123.parentElement;p;p=p.parentElement)if(p instanceof HTMLDetailsElement)p.open=true;window.__focus123.focus();void 0");
  await width(701); await until('!window.__mobile123.controller.isOpen');
  const resized = await collect('resize_701');
  check('resize_restores_same_focused_control', !resized.dialog_open && !resized.placeholder && resized.overflow === '' && await ev('document.activeElement===window.__focus123&&window.__focus123.isConnected'));

  await fresh(); await open();
  await click('[data-mobile-settings-host] input[data-item-field="amount"]');
  const editedItem = await ev('document.activeElement.dataset.item');
  await key('a', 65, 2); await page.call('Input.insertText', {text: '123.456789'});
  const pending = await collect('pending_actual_amount');
  check('native_input_marks_pending', pending.pending);
  await key('Escape', 27); await until('window.__mobile123.ready()&&!window.__mobile123.controller.isOpen');
  const committed = await collect('escape_committed_actual_amount');
  check('escape_uses_host_commit_before_return', !committed.active && await ev(`String(window.__mobile123.project().items.find(i=>i.cost_id===${JSON.stringify(editedItem)}).amount)==='123.456789'`));

  await fresh(); await open(); await click('[data-mobile-settings-host] input[data-item-field="amount"]');
  const invalidItem = await ev('document.activeElement.dataset.item');
  await key('a', 65, 2); await page.call('Input.insertText', {text: '-e'});
  await collect('invalid_text_pending');
  await key('Escape', 27); await until('!window.__mobile123.pending()');
  const invalidResult = await collect('invalid_text_return');
  const invalidEvidence = await ev(`(()=>{const i=window.__mobile123.project().items.find(i=>i.cost_id===${JSON.stringify(invalidItem)}),e=[...document.querySelectorAll('[data-item-field=amount]')].find(e=>e.dataset.item===${JSON.stringify(invalidItem)});return{model:String(i.amount),input:e.value,error:!!window.__mobile123.error(),recovery:window.__mobile123.recovery()};})()`);
  resolved('invalid_amount_uses_recovery',invalidEvidence.model==='-e'&&invalidEvidence.input==='-e'&&invalidEvidence.error&&invalidEvidence.recovery===null&&!invalidResult.pending,{state:invalidResult.label,raw_retained:true,error_code:await ev('window.__mobile123.error().includes("PRICING_INPUT_INVALID")')});
  await click('[data-evidence-section="input-review"] [data-action="locate-input-review"]');await until('window.__mobile123.controller.isOpen');check('error_locates_original_fee_field',await ev('document.activeElement.dataset.itemField==="amount"&&document.activeElement.value==="-e"'));await key('a',65,2);await page.call('Input.insertText',{text:'321.123456'});await key('Enter',13);await until('!window.__mobile123.error()&&!window.__mobile123.pending()');await collect('invalid_amount_corrected');

  await fresh(); await remember();
  await ev("document.body.style.setProperty('overflow','auto','important');void 0");
  await open(); await key('Escape', 27); await until('!window.__mobile123.controller.isOpen');
  const important = await collect('important_overflow_return');
  finding('overflow_priority_not_restored', important.overflow === 'auto' && important.priority !== 'important', {state: important.label, before: {value: 'auto', priority: 'important'}, after: {value: important.overflow, priority: important.priority}});

  await fresh(); await open();
  await ev("document.body.style.setProperty('overflow','clip','important');window.__mobile123.controller.dismiss();void 0");
  const foreign = await collect('foreign_overflow_return');
  finding('foreign_overflow_overwritten', foreign.overflow !== 'clip' || foreign.priority !== 'important', {state: foreign.label, foreign: {value: 'clip', priority: 'important'}, after: {value: foreign.overflow, priority: foreign.priority}});

  await fresh(); await remember(); await open();
  await ev("document.querySelector('[data-mobile-settings-placeholder]').remove();window.__mobile123.controller.dismiss();void 0");
  const missingMarker = await collect('missing_placeholder_return'), markerRetention = await sameControls();
  finding('missing_placeholder_leaves_hidden_form', !missingMarker.active && !missingMarker.dialog_open && missingMarker.panel_in_host && markerRetention.same_nodes && markerRetention.same_file, {state: missingMarker.label, nodes_and_file_retained: true, form_visible: false});

  await fresh();
  const missingHost = await ev("(()=>{document.querySelector('[data-mobile-settings-host]').remove();return window.__mobile123.controller.open(document.querySelector('[data-action=\"show-mobile-settings\"]'));})()");
  const hostState = await collect('missing_host_open');
  finding('missing_host_reports_open', missingHost === true && hostState.active && !hostState.dialog_open, {state: hostState.label, return_value: missingHost});

  await fresh(); await remember();
  const modalError = await ev("(()=>{const d=document.querySelector('#mobile-settings-dialog');window.__originalShow123=d.showModal;d.showModal=()=>{throw new DOMException('Synthetic showModal failure','InvalidStateError');};try{window.__mobile123.controller.open(document.querySelector('[data-action=\"show-mobile-settings\"]'));return null;}catch(e){return e.name;}})()");
  const failedShow = await collect('show_modal_failure_direct');
  finding('show_modal_failure_needs_host_recovery', modalError === 'InvalidStateError' && failedShow.active && failedShow.panel_in_host && !failedShow.dialog_open && failedShow.overflow === 'hidden', {state: failedShow.label, failure: modalError});
  await ev('window.__mobile123.controller.dismiss(false);document.querySelector("#mobile-settings-dialog").showModal=window.__originalShow123;void 0');
  const repairedShow = await collect('explicit_recovery_after_show_failure');
  check('explicit_dismiss_recovers_show_failure', !repairedShow.active && !repairedShow.panel_in_host && repairedShow.overflow === '' && (await sameControls()).same_file);

  await fresh();
  await ev("document.querySelector('#mobile-settings-dialog').showModal=()=>{throw new DOMException('Synthetic host showModal failure','InvalidStateError');};void 0");
  await click('[data-action="show-mobile-settings"]');
  await until('!!window.__mobile123.recovery()');
  const hostRecovery = await collect('host_guard_after_show_failure');
  check('application_guard_restores_body_after_show_failure', !hostRecovery.active && hostRecovery.overflow !== 'hidden' && !!hostRecovery.recovery);

  await fresh(); await remember(); await open();
  const closeError = await ev("(()=>{const d=document.querySelector('#mobile-settings-dialog');window.__originalClose123=d.close;d.close=()=>{throw Error('Synthetic close failure');};try{window.__mobile123.controller.dismiss();return false;}catch{return true;}})()");
  const failedClose = await collect('dialog_close_failure');
  finding('close_failure_leaves_modal_lock', closeError === true && !failedClose.active && failedClose.dialog_open && failedClose.overflow === 'hidden', {state: failedClose.label, form_nodes_restored: (await sameControls()).original_parent});
  await ev('document.querySelector("#mobile-settings-dialog").close=window.__originalClose123;document.querySelector("#mobile-settings-dialog").close();document.body.style.removeProperty("overflow");void 0');
  await collect('test_only_repair_after_close_failure');

  await fresh();
  await ev("window.__allSelected124=[...document.querySelectorAll('#app input[type=file]')].map((node,i)=>{const t=new DataTransfer();t.items.add(new File(['SYNTHETIC_FILE_'+i],'selection'+i+'.json',{type:'application/json'}));node.files=t.files;return{node,id:node.id,file:node.files[0]};});window.__mobile123.render();void 0");
  check('all_actual_file_inputs_survive_redraw',await ev("window.__allSelected124.length>=7&&window.__allSelected124.every(r=>document.getElementById(r.id)===r.node&&r.node.files[0]===r.file&&r.node.isConnected)"));
  await collect('all_files_retained');
  await ev('window.__mobile123.localRefresh();void 0');check('local_refreshes_keep_all_file_selections',await ev("window.__allSelected124.every(r=>document.getElementById(r.id)===r.node&&r.node.files[0]===r.file)"));await collect('local_refresh_files_retained');
  await ev('window.__mobile123.newProject();void 0');
  check('replacement_project_does_not_inherit_files',await ev("[...document.querySelectorAll('#app input[type=file]')].every(e=>e.files.length===0)&&window.__allSelected124.every(r=>!r.node.isConnected)"));
  await collect('replacement_files_cleared');
  const fileCases=await ev(String.raw`(async()=>{const{replaceWorkspaceMarkup:install}=await import('/src/ui/file-input-retention.ts'),result=[];function run(id,markup,keep,failInstall=false){const root=document.createElement('section');root.innerHTML='<p>before</p><input id="file-probe124" type="file" accept=".json"><p>after</p>';document.body.append(root);const input=root.querySelector('input'),t=new DataTransfer();t.items.add(new File(['RAW124'],'raw124.json'));input.files=t.files;const file=input.files[0],old=root.innerHTML;if(failInstall)root.replaceChildren=()=>{throw Error('Synthetic install rejection');};let threw=false;try{install(root,markup,keep);}catch{threw=true;}const value={id,threw,original_connected:root.contains(input),same_file:input.files[0]===file,unchanged:root.innerHTML===old,new_file_count:root.querySelector('input')?.files?.length??null};result.push(value);root.remove();}const good='<p>new</p><input id="file-probe124" type="file" accept=".json">';run('same-project',good,true);run('missing-target','<p>no file</p>',true);run('ambiguous-target',good+good,true);run('changed-accept',good.replace('.json','.xlsx'),true);run('failed-install',good,true,true);run('explicit-replacement',good,false);return result;})()`);
  check('file_preflight_preserves_missing_and_ambiguous',fileCases.filter(c=>['missing-target','ambiguous-target','changed-accept','failed-install'].includes(c.id)).every(c=>c.threw&&c.original_connected&&c.same_file&&c.unchanged));
  check('file_install_keeps_node_without_fake_path',fileCases.find(c=>c.id==='same-project').same_file&&fileCases.find(c=>c.id==='same-project').original_connected&&!fileCases.find(c=>c.id==='same-project').threw);
  check('file_replacement_starts_empty',fileCases.find(c=>c.id==='explicit-replacement').new_file_count===0&&!fileCases.find(c=>c.id==='explicit-replacement').original_connected);

  const fileOwnership=await ev(String.raw`(async()=>{const{replaceWorkspaceMarkup:install,takeSelectedFile:take}=await import('/src/ui/file-input-retention.ts'),root=document.createElement('section'),markup='<input id="file-reader124" type="file">';root.innerHTML=markup;document.body.append(root);const input=root.querySelector('input'),transfer=new DataTransfer();transfer.items.add(new File(['RAW_READER124'],'reader124.json'));input.files=transfer.files;const original=input.files[0],owned=take(input),cleared=input.files.length===0;const next=new DataTransfer();next.items.add(original);input.files=next.files;install(root,markup,true);const reselected=root.querySelector('input')===input&&input.files[0]===original;root.remove();return{same_file_transferred:owned===original,cleared_after_handoff:cleared,new_list_with_same_file_retained:reselected};})()`);
  check('file_reader_takes_original_and_clears_selection',fileOwnership.same_file_transferred&&fileOwnership.cleared_after_handoff);
  check('new_selection_of_same_file_is_not_consumed',fileOwnership.new_list_with_same_file_retained);
  check('source_unchanged_through_native_checks', JSON.stringify(fingerprints) === JSON.stringify(inputPreservationFingerprints()));
  check('only_local_resources', requests.length > 0 && requests.every(url => url.startsWith('http://127.0.0.1:' + port + '/') || /^(data:|blob:)/.test(url)));
  check('no_uncaught_browser_exceptions', exceptions.length === 0 && !unexpectedDialog);
  const report = {phase: 124, kind: 'CURRENT_INPUT_PRESERVATION_BROWSER_EVIDENCE', source_fingerprints: fingerprints,
    original_app_blob: blob(original), app_probe_appended_only: true, component_source_transformed: false,
    checks,states,layouts,findings,fixed,file_retention_cases:fileCases,file_read_ownership:fileOwnership,exceptions, unexpected_dialog: unexpectedDialog,navigation_prompts:navigationPrompts,driver_navigation_bounded:true,cdp_command_timeout_ms:30000,
    actual_form_nodes_used: true, invalid_text_evidence: invalidEvidence, file_reference_method: 'DataTransfer assignment without dispatch; not a native file picker',
    number_input_coverage: 'Inventory records actual numeric input count; no artificial number controls added',
    direct_fault_probes_distinct_from_host_guard: true, synthetic_business_edits: true,
    production_source_changed: true, client_runtime_changed: true, original_application_listeners_wrapped: false,
    full_workbench_switch: false, isolated_mobile_component_installed: false, findings_fixed: false,
    real_phone_verified: false, professional_review_verified: false, remote_ci_executed: false,
    project_file_writes: 0, main_updated: false, pages_updated: false, publication_status: 'HELD_LOCAL_BY_USER', local_only: true};
  await writeFile(join(out, 'fee-input-preservation-browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({checks: Object.keys(checks).length, states: states.length, layouts: layouts.length, reproducedFindings: findings.length, resolvedFindings:fixed.length,findingsFixed:false, complete: true}));
} catch (error) {
  let current = null; try {const result = await page?.call('Runtime.evaluate', {expression: `({state:${snapshot},tab:window.__tab123?{first:window.__tab123.first.outerHTML,last:window.__tab123.last.outerHTML,active:document.activeElement.outerHTML,lastIsActive:document.activeElement===window.__tab123.last}:null})`, returnByValue: true}); current = result?.result?.value;} catch {}
  await writeFile(join(out, 'browser-failure.json'), JSON.stringify({error: String(error),source_fingerprints:fingerprints,current,states,checks,findings,exceptions}, null, 2) + '\n');
  throw error;
} finally {
  try {if (browser && target) await browser.call('Target.closeTarget', {targetId: target});}
  finally {page?.ws.close(); browser?.ws.close(); await server.close();}
}
