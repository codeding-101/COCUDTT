import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const out=process.env.BROWSER_CHECK_OUTPUT??'C:/Temp/recent-projects';await mkdir(out,{recursive:true});
const url=process.env.BROWSER_CHECK_URL??pathToFileURL(resolve('trade-cost-engine.html')).href;
const pages=await(await fetch(`http://127.0.0.1:${process.env.BROWSER_CHECK_PORT??'9425'}/json`)).json();
const ws=new WebSocket(pages.find(p=>p.type==='page'&&!p.url.startsWith('edge:')).webSocketDebuggerUrl);
await new Promise((ok,bad)=>{ws.onopen=ok;ws.onerror=bad});let serial=0;const pending=new Map(),exceptions=[],requests=[];
ws.onmessage=e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')exceptions.push(r.params.exceptionDetails.text);if(r.method==='Network.requestWillBeSent')requests.push(r.params.request.url);const p=pending.get(r.id);if(p){pending.delete(r.id);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result)}};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
async function until(expression){for(let n=0;n<150;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100))}throw Error(expression)}
const recent='trade-cost-engine:recent-projects-v1',draft='trade-cost-engine:draft-v1';
const get=k=>evaluate(`localStorage.getItem(${JSON.stringify(k)})`),click=a=>evaluate(`document.querySelector('[data-action="${a}"]').click()`);
const field=(path,value)=>evaluate(`(()=>{const e=document.querySelector('[data-path="${path}"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
async function nativeClick(selector){const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...p});}
async function key(key,code,n){for(const type of ['keyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:n,...(key==='Enter'&&type==='keyDown'?{text:'\r'}:{})});}
async function add(){await nativeClick('[data-recent-field=copy]');await click('recent-add');}
async function prepare(){await click('recent-prepare-open');await nativeClick('[data-recent-field=action]');}
const checks={},layouts=[];let injection;
try {
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');
 injection=(await call('Page.addScriptToEvaluateOnNewDocument',{source:`window.recentAccess=[];const get=Storage.prototype.getItem,set=Storage.prototype.setItem;Storage.prototype.getItem=function(k){if(k==='${recent}')window.recentAccess.push('read');return get.call(this,k)};Storage.prototype.setItem=function(k,v){if(k==='${recent}')window.recentAccess.push('write');return set.call(this,k,v)};try{localStorage.setItem('trade-cost-engine:onboarding-v1','hidden')}catch{}` })).identifier;
 await call('Page.navigate',{url});await until("!!document.querySelector('[data-workspace-mode]')");await evaluate('localStorage.clear()');await call('Page.reload');await until("!!document.querySelector('[data-workspace-mode]')");
 checks.startupNoCacheIO=await evaluate('window.recentAccess.length===0');
 await nativeClick('[data-evidence-section=recent-projects] > summary');checks.expandNoCacheIO=await evaluate('window.recentAccess.length===0');
 await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 const initial=await get(draft);await click('recent-refresh');checks.readIsReadOnly=initial===await get(draft)&&await get(recent)===null;
 await click('recent-add');checks.copyRequiresConsent=await get(recent)===null;
 await field('name','RECENT_ORIGINAL_55');await field('quote.amount','100001.123456789012345678');await add();const raw=await get(recent),original=JSON.parse(raw).entries[0].project_text;
 checks.captureExact=JSON.parse(original).quote.amount==='100001.123456789012345678';
 checks.captureDoesNotSaveFile=await evaluate("document.querySelector('.workspace-file-state').textContent.includes('尚未保存为文件')");
 const savedDraft=await get(draft);await add();checks.duplicateNoWrite=raw===await get(recent)&&savedDraft===await get(draft);
 await field('name','WORKING_NEW_55');await prepare();await evaluate("(()=>{const e=document.querySelector('[data-path=\"quote.amount\"]');e.focus();e.select()})()");await call('Input.insertText',{text:'100009'});
 checks.pendingEditRevokes=await evaluate("!document.querySelector('[data-recent-field=action]')");
 await nativeClick('[data-action=recent-refresh]');checks.refreshCommitsPending=JSON.parse(await get(draft)).project.quote.amount==='100009';
 await nativeClick('[data-action=recent-prepare-open]');await nativeClick('[data-recent-field=action]');await nativeClick('[data-action=recent-execute]');
 checks.openRestoresExact=JSON.parse(await get(draft)).project.quote.amount==='100001.123456789012345678';checks.openKeepsCatalog=raw===await get(recent);
 checks.openMarkedUnsaved=await evaluate("document.querySelector('.workspace-file-state').textContent.includes('有未保存改动')");
 await prepare();await evaluate(`window.oldRecentButton=document.querySelector('[data-action=recent-execute]');window.dispatchEvent(new StorageEvent('storage',{key:'${recent}',storageArea:localStorage}));window.oldRecentButton.click()`);
 checks.storageEventRevokes=await evaluate("!document.querySelector('[data-recent-field=action]')");
 await prepare();await evaluate("document.querySelector('[data-recent-field=action]').focus()");await key(' ','Space',32);checks.keyboardUnchecks=await evaluate("!document.querySelector('[data-recent-field=action]').checked");await key(' ','Space',32);await evaluate("document.querySelector('[data-action=recent-execute]').focus()");await key('Enter','Enter',13);checks.keyboardExecutes=await evaluate("!document.querySelector('[data-recent-field=action]')");
 await click('mode-professional');await evaluate("document.querySelector('[data-evidence-section=customer-quote]').open=true");
 const customerSelector=await evaluate("'[data-customer-field='+document.querySelector('textarea[data-customer-field]').dataset.customerField+']'");
 await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(customerSelector)});e.focus();e.select()})()`);await call('Input.insertText',{text:'PRIVATE_CUSTOMER_DRAFT_55'});await nativeClick('[data-action=recent-prepare-open]');
 checks.prepareCommitsCustomer=await evaluate(`document.querySelector(${JSON.stringify(customerSelector)}).value==='PRIVATE_CUSTOMER_DRAFT_55'`);
 await nativeClick('[data-recent-field=action]');await click('recent-execute');checks.openResetsCustomer=await evaluate(`document.querySelector(${JSON.stringify(customerSelector)}).value===''`);
 checks.customerNotCaptured=!original.includes('PRIVATE_CUSTOMER_DRAFT_55');
 await click('add-fx');await add();checks.incompleteFxBlocked=(await get(recent))===raw&&await evaluate("document.querySelector('[data-recent-message]').textContent.includes('汇率行尚未填写完整')");
 // Restore through a fresh explicit open, then fill the three-slot catalog.
 await prepare();await click('recent-execute');await field('name','SECOND_55');await add();await field('name','THIRD_55');await add();const full=await get(recent);await field('name','FOURTH_55');await add();checks.fullDoesNotEvict=await get(recent)===full&&JSON.parse(full).entries.length===3;
 await prepare();await evaluate(`localStorage.setItem('${recent}',${JSON.stringify(raw)})`);await click('recent-execute');checks.rawLeaseRejects=JSON.parse(await get(draft)).project.name==='FOURTH_55'&&await evaluate("!document.querySelector('[data-recent-field=action]')");
 await evaluate(`localStorage.setItem('${recent}',' {"future":99} \\n')`);await click('recent-refresh');checks.invalidCachePreserved=await evaluate("document.querySelector('[data-recent-host]').textContent.includes('可先导出完整原文')&&!document.querySelector('[data-recent-field=copy]')");
 await evaluate("window.recentFiles=[];window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async text=>window.recentFiles.push(text),close:async()=>{}})})");const badRaw=await get(recent),beforeBackup=await get(draft);await click('recent-backup');await until("document.querySelector('[data-recent-message]').textContent.includes('缓存原文已保存')");checks.backupExact=await evaluate(`window.recentFiles[0]===${JSON.stringify(badRaw)}`)&&beforeBackup===await get(draft);
 await evaluate("window.showSaveFilePicker=async()=>{throw new DOMException('PRIVATE_CANCEL','AbortError')}");await click('recent-backup');await until("document.querySelector('[data-recent-message]').textContent.includes('已取消')");checks.backupCancelKeepsRaw=badRaw===await get(recent);
 await evaluate("window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async()=>{throw Error('PRIVATE_WRITE')},close:async()=>{}})})");await click('recent-backup');await until("document.querySelector('[data-recent-message]').textContent.includes('未获确认')");checks.backupFailureNoSecrets=await evaluate("!document.querySelector('[data-recent-host]').textContent.includes('PRIVATE_WRITE')")&&badRaw===await get(recent);
 // Real browser download fallback, exact malformed raw bytes.
 await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:resolve(out)});await evaluate('window.showSaveFilePicker=undefined');await click('recent-backup');await until("document.querySelector('[data-recent-message]').textContent.includes('已发起')");let downloaded;for(let i=0;i<50;i++){try{downloaded=await readFile(join(out,'COCUDTT-recent-projects-internal.json'),'utf8');break}catch{await new Promise(r=>setTimeout(r,100))}}checks.realDownloadExact=downloaded===badRaw;
 await evaluate("localStorage.setItem('unrelated-recent-check','KEEP')");await click('recent-prepare-clear');await click('recent-execute');checks.clearRequiresConsent=badRaw===await get(recent);await nativeClick('[data-recent-field=action]');await click('recent-execute');checks.clearTargetOnly=await get(recent)===null&&await get('unrelated-recent-check')==='KEEP'&&beforeBackup===await get(draft);
 await evaluate(`window.realRecentSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='${recent}')throw Error('PRIVATE_QUOTA');return window.realRecentSet.call(this,k,v)}`);await add();checks.quotaNoFalseSuccess=await get(recent)===null&&await evaluate("document.querySelector('[data-recent-message]').textContent.includes('未获确认')&&!document.querySelector('[data-recent-host]').textContent.includes('PRIVATE_QUOTA')");await evaluate('Storage.prototype.setItem=window.realRecentSet');
 await add();await click('recent-prepare-delete');await nativeClick('[data-recent-field=action]');await click('recent-execute');checks.deleteTargetOnly=JSON.parse(await get(recent)).entries.length===0&&await get('unrelated-recent-check')==='KEEP';
 await click('mode-beginner');for(const width of [1440,768,390,320]){await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<701});layouts.push(await evaluate(`({viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth})`));await writeFile(join(out,'recent-'+width+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));}
 checks.noCacheInProject=!JSON.stringify(JSON.parse(await get(draft)).project).includes('COCUDTT_RECENT_PROJECTS');
 checks.localRequestsOnly=requests.length>0&&requests.every(u=>/^(file:|blob:|data:)/.test(u)||url.startsWith('https:')&&u.startsWith('https://codeding-101.github.io/COCUDTT/'));
 const report={checks,layouts,exceptions,syntheticOnly:true,realPhoneVerified:false};await writeFile(join(out,'recent-projects-browser-report.json'),JSON.stringify(report,null,2));if(Object.values(checks).some(v=>v!==true)||exceptions.length||layouts.some(r=>r.content>r.viewport))throw Error(JSON.stringify(report));console.log(JSON.stringify(report,null,2));
} finally {
 if(injection)await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:injection});await call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});ws.close();
}
