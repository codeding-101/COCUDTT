import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {cpus, platform, arch, totalmem} from 'node:os';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), option = (name, fallback) => {const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1];};
const valid = new Set(['--output', '--counts', '--repeat']);
const seen = new Set();
for (let i = 0; i < args.length; i += 2) {if (!valid.has(args[i]) || !args[i + 1] || seen.has(args[i])) throw Error('Use --output path --counts 1,4,8 --repeat 1..5; each option once'); seen.add(args[i]);}
const counts = option('--counts', '1,4,8').split(',').map(Number), repeats = Number(option('--repeat', '3'));
if (!counts.length || counts.some(n => ![1, 4, 8].includes(n)) || new Set(counts).size !== counts.length || !Number.isInteger(repeats) || repeats < 1 || repeats > 5) throw Error('Counts must be unique 1/4/8; repeat must be 1..5');
const output = resolve(option('--output', 'benchmark-results/fee-workbench-node.json'));
const sourcePaths = ['src/ui/app.ts','src/ui/fee-workbench-preview.ts','src/ui/fee-workbench-candidate.ts','src/data/fee-envelope.ts','src/data/fee-envelope-json.ts','src/domain/fee-envelope.ts','src/data/runtime-fee-backup.ts','tools/benchmark-fee-workbench.mjs','tools/fee-performance-fixture.ts','tools/fee-performance-harness.ts','tools/fee-performance-metrics.ts','tools/fee-performance-size.ts'];
const fingerprints = {};
for (const path of sourcePaths) {const bytes = Buffer.from((await readFile(resolve(root, path), 'utf8')).replace(/\r\n/g, '\n')); fingerprints[path] = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');}
const server = await createServer({root, configFile: false, optimizeDeps: {noDiscovery: true, include: []}, server: {middlewareMode: true, hmr: false, watch: null}, appType: 'custom'});
const started = performance.now(), cases = [];
try {
  const {measureFeePerformanceCase} = await server.ssrLoadModule('/tools/fee-performance-metrics.ts');
  const module_load_ms = performance.now() - started;
  for (const count of counts) {console.log('Measuring synthetic ' + count + ' component(s)…');cases.push(await measureFeePerformanceCase(count, repeats));}
  const report = {kind: 'SYNTHETIC_FEE_PERFORMANCE_BASELINE', version: '1.0', generated_at: new Date().toISOString(), environment: {node: process.version, platform: platform(), arch: arch(), logical_cpus: cpus().length, cpu_model: cpus()[0]?.model ?? null, total_memory_bytes: totalmem()}, module_load_ms,
    methodology: {first: 'First timed operation after fixture/controller setup and structural checks; not a cold process, OS or browser', repeated: repeats, phases_overlap: true, latency_thresholds: false, fixture_setup_excluded: true, node_capture: 'Real ten-participant controllers, complete retained harness state; excludes DOM controls and page rendering. Browser benchmark measures actual app capture separately', measurement_scope: 'Read-only preview/preparation and backup encoding; no apply/cache/download', source_input: 'Built-in synthetic 113 USD per independent container, explicit commercial conversion 7 CNY/USD; not real business/tax evidence'}, source_fingerprints: fingerprints, cases,
    financial_writes: 0, confirmation_authority: false, raw_business_data_in_report: false, real_phone_verified: false, all_sizes_supported: cases.every(c => c.status === 'MEASURED')};
  await mkdir(dirname(output), {recursive: true}); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({measured: cases.filter(c => c.status === 'MEASURED').map(c => c.count), capacityBlocked: cases.filter(c => c.status === 'CAPACITY_BLOCKED').map(c => c.count), repeats, financialWrites: 0, output, reportComplete: true, allSizesSupported: report.all_sizes_supported}));
} finally {await server.close();}
