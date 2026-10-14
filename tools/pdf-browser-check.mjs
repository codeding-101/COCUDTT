import {PDFDocument, PDFRawStream, decodePDFRawStream} from 'pdf-lib';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const root = process.env.BROWSER_CHECK_OUTPUT ?? join(tmpdir(), 'cocudtt-pdf');
await mkdir(root, { recursive: true });
const server = await createServer({ configFile: false, optimizeDeps:{noDiscovery:true,include:[]}, server: { middlewareMode: true }, appType: 'custom' });
let fixture,simulated;
try {
 const {actualQuotesProject}=await server.ssrLoadModule('/tests/fixtures/actual-quotes.ts');
 fixture=actualQuotesProject();fixture.incoterm='FOB';fixture.name='PRIVATE_PROJECT_822';fixture.goods.seller_goods_cost.amount='82763.128';fixture.items[0].cost_name='PRIVATE_COST_671';fixture.items[1].notes='PRIVATE_NOTES_919';fixture.term_scenarios.FOB.quote_evidence.reference='PRIVATE_SOURCE_678';fixture.term_scenarios.FOB.responsibility_overrides.insurance.reason='PRIVATE_CONTRACT_919';
 simulated=structuredClone(fixture);simulated.anchor={kind:'FIXED_QUOTE'};simulated.quote={amount:'10000',currency:'CNY',fx_type:'CONTRACT'};
}finally{await server.close();}
const targets = await (await fetch(`http://127.0.0.1:${process.env.BROWSER_CHECK_PORT ?? '9361'}/json`)).json();
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
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');
 const requests=[];ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);});
 await call('Page.navigate',{url:pathToFileURL(resolve('trade-cost-engine.html')).href});await until("!!document.querySelector('#file-input')");await upload(fixture);
 const checks={};const helpers=`const field=(key,value)=>{const e=document.querySelector('[data-customer-field="'+key+'"]');if(e.type==='checkbox')e.checked=value;else e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};`;
 checks.initiallyBlocked=await evaluate("document.querySelector('[data-action=export-customer-pdf]').disabled");
 await evaluate(`(()=>{${helpers}field('reference','PUBLIC-PDF-001');field('remarks','公开合成报价备注');field('reviewed',true);})()`);
 await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 const before=await evaluate("localStorage.getItem('trade-cost-engine:draft-v1')");
 async function capture(){
  await evaluate(`(()=>{window.pdfCapture={bytes:[],name:''};window.showSaveFilePicker=async o=>{window.pdfCapture.name=o.suggestedName;return{name:o.suggestedName,createWritable:async()=>({write:async data=>{window.pdfCapture.bytes=Array.from(new Uint8Array(await data.arrayBuffer()))},close:async()=>{}})}};document.querySelector('[data-action=export-customer-pdf]').click()})()`);
  await until("window.pdfCapture.bytes.length>0 && !document.querySelector('[data-action=export-customer-pdf]').disabled");return evaluate('window.pdfCapture');
 }
 const captured=await capture(),bytes=new Uint8Array(captured.bytes),doc=await PDFDocument.load(bytes);
 await writeFile(join(root,'browser-customer.pdf'),bytes);
 const all=doc.context.enumerateIndirectObjects().map(([,o])=>o instanceof PDFRawStream?new TextDecoder().decode(decodePDFRawStream(o).decode()):o.toString()).join('\n');
 checks.nativePdf=new TextDecoder().decode(bytes.slice(0,8)).includes('%PDF-')&&doc.getPageCount()>=2;
 checks.publicMetadata=doc.getTitle()==='PUBLIC-PDF-001 · 报价草稿'&&doc.getAuthor()==='';
 checks.customerBoundary=!/PRIVATE_|seller_goods_cost|quote_evidence|82763\.128|JavaScript|EmbeddedFiles/.test(all);
 checks.publicFilename=captured.name==='PUBLIC-PDF-001-客户报价草稿.pdf';
 checks.draftUnchanged=before===await evaluate("localStorage.getItem('trade-cost-engine:draft-v1')");
 await evaluate(`(()=>{${helpers}field('remarks','编辑后');})()`);checks.publicEditInvalidates=await evaluate("document.querySelector('[data-action=export-customer-pdf]').disabled");
 await evaluate(`(()=>{${helpers}field('reviewed',true);window.pickerCalls=0;window.snapshotBytes=[];window.showSaveFilePicker=()=>{window.pickerCalls++;return new Promise(r=>window.resolvePicker=r)};document.querySelector('[data-action=export-customer-pdf]').click();document.querySelector('[data-action=export-customer-pdf]').dispatchEvent(new MouseEvent('click',{bubbles:true}));})()`);
 checks.busyPreventsDuplicate=await evaluate("window.pickerCalls===1&&document.querySelector('[data-action=export-customer-pdf]').disabled&&document.querySelector('[data-action=export-customer-pdf]').textContent.includes('正在生成 PDF')");
 await evaluate(`(()=>{${helpers}field('reference','PUBLIC-EDITED');window.resolvePicker({name:'snapshot.pdf',createWritable:async()=>({write:async b=>{window.snapshotBytes=Array.from(new Uint8Array(await b.arrayBuffer()))},close:async()=>{}})})})()`);await until('window.snapshotBytes.length>0');
 const snapshot=await PDFDocument.load(new Uint8Array(await evaluate('window.snapshotBytes')));checks.immutableSnapshot=snapshot.getTitle()==='PUBLIC-PDF-001 · 报价草稿';
 checks.editStillNeedsReview=await evaluate("document.querySelector('[data-action=export-customer-pdf]').disabled");
 await evaluate(`(()=>{${helpers}field('reviewed',true);window.showSaveFilePicker=async()=>{const e=new Error('cancel');e.name='AbortError';throw e};document.querySelector('[data-action=export-customer-pdf]').click()})()`);
 await until("document.body.innerText.includes('已取消客户报价 PDF 导出')");checks.cancelled=await evaluate("!document.querySelector('[data-action=export-customer-pdf]').disabled");
 await evaluate(`(()=>{${helpers}field('remarks','😀');field('reviewed',true);window.openedWriter=false;window.showSaveFilePicker=async()=>({name:'x.pdf',createWritable:async()=>{window.openedWriter=true;throw Error('unexpected writer')}});document.querySelector('[data-action=export-customer-pdf]').click()})()`);
 await until("document.body.innerText.includes('不支持字符')");checks.unsupportedGlyphPreserved=await evaluate("!window.openedWriter&&document.querySelector('[data-customer-field=remarks]').value==='😀'&&!document.querySelector('[data-action=export-customer-pdf]').disabled");
 await evaluate(`(()=>{${helpers}field('remarks','公开备注');field('reviewed',true);window.showSaveFilePicker=async()=>({name:'x.pdf',createWritable:async()=>({write:async()=>{throw Error('disk-full')},close:async()=>{}})});document.querySelector('[data-action=export-customer-pdf]').click()})()`);
 await until("document.body.innerText.includes('disk-full')");checks.writeFailureRecovered=await evaluate("document.body.innerText.includes('PDF 导出失败')&&!document.querySelector('[data-action=export-customer-pdf]').disabled");
 const unchanged=await evaluate("localStorage.getItem('trade-cost-engine:draft-v1')");
 const downloadDirectory=join(root,'downloads',String(Date.now()));await mkdir(downloadDirectory,{recursive:true});await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:resolve(downloadDirectory)});
 await evaluate("window.showSaveFilePicker=undefined;document.querySelector('[data-action=export-customer-pdf]').click()");await until("document.body.innerText.includes('已发起客户报价 PDF 草稿下载')");
 let downloaded;for(let i=0;i<40;i++){try{downloaded=await readFile(join(downloadDirectory,'PUBLIC-EDITED-客户报价草稿.pdf'));break;}catch{await new Promise(r=>setTimeout(r,100));}}
 if(!downloaded)throw Error('Actual PDF download missing');checks.realDownload=(await PDFDocument.load(downloaded)).getTitle()==='PUBLIC-EDITED · 报价草稿';checks.downloadKeepsDraft=unchanged===await evaluate("localStorage.getItem('trade-cost-engine:draft-v1')");
 await writeFile(join(root,'browser-downloaded.pdf'),downloaded);
 const layouts=[];for(const width of [1440,768,390,320]){await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});await evaluate("document.querySelector('[data-evidence-section=customer-quote]').open=true;for(let p=document.querySelector('.font-license').parentElement;p;p=p.parentElement){if(p.tagName==='DETAILS')p.open=true;}document.querySelector('[data-action=export-customer-pdf]').scrollIntoView({block:'center'})");layouts.push(await evaluate('({viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth})'));await writeFile(join(root,'pdf-app-'+width+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));}
 await upload(simulated);checks.simulationBlocked=await evaluate("document.querySelector('[data-action=export-customer-pdf]').disabled");checks.noNetworkResources=requests.every(u=>u.startsWith('file:')||u.startsWith('blob:')||u.startsWith('data:'));
 const report={checks,layouts,exceptions,offlineVerified:true,realHeadlessDownloadVerified:true,savePickerUsesApiSubstitute:true,actualMobileVerified:false};await writeFile(join(root,'pdf-browser-report.json'),JSON.stringify(report,null,2));if(Object.values(checks).some(v=>v!==true)||layouts.some(l=>l.content>l.viewport)||exceptions.length)throw Error(JSON.stringify(report));console.log(JSON.stringify(report,null,2));
}finally{await call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});ws.close();}

