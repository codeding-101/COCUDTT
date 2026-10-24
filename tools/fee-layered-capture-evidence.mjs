/** Same-runtime qualification only for the phase94 developer protocol additions and one evidence gate. */
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {sourceMappingQualifiedFingerprints,sourceMappingHistoricalFingerprint} from './fee-layered-source-evidence.mjs';
const root=resolve(import.meta.dirname,'..'),read=p=>readFileSync(join(root,p)),blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
export const layeredHistoricalPins={
 'docs/cases/fee-save-guidance-native.json':'fcde6e69f016c1d05d6815b525f7c14221e9a322',
 'docs/cases/fee-semantic-integration.json':'a4e828d7d381ff1b11f18327a423d83b185b92fd',
 'docs/cases/fee-semantic-integration-native.json':'10b74badb33f8f895e5c1cfd9fbe36e8f2166119',
 'docs/cases/fee-capacity-stages.json':'3d0ca1c65ab290e36495ffee0ef9fd57cc051215'};
export const layeredAddedCodePaths=['tests/fee-layered-capture.test.ts','tests/fee-layered-capture-budget.test.ts','tests/fee-layered-capture-state.test.ts','tools/fee-layered-capture-prototype.ts','tools/fee-layered-capture-cases.ts','tools/fee-layered-capture-diagnostic.ts','tools/fee-layered-capture-evidence.mjs','tools/check-fee-layered-capture.mjs'].sort();
export const layeredChangedHistoricalPath='tools/check-fee-save-guidance.mjs';
export function layeredCurrentPaths(){const paths=[];function walk(dir){for(const e of readdirSync(join(root,dir),{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())walk(p);else if(e.name.endsWith('.ts'))paths.push(p);}}walk('src');walk('tests');for(const f of readdirSync(join(root,'tools')))if(/\.(?:mjs|ts)$/.test(f))paths.push('tools/'+f);return paths.concat('package.json','package-lock.json').sort();}
export function layeredCurrentFingerprints(){return Object.fromEntries(layeredCurrentPaths().map(p=>[p,blob(Buffer.from(read(p).toString('utf8').replace(/\r\n/g,'\n')))]));}
export function assertLayeredHistoricalPins(){for(const[p,sha]of Object.entries(layeredHistoricalPins))if(blob(Buffer.from(read(p).toString('utf8').replace(/\r\n/g,'\n')))!==sha)throw Error('Layered historical evidence changed '+p);}
export function layeredCaptureFingerprints(previous,paths){
 assertLayeredHistoricalPins();const r=JSON.parse(read('docs/cases/fee-layered-capture.json')),old=JSON.parse(read('docs/cases/fee-save-guidance-native.json'));
 if(r.kind!=='SYNTHETIC_FEE_LAYERED_CAPTURE_PROTOCOL'||r.version!=='0.1'||r.base_source_commit!=='84858f66263d062c1235c17395cf9cb5458d1d80'||r.offline_runtime_blob!=='3d1ab6e3413840b44e80de577956b0364343952c'||blob(read('trade-cost-engine.html'))!==r.offline_runtime_blob||r.runtime_integrated!==false||r.production_capacity_changed!==false||r.financial_writes!==0)throw Error('Layered scope qualification missing');
 if(JSON.stringify(previous)!==JSON.stringify(old.source_fingerprints)||old.source_fingerprints[layeredChangedHistoricalPath]!=='27c13d030420165a4dde727e61e64df17a9b2f43')throw Error('Layered historical source inventory changed');
 const expected=Object.keys(previous).concat(layeredAddedCodePaths).sort(),actual=sourceMappingQualifiedFingerprints(r.source_fingerprints,paths);
 if(JSON.stringify(Object.keys(r.source_fingerprints).sort())!==JSON.stringify(expected))throw Error('Layered historical source coverage changed');
 for(const[p,sha]of Object.entries(previous))if(p!==layeredChangedHistoricalPath&&actual[p]!==sha&&!sourceMappingHistoricalFingerprint(p,sha))throw Error('Original production/test/tool changed '+p);
 return actual;
}
