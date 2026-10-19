import{withDocumentNavigation}from'./browser-document.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const root = process.env.BROWSER_CHECK_OUTPUT ?? join(tmpdir(), 'cocudtt-sensitivity');
await mkdir(root, { recursive: true });
const server = await createServer({ configFile: false, optimizeDeps:{noDiscovery:true,include:[]}, server: { middlewareMode: true }, appType: 'custom' });
let fixture, foreign, pendingProject;
try {
  const { actualQuotesProject, syntheticEvidence } = await server.ssrLoadModule('/tests/fixtures/actual-quotes.ts');
  const { makeCostItem } = await server.ssrLoadModule('/tests/helpers/factory.ts');
  const { fxEvidenceValues } = await server.ssrLoadModule('/src/domain/source-evidence.ts');
  fixture=actualQuotesProject();fixture.incoterm='FOB';pendingProject=structuredClone(fixture);delete pendingProject.term_scenarios.FOB.responsibility_overrides;
  foreign=actualQuotesProject();foreign.name='商业/海关汇率独立合成验收';foreign.incoterm='FOB';foreign.anchor={kind:'FIXED_QUOTE'};delete foreign.term_scenarios;
  foreign.goods.trade_value={amount:'10000',currency:'USD'};foreign.quote={amount:'10000',currency:'USD',fx_type:'CONTRACT'};
  foreign.items=[makeCostItem({cost_id:'freight',cost_name:'美元运费（合成）',cost_category:'MAIN_CARRIAGE',trade_node:'MAIN_CARRIAGE',amount:'1000',currency:'USD',fx_type:'CONTRACT',customs_value:'ADD'})];
  foreign.fx_books=[{id:'contract',name:'商业合同',type:'CONTRACT',date:'2026-09-01',rates:{'USD/CNY':'7'}},{id:'customs',name:'海关',type:'CUSTOMS',date:'2026-09-01',valid_from:'2026-09-01',valid_to:'2026-09-30',rates:{'USD/CNY':'7.1'}}];
  for(const book of foreign.fx_books)book.evidence={'USD/CNY':syntheticEvidence(fxEvidenceValues({...book,from:'USD',to:'CNY',rate:book.rates['USD/CNY']}))};
} finally { await server.close(); }
const targets = await (await fetch(`http://127.0.0.1:${process.env.BROWSER_CHECK_PORT ?? '9358'}/json`)).json();
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
  await evaluate(`(async()=>{const input=document.querySelector('#file-input'),data=new DataTransfer();data.items.add(new File([${JSON.stringify(JSON.stringify(project))}],'synthetic-sensitivity.json',{type:'application/json'}));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,150));})()`);
}
try {
  await call('Runtime.enable');await call('Page.enable');await call('Page.navigate',{url:pathToFileURL(resolve('trade-cost-engine.html')).href});await until("!!document.querySelector('#file-input')");await upload(fixture);
  const helpers=`const set=(key,value)=>{const e=document.querySelector('[data-sensitivity-field="'+key+'"]');if(e.type==='checkbox')e.checked=value;else e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};const panel=()=>document.querySelector('[data-evidence-section="sensitivity"]');const row=v=>document.querySelector('[data-hypothesis-change="'+v+'"]');`;
  const openPanel=async()=>{await evaluate("document.querySelector('[data-evidence-section=sensitivity]').open=true");await new Promise(r=>setTimeout(r,100));};await openPanel();
  const checks=await evaluate(`(()=>{${helpers}
    const before=localStorage.getItem('trade-cost-engine:draft-v1');window.__baselineDraft=before;panel().open=true;set('target','buyer-freight');set('from','0');set('to','10');set('step','10');set('enabled',true);
    const freight=row('10').innerText.includes('13,288.80')&&row('10').innerText.includes('118.65');const unknownProfit=row('10').innerText.includes('未知或无法计算');const reference=row('10').innerText.includes('假设参考')&&document.querySelector('table.compare').innerText.includes('可参与排名');
    const unchanged=localStorage.getItem('trade-cost-engine:draft-v1')===before;const retained=panel().open;
    set('step','0');const invalid=panel().innerText.includes('步长须大于零')&&!document.querySelector('[data-sensitivity-result]');set('step','10');const recovered=!!row('10');
    const amount=document.querySelector('[data-item="buyer-freight"][data-item-field="amount"]');amount.value='1100';amount.dispatchEvent(new Event('change',{bubbles:true}));const recomputed=row('10').innerText.includes('13,419.32');
    return{freight,unknownProfit,reference,unchanged,retained,invalid,recovered,recomputed};})()`);
  await upload(pendingProject);
  await openPanel();
  Object.assign(checks,await evaluate(`(()=>{${helpers}const reset=!document.querySelector('[data-sensitivity-field="enabled"]').checked&&!document.querySelector('[data-sensitivity-result]');panel().open=true;set('kind','RESPONSIBILITY');set('enabled',true);const conditional=row('SELLER').innerText.includes('13,070.15')&&row('BUYER').innerText.includes('13,170.15')&&row('BUYER').innerText.includes('缺少来源核对记录');const fob=[...document.querySelectorAll('table.compare tbody tr')].find(r=>r.querySelector('th').innerText.startsWith('FOB'));const pendingKept=fob.innerText.includes('参考测算')&&!fob.innerText.includes('可参与排名');return{reset,conditional,pendingKept};})()`));
  await upload(foreign);
  await openPanel();
  Object.assign(checks,await evaluate(`(()=>{${helpers}const before=localStorage.getItem('trade-cost-engine:draft-v1');set('kind','FX');const option=type=>[...document.querySelector('[data-sensitivity-field="target"]').options].find(o=>o.textContent.includes(type)).value;set('target',option('CONTRACT'));set('from','0');set('to','10');set('step','10');set('enabled',true);const cells=()=>row('10').querySelectorAll('td');const commercial=cells()[2].innerText.includes('7,700.00')&&cells()[4].innerText.includes('变化 0.00');set('target',option('CUSTOMS'));const customs=cells()[0].innerText.includes('变化 0.00')&&cells()[4].innerText.includes('1,456.57')&&cells()[5].innerText.includes('7,810.00');const invalidated=row('10').innerText.includes('汇率')&&row('10').innerText.includes('需要重新核对');const unchangedFx=localStorage.getItem('trade-cost-engine:draft-v1')===before;return{commercial,customs,invalidated,unchangedFx};})()`));
  const saved=await evaluate(`(async()=>{let report='';window.showSaveFilePicker=async()=>({name:'hypothesis.html',createWritable:async()=>({write:async text=>{report=text},close:async()=>{}})});document.querySelector('[data-action="export-report"]').click();await new Promise(r=>setTimeout(r,150));window.__hypothesisReport=report;return report.includes('参数快照')&&report.includes('1,456.57')&&report.includes('假设参考')&&!report.includes('<script')&&!report.includes('data-sensitivity-field=')})()`);checks.report=saved;
  await writeFile(join(root,'example-internal-report.html'),await evaluate('window.__hypothesisReport'));await writeFile(join(root,'sensitivity-example.json'),JSON.stringify(foreign,null,2));
  const layouts=[];for(const width of [1440,768,390,320]){await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});await evaluate("document.querySelector('[data-evidence-section=sensitivity]').open=true;document.querySelector('[data-evidence-section=sensitivity]').scrollIntoView()");layouts.push(await evaluate('({viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth})'));await writeFile(join(root,'sensitivity-'+width+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));}
  // 确认假设参数变更不会把项目保存成情景值。
  checks.savedBaseline=await evaluate(`(async()=>{let project='';window.showSaveFilePicker=async()=>({name:'base.json',createWritable:async()=>({write:async text=>{project=text},close:async()=>{}})});document.querySelector('[data-action="save"]').click();await new Promise(r=>setTimeout(r,150));const p=JSON.parse(project);return p.fx_books.find(b=>b.type==='CUSTOMS').rates['USD/CNY']==='7.1'&&p.items[0].amount==='1000'&&p.schema_version==='0.8'})()`);
  await call('Page.navigate',{url:pathToFileURL(join(root,'example-internal-report.html')).href});await until("!!document.querySelector('[data-sensitivity-result]')");checks.reportOpen=await evaluate("document.querySelector('[data-sensitivity-result]').innerText.includes('1,456.57')&&document.querySelectorAll('script,iframe,form,input').length===0&&document.documentElement.scrollWidth<=document.documentElement.clientWidth");
  const report={checks,layouts,exceptions,browser:'Microsoft Edge',protocol:'file://',saveUsesApiSubstitute:true,actualMobileVerified:false,realPrintPaginationVerified:false};await writeFile(join(root,'sensitivity-browser-report.json'),JSON.stringify(report,null,2));if(Object.values(checks).some(v=>v!==true)||layouts.some(l=>l.content>l.viewport)||exceptions.length)throw Error(JSON.stringify(report));console.log(JSON.stringify(report,null,2));
}finally{ws.close();}
