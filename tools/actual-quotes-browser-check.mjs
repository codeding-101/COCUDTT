import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

// 独立Chromium配置；保存API用替身捕获内容，导入使用真正File/DataTransfer事件。
const root = process.env.BROWSER_CHECK_OUTPUT ?? join(tmpdir(), 'cocudtt-actual-quotes');
await mkdir(root, { recursive: true });
const port = process.env.BROWSER_CHECK_PORT ?? '9354';
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map(); const exceptions = [];
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
async function until(expression) {
  for (let attempt = 0; attempt < 80; attempt++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`页面状态未满足：${expression}`);
}
const metrics = async width => call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
try {
  await call('Runtime.enable'); await call('Page.enable'); await metrics(1440);
  await call('Page.navigate', { url: pathToFileURL(resolve(import.meta.dirname, '..', 'trade-cost-engine.html')).href });
  await until("!!document.querySelector('[data-action=\"new-china-import\"]')");
  await evaluate("document.querySelector('[data-action=\"new-china-import\"]').click()");
  const flow = await evaluate(`(async () => {
    const pause=()=>new Promise(r=>setTimeout(r,100));
    const set=(path,value)=>{ const e=document.querySelector('[data-path="'+path+'"]'); if(!e)throw Error(path);e.value=value;e.dispatchEvent(new Event('change',{bubbles:true})); };
    const ev=(owner,id,field,value)=>{ const e=[...document.querySelectorAll('[data-evidence-owner]')].find(e=>e.dataset.evidenceOwner===owner&&e.dataset.evidenceId===id&&e.dataset.evidenceField===field);if(!e)throw Error(owner+':'+field);e.value=value;e.dispatchEvent(new Event('change',{bubbles:true})); };
    const confirm=(owner,id)=>{for(const [field,value] of [['reference','合成验收资料，非真实业务凭证'],['valid_from','2026-09-01'],['valid_to','2026-09-30'],['checked_on','2026-10-11'],['status','USER_CONFIRMED']])ev(owner,id,field,value);};
    const row=term=>[...document.querySelectorAll('table.compare tbody tr')].find(e=>e.querySelector('th').innerText.startsWith(term));
    let saved='';window.showSaveFilePicker=async()=>({name:'actual-quotes.json',createWritable:async()=>({write:async text=>{saved=text;},close:async()=>{}})});
    document.querySelector('[data-action="save"]').click();await pause();
    const p=JSON.parse(saved);p.name='独立报价浏览器合成验收';p.schema_version='0.7';p.goods.trade_value={amount:'10000',currency:'CNY'};p.goods.seller_goods_cost={amount:'',currency:'CNY'};p.fx_books=[];p.anchor={kind:'ACTUAL_QUOTES'};p.evaluation_date='2026-09-10';p.term_scenarios={};
    const freight=p.items.find(e=>e.cost_category==='MAIN_CARRIAGE');const insurance=p.items.find(e=>e.cost_category==='INSURANCE');
    p.items=[{...freight,cost_id:'seller-freight',cost_name:'卖方运价',amount:'600',currency:'CNY',applicable_incoterms:['CIF'],alternative_group:'主运输'},
      {...freight,cost_id:'buyer-freight',cost_name:'买方运价',amount:'1000',currency:'CNY',applicable_incoterms:['FOB'],alternative_group:'主运输'},
      {...insurance,cost_id:'insurance',amount:'100',currency:'CNY'}];
    const upload=text=>{ const input=document.querySelector('#file-input');const data=new DataTransfer();data.items.add(new File([text],'actual-quotes.json',{type:'application/json'}));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true})); };
    upload(JSON.stringify(p));await pause();
    const missing=!!row('CIF')&&row('CIF').innerText.includes('未录入实际报价')&&!document.querySelector('[data-path="quote.amount"]');
    confirm('tax','');confirm('duty-eligibility','');
    set('term_scenarios.CIF.quote.amount','10700');set('term_scenarios.CIF.quote.named_place','上海港（合成）');confirm('quote','CIF');
    document.querySelector('[data-action="create-insurance-plan"]').click();
    const setInsurancePolicy=(field,value)=>{const e=[...document.querySelectorAll('[data-logistics-kind="insurance"]')].find(e=>e.dataset.logisticsField===field);if(e.type==='checkbox')e.checked=value;else e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};
    for(const [field,value] of [['cover','ICC_C'],['clause_version','ICC 1/1/2009（合成）'],['sum_insured.amount','11770'],['insured_from','汉堡港（合成）'],['insured_to','上海港（合成）'],['insurer','合成保险人'],['policy_reference','合成保单'],['deductible','无免赔（合成）'],['exclusions','合成除外条款'],['scope_confirmed',true],['direct_claim_confirmed',true]])setInsurancePolicy(field,value);
    confirm('insurance','CIF');
    const cifReady=row('CIF').innerText.includes('可参与排名')&&row('CIF').innerText.includes('12,695.55');
    set('incoterm','FOB');const cifSurvives=row('CIF').innerText.includes('12,695.55')&&row('FOB').innerText.includes('未录入实际报价');
    set('term_scenarios.FOB.quote.amount','10000');set('term_scenarios.FOB.quote.named_place','汉堡港（合成）');confirm('quote','FOB');
    const insuranceAgreement=(field,value)=>{const e=[...document.querySelectorAll('[data-contract-field]')].find(e=>e.dataset.contractCost==='insurance'&&e.dataset.contractField===field);e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};
    insuranceAgreement('responsibility','BUYER');insuranceAgreement('reason','合成合同：买方自愿投保并承担保费，非FOB强制投保');confirm('contract-cost',JSON.stringify(['FOB','insurance']));
    const fobReady=row('FOB').innerText.includes('可参与排名')&&row('FOB').innerText.includes('13,170.15');
    set('incoterm','CIF');ev('quote','CIF','valid_to','2026-09-09');ev('quote','CIF','status','USER_CONFIRMED');
    const expired=row('CIF').innerText.includes('参考测算')&&row('CIF').textContent.includes('适用期不覆盖')&&document.body.innerText.includes('买方总支付最低：FOB');
    ev('quote','CIF','valid_to','2026-09-30');ev('quote','CIF','status','USER_CONFIRMED');
    set('term_scenarios.CIF.quote.amount','10800');const editInvalidates=[...document.querySelectorAll('[data-evidence-owner="quote"][data-evidence-field="status"]')].find(e=>e.dataset.evidenceId==='CIF').value==='UNVERIFIED'&&row('CIF').innerText.includes('参考测算');
    set('term_scenarios.CIF.quote.amount','10700');ev('quote','CIF','status','USER_CONFIRMED');
    set('incoterm','FOB');set('facts.shipping_terms','LINER');
    confirm('contract-cost',JSON.stringify(['FOB','insurance']));
    const preset=document.querySelector('[data-action="add-preset"]');preset.value='thc-origin';preset.dispatchEvent(new Event('change',{bubbles:true}));
    const item=[...document.querySelectorAll('[data-item-field="cost_name"]')].find(e=>e.value==='起运港港杂费');const costId=item.dataset.item;
    for(const [field,value] of [['quantity','1'],['rate','150']]){const e=[...document.querySelectorAll('[data-item-field="'+field+'"]')].find(e=>e.dataset.item===costId);e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));}
    const contract=(field,value)=>{const e=[...document.querySelectorAll('[data-contract-cost]')].find(e=>e.dataset.contractCost===costId&&e.dataset.contractField===field);e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};
    contract('responsibility','BUYER');contract('reason','合成合同：买方承担这笔起运港THC');confirm('contract-cost',JSON.stringify(['FOB',costId]));confirm('quote','FOB');
    const overrideWorks=row('FOB').innerText.includes('可参与排名')&&document.body.innerText.includes('合成合同：买方承担这笔起运港THC')&&document.body.innerText.includes('装上船');
    contract('reason','修改条款说明');const overrideInvalidates=row('FOB').innerText.includes('参考测算');contract('reason','合成合同：买方承担这笔起运港THC');confirm('contract-cost',JSON.stringify(['FOB',costId]));
    document.querySelector('[data-action="save"]').click();await pause();window.__contractProject=saved;const file=JSON.parse(saved);
    const persistence=file.schema_version==='0.8'&&file.term_scenarios.CIF.quote.amount==='10700'&&file.term_scenarios.FOB.quote.amount==='10000'&&file.term_scenarios.FOB.responsibility_overrides[costId].evidence.values_key&&!file.term_scenarios.CIF.responsibility_overrides;
    set('anchor.kind','FIXED_QUOTE');set('anchor.kind','ACTUAL_QUOTES');const restored=document.querySelector('[data-path="term_scenarios.FOB.quote.amount"]').value==='10000';
    let report='';window.showSaveFilePicker=async()=>({name:'contract-report.html',createWritable:async()=>({write:async text=>{report=text;},close:async()=>{}})});document.querySelector('[data-action="export-report"]').click();await pause();window.__contractReport=report;
    const reportWorks=report.includes('各方案实际报价')&&report.includes('合同比较日期')&&report.includes('费用约定：起运港港杂费')&&report.includes('合成合同：买方承担这笔起运港THC')&&!report.includes('<script');
    set('term_scenarios.FOB.quote.amount','1');upload(saved);await pause();const roundtrip=document.querySelector('[data-path="term_scenarios.FOB.quote.amount"]').value==='10000'&&row('FOB').innerText.includes('可参与排名');
    const stale=JSON.parse(saved);stale.term_scenarios.FOB.responsibility_overrides.missing={responsibility:'SELLER',reason:'引用已删除费用的合成记录'};upload(JSON.stringify(stale));await pause();
    const staleBlocked=row('FOB').textContent.includes('不存在的费用');document.querySelector('[data-action="remove-contract-override"]').click();
    const staleRecovery=staleBlocked&&row('FOB').innerText.includes('可参与排名')&&!document.querySelector('[data-action="remove-contract-override"]');
    document.querySelectorAll('details').forEach(e=>e.open=true);
    return {missing,cifReady,cifSurvives,fobReady,expired,editInvalidates,overrideWorks,overrideInvalidates,persistence:!!persistence,restored,reportWorks,roundtrip,staleRecovery};
  })()`);
  await writeFile(join(root, 'actual-quotes-project.json'), await evaluate('window.__contractProject'));
  await writeFile(join(root, 'actual-quotes-internal-report.html'), await evaluate('window.__contractReport'));
  const layouts = [];
  for (const width of [1440, 390, 320]) {
    await metrics(width); layouts.push(await evaluate('({viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth})'));
    await writeFile(join(root, `actual-quotes-${width}.png`), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  }
  const report = { flow, layouts, exceptions, browser: 'Microsoft Edge', protocol: 'file://', fileSaveUsesApiSubstitute: true, realPrintPaginationVerified: false };
  await writeFile(join(root, 'actual-quotes-browser-report.json'), JSON.stringify(report, null, 2));
  if (Object.values(flow).some(value => value !== true) || layouts.some(x => x.content > x.viewport) || exceptions.length) throw new Error(JSON.stringify(report));
  console.log(JSON.stringify(report, null, 2));
} finally { ws.close(); }
