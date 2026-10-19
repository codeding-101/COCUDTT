import{withDocumentNavigation}from'./browser-document.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const root = process.env.BROWSER_CHECK_OUTPUT ?? join(tmpdir(), 'cocudtt-customer-quotes');
await mkdir(root, { recursive: true });
const server = await createServer({ configFile: false, optimizeDeps:{noDiscovery:true,include:[]}, server: { middlewareMode: true }, appType: 'custom' });
let fixture,simulated;
try {
 const {actualQuotesProject}=await server.ssrLoadModule('/tests/fixtures/actual-quotes.ts');
 fixture=actualQuotesProject();fixture.incoterm='FOB';fixture.name='PRIVATE_PROJECT_822';fixture.goods.seller_goods_cost.amount='82763.128';fixture.items[0].cost_name='PRIVATE_COST_671';fixture.items[1].notes='PRIVATE_NOTES_919';fixture.term_scenarios.FOB.quote_evidence.reference='PRIVATE_SOURCE_678';fixture.term_scenarios.FOB.responsibility_overrides.insurance.reason='PRIVATE_CONTRACT_919';
 simulated=structuredClone(fixture);simulated.anchor={kind:'FIXED_QUOTE'};simulated.quote={amount:'10000',currency:'CNY',fx_type:'CONTRACT'};
}finally{await server.close();}
const targets = await (await fetch(`http://127.0.0.1:${process.env.BROWSER_CHECK_PORT ?? '9359'}/json`)).json();
const ws = new WebSocket(targets.find(t => t.type === 'page' && !t.url.startsWith('edge://')).webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0; const pending = new Map(), exceptions = [];
ws.onmessage = event => {
  const response = JSON.parse(event.data);
  if (response.method === 'Runtime.exceptionThrown') exceptions.push(response.params.exceptionDetails.text);
  const request = pending.get(response.id);
  if (request) { pending.delete(response.id); response.error ? request.reject(new Error(JSON.stringify(response.error))) : request.resolve(response.result); }
};
const call = withDocumentNavigation((method, params = {}) => new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); ws.send(JSON.stringify({ id: next, method, params })); }));
async function evaluate(expression) {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function until(expression) { for (let n = 0; n < 80; n++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); } throw new Error(expression); }
async function upload(project) {
  await evaluate(`(async()=>{const input=document.querySelector('#file-input'),data=new DataTransfer();data.items.add(new File([${JSON.stringify(JSON.stringify(project))}],'synthetic-customer-quote.json',{type:'application/json'}));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,150));})()`);
}
try {
 await call('Runtime.enable');await call('Page.enable');await call('Page.navigate',{url:pathToFileURL(resolve('trade-cost-engine.html')).href});await until("!!document.querySelector('#file-input')");await upload(fixture);
 const helpers=`const field=(key,value)=>{const e=document.querySelector('[data-customer-field="'+key+'"]');if(e.type==='checkbox')e.checked=value;else e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};const button=()=>document.querySelector('[data-action="export-customer-quote"]');const preview=()=>document.querySelector('[data-customer-document]');`;
 await evaluate("document.querySelector('[data-action=preview-customer-quote]').click()");await new Promise(r=>setTimeout(r,100));
 const checks=await evaluate(`(()=>{${helpers}const before=localStorage.getItem('trade-cost-engine:draft-v1');const initiallyBlocked=button().disabled;
 for(const [key,value]of Object.entries({issuer:'公开公司',recipient:'公开客户',reference:'PUBLIC-Q-001',goods_description:'公开商品说明',delivery_terms:'按双方确认日期交付',payment_terms:'双方确认付款时间与方式',included_scope:'约定费用范围',excluded_scope:'未另约费用待确认',insurance_terms:'按双方约定投保',tax_terms:'税费口径待核对',remarks:'公开备注 <img src=x onerror=alert(1)>'}))field(key,value);
 const previewWorks=preview().innerText.includes('10,000.00 CNY')&&preview().innerText.includes('PUBLIC-Q-001')&&preview().innerHTML.includes('&lt;img');const publicPreview=!preview().innerHTML.includes('PRIVATE_');const draftUnchanged=localStorage.getItem('trade-cost-engine:draft-v1')===before;field('reviewed',true);const reviewed=!button().disabled;return{initiallyBlocked,previewWorks,publicPreview,draftUnchanged,reviewed};})()`);
 const customer=await evaluate(`(async()=>{let text='',suggested='';window.showSaveFilePicker=async options=>{suggested=options.suggestedName;return{name:'customer.html',createWritable:async()=>({write:async content=>{text=content},close:async()=>{}})}};document.querySelector('[data-action="export-customer-quote"]').click();await new Promise(r=>setTimeout(r,150));window.__customerHtml=text;return{customerExport:text.includes('PUBLIC-Q-001')&&text.includes('10,000.00 CNY')&&!text.includes('PRIVATE_'),fileNamePublic:!suggested.includes('PRIVATE_')&&suggested.includes('PUBLIC-Q-001'),noInternalSnapshot:!text.includes('seller_goods_cost')&&!text.includes('完整项目输入快照')&&!text.includes('<script')&&!text.includes('<input')};})()`);Object.assign(checks,customer);
 await writeFile(join(root,'example-customer-quote.html'),await evaluate('window.__customerHtml'));
 checks.internalKept=await evaluate(`(async()=>{let text='';window.showSaveFilePicker=async()=>({name:'internal.html',createWritable:async()=>({write:async content=>{text=content},close:async()=>{}})});document.querySelector('[data-action="export-report"]').click();await new Promise(r=>setTimeout(r,150));window.__internalHtml=text;return text.includes('PRIVATE_PROJECT_822')&&text.includes('PRIVATE_NOTES_919')&&text.includes('完整项目输入快照')})()`);
 await writeFile(join(root,'example-internal-report.html'),await evaluate('window.__internalHtml'));await writeFile(join(root,'customer-quotes-example.json'),JSON.stringify(fixture,null,2));
 Object.assign(checks,await evaluate(`(()=>{${helpers}field('reference','PUBLIC-Q-002');const publicChangeInvalidates=button().disabled;field('reviewed',true);const e=document.querySelector('[data-path="term_scenarios.FOB.quote.amount"]');e.value='12345.1234567';e.dispatchEvent(new Event('change',{bubbles:true}));const projectChangeInvalidates=button().disabled;const precision=preview().innerText.includes('12,345.1234567 CNY');const expired=preview().innerText.includes('生成日期不在');return{publicChangeInvalidates,projectChangeInvalidates,precision,expired};})()`));
 const layouts=[];for(const width of [1440,768,390,320]){await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});await evaluate("document.querySelector('[data-evidence-section=customer-quote]').open=true;document.querySelector('[data-customer-document]').scrollIntoView()");layouts.push(await evaluate('({viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth})'));await writeFile(join(root,'customer-preview-'+width+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));}
 // 取消与写盘失败保留项目，不能偷偷切换下载。
 Object.assign(checks,await evaluate(`(async()=>{${helpers}field('reviewed',true);const before=localStorage.getItem('trade-cost-engine:draft-v1');const cancel=new Error('cancel');cancel.name='AbortError';window.showSaveFilePicker=async()=>{throw cancel};button().click();await new Promise(r=>setTimeout(r,150));const cancelled=document.body.innerText.includes('已取消客户报价导出');window.showSaveFilePicker=async()=>({name:'x.html',createWritable:async()=>({write:async()=>{throw new Error('disk-full')},close:async()=>{}})});button().click();await new Promise(r=>setTimeout(r,150));return{cancelled,writeFailure:document.body.innerText.includes('客户报价导出失败')&&document.body.innerText.includes('disk-full'),failureKeepsDraft:localStorage.getItem('trade-cost-engine:draft-v1')===before}})()`));
 await upload(fixture);checks.openResets=await evaluate("document.querySelector('[data-customer-field=reference]').value===''&&!document.querySelector('[data-customer-field=reviewed]').checked");await upload(simulated);checks.simulationBlocked=await evaluate("document.querySelector('[data-action=export-customer-quote]').disabled&&document.body.textContent.includes('仅支持独立录入的实际报价')");
 await call('Page.navigate',{url:pathToFileURL(join(root,'example-customer-quote.html')).href});await until("!!document.querySelector('[data-customer-document]')");checks.customerFileOpened=await evaluate("document.body.textContent.includes('PUBLIC-Q-001')&&!document.documentElement.outerHTML.includes('PRIVATE_')&&document.querySelectorAll('script,iframe,form,input,textarea').length===0&&document.documentElement.scrollWidth<=document.documentElement.clientWidth");
 const reportLayouts=[];for(const width of [1440,390,320]){await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});reportLayouts.push(await evaluate('({viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth})'));await writeFile(join(root,'customer-file-'+width+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));}
 const report={checks,layouts,reportLayouts,exceptions,browser:'Microsoft Edge',protocol:'file://',saveUsesApiSubstitute:true,actualMobileVerified:false,realPrintPaginationVerified:false};await writeFile(join(root,'customer-quotes-browser-report.json'),JSON.stringify(report,null,2));if(Object.values(checks).some(v=>v!==true)||[...layouts,...reportLayouts].some(l=>l.content>l.viewport)||exceptions.length)throw Error(JSON.stringify(report));console.log(JSON.stringify(report,null,2));
}finally{ws.close();}
