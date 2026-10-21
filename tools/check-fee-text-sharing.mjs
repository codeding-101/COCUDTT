import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {platform, arch} from 'node:os';
import {createServer} from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output' || !args[1])) throw Error('Use --output path or no arguments');
const output = resolve(args[1] ?? 'benchmark-results/fee-text-sharing.json');
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const sourcePaths = ['package.json','package-lock.json','tools/fee-text-sharing-prototype.ts','tools/check-fee-text-sharing.mjs','tools/fee-performance-fixture.ts','tools/fee-performance-harness.ts','tools/fee-performance-size.ts','src/data/fee-envelope-json.ts','src/domain/fee-envelope.ts','src/ui/workbench-state.ts','src/ui/fee-workbench-preview.ts','src/ui/fee-workbench-candidate.ts'];
const fingerprints = {};
for (const path of sourcePaths) {const bytes = Buffer.from((await readFile(resolve(root, path), 'utf8')).replace(/\r\n/g, '\n')); fingerprints[path] = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');}
const server = await createServer({root, configFile: false, optimizeDeps: {noDiscovery: true, include: []}, server: {middlewareMode: true, hmr: false, watch: null}, appType: 'custom'});
try {
  const {feePerformanceFixture} = await server.ssrLoadModule('/tools/fee-performance-fixture.ts');
  const {feePerformanceHarness} = await server.ssrLoadModule('/tools/fee-performance-harness.ts');
  const {projectedJsonBytes} = await server.ssrLoadModule('/tools/fee-performance-size.ts');
  const {encodeFeeTextSharingPrototype: encode, decodeFeeTextSharingPrototype: decode, TEXT_SHARING_PROTOTYPE_LIMITS: limits} = await server.ssrLoadModule('/tools/fee-text-sharing-prototype.ts');
  const cases = [];
  for (const count of [1, 4, 8]) {
    console.log('Checking synthetic sharing case ' + count + '…');
    const fixture = await feePerformanceFixture(count), harness = await feePerformanceHarness(fixture.raw), token = harness.owner.checkpoint();
    const input = harness.captureInput(), expandedBytes = projectedJsonBytes(input), blocked = expandedBytes > limits.expanded_json_bytes;
    const item = {count, status: blocked ? 'BLOCKED_EXPANDED_BUDGET' : 'ROUNDTRIP_VERIFIED', expanded_json_utf8_bytes: expandedBytes,
      encoded_utf8_bytes: null, bytes_saved: null, shared_texts: null, text_references: null, opaque_retained_json_utf8_bytes: Buffer.byteLength(input.retained_json, 'utf8'),
      roundtrip_equal: null, all_sources_exact: null, source_sha256: null, owner_revision_unchanged: true, candidate_preparation_run_here: false};
    if (!blocked) {
      const original = JSON.stringify(input), wire = encode(input), restored = decode(wire), doc = JSON.parse(wire);
      if (JSON.stringify(restored) !== original || Object.keys(input.sources).some(k => restored.sources[k] !== input.sources[k]) || restored.envelope_json !== input.envelope_json) throw Error('SHARING_ROUNDTRIP_MISMATCH');
      if (JSON.stringify(harness.captureInput()) !== original) throw Error('SHARING_MUTATED_CONTROLLER');
      Object.assign(item, {encoded_utf8_bytes: Buffer.byteLength(wire, 'utf8'), bytes_saved: expandedBytes - Buffer.byteLength(wire, 'utf8'), shared_texts: doc.texts.length, text_references: doc.nodes.filter(n => n[0] === 'ref').length,
        roundtrip_equal: true, all_sources_exact: true, source_sha256: Object.fromEntries(Object.entries(restored.sources).map(([key, text]) => [key, text === null ? null : hash(text)]))});
    }
    if (!harness.owner.isCurrent(token) || harness.workflow.customerReviewed !== true || harness.envelopeUi.applicationBackup() !== null) throw Error('SHARING_OWNER_OR_AUTHORITY_CHANGED');
    cases.push(item);
  }
  const vite = JSON.parse(await readFile(resolve(root, 'node_modules/vite/package.json'), 'utf8')).version;
  const report = {kind: 'SYNTHETIC_FEE_TEXT_SHARING_PROTOTYPE_EVIDENCE', version: '0.1', generated_at: new Date().toISOString(), environment: {node: process.version, vite, platform: platform(), arch: arch()},
    source_fingerprints: fingerprints, limits, cases, financial_writes: 0, import_authority: false, confirmation_authority: false,
    runtime_integrated: false, production_capacity_changed: false, real_business_data: false, real_phone_verified: false,
    methodology: {input: 'Same development-only 1/4/8 qualified synthetic fixtures as phase85; no business or downloadable template authority', scope: 'Whole-string leaf sharing with flat, single-parent structural nodes. retained_json stays opaque and unchanged', expanded_budget: 'Original128MiB retained. Oversized cases are preflighted and not encoded, decoded, previewed or prepared', timing_or_memory_claims: false, complete_runtime_preparation_test: 'Separate unit test runs original one-row preview and all ten participants; this checker does not prepare/apply fees'}};
  await mkdir(dirname(output), {recursive: true}); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({roundtrips: cases.filter(c => c.status === 'ROUNDTRIP_VERIFIED').map(c => c.count), blocked: cases.filter(c => c.status === 'BLOCKED_EXPANDED_BUDGET').map(c => c.count), financialWrites: 0, runtimeIntegrated: false, reportComplete: true}));
} finally {await server.close();}
