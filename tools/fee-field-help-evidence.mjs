/** Historical artifact comparison only; phase124 independently checks the current build. */
import{historicalRuntime}from'./fee-input-preservation-evidence.mjs';
/** Current staged component bindings. Source/runtime of the production application stay pinned. */
import{onboardingQualifiedFingerprints,onboardingHistoricalBindings}from'./fee-onboarding-evidence.mjs';
import{readFileSync,readdirSync}from'node:fs';import{resolve,join}from'node:path';import{createHash}from'node:crypto';
const root=resolve(import.meta.dirname,'..'),read=p=>readFileSync(join(root,p)),normal=p=>Buffer.from(read(p).toString('utf8').replace(/\r\n/g,'\n')),blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex'),priorFile='docs/cases/fee-json-stability.json',prior=JSON.parse(read(priorFile));
export const fieldHelpAddedPaths=['tests/fee-field-help-scope.test.ts','tools/fee-field-help-port.ts','tools/fee-field-help-source.ts','tools/fee-field-help-scope.ts','tools/fee-field-help-cases.ts','tools/fee-field-help-evidence.mjs','tools/check-fee-field-help.mjs','tools/check-fee-field-help-browser.mjs'];
export const fieldHelpChangedPaths=Object.fromEntries(['tools/fee-json-stability-evidence.mjs','tools/check-fee-json-stability.mjs'].map(p=>[p,prior.source_fingerprints[p]]));
export const fieldHelpHistoricalPins={...prior.historical_reports,[priorFile]:'6713a0537105301c910d50deb6208491f6c27b15'};
export function fieldHelpPaths(){const paths=[];function walk(dir){for(const e of readdirSync(join(root,dir),{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())walk(p);else if(e.name.endsWith('.ts'))paths.push(p);}}walk('src');walk('tests');for(const f of readdirSync(join(root,'tools')))if(/\.(?:mjs|ts)$/.test(f))paths.push('tools/'+f);return paths.concat('package.json','package-lock.json').sort();}
export function fieldHelpFingerprints(){return Object.fromEntries(fieldHelpPaths().map(p=>[p,blob(normal(p))]));}
export function fieldHelpQualifiedFingerprints(baseline=prior.source_fingerprints,paths=fieldHelpPaths()){
 for(const[p,hash]of Object.entries(fieldHelpHistoricalPins))if(blob(normal(p))!==hash)throw Error('Historical field-help evidence changed '+p);
 const actual=onboardingQualifiedFingerprints(),historical=onboardingHistoricalBindings(actual),completed=JSON.parse(read('docs/cases/fee-field-help.json'));
 if(JSON.stringify(baseline)!==JSON.stringify(prior.source_fingerprints)||Object.keys(baseline).length!==671||JSON.stringify(paths)!==JSON.stringify(Object.keys(actual))||JSON.stringify(Object.keys(completed.source_fingerprints))!==JSON.stringify(Object.keys(baseline).concat(fieldHelpAddedPaths).sort()))throw Error('Field-help inventory');
 for(const[p,hash]of Object.entries(completed.source_fingerprints))if(historical[p]!==hash)throw Error('Qualified historical field-help source changed '+p);
 for(const[p,hash]of Object.entries(baseline))if(!Object.hasOwn(fieldHelpChangedPaths,p)&&historical[p]!==hash)throw Error('Original field-help/application/test source changed '+p);
 if(historicalRuntime().blob!=='3d1ab6e3413840b44e80de577956b0364343952c'||createHash('sha256').update(read('docs/cases/fee-recovery-business-input.json')).digest('hex')!=='3c2be129eb846b336bb8aea7affcd92a12339e73dbcfe3942a93430934c90816')throw Error('Runtime or held archive changed');
 return actual;
}
export function fieldHelpHistoricalBindings(value=fieldHelpFingerprints()){
 const actual=fieldHelpQualifiedFingerprints();if(JSON.stringify(value)!==JSON.stringify(actual))throw Error('Actual field-help source required before historical projection');return{...onboardingHistoricalBindings(actual),...fieldHelpChangedPaths};
}
