import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

// 先启动使用独立配置的无界面Chromium浏览器；文件保存API仅作替身，不验证磁盘下载。
const root = process.env.BROWSER_CHECK_OUTPUT ?? join(tmpdir(), 'cocudtt-professional-review');
await mkdir(root, { recursive: true });
const port = process.env.BROWSER_CHECK_PORT ?? '9353';
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
const exceptions = [];
ws.onmessage = event => {
  const response = JSON.parse(event.data);
  if (response.method === 'Runtime.exceptionThrown') exceptions.push(response.params.exceptionDetails.text);
  const request = pending.get(response.id);
  if (request) { pending.delete(response.id); response.error ? request.reject(new Error(JSON.stringify(response.error))) : request.resolve(response.result); }
};
const call = (method, params = {}) => new Promise((resolve, reject) => { const request = ++id; pending.set(request, { resolve, reject }); ws.send(JSON.stringify({ id: request, method, params })); });
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(expression) {
  for (let n = 0; n < 80; n++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`页面状态未满足：${expression}`);
}
const navigate = async path => { await call('Page.navigate', { url: pathToFileURL(resolve(import.meta.dirname, '..', path)).href }); };
const metrics = async width => { await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 }); };
const layout = () => evaluate('({viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth})');
const screenshot = async name => writeFile(join(root, name), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
try {
  await call('Runtime.enable'); await call('Page.enable'); exceptions.length = 0;
  await metrics(1440); await navigate('trade-cost-engine.html');
  await until("!!document.querySelector('[data-action=\"new-china-import\"]')");
  await evaluate("document.querySelector('[data-action=\"new-china-import\"]').click()");
  await until("document.body.innerText.includes('901,101.49')");
  const flow = await evaluate(`(async () => {
    const set = (path, value) => { const e = document.querySelector('[data-path="'+path+'"]'); e.value=value; e.dispatchEvent(new Event('change', {bubbles:true})); };
    const intro = document.querySelector('[data-evidence-section="project-introduction"]'); intro.open=true;
    await new Promise(r=>setTimeout(r,70));
    set('incoterm','FCA');
    const missing = document.body.innerText.includes('交货地点待确认') && document.body.innerText.includes('FCA交货地点未确认');
    const introductionStayedOpen = document.querySelector('[data-evidence-section="project-introduction"]').open;
    set('facts.delivery_place','SELLER_PREMISES');
    const seller = document.body.innerText.includes('在卖方场所将货物装上买方安排的运输工具，装货完成时') && !document.body.innerText.includes('FCA交货地点未确认');
    let saved=''; window.showSaveFilePicker=async()=>({name:'fca.json',createWritable:async()=>({write:async text=>{saved=text;},close:async()=>{}})});
    document.querySelector('[data-action="save"]').click(); await new Promise(r=>setTimeout(r,150));
    const file=JSON.parse(saved); window.__savedFca=saved;
    const persistence=file.schema_version==='0.7' && file.facts.delivery_place==='SELLER_PREMISES';
    set('facts.delivery_place','OTHER');
    const other=document.body.innerText.includes('货物仍在卖方运输工具上、准备卸货') && !document.body.innerText.includes('FCA交货地点未确认');
    let report='';window.showSaveFilePicker=async()=>({name:'fca-report.html',createWritable:async()=>({write:async text=>{report=text;},close:async()=>{}})});
    document.querySelector('[data-action="export-report"]').click();await new Promise(r=>setTimeout(r,150));window.__fcaReport=report;
    const reportCorrect=report.includes('准备卸货') && report.includes('incoterms2020 · 实现版本 1.1') && !report.includes('<script');
    set('facts.delivery_place','');
    const missingAgain=document.body.innerText.includes('交货地点待确认');
    const upload=document.querySelector('input[type="file"]');
    const transfer=new DataTransfer();transfer.items.add(new File([saved],'fca.json',{type:'application/json'}));upload.files=transfer.files;upload.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,180));
    const roundtrip=document.querySelector('[data-path="facts.delivery_place"]').value==='SELLER_PREMISES' && document.body.innerText.includes('装货完成时');
    set('incoterm','FOB');set('facts.shipping_terms','LINER');
    const preset=document.querySelector('[data-action="add-preset"]');preset.value='thc-origin';preset.dispatchEvent(new Event('change',{bubbles:true}));
    const name=[...document.querySelectorAll('[data-item-field="cost_name"]')].find(e=>e.value==='起运港港杂费');
    const costId=name.dataset.item;
    for (const [field,value] of [['quantity','1'],['rate','150']]) {
      const parameter=[...document.querySelectorAll('[data-item-field="'+field+'"]')].find(e=>e.dataset.item===costId);parameter.value=value;parameter.dispatchEvent(new Event('change',{bubbles:true}));
    }
    document.querySelectorAll('details').forEach(e=>e.open=true);
    const linerPending=document.body.innerText.includes('FOB班轮条件不能确定全部起运港港杂费') && document.body.innerText.includes('待确认');
    set('facts.shipping_terms','');document.querySelectorAll('details').forEach(e=>e.open=true);
    const standardRestored=!document.body.innerText.includes('FOB班轮条件不能确定全部起运港港杂费');
    return {missing,seller,other,missingAgain,persistence,roundtrip,reportCorrect,introductionStayedOpen,linerPending,standardRestored};
  })()`);
  if (Object.values(flow).some(value=>value!==true)) throw new Error(JSON.stringify(flow));
  await writeFile(join(root,'fca-project-example.json'),await evaluate('window.__savedFca'));
  await writeFile(join(root,'fca-report-example.html'),await evaluate('window.__fcaReport'));
  await metrics(320);const toolMobile=await layout();await screenshot('professional-tool-mobile.png');
  await navigate('project-introduction.html');await until("document.title.includes('项目介绍')");
  const introMobile=await layout();await screenshot('project-introduction-mobile.png');
  const offlineIntro=await evaluate("document.querySelectorAll('script,link[rel=stylesheet],img[src],iframe').length===0 && document.querySelector('a.button').getAttribute('href')==='trade-cost-engine.html'");
  await metrics(1440);const introDesktop=await layout();await screenshot('project-introduction-desktop.png');
  await call('Emulation.setEmulatedMedia',{media:'print'});const introPrint=await layout();await call('Emulation.setEmulatedMedia',{media:''});
  // Vite静态构建的模块入口按HTTP验收；单文件工具在上方按file://验收。
  const preview = process.env.BROWSER_CHECK_PREVIEW ?? 'http://127.0.0.1:4353';
  await call('Page.navigate',{url:preview+'/project-introduction.html'});
  await until("location.protocol==='http:' && document.title.includes('项目介绍')");
  const staticEntryLink=await evaluate("document.querySelector('a.button').getAttribute('href')==='index.html'");
  await evaluate("document.querySelector('a.button').click()");await until("!!document.querySelector('[data-action=\"new-china-import\"]')");
  const staticEntryWorks=await evaluate("!!document.querySelector('[data-evidence-section=\"project-introduction\"]')");
  const report={flow,toolMobile,introMobile,introDesktop,introPrint,offlineIntro,staticEntryLink,staticEntryWorks,exceptions,browser:'Microsoft Edge',protocols:['file://','http://127.0.0.1'],fileSaveUsesApiSubstitute:true,realPrintPaginationVerified:false};
  await writeFile(join(root,'professional-review-browser-report.json'),JSON.stringify(report,null,2));
  if ([toolMobile,introMobile,introDesktop,introPrint].some(x=>x.content>x.viewport)||!offlineIntro||!staticEntryLink||!staticEntryWorks||exceptions.length) throw new Error(JSON.stringify(report));
  console.log(JSON.stringify(report,null,2));
} finally { ws.close(); }
