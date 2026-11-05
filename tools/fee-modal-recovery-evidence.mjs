import{compositionQualifiedFingerprints,compositionHistoricalBindings}from'./fee-modal-composition-evidence.mjs';
/** Immutable phase125 evidence; projections qualify history, never phase126 measurements. */
import{readFileSync,readdirSync}from'node:fs';import{resolve,join}from'node:path';import{createHash}from'node:crypto';
const root=resolve(import.meta.dirname,'..'),read=p=>readFileSync(join(root,p)),normal=p=>Buffer.from(read(p).toString('utf8').replace(/\r\n/g,'\n')),blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex'),sha=b=>createHash('sha256').update(b).digest('hex');
const priorFile='docs/cases/fee-input-preservation-accepted.json',prior=JSON.parse(read(priorFile)),baselineFile='docs/cases/fee-modal-recovery-baseline.json',baseline=JSON.parse(read(baselineFile)),issued=new WeakSet();
export const modalRecoveryAddedPaths=['tests/helpers/mobile-settings-dom.ts','tests/mobile-settings-recovery.test.ts','tools/fee-modal-recovery-evidence.mjs','tools/check-fee-modal-recovery.mjs','tools/check-fee-modal-recovery-browser.mjs'].sort();
export const modalRecoveryChangedPaths=Object.fromEntries(['src/ui/mobile-settings.ts','tests/mobile-settings.test.ts','tools/fee-input-preservation-evidence.mjs','tools/check-fee-input-preservation.mjs'].map(p=>[p,prior.source_fingerprints[p]]));
export const modalRecoveryHistoricalPins={...prior.historical_reports,[priorFile]:'232580c13c507d176359198faf32bbab146888e6'};
export function modalRecoveryPaths(){const result=[];function walk(dir){for(const e of readdirSync(join(root,dir),{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())walk(p);else if(e.name.endsWith('.ts'))result.push(p);}}for(const dir of['src','tests'])walk(dir);for(const file of readdirSync(join(root,'tools')))if(/\.(?:ts|mjs)$/.test(file))result.push('tools/'+file);return result.concat('package.json','package-lock.json').sort();}
export function modalRecoveryFingerprints(){return Object.fromEntries(modalRecoveryPaths().map(p=>[p,blob(normal(p))]));}
export function modalRecoveryQualifiedFingerprints(){
 for(const[p,pin]of Object.entries(modalRecoveryHistoricalPins))if(blob(normal(p))!==pin)throw Error('Historical modal evidence changed '+p);
 if(blob(normal(baselineFile))!=='8ac5b3f55231e685b470bf44ef05129dc573b84b'||baseline.report_blob!==modalRecoveryHistoricalPins[priorFile]||JSON.stringify(baseline.source_fingerprints)!==JSON.stringify(prior.source_fingerprints))throw Error('Historical phase124 source/AST snapshot changed');
 const actual=compositionQualifiedFingerprints(),historical=compositionHistoricalBindings(actual);
 if(Object.keys(prior.source_fingerprints).length!==702||JSON.stringify(Object.keys(historical))!==JSON.stringify(Object.keys(prior.source_fingerprints).concat(modalRecoveryAddedPaths).sort()))throw Error('Modal recovery source inventory');
 for(const[p,pin]of Object.entries(prior.source_fingerprints))if(!Object.hasOwn(modalRecoveryChangedPaths,p)&&historical[p]!==pin)throw Error('Unexpected modal recovery source change '+p);
 if(sha(read('docs/cases/fee-recovery-business-input.json'))!=='3c2be129eb846b336bb8aea7affcd92a12339e73dbcfe3942a93430934c90816')throw Error('Held business archive changed');
 Object.freeze(actual);issued.add(actual);return actual;
}
export function modalRecoveryHistoricalBindings(actual){if(!issued.has(actual))throw Error('Issued actual modal source required');const historical=Object.fromEntries(Object.entries(compositionHistoricalBindings(actual)).filter(([p])=>!modalRecoveryAddedPaths.includes(p)));return{...historical,...modalRecoveryChangedPaths};}
export function modalRecoveryHistoricalFingerprint(path,pin){if(modalRecoveryChangedPaths[path]!==pin)return false;modalRecoveryQualifiedFingerprints();return true;}
export function historicalInputRuntime(){modalRecoveryQualifiedFingerprints();const m=JSON.parse(read('docs/cases/fee-input-preservation-runtime.json'));if(JSON.stringify(m)!==JSON.stringify(prior.runtime))throw Error('Historical phase124 runtime manifest changed');return m;}
export function historicalInputReport(){modalRecoveryQualifiedFingerprints();return JSON.parse(read(priorFile));}
export function modalRecoveryHistoricalInventory(kind,current){
 const actual=modalRecoveryQualifiedFingerprints(),old=baseline.ast[kind];if(!old)throw Error('Unknown workbench AST kind');
 if(JSON.stringify(Object.keys(current.source_fingerprints))!==JSON.stringify(Object.keys(old.source_fingerprints)))throw Error('Workbench AST source paths changed');
 for(const[p,pin]of Object.entries(current.source_fingerprints))if(actual[p]!==pin||old.source_fingerprints[p]!==pin&&p!=='src/ui/mobile-settings.ts')throw Error('Unqualified current AST source '+p);
 const copy=structuredClone(current),fields=['closing','notice','placement','retireOnRender'],methods=['feedback','finish','lockOverflow','releaseOverflow','restorePanel'];
 if(kind==='switch'){
  const h=copy.holders.find(h=>h.id==='mobile-settings'),before=old.holders.find(h=>h.id==='mobile-settings');
  if(JSON.stringify(h.fields.map(f=>f.name).sort())!==JSON.stringify(before.fields.map(f=>f.name).concat(fields).sort())||h.fields.filter(f=>fields.includes(f.name)).some(f=>f.disposition!=='PRESERVE_THEN_REVIEW'))throw Error('Undeclared mobile state fields');
  h.fields=h.fields.filter(f=>!fields.includes(f.name));
 }
 if(kind==='observation'){
  const h=copy.holders.find(h=>h.id==='mobile-settings'),before=old.holders.find(h=>h.id==='mobile-settings');
  if(JSON.stringify(h.fields)!==JSON.stringify(before.fields.concat(fields).sort())||JSON.stringify(h.methods)!==JSON.stringify(before.methods.concat(methods).sort())||copy.method_count!==46||copy.unbound_fields!==36||copy.original_field_count!==196)throw Error('Undeclared observation AST delta');
  h.fields=h.fields.filter(f=>!fields.includes(f));h.methods=h.methods.filter(m=>!methods.includes(m));copy.method_count-=5;copy.unbound_fields-=4;copy.original_field_count-=4;
 }
 if(kind==='boundaries'){
  const added=s=>s.path==='src/ui/mobile-settings.ts'&&s.owner==='mobile-settings'&&s.kind==='METHOD_ENTRY'&&methods.includes(s.method);
  if(copy.method_entries!==46||copy.sites.filter(added).length!==5)throw Error('Undeclared boundary AST delta');
  copy.sites=copy.sites.filter(s=>!added(s));copy.method_entries-=5;
 }
 const positions=new Set(['line','callee_start','callee_end','args_start','body_start']),unordered=new Set(['sites','resources','lifecycle']);
 const semantic=(v,key='')=>{if(Array.isArray(v)){const values=v.map(x=>semantic(x));return unordered.has(key)?values.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):values;}if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.entries(v).filter(([k,x])=>k!=='source_fingerprints'&&!positions.has(k)&&!(k==='id'&&typeof x==='string'&&/^(?:src|tools)\/[^:]+:\d+:/.test(x))).map(([k,x])=>[k,semantic(x,k)]));};
 if(JSON.stringify(semantic(copy))!==JSON.stringify(semantic(old)))throw Error('Undeclared current/historical workbench structure '+kind);
 return structuredClone(old);
}
export function verifyModalRecoveryRuntime(){const m=JSON.parse(read('docs/cases/fee-modal-recovery-runtime.json')),bytes=read('trade-cost-engine.html'),actual=modalRecoveryQualifiedFingerprints();if(m.phase!==125||m.bytes!==bytes.length||m.blob!==blob(bytes)||m.sha256!==sha(bytes)||!m.local_only||m.diagnostic_included!==false||JSON.stringify(m.source_fingerprints)!==JSON.stringify(compositionHistoricalBindings(actual))||m.blob===prior.runtime.blob)throw Error('Historical phase125 runtime drift');return m;}
