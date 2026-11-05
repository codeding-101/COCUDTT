/** Historical artifact comparison only; phase124 independently checks the current build. */
import{historicalRuntime,inputPreservationHistoricalFingerprint}from'./fee-input-preservation-evidence.mjs';
/** Historical stability proof and qualified current bindings. No business-data cache. */
import{fieldHelpQualifiedFingerprints,fieldHelpHistoricalBindings}from'./fee-field-help-evidence.mjs';
import{readFileSync,readdirSync}from'node:fs';import{resolve,join}from'node:path';import{createHash}from'node:crypto';
const root=resolve(import.meta.dirname,'..'),read=p=>readFileSync(join(root,p)),normal=p=>Buffer.from(read(p).toString('utf8').replace(/\r\n/g,'\n')),blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
const priorFile='docs/cases/fee-resource-owner.json',prior=JSON.parse(read(priorFile));
export const jsonStabilityAddedPaths=['tests/fee-json-stability.test.ts','tools/fee-json-stability-oracle.ts','tools/fee-json-stability-cases.ts','tools/fee-json-stability-evidence.mjs','tools/check-fee-json-stability.mjs','tools/check-fee-json-stability-browser.mjs'];
export const jsonStabilityChangedPaths=Object.fromEntries(['src/data/fee-envelope-json.ts','tools/fee-resource-owner-evidence.mjs','tools/check-fee-resource-owner.mjs','tools/fee-save-guidance-evidence.mjs','tools/fee-layered-source-evidence.mjs','tools/fee-browser-recovery-evidence.mjs','tools/fee-browser-native-evidence.mjs','tools/check-fee-save-guidance.mjs'].map(p=>[p,prior.source_fingerprints[p]]));
export const jsonStabilityHistoricalPins={...prior.historical_reports,[priorFile]:'c64a49858ccad619af4e8554c8bd8e8796da9953'};
export const JSON_SSR_BRANCH=" // Node tooling can use its strict UTF-16 intrinsic. The client build retains the original loop.\n if(import.meta.env.SSR){\n  const native=Reflect.get(String.prototype,'isWellFormed');\n  if(typeof native==='function'){if(!Reflect.apply(native,value,[]))fail();return value;}\n }\n";
export function jsonStabilityPaths(){const paths=[];function walk(dir){for(const e of readdirSync(join(root,dir),{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())walk(p);else if(e.name.endsWith('.ts'))paths.push(p);}}walk('src');walk('tests');for(const f of readdirSync(join(root,'tools')))if(/\.(?:mjs|ts)$/.test(f))paths.push('tools/'+f);return paths.concat('package.json','package-lock.json').sort();}
export function jsonStabilityFingerprints(){return Object.fromEntries(jsonStabilityPaths().map(p=>[p,blob(normal(p))]));}
export function jsonStabilityQualifiedFingerprints(baseline=prior.source_fingerprints,paths=jsonStabilityPaths()){
 for(const[p,sha]of Object.entries(jsonStabilityHistoricalPins))if(blob(normal(p))!==sha)throw Error('Historical JSON stability evidence changed '+p);
 if(prior.validation_status!=='INCOMPLETE_FULL_REGRESSION'||prior.unit.success||prior.unit.passed!==6005||prior.unit.failed!==3)throw Error('Original119failure must remain incomplete');
 const actual=fieldHelpQualifiedFingerprints(),historical=fieldHelpHistoricalBindings(actual),completed=JSON.parse(read('docs/cases/fee-json-stability.json'));
 if(JSON.stringify(baseline)!==JSON.stringify(prior.source_fingerprints)||Object.keys(baseline).length!==665||JSON.stringify(paths)!==JSON.stringify(Object.keys(actual))||JSON.stringify(Object.keys(completed.source_fingerprints))!==JSON.stringify(Object.keys(baseline).concat(jsonStabilityAddedPaths).sort()))throw Error('JSON stability inventory');
 for(const[p,sha]of Object.entries(completed.source_fingerprints))if(historical[p]!==sha)throw Error('Qualified historical stability source changed '+p);
 for(const[p,sha]of Object.entries(baseline))if(!Object.hasOwn(jsonStabilityChangedPaths,p)&&historical[p]!==sha)throw Error('Original source changed '+p);
 const parser=normal('src/data/fee-envelope-json.ts').toString(),oracle=normal('tools/fee-json-stability-oracle.ts').toString().replace(/^\/\*\*[^\n]+\*\/\n/,'').replace("from '../src/domain/fee-envelope.js'","from '../domain/fee-envelope.js'");
 if(!parser.includes(JSON_SSR_BRANCH)||blob(Buffer.from(parser.replace(JSON_SSR_BRANCH,'')))!==baseline['src/data/fee-envelope-json.ts']||blob(Buffer.from(oracle))!==baseline['src/data/fee-envelope-json.ts'])throw Error('Only the explicit SSR branch may differ; oracle must be original');
 if(historicalRuntime().blob!=='3d1ab6e3413840b44e80de577956b0364343952c'||read('trade-cost-engine.html').includes(Buffer.from('isWellFormed'))||createHash('sha256').update(read('docs/cases/fee-recovery-business-input.json')).digest('hex')!=='3c2be129eb846b336bb8aea7affcd92a12339e73dbcfe3942a93430934c90816')throw Error('Client runtime or held archive changed');
 return actual;
}
/** Only old evidence evaluators may use this projection. Never stamp a current measurement with it. */
export function jsonStabilityHistoricalBindings(value=jsonStabilityFingerprints()){
 const actual=jsonStabilityQualifiedFingerprints();if(JSON.stringify(value)!==JSON.stringify(actual))throw Error('Historical projection requires validated actual map');return{...fieldHelpHistoricalBindings(actual),...jsonStabilityChangedPaths};
}
export function jsonStabilityHistoricalFingerprint(path,historical){if(inputPreservationHistoricalFingerprint(path,historical))return true;if(jsonStabilityChangedPaths[path]!==historical)return false;jsonStabilityQualifiedFingerprints();return true;}
