/** Historical artifact comparison only; phase124 independently checks the current build. */
import{historicalRuntime}from'./fee-input-preservation-evidence.mjs';
/** Actual current code and immutable component evidence. Never use projections for new captures. */
import{componentSessionQualifiedFingerprints,componentSessionHistoricalBindings}from'./fee-component-session-evidence.mjs';
import{readFileSync,readdirSync}from'node:fs';import{resolve,join}from'node:path';import{createHash}from'node:crypto';
const root=resolve(import.meta.dirname,'..'),read=p=>readFileSync(join(root,p)),normal=p=>Buffer.from(read(p).toString('utf8').replace(/\r\n/g,'\n')),blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex'),priorFile='docs/cases/fee-field-help.json',prior=JSON.parse(read(priorFile));
export const onboardingAddedPaths=['tests/fee-onboarding-scope.test.ts','tools/fee-onboarding-preference.ts','tools/fee-onboarding-source.ts','tools/fee-onboarding-scope.ts','tools/fee-onboarding-cases.ts','tools/fee-onboarding-evidence.mjs','tools/check-fee-onboarding.mjs','tools/check-fee-onboarding-browser.mjs'];
export const onboardingChangedPaths=Object.fromEntries(['tools/fee-field-help-evidence.mjs','tools/check-fee-field-help.mjs'].map(p=>[p,prior.source_fingerprints[p]]));
export const onboardingHistoricalPins={...prior.historical_reports,[priorFile]:'689e93c12a617e7153434a35182d03f5421cb0e1'};
export function onboardingPaths(){const paths=[];function walk(dir){for(const e of readdirSync(join(root,dir),{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())walk(p);else if(e.name.endsWith('.ts'))paths.push(p);}}for(const dir of['src','tests'])walk(dir);for(const f of readdirSync(join(root,'tools')))if(/\.(?:mjs|ts)$/.test(f))paths.push('tools/'+f);return paths.concat('package.json','package-lock.json').sort();}
export function onboardingFingerprints(){return Object.fromEntries(onboardingPaths().map(p=>[p,blob(normal(p))]));}
export function onboardingQualifiedFingerprints(baseline=prior.source_fingerprints,paths=onboardingPaths()){
 for(const[p,hash]of Object.entries(onboardingHistoricalPins))if(blob(normal(p))!==hash)throw Error('Historical onboarding evidence changed '+p);
 const actual=componentSessionQualifiedFingerprints(),historical=componentSessionHistoricalBindings(actual),completed=JSON.parse(read('docs/cases/fee-onboarding.json'));
 if(JSON.stringify(baseline)!==JSON.stringify(prior.source_fingerprints)||Object.keys(baseline).length!==679||JSON.stringify(paths)!==JSON.stringify(Object.keys(actual))||JSON.stringify(Object.keys(completed.source_fingerprints))!==JSON.stringify(Object.keys(baseline).concat(onboardingAddedPaths).sort()))throw Error('Onboarding source inventory');
 for(const[p,hash]of Object.entries(completed.source_fingerprints))if(historical[p]!==hash)throw Error('Qualified historical onboarding source changed '+p);
 for(const[p,hash]of Object.entries(baseline))if(!Object.hasOwn(onboardingChangedPaths,p)&&historical[p]!==hash)throw Error('Original application/test/dependency changed '+p);
 if(historicalRuntime().blob!=='3d1ab6e3413840b44e80de577956b0364343952c'||createHash('sha256').update(read('docs/cases/fee-recovery-business-input.json')).digest('hex')!=='3c2be129eb846b336bb8aea7affcd92a12339e73dbcfe3942a93430934c90816')throw Error('Runtime or held archive changed');return actual;
}
/** Project only this already-validated map; do not reread/cache business data or stamp new measurements. */
export function onboardingHistoricalBindings(value=onboardingFingerprints()){const actual=onboardingQualifiedFingerprints();if(JSON.stringify(value)!==JSON.stringify(actual))throw Error('Current actual source required');return{...componentSessionHistoricalBindings(actual),...onboardingChangedPaths};}
