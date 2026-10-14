import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { strFromU8, unzipSync } from 'fflate';

const root = process.env.BROWSER_CHECK_OUTPUT ?? join(tmpdir(),'cocudtt-funding');
await mkdir(root,{recursive:true});
const server = await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom'});
let project,legacy;
try {
  const {actualQuotesProject} = await server.ssrLoadModule('/tests/fixtures/actual-quotes.ts');
  project=actualQuotesProject();project.incoterm='FOB';
  const {newSettlementPlan} = await server.ssrLoadModule('/src/domain/settlement.ts');
  const {settlementBinding} = await server.ssrLoadModule('/src/data/settlement-context.ts');
  legacy=newSettlementPlan(settlementBinding(project));legacy.version='1.0';delete legacy.funding;legacy.notes='LEGACY_KEEP_491';
} finally {await server.close();}
const targets=await(await fetch(`http://127.0.0.1:${process.env.BROWSER_CHECK_PORT??'9365'}/json`)).json();
const ws=new WebSocket(targets.find(t=>t.type==='page'&&!t.url.startsWith('edge://')).webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
let next=0;const pending=new Map(),exceptions=[],requests=[];
ws.onmessage=event=>{const r=JSON.parse(event.data);if(r.method==='Runtime.exceptionThrown')exceptions.push(r.params.exceptionDetails.text);if(r.method==='Network.requestWillBeSent')requests.push(r.params.request.url);const p=pending.get(r.id);if(p){pending.delete(r.id);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result)}};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function until(expression){for(let n=0;n<80;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100))}throw Error(expression)}
async function upload(id,text){await evaluate(`(()=>{const e=document.querySelector('#${id}'),d=new DataTransfer();d.items.add(new File([${JSON.stringify(text)}],'synthetic.json',{type:'application/json'}));e.files=d.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await new Promise(r=>setTimeout(r,150));}
const helpers=`const field=(key,value)=>{const e=document.querySelector('[data-settlement-row="funding"][data-settlement-field="'+key+'"]');e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};`;
async function funding(key,value){await evaluate(`(()=>{${helpers}field(${JSON.stringify(key)},${JSON.stringify(value)});})()`)}
const allText=bytes=>Object.values(unzipSync(bytes)).map(data=>strFromU8(data)).join('\n');
async function capture(action){await evaluate(`window.savedCapture=null;window.showSaveFilePicker=async()=>({name:'captured',createWritable:async()=>({write:async data=>{if(data instanceof Blob){const bytes=new Uint8Array(await data.arrayBuffer());window.savedCapture={base64:btoa(Array.from(bytes,c=>String.fromCharCode(c)).join(''))}}else window.savedCapture={text:data};},close:async()=>{}})});document.querySelector('[data-action="${action}"]').click()`);await until('!!window.savedCapture');return evaluate('window.savedCapture');}
try {
  await call('Runtime.enable');await call('Page.enable');await call('Network.enable');
  await call('Page.navigate',{url:pathToFileURL(resolve('trade-cost-engine.html')).href});await until("!!document.querySelector('#file-input')");await upload('file-input',JSON.stringify(project));
  await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  const checks={},before=await evaluate("localStorage.getItem('trade-cost-engine:draft-v1')");
  await evaluate("document.querySelector('[data-action=settlement-create]').click()");
  checks.blankNotZero=await evaluate("!document.querySelector('[data-funding-result]')&&document.body.innerText.includes('空白当零成本')");
  await evaluate(`(()=>{${helpers}for(const [key,value]of Object.entries({status:'PROVIDED',kind:'FINANCING',party:'SELLER',principal:'12000',currency:'USD',start_date:'2026-09-01',end_date:'2026-10-01',annual_rate:'6',day_basis:'ACT_360',reference:'PRIVATE_FUNDING_BROWSER_817'}))field(key,value);})()`);
  checks.simpleInterest=await evaluate("document.querySelector('[data-funding-result]').innerText.includes('60 USD')&&document.querySelector('[data-funding-result]').textContent.includes('12000 × 6 ÷ 100 × 30 ÷ 360')");
  checks.independentPaymentPrerequisites=await evaluate("!document.querySelector('[data-settlement-result]')&&!!document.querySelector('[data-funding-result]')");
  await funding('kind','OPPORTUNITY');checks.opportunitySeparate=await evaluate("document.querySelector('[data-funding-result]').innerText.includes('机会成本')&&document.body.innerText.includes('不加进计划收付')");
  await funding('annual_rate','');checks.missingRateBlocks=await evaluate("!document.querySelector('[data-funding-result]')&&document.querySelector('[data-funding-error]').innerText.includes('年利率')");
  await funding('annual_rate','0');checks.explicitZero=await evaluate("document.querySelector('[data-funding-result]').innerText.includes('0 USD')");await funding('annual_rate','6');
  await funding('end_date','2026-09-01');checks.sameDayZero=await evaluate("document.querySelector('[data-funding-result]').innerText.includes('实际 0 天')");
  await funding('end_date','2026-08-31');checks.reversedDatesBlock=await evaluate("!document.querySelector('[data-funding-result]')&&document.body.innerText.includes('不能早于')");
  await evaluate(`(()=>{${helpers}field('principal','36500');field('annual_rate','10');field('start_date','2024-01-01');field('end_date','2025-01-01');field('day_basis','ACT_365F');})()`);
  checks.leapFixed365=await evaluate("document.querySelector('[data-funding-result]').innerText.includes('3660 USD')&&document.querySelector('[data-funding-result]').innerText.includes('366 天 ÷ 365')");
  await funding('status','NOT_MODELED');checks.omittedNotZero=await evaluate("!!document.querySelector('[data-funding-omitted]')&&!document.querySelector('[data-funding-result]')&&document.querySelector('[data-settlement-field=principal]').value==='36500'");await funding('status','PROVIDED');
  checks.projectDraftKept=before===await evaluate("localStorage.getItem('trade-cost-engine:draft-v1')");
  const plan=await capture('settlement-save');checks.version11=JSON.parse(plan.text).version==='1.1'&&JSON.parse(plan.text).funding.reference==='PRIVATE_FUNDING_BROWSER_817';await writeFile(join(root,'example-settlement-plan.json'),plan.text);
  const workbook=await capture('export-internal-xlsx');const bytes=Buffer.from(workbook.base64,'base64');await writeFile(join(root,'example-internal.xlsx'),bytes);const text=allText(bytes);checks.internalWorkbook= text.includes('付款计划')&&text.includes('资金占用假设')&&text.includes('PRIVATE_FUNDING_BROWSER_817')&&text.includes('36500 × 10');
  const html=await capture('export-report');checks.internalHtml=html.text.includes('PRIVATE_FUNDING_BROWSER_817')&&html.text.includes('资金机会成本假设');
  await evaluate("(()=>{document.querySelector('[data-action=preview-customer-quote]').click();const e=document.querySelector('[data-customer-field=reviewed]');e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}))})()");
  const customer=await capture('export-customer-xlsx');checks.customerWorkbookIsolated=!allText(Buffer.from(customer.base64,'base64')).includes('PRIVATE_FUNDING_BROWSER_817');
  const customerHtml=await capture('export-customer-quote');checks.customerHtmlIsolated=!customerHtml.text.includes('PRIVATE_FUNDING_BROWSER_817');
  await evaluate("window.savedBytes=null;window.showSaveFilePicker=()=>new Promise(r=>window.finishPicker=r);document.querySelector('[data-action=export-internal-xlsx]').click()");await funding('reference','LATER_FUNDING_BROWSER_927');
  await evaluate("window.finishPicker({name:'internal.xlsx',createWritable:async()=>({write:async b=>{const bytes=new Uint8Array(await b.arrayBuffer());window.savedBytes=btoa(Array.from(bytes,c=>String.fromCharCode(c)).join(''))},close:async()=>{}})})");await until('!!window.savedBytes');const captured=allText(Buffer.from(await evaluate('window.savedBytes'),'base64'));checks.excelSnapshot= captured.includes('PRIVATE_FUNDING_BROWSER_817')&&!captured.includes('LATER_FUNDING_BROWSER_927');
  await evaluate("(()=>{const e=document.querySelector('[data-path=\"term_scenarios.FOB.quote.amount\"]');e.value='12000';e.dispatchEvent(new Event('change',{bubbles:true}))})()");checks.quoteChangeBlocks=await evaluate("!document.querySelector('[data-funding-result]')&&document.querySelector('[data-funding-error]').innerText.includes('重新绑定')");await evaluate("document.querySelector('[data-action=settlement-rebind]').click()");checks.rebindKeepsInput=await evaluate("document.querySelector('[data-funding-result]').innerText.includes('3660 USD')&&document.querySelector('[data-settlement-field=principal]').value==='36500'");
  await upload('file-input',JSON.stringify(project));await upload('settlement-file-input',JSON.stringify(legacy));checks.legacyNoDefaults=await evaluate("!!document.querySelector('[data-action=settlement-enable-funding]')&&!document.querySelector('[data-settlement-row=funding]')");await evaluate("document.querySelector('[data-action=settlement-enable-funding]').click()");checks.explicitUpgrade=await evaluate("document.querySelector('[data-settlement-field=notes]').value==='LEGACY_KEEP_491'&&document.querySelector('[data-settlement-field=principal]').value===''");
  await upload('settlement-file-input',plan.text);const directory=join(root,'downloads',String(Date.now()));await mkdir(directory,{recursive:true});await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:resolve(directory)});await evaluate("window.showSaveFilePicker=undefined;document.querySelector('[data-action=export-internal-xlsx]').click()");let real;for(let n=0;n<60;n++){const {readdir}=await import('node:fs/promises');const files=(await readdir(directory)).filter(f=>f.endsWith('.xlsx'));if(files.length){real=await readFile(join(directory,files[0]));break;}await new Promise(r=>setTimeout(r,100));}checks.realWorkbookDownload=!!real&&allText(real).includes('PRIVATE_FUNDING_BROWSER_817');
  const layouts=[];for(const width of [1440,768,390,320]){await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});await evaluate("document.querySelector('[data-evidence-section=settlement]').open=true;document.querySelector('[data-settlement-row=funding]').scrollIntoView()");layouts.push(await evaluate('({viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth})'));await writeFile(join(root,'funding-'+width+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));}
  checks.noNetworkResources=requests.every(u=>/^(file:|blob:|data:)/.test(u));const result={checks,layouts,exceptions,offlineVerified:true,realHeadlessDownloadVerified:true,savePickerUsesApiSubstitute:true,actualMobileVerified:false};await writeFile(join(root,'funding-browser-report.json'),JSON.stringify(result,null,2));if(Object.values(checks).some(v=>v!==true)||layouts.some(l=>l.content>l.viewport)||exceptions.length)throw Error(JSON.stringify(result));console.log(JSON.stringify(result,null,2));
} finally {await call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});ws.close();}
