import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const root = process.env.BROWSER_CHECK_OUTPUT ?? join(tmpdir(), 'cocudtt-templates');
await mkdir(root, { recursive: true });
const server = await createServer({ configFile: false, optimizeDeps:{noDiscovery:true,include:[]}, server: { middlewareMode: true }, appType: 'custom' });
let fixture,simulated;
try {
 const {actualQuotesProject}=await server.ssrLoadModule('/tests/fixtures/actual-quotes.ts');
 fixture=actualQuotesProject();fixture.incoterm='FOB';fixture.name='PRIVATE_PROJECT_822';fixture.goods.seller_goods_cost.amount='82763.128';fixture.items[0].cost_name='PRIVATE_COST_671';fixture.items[1].notes='PRIVATE_NOTES_919';fixture.term_scenarios.FOB.quote_evidence.reference='PRIVATE_SOURCE_678';fixture.term_scenarios.FOB.responsibility_overrides.insurance.reason='PRIVATE_CONTRACT_919';
 simulated=structuredClone(fixture);simulated.anchor={kind:'FIXED_QUOTE'};simulated.quote={amount:'10000',currency:'CNY',fx_type:'CONTRACT'};
}finally{await server.close();}
const targets = await (await fetch(`http://127.0.0.1:${process.env.BROWSER_CHECK_PORT ?? '9363'}/json`)).json();
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
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');const requests=[];ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);});
 await call('Page.navigate',{url:pathToFileURL(resolve('trade-cost-engine.html')).href});await until("!!document.querySelector('#file-input')");await upload(fixture);await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 const before=await evaluate("localStorage.getItem('trade-cost-engine:draft-v1')"),checks={},captures=[];
 const ids=['china-import-blank','china-import-container-checklist','china-import-actual-quotes','china-import-synthetic-example'];
 async function capture(selector){await evaluate(`(()=>{window.resourceText='';window.resourceName='';window.showSaveFilePicker=async o=>{window.resourceName=o.suggestedName;return{name:o.suggestedName,createWritable:async()=>({write:async s=>{window.resourceText=s},close:async()=>{}})}};document.querySelector(${JSON.stringify(selector)}).click()})()`);await until("!!window.resourceText&&!document.querySelector('[data-template-id]').disabled");return evaluate('({text:window.resourceText,name:window.resourceName})');}
 for(const id of ids){const captured=await capture(`[data-template-id="${id}"]`),expected=await readFile(resolve('templates',id+'.json'),'utf8');checks[id+'Matches']=captured.name===id+'.json'&&captured.text===expected;captures.push(captured);await writeFile(join(root,captured.name),captured.text);}
 const current=await capture('[data-schema-kind=current]'),legacy=await capture('[data-schema-kind=legacy]');checks.currentSchemaMatches=current.text===await readFile(resolve('schemas/project-0.8.schema.json'),'utf8');checks.legacySchemaMatches=legacy.text===await readFile(resolve('schemas/project-import-0.1-0.8.schema.json'),'utf8');checks.noCurrentData=[...captures,current,legacy].every(c=>!c.text.includes('PRIVATE_')&&!c.text.includes('82763.128'));checks.downloadsKeepDraft=before===await evaluate("localStorage.getItem('trade-cost-engine:draft-v1')");
 for(const c of captures){await upload(JSON.parse(c.text));checks[c.name+'Opened']=JSON.parse(await evaluate("localStorage.getItem('trade-cost-engine:draft-v1')")).project.name===JSON.parse(c.text).name;}
 await upload(fixture);await evaluate("window.pickerCalls=0;window.showSaveFilePicker=()=>{window.pickerCalls++;return new Promise(r=>window.resourceResolve=r)};document.querySelector('[data-template-id=china-import-blank]').click();document.querySelector('[data-schema-kind=legacy]').dispatchEvent(new MouseEvent('click',{bubbles:true}))");checks.busyPreventsDuplicate=await evaluate("window.pickerCalls===1&&Array.from(document.querySelectorAll('[data-template-id],[data-schema-kind]')).every(b=>b.disabled)");
 await evaluate("window.resourceResolve({name:'blank.json',createWritable:async()=>({write:async()=>{},close:async()=>{}})})");await until("!document.querySelector('[data-template-id]').disabled");
 const unchanged=await evaluate("localStorage.getItem('trade-cost-engine:draft-v1')");await evaluate("window.showSaveFilePicker=async()=>{const e=new Error('cancel');e.name='AbortError';throw e};document.querySelector('[data-template-id=china-import-blank]').click()");await until("document.body.innerText.includes('已取消模板')");checks.cancelled=await evaluate("!document.querySelector('[data-template-id=china-import-blank]').disabled");
 await evaluate("window.showSaveFilePicker=async()=>({name:'schema.json',createWritable:async()=>({write:async()=>{throw Error('disk-full')},close:async()=>{}})});document.querySelector('[data-schema-kind=legacy]').click()");await until("document.body.innerText.includes('disk-full')");checks.failureKeepsDraft=unchanged===await evaluate("localStorage.getItem('trade-cost-engine:draft-v1')");
 const directory=join(root,'downloads',String(Date.now()));await mkdir(directory,{recursive:true});await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:resolve(directory)});await evaluate("window.showSaveFilePicker=undefined;document.querySelector('[data-template-id=china-import-container-checklist]').click()");await until("document.body.innerText.includes('已发起模板')");let downloaded;for(let i=0;i<40;i++){try{downloaded=await readFile(join(directory,'china-import-container-checklist.json'),'utf8');break;}catch{await new Promise(r=>setTimeout(r,100));}}checks.realDownload=downloaded===await readFile(resolve('templates/china-import-container-checklist.json'),'utf8');
 const old=structuredClone(fixture);old.schema_version='0.1';old.extra={highPrecision:'100000.1234567890123456789',memo:'旧文件扩展😀'};delete old.tax_profile.import.calculationMode;await upload(old);
 const migrated=JSON.parse(await evaluate("localStorage.getItem('trade-cost-engine:draft-v1')")).project;checks.oldVersionOnly=JSON.stringify(migrated)===JSON.stringify({...old,schema_version:'0.8'});checks.noImplicitChinaMode=migrated.tax_profile.import.calculationMode===undefined;
 await evaluate("window.savedProject='';window.showSaveFilePicker=async()=>({name:'migrated.json',createWritable:async()=>({write:async s=>{window.savedProject=s},close:async()=>{}})});document.querySelector('[data-action=save]').click()");await until("!!window.savedProject");const saved=JSON.parse(await evaluate('window.savedProject'));checks.precisionAndExtensionKept=saved.extra.highPrecision===old.extra.highPrecision&&saved.extra.memo===old.extra.memo;checks.savedVersion=saved.schema_version==='0.8';
 const safe=await evaluate("localStorage.getItem('trade-cost-engine:draft-v1')");await upload(JSON.parse(current.text));checks.schemaCannotReplaceProject=safe===await evaluate("localStorage.getItem('trade-cost-engine:draft-v1')");const bad={...old,schema_version:'0.9'};await upload(bad);checks.futureVersionBlocked=safe===await evaluate("localStorage.getItem('trade-cost-engine:draft-v1')");
 const layouts=[];for(const width of [1440,768,390,320]){await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});await evaluate("document.querySelector('[data-evidence-section=project-templates]').open=true;document.querySelector('[data-evidence-section=project-templates]').scrollIntoView()");layouts.push(await evaluate('({viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth})'));await writeFile(join(root,'templates-'+width+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));}
 checks.noNetworkResources=requests.every(u=>u.startsWith('file:')||u.startsWith('blob:')||u.startsWith('data:'));const report={checks,layouts,exceptions,offlineVerified:true,realHeadlessDownloadVerified:true,savePickerUsesApiSubstitute:true,actualMobileVerified:false};await writeFile(join(root,'templates-browser-report.json'),JSON.stringify(report,null,2));if(Object.values(checks).some(v=>v!==true)||layouts.some(l=>l.content>l.viewport)||exceptions.length)throw Error(JSON.stringify(report));console.log(JSON.stringify(report,null,2));
}finally{await call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});ws.close();}

