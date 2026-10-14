import {unzipSync,strFromU8} from 'fflate';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const root = process.env.BROWSER_CHECK_OUTPUT ?? join(tmpdir(), 'cocudtt-excel');
await mkdir(root, { recursive: true });
const server = await createServer({ configFile: false, optimizeDeps:{noDiscovery:true,include:[]}, server: { middlewareMode: true }, appType: 'custom' });
let fixture,simulated;
try {
 const {actualQuotesProject}=await server.ssrLoadModule('/tests/fixtures/actual-quotes.ts');
 fixture=actualQuotesProject();fixture.incoterm='FOB';fixture.name='PRIVATE_PROJECT_822';fixture.goods.seller_goods_cost.amount='82763.128';fixture.items[0].cost_name='PRIVATE_COST_671';fixture.items[1].notes='PRIVATE_NOTES_919';fixture.term_scenarios.FOB.quote_evidence.reference='PRIVATE_SOURCE_678';fixture.term_scenarios.FOB.responsibility_overrides.insurance.reason='PRIVATE_CONTRACT_919';
 simulated=structuredClone(fixture);simulated.anchor={kind:'FIXED_QUOTE'};simulated.quote={amount:'10000',currency:'CNY',fx_type:'CONTRACT'};
}finally{await server.close();}
const targets = await (await fetch(`http://127.0.0.1:${process.env.BROWSER_CHECK_PORT ?? '9360'}/json`)).json();
const ws = new WebSocket(targets.find(t => t.type === 'page' && !t.url.startsWith('edge://')).webSocketDebuggerUrl);
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
  await evaluate(`(async()=>{const input=document.querySelector('#file-input'),data=new DataTransfer();data.items.add(new File([${JSON.stringify(JSON.stringify(project))}],'synthetic-customer-quote.json',{type:'application/json'}));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,150));})()`);
}
try {
 await call('Runtime.enable');await call('Page.enable');await call('Page.navigate',{url:pathToFileURL(resolve('trade-cost-engine.html')).href});await until("!!document.querySelector('#file-input')");await upload(fixture);
 const checks={};const helpers=`const field=(key,value)=>{const e=document.querySelector('[data-customer-field="'+key+'"]');if(e.type==='checkbox')e.checked=value;else e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};`;
 checks.initiallyBlocked=await evaluate("document.querySelector('[data-action=export-customer-xlsx]').disabled");
 await evaluate(`(()=>{${helpers}field('reference','PUBLIC-EXCEL-001');field('remarks','=HYPERLINK("https://example.invalid","text")');field('reviewed',true);})()`);
 const before=await evaluate("localStorage.getItem('trade-cost-engine:draft-v1')");
 async function capture(action){
  return evaluate(`(async()=>{let bytes=[],name='';window.showSaveFilePicker=async o=>{name=o.suggestedName;return{name,createWritable:async()=>({write:async data=>{bytes=Array.from(new Uint8Array(await data.arrayBuffer()))},close:async()=>{}})}};document.querySelector('[data-action="${action}"]').click();await new Promise(r=>setTimeout(r,250));return{bytes,name}})()`);
 }
 const customer=await capture('export-customer-xlsx'),internal=await capture('export-internal-xlsx');
 await writeFile(join(root,'browser-customer.xlsx'),new Uint8Array(customer.bytes));await writeFile(join(root,'browser-internal.xlsx'),new Uint8Array(internal.bytes));
 const all=bytes=>Object.values(unzipSync(new Uint8Array(bytes))).map(v=>strFromU8(v)).join('');
 const customerAll=all(customer.bytes),internalAll=all(internal.bytes);
 checks.customerBoundary=customerAll.includes('PUBLIC-EXCEL-001')&&!customerAll.includes('PRIVATE_')&&!customerAll.includes('seller_goods_cost')&&!customerAll.includes('82763.128');
 checks.nativeNumericAmount=customerAll.includes('<v>10000</v>');checks.noFormulas=!/<f[ >]|TargetMode="External"/.test(customerAll);
 checks.publicFilename=customer.name==='PUBLIC-EXCEL-001-客户报价草稿.xlsx';checks.internalKept=internalAll.includes('PRIVATE_PROJECT_822')&&internalAll.includes('seller_goods_cost')&&internalAll.includes('PRIVATE_SOURCE_678');checks.draftUnchanged=before===await evaluate("localStorage.getItem('trade-cost-engine:draft-v1')");
 await evaluate(`(()=>{${helpers}field('remarks','修改后');})()`);checks.publicEditInvalidates=await evaluate("document.querySelector('[data-action=export-customer-xlsx]').disabled");
 await evaluate(`(()=>{${helpers}field('reviewed',true);const e=document.querySelector('[data-path="term_scenarios.FOB.quote.amount"]');e.value='1234567890123456';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 checks.projectEditInvalidates=await evaluate("document.querySelector('[data-action=export-customer-xlsx]').disabled");await evaluate(`(()=>{${helpers}field('reviewed',true)})()`);
 const precision=all((await capture('export-customer-xlsx')).bytes);checks.precisionText=precision.includes('>1234567890123456</t>')&&precision.includes('s="3"');
 const layouts=[];for(const width of [1440,768,390,320]){await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});await evaluate("document.querySelector('[data-evidence-section=customer-quote]').open=true");layouts.push(await evaluate('({viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth})'));await writeFile(join(root,'excel-app-'+width+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));}
 const unchanged=await evaluate("localStorage.getItem('trade-cost-engine:draft-v1')");
 await evaluate(`(async()=>{const e=new Error('cancel');e.name='AbortError';window.showSaveFilePicker=async()=>{throw e};document.querySelector('[data-action=export-customer-xlsx]').click();await new Promise(r=>setTimeout(r,150))})()`);
 checks.cancelled=await evaluate("document.body.innerText.includes('已取消客户报价 Excel 草稿')");
 await evaluate(`(async()=>{window.showSaveFilePicker=async()=>({name:'x.xlsx',createWritable:async()=>({write:async()=>{throw new Error('disk-full')},close:async()=>{}})});document.querySelector('[data-action=export-internal-xlsx]').click();await new Promise(r=>setTimeout(r,150))})()`);
 checks.writeFailure=await evaluate("document.body.innerText.includes('内部成本 Excel导出失败')&&document.body.innerText.includes('disk-full')");
 checks.failureKeepsDraft=unchanged===await evaluate("localStorage.getItem('trade-cost-engine:draft-v1')");
 const downloadDirectory=join(root,'downloads',String(Date.now()));await mkdir(downloadDirectory,{recursive:true});await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:resolve(downloadDirectory)});
 await evaluate("window.showSaveFilePicker=undefined;document.querySelector('[data-action=export-customer-xlsx]').click()");await new Promise(r=>setTimeout(r,800));
 const downloaded=await readFile(join(downloadDirectory,customer.name));checks.realDownload=all(downloaded).includes('>1234567890123456</t>');checks.downloadKeepsDraft=unchanged===await evaluate("localStorage.getItem('trade-cost-engine:draft-v1')");
 await upload(simulated);checks.simulationBlocked=await evaluate("document.querySelector('[data-action=export-customer-xlsx]').disabled");
 const report={checks,layouts,exceptions,realHeadlessDownloadVerified:true,savePickerUsesApiSubstitute:true,actualMobileVerified:false};
 await writeFile(join(root,'excel-browser-report.json'),JSON.stringify(report,null,2));if(Object.values(checks).some(v=>v!==true)||layouts.some(l=>l.content>l.viewport)||exceptions.length)throw Error(JSON.stringify(report));console.log(JSON.stringify(report,null,2));
}finally{ws.close();}
