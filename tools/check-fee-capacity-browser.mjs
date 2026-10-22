import {createServer} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {transformFeeCapacity} from './fee-capacity-bridge.mjs';
import {withDocumentNavigation} from './browser-document.mjs';
import {readRuntimeFeeBackup} from './runtime-fee-backup-reader.mjs';

if(process.env.FEE_CAPACITY_DEDICATED!=='1'||!/^\d{4,5}$/.test(process.env.BROWSER_CHECK_PORT??''))throw Error('Explicit disposable capacity test profile required');
const root=resolve(import.meta.dirname,'..'),out=resolve(process.env.BROWSER_CHECK_OUTPUT??'benchmark-results/fee-capacity'),port=4198;
const sha=text=>createHash('sha256').update(text).digest('hex'),blob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const server=await createServer({root,configFile:false,plugins:[{name:'fee-capacity-test-only',enforce:'pre',transform:transformFeeCapacity}],optimizeDeps:{noDiscovery:true,include:[]},server:{host:'127.0.0.1',port,strictPort:true,hmr:false,watch:null},appType:'spa'});
let browser=null,page=null,target=null;
const exceptions=[],requests=[];let navigationDialogs=0,unexpectedDialog=null;
async function connect(url){
 const ws=new WebSocket(url);await new Promise((ok,bad)=>{const timer=setTimeout(()=>bad(Error('CDP connect timeout')),15000);ws.onopen=()=>{clearTimeout(timer);ok();};ws.onerror=bad;});
 let id=0;const pending=new Map();
 const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP timeout '+method));},180000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});
 ws.onmessage=e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')exceptions.push(r.params.exceptionDetails.text);if(r.method==='Network.requestWillBeSent')requests.push(r.params.request.url);
  if(r.method==='Page.javascriptDialogOpening'){if(r.params.type==='beforeunload'){navigationDialogs++;void call('Page.handleJavaScriptDialog',{accept:true});}else unexpectedDialog=r.params.type;}
  const p=pending.get(r.id);if(p){pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);}
 };return{ws,call};
}
try{
 await mkdir(out,{recursive:true});await server.listen();
 const endpoint='http://127.0.0.1:'+process.env.BROWSER_CHECK_PORT,version=await(await fetch(endpoint+'/json/version')).json();browser=await connect(version.webSocketDebuggerUrl);
 target=(await browser.call('Target.createTarget',{url:'about:blank'})).targetId;const targets=await(await fetch(endpoint+'/json')).json();page=await connect(targets.find(t=>t.id===target).webSocketDebuggerUrl);
 const nav=withDocumentNavigation(page.call),evaluate=async expression=>{const r=await page.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const until=async expression=>{for(let n=0;n<600;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Capacity condition timeout '+expression);};
 async function native(selector){const point=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Missing control');for(let p=e.parentElement;p;p=p.parentElement)if(p instanceof HTMLDetailsElement)p.open=true;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of['mousePressed','mouseReleased'])await page.call('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...point});}
 const action=key=>native('[data-action="'+key+'"]');
 const upload=async(id,raw)=>evaluate(`(()=>{const d=new DataTransfer();d.items.add(new File([${JSON.stringify(raw)}],'synthetic-capacity.json',{type:'application/json'}));const e=document.querySelector('#${id}');e.files=d.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 async function save(key){
  await evaluate(`window.capacitySave92={done:false};window.showSaveFilePicker=async o=>({name:o.suggestedName,createWritable:async()=>({write:async b=>{const raw=typeof b==='string'?b:await b.text();window.capacitySave92.bytes=new TextEncoder().encode(raw).length;window.capacitySave92.sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(n=>n.toString(16).padStart(2,'0')).join('');JSON.parse(raw);window.capacitySave92.json_parseable=true;},close:async()=>{requestAnimationFrame(()=>requestAnimationFrame(()=>{window.capacitySave92.done=true;}));}})});`);
  await action(key);await until('window.capacitySave92.done');return evaluate('window.capacitySave92');
 }
 async function adopt(f){
  await upload('fee-tax-file-input',f.sources.attachment_json);await until('!!document.querySelector("[data-action=fee-tax-adopt]")');await action('fee-tax-adopt');await until('!document.querySelector("[data-action=fee-tax-adopt]")');
  await upload('fee-precision-file-input',f.sources.precision_json);await until('!!document.querySelector("[data-action=fee-precision-adopt]")');await action('fee-precision-adopt');await action('fee-precision-confirm');await until('!document.querySelector("[data-action=fee-precision-adopt]")');
  await upload('fee-envelope-file-input',f.raw);await until('!!document.querySelector("[data-fee-envelope-preview]")');for(const key of await evaluate('[...document.querySelectorAll("[data-fee-envelope-choice]")].map(e=>e.dataset.feeEnvelopeChoice)'))await native('[data-fee-envelope-choice="'+key+'"]');await action('fee-envelope-adopt');await until('!document.querySelector("[data-fee-envelope-preview]")');
 }
 await page.call('Runtime.enable');await page.call('Page.enable');await page.call('Network.enable');await page.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await nav('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});await until('!!window.__feeCapacity92&&!!document.querySelector("[data-fee-workflow-guide]")');
 const {feePerformanceFixture}=await server.ssrLoadModule('/tools/fee-performance-fixture.ts'),{booksToRows}=await server.ssrLoadModule('/src/ui/fx-rows.ts');
 const cases=[];
 for(const count of[1,4,8]){
  console.log('Capacity fixture '+count);
  const f=await feePerformanceFixture(count),rows=booksToRows(f.pair.project.fx_books),fixtureHashes=Object.fromEntries(Object.entries({...f.sources,envelope_json:f.raw}).map(([key,raw])=>[key,raw===null?null:{utf8_bytes:Buffer.byteLength(raw),sha256:sha(raw)}]));
  await evaluate(`localStorage.clear();localStorage.setItem('trade-cost-engine:workspace-mode-v1','professional');localStorage.setItem('trade-cost-engine:onboarding-v1','hidden');localStorage.setItem('trade-cost-engine:draft-v1',${JSON.stringify(JSON.stringify({project:f.pair.project,fxRows:rows,pair_fx_row_key:JSON.stringify(rows)}))});localStorage.setItem('trade-cost-engine:container-bill-v1',${JSON.stringify(f.sources.bill_json)});localStorage.setItem('trade-cost-engine:container-cost-pair-v1',${JSON.stringify(f.sources.pair_json)});`);
  await nav('Page.reload');await until('!!window.__feeCapacity92&&!!document.querySelector("[data-fee-workflow-guide]")');await adopt(f);
  await save('save');await save('fee-envelope-save');await native('[data-customer-field="reviewed"]');
  if(!await evaluate('document.querySelector("[data-customer-field=reviewed]").checked'))throw Error('Customer review not explicitly set');
  console.log('Shape pass '+count);const shape=await evaluate('window.__feeCapacity92.measure('+count+',"SHAPE")');delete shape.backup_text;
  const samples=[];
  for(let run=0;run<4;run++){
   console.log('Stage pass '+count+' #'+run);const sample=await evaluate('window.__feeCapacity92.measure('+count+',"MEASURE")'),raw=sample.backup_text;delete sample.backup_text;
   if(raw!==null){
    const archived=JSON.parse(raw),decoded=readRuntimeFeeBackup(archived);
    if(decoded.kind!=='INTERNAL_RUNTIME_FEE_WORKBENCH_CHECK_BACKUP'||decoded.version!=='0.2'||decoded.financial_writes!==0||decoded.import_authority!==false||sha(JSON.stringify(decoded.capture))!==sample.capture_sha256||decoded.prepared_candidate.pending_patches.length!==10||decoded.prepared_candidate.summary.costs_added!==count||decoded.prepared_candidate.summary.before.seller_profit!==null||decoded.prepared_candidate.summary.after.seller_profit!==null)throw Error('Complete original backup roundtrip differs');
    sample.backup={encoded_utf8_bytes:Buffer.byteLength(raw),raw_utf8_bytes:archived.kind==='INTERNAL_RUNTIME_FEE_BACKUP_ARCHIVE'?archived.raw_bytes:Buffer.byteLength(raw),encoded_sha256:sha(raw),kind:archived.kind,complete_capture_roundtrip:true,ten_pending_patches:true,no_import_authority:true,no_application_receipt:true};
   }else sample.backup=null;
   samples.push(sample);await writeFile(join(out,'stage-progress.json'),JSON.stringify({cases,current:{count,shape,samples}},null,2));
  }
  // Original native actions after read-only samples. Save API acknowledgement excludes physical disk I/O.
  const sourceBefore=await evaluate('window.__feeCapacity92.sourceHashes()');
  let nativeBackup;
  if(count===1){
   await evaluate('window.__feeCapacity92.startNative()');
   const saved=await save('fee-envelope-workbench-backup');
   nativeBackup={scope:'ORIGINAL_ACTION_UNPREPARED_BACKUP',writer_calls:1,encoded_utf8_bytes:saved.bytes,json_parseable:saved.json_parseable,trace:await evaluate('window.__feeCapacity92.endNative()')};
   if(nativeBackup.writer_calls!==1||nativeBackup.trace.events.some(e=>e.status==='REJECTED'))throw Error('Single fixture backup did not reach writer');
  }else{
   await evaluate("window.capacityNative92={writes:0};window.showSaveFilePicker=async()=>{window.capacityNative92.writes++;throw Error('Backup must reject before writer');};window.__feeCapacity92.startNative();");
   await action('fee-envelope-workbench-backup');
   await until("/操作未完成|报告超限/.test(document.querySelector('[data-fee-envelope-export]').textContent)");
   nativeBackup={scope:'ORIGINAL_ACTION_CAPTURE_REFUSAL',writer_calls:await evaluate('window.capacityNative92.writes'),trace:await evaluate('window.__feeCapacity92.endNative()')};
   const measuredFailure=samples[0].trace.events.filter(e=>e.status==='REJECTED').at(-1)?.phase,nativeFailure=nativeBackup.trace.events.filter(e=>e.status==='REJECTED').at(-1)?.phase;
   if(nativeBackup.writer_calls!==0||!measuredFailure||nativeFailure!==measuredFailure)throw Error('Original backup rejection stage differs');
  }
  const saves=[];
  for(const[key,field]of[['save','project_json'],['bill-save','bill_json'],['pair-save','pair_json'],['fee-tax-save','attachment_json'],['fee-precision-save','precision_json'],['fee-envelope-save','envelope_json']]){
   const expected=await evaluate('window.__feeCapacity92.sourceHashes()'),saved=await save(key);
   if(saved.sha256!==expected[field]?.sha256||saved.bytes!==expected[field]?.bytes||!saved.json_parseable)throw Error('Formal file save differs '+key);
   saves.push({action:key,source:field,bytes:saved.bytes,sha256:saved.sha256,json_parseable:true,equals_current_source:true});
  }
  const sourceAfter=await evaluate('window.__feeCapacity92.sourceHashes()');
  if(JSON.stringify(sourceBefore)!==JSON.stringify(sourceAfter)||!await evaluate('document.querySelector("[data-customer-field=reviewed]").checked'))throw Error('Fallback changed source text or customer review');
  cases.push({count,fixture_hashes:fixtureHashes,shape,samples,native_backup:nativeBackup,formal_file_fallback:{saves,six_source_texts_unchanged:true,customer_review_kept:true,physical_disk_io_verified:false}});
  await writeFile(join(out,'stage-progress.json'),JSON.stringify({cases},null,2));
 }
 const prior=JSON.parse(await readFile(join(root,'docs/cases/fee-semantic-integration-native.json'),'utf8')),paths=[...Object.keys(prior.source_fingerprints),'tools/fee-capacity-trace.ts','tools/fee-capacity-bridge.mjs','tools/check-fee-capacity-browser.mjs','tests/fee-capacity-trace.test.ts'];
 const fingerprints={};for(const path of paths)fingerprints[path]=blob(Buffer.from((await readFile(join(root,path),'utf8')).replace(/\r\n/g,'\n')));
 const runtime=await readFile(join(root,'trade-cost-engine.html')),report={kind:'SYNTHETIC_FEE_CAPACITY_STAGE_BROWSER_EVIDENCE',version:'1.0',generated_at:new Date().toISOString(),source_fingerprints:fingerprints,offline_runtime_blob:blob(runtime),
  methodology:{fixture:'UNCHANGED_FEE_PERFORMANCE_FIXTURE_1_4_8',transport:'113 USD per independent synthetic component; commercial USD/CNY 7',viewport:[1440,1000],shape_pass_excluded_from_timings:true,first_plus_repeated:3,nested_timings_overlap:true,first_is_cold_start:false,latency_thresholds:false,scope:'Dedicated transformed actual app callbacks, original strict guards, preview, ten-holder preparer and backup encoder; no business apply',backup_read_is_cached:true,save_api_substitute:true,file_upload_substitute:true,physical_disk_io_verified:false,production_capacity_changed:false},
  cases,navigation_dialogs:navigationDialogs,unexpected_dialog:unexpectedDialog,exceptions,resources_local_only:requests.every(u=>/^(?:http:\/\/127\.0\.0\.1:4198\/|blob:|data:)/.test(u)),financial_writes:0,financial_application_used:false,confirmation_authority:false,real_phone_verified:false,professional_review_verified:false};
 if(exceptions.length||unexpectedDialog!==null||!report.resources_local_only)throw Error('Unexpected capacity browser effect');
 await writeFile(join(out,'fee-capacity-stages.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({cases:cases.map(c=>({count:c.count,status:c.samples[0].status,failure:c.samples[0].failure})),financialWrites:0,complete:true}));
}finally{try{if(browser&&target)await browser.call('Target.closeTarget',{targetId:target});}finally{page?.ws.close();browser?.ws.close();await server.close();}}
