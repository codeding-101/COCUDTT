import {createServer} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {feeSourceAdapterBridge} from './fee-source-adapter-bridge.mjs';
import {feeSourceCompatibilityBridge} from './fee-source-compatibility-bridge.mjs';
import {withDocumentNavigation} from './browser-document.mjs';
if(process.env.FEE_SOURCE_COMPATIBILITY_DEDICATED!=='1'||!/^\d{4,5}$/.test(process.env.BROWSER_CHECK_PORT??''))throw Error('Dedicated test profile and BROWSER_CHECK_PORT required');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=resolve(process.env.BROWSER_CHECK_OUTPUT??'benchmark-results/fee-source-compatibility'),port=4193;
const fingerprints={},paths=['src/ui/app.ts','src/ui/fee-workbench-source-adapter.ts','src/data/fee-envelope-json.ts','src/data/fee-workbench.ts','src/ui/fee-workbench-preview.ts','src/ui/workbench-state.ts','tools/fee-source-adapter-bridge.mjs','tools/fee-source-compatibility.ts','tools/fee-source-compatibility-cases.ts','tools/fee-source-compatibility-bridge.mjs','tools/check-fee-source-compatibility-browser.mjs','package-lock.json'];
for(const path of paths){const bytes=Buffer.from((await readFile(join(root,path),'utf8')).replace(/\r\n/g,'\n'));fingerprints[path]=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');}
const server=await createServer({root,configFile:false,plugins:[{name:'fee-source-compatibility-observation-only',enforce:'pre',transform(code,id){if(id.replaceAll('\\','/').endsWith('/src/ui/app.ts'))return{code:code+'\n'+feeSourceAdapterBridge+'\n'+feeSourceCompatibilityBridge,map:null};}}],optimizeDeps:{noDiscovery:true,include:[]},server:{host:'127.0.0.1',port,strictPort:true,hmr:false,watch:null},appType:'spa'});
let browser=null,page=null,target=null;
async function connect(url){const ws=new WebSocket(url);await new Promise((ok,bad)=>{const timer=setTimeout(()=>bad(Error('CDP connect timeout')),15000);ws.onopen=()=>{clearTimeout(timer);ok();};ws.onerror=e=>{clearTimeout(timer);bad(e);};});let id=0;const pending=new Map();ws.onmessage=e=>{const r=JSON.parse(e.data),p=pending.get(r.id);if(p){pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);}};return{ws,call:(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP request timeout '+method));},90000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));})};}
try{
 await server.listen();await mkdir(out,{recursive:true});
 const endpoint='http://127.0.0.1:'+process.env.BROWSER_CHECK_PORT,version=await(await fetch(endpoint+'/json/version')).json();browser=await connect(version.webSocketDebuggerUrl);
 target=(await browser.call('Target.createTarget',{url:'about:blank'})).targetId;const targets=await(await fetch(endpoint+'/json')).json();page=await connect(targets.find(t=>t.id===target).webSocketDebuggerUrl);
 const nav=withDocumentNavigation(page.call),evaluate=async expression=>{const r=await page.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const until=async expression=>{for(let n=0;n<600;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Page initialization timeout');};
 await page.call('Runtime.enable');await page.call('Page.enable');await nav('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});await until('!!window.__feeSourceCompatibility89&&!!document.querySelector("[data-fee-workflow-guide]")');
 const cases=[];for(const id of await evaluate('window.__feeSourceCompatibility89.ids')){console.log('Compatibility '+id);cases.push(await evaluate('window.__feeSourceCompatibility89.scenario('+JSON.stringify(id)+')'));await writeFile(join(out,'compatibility-progress.json'),JSON.stringify(cases,null,2));}
 const gaps=cases.filter(c=>c.category!=='UNSUPPORTED_JAVASCRIPT'&&c.legacy_capture.status==='ACCEPTED'&&c.retained_parse.status==='ACCEPTED'&&c.source_frame.status==='REJECTED');
 if(!gaps.some(c=>c.id.startsWith('depth_'))||!gaps.some(c=>c.id.startsWith('nodes_'))||cases.some(c=>!c.owner_unchanged||c.full_capture_equal===false||c.storage_writes||c.adapter_accessor_or_tojson_calls))throw Error('Missing compatibility evidence or unexpected mismatch');
 const runtime=await readFile(join(root,'trade-cost-engine.html')),report={kind:'SYNTHETIC_FEE_SOURCE_COMPATIBILITY_BROWSER_MATRIX',version:'0.1',generated_at:new Date().toISOString(),browser:version.Browser,source_fingerprints:fingerprints,offline_runtime_blob:createHash('sha1').update('blob '+runtime.length+'\0').update(runtime).digest('hex'),cases,
  integration_decision:'KEEP_ORIGINAL_CAPTURE',ordinary_json_compatibility_gaps:gaps.map(c=>c.id),runtime_integrated:false,production_capacity_changed:false,financial_writes:0,financial_application_used:false,real_phone_verified:false,
  methodology:{scope:'Actual unchanged app capture, separate original retained JSON parser, independent frame and legacy reconstruction; synchronous synthetic states only',budget:'Original128MiB/300000nodes/depth32 unchanged; native matrix measures depth and node counterexamples. Exact128MiB UTF8 tests are separate unit evidence.',javascript:'Unsupported live JS objects are separated from ordinary JSON. Legacy getter/toJSON calls are measured; adapter must call neither.',protection:'Production keeps original capture. Diagnostic data is not a fallback implementation, candidate, source adoption, import or confirmation authority.',limits:'No full-input equivalence, production integration,4/8 capacity improvement,full browser-suite rerun,timing or memory claim. Transaction readiness is NOT_TESTED.'}};
 await writeFile(join(out,'fee-source-compatibility.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cases:cases.length,compatible:gaps.length===0,knownOrdinaryJsonGaps:gaps.map(c=>c.id),productionAction:report.integration_decision}));
}finally{
 page?.ws.close();try{if(browser&&target)await browser.call('Target.closeTarget',{targetId:target});}finally{browser?.ws.close();await server.close();}
}
