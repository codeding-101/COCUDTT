import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const root = process.env.BROWSER_CHECK_OUTPUT ?? join(tmpdir(), 'cocudtt-logistics');
await mkdir(root, { recursive: true });
const fixtureServer = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
let fixture;
try { const module = await fixtureServer.ssrLoadModule('/tests/fixtures/logistics-project.ts'); fixture = module.logisticsProject('CIP'); }
finally { await fixtureServer.close(); }
delete fixture.term_scenarios.CIP.transport; delete fixture.term_scenarios.CIP.insurance;
const port = process.env.BROWSER_CHECK_PORT ?? '9355';
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0; const pending = new Map(); const exceptions = [];
ws.onmessage = event => {
  const response = JSON.parse(event.data);
  if (response.method === 'Runtime.exceptionThrown') exceptions.push(response.params.exceptionDetails.text);
  const request = pending.get(response.id);
  if (request) { pending.delete(response.id); response.error ? request.reject(new Error(JSON.stringify(response.error))) : request.resolve(response.result); }
};
const call = (method, params = {}) => new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); ws.send(JSON.stringify({ id: next, method, params })); });
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(expression) { for (let n = 0; n < 80; n++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(expression); }
try {
  await call('Runtime.enable'); await call('Page.enable');
  await call('Page.navigate', { url: pathToFileURL(resolve(import.meta.dirname, '..', 'trade-cost-engine.html')).href });
  await until("!!document.querySelector('#file-input')");
  const flow = await evaluate(`(async () => {
    const pause=()=>new Promise(r=>setTimeout(r,100));
    const upload=text=>{const input=document.querySelector('#file-input');const data=new DataTransfer();data.items.add(new File([text],'logistics.json',{type:'application/json'}));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));};
    upload(${JSON.stringify(JSON.stringify(fixture))});await pause();
    const set=(kind,field,value,index)=>{const e=[...document.querySelectorAll('[data-logistics-kind]')].find(e=>e.dataset.logisticsKind===kind&&e.dataset.logisticsField===field&&(index===undefined?e.dataset.segmentIndex===undefined:e.dataset.segmentIndex===String(index)));if(!e)throw Error(kind+':'+field+':'+index);if(e.type==='checkbox')e.checked=value;else e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};
    const path=(key,value)=>{const e=document.querySelector('[data-path="'+key+'"]');e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};
    const evidence=(owner,field,value)=>{const e=[...document.querySelectorAll('[data-evidence-owner]')].find(e=>e.dataset.evidenceOwner===owner&&e.dataset.evidenceId==='CIP'&&e.dataset.evidenceField===field);e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};
    const confirm=owner=>{for(const [field,value] of [['reference','合成验收资料，非真实业务凭证'],['valid_from','2026-09-01'],['valid_to','2026-09-30'],['checked_on','2026-10-12'],['status','USER_CONFIRMED']])evidence(owner,field,value);};
    const row=()=>[...document.querySelectorAll('table.compare tbody tr')].find(e=>e.querySelector('th').innerText.startsWith('CIP'));
    const missing=row().textContent.includes('尚未录入运输分段')&&row().textContent.includes('尚未录入保单保障');
    const legs=[['ROAD','汉堡工厂','汉堡港','合成公路承运人','陆运001'],['SEA','汉堡港','上海港','合成海运承运人','海运002'],['ROAD','上海港','上海仓库','合成短驳承运人','短驳003']];
    for(let n=0;n<legs.length;n++){document.querySelector('[data-action="add-transport-segment"]').click();for(const [field,value] of ['mode','from','to','carrier','contract_reference'].map((field,index)=>[field,legs[n][index]]))set('transport',field,value,n);}
    for(const [field,value] of [['delivery_segment_id','leg-1'],['delivery_location','汉堡工厂'],['delivery_event','CARRIER_HANDOVER'],['paid_to','上海仓库']])set('transport',field,value);confirm('transport');
    document.querySelector('[data-action="create-insurance-plan"]').click();
    for(const [field,value] of [['cover','ICC_A'],['clause_version','ICC 1/1/2009（合成）'],['sum_insured.amount','11770'],['insured_from','汉堡工厂'],['insured_to','上海仓库'],['insurer','合成保险人'],['policy_reference','合成保单001'],['deductible','无免赔（合成）'],['exclusions','合成除外说明'],['scope_confirmed',true],['direct_claim_confirmed',true]])set('insurance',field,value);confirm('insurance');
    const ready=row().innerText.includes('可参与排名')&&row().innerText.includes('12,695.55')&&document.querySelectorAll('[data-risk-event]').length===1;
    set('insurance','sum_insured.amount','11769.99');const lowCover=row().textContent.includes('110%')&&row().innerText.includes('参考测算');set('insurance','sum_insured.amount','11770');confirm('insurance');
    set('insurance','sum_insured.currency','USD');const currency=row().textContent.includes('保额币种');set('insurance','sum_insured.currency','CNY');confirm('insurance');
    set('insurance','cover','ICC_C');const lowerCover=row().textContent.includes('险别');set('insurance','agreed_cover_note','合成双方合同约定较低险别，待专业复核');confirm('insurance');const agreedCover=row().innerText.includes('可参与排名');set('insurance','cover','ICC_A');set('insurance','agreed_cover_note','');confirm('insurance');
    set('transport','delivery_segment_id','leg-2');set('transport','delivery_location','汉堡港');const laterCarrier=row().textContent.includes('第一承运人交货应为首段起点');
    set('transport','handover_basis','AGREED_POINT');set('transport','agreement_note','合成合同明确交给汉堡港承运人');confirm('transport');confirm('insurance');const agreedPoint=row().innerText.includes('可参与排名')&&document.querySelectorAll('[data-risk-event]').length===1;
    set('transport','delivery_segment_id','leg-1');set('transport','delivery_location','汉堡工厂');set('transport','handover_basis','FIRST_CARRIER');set('transport','agreement_note','');confirm('transport');confirm('insurance');
    path('facts.loading_mode','FCL');confirm('quote');confirm('transport');confirm('insurance');const reminders=document.body.textContent.includes('免费期')&&document.body.textContent.includes('未标记');
    document.querySelector('[data-action="add-container-preset"][data-preset="container-demurrage"]').click();
    const charge=[...document.querySelectorAll('[data-item-field="container_charge"]')].find(e=>e.value==='DEMURRAGE');const chargeId=charge.dataset.item;
    const cost=(id,field,value)=>{const e=[...document.querySelectorAll('[data-item-field="'+field+'"]')].find(e=>e.dataset.item===id);e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};
    const emptyNewFee=document.querySelectorAll('[data-item-field="days"]')[0].value==='';cost(chargeId,'days','3');cost(chargeId,'rate','20');cost(chargeId,'occurrence_reason','BUYER_FAULT');
    const ddCalculated=row().innerText.includes('12,755.55');
    document.querySelector('[data-action="add-container-preset"][data-preset="container-combined-dd"]').click();const combinedId=[...document.querySelectorAll('[data-item-field="container_charge"]')].find(e=>e.value==='COMBINED_DD').dataset.item;cost(combinedId,'days','2');cost(combinedId,'rate','10');cost(combinedId,'occurrence_reason','BUYER_FAULT');
    const ddConflict=row().textContent.includes('联合D&D')&&row().innerText.includes('参考测算');cost(combinedId,'container_charge_scope','另一箱及期间');const distinctScope=row().innerText.includes('可参与排名');
    document.querySelector('[data-action="remove-item"][data-item="'+combinedId+'"]').click();
    let saved='';window.showSaveFilePicker=async()=>({name:'logistics.json',createWritable:async()=>({write:async text=>{saved=text;},close:async()=>{}})});document.querySelector('[data-action="save"]').click();await pause();window.__logisticsProject=saved;const p=JSON.parse(saved);
    const persistence=p.schema_version==='0.8'&&p.term_scenarios.CIP.transport.segments.length===3&&p.term_scenarios.CIP.transport.evidence.values_key&&p.term_scenarios.CIP.insurance.evidence.values_key&&p.items.find(e=>e.cost_id===chargeId).applicable_incoterms.join(',')==='CIP';
    set('transport','carrier','替换承运人',0);const invalidated=row().innerText.includes('参考测算')&&[...document.querySelectorAll('[data-evidence-owner="transport"][data-evidence-field="status"]')].find(e=>e.dataset.evidenceId==='CIP').value==='UNVERIFIED';upload(saved);await pause();const roundtrip=row().innerText.includes('可参与排名')&&document.querySelectorAll('[data-risk-event]').length===1;
    let report='';window.showSaveFilePicker=async()=>({name:'logistics-report.html',createWritable:async()=>({write:async text=>{report=text;},close:async()=>{}})});document.querySelector('[data-action="export-report"]').click();await pause();window.__logisticsReport=report;
    const reportWorks=report.includes('合成公路承运人')&&report.includes('11770.00')&&report.includes('合成除外说明')&&report.includes('12,755.55')&&!report.includes('<script')&&(report.match(/data-risk-event/g)||[]).length===1;
    document.querySelectorAll('details').forEach(e=>e.open=true);
    return {missing,ready,lowCover,currency,lowerCover,agreedCover,laterCarrier,agreedPoint,reminders,emptyNewFee,ddCalculated,ddConflict,distinctScope,persistence:!!persistence,invalidated,roundtrip,reportWorks};
  })()`);
  await writeFile(join(root, 'logistics-project.json'), await evaluate('window.__logisticsProject'));
  await writeFile(join(root, 'logistics-internal-report.html'), await evaluate('window.__logisticsReport'));
  const layouts = [];
  for (const width of [1440, 390, 320]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    layouts.push(await evaluate('({viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll("*")].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>document.documentElement.clientWidth+1}).slice(0,12).map(e=>({tag:e.tagName,class:e.className,text:e.textContent.slice(0,60),right:e.getBoundingClientRect().right}))})'));
    await evaluate("document.querySelector('[data-section=\"logistics\"]').scrollIntoView()");
    await writeFile(join(root, `logistics-${width}.png`), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  }
  const report = { flow, layouts, exceptions, browser: 'Microsoft Edge', protocol: 'file://', fileSaveUsesApiSubstitute: true, realPrintPaginationVerified: false };
  await writeFile(join(root, 'logistics-browser-report.json'), JSON.stringify(report, null, 2));
  if (Object.values(flow).some(value => value !== true) || layouts.some(layout => layout.content > layout.viewport) || exceptions.length) throw new Error(JSON.stringify(report));
  console.log(JSON.stringify(report, null, 2));
} finally { ws.close(); }
