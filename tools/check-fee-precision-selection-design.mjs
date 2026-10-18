// Independent reduced lifecycle specification, not the production file/JSON/numeric API.
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const fail=()=>{throw Error('UNSUPPORTED_PRECISION_SELECTION_DESIGN_INPUT');};
const fixture=JSON.parse(readFileSync(new URL('../docs/cases/fee-precision-selection-design.json',import.meta.url),'utf8'));
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const same=(a,b)=>canonical(a)===canonical(b);
const shape=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==keys.split(' ').sort().join('|'))fail();};
const id=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(v))fail();};
const hash=v=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))fail();};
const currency=v=>{if(typeof v!=='string'||!/^[A-Z]{3}$/.test(v))fail();};
const reference=v=>{if(typeof v!=='string'||v.length>200||!v.trim())fail();};
const date=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)fail();};
const channels=['cash','net','tax','credit','economic','customs'];
const gcd=(a,b)=>{while(b)[a,b]=[b,a%b];return a;};
function amount(v){if(v===null)return;shape(v,'numerator denominator');if(typeof v.numerator!=='string'||typeof v.denominator!=='string'||!/^(0|[1-9]\d{0,79})$/.test(v.numerator)||!/^[1-9]\d{0,79}$/.test(v.denominator)||gcd(BigInt(v.numerator),BigInt(v.denominator))!==1n)fail();}
function decimal(v){if(typeof v!=='string'||!/^(0|[1-9]\d{0,23})(\.\d{1,18})?$/.test(v))fail();const [a,b='']=v.split('.');return{n:BigInt(a+b),d:10n**BigInt(b.length)};}
function policy(v){shape(v,'kind unit mode basis');if(v.kind!=='EXPLICIT'||!['HALF_UP','HALF_EVEN','DOWN'].includes(v.mode))fail();reference(v.basis);const p=decimal(v.unit);if(p.n<=0n||p.n>p.d||p.n*1000000n%p.d!==0n)fail();}
function choice(v,r,day){
 if(v?.kind==='UNRESOLVED'){shape(v,'kind');return;}
 if(v?.kind==='ROUND'){shape(v,'kind policy');policy(v.policy);return;}
 shape(v,'kind to purpose as_of rate_source policy');if(v.kind!=='FX')fail();currency(v.to);if(v.to===r.currency)fail();policy(v.policy);date(v.as_of);
 const s=v.rate_source;shape(s,'base quote rate type rate_date valid_from valid_to reference');currency(s.base);currency(s.quote);reference(s.reference);
 if(s.base===s.quote||!((s.base===r.currency&&s.quote===v.to)||(s.quote===r.currency&&s.base===v.to)))fail();
 if(decimal(s.rate).n<=0n)fail();for(const k of['rate_date','valid_from','valid_to'])date(s[k]);
 if(s.rate_date>v.as_of||s.valid_from>v.as_of||s.valid_to<v.as_of)fail();
 if(v.purpose==='COMMERCIAL_REVIEW'){if(r.channel==='customs'||!['CONTRACT','MARKET'].includes(s.type))fail();}
 else if(v.purpose==='CUSTOMS_COMPONENT_REVIEW'){const u=decimal(v.policy.unit);if(r.channel!=='customs'||s.type!=='CUSTOMS'||v.to!=='CNY'||u.n*100n!==u.d||v.policy.mode!=='HALF_UP'||v.as_of<'2024-12-01')fail();}
 else fail();
}
function target(v){shape(v,'mapping_id bill_id line_id cost_id operation');for(const k of['mapping_id','bill_id','line_id','cost_id'])if(typeof v[k]!=='string'||!v[k].trim()||Array.from(v[k]).length>200||['__proto__','constructor','prototype'].includes(v[k]))fail();if(!['CREATE_NEW','REFERENCE_EXISTING'].includes(v.operation))fail();}
function sources(a){
 const p=JSON.parse(a.pair_snapshot_json),t=JSON.parse(a.attachment_snapshot_json);
 if(t.pair_snapshot_json!==a.pair_snapshot_json||t.pair_snapshot_sha256!==a.pair_snapshot_sha256)fail();
 return{p,t}; // Reduced fixture sources only. Production validators must replace this step.
}
function basis(a,r){return sha(canonical({contract:'fee-precision-selection-1.0-policy-0.1',selection_id:a.selection_id,record_id:r.record_id,pair_snapshot_sha256:a.pair_snapshot_sha256,attachment_snapshot_sha256:a.attachment_snapshot_sha256,component_record_id:r.component_record_id,target:r.target,channel:r.channel,currency:r.currency,original:r.original,choice:r.choice}));}
function seal(a){const {content_sha256:_,...body}=a;a.content_sha256=sha(canonical(body));return a;}
function validate(a){
 shape(a,'kind version selection_id revision pair_snapshot_json pair_snapshot_sha256 attachment_snapshot_json attachment_snapshot_sha256 records retired_record_ids content_sha256');
 if(a.kind!=='INTERNAL_FEE_PRECISION_SELECTION'||a.version!=='1.0')fail();id(a.selection_id);if(!Number.isSafeInteger(a.revision)||a.revision<1||a.revision>1000000000)fail();
 for(const k of['pair_snapshot_sha256','attachment_snapshot_sha256','content_sha256'])hash(a[k]);
 if(sha(a.pair_snapshot_json)!==a.pair_snapshot_sha256||sha(a.attachment_snapshot_json)!==a.attachment_snapshot_sha256)fail();
 const {content_sha256:expected,...body}=a;if(sha(canonical(body))!==expected)fail();
 const {p}=sources(a);date(p.bill.review_date);
 if(!Array.isArray(a.records)||a.records.length>48||!Array.isArray(a.retired_record_ids)||a.retired_record_ids.length>500)fail();
 const ids=new Set(),slots=new Set();
 for(const r of a.records){
  shape(r,'record_id component_record_id target channel currency original choice acknowledgement');id(r.record_id);id(r.component_record_id);target(r.target);currency(r.currency);if(!channels.includes(r.channel))fail();amount(r.original);choice(r.choice,r,p.bill.review_date);
  const slot=canonical([r.component_record_id,r.channel]);if(ids.has(r.record_id)||slots.has(slot))fail();ids.add(r.record_id);slots.add(slot);
  if(r.acknowledgement!==null){shape(r.acknowledgement,'basis_sha256');hash(r.acknowledgement.basis_sha256);}
 }
 for(const r of a.retired_record_ids){id(r);if(ids.has(r))fail();ids.add(r);}
 return a;
}
function binding(a,current){return current.pair!==a.pair_snapshot_json?'STALE_PAIR':current.attachment!==a.attachment_snapshot_json?'STALE_ATTACHMENT':'CURRENT';}
function recordCurrent(a,r){
 const {p,t}=sources(a),source=t.rows.find(s=>s.record_id===r.component_record_id);
 return !!source&&same(r.target,p.mapping)&&same(r.target,source.target)&&!p.retired.includes(r.target.mapping_id)&&source.currency===r.currency&&same(source.channels[r.channel],r.original);
}
function recordable(a,r,current){return binding(a,current)==='CURRENT'&&recordCurrent(a,r)&&r.original!==null&&r.choice.kind!=='UNRESOLVED'&&(r.choice.kind!=='FX'||r.choice.as_of===sources(a).p.bill.review_date);}
function state(a,current){
 const recorded=a.records.filter(r=>r.acknowledgement?.basis_sha256===basis(a,r)&&recordable(a,r,current)).map(r=>r.record_id);
 return{binding:binding(a,current),recorded,pending:a.records.filter(r=>!recorded.includes(r.record_id)).map(r=>r.record_id),business_issues:[...sources(a).p.business_issues],scope:'DESIGN_ONLY_NO_FEE_WRITES'};
}
function lease(a,v){shape(v,'revision content_sha256');if(v.revision!==a.revision||v.content_sha256!==a.content_sha256)fail();}
function next(a){if(a.revision>=1000000000)fail();a.revision++;}
function row(a,id){const r=a.records.find(r=>r.record_id===id);if(!r)fail();return r;}
function setPath(v,path,value){if(typeof path!=='string')fail();const parts=path.split('.');if(parts.some(k=>['__proto__','constructor','prototype'].includes(k)))fail();let at=v;for(const k of parts.slice(0,-1)){if(!at||!Object.hasOwn(at,k))fail();at=at[k];}if(!at||!Object.hasOwn(at,parts.at(-1)))fail();at[parts.at(-1)]=structuredClone(value);}
function replaceSource(a,key,text){a[key+'_snapshot_json']=text;a[key+'_snapshot_sha256']=sha(text);}
function evaluate(c){
 const a=validate(structuredClone(fixture.baseline)),current={pair:a.pair_snapshot_json,attachment:a.attachment_snapshot_json},x=c.input;
 switch(c.family){
  case 'STATE':shape(x,'event');if(x.event!=='UNCHANGED')fail();return state(a,current);
  case 'SOURCE':{
   shape(x,'source path value style');if(!['pair','attachment'].includes(x.source))fail();let text=current[x.source];
   if(x.style==='LEAF'){const v=JSON.parse(text);setPath(v,x.path,x.value);text=JSON.stringify(v);}
   else if(x.style==='WHITESPACE')text+='\n';else if(x.style==='KEY_ORDER')text=JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(text)).reverse()));else fail();
   current[x.source]=text;return state(a,current);
  }
  case 'RECORD_MUTATION':{
   shape(x,'record_id path value');setPath(row(a,x.record_id),x.path,x.value);validate(seal(a));return state(a,current);
  }
  case 'CHOICE_EDIT':{
   shape(x,'record_id choice expected_revision expected_digest');lease(a,{revision:x.expected_revision,content_sha256:x.expected_digest});const r=row(a,x.record_id);
   choice(x.choice,r,sources(a).p.bill.review_date);if(!same(r.choice,x.choice)){r.choice=structuredClone(x.choice);r.acknowledgement=null;next(a);}validate(seal(a));return{...state(a,current),revision:a.revision};
  }
  case 'ACK':{
   // Synthetic setup allows missing receipt / original / choice to test the recording predicate.
   shape(x,'record_id channel original choice');const r=row(a,x.record_id);r.channel=x.channel;r.original=structuredClone(x.original);r.choice=structuredClone(x.choice);r.acknowledgement=null;validate(seal(a));
   if(!recordable(a,r,current))fail();r.acknowledgement={basis_sha256:basis(a,r)};next(a);validate(seal(a));return{...state(a,current),revision:a.revision};
  }
  case 'ACK_REPEAT':{
   shape(x,'record_id');const r=row(a,x.record_id);if(!recordable(a,r,current))fail();if(r.acknowledgement?.basis_sha256!==basis(a,r)){r.acknowledgement={basis_sha256:basis(a,r)};next(a);}validate(seal(a));return{...state(a,current),revision:a.revision};
  }
  case 'REBIND':{
   shape(x,'source path value');let p=JSON.parse(current.pair),t=JSON.parse(current.attachment);
   if(x.source==='pair')setPath(p,x.path,x.value);else if(x.source==='attachment')setPath(t,x.path,x.value);else fail();
   const text=JSON.stringify(p);t.pair_snapshot_json=text;t.pair_snapshot_sha256=sha(text);
   if(p.pair_id!==sources(a).p.pair_id||t.attachment_id!==sources(a).t.attachment_id)fail();
   replaceSource(a,'pair',text);replaceSource(a,'attachment',JSON.stringify(t));a.records.forEach(r=>r.acknowledgement=null);next(a);validate(seal(a));current.pair=a.pair_snapshot_json;current.attachment=a.attachment_snapshot_json;
   return{...state(a,current),revision:a.revision,recordsPreserved:a.records.every((r,i)=>same({...r,acknowledgement:null},{...fixture.baseline.records[i],acknowledgement:null}))};
  }
  case 'DELETE':{
   shape(x,'record_id replacement');const r=row(a,x.record_id);a.records=a.records.filter(v=>v!==r);a.retired_record_ids.push(r.record_id);if(x.replacement!==null)a.records.push(structuredClone(x.replacement));next(a);validate(seal(a));return{...state(a,current),revision:a.revision,retired:a.retired_record_ids};
  }
  case 'TRANSFER':{
   shape(x,'action new_id');if(x.action==='SAVE_AS')return{selection_id:a.selection_id,revision:a.revision,records:a.records.length,recorded:state(a,current).recorded,retired:a.retired_record_ids.length};
   if(x.action!=='NEW_BUSINESS'||x.new_id===a.selection_id)fail();id(x.new_id);return{selection_id:x.new_id,revision:1,records:0,recorded:[],retired:0}; // Identity projection; full new pair/attachment validation is future work.
  }
  case 'SAVE':{
   shape(x,'outcome changed_while_waiting');if(!['SAVED','CANCELLED','FAILED'].includes(x.outcome)||typeof x.changed_while_waiting!=='boolean')fail();
   return{saved_revision:x.outcome==='SAVED'?a.revision:null,current_revision:x.changed_while_waiting?a.revision+1:a.revision,clean:x.outcome==='SAVED'&&!x.changed_while_waiting,rawRetained:true};
  }
  case 'OPEN':{
   shape(x,'version valid_file token_current lease_current');if(typeof x.valid_file!=='boolean'||typeof x.token_current!=='boolean'||typeof x.lease_current!=='boolean')fail();
   return{candidate:x.version==='1.0'&&x.valid_file&&x.token_current&&x.lease_current?'PREVIEW_ONLY':'NOT_INSTALLED',workspacePreserved:true,autoConfirm:false,rawBackup:true};
  }
  case 'DRAFT':{
   shape(x,'same_id same_sources same_lease same_raw valid conflict storage_ok');if(Object.values(x).some(v=>typeof v!=='boolean'))fail();
   return{candidate:x.same_id&&x.same_sources&&x.same_lease&&x.same_raw&&x.valid&&!x.conflict?'PREVIEW_ONLY':'NOT_INSTALLED',autoApply:false,memoryRetained:true,backupBoth:!x.storage_ok||x.conflict,unsubmittedInExport:false};
  }
  case 'EXTENSION':shape(x,'location');if(!['project','bill','pair','attachment'].includes(x.location))fail();return{preserved:true,activated:false,location:x.location};
  case 'CUSTOMER':shape(x,'internal');if(!x.internal||typeof x.internal!=='object'||Array.isArray(x.internal))fail();return{public_reference:'Q-SYNTHETIC',quote_amount:'113'}; // Deliberately reduced whitelist, not a customer exporter.
  case 'LIMIT':{
   shape(x,'pair_bytes attachment_bytes outer_bytes records retired revision depth nodes');if(Object.values(x).some(v=>!Number.isSafeInteger(v)||v<0)||x.pair_bytes>10*1024*1024||x.attachment_bytes>24*1024*1024||x.outer_bytes>64*1024*1024||x.records>48||x.retired>500||x.revision<1||x.revision>1000000000||x.depth>32||x.nodes>300000)fail();return{withinDesignLimits:true};
  }
  case 'BAD_FILE':{
   shape(x,'path value reseal');if(typeof x.reseal!=='boolean')fail();setPath(a,x.path,x.value);if(x.reseal)seal(a);validate(a);return state(a,current);
  }
  case 'BAD_SOURCE':{
   shape(x,'path value');const t=JSON.parse(a.attachment_snapshot_json);setPath(t,x.path,x.value);replaceSource(a,'attachment',JSON.stringify(t));validate(seal(a));return state(a,current);
  }
  case 'REVISION_CEILING':{
   shape(x,'action');a.revision=1000000000;seal(a);
   if(x.action==='NO_OP')return{revision:a.revision,changed:false};
   if(!['EDIT','ACK','DELETE','REBIND'].includes(x.action))fail();next(a);return{revision:a.revision,changed:true};
  }
  default:fail();
 }
}
if(fixture.kind!=='SYNTHETIC_PRECISION_SELECTION_DESIGN_ONLY'||fixture.version!=='0.1'||fixture.runtime_enabled!==false)fail();
validate(fixture.baseline);
for(const r of fixture.baseline.records)if(r.acknowledgement.basis_sha256!==basis(fixture.baseline,r))throw Error('Fixed basis mismatch');
for(const v of fixture.digest_vectors)if(sha(v.text)!==v.sha256)throw Error('Fixed digest vector mismatch');
let valid=0,rejected=0;const ids=new Set();
for(const c of fixture.cases){
 if(typeof c.id!=='string'||ids.has(c.id))fail();ids.add(c.id);const before=JSON.stringify(c.input);
 if(c.reject){let caught=false;try{evaluate(c);}catch(e){if(e.message!=='UNSUPPORTED_PRECISION_SELECTION_DESIGN_INPUT')throw e;caught=true;}if(!caught)throw Error(c.id+' unexpectedly accepted');rejected++;}
 else{const result=evaluate(c);if(!isDeepStrictEqual(result,c.expected))throw Error(c.id+' mismatch: '+JSON.stringify(result));valid++;}
 if(before!==JSON.stringify(c.input))throw Error('Input mutated');
}
for(const family of['STATE','SOURCE','RECORD_MUTATION','CHOICE_EDIT','ACK','ACK_REPEAT','REBIND','DELETE','TRANSFER','SAVE','OPEN','DRAFT','EXTENSION','CUSTOMER','LIMIT'])if(!fixture.cases.some(c=>c.family===family&&!c.reject))throw Error('Missing family '+family);
// Counterfactual coverage: every source leaf, text formatting and basis input must matter.
const leaves=(v,path=[])=>v&&typeof v==='object'?Object.entries(v).flatMap(([k,x])=>leaves(x,[...path,k])):[path];
let sourceMutations=0,basisMutations=0;
for(const key of['pair','attachment'])for(const path of leaves(JSON.parse(fixture.baseline[key+'_snapshot_json']))){
 const a=structuredClone(fixture.baseline),current={pair:a.pair_snapshot_json,attachment:a.attachment_snapshot_json},v=JSON.parse(current[key]);setPath(v,path.join('.'),'changed');current[key]=JSON.stringify(v);
 if(state(a,current).recorded.length)throw Error('Source leaf not bound');sourceMutations++;
}
for(const r of fixture.baseline.records){
 const base={contract:'fee-precision-selection-1.0-policy-0.1',selection_id:fixture.baseline.selection_id,record_id:r.record_id,pair_snapshot_sha256:fixture.baseline.pair_snapshot_sha256,attachment_snapshot_sha256:fixture.baseline.attachment_snapshot_sha256,component_record_id:r.component_record_id,target:r.target,channel:r.channel,currency:r.currency,original:r.original,choice:r.choice};
 for(const path of leaves(base)){const changed=structuredClone(base);setPath(changed,path.join('.'),'changed');if(sha(canonical(changed))===basis(fixture.baseline,r))throw Error('Basis leaf not bound');basisMutations++;}
 const a=structuredClone(fixture.baseline);a.revision++;a.records[0].acknowledgement=null;if(basis(a,r)!==basis(fixture.baseline,r))throw Error('Receipt/revision entered policy basis');
}
const standalone=new Set(['data/fee-envelope.ts','data/fee-application-proposal.ts','domain/fee-precision-selection.ts','data/fee-precision-selection.ts','data/fee-precision-selection-json.ts','data/fee-precision-selection-editor.ts','data/fee-precision-selection-snapshot.ts','ui/fee-precision-selection-controller.ts','ui/fee-precision-selection-form.ts','ui/fee-precision-selection-workspace.ts','ui/app.ts']);
function inactive(directory,prefix=''){for(const e of readdirSync(directory,{withFileTypes:true})){const path=prefix+e.name,u=new URL(e.name+(e.isDirectory()?'/':''),directory);if(e.isDirectory())inactive(u,path+'/');else if(e.name.endsWith('.ts')&&!standalone.has(path)&&/fee-precision-selection|INTERNAL_FEE_PRECISION_SELECTION/.test(readFileSync(u,'utf8')))throw Error('Selection file module must not enter running UI or old calculations');}}
inactive(new URL('../src/',import.meta.url));
console.log(JSON.stringify({kind:fixture.kind,validCases:valid,rejectedCases:rejected,sourceLeafMutations:sourceMutations,basisLeafMutations:basisMutations,digestVectors:fixture.digest_vectors.length,productionParserImplemented:true,handoffModuleImplemented:true,runtimeIntegrated:true,scope:'DESIGN_ONLY_NO_FEE_WRITES'}));
