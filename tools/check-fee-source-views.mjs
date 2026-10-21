import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output' || !args[1])) throw Error('Use --output path or no arguments');
const output = resolve(args[1] ?? 'benchmark-results/fee-source-views.json'), fingerprints = {};
const sourcePaths = ['package.json','package-lock.json','tools/check-fee-source-views.mjs','tools/fee-source-view-prototype.ts','tools/fee-text-sharing-prototype.ts','tools/fee-performance-harness.ts','tools/fee-performance-fixture.ts','tools/fee-performance-size.ts','tests/fee-source-view.test.ts','tests/fee-source-view-state.test.ts','src/data/fee-envelope-json.ts','src/ui/workbench-state.ts','src/ui/container-bill-controller.ts','src/ui/container-cost-pair-controller.ts','src/ui/fee-tax-attachment-controller.ts','src/ui/fee-precision-selection-controller.ts','src/ui/fee-envelope-controller.ts','src/ui/fee-tax-attachment-workspace.ts','src/ui/fee-precision-selection-workspace.ts','src/ui/fee-envelope-workspace.ts'];
for (const path of sourcePaths) {const bytes = Buffer.from((await readFile(resolve(root, path), 'utf8')).replace(/\r\n/g, '\n')); fingerprints[path] = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');}
const server = await createServer({root, configFile: false, optimizeDeps: {noDiscovery: true, include: []}, server: {middlewareMode: true, hmr: false, watch: null}, appType: 'custom'});
try {
  const {feePerformanceFixture} = await server.ssrLoadModule('/tools/fee-performance-fixture.ts');
  const {feePerformanceHarness} = await server.ssrLoadModule('/tools/fee-performance-harness.ts');
  const {projectedJsonBytes} = await server.ssrLoadModule('/tools/fee-performance-size.ts');
  const {FeeSourceViewPrototype, FEE_SOURCE_VIEW_LIMITS: limits, FEE_SOURCE_VIEW_PRODUCERS: ids, decodeFeeSourceViewPrototype: decode} = await server.ssrLoadModule('/tools/fee-source-view-prototype.ts');
  const cases = [];
  for (const count of [1, 4, 8]) {
    console.log('Checking explicit producer views ' + count + '…');
    const fixture = await feePerformanceFixture(count), h = await feePerformanceHarness(fixture.raw), token = h.owner.checkpoint();
    const projectBefore = JSON.stringify(h.app.project), envelopeBefore = h.envelopeUi.controller.state().current.raw_json;
    const inputs = h.sourceViewReaders().map(r => ({producer: r.producer, value: r.read()}));
    const plain = {kind: 'INTERNAL_FEE_SOURCE_VIEWS_PROTOTYPE', version: '0.1', financial_writes: 0, import_authority: false, confirmation_authority: false, runtime_integrated: false, producers: inputs};
    // Size projection is only over trusted producer-returned JSON; it is not an untrusted input validator.
    const producerSizes = Object.fromEntries(inputs.map(p => [p.producer, projectedJsonBytes(p.value)])), logicalBytes = projectedJsonBytes(plain);
    const blocked = logicalBytes > limits.logical_graph_json_bytes || Object.values(producerSizes).some(n => n > limits.producer_json_bytes);
    const item = {count, status: blocked ? 'BLOCKED_LOGICAL_BUDGET' : 'DIAGNOSTIC_ROUNDTRIP_VERIFIED', producers: inputs.map(p => p.producer),
      producer_json_utf8_bytes: producerSizes, logical_graph_json_utf8_bytes: logicalBytes, encoded_utf8_bytes: null, shared_texts: null,
      all_producers_exact: null, decoded_view_has_private_issue: null, owner_revision_unchanged: true, financial_writes: 0, runtime_preparation_run: false};
    if (!blocked) {
      if (!h.owner.isCurrent(token)) throw Error('SOURCE_VIEW_PREFLIGHT_STALE');
      const session = new FeeSourceViewPrototype(h.owner), view = session.capture(inputs.map(p => ({producer: p.producer, read: () => p.value}))), wire = session.encode(view), restored = decode(wire), doc = JSON.parse(wire);
      if (JSON.stringify(view) !== JSON.stringify(plain) || JSON.stringify(restored) !== JSON.stringify(plain) || !session.isCurrent(view) || session.isCurrent(restored) || inputs.some((p, i) => ids[i] !== p.producer)) throw Error('SOURCE_VIEW_DATA_OR_ISSUE_MISMATCH');
      Object.assign(item, {encoded_utf8_bytes: Buffer.byteLength(wire, 'utf8'), shared_texts: doc.texts.length, all_producers_exact: true, decoded_view_has_private_issue: false});
    }
    if (!h.owner.isCurrent(token) || JSON.stringify(h.app.project) !== projectBefore || h.envelopeUi.controller.state().current.raw_json !== envelopeBefore || h.workflow.customerReviewed !== true || h.envelopeUi.applicationBackup() !== null) throw Error('SOURCE_VIEW_MUTATED_OR_RECONFIRMED');
    cases.push(item);
  }
  const vite = JSON.parse(await readFile(resolve(root, 'node_modules/vite/package.json'), 'utf8')).version;
  const report = {kind: 'SYNTHETIC_FEE_SOURCE_VIEW_PROTOTYPE_EVIDENCE', version: '0.1', generated_at: new Date().toISOString(),
    environment: {node: process.version, vite, platform: process.platform, arch: process.arch}, source_fingerprints: fingerprints, limits, cases,
    financial_writes: 0, import_authority: false, confirmation_authority: false, runtime_integrated: false, production_capacity_changed: false,
    real_business_data: false, real_phone_verified: false, legacy_capture_equivalence_proven: false,
    methodology: {scope: 'Ten explicit producer projections in the existing development controller harness; no DOM or runtime installation',
      input: 'Same qualified synthetic 1/4/8 fixtures; existing captureInput and preparation path unchanged',
      budgets: 'Original strict JSON bounds retained per producer and whole graph; phase86 codec retains encoded and expanded128MiB limits',
      opaque_text: 'No retained_json parsing or guessing. All producer payload fields and unknown strings remain data',
      comparison: 'Different contract from legacy runtime capture: sizes cannot establish a production speed, memory or capacity improvement',
      timing_or_memory_claims: false, runtime_preparation: 'Separate unit test uses original capture and original ten-participant preparation; never feeds decoded view to runtime'}};
  await mkdir(dirname(output), {recursive: true}); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({diagnosticRoundtrips: cases.filter(c => c.status === 'DIAGNOSTIC_ROUNDTRIP_VERIFIED').map(c => c.count), blocked: cases.filter(c => c.status === 'BLOCKED_LOGICAL_BUDGET').map(c => c.count), financialWrites: 0, runtimeIntegrated: false, legacyEquivalent: false, reportComplete: true}));
} finally {await server.close();}
