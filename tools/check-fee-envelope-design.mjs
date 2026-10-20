// Reduced protocol oracle only. No production parser, migration, storage or financial writer.
import{readFileSync,readdirSync}from'node:fs';import{createHash}from'node:crypto';import{isDeepStrictEqual}from'node:util';
const fixture=JSON.parse(readFileSync(new URL('../docs/cases/fee-envelope-design.json',import.meta.url),'utf8'));
const fail=()=>{throw Error('UNSUPPORTED_FEE_ENVELOPE_DESIGN_INPUT');};
const shape=(v,fields)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==fields.split(' ').sort().join('|'))fail();};
const text=v=>{if(typeof v!=='string'||!v.trim()||v.length>200||['__proto__','constructor','prototype'].includes(v))fail();};
const hash=v=>{if(typeof v!=='string'||!/^[0-9a-f]{64}$/.test(v))fail();};
const member=(v,values)=>{if(!values.includes(v))fail();};
const count=(v,min,max)=>{if(!Number.isSafeInteger(v)||v<min||v>max)fail();};
const array=(v,max)=>{if(!Array.isArray(v)||v.length>max)fail();};
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const sha=s=>createHash('sha256').update(s).digest('hex');
function raw(s){if(typeof s!=='string'||!s.length||Buffer.byteLength(s)>100000)fail();try{JSON.parse(s);}catch{fail();}}
const key=r=>canonical([r.business_id,r.bill_id,r.line_id]);
function target(r){shape(r,'business_id bill_id line_id cost_id mapping_id operation');for(const v of Object.values(r))text(v);member(r.operation,['CREATE_NEW','REFERENCE_EXISTING']);}
function seal(entry){const{entry_sha256:_,...body}=entry;return sha(canonical(body));}
function ledger(v){
 shape(v,'business_id origin revision genesis_payload_json genesis_sha256 entries retired_cost_ids current_payload_json');text(v.business_id);member(v.origin,['NEW_DECLARED','UNKNOWN_IMPORTED']);count(v.revision,1,1000000000);raw(v.genesis_payload_json);hash(v.genesis_sha256);raw(v.current_payload_json);array(v.entries,64);array(v.retired_cost_ids,3200);v.retired_cost_ids.forEach(text);if(new Set(v.retired_cost_ids).size!==v.retired_cost_ids.length)fail();
 const issues=[],ids=new Set(),consumed=new Set(),targets=new Set();let previous=v.genesis_sha256;
 if(sha(v.genesis_payload_json)!==v.genesis_sha256)issues.push('GENESIS_DIGEST_MISMATCH');
 if(v.origin==='UNKNOWN_IMPORTED')issues.push('HISTORY_NOT_ESTABLISHED');
 if(v.revision<v.entries.length+1)issues.push('REVISION_BEHIND_HISTORY');
 for(const[i,e]of v.entries.entries()){
  shape(e,'transaction_id sequence previous_sha256 plan_json plan_sha256 before_payload_json before_sha256 after_payload_json after_sha256 rows entry_sha256');text(e.transaction_id);count(e.sequence,1,64);for(const k of['previous_sha256','plan_sha256','before_sha256','after_sha256','entry_sha256'])hash(e[k]);for(const k of['plan_json','before_payload_json','after_payload_json'])raw(e[k]);array(e.rows,50);if(!e.rows.length)fail();e.rows.forEach(target);
  if(ids.has(e.transaction_id))issues.push('DUPLICATE_TRANSACTION_ID');ids.add(e.transaction_id);
  if(e.sequence!==i+1)issues.push('SEQUENCE_GAP');if(e.previous_sha256!==previous)issues.push('CHAIN_LINK_MISMATCH');
  if(sha(e.plan_json)!==e.plan_sha256||sha(e.before_payload_json)!==e.before_sha256||sha(e.after_payload_json)!==e.after_sha256||seal(e)!==e.entry_sha256)issues.push('RECEIPT_DIGEST_MISMATCH');
  const batchSources=new Set(),batchTargets=new Set();
  for(const r of e.rows){if(r.business_id!==v.business_id)issues.push('BUSINESS_ID_MISMATCH');const k=key(r);if(batchSources.has(k))issues.push('DUPLICATE_BATCH_SOURCE');if(batchTargets.has(r.cost_id))issues.push('DUPLICATE_BATCH_TARGET');batchSources.add(k);batchTargets.add(r.cost_id);
   if(r.operation==='CREATE_NEW'){if(consumed.has(k))issues.push('SOURCE_ALREADY_CONSUMED');if(targets.has(r.cost_id))issues.push('TARGET_ALREADY_CREATED');consumed.add(k);targets.add(r.cost_id);}
  }
  previous=e.entry_sha256;
 }
 return{issues:[...new Set(issues)],head:previous,consumed:[...consumed],targets:[...targets]};
}
function patch(base,patches){array(patches,30);const copy=structuredClone(base);for(const p of patches){shape(p,'path value');if(typeof p.path!=='string')fail();const parts=p.path.split('.');if(parts.some(s=>['__proto__','constructor','prototype'].includes(s)))fail();let at=copy;for(const k of parts.slice(0,-1)){if(!at||typeof at!=='object'||!Object.hasOwn(at,k))fail();at=at[k];}const k=parts.at(-1);if(!at||typeof at!=='object'||!Object.hasOwn(at,k))fail();at[k]=p.value;}return copy;}
function evaluate(c){const v=c.input;switch(c.family){
 case'ADOPTION':{
  shape(v,'source action');member(v.source,['NEW_EMPTY','PROJECT_0_8','PROJECT_0_9','PAIR_1_0','PAIR_1_1','MEMORY_BACKUP','VALID_ENVELOPE','UNKNOWN_ENVELOPE']);member(v.action,['PREVIEW','ADOPT','RESTORE']);
  return{status:v.source==='NEW_EMPTY'?'EXPLICIT_NEW_BUSINESS_REQUIRED':v.source==='VALID_ENVELOPE'?'VALIDATED_PREVIEW_NO_INSTALL':v.source==='UNKNOWN_ENVELOPE'?'UNSUPPORTED_VERSION':v.source==='MEMORY_BACKUP'?'BACKUP_NOT_APPLICATION_FILE':'LEGACY_HISTORY_UNKNOWN',writes:0};
 }
 case'LEDGER':{shape(v,'patches');const l=patch(fixture.ledger,v.patches),r=ledger(l);return{issues:r.issues,consumed:r.consumed.length,writes:0};}
 case'LOOKUP':{
  shape(v,'ledger_patches request plan_json');const l=patch(fixture.ledger,v.ledger_patches),audit=ledger(l);shape(v.request,'transaction_id row target_present');target(v.request.row);text(v.request.transaction_id);if(typeof v.request.target_present!=='boolean')fail();raw(v.plan_json);
  if(audit.issues.length)return{status:'HISTORY_INVALID_OR_UNKNOWN',writes:0};
  if(v.request.row.business_id!==l.business_id)return{status:'BUSINESS_MISMATCH',writes:0};
  const saved=l.entries.find(e=>e.transaction_id===v.request.transaction_id);
  if(saved){if(saved.plan_sha256!==sha(v.plan_json)||!saved.rows.some(r=>isDeepStrictEqual(r,v.request.row)))return{status:'TRANSACTION_ID_COLLISION',writes:0};return{status:saved.after_sha256===sha(l.current_payload_json)?'ALREADY_RECORDED_NO_WRITE':'RECORDED_HISTORY_REQUIRES_REVIEW',writes:0};}
  if(v.request.row.operation==='REFERENCE_EXISTING')return{status:v.request.target_present?'READ_ONLY_REFERENCE_NO_CONSUMPTION':'REFERENCE_TARGET_MISSING',writes:0};
  return{status:audit.consumed.includes(key(v.request.row))?'SOURCE_ALREADY_CONSUMED':v.request.target_present?'TARGET_ALREADY_EXISTS':audit.targets.includes(v.request.row.cost_id)||l.retired_cost_ids.includes(v.request.row.cost_id)?'TARGET_ID_RETIRED':'UNCONSUMED_IN_THIS_HISTORY_ONLY',writes:0};
 }
 case'RECOVERY':{
  shape(v,'current_patches incoming_patches anchor_known');if(typeof v.anchor_known!=='boolean')fail();const a=patch(fixture.ledger,v.current_patches),b=patch(fixture.ledger,v.incoming_patches),aa=ledger(a),bb=ledger(b);
  if(bb.issues.length)return{status:'INCOMING_INVALID_OR_UNKNOWN',install:false};
  if(!v.anchor_known)return{status:'PREVIEW_LATEST_UNVERIFIABLE',install:false};
  if(aa.issues.length)return{status:'CURRENT_HISTORY_REQUIRES_REVIEW',install:false};
  if(a.business_id!==b.business_id)return{status:'SEPARATE_BUSINESS_PREVIEW',install:false};
  if(isDeepStrictEqual(a,b))return{status:'NO_CHANGE',install:false};
  if(b.revision<a.revision)return{status:'OLDER_REVISION_CONFLICT',install:false};
  const prefix=a.entries.every((e,i)=>b.entries[i]?.entry_sha256===e.entry_sha256);
  if(a.genesis_sha256!==b.genesis_sha256||!prefix||a.retired_cost_ids.some(id=>!b.retired_cost_ids.includes(id)))return{status:'HISTORY_FORK_CONFLICT',install:false};
  return{status:b.revision===a.revision?'SAME_REVISION_CONFLICT':'DESCENDANT_PREVIEW_EXPLICIT_ADOPTION',install:false};
 }
 case'COPY':{
  shape(v,'mode business_changed bill_changed lines_changed targets_changed confirmations_cleared history_preserved');member(v.mode,['WORKING_COPY','NEW_BUSINESS','RENAME']);for(const[k,x]of Object.entries(v))if(k!=='mode'&&typeof x!=='boolean')fail();
  const status=v.mode==='NEW_BUSINESS'?(v.business_changed&&v.bill_changed&&v.lines_changed&&v.targets_changed&&v.confirmations_cleared&&!v.history_preserved?'NEW_DECLARED_BUSINESS_CANDIDATE':'IDENTITY_RESET_INCOMPLETE'):(v.business_changed||v.bill_changed||v.lines_changed||v.targets_changed||!v.history_preserved?'WORKING_HISTORY_MUST_BE_PRESERVED':'SAME_BUSINESS_HISTORY_PRESERVED');return{status,writes:0};
 }
 case'LIMITS':{
  shape(v,'envelope_bytes archive_entries receipt_count batch_rows revision depth nodes');const limits={envelope_bytes:128*1024*1024,archive_entries:512,receipt_count:64,batch_rows:50,revision:1000000000,depth:32,nodes:300000};
  for(const[k,n]of Object.entries(v))count(n,k==='revision'?1:0,Number.MAX_SAFE_INTEGER);return{status:Object.entries(v).some(([k,n])=>n>limits[k])?'REJECT_WHOLE_NO_TRUNCATION':'WITHIN_DESIGN_LIMITS',writes:0};
 }
 case'ARCHIVE':{
  shape(v,'blobs references roots');array(v.blobs,512);array(v.references,512);array(v.roots,64);const ids=new Set(),edges=new Map();let bytes=0;
  for(const b of v.blobs){shape(b,'id raw_json sha256');text(b.id);raw(b.raw_json);hash(b.sha256);if(ids.has(b.id))fail();ids.add(b.id);bytes+=Buffer.byteLength(b.raw_json);edges.set(b.id,[]);}
  const issues=[];for(const b of v.blobs)if(sha(b.raw_json)!==b.sha256)issues.push('ARCHIVE_DIGEST_MISMATCH');
  for(const e of v.references){shape(e,'from to');text(e.from);text(e.to);if(!ids.has(e.from)||!ids.has(e.to))issues.push('ARCHIVE_REFERENCE_MISSING');else edges.get(e.from).push(e.to);}
  for(const r of v.roots){text(r);if(!ids.has(r))issues.push('ARCHIVE_ROOT_MISSING');}
  const visiting=new Set(),visited=new Set(),heights=new Map();function walk(id){if(visiting.has(id)){issues.push('ARCHIVE_CYCLE');return 0;}if(heights.has(id))return heights.get(id);visiting.add(id);let height=0;for(const to of edges.get(id)??[])height=Math.max(height,1+walk(to));visiting.delete(id);visited.add(id);heights.set(id,height);return height;}
  for(const root of v.roots)if(walk(root)>32)issues.push('ARCHIVE_DEPTH_LIMIT');if(visited.size!==ids.size)issues.push('UNREACHABLE_ARCHIVE_REVIEW');return{issues:[...new Set(issues)],bytes,writes:0};
 }
 default:fail();}}
if(fixture.kind!=='SYNTHETIC_FEE_ENVELOPE_DESIGN_ONLY'||fixture.version!=='0.1'||fixture.runtime_enabled!==false)fail();
for(const d of fixture.digest_vectors){shape(d,'text sha256');if(sha(d.text)!==d.sha256)throw Error('Fixed SHA vector mismatch');}
if(ledger(fixture.ledger).issues.length)throw Error('Invalid fixed ledger');let valid=0,rejected=0;const ids=new Set();
for(const c of fixture.cases){shape(c,c.reject?'id family input reject':'id family input expected');text(c.id);if(ids.has(c.id))fail();ids.add(c.id);const before=JSON.stringify(c.input);if(c.reject){let caught=false;try{evaluate(c);}catch(e){if(e.message!=='UNSUPPORTED_FEE_ENVELOPE_DESIGN_INPUT')throw e;caught=true;}if(!caught)throw Error(c.id+' unexpectedly accepted');rejected++;}else{const actual=evaluate(c);if(!isDeepStrictEqual(actual,c.expected))throw Error(c.id+' mismatch '+JSON.stringify(actual)+' expected '+JSON.stringify(c.expected));valid++;}if(before!==JSON.stringify(c.input))throw Error('Input mutated');}
for(const f of['ADOPTION','LEDGER','LOOKUP','RECOVERY','COPY','LIMITS','ARCHIVE'])if(!fixture.cases.some(c=>c.family===f&&!c.reject)||!fixture.cases.some(c=>c.family===f&&c.reject))throw Error('Missing family '+f);
// Changes in evidence text and historical receipt identities must affect its fingerprint.
let receiptMutations=0;const entry=fixture.ledger.entries[0],leaves=(v,p=[])=>v&&typeof v==='object'?Object.entries(v).flatMap(([k,x])=>leaves(x,[...p,k])):[p];
for(const path of leaves(entry).filter(p=>p.join('.')!=='entry_sha256')){const changed=structuredClone(entry);let at=changed;for(const p of path.slice(0,-1))at=at[p];at[path.at(-1)]=String(at[path.at(-1)])+' ';if(seal(changed)===seal(entry))throw Error('Receipt leaf unbound');receiptMutations++;}
// The proposed manifest points at immutable archives, never embeds itself recursively.
let renamedIdentityChecks=0;for(const cost of['cost-a','different-target'])for(const mapping of['map-a','new-mapping'])for(const tx of['fresh-tx-a','fresh-tx-b']){const input=structuredClone(fixture.lookup);input.request.row.cost_id=cost;input.request.row.mapping_id=mapping;input.request.transaction_id=tx;if(evaluate({family:'LOOKUP',input}).status!=='SOURCE_ALREADY_CONSUMED')throw Error('Source identity escaped');renamedIdentityChecks++;}
const standalone=new Set(['domain/fee-envelope.ts','data/fee-envelope.ts','data/fee-envelope-json.ts','data/fee-envelope-schema.ts','data/fee-envelope-snapshot.ts','domain/fee-application-transaction.ts','data/fee-application-transaction.ts','data/fee-application-coordinator.ts','domain/fee-workbench.ts','data/fee-workbench.ts']),found=new Set();
const controller='ui/fee-envelope-controller.ts';
const runtime=new Set(['ui/fee-envelope-workspace.ts','ui/fee-envelope-storage.ts','ui/app.ts','ui/fee-workbench-preview.ts','ui/fee-workbench-candidate.ts']);
function inactive(directory,prefix=''){for(const e of readdirSync(directory,{withFileTypes:true})){const path=prefix+e.name,u=new URL(e.name+(e.isDirectory()?'/':''),directory);if(e.isDirectory())inactive(u,path+'/');else if(e.name.endsWith('.ts')){const text=readFileSync(u,'utf8');if(standalone.has(path)||path===controller){found.add(path);if(/localStorage|sessionStorage|indexedDB|document\.|window\.|createObjectURL|setItem\(|applyFeeApplication/.test(text))throw Error('Envelope modules must remain independent; storage requires the injected CAS adapter');}else if(runtime.has(path)){found.add(path);if(path==='ui/fee-envelope-workspace.ts'&&/installPair|installPrepared|applyFeeApplication|INTERNAL_FEE_APPLICATION_BUNDLE/.test(text))throw Error('Envelope panel must not install sources or fees');}else if(/fee-envelope|fee-application-envelope|fee-workbench/.test(e.name)||/INTERNAL_FEE_APPLICATION_ENVELOPE|fee-envelope|fee-application-envelope|fee-workbench/.test(text))throw Error('Envelope must not enter other calculations or customer serializers');}}}
inactive(new URL('../src/',import.meta.url));if(found.size!==standalone.size+1+runtime.size)throw Error('Missing envelope module');
console.log(JSON.stringify({kind:fixture.kind,validCases:valid,rejectedCases:rejected,receiptLeafMutations:receiptMutations,renamedIdentityChecks,digestVectors:fixture.digest_vectors.length,productionImports:false,productionParserImplemented:true,independentControllerImplemented:true,runtimeIntegrated:true,applicationEntryEnabled:true,independentAdoptionWrites:0,scope:'INTERNAL_ENVELOPE_WITH_EXPLICIT_RUNTIME_APPLICATION'}));
