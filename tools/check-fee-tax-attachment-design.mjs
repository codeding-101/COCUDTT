// Reduced synthetic lifecycle oracle. Not an attachment parser, production module or UI test.
import{readFileSync,readdirSync}from'node:fs';
import{createHash}from'node:crypto';
import{isDeepStrictEqual}from'node:util';
const fail=()=>{throw Error('UNSUPPORTED_DESIGN_INPUT')};
const sha=text=>createHash('sha256').update(text,'utf8').digest('hex');
const canonical=value=>JSON.stringify(sort(value));
function sort(value){if(Array.isArray(value))return value.map(sort);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,sort(value[k])]));return value;}
const facets=['tax','credit','customs'];
const fixture=JSON.parse(readFileSync(new URL('../docs/cases/fee-tax-attachment-design.json',import.meta.url),'utf8'));
const shape=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==keys.split(' ').sort().join('|'))fail()};
function date(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)fail();return v;}
function basis(a){return sha(canonical({contract:'fee-tax-attachment-1.0-review-0.1',attachment_id:a.attachment_id,record_id:a.row.record_id,pair_snapshot_sha256:a.pair_snapshot_sha256,target:a.row.target,input:a.row.input,sources:a.row.sources}));}
function sourceOK(a,facet){const s=a.row.sources[facet],day=date(JSON.parse(a.pair_snapshot_json).bill.review_date);shape(s,'provenance reference valid_from valid_to checked_on');if(!['UNSPECIFIED','EXAMPLE','USER_SUPPLIED'].includes(s.provenance)||typeof s.reference!=='string'||s.reference.length>200)fail();for(const field of['valid_from','valid_to','checked_on'])if(s[field]!=='')date(s[field]);if(s.valid_from&&s.valid_to&&s.valid_from>s.valid_to)fail();return s.provenance==='USER_SUPPLIED'&&!!s.reference.trim()&&!!s.valid_from&&!!s.valid_to&&!!s.checked_on&&s.valid_from<=day&&day<=s.valid_to&&s.checked_on<=day;}
function bound(a,current){
 if(a.pair_snapshot_sha256!==sha(a.pair_snapshot_json))fail();if(current!==a.pair_snapshot_json)return 'STALE_SOURCE';
 const p=JSON.parse(current),t=a.row.target,m=p.mapping;
 if(!['mapping_id','bill_id','line_id','cost_id','operation'].every(k=>t[k]===m[k])||p.retired.includes(t.mapping_id))return 'ORPHAN_TARGET';
 if(p.item_kind!=='SERVICE_FEE')return 'UNSUPPORTED_TARGET';
 if(p.bill.currency!==a.row.input.currency||p.target_currency!==a.row.input.currency)return 'CURRENCY_MISMATCH';
 if(a.row.input.gross===null||a.row.input.gross!==p.bill.original_amount)return 'AMOUNT_NEEDS_REVIEW';
 return 'CURRENT_SOURCE';
}
function state(a,current){const binding=bound(a,current),digest=basis(a),accepted=facets.filter(f=>a.row.acknowledgements[f]?.basis_sha256===digest&&sourceOK(a,f)&&a.row.input[f].kind!=='UNKNOWN'&&binding==='CURRENT_SOURCE');return{binding,accepted,scope:'DESIGN_ONLY_NO_FEE_WRITES'};}
function setPath(value,path,replacement){const parts=path.split('.');if(parts.some(k=>['__proto__','constructor','prototype'].includes(k)))fail();let at=value;for(const k of parts.slice(0,-1)){if(!Object.hasOwn(at,k)||!at[k]||typeof at[k]!=='object')fail();at=at[k];}const last=parts.at(-1);if(!Object.hasOwn(at,last))fail();at[last]=replacement;}
function mutatePair(a,path,value){const p=JSON.parse(a.pair_snapshot_json);setPath(p,path,value);return JSON.stringify(p);}
function evaluate(c){
 const a=structuredClone(fixture.baseline);let current=a.pair_snapshot_json;
 const x=c.input;
 switch(c.family){
  case 'STATE':shape(x,'event');if(x.event!=='UNCHANGED')fail();return state(a,current);
  case 'SOURCE':{
   shape(x,'path value rebind');if(typeof x.rebind!=='boolean')fail();const changed=mutatePair(a,x.path,x.value);
   if(x.rebind){a.pair_snapshot_json=changed;a.pair_snapshot_sha256=sha(changed);facets.forEach(f=>a.row.acknowledgements[f]=null);a.revision++;current=changed;}else current=changed;
   return{...state(a,current),revision:a.revision,inputsPreserved:isDeepStrictEqual(a.row.input,fixture.baseline.row.input)};
  }
  case 'SOURCE_TEXT':{
   shape(x,'style');const p=JSON.parse(current);if(x.style==='WHITESPACE')current+='\n';else if(x.style==='KEY_ORDER')current=JSON.stringify(Object.fromEntries(Object.entries(p).reverse()));else fail();return state(a,current);
  }
  case 'EDIT':{
   shape(x,'path value expected_revision');if(x.expected_revision!==a.revision||a.revision>=1000000000||typeof x.path!=='string'||! /^(input|sources)\./.test(x.path))fail();setPath(a.row,x.path,x.value);a.revision++;facets.forEach(f=>a.row.acknowledgements[f]=null);return{...state(a,current),revision:a.revision};
  }
  case 'ACK':{
   shape(x,'facet provenance kind valid_from valid_to checked_on prior');if(!facets.includes(x.facet)||!['UNSPECIFIED','EXAMPLE','USER_SUPPLIED'].includes(x.provenance)||!Array.isArray(x.prior)||new Set(x.prior).size!==x.prior.length||!({tax:['UNKNOWN','NO_SEPARATION','EXPLICIT','GROSS_RATE'],credit:['UNKNOWN','NONE','ASSUMED'],customs:['UNKNOWN','NOT_ADDED','ADD_COMPONENT']}[x.facet].includes(x.kind)))fail();
   facets.forEach(f=>a.row.acknowledgements[f]=null);a.row.sources[x.facet]={...a.row.sources[x.facet],provenance:x.provenance,valid_from:x.valid_from,valid_to:x.valid_to,checked_on:x.checked_on};a.row.input[x.facet]={kind:x.kind};
   for(const f of x.prior){if(!facets.includes(f)||f===x.facet)fail();a.row.acknowledgements[f]={basis_sha256:basis(a)};}
   if(!sourceOK(a,x.facet)||a.row.input[x.facet].kind==='UNKNOWN')fail();a.row.acknowledgements[x.facet]={basis_sha256:basis(a)};return state(a,current);
  }
  case 'RECEIPT':shape(x,'facet digest');if(!facets.includes(x.facet)||!/^([0-9a-f]{64})$/.test(x.digest))fail();a.row.acknowledgements[x.facet]={basis_sha256:x.digest};return state(a,current);
  case 'TRANSFER':{
   shape(x,'action');if(x.action==='SAVE_AS')return{attachment_id:a.attachment_id,revision:a.revision,records:1,accepted:state(a,current).accepted};
   if(x.action==='NEW_BUSINESS')return{attachment_id:'attachment-new',revision:1,records:0,accepted:[],retired:0,originalUnchanged:true};fail();
  }
  case 'SAVE':{
   shape(x,'outcome changed_while_waiting');if(!['SAVED','CANCELLED','FAILED'].includes(x.outcome)||typeof x.changed_while_waiting!=='boolean')fail();
   return{saved_revision:x.outcome==='SAVED'?1:null,current_revision:x.changed_while_waiting?2:1,clean:x.outcome==='SAVED'&&!x.changed_while_waiting,inputRetained:true};
  }
  case 'OPEN':{
   shape(x,'version valid_file late edited');if(typeof x.valid_file!=='boolean'||typeof x.late!=='boolean'||typeof x.edited!=='boolean')fail();
   return{candidate:x.version==='1.0'&&x.valid_file&&!x.late&&!x.edited?'PREVIEW_ONLY':'NOT_INSTALLED',workspacePreserved:true,autoConfirm:false,rawBackup:true};
  }
  case 'EXTENSION':shape(x,'location');if(!['project','bill','pair'].includes(x.location))fail();return{preserved:true,activated:false,location:x.location};
  case 'CUSTOMER':{
   shape(x,'internal');if(!x.internal||typeof x.internal!=='object'||Array.isArray(x.internal))fail();const data={public_reference:'Q-SYNTHETIC',quote_amount:'113',internal:x.internal};return{public_reference:data.public_reference,quote_amount:data.quote_amount};
  }
  case 'LIMIT':{
   shape(x,'pair_bytes file_bytes rows retired revision');for(const n of Object.values(x))if(!Number.isSafeInteger(n)||n<0)fail();if(x.pair_bytes>10*1024*1024||x.file_bytes>24*1024*1024||x.rows>8||x.retired>200||x.revision<1||x.revision>1000000000)fail();return{withinDesignLimits:true};
  }
  default:fail();
 }
}
if(fixture.kind!=='SYNTHETIC_ATTACHMENT_DESIGN_ONLY'||fixture.version!=='0.1'||fixture.runtime_enabled!==false)fail();
// Digests supplied as fixed independent vectors, not regenerated from this oracle's output.
for(const v of fixture.digest_vectors)if(sha(v.text)!==v.sha256)throw Error('Digest vector mismatch');
if(sha(fixture.baseline.pair_snapshot_json)!==fixture.baseline.pair_snapshot_sha256||basis(fixture.baseline)!==fixture.baseline.expected_basis_sha256)throw Error('Fixed baseline mismatch');
const ids=new Set();let valid=0,rejected=0;
for(const c of fixture.cases){if(ids.has(c.id)||typeof c.id!=='string')fail();ids.add(c.id);const before=JSON.stringify(c.input);if(c.reject){let rejectedInput=false;try{evaluate(c)}catch(error){if(error.message!=='UNSUPPORTED_DESIGN_INPUT')throw error;rejectedInput=true;}if(!rejectedInput)throw Error(c.id+' unexpectedly accepted');rejected++;}else{const result=evaluate(c);if(!isDeepStrictEqual(result,c.expected))throw Error(c.id+' mismatch: '+JSON.stringify(result));valid++;}if(before!==JSON.stringify(c.input))throw Error('Input changed');}
for(const family of['STATE','SOURCE','SOURCE_TEXT','EDIT','ACK','RECEIPT','TRANSFER','SAVE','OPEN','EXTENSION','CUSTOMER','LIMIT'])if(!fixture.cases.some(c=>c.family===family&&!c.reject))throw Error('Missing '+family);
// Every individual leaf in the synthetic full source must invalidate old receipts, including extensions.
let mutationChecks=0;function leaves(v,p=[]){if(v&&typeof v==='object'&&!Array.isArray(v))return Object.entries(v).flatMap(([k,x])=>leaves(x,[...p,k]));return[p];}
for(const path of leaves(JSON.parse(fixture.baseline.pair_snapshot_json))){const a=structuredClone(fixture.baseline),p=JSON.parse(a.pair_snapshot_json);setPath(p,path.join('.'),'changed');const result=state(a,JSON.stringify(p));if(result.binding!=='STALE_SOURCE'||result.accepted.length)throw Error('Source leaf not bound');mutationChecks++;}
const standaloneModules=new Set(['data/fee-envelope.ts','data/fee-application-proposal.ts','domain/fee-tax-attachment.ts','domain/fee-precision-selection.ts','data/fee-precision-selection.ts','data/fee-tax-attachment.ts','data/fee-tax-attachment-json.ts','data/fee-tax-attachment-editor.ts','data/fee-tax-attachment-snapshot.ts','ui/fee-tax-attachment-controller.ts','ui/fee-tax-attachment-form.ts','ui/fee-tax-attachment-workspace.ts','ui/app.ts','ui/fee-workbench-candidate.ts']);
function inactive(directory,prefix=''){for(const entry of readdirSync(directory,{withFileTypes:true})){const path=prefix+entry.name,url=new URL(entry.name+(entry.isDirectory()?'/':''),directory);if(entry.isDirectory())inactive(url,path+'/');else if(entry.name.endsWith('.ts')&&!standaloneModules.has(path)&&/fee-tax-attachment|INTERNAL_FEE_TAX_ATTACHMENT/.test(readFileSync(url,'utf8')))throw Error('Attachment module must not enter running application or old calculations');}}
standaloneModules.add('ui/fee-workflow-guide.ts'); // Read-only navigation; checked separately by the runtime preview gate.
inactive(new URL('../src/',import.meta.url));
console.log(JSON.stringify({kind:'FEE_TAX_ATTACHMENT_DESIGN',validCases:valid,rejectedCases:rejected,sourceLeafMutations:mutationChecks,digestVectors:fixture.digest_vectors.length,runtimeIntegrated:true,scope:'INTERNAL_READ_ONLY_ATTACHMENT'}));
