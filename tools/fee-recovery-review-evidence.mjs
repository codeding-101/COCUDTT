/** Historical artifact comparison only; phase124 independently checks the current build. */
import{historicalRuntime}from'./fee-input-preservation-evidence.mjs';
/** Local phase102 qualification. The held phase101 reports and input stay immutable and local. */
import {readFileSync,readdirSync} from 'node:fs';
import {preferenceQualifiedFingerprints} from './fee-recovery-preferences-evidence.mjs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),read=p=>readFileSync(join(root,p));
export const reviewBlob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
const normalized=p=>Buffer.from(read(p).toString('utf8').replace(/\r\n/g,'\n'));
export const reviewAddedPaths=['tests/fee-recovery-review.test.ts','tools/check-fee-recovery-review-browser.mjs','tools/check-fee-recovery-review.mjs','tools/fee-recovery-review-cases.ts','tools/fee-recovery-review-evidence.mjs','tools/fee-recovery-review-panel.ts','tools/fee-recovery-review.ts'];
export const reviewChangedPaths={'tools/fee-recovery-business-evidence.mjs':'bbca1b9ba56e5d1c90b3e42d88585274b11dd971','tools/check-fee-recovery-business.mjs':'edffb5ea6b3b012f743be845068483123ca3bb80'};
export const reviewHistoricalPins={'docs/cases/fee-browser-recovery-design.json':'056faaccabd47224c02399fb0a2a0249f25ebab1','docs/cases/fee-layered-source-mapping.json':'a355b0ac444c27b7bf37e90b00049684a82e1f1c','docs/cases/fee-layered-capture.json':'e76897b967035fda0d4b454091a53d03f6a894e2','docs/cases/fee-save-guidance-native.json':'fcde6e69f016c1d05d6815b525f7c14221e9a322','docs/cases/fee-semantic-integration.json':'a4e828d7d381ff1b11f18327a423d83b185b92fd','docs/cases/fee-semantic-integration-native.json':'10b74badb33f8f895e5c1cfd9fbe36e8f2166119','docs/cases/fee-capacity-stages.json':'3d0ca1c65ab290e36495ffee0ef9fd57cc051215','docs/cases/fee-browser-native-codec.json':'7e7a0bb5e23fe85cd6b019d187087c00f3560747','docs/cases/fee-recovery-format.json':'8aa6395d96cb2448b1ab0021e2ec8cbd18050ee1','docs/cases/fee-recovery-sharing.json':'31479fc662a639135df0ac6d025a6632f8160f33','docs/cases/fee-recovery-reopen.json':'824ceb5763fe283a668ae3ad8a32fbfe09850691','docs/cases/fee-recovery-business.json':'48750c9b944eb3940d4ac4b53822775a01ebd4ef'};
export function reviewPaths(){const paths=[];function walk(dir){for(const e of readdirSync(join(root,dir),{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())walk(p);else if(e.name.endsWith('.ts'))paths.push(p);}}walk('src');walk('tests');for(const f of readdirSync(join(root,'tools')))if(/\.(?:ts|mjs)$/.test(f))paths.push('tools/'+f);return paths.concat('package.json','package-lock.json').sort();}
export function reviewFingerprints(){return Object.fromEntries(reviewPaths().map(p=>[p,reviewBlob(normalized(p))]));}
export function reviewQualifiedFingerprints(baseline,paths){
  for(const[p,sha]of Object.entries(reviewHistoricalPins))if(reviewBlob(normalized(p))!==sha)throw Error('Reading history changed '+p);
  const old=JSON.parse(read('docs/cases/fee-recovery-business.json')),actual=JSON.parse(read('docs/cases/fee-recovery-review.json')).source_fingerprints;
  if(JSON.stringify(baseline)!==JSON.stringify(old.source_fingerprints)||Object.keys(baseline).length!==524||Object.entries(reviewChangedPaths).some(([p,s])=>baseline[p]!==s)||JSON.stringify(Object.keys(actual).sort())!==JSON.stringify(Object.keys(baseline).concat(reviewAddedPaths).sort()))throw Error('Reading baseline inventory');
  for(const[p,s]of Object.entries(baseline))if(!Object.hasOwn(reviewChangedPaths,p)&&actual[p]!==s)throw Error('Original production/test/tool changed '+p);
  if(historicalRuntime().blob!=='3d1ab6e3413840b44e80de577956b0364343952c'||createHash('sha256').update(read('docs/cases/fee-recovery-business-input.json')).digest('hex')!=='3c2be129eb846b336bb8aea7affcd92a12339e73dbcfe3942a93430934c90816')throw Error('Reading runtime or held fixture changed');
  return preferenceQualifiedFingerprints(actual,paths);
}
