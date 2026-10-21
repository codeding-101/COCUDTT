import {createServer} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {feeSourceAdapterBridge} from './fee-source-adapter-bridge.mjs';
import {withDocumentNavigation} from './browser-document.mjs';
if(process.env.FEE_SOURCE_ADAPTER_DEDICATED!=='1'||!/^\d{4,5}$/.test(process.env.BROWSER_CHECK_PORT??''))throw Error('Dedicated test profile and BROWSER_CHECK_PORT required');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=resolve(process.env.BROWSER_CHECK_OUTPUT??'benchmark-results/fee-source-adapter'),port=4191;
const fingerprints={},paths=['src/ui/app.ts','src/ui/fee-workbench-source-adapter.ts','src/ui/fx-rows.ts','src/ui/workbench-state.ts','src/ui/fee-workbench-preview.ts','tools/fee-source-adapter-bridge.mjs','tools/check-fee-source-adapter-browser.mjs','tools/fee-performance-fixture.ts','package-lock.json'];
for(const path of paths){const bytes=Buffer.from((await readFile(join(root,path),'utf8')).replace(/\r\n/g,'\n'));fingerprints[path]=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');}
const server=await createServer({root,configFile:false,plugins:[{name:'fee-source-adapter-shadow-only',enforce:'pre',transform(code,id){if(id.replaceAll('\\','/').endsWith('/src/ui/app.ts'))return{code:code+'\n'+feeSourceAdapterBridge,map:null};}}],optimizeDeps:{noDiscovery:true,include:[]},server:{host:'127.0.0.1',port,strictPort:true,hmr:false,watch:null},appType:'spa'});
await server.listen();await mkdir(out,{recursive:true});
const version=await(await fetch('http://127.0.0.1:'+process.env.BROWSER_CHECK_PORT+'/json/version')).json();
async function connect(url){const ws=new WebSocket(url);await new Promise((ok,bad)=>{ws.onopen=ok;ws.onerror=bad});let id=0;const pending=new Map();ws.onmessage=e=>{const r=JSON.parse(e.data),p=pending.get(r.id);if(p){pending.delete(r.id);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result)}};return{ws,call:(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))})};}
const browser=await connect(version.webSocketDebuggerUrl),target=(await browser.call('Target.createTarget',{url:'about:blank'})).targetId;
const targets=await(await fetch('http://127.0.0.1:'+process.env.BROWSER_CHECK_PORT+'/json')).json(),page=await connect(targets.find(t=>t.id===target).webSocketDebuggerUrl),nav=withDocumentNavigation(page.call);
const evaluate=async expression=>{const r=await page.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const until=async expression=>{for(let i=0;i<600;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout '+expression);};
async function native(selector){const point=await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e||e.disabled)throw Error("Missing control");for(let p=e.parentElement;p;p=p.parentElement)if(p instanceof HTMLDetailsElement)p.open=true;e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');for(const type of['mousePressed','mouseReleased'])await page.call('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...point});}
const action=key=>native('[data-action="'+key+'"]');
const upload=async(id,raw)=>evaluate('(()=>{const d=new DataTransfer();d.items.add(new File(['+JSON.stringify(raw)+'],"synthetic-source-adapter.json",{type:"application/json"}));const e=document.querySelector("#'+id+'");e.files=d.files;e.dispatchEvent(new Event("change",{bubbles:true}));})()');
try{
 await page.call('Runtime.enable');await page.call('Page.enable');await nav('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});
 await until('!!window.__feeSourceAdapter88&&!!document.querySelector("[data-fee-workflow-guide]")');
 await evaluate('localStorage.clear();localStorage.setItem("trade-cost-engine:workspace-mode-v1","professional");localStorage.setItem("trade-cost-engine:onboarding-v1","hidden")');
 await nav('Page.reload');await until('!!window.__feeSourceAdapter88&&!!document.querySelector("[data-fee-workflow-guide]")');
 const cases=[];
 for(const name of['baseline','uninitialized','pending_only','control_input','control_textarea','control_select','control_checkbox','control_detached','control_other','fx_matching','fx_changed','fx_incomplete','fx_bad','project_read_active','project_read_stale','recovery','file_busy','file_download','file_saved','storage_absent','storage_empty','storage_bad','storage_throw_one','storage_throw_all','envelope_read','blockers_all']){
  console.log('Shadow capture '+name);cases.push(await evaluate('window.__feeSourceAdapter88.scenario('+JSON.stringify(name)+')'));await writeFile(join(out,'adapter-progress.json'),JSON.stringify(cases,null,2));
 }
 // One populated formal fixture, installed through original UI inputs and adoption actions.
 const {feePerformanceFixture}=await server.ssrLoadModule('/tools/fee-performance-fixture.ts'),{booksToRows}=await server.ssrLoadModule('/src/ui/fx-rows.ts'),f=await feePerformanceFixture(1),rows=booksToRows(f.pair.project.fx_books);
 await evaluate('localStorage.clear();localStorage.setItem("trade-cost-engine:workspace-mode-v1","professional");localStorage.setItem("trade-cost-engine:onboarding-v1","hidden");localStorage.setItem("trade-cost-engine:draft-v1",'+JSON.stringify(JSON.stringify({project:f.pair.project,fxRows:rows,pair_fx_row_key:JSON.stringify(rows)}))+');localStorage.setItem("trade-cost-engine:container-bill-v1",'+JSON.stringify(f.sources.bill_json)+');localStorage.setItem("trade-cost-engine:container-cost-pair-v1",'+JSON.stringify(f.sources.pair_json)+');');
 await nav('Page.reload');await until('!!window.__feeSourceAdapter88&&!!document.querySelector("[data-fee-workflow-guide]")');
 await upload('fee-tax-file-input',f.sources.attachment_json);await until('!!document.querySelector("[data-action=fee-tax-adopt]")');await action('fee-tax-adopt');await until('!document.querySelector("[data-action=fee-tax-adopt]")');
 await upload('fee-precision-file-input',f.sources.precision_json);await until('!!document.querySelector("[data-action=fee-precision-adopt]")');await action('fee-precision-adopt');await action('fee-precision-confirm');await until('!document.querySelector("[data-action=fee-precision-adopt]")');
 await upload('fee-envelope-file-input',f.raw);await until('!!document.querySelector("[data-fee-envelope-preview]")');for(const key of await evaluate('[...document.querySelectorAll("[data-fee-envelope-choice]")].map(e=>e.dataset.feeEnvelopeChoice)'))await native('[data-fee-envelope-choice="'+key+'"]');await action('fee-envelope-adopt');await until('!document.querySelector("[data-fee-envelope-preview]")');
 cases.push(await evaluate('window.__feeSourceAdapter88.scenario("populated_formal_fixture")'));
 const runtime=await readFile(join(root,'trade-cost-engine.html')),report={kind:'SYNTHETIC_FEE_SOURCE_ADAPTER_BROWSER_SHADOW',version:'0.1',generated_at:new Date().toISOString(),browser:version.Browser,source_fingerprints:fingerprints,offline_runtime_blob:createHash('sha1').update('blob '+runtime.length+'\0').update(runtime).digest('hex'),cases,
  financial_writes:0,storage_writes_during_comparison:0,financial_application_used:false,runtime_integrated:false,production_capacity_changed:false,real_phone_verified:false,
  methodology:{scope:'Native browser runs original app.ts and independent adapter side-by-side; exact complete JSON and retained string comparison',bridge:'Vite pre-transform appends test-only bridge in memory; tracked app and offline artifact unchanged',fixture:'Default synthetic app scenarios plus one qualified formal fixture through original file inputs and explicit adoption',not_proven:'No production integration,4/8 capacity,complete browser-suite rerun,timing or peak-memory claim; unsupported JavaScript data can be rejected more strictly than legacy stringify'}};
 await writeFile(join(out,'fee-source-adapter.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cases:cases.length,allExact:cases.every(c=>c.equal),financialWrites:0,runtimeIntegrated:false,reportComplete:true}));
}finally{page.ws.close();await browser.call('Target.closeTarget',{targetId:target});browser.ws.close();await server.close();}
