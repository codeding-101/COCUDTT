import{resourceOwnerQualifiedFingerprints}from'./fee-resource-owner-evidence.mjs';
/** Qualification of a small diagnostic codec change; all previous evidence stays immutable. */
import{readFileSync,readdirSync}from'node:fs';import{resolve,join}from'node:path';import{createHash}from'node:crypto';
const root=resolve(import.meta.dirname,'..'),read=p=>readFileSync(join(root,p)),blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex'),normalized=p=>Buffer.from(read(p).toString('utf8').replace(/\r\n/g,'\n')),priorFile='docs/cases/fee-workbench-retention.json',prior=JSON.parse(read(priorFile));
export const sessionTimingAddedPaths=['tests/fee-session-timing.test.ts','tools/fee-session-timing-cases.ts','tools/fee-session-timing-evidence.mjs','tools/check-fee-session-timing.mjs','tools/check-fee-session-timing-browser.mjs'];
export const sessionTimingChangedPaths=Object.fromEntries(['tools/fee-browser-native-codec.ts','tools/fee-workbench-retention-evidence.mjs','tools/check-fee-workbench-retention.mjs'].map(p=>[p,prior.source_fingerprints[p]]));
export const sessionTimingHistoricalPins={...prior.historical_reports,[priorFile]:'8d41dc3cfc56c575cb736109892dfbd81d61ca16'};
export function sessionTimingPaths(){const paths=[];function walk(dir){for(const e of readdirSync(join(root,dir),{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())walk(p);else if(e.name.endsWith('.ts'))paths.push(p);}}walk('src');walk('tests');for(const f of readdirSync(join(root,'tools')))if(/\.(?:mjs|ts)$/.test(f))paths.push('tools/'+f);return paths.concat('package.json','package-lock.json').sort();}
export function sessionTimingFingerprints(){return Object.fromEntries(sessionTimingPaths().map(p=>[p,blob(normalized(p))]));}
export function sessionTimingQualifiedFingerprints(baseline,paths){if(JSON.stringify(baseline)!==JSON.stringify(prior.source_fingerprints))throw Error('Historical timing baseline');return resourceOwnerQualifiedFingerprints(JSON.parse(read('docs/cases/fee-session-timing.json')).source_fingerprints,paths);}

/** Historic checks may compare old captures only to their old codec. Current code is
 * validated first above, and new measurements MUST use the actual fingerprint API. */
export function sessionTimingHistoricalBindings(baseline,paths){const actual=sessionTimingQualifiedFingerprints(baseline,paths);return{...actual,'tools/fee-browser-native-codec.ts':prior.source_fingerprints['tools/fee-browser-native-codec.ts']};}
