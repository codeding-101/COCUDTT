/** Independent developer checks. Synthetic data only; no application call or business readiness certification. */
import {createHash} from 'node:crypto';
import {encodeFeeLayeredCapturePrototype as encode, decodeFeeLayeredCapturePrototype as decode, inspectFeeLayeredCaptureBudget as inspect, FeeLayeredCapturePrototype, FeeLayeredCapturePrototypeError, type FeeLayeredCaptureParts} from './fee-layered-capture-prototype';
import {feeLayeredParts as parts} from './fee-layered-capture-cases';
import {copyFeeEnvelopeJson} from '../src/data/fee-envelope-json';
import {WorkbenchStateOwner} from '../src/ui/workbench-state';
import {feePerformanceFixture} from './fee-performance-fixture';
import {feePerformanceHarness} from './fee-performance-harness';
import {previewRuntimeFeeWorkbench, runtimeFeeWorkbenchPreparedSnapshot} from '../src/ui/fee-workbench-preview';
import {d} from '../src/domain/decimal';
const hash = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8');
function must(value: unknown): asserts value {if (!value) throw Error('LAYERED_DIAGNOSTIC_ASSERTION');}
export const FEE_LAYERED_DIAGNOSTIC_CASES = ['compact', 'pretty', 'opaque_raw_and_holders', 'marker_keys', 'aliases_expand', 'depth32', 'depth33', 'node300000', 'node300001', 'capture128mib', 'capture128mib_plus1', 'retained_expansion', 'escaped_expansion', 'invalid_text_ref', 'structural_ref', 'false_summary', 'private_identity', 'ABA', 'late_cancel', 'latest_read', 'complete_fixture', 'cancelled_controller'] as const;
export async function runFeeLayeredCaptureDiagnostic() {
  const cases: {id: string; status: string; checks: Record<string, boolean>; facts: Record<string, unknown>}[] = [];
  const record = (id: string, status: string, checks: Record<string, boolean>, facts: Record<string, unknown> = {}) => {must(Object.values(checks).every(v => v === true)); cases.push({id, status, checks, facts});};
  const refused = (id: string, run: () => unknown, expected: string) => {try {run();} catch (e) {must(e instanceof FeeLayeredCapturePrototypeError && e.code === expected); record(id, 'REJECTED', {expected_reason: true}, {code: expected}); return;} throw Error('LAYERED_EXPECTED_REFUSAL');};
  for (const [id, format] of [['compact', 'COMPACT'], ['pretty', 'PRETTY_LF']] as const) {
    const value = {unknown: {raw: '中😀\r\n\u0000"\\'.repeat(180)}, pending: '{unfinished', read_token: 2}, input = parts(value, format), wire = encode(input), restored = decode(wire);
    const expected = format === 'COMPACT' ? JSON.stringify(value) : JSON.stringify(value, null, 2) + '\n';
    record(id, 'ROUNDTRIP', {retained_equal: JSON.stringify(restored.retained_root) === JSON.stringify(value), exact_text: restored.capture.retained_json === expected,
      complete_bytes: inspect(input).capture.compact_utf8_bytes === bytes(restored.capture), no_authority: !restored.import_authority && !restored.confirmation_authority && !restored.runtime_integrated}, {wire_bytes: Buffer.byteLength(wire), full_bytes: bytes(restored.capture)});
  }
  const raw = '\ufeff  {"商品":"\\u4e2d"}\r\n' + '中😀"\\\r\n'.repeat(200), holderInput = parts({a: {raw, name: null, confirmed: false}, b: {raw, name: 'B', confirmed: true}});
  holderInput.capture_shell.files.project = {name: 'A', saved_raw: raw, saved_at: null}; const holderWire = encode(holderInput), holder = decode(holderWire), holderPacket = JSON.parse(holderWire);
  record('opaque_raw_and_holders', 'ROUNDTRIP', {one_complete_text: holderPacket.texts.length === 1 && holderPacket.texts[0] === raw, exact_utf8: Buffer.from(holder.capture.files.project.saved_raw!).equals(Buffer.from(raw)), retained_equal: JSON.stringify(holder.retained_root) === JSON.stringify(holderInput.retained_root)}, {raw_sha256: hash(raw), no_source_parsing: true});
  const marker = JSON.parse('{"__proto__":{"x":1},"constructor":"data","10":"ten","2":"two","kind":"text-ref","nodes":[0]}');
  record('marker_keys', 'ROUNDTRIP', {own_key: Object.hasOwn(decode(encode(parts(marker))).retained_root as object, '__proto__'), exact_json: JSON.stringify(decode(encode(parts(marker))).retained_root) === JSON.stringify(marker), no_pollution: !Object.hasOwn(Object.prototype, 'x')});
  const alias = {raw}, aliases = decode(encode(parts([alias, alias]))).retained_root as object[];
  record('aliases_expand', 'ROUNDTRIP', {separate_holders: aliases[0] !== aliases[1], equal_values: JSON.stringify(aliases[0]) === JSON.stringify(aliases[1])});
  let chain: unknown = null; for (let i = 0; i < 32; i++) chain = [chain];
  record('depth32', 'ROUNDTRIP', {original_accepts: JSON.stringify(copyFeeEnvelopeJson(chain)) === JSON.stringify(chain), roundtrip_equal: JSON.stringify(decode(encode(parts(chain))).retained_root) === JSON.stringify(chain)}, {depth: inspect(parts(chain)).retained.root_zero_depth});
  refused('depth33', () => encode(parts([chain])), 'SEMANTIC_LIMIT');
  const nodes = Array(299999).fill(null), nodeWire = encode(parts(nodes, 'COMPACT')), nodeRestored = decode(nodeWire);
  record('node300000', 'ROUNDTRIP', {node_count: inspect(parts(nodes, 'COMPACT')).retained.nodes === 300000, exact_bytes: nodeRestored.capture.retained_json === JSON.stringify(nodes)}, {chunks: JSON.parse(nodeWire).chunks.length});
  refused('node300001', () => inspect(parts([...nodes, null], 'COMPACT')), 'SEMANTIC_LIMIT');
  const empty = parts('', 'COMPACT'), {blockers, ...shell} = empty.capture_shell, baseBytes = bytes({...shell, retained_json: '""', blockers}), limit = 128 * 1024 * 1024;
  const atLimit = 'x'.repeat(limit - baseBytes), boundary = inspect(parts(atLimit, 'COMPACT'));
  record('capture128mib', 'BUDGET_ONLY', {exact_boundary: boundary.capture.compact_utf8_bytes === limit}, {bytes: boundary.capture.compact_utf8_bytes, transport_acceptance_tested: false, materialized: false});
  refused('capture128mib_plus1', () => inspect(parts(atLimit + 'x', 'COMPACT')), 'CAPTURE_BYTES');
  refused('retained_expansion', () => inspect(parts(Array(129).fill('x'.repeat(1024 * 1024)), 'COMPACT')), 'ROOT_BYTES');
  refused('escaped_expansion', () => inspect(parts(Array(48).fill('"'.repeat(1024 * 1024)), 'COMPACT')), 'CAPTURE_BYTES');
  const badRef = JSON.parse(holderWire), badNodes = (badRef.chunks as string[]).flatMap(c => JSON.parse(c) as unknown[][]), firstRef = badNodes.find(n => n[0] === 'text-ref')!; firstRef[1] = 'https://foreign.invalid/raw';
  badRef.chunks = [JSON.stringify(badNodes)]; refused('invalid_text_ref', () => decode(JSON.stringify(badRef)), 'TEXT_REFERENCE');
  badNodes[0] = ['node-ref', 0]; badRef.chunks = [JSON.stringify(badNodes)]; refused('structural_ref', () => decode(JSON.stringify(badRef)), 'NODE_TAG');
  const badSize = JSON.parse(holderWire); badSize.summary.capture.compact_utf8_bytes = 1; refused('false_summary', () => decode(JSON.stringify(badSize)), 'SUMMARY');
  const owner = new WorkbenchStateOwner(), state = {raw: 'A'}; owner.bind(state, 'test'); const session = new FeeLayeredCapturePrototype(owner), issued = await session.capture(() => parts({raw: state.raw})), wire = session.encode(issued);
  record('private_identity', 'READ_ONLY', {issued_only: session.isCurrent(issued), restored_not_issued: !session.isCurrent(decode(wire)), json_not_issued: !session.isCurrent(JSON.parse(wire)), peer_not_issued: !new FeeLayeredCapturePrototype(owner).isCurrent(issued)});
  state.raw = 'B'; state.raw = 'A'; const fresh = await session.capture(() => parts({raw: state.raw}));
  record('ABA', 'READ_ONLY', {old_expired: !session.isCurrent(issued), same_bytes: session.encode(fresh) === wire, fresh_issued: session.isCurrent(fresh)});
  let finish!: (v: FeeLayeredCaptureParts) => void;
  const cancelled = session.capture(() => new Promise<FeeLayeredCaptureParts>(resolve => {finish = resolve;})); session.cancel(); finish(parts()); let cancelCode = '';
  try {await cancelled;} catch (e) {if (e instanceof FeeLayeredCapturePrototypeError) cancelCode = e.code;}
  record('late_cancel', 'REJECTED', {stale_only: cancelCode === 'STALE'});
  const old = session.capture(() => new Promise<FeeLayeredCaptureParts>(resolve => {finish = resolve;})), latest = await session.capture(() => parts()); finish(parts()); let oldCode = '';
  try {await old;} catch (e) {if (e instanceof FeeLayeredCapturePrototypeError) oldCode = e.code;}
  record('latest_read', 'READ_ONLY', {old_rejected: oldCode === 'STALE', latest_current: session.isCurrent(latest)});
  const fixture = await feePerformanceFixture(1), h = await feePerformanceHarness(fixture.raw), before = h.capture(), beforeJson = JSON.stringify(before), checkpoint = h.owner.checkpoint();
  const {retained_json, ...capture_shell} = before, realSession = new FeeLayeredCapturePrototype(h.owner), real = await realSession.capture(() => ({retained_root: JSON.parse(retained_json), capture_shell, retained_format: 'COMPACT'})), realWire = realSession.encode(real), restored = decode(realWire);
  const preview = await previewRuntimeFeeWorkbench(restored.capture, 'LAYERED94_DIAGNOSTIC_ONLY'), candidate = await h.preparer.prepare(preview); let foreign = false, foreignPreview = false;
  try {h.preparer.backup(JSON.parse(JSON.stringify(candidate)));} catch {foreign = true;}
  try {runtimeFeeWorkbenchPreparedSnapshot(restored as never);} catch {foreignPreview = true;}
  must(candidate.participants.length === 10 && candidate.costs_added === 1 && d(candidate.after.buyer_total).minus(candidate.before.buyer_total).eq('791'));
  h.preparer.discard(candidate);
  record('complete_fixture', 'READ_ONLY', {exact_capture: JSON.stringify(restored.capture) === beforeJson, exact_retained: restored.capture.retained_json === retained_json,
    holder_evidence: JSON.stringify(restored.capture.files) === JSON.stringify(before.files), reencoding_exact: encode({retained_root: restored.retained_root, capture_shell, retained_format: 'COMPACT'}) === realWire,
    ten_participant_candidate: candidate.participants.length === 10, buyer_delta_791: d(candidate.after.buyer_total).minus(candidate.before.buyer_total).eq('791'), unknown_profit_kept: candidate.before.seller_profit === null && candidate.after.seller_profit === null,
    foreign_candidate_refused: foreign, restored_preview_refused: foreignPreview, original_unchanged: JSON.stringify(h.capture()) === beforeJson, owner_unchanged: h.owner.isCurrent(checkpoint), customer_review_kept: h.workflow.customerReviewed, no_application_backup: h.envelopeUi.applicationBackup() === null},
    {capture_sha256: hash(beforeJson), restored_sha256: hash(JSON.stringify(restored.capture)), wire_bytes: Buffer.byteLength(realWire), full_bytes: bytes(before), costs_applied: 0});
  const controller = h.envelopeUi.controller, original = controller.state().current!.raw_json; let complete!: (v: ArrayBuffer) => void;
  const reading = controller.openFile({arrayBuffer: () => new Promise<ArrayBuffer>(resolve => {complete = resolve;})}), active = controller.workbenchCapture(), readView = await realSession.capture(() => parts({read_token: active.read_token, reading: active.reading, raw: original})), readWire = realSession.encode(readView);
  controller.cancelRead(); const afterCancel = h.owner.checkpoint(); complete(new TextEncoder().encode(original).buffer); const installed = await reading;
  record('cancelled_controller', 'READ_ONLY', {late_not_installed: !installed, issued_expired: !realSession.isCurrent(readView), restored_not_issued: !realSession.isCurrent(decode(readWire)), exact_current_source: controller.state().current!.raw_json === original, no_pending_preview: controller.state().preview === null, owner_unchanged_after_cancel: h.owner.isCurrent(afterCancel)});
  must(JSON.stringify(cases.map(c => c.id)) === JSON.stringify(FEE_LAYERED_DIAGNOSTIC_CASES));
  return {cases, financial_writes: 0, import_authority: false, confirmation_authority: false, runtime_integrated: false, production_capacity_changed: false, timing_measured: false, browser_mapping_verified: false, physical_disk_io_verified: false, real_phone_verified: false, professional_review_verified: false};
}
