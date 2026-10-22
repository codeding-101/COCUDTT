/** Qualification for historical capture evidence after the explicit phase91 integration. */
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),read=p=>readFileSync(join(root,p)),blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
for(const[path,sha]of Object.entries({'docs/cases/fee-source-semantic-budget.json':'637f4ea8e86c90999067831b9f35a16310952d26','docs/cases/fee-source-compatibility-patch.json':'64e207f9a08d8753211d85c14a03c90d52b39edc'})){
 if(blob(Buffer.from(read(path).toString('utf8').replace(/\r\n/g,'\n')))!==sha)throw Error('Historical capture qualification changed '+path);
}
export function integratedFingerprint(path,historical){
 if(path!=='src/ui/app.ts')return false;
 const old=JSON.parse(read('docs/cases/fee-source-semantic-budget.json')),current=JSON.parse(read('docs/cases/fee-semantic-integration.json'));
 return old.source_fingerprints[path]===historical&&current.runtime_integrated===true&&current.integration_decision==='USE_SEMANTIC_CAPTURE'&&current.source_fingerprints[path]===blob(Buffer.from(read(path).toString('utf8').replace(/\r\n/g,'\n')));
}
export function integratedRuntime(historical){
 const old=JSON.parse(read('docs/cases/fee-source-semantic-budget.json')),current=JSON.parse(read('docs/cases/fee-semantic-integration.json'));
 return historical==='c5c59c2c98930c4d1a2bd9a7a56b80967498389b'&&old.offline_runtime_blob===historical&&current.runtime_integrated===true&&current.offline_runtime_blob===blob(read('trade-cost-engine.html'));
}
