// Independent reduced design oracle. No production imports, file adoption or fee writes.
import{readFileSync,readdirSync}from'node:fs';import{createHash}from'node:crypto';import{isDeepStrictEqual}from'node:util';
const fixture=JSON.parse(readFileSync(new URL('../docs/cases/fee-application-design.json',import.meta.url),'utf8'));
const fail=()=>{throw Error('UNSUPPORTED_FEE_APPLICATION_DESIGN_INPUT');};
const shape=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==keys.split(' ').sort().join('|'))fail();};
const member=(v,values)=>{if(!values.includes(v))fail();};
const text=v=>{if(typeof v!=='string'||!v.trim()||v.length>200||['__proto__','prototype','constructor'].includes(v))fail();};
const strings=v=>{if(!Array.isArray(v)||v.length>100||v.some(x=>typeof x!=='string'||!x.trim()||x.length>200)||new Set(v).size!==v.length)fail();};
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const gcd=(a,b)=>{while(b)[a,b]=[b,a%b];return a;};
const fraction=(n,d=1n)=>{const g=gcd(n,d);return{n:n/g,d:d/g};};
const equal=(a,b)=>a===null||b===null?a===b:a.n*b.d===b.n*a.d;
function decimal(v){if(typeof v!=='string'||!/^(0|[1-9]\d{0,23})(\.\d{1,18})?$/.test(v))fail();const[a,b='']=v.split('.');return fraction(BigInt(a+b),10n**BigInt(b.length));}
function amount(v){if(v===null)return null;if(typeof v==='string')return decimal(v);shape(v,'numerator denominator');if(typeof v.numerator!=='string'||typeof v.denominator!=='string'||!/^(0|[1-9]\d{0,79})$/.test(v.numerator)||!/^[1-9]\d{0,79}$/.test(v.denominator))fail();const n=BigInt(v.numerator),d=BigInt(v.denominator);if(gcd(n,d)!==1n)fail();return{n,d};}
function quantize(a,p){if(a===null)return null;const u=decimal(p.unit),n=a.n*u.d,d=a.d*u.n,q=n/d,r=n%d;const up=p.mode!=='DOWN'&&(r>d-r||r===d-r&&(p.mode==='HALF_UP'||q%2n===1n));return fraction((q+(up?1n:0n))*u.n,u.d);}
function choice(p){if(p?.kind==='UNRESOLVED'||p?.kind==='FX'){shape(p,'kind');return;}shape(p,'kind unit mode basis');member(p.kind,['ROUND']);member(p.mode,['HALF_UP','HALF_EVEN','DOWN']);text(p.basis);const u=decimal(p.unit);if(u.n===0n||u.n>u.d||u.n*1000000n%u.d!==0n)fail();}
const channelKeys=['cash','net','tax','credit','economic','customs'];
function row(value){
 const r=structuredClone(value);shape(r,'business_id bill_id line_id mapping_id component_id precision_id cost_id term operation currency target_currency original candidate proposed_amount customs_value components choice parties facets policy_receipt target_flags issues diagnostics');
 for(const k of['business_id','bill_id','line_id','mapping_id','component_id','precision_id','cost_id','term'])text(r[k]);member(r.operation,['CREATE_NEW','REFERENCE_EXISTING']);for(const k of['currency','target_currency'])if(typeof r[k]!=='string'||!/^[A-Z]{3}$/.test(r[k]))fail();
 shape(r.components,channelKeys.join(' '));for(const v of Object.values(r.components))amount(v);amount(r.original);amount(r.candidate);decimal(r.proposed_amount);choice(r.choice);member(r.customs_value,['ADD','EXCLUDE','UNRESOLVED']);
 shape(r.parties,'responsibility payer bearer');for(const x of Object.values(r.parties))member(x,['SELLER','BUYER','UNRESOLVED']);shape(r.facets,'tax credit customs');for(const x of Object.values(r.facets))member(x,['RECORDED','UNRECORDED','STALE','EXAMPLE']);member(r.policy_receipt,['RECORDED','UNRECORDED','STALE']);for(const k of['target_flags','issues','diagnostics'])strings(r[k]);
 const issues=[],add=s=>{if(!issues.includes(s))issues.push(s);},g=amount(r.components.cash),e=amount(r.components.economic),x=amount(r.components.credit),c=amount(r.components.customs),original=amount(r.original),candidate=amount(r.candidate),target=decimal(r.proposed_amount);
 if(g===null||original===null)add('ORIGINAL_UNKNOWN');else if(!equal(g,original))add('ORIGINAL_SOURCE_MISMATCH');
 if(r.currency!==r.target_currency)add('CURRENCY_CHANGE_UNSUPPORTED');
 if(r.choice.kind==='FX')add('FX_APPLICATION_UNSUPPORTED');else if(r.choice.kind==='UNRESOLVED')add('POLICY_UNRESOLVED');else{
  if(!equal(candidate,quantize(original,r.choice)))add('CANDIDATE_RECOMPUTATION_MISMATCH');
  if(original!==null&&!equal(candidate,original))add('ROUNDING_CHANGE_REQUIRES_AMOUNT_MODEL');
 }
 if(original!==null&&original.n*1000000n%original.d!==0n)add('CORE_PRECISION_LOSS');
 if(g!==null&&!equal(target,g))add('TARGET_NOT_ORIGINAL_CASH');
 if(e===null||x===null)add('ECONOMIC_COMPONENT_UNKNOWN');else if(g!==null&&(!equal(e,g)||x.n!==0n))add('SEPARATE_ECONOMIC_MODEL_REQUIRED');
 if(c===null)add('CUSTOMS_COMPONENT_UNKNOWN');else if(c.n!==0n&&!equal(c,g))add('PARTIAL_CUSTOMS_MODEL_REQUIRED');
 if(r.customs_value==='UNRESOLVED')add('CUSTOMS_TREATMENT_UNRESOLVED');else if(c!==null&&g!==null&&(c.n===0n&&g.n!==0n&&r.customs_value!=='EXCLUDE'||c.n!==0n&&equal(c,g)&&r.customs_value!=='ADD'))add('CUSTOMS_FLAG_MISMATCH');
 const n=amount(r.components.net),t=amount(r.components.tax);
 if((n===null)!==(t===null))add('INCOMPLETE_TAX_SPLIT');
 if(n!==null&&t!==null&&g!==null&&n.n*t.d*g.d+t.n*n.d*g.d!==g.n*n.d*t.d)add('SOURCE_CHANNELS_INCONSISTENT');
 if(g!==null&&e!==null&&x!==null&&e.n*g.d*x.d+x.n*e.d*g.d!==g.n*e.d*x.d)add('SOURCE_CHANNELS_INCONSISTENT');
 if(Object.values(r.parties).includes('UNRESOLVED'))add('PARTIES_UNRESOLVED');else if(new Set(Object.values(r.parties)).size!==1)add('ADVANCE_OR_REIMBURSEMENT_UNSUPPORTED');
 if(Object.values(r.facets).some(v=>v!=='RECORDED'))add('COMPONENT_SOURCE_REVIEW_REQUIRED');if(r.policy_receipt!=='RECORDED')add('POLICY_RECEIPT_REQUIRED');
 for(const f of r.target_flags)add('TARGET_REVIEW:'+f);for(const f of r.issues)add('UPSTREAM_REVIEW:'+f);
 return{projection:issues.length?'NONE':r.operation==='CREATE_NEW'?'UNCHANGED_ORIGINAL_CASH':'REFERENCE_ONLY',issues,retained_diagnostics:[...r.diagnostics],writes:0};
}
function patch(base,patches){if(!Array.isArray(patches)||patches.length>50)fail();const r=structuredClone(base);for(const p of patches){shape(p,'path value');if(typeof p.path!=='string')fail();const parts=p.path.split('.');if(parts.some(k=>['__proto__','prototype','constructor'].includes(k)))fail();let v=r;for(const k of parts.slice(0,-1)){if(!v||typeof v!=='object'||!Object.hasOwn(v,k))fail();v=v[k];}const key=parts.at(-1);if(!v||typeof v!=='object'||!Object.hasOwn(v,key))fail();v[key]=p.value;}return r;}
const slots=['project','bill','pair','attachment','precision','ledger'];
function snapshots(v){shape(v,slots.join(' '));for(const s of Object.values(v))if(typeof s!=='string'||!s.length||Buffer.byteLength(s)>1024*1024)fail();}
const sourceKey=r=>canonical([r.business_id,r.bill_id,r.line_id]);
function day(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)fail();return v;}
function coverage(v){shape(v,'boxes start end kind scope currency');if(v.boxes!==null)strings(v.boxes);if(v.start!==null)day(v.start);if(v.end!==null)day(v.end);member(v.kind,['DEMURRAGE','DETENTION','COMBINED_DD']);text(v.scope);if(!/^[A-Z]{3}$/.test(v.currency))fail();if(v.start!==null&&v.end!==null&&v.start>v.end)fail();}
const beforeFaults=['PROJECT','BILL','PAIR','ATTACHMENT','PRECISION','LEDGER','VALIDATION','RECALCULATION','SERIALIZATION','BEFORE_PUBLISH'];
function evaluate(c){
 const v=c.input;
 switch(c.family){
  case'MAPPING':shape(v,'patches');return row(patch(fixture.row,v.patches));
  case'LEASE':{shape(v,'expected current');snapshots(v.expected);snapshots(v.current);const stale=slots.filter(k=>v.expected[k]!==v.current[k]);return{current:stale.length===0,stale,writes:0};}
  case'DEDUP':{
   shape(v,'requested existing existing_cost_ids retired_cost_ids');if(!Array.isArray(v.requested)||!v.requested.length||v.requested.length>50||!Array.isArray(v.existing)||v.existing.length>500)fail();strings(v.existing_cost_ids);strings(v.retired_cost_ids);
   const keys=new Set(),targets=new Set(),issues=[];for(const r of[...v.requested,...v.existing]){shape(r,'business_id bill_id line_id cost_id mapping_id term operation');for(const x of Object.values(r))text(x);member(r.operation,['CREATE_NEW','REFERENCE_EXISTING']);}
   for(const r of v.requested){const key=sourceKey(r);if(keys.has(key))issues.push('DUPLICATE_SOURCE_IN_BATCH');keys.add(key);if(targets.has(r.cost_id))issues.push('DUPLICATE_TARGET_IN_BATCH');targets.add(r.cost_id);if(v.existing.some(e=>sourceKey(e)===key))issues.push('SOURCE_ALREADY_RECORDED');if(r.operation==='CREATE_NEW'&&v.existing_cost_ids.includes(r.cost_id))issues.push('TARGET_ALREADY_EXISTS');if(r.operation==='REFERENCE_EXISTING'&&!v.existing_cost_ids.includes(r.cost_id))issues.push('REFERENCE_TARGET_MISSING');if(r.operation==='CREATE_NEW'&&v.retired_cost_ids.includes(r.cost_id))issues.push('RETIRED_TARGET');}
   return{issues:[...new Set(issues)],writes:0};
  }
  case'REPLAY':{
   shape(v,'transaction_id requested_id saved_plan requested_plan post_payload live_payload receipt_plan_sha256 receipt_post_sha256');for(const k of['transaction_id','requested_id'])text(v[k]);for(const k of['saved_plan','requested_plan','post_payload','live_payload'])if(typeof v[k]!=='string'||!v[k]||v[k].length>10000)fail();for(const k of['receipt_plan_sha256','receipt_post_sha256'])if(typeof v[k]!=='string'||!/^[a-f0-9]{64}$/.test(v[k]))fail();
   if(sha(v.saved_plan)!==v.receipt_plan_sha256||sha(v.post_payload)!==v.receipt_post_sha256)return{status:'RECEIPT_INVALID',writes:0};
   return{status:v.transaction_id!==v.requested_id?'NEW_TRANSACTION_REQUIRES_PREFLIGHT':sha(v.requested_plan)!==v.receipt_plan_sha256?'TRANSACTION_ID_COLLISION':sha(v.live_payload)!==v.receipt_post_sha256?'RECORDED_HISTORY_REQUIRES_REVIEW':'ALREADY_RECORDED_NO_WRITE',writes:0};
  }
  case'COVERAGE':{
   shape(v,'left right');coverage(v.left);coverage(v.right);const a=v.left,b=v.right;
   const incomplete=[a,b].some(r=>r.boxes===null||r.boxes.length===0||r.start===null||r.end===null),intersection=!incomplete&&a.boxes.some(x=>b.boxes.includes(x))&&a.start<=b.end&&b.start<=a.end;
   return{status:incomplete?'INCOMPLETE_SCOPE':intersection?'INTERSECTION_CANDIDATE':'NO_INTERSECTION_IN_REDUCED_SCOPE',financialAuthority:false,writes:0};
  }
  case'ATOMIC':{
   shape(v,'rows expected current expected_revision current_revision confirmed format fault');snapshots(v.expected);snapshots(v.current);if(!Array.isArray(v.rows)||!v.rows.length||v.rows.length>50||typeof v.confirmed!=='boolean')fail();for(const k of['expected_revision','current_revision'])if(!Number.isSafeInteger(v[k])||v[k]<1||v[k]>1000000000)fail();member(v.format,['DESIGN_BUNDLE','PROJECT_0_8','PROJECT_0_9','PAIR_1_0','PAIR_1_1','MEMORY_BACKUP']);member(v.fault,['NONE',...beforeFaults,'CACHE_PRECHECK','CACHE_WRITE','CACHE_READBACK','RENDER','FILE_SAVE']);
   const before={memory:'BEFORE',cache:'BEFORE',costsAdded:0,receiptsAdded:0,sourceStatus:'UNCHANGED'};
   if(v.format!=='DESIGN_BUNDLE')return{status:'EXPLICIT_MIGRATION_REQUIRED',...before};
   if(v.expected_revision!==v.current_revision||!isDeepStrictEqual(v.expected,v.current))return{status:'STALE_CONTEXT',...before};
   if(v.current_revision===1000000000)return{status:'REVISION_LIMIT',...before};
   const models=v.rows.map(ps=>row(patch(fixture.row,ps)));if(models.some(m=>m.issues.length))return{status:'BLOCKED_BATCH',...before};
   const selected=v.rows.map(ps=>patch(fixture.row,ps));if(new Set(selected.map(sourceKey)).size!==selected.length||new Set(selected.map(r=>r.cost_id)).size!==selected.length)return{status:'DUPLICATE_BATCH',...before};
   if(!v.confirmed)return{status:'PREVIEW_ONLY',...before};
   if(beforeFaults.includes(v.fault))return{status:'STAGING_FAILED',...before};
   if(v.fault==='CACHE_PRECHECK')return{status:'CACHE_CONFLICT_BEFORE_COMMIT',...before,cache:'FOREIGN'};
   // One private aggregate pointer changes once. This is a model, not a UI/storage implementation.
   const candidate={memory:'CANDIDATE',cache:'CANDIDATE',costsAdded:selected.filter(r=>r.operation==='CREATE_NEW').length,receiptsAdded:1,sourceStatus:selected.some(r=>r.operation==='CREATE_NEW')?'HISTORICAL':'UNCHANGED'};
   if(v.fault==='CACHE_WRITE')return{status:'APPLIED_MEMORY_ONLY',...candidate,cache:'BEFORE'};
   if(v.fault==='CACHE_READBACK')return{status:'APPLIED_CACHE_CONFLICT',...candidate,cache:'FOREIGN'};
   if(v.fault==='RENDER')return{status:'APPLIED_RENDER_FAILED',...candidate};
   if(v.fault==='FILE_SAVE')return{status:'APPLIED_FILE_NOT_SAVED',...candidate};
   return{status:'APPLIED_IN_DESIGN_MODEL',...candidate};
  }
  default:fail();
 }
}
if(fixture.kind!=='SYNTHETIC_FEE_APPLICATION_DESIGN_ONLY'||fixture.version!=='0.1'||fixture.runtime_enabled!==false)fail();
row(fixture.row);snapshots(fixture.sources);for(const x of fixture.digest_vectors)if(sha(x.text)!==x.sha256)throw Error('Fixed digest vector mismatch');
let valid=0,rejected=0;const ids=new Set();for(const c of fixture.cases){shape(c,c.reject?'id family input reject':'id family input expected');text(c.id);if(ids.has(c.id))fail();ids.add(c.id);const before=JSON.stringify(c.input);
 if(c.reject){let caught=false;try{evaluate(c);}catch(e){if(e.message!=='UNSUPPORTED_FEE_APPLICATION_DESIGN_INPUT')throw e;caught=true;}if(!caught)throw Error(c.id+' unexpectedly accepted');rejected++;}
 else{const actual=evaluate(c);if(!isDeepStrictEqual(actual,c.expected))throw Error(c.id+' mismatch '+JSON.stringify(actual)+' expected '+JSON.stringify(c.expected));valid++;}
 if(JSON.stringify(c.input)!==before)throw Error(c.id+' mutated input');
}
for(const f of['MAPPING','LEASE','DEDUP','REPLAY','COVERAGE','ATOMIC'])if(!fixture.cases.some(c=>c.family===f&&!c.reject)||!fixture.cases.some(c=>c.family===f&&c.reject))throw Error('Missing family '+f);
// Every complete source string matters, including raw whitespace and ledger history.
let sourceMutations=0;for(const slot of slots){const changed=structuredClone(fixture.sources);changed[slot]+='\n';if(sha(canonical(changed))===sha(canonical(fixture.sources)))throw Error('Unbound '+slot);sourceMutations++;}
// Independent integer construction: identity quantization and source-value changes cannot be laundered.
let constructed=0;for(let cents=0;cents<=100;cents++)for(const mode of['HALF_UP','HALF_EVEN','DOWN']){
 const r=structuredClone(fixture.row),value=String(Math.floor(cents/100))+'.'+String(cents%100).padStart(2,'0');r.original=r.candidate=r.proposed_amount=r.components.cash=r.components.net=r.components.economic=value;r.components.tax='0';r.choice.mode=mode;
 if(row(r).issues.length)throw Error('Exact cents blocked');r.components.customs=value;r.customs_value='ADD';if(row(r).issues.length)throw Error('Whole customs blocked');r.components.customs=null;if(!row(r).issues.includes('CUSTOMS_COMPONENT_UNKNOWN'))throw Error('Unknown became zero');constructed++;
}
function inactive(directory){for(const e of readdirSync(directory,{withFileTypes:true})){const u=new URL(e.name+(e.isDirectory()?'/':''),directory);if(e.isDirectory())inactive(u);else if(e.name.endsWith('.ts')&&(e.name.includes('fee-application')||/(?:from\s*|import\s*\(?)\s*['"][^'"]*fee-application|INTERNAL_FEE_APPLICATION_BUNDLE|applyFeeApplication/.test(readFileSync(u,'utf8'))))throw Error('Design must not activate a production fee application path');}}
inactive(new URL('../src/',import.meta.url));
console.log(JSON.stringify({kind:fixture.kind,validCases:valid,rejectedCases:rejected,sourceMutations,constructedMappings:constructed,digestVectors:fixture.digest_vectors.length,productionImports:false,productionModuleImplemented:false,runtimeIntegrated:false,scope:'DESIGN_ONLY_NO_FINANCIAL_WRITES'}));
