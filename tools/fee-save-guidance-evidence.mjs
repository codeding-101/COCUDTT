/** Explicit qualification of unchanged historical measurements after the phase93 UI-only update. */
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {sourceMappingHistoricalFingerprint} from './fee-layered-source-evidence.mjs';
const root=resolve(import.meta.dirname,'..'),read=path=>readFileSync(join(root,path)),blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
export const guidanceHistoricalPins = {"docs/cases/fee-semantic-integration.json":"a4e828d7d381ff1b11f18327a423d83b185b92fd","docs/cases/fee-semantic-integration-native.json":"10b74badb33f8f895e5c1cfd9fbe36e8f2166119","docs/cases/fee-capacity-stages.json":"3d0ca1c65ab290e36495ffee0ef9fd57cc051215"};
const historical=[];
for(const[path,sha]of Object.entries(guidanceHistoricalPins)){
 const bytes=Buffer.from(read(path).toString('utf8').replace(/\r\n/g,'\n'));
 if(blob(bytes)!==sha)throw Error('Historical save-guidance evidence changed '+path);
 historical.push(JSON.parse(bytes));
}
export const guidanceChangedHistoricalPaths = ['src/ui/fee-envelope-workspace.ts','src/ui/fee-workflow-guide.ts','tools/check-fee-semantic-integration.mjs','tools/check-fee-capacity-stages.mjs','tools/fee-semantic-integration-evidence.mjs','tools/check-fee-application-design.mjs','tools/check-fee-envelope-design.mjs'];
let current;
function report(){
 current??=JSON.parse(read('docs/cases/fee-save-guidance-native.json'));
 if(current.kind!=='SYNTHETIC_FEE_SAVE_GUIDANCE_NATIVE_REGRESSION'||current.version!=='1.0'||current.base_source_commit!=='a0bed5c37d964b777acf1e4c3373c78555eea9e2'||current.production_capacity_changed!==false)throw Error('Current guidance qualification missing');
 return current;
}
export function guidanceFingerprint(path,sha){
 if(sourceMappingHistoricalFingerprint(path,sha))return true;
 if(!guidanceChangedHistoricalPaths.includes(path)||!historical.some(r=>r.source_fingerprints[path]===sha))return false;
 return report().source_fingerprints[path]===blob(Buffer.from(read(path).toString('utf8').replace(/\r\n/g,'\n')))||sourceMappingHistoricalFingerprint(path,report().source_fingerprints[path]);
}
export function guidanceRuntime(sha){
 return sha==='9966a3dc64ffb6db96f0e2b6093db30826b6beeb'&&report().historical_runtime_blob===sha&&report().offline_runtime_blob===blob(read('trade-cost-engine.html'));
}
