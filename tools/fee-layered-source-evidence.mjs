/** Same-runtime qualification of phase95 observation tools; historical reports and all production files are immutable. */
import{readFileSync,readdirSync}from'node:fs';import{resolve,join}from'node:path';import{createHash}from'node:crypto';
const root=resolve(import.meta.dirname,'..'),read=p=>readFileSync(join(root,p)),blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
export const sourceMappingHistoricalPins={
 'docs/cases/fee-layered-capture.json':'e76897b967035fda0d4b454091a53d03f6a894e2',
 'docs/cases/fee-save-guidance-native.json':'fcde6e69f016c1d05d6815b525f7c14221e9a322',
 'docs/cases/fee-semantic-integration.json':'a4e828d7d381ff1b11f18327a423d83b185b92fd',
 'docs/cases/fee-semantic-integration-native.json':'10b74badb33f8f895e5c1cfd9fbe36e8f2166119',
 'docs/cases/fee-capacity-stages.json':'3d0ca1c65ab290e36495ffee0ef9fd57cc051215'};
export const sourceMappingAddedPaths=['tools/fee-layered-source-mapping.ts','tools/fee-layered-browser-utf8.ts','tools/fee-layered-browser-port.ts','tools/fee-layered-source-diagnostic.ts','tools/fee-layered-source-bridge.mjs','tools/check-fee-layered-source-browser.mjs','tools/fee-layered-source-evidence.mjs','tools/check-fee-layered-source-mapping.mjs','tests/fee-layered-source-mapping.test.ts','tests/fee-layered-browser-port.test.ts','tests/fee-layered-source-diagnostic.test.ts'].sort();
export const sourceMappingChangedPaths={'tools/fee-layered-capture-evidence.mjs':'1501c22ff1a9031a2801e57446035eba0f1fd92f','tools/check-fee-layered-capture.mjs':'1d8d23f8289f44125dd10cee2c9af40df5913dbe','tools/fee-save-guidance-evidence.mjs':'44222e7445a4ca61b12f6c1970a83172affc015a','tools/fee-semantic-integration-evidence.mjs':'86f100d1fd182182b5fbe811a4ff8e52069eb598','package-lock.json':'e8f4fefd577d80ff763528598f80bc9dbb3358ea'};
export const fastUriSecurityPatch={package:'node_modules/fast-uri',from:'3.1.8',to:'3.1.9',old_lock_blob:'e8f4fefd577d80ff763528598f80bc9dbb3358ea',new_lock_blob:'7629862d23bbd3f58c1069ddf8bb7ac66c1c6525',development_only:true,changed_packages:1,advisories:['GHSA-w74x-v6f9-j3xg','GHSA-xhq7-xmqj-769h','GHSA-wjr9-j795-jxcr','GHSA-333x-w4r6-6crp']};
export function assertFastUriSecurityPatch(){
 const raw=read('package-lock.json').toString('utf8').replace(/\r\n/g,'\n'),lock=JSON.parse(raw),entry=lock.packages['node_modules/fast-uri'];
 if(blob(Buffer.from(raw))!==fastUriSecurityPatch.new_lock_blob||entry.version!=='3.1.9'||entry.dev!==true||entry.resolved!=='https://registry.npmjs.org/fast-uri/-/fast-uri-3.1.9.tgz'||entry.integrity!=='sha512-hS/0Wt3Ya043oKXs0sIxrMpKQITXhMLIrVAKKXi4gozGC9v7YRWVnXIZzjNPTO02M9BdxLCWqK1yRXgNziVyJQ==')throw Error('Unexpected fast-uri security patch');
 const restored=raw.replace('"version": "3.1.9"','"version": "3.1.8"').replace('fast-uri-3.1.9.tgz','fast-uri-3.1.8.tgz').replace(entry.integrity,'sha512-GZMtZUTNRpOVIECoXwLNZS5xUGE+mVNbTB8h/7Rwh2TFWcBQiPzTgyZi05BF9UMZKkLJv8XBRJTlU7zg8+ZfMg==');
 if(blob(Buffer.from(restored))!==fastUriSecurityPatch.old_lock_blob)throw Error('Security patch changed more than one locked package');
}
/** Qualify only exact historical pins against this phase's complete current inventory. */
export function sourceMappingHistoricalFingerprint(path,historical){
 if(sourceMappingChangedPaths[path]!==historical)return false;
 const r=JSON.parse(read('docs/cases/fee-layered-source-mapping.json'));
 if(r.kind!=='SYNTHETIC_FEE_LAYERED_SOURCE_MAPPING_EVIDENCE'||r.base_source_commit!=='62d787702f2c223d4395d0aa736c041ebe4edb49'||r.runtime_integrated!==false||r.financial_writes!==0||r.offline_runtime_blob!==blob(read('trade-cost-engine.html'))||JSON.stringify(r.security_patch)!==JSON.stringify(fastUriSecurityPatch))return false;
 assertFastUriSecurityPatch();return r.source_fingerprints[path]===blob(Buffer.from(read(path).toString('utf8').replace(/\r\n/g,'\n')));
}
export function sourceMappingCurrentPaths(){const out=[];function walk(dir){for(const e of readdirSync(join(root,dir),{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())walk(p);else if(e.name.endsWith('.ts'))out.push(p);}}walk('src');walk('tests');for(const f of readdirSync(join(root,'tools')))if(/\.(?:mjs|ts)$/.test(f))out.push('tools/'+f);return out.concat('package.json','package-lock.json').sort();}
export function sourceMappingCurrentFingerprints(){return Object.fromEntries(sourceMappingCurrentPaths().map(p=>[p,blob(Buffer.from(read(p).toString('utf8').replace(/\r\n/g,'\n')))]));}
export function assertSourceMappingHistoricalPins(){for(const[p,sha]of Object.entries(sourceMappingHistoricalPins))if(blob(Buffer.from(read(p).toString('utf8').replace(/\r\n/g,'\n')))!==sha)throw Error('Source mapping historical evidence changed '+p);}
export function sourceMappingQualifiedFingerprints(baseline,paths){
 assertSourceMappingHistoricalPins();assertFastUriSecurityPatch();const r=JSON.parse(read('docs/cases/fee-layered-source-mapping.json')),old=JSON.parse(read('docs/cases/fee-layered-capture.json'));
 if(r.kind!=='SYNTHETIC_FEE_LAYERED_SOURCE_MAPPING_EVIDENCE'||r.version!=='0.1'||r.base_source_commit!=='62d787702f2c223d4395d0aa736c041ebe4edb49'||r.offline_runtime_blob!=='3d1ab6e3413840b44e80de577956b0364343952c'||blob(read('trade-cost-engine.html'))!==r.offline_runtime_blob||r.runtime_integrated!==false||r.production_capacity_changed!==false||r.financial_writes!==0)throw Error('Source mapping qualification missing');
 if(JSON.stringify(baseline)!==JSON.stringify(old.source_fingerprints)||Object.entries(sourceMappingChangedPaths).some(([p,sha])=>baseline[p]!==sha))throw Error('Source mapping original inventory changed');
 const expected=Object.keys(baseline).concat(sourceMappingAddedPaths).sort(),actual=sourceMappingCurrentFingerprints();
 if(JSON.stringify(paths)!==JSON.stringify(expected)||JSON.stringify(Object.keys(r.source_fingerprints).sort())!==JSON.stringify(expected)||JSON.stringify(r.source_fingerprints)!==JSON.stringify(actual))throw Error('Source mapping coverage or fingerprints changed');
 for(const[p,sha]of Object.entries(baseline))if(!Object.hasOwn(sourceMappingChangedPaths,p)&&actual[p]!==sha)throw Error('Original production/test/tool changed '+p);
 return actual;
}
