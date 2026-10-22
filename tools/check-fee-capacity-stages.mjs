import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),read=path=>readFileSync(join(root,path)),blob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const r=JSON.parse(read('docs/cases/fee-capacity-stages.json')),fail=message=>{throw Error('Capacity evidence: '+message);},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function portable(v){if(typeof v==='string'&&/^(?:[A-Za-z]:[\\/]|file:\/\/\/|\\\\|\/(?:Users|home)\/)/.test(v))fail('local path in public report');if(v&&typeof v==='object')Object.values(v).forEach(portable);}
portable(r);
if(r.kind!=='SYNTHETIC_FEE_CAPACITY_STAGE_BROWSER_EVIDENCE'||r.version!=='1.0'||r.base_source_commit!=='e58ed1ef48fa70aa571f0b969b851d6b81875829'||r.financial_writes!==0||r.financial_application_used!==false||r.confirmation_authority!==false||r.real_phone_verified!==false||r.professional_review_verified!==false||r.unexpected_dialog!==null||r.exceptions.length||r.resources_local_only!==true||!same(r.cases.map(c=>c.count),[1,4,8]))fail('scope');
if(r.methodology.shape_pass_excluded_from_timings!==true||r.methodology.first_plus_repeated!==3||r.methodology.nested_timings_overlap!==true||r.methodology.first_is_cold_start!==false||r.methodology.latency_thresholds!==false||r.methodology.backup_read_is_cached!==true||r.methodology.physical_disk_io_verified!==false||r.methodology.production_capacity_changed!==false)fail('methodology');
const native=JSON.parse(read('docs/cases/fee-semantic-integration-native.json')),fps=r.source_fingerprints;
if(Object.keys(fps).length!==Object.keys(native.source_fingerprints).length+4||Object.entries(native.source_fingerprints).some(([path,sha])=>fps[path]!==sha))fail('original source coverage');
for(const[path,sha]of Object.entries(fps)){
 if(path.split('/').includes('..')||! /^(?:(?:src|tests|tools)\/[a-zA-Z0-9/._-]+|package(?:-lock)?\.json)$/.test(path)||blob(Buffer.from(read(path).toString('utf8').replace(/\r\n/g,'\n')))!==sha)fail('stale or invalid fingerprint '+path);
}
const runtime=read('trade-cost-engine.html');
if(blob(runtime)!==r.offline_runtime_blob||r.offline_runtime_blob!==native.offline_runtime_blob||['__feeCapacity92','CAPACITY_TRACE_BUSY'].some(s=>runtime.includes(Buffer.from(s))))fail('runtime or diagnostic isolation');
function production(directory){for(const entry of readdirSync(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())production(path);else if(entry.name.endsWith('.ts')&&/(?:fee-capacity-|__feeCapacity92)/.test(readFileSync(path,'utf8')))fail('production imported diagnostic');}}production(join(root,'src'));
const budget=128*1024*1024,leaf=count=>count===4?'WHOLE_CAPTURE':'RETAINED_ROOT',saveKeys=['save','bill-save','pair-save','fee-tax-save','fee-precision-save','fee-envelope-save'];
function events(trace,mode){
 if(trace.mode!==mode||!Array.isArray(trace.events)||mode==='MEASURE'&&(trace.retained_roots.length||trace.complete_captures.length))fail('trace mode');
 for(const[e,i]of trace.events.map((e,i)=>[e,i]))if(e.sequence!==i+1||e.parent!==null&&(!Number.isInteger(e.parent)||e.parent<1||e.parent>=e.sequence)||!['ACCEPTED','REJECTED'].includes(e.status)||e.status==='ACCEPTED'&&e.code!==null||e.status==='REJECTED'&&e.code!=='FEE_ENVELOPE_INVALID:STRICT_JSON'||mode==='SHAPE'&&e.ms!==null||mode==='MEASURE'&&(!Number.isFinite(e.ms)||e.ms<0))fail('event');
}
for(const c of r.cases){
 if(c.shape.mode!=='SHAPE'||c.shape.count!==c.count||c.samples.length!==4||c.shape.trace.retained_roots.length!==1)fail('sample coverage');
 events(c.shape.trace,'SHAPE');
 const retained=c.shape.trace.retained_roots[0];
 if(retained.status!=='COUNTED'||Object.keys(retained.fields).length!==20||retained.shape.nodes>=300000||retained.shape.root_zero_depth!==7||!Number.isSafeInteger(retained.shape.compact_utf8_bytes))fail('retained root');
 if(c.count===8){if(retained.shape.compact_utf8_bytes<=budget||c.shape.trace.complete_captures.length)fail('8-row original retained byte boundary');}
 else{const full=c.shape.trace.complete_captures[0];if(retained.shape.compact_utf8_bytes>budget||c.shape.trace.complete_captures.length!==1||full.status!=='COUNTED'||full.shape.nodes!==53||full.shape.root_zero_depth!==3||c.count===1&&full.shape.compact_utf8_bytes>budget||c.count===4&&full.shape.compact_utf8_bytes<=budget)fail('complete capture byte boundary');}
 for(const sample of c.samples){
  events(sample.trace,'MEASURE');
  if(sample.count!==c.count||sample.mode!=='MEASURE'||Object.entries(sample.preservation).some(([k,v])=>k==='financial_writes'?v!==0:v!==true))fail('read-only invariants');
  if(c.count===1){
   if(sample.status!=='PREPARED'||sample.failure!==null||sample.not_run.length||sample.trace.events.length!==20||sample.trace.events.some(e=>e.status!=='ACCEPTED')||sample.trace.events.filter(e=>e.phase==='CAPTURE').length!==4||!same(sample.prepared,{participants:10,costs_added:1,buyer_delta:'791',seller_profit_before:null,seller_profit_after:null,copied_summary_rejected:true})||!sample.backup||sample.backup.complete_capture_roundtrip!==true||sample.backup.ten_pending_patches!==true||sample.backup.no_import_authority!==true||sample.backup.no_application_receipt!==true||sample.backup.encoded_utf8_bytes>64*1024*1024||sample.backup.raw_utf8_bytes>256*1024*1024||!/^[a-f0-9]{64}$/.test(sample.backup.encoded_sha256))fail('single preparation or backup');
  }else{
   if(sample.status!=='REJECTED'||sample.failure?.phase!=='CAPTURE'||sample.failure.code!=='FEE_ENVELOPE_INVALID:STRICT_JSON'||sample.prepared!==null||sample.backup!==null||sample.capture_sha256!==null||!same(sample.not_run,['PREVIEW','PREPARE','BACKUP_READ'])||sample.trace.events.filter(e=>e.status==='REJECTED').at(-1)?.phase!==leaf(c.count)||sample.trace.events.some(e=>['PREVIEW','PREPARE','BACKUP_ENCODE','BACKUP_READ'].includes(e.phase)))fail('refusal stage or not-run distinction');
  }
 }
 const n=c.native_backup;
 events(n.trace,'MEASURE');
 if(c.count===1){if(n.scope!=='ORIGINAL_ACTION_UNPREPARED_BACKUP'||n.writer_calls!==1||n.json_parseable!==true||n.trace.events.some(e=>e.status==='REJECTED'))fail('single native backup');}
 else if(n.scope!=='ORIGINAL_ACTION_CAPTURE_REFUSAL'||n.writer_calls!==0||n.trace.events.filter(e=>e.status==='REJECTED').at(-1)?.phase!==leaf(c.count))fail('native refused before writer');
 const fallback=c.formal_file_fallback;
 if(!same(fallback.saves.map(s=>s.action),saveKeys)||fallback.six_source_texts_unchanged!==true||fallback.customer_review_kept!==true||fallback.physical_disk_io_verified!==false||fallback.saves.some(s=>s.equals_current_source!==true||s.json_parseable!==true||!Number.isSafeInteger(s.bytes)||s.bytes<=0||!/^[a-f0-9]{64}$/.test(s.sha256)))fail('six-file fallback');
}
const ui=r.offline_ui;
if(ui.offline_runtime_blob!==r.offline_runtime_blob||ui.financial_writes!==0||ui.confirmation_authority!==false||ui.resources_local_only!==true||ui.exceptions.length||ui.all_sizes_supported!==false||!same(ui.cases.map(c=>c.count),[1,4,8])||ui.methodology.repeated!==3||ui.methodology.latency_thresholds!==false)fail('original offline measurement');
for(const c of ui.cases){const t=c.preview_including_capture_prepare_render,ordered=[...t.repeated_ms].sort((a,b)=>a-b);if(t.repeated_ms.length!==3||t.repeated_min_ms!==ordered[0]||t.repeated_median_ms!==ordered[1]||t.repeated_max_ms!==ordered[2]||[t.first_ms,...ordered].some(n=>!Number.isFinite(n)||n<0)||Object.values(c.verified).some(v=>v!==true)||c.preview_statuses.length!==4||c.preview_statuses.some(s=>s!==(c.count===1?'STAGED':'REFUSED'))||c.status!==(c.count===1?'MEASURED':'APP_REFUSED')||c.count!==1&&(c.prepared_backup_including_capture_encode_save_api!==null||c.candidate_profit_unknown!==null||c.backup_encoded_utf8_bytes.length))fail('offline sample semantics');}
let links=0;for(const file of ['docs/fee-capacity-stages-design.md','docs/fee-capacity-stages-validation.md'])for(const match of read(file).toString('utf8').matchAll(/\]\(([^)]+)\)/g)){const url=match[1];if(/^(?:https?:|#)/.test(url))continue;const full=resolve(root,dirname(file),url.split('#')[0]),path=relative(root,full);if(path.startsWith('..')||isAbsolute(path)||!existsSync(full))fail('document link '+url);links++;}
console.log(JSON.stringify({kind:r.kind,counts:[1,4,8],measuredSamples:12,shapePasses:3,formalFileSaves:18,refusalStages:{4:'WHOLE_CAPTURE',8:'RETAINED_ROOT'},sourceFingerprints:Object.keys(fps).length,localLinks:links,financialWrites:0,capacityChanged:false}));
