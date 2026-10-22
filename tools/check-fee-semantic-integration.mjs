import {readFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),read=path=>readFileSync(join(root,path)),blob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const pkg=JSON.parse(read('package.json')),lock=JSON.parse(read('package-lock.json'));
if(pkg.devDependencies.vitest!=='5.0.3'||lock.packages[''].devDependencies.vitest!=='5.0.3'||lock.packages['node_modules/vitest'].version!=='5.0.3'||lock.packages['node_modules/@vitest/mocker'].version!=='5.0.3'||pkg.devDependencies.vite!=='7.3.7')throw Error('Reviewed test security patch differs');
const report=JSON.parse(read('docs/cases/fee-semantic-integration.json'));
if(report.legacy_oracle?.source_commit!=='41ec3068b4a067673520d2a0a3bd9b596ca5de02'||report.legacy_oracle?.app_blob!=='6846043e719dea87dd1eaf0a5cffb75cf328809a'||report.legacy_oracle?.binding!=='captureCurrentFeeWorkbench')throw Error('Independent historical capture provenance differs');
if(report.kind!=='SYNTHETIC_FEE_SEMANTIC_INTEGRATION_BROWSER_MATRIX'||report.version!=='0.2'||report.integration_decision!=='USE_SEMANTIC_CAPTURE'||report.runtime_integrated!==true||report.production_capacity_changed!==false||report.financial_writes!==0||report.financial_application_used!==false||report.real_phone_verified!==false||report.unexpected_dialog!==null||!Number.isSafeInteger(report.navigation_dialogs)||report.navigation_dialogs<0||report.cases.length!==42||report.operational.length!==27)throw Error('Semantic evidence scope differs');
if(blob(Buffer.from(read('docs/cases/fee-source-compatibility.json').toString('utf8').replace(/\r\n/g,'\n')))!=='1c6fe5d760dfadd3555cbb06e3876f254266fd05'||report.historical_counterexamples.source_commit!=='df330a6b642339ef9c21ac2d3e4c4cfec756e69a'||report.historical_counterexamples.adapter_version!=='0.1')throw Error('Historical counterexamples changed');
for(const[path,sha]of Object.entries(report.source_fingerprints)){
 if(!/^(?:src|tools)\/[a-zA-Z0-9/._-]+$/.test(path)&&path!=='package-lock.json'||path.split('/').includes('..'))throw Error('Invalid fingerprint path');
 if(blob(Buffer.from(read(path).toString('utf8').replace(/\r\n/g,'\n')))!==sha)throw Error('Stale semantic evidence fingerprint '+path);
}
if(Object.keys(report.source_fingerprints).length!==29)throw Error('Incomplete semantic fingerprint coverage');
const ids=new Set(),byId=new Map(),unsupported=['undefined','function','symbol_value','symbol_key','non_enumerable','sparse_array','custom_prototype','cycle','nan','infinity','lone_high','lone_low','accessor','to_json'];
for(const c of report.cases){
 if(typeof c.id!=='string'||ids.has(c.id))throw Error('Duplicate/missing semantic identity');ids.add(c.id);byId.set(c.id,c);
 if(c.kind!=='INTERNAL_FEE_SEMANTIC_INTEGRATION_DIAGNOSTIC'||c.version!=='0.2'||c.production_action!=='USE_SEMANTIC_CAPTURE'||c.application_readiness!=='NOT_TESTED'||c.import_authority!==false||c.confirmation_authority!==false||c.financial_writes!==0||c.owner_unchanged!==true||c.project_and_receipts_unchanged!==true||c.customer_review_unchanged!==true||c.storage_reads!==20||c.storage_writes!==0||c.adapter_accessor_or_tojson_calls!==0||c.full_capture_equal===false)throw Error('Semantic comparison or side effect differs '+c.id);
 for(const field of ['legacy_capture','retained_parse','semantic_capture','reconstruction']){const o=c[field];if(!o||!['ACCEPTED','REJECTED','NOT_RUN'].includes(o.status)||o.status==='REJECTED'&&typeof o.reason!=='string'||o.status!=='REJECTED'&&o.reason!==null)throw Error('Invalid semantic observation '+c.id);}
 if(c.full_capture_equal===true&&['legacy_capture','retained_parse','semantic_capture','reconstruction'].some(k=>c[k].status!=='ACCEPTED'))throw Error('Equality conflated with rejected layer');
}
const positives=['baseline','plain','unicode','unicode_forms','opaque_text','marker_keys','key_order','null_prototype','shared_reference','negative_zero','depth_28','depth_29','depth_30','nodes_frame_at','nodes_frame_over','nodes_retained_at',...['project','bill','pair','attachment','precision','envelope','attachment_workspace','precision_workspace','envelope_workspace'].map(k=>'holder_'+k)];
for(const id of positives)if(byId.get(id)?.full_capture_equal!==true)throw Error('Missing semantic equality '+id);
for(const id of unsupported)if(byId.get(id)?.category!=='UNSUPPORTED_JAVASCRIPT'||byId.get(id)?.semantic_capture.status!=='REJECTED'||byId.get(id)?.reconstruction.status!=='NOT_RUN')throw Error('Unsupported JS rejection lost '+id);
for(const id of ['depth_31','depth_32','nodes_retained_over'])if(byId.get(id)?.retained_parse.status!=='REJECTED'||byId.get(id)?.semantic_capture.status!=='REJECTED')throw Error('Original semantic boundary lost '+id);
if(new Set([...positives,...unsupported,'depth_31','depth_32','nodes_retained_over']).size!==42||report.cases.some(c=>![...positives,...unsupported,'depth_31','depth_32','nodes_retained_over'].includes(c.id))||report.cases.filter(c=>c.full_capture_equal===true).length!==25)throw Error('Semantic matrix identities differ');
if(byId.get('nodes_frame_over').predicted_frame_nodes!==300001||byId.get('nodes_retained_at').actual_retained_nodes!==300000||byId.get('nodes_retained_over').actual_retained_nodes!==300001)throw Error('Measured semantic node boundaries differ');
const closed=['depth_29','depth_30','nodes_frame_over','nodes_retained_at'];if(JSON.stringify(report.closed_ordinary_json_counterexamples)!==JSON.stringify(closed))throw Error('Counterexamples not closed');
for(const id of ['accessor','to_json'])if(byId.get(id)?.legacy_accessor_or_tojson_calls!==1||byId.get(id)?.adapter_accessor_or_tojson_calls!==0)throw Error('Accessor provenance differs');
const operationalIds=['baseline','uninitialized','pending_only','control_input','control_textarea','control_select','control_checkbox','control_detached','control_other','fx_matching','fx_changed','fx_incomplete','fx_bad','project_read_active','project_read_stale','recovery','file_busy','file_download','file_saved','storage_absent','storage_empty','storage_bad','storage_throw_one','storage_throw_all','envelope_read','blockers_all','populated_formal_fixture'];
if(JSON.stringify(report.operational.map(c=>c.label))!==JSON.stringify(operationalIds))throw Error('Operational state coverage differs');
for(const c of report.operational)if(c.equal!==true||c.different.length||c.owner_unchanged!==true||c.project_and_receipts_unchanged!==true||c.customer_review_unchanged!==true||c.financial_writes!==0||c.storage_reads!==20||c.storage_writes!==0||c.root_fields.length!==9||c.retained_fields.length!==20||c.source_fields.length!==5||c.file_holders.length!==6)throw Error('Operational comparison differs '+c.label);
if(report.operational.find(c=>c.label==='blockers_all').blockers.join(',')!=='INVALID_FX_OR_PROJECT,ACTIVE_ENVELOPE,ACTIVE_FILE_WRITE'||report.operational.find(c=>c.label==='storage_throw_all').storage_availability.some(Boolean))throw Error('Blocking or storage evidence differs');
function production(directory){for(const entry of readdirSync(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())production(path);else if(entry.name.endsWith('.ts')&&/(?:from\s*['"](?:\.\.\/)+tools\/|__feeSemanticIntegration91|__feeSourceSemanticBudget90|fee-legacy-capture-oracle)/.test(readFileSync(path,'utf8')))throw Error('Test oracle or diagnostic imported into production');}}
production(join(root,'src'));
const app=read('src/ui/app.ts').toString('utf8');
if(!app.includes("from './fee-workbench-semantic-capture.js'")||!app.includes('captureFeeSemanticBudget(workbenchState,{')||app.includes('captureFeeWorkbenchSourceFrame')||app.includes('captureLegacyFeeWorkbench91'))throw Error('Explicit production capture binding missing');
const runtime=read('trade-cost-engine.html');if(blob(runtime)!==report.offline_runtime_blob||['__feeSemanticIntegration91','__feeSourceSemanticBudget90','__feeSourceCompatibility89','captureLegacyFeeWorkbench91'].some(s=>runtime.includes(Buffer.from(s))))throw Error('Production artifact or bridge isolation changed');
const native=JSON.parse(read('docs/cases/fee-semantic-integration-native.json'));
function portable(value){
 if(typeof value==='string'&&/^(?:[A-Za-z]:[\\/]|file:\/\/\/|\\\\|\/(?:Users|home)\/)/.test(value))throw Error('Public evidence contains a local absolute path');
 if(value&&typeof value==='object')Object.values(value).forEach(portable);
}
portable(native);
if(native.kind!=='SYNTHETIC_FEE_SEMANTIC_INTEGRATION_NATIVE_REGRESSION'||native.offline_runtime_blob!==report.offline_runtime_blob||native.real_phone_verified!==false||native.professional_review_verified!==false||native.production_capacity_changed!==false||native.suites.length!==46||new Set(native.suites.map(s=>s.suite)).size!==46||native.suites.some(s=>s.exitCode!==0||!s.report||!s.report_blob))throw Error('Complete native evidence missing');
for(const[path,sha]of Object.entries(native.source_fingerprints))if(blob(Buffer.from(read(path).toString('utf8').replace(/\r\n/g,'\n')))!==sha)throw Error('Stale full native source '+path);
if(Object.keys(native.source_fingerprints).length<300)throw Error('Incomplete native source coverage');
const suiteDeclaration=read('tools/run-browser-regression.mjs').toString('utf8').match(/const suites=(\[[^\]]+\])/);
if(!suiteDeclaration||JSON.stringify(native.suites.map(s=>s.suite))!==JSON.stringify(JSON.parse(suiteDeclaration[1].replaceAll("'",'"'))))throw Error('Native suite identities differ');
for(const name of ['runtime-fee-preview','runtime-fee-application','post-application-requote']){
 const checks=native.suites.find(s=>s.suite===name).report.checks;
 if(!checks||Object.values(checks).some(v=>v!==true))throw Error('Native financial flow failed '+name);
}
const application=native.suites.find(s=>s.suite==='runtime-fee-application').report.checks;
for(const key of ['costAndReceiptTogether','repeatedOldButtonNoCharge','completeBeforeAndAfter','postCommitRecoveryAvailable','displayFailureBackupKeepsReceipt','retryDoesNotReapply','customerReviewRevoked','originalSourcesRetained','fxAndSaveEvidenceRetained','mobileExplicitApplication'])if(application[key]!==true)throw Error('Missing atomic apply or recovery evidence '+key);
for(const s of native.suites){const bytes=Buffer.from(JSON.stringify(s.report,null,2));if(blob(bytes)!==s.report_blob)throw Error('Native report changed '+s.suite);}
if(native.unit.files!==130||native.unit.passed!==4659||native.unit.new_tests!==45||native.unit.success!==true)throw Error('Production guard regression missing');
console.log(JSON.stringify({kind:report.kind,compatibilityCases:42,operationalCases:27,exactCaptures:52,closedCounterexamples:closed,unsupportedJavaScript:14,productionAction:'USE_SEMANTIC_CAPTURE',transactionReadinessTested:true,captureFinancialWrites:0,nativeApplicationVerified:true,nativeSuites:46,runtimeIntegrated:true,scope:'COMMITTED_CAPTURE_AND_FULL_NATIVE_INTEGRATION_EVIDENCE'}));
