import {readFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),read=path=>readFileSync(join(root,path)),blob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const historicalBytes=Buffer.from(read('docs/cases/fee-source-compatibility.json').toString('utf8').replace(/\r\n/g,'\n')),historical=JSON.parse(historicalBytes),report=JSON.parse(read('docs/cases/fee-source-compatibility-patch.json').toString('utf8'));
// Keep phase89 evidence immutable; the separately rerun record qualifies the changed test-only lockfile.
if(blob(historicalBytes)!=='1c6fe5d760dfadd3555cbb06e3876f254266fd05'||JSON.stringify(report.cases)!==JSON.stringify(historical.cases)||report.offline_runtime_blob!==historical.offline_runtime_blob)throw Error('Historical compatibility facts changed');
if(Object.keys(historical.source_fingerprints).length!==Object.keys(report.source_fingerprints).length||Object.entries(historical.source_fingerprints).some(([path,sha])=>path!=='package-lock.json'&&report.source_fingerprints[path]!==sha)||historical.source_fingerprints['package-lock.json']===report.source_fingerprints['package-lock.json'])throw Error('Patch qualification must change only the dependency fingerprint');
if(report.kind!=='SYNTHETIC_FEE_SOURCE_COMPATIBILITY_BROWSER_MATRIX'||report.version!=='0.1'||report.integration_decision!=='KEEP_ORIGINAL_CAPTURE'||report.runtime_integrated!==false||report.production_capacity_changed!==false||report.financial_writes!==0||report.financial_application_used!==false||report.real_phone_verified!==false||report.cases.length!==42)throw Error('Compatibility scope differs');
for(const[path,sha]of Object.entries(report.source_fingerprints)){
 if(!/^(?:src|tools)\/[a-zA-Z0-9/._-]+$/.test(path)&&path!=='package-lock.json'||path.split('/').includes('..'))throw Error('Invalid fingerprint path');
 const bytes=Buffer.from(read(path).toString('utf8').replace(/\r\n/g,'\n'));if(blob(bytes)!==sha)throw Error('Stale compatibility fingerprint '+path);
}
if(Object.keys(report.source_fingerprints).length!==12)throw Error('Incomplete source fingerprint coverage');
const ids=new Set(),caseById=new Map();
for(const c of report.cases){
 if(typeof c.id!=='string'||ids.has(c.id)||!['BASELINE','JSON_EXTENSION','JSON_DEPTH','JSON_NODES','UNSUPPORTED_JAVASCRIPT'].includes(c.category))throw Error('Invalid compatibility case');
 ids.add(c.id);caseById.set(c.id,c);
 if(c.kind!=='INTERNAL_FEE_SOURCE_COMPATIBILITY_DIAGNOSTIC'||c.version!=='0.1'||c.production_action!=='KEEP_ORIGINAL_CAPTURE'||c.application_readiness!=='NOT_TESTED'||c.import_authority!==false||c.confirmation_authority!==false||c.financial_writes!==0||c.owner_unchanged!==true||c.project_and_receipts_unchanged!==true||c.customer_review_unchanged!==true||c.storage_reads!==20||c.storage_writes!==0||c.adapter_accessor_or_tojson_calls!==0||c.full_capture_equal===false)throw Error('Unexpected comparison or side effect '+c.id);
 for(const field of ['legacy_capture','retained_parse','source_frame','reconstruction']){const observation=c[field];if(!observation||!['ACCEPTED','REJECTED','NOT_RUN'].includes(observation.status)||observation.status==='REJECTED'&&typeof observation.reason!=='string'||observation.status!=='REJECTED'&&observation.reason!==null)throw Error('Invalid observation '+c.id);}
 if(c.full_capture_equal===true&&(c.result!=='CAPTURE_EQUAL'||c.reconstruction.status!=='ACCEPTED'||c.retained_parse.status!=='ACCEPTED'))throw Error('Capture equality conflated with a rejected layer');
}
const gaps=report.cases.filter(c=>c.category!=='UNSUPPORTED_JAVASCRIPT'&&c.legacy_capture.status==='ACCEPTED'&&c.retained_parse.status==='ACCEPTED'&&c.source_frame.status==='REJECTED').map(c=>c.id),expected=['depth_29','depth_30','nodes_frame_over','nodes_retained_at'];
if(JSON.stringify(gaps)!==JSON.stringify(expected)||JSON.stringify(report.ordinary_json_compatibility_gaps)!==JSON.stringify(expected))throw Error('Ordinary JSON counterexamples changed; reassess integration gate');
const positives=['baseline','plain','unicode','unicode_forms','opaque_text','marker_keys','key_order','null_prototype','shared_reference','negative_zero','depth_28','nodes_frame_at',...['project','bill','pair','attachment','precision','envelope','attachment_workspace','precision_workspace','envelope_workspace'].map(k=>'holder_'+k)];
for(const id of positives)if(caseById.get(id)?.full_capture_equal!==true)throw Error('Missing positive mapping '+id);
const unsupported=['undefined','function','symbol_value','symbol_key','non_enumerable','sparse_array','custom_prototype','cycle','nan','infinity','lone_high','lone_low','accessor','to_json'];
for(const id of unsupported)if(caseById.get(id)?.category!=='UNSUPPORTED_JAVASCRIPT')throw Error('Unsupported JavaScript misclassified '+id);
if(new Set([...positives,...expected,'depth_31','depth_32','nodes_retained_over',...unsupported]).size!==42||report.cases.some(c=>![...positives,...expected,'depth_31','depth_32','nodes_retained_over',...unsupported].includes(c.id))||report.cases.filter(c=>c.full_capture_equal===true).length!==21)throw Error('Incomplete matrix identities or positive count');
for(const id of ['depth_31','depth_32','nodes_retained_over','lone_high','lone_low'])if(caseById.get(id)?.retained_parse.status!=='REJECTED')throw Error('Original retained parser rejection lost '+id);
if(caseById.get('nodes_frame_at').predicted_frame_nodes!==300000||caseById.get('nodes_frame_over').predicted_frame_nodes!==300001||caseById.get('nodes_retained_at').actual_retained_nodes!==300000||caseById.get('nodes_retained_over').actual_retained_nodes!==300001||caseById.get('cycle').legacy_capture.status!=='REJECTED')throw Error('Boundary or original capture evidence differs');
for(const id of ['accessor','to_json'])if(caseById.get(id)?.legacy_accessor_or_tojson_calls!==1||caseById.get(id)?.adapter_accessor_or_tojson_calls!==0)throw Error('Accessor provenance differs');
const app=read('src/ui/app.ts').toString('utf8');if(app.includes('fee-workbench-source-adapter')||app.includes('fee-source-compatibility'))throw Error('Known compatibility gaps: retain original production capture');
function production(directory){for(const entry of readdirSync(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())production(path);else if(entry.name.endsWith('.ts')&&/fee-source-compatibility/.test(readFileSync(path,'utf8')))throw Error('Developer diagnostic imported into production source');}}
production(join(root,'src'));
const runtime=read('trade-cost-engine.html');if(blob(runtime)!==report.offline_runtime_blob||report.offline_runtime_blob!=='c5c59c2c98930c4d1a2bd9a7a56b80967498389b'||runtime.includes(Buffer.from('__feeSourceCompatibility89')))throw Error('Production runtime or bridge isolation changed');
console.log(JSON.stringify({kind:report.kind,cases:42,exactCaptures:report.cases.filter(c=>c.full_capture_equal===true).length,ordinaryJsonGaps:gaps,productionAction:'KEEP_ORIGINAL_CAPTURE',transactionReadinessTested:false,financialWrites:0,runtimeIntegrated:false,scope:'COMMITTED_SYNTHETIC_BROWSER_EVIDENCE_AND_PRODUCTION_ISOLATION_CHECK'}));
