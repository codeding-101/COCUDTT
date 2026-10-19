import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=resolve(process.env.BROWSER_CHECK_OUTPUT??'browser-results'),port=process.env.BROWSER_CHECK_PORT??'9415';mkdirSync(out,{recursive:true});
const suites=['china-import','professional-review','actual-quotes','logistics','explanation','foundations','sensitivity','customer-quotes','excel','pdf','bilingual','templates','settlement','funding','recovery','funding-ledger','funding-example','funding-rates','funding-rounding','rounding-example','funding-period-integration','period-example','transport-links','container-bill','container-cost-pair','container-cost-editor','container-business-copy','container-review-integration','workspace','quick-costs','calculation-learning','mobile-settings','input-review','assumptions','customer-views','recent-projects','onboarding','fee-tax-attachment','fee-precision-selection','fee-envelope','workbench-state'];
const targets=await(await fetch(`http://127.0.0.1:${port}/json`)).json(),page=targets.find(p=>p.type==='page'&&!p.url.startsWith('edge:'));if(!page)throw Error('Start a dedicated browser page before running checks');
const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,bad)=>{ws.onopen=ok;ws.onerror=bad});let serial=0;const pending=new Map();ws.onmessage=e=>{const r=JSON.parse(e.data),p=pending.get(r.id);if(p){pending.delete(r.id);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result)}};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
// The original 28 business suites exercise the full professional view. The final
// workspace suite clears storage and independently exercises both presentation modes.
let identifier,guideIdentifier;const results=[];
try{
 await call('Page.enable');identifier=(await call('Page.addScriptToEvaluateOnNewDocument',{source:"try { localStorage.setItem('trade-cost-engine:workspace-mode-v1','professional'); } catch {}"})).identifier;
 // Existing suites intentionally skip the welcome modal. The final suite removes
 // this preference injection and verifies real first-use and restored-draft policy.
 guideIdentifier=(await call('Page.addScriptToEvaluateOnNewDocument',{source:"try { localStorage.setItem('trade-cost-engine:onboarding-v1','hidden'); } catch {}"})).identifier;
 for(const suite of suites){
  if(suite==='workspace'){await call('Page.removeScriptToEvaluateOnNewDocument',{identifier});identifier=undefined;}
  if(suite==='onboarding'){await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:guideIdentifier});guideIdentifier=undefined;}
  const folder=join(out,suite);mkdirSync(folder,{recursive:true});let exitCode=0,log;
  try{log=execFileSync(process.execPath,['tools/'+suite+'-browser-check.mjs'],{cwd:root,env:{...process.env,BROWSER_CHECK_PORT:port,BROWSER_CHECK_OUTPUT:folder},encoding:'utf8',timeout:180000});}
  catch(error){exitCode=error.status??1;log=String(error.stdout??'')+'\n'+String(error.stderr??'');}
  writeFileSync(join(folder,'run.log'),log);results.push({suite,mode:['workspace','quick-costs','calculation-learning','mobile-settings','input-review','assumptions','customer-views','recent-projects','onboarding'].includes(suite)?'both':'professional',exitCode});writeFileSync(join(out,'browser-regression.json'),JSON.stringify(results,null,2));console.log(suite+': '+(exitCode===0?'PASS':'FAIL'));if(exitCode){process.exitCode=1;break;}
 }
}finally{if(identifier)await call('Page.removeScriptToEvaluateOnNewDocument',{identifier});if(guideIdentifier)await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:guideIdentifier});ws.close()}
