import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const root = process.env.BROWSER_CHECK_OUTPUT ?? join(tmpdir(), 'cocudtt-foundations');
await mkdir(root, { recursive: true });
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
let fixture, ddp, fca;
try {
  const { actualQuotesProject } = await server.ssrLoadModule('/tests/fixtures/actual-quotes.ts');
  const { makeCostItem } = await server.ssrLoadModule('/tests/helpers/factory.ts');
  fca=actualQuotesProject();fca.incoterm='FCA';fca.carriage_mode='ROAD';fca.facts={delivery_place:'SELLER_PREMISES'};
  fca.term_scenarios.FCA={quote:{amount:'10080',currency:'CNY',fx_type:'CONTRACT',named_place:'汉堡工厂'}};
  fca.items=[makeCostItem({cost_id:'inland',cost_name:'FCA内陆运输（交货地点切换合成用例）',trade_node:'INLAND_TRANSPORT',cost_category:'INLAND_TRANSPORT',amount:'100',customs_value:'ADD'}),makeCostItem({cost_id:'export',cost_name:'出口清关',trade_node:'EXPORT_CLEARANCE',cost_category:'EXPORT_CLEARANCE',amount:'80'}),makeCostItem({cost_id:'freight',cost_name:'国际主运输',trade_node:'MAIN_CARRIAGE',cost_category:'MAIN_CARRIAGE',amount:'900'}),makeCostItem({cost_id:'insurance',cost_name:'自愿保险',trade_node:'MAIN_CARRIAGE',cost_category:'INSURANCE',amount:'20'})];
  const { logisticsProject } = await server.ssrLoadModule('/tests/fixtures/logistics-project.ts'); fixture = logisticsProject();
  const { chinaImportSampleProjectFile } = await server.ssrLoadModule('/src/data/sample-project.ts'); ddp = chinaImportSampleProjectFile(); ddp.incoterm = 'DDP'; ddp.tax_profile.import.vatDeductibleForBuyer = true;
} finally { await server.close(); }
const targets = await (await fetch(`http://127.0.0.1:${process.env.BROWSER_CHECK_PORT ?? '9357'}/json`)).json();
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
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
  await evaluate(`(async()=>{const input=document.querySelector('#file-input'),data=new DataTransfer();data.items.add(new File([${JSON.stringify(JSON.stringify(project))}],'synthetic-explanation.json',{type:'application/json'}));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,150));})()`);
}
try {
  await call('Runtime.enable');await call('Page.enable');await call('Page.navigate',{url:pathToFileURL(resolve('trade-cost-engine.html')).href});await until("!!document.querySelector('#file-input')");await upload(fca);
  const checks=await evaluate(`(async()=>{
    const set=(path,value)=>{const e=document.querySelector('[data-path="'+path+'"]');e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};
    const confirm=(owner,id)=>{for(const [field,value]of [['reference','合成合同核对，非实际业务凭证'],['valid_from','2026-09-01'],['valid_to','2026-09-30'],['checked_on','2026-10-12'],['status','USER_CONFIRMED']]){const e=[...document.querySelectorAll('[data-evidence-owner]')].find(e=>e.dataset.evidenceOwner===owner&&e.dataset.evidenceId===id&&e.dataset.evidenceField===field);e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));}};
    const row=()=>[...document.querySelectorAll('table.compare tbody tr')].find(e=>e.querySelector('th').innerText.startsWith('FCA'));
    const text=id=>document.querySelector('[data-reasoning="'+id+'"]').textContent;
    const contract=(id,field,value)=>{const e=[...document.querySelectorAll('[data-contract-field]')].find(e=>e.dataset.contractCost===id&&e.dataset.contractField===field);e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};
    confirm('quote','FCA');const initialPending=row().innerText.includes('参考测算')&&text('insurance').includes('归属待确认')&&text('inland').includes('计入买方');
    contract('insurance','responsibility','BUYER');contract('insurance','reason','合成合同明确买方自愿投保并付费');const unconfirmed=row().innerText.includes('参考测算');confirm('contract-cost',JSON.stringify(['FCA','insurance']));
    const ready=row().innerText.includes('可参与排名');const sellerPlace=text('inland').includes('计入买方')&&document.body.textContent.includes('装货完成时');
    set('facts.delivery_place','OTHER');const other=text('inland').includes('计入卖方')&&document.body.textContent.includes('准备卸货');const invalidated=row().innerText.includes('参考测算');confirm('quote','FCA');confirm('contract-cost',JSON.stringify(['FCA','insurance']));
    const quoteMismatch=row().innerText.includes('参考测算');set('term_scenarios.FCA.quote.amount','10180');confirm('quote','FCA');
    const restored=row().innerText.includes('可参与排名');set('facts.delivery_place','');const missing=row().textContent.includes('交货地点')&&text('inland').includes('归属待确认');
    set('facts.delivery_place','SELLER_PREMISES');set('term_scenarios.FCA.quote.amount','10080');confirm('quote','FCA');confirm('contract-cost',JSON.stringify(['FCA','insurance']));
    set('goods.quantity','0');const zeroBlocked=document.body.innerText.includes('商品数量必须大于零')&&document.body.innerText.includes('无法计算');set('goods.quantity','1');confirm('quote','FCA');
    const recovered=row().innerText.includes('可参与排名');let saved='';window.showSaveFilePicker=async()=>({name:'foundations.json',createWritable:async()=>({write:async text=>{saved=text},close:async()=>{}})});document.querySelector('[data-action="save"]').click();await new Promise(r=>setTimeout(r,150));window.__foundationsProject=saved;
    let report='';window.showSaveFilePicker=async()=>({name:'foundations-report.html',createWritable:async()=>({write:async text=>{report=text},close:async()=>{}})});document.querySelector('[data-action="export-report"]').click();await new Promise(r=>setTimeout(r,150));window.__foundationsReport=report;
    const reportWorks=report.includes('Incoterms不规定货物所有权转移')&&report.includes('1.2')&&report.includes('FCA卖方场所交货')&&!report.includes('<script');document.querySelector('[data-evidence-section="concept-check"]').open=true;
    return{initialPending,unconfirmed,ready,sellerPlace,other,invalidated,quoteMismatch,restored,missing,zeroBlocked,recovered,reportWorks};
  })()`);
  const saved=await evaluate('window.__foundationsProject');await writeFile(join(root,'foundations-example.json'),saved);await writeFile(join(root,'example-internal-report.html'),await evaluate('window.__foundationsReport'));await upload(JSON.parse(saved));
  checks.roundtrip=await evaluate("document.body.textContent.includes('FCA卖方场所交货')&&[...document.querySelectorAll('table.compare tbody tr')].find(e=>e.querySelector('th').innerText.startsWith('FCA')).innerText.includes('可参与排名')");
  const layouts=[];await evaluate("document.querySelectorAll('details').forEach(e=>e.open=true)");
  for(const width of [1440,768,390,320]){await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});layouts.push(await evaluate('({viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth})'));await evaluate("document.querySelector('[data-evidence-section=\"concept-check\"]').scrollIntoView()");await writeFile(join(root,'foundations-'+width+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));}
  const report={checks,layouts,exceptions,saveUsesApiSubstitute:true,actualMobileVerified:false,realPrintPaginationVerified:false};await writeFile(join(root,'foundations-browser-report.json'),JSON.stringify(report,null,2));if(Object.values(checks).some(v=>v!==true)||layouts.some(l=>l.content>l.viewport)||exceptions.length)throw Error(JSON.stringify(report));console.log(JSON.stringify(report,null,2));
}finally{ws.close();}
