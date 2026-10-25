/** Independent browser implementation of diagnostic wire0.1. Original Node codec stays an unchanged oracle.
 * Deliberately mirrors the wire grammar; shared strict JSON and capture validation remain authoritative.
 * No source transforms, Node APIs, installation, persistence or financial authority. */
import {FEE_ENVELOPE_BYTES} from '../src/domain/fee-envelope';
import {parseFeeEnvelopeJson} from '../src/data/fee-envelope-json';
import {projectFeeSemanticCapture} from '../src/ui/fee-workbench-semantic-capture';
import type {RuntimeFeeWorkbenchCapture} from '../src/ui/fee-workbench-preview';
import type {FeeBrowserCaptureCodec} from './fee-browser-capture-contract';

export const FEE_LAYERED_CAPTURE_LIMITS = Object.freeze({semantic_bytes: FEE_ENVELOPE_BYTES, semantic_nodes: 300000,
  semantic_depth: 32, encoded_bytes: FEE_ENVELOPE_BYTES, text_entries: 4096, shared_text_min_bytes: 1024, chunk_nodes: 512});
export type FeeLayeredRetainedFormat = 'COMPACT' | 'PRETTY_LF';
export interface FeeLayeredCaptureParts {
  retained_root: unknown;
  capture_shell: Omit<RuntimeFeeWorkbenchCapture, 'retained_json'>;
  retained_format: FeeLayeredRetainedFormat;
}
type Node = ['null'] | ['negative-zero'] | ['boolean', boolean] | ['number', number] | ['text', string] |
  ['text-ref', number] | ['array', number] | ['object', string];
interface Metrics {compact: number; pretty: number; escapedCompact: number; escapedPretty: number}
interface RootSummary {compact_utf8_bytes: number; nodes: number; root_zero_depth: number}
interface Summary {retained: RootSummary; capture: RootSummary; retained_text_utf8_bytes: number}
export interface FeeLayeredCapturePacket {
  readonly kind: 'INTERNAL_FEE_LAYERED_CAPTURE_PROTOTYPE'; readonly version: '0.1';
  readonly financial_writes: 0; readonly import_authority: false; readonly confirmation_authority: false; readonly runtime_integrated: false;
  readonly retained_format: FeeLayeredRetainedFormat; readonly retained_nodes: number;
  readonly texts: readonly string[]; readonly chunks: readonly string[]; readonly summary: Summary;
  readonly retained_sha256: string; readonly capture_sha256: string;
}
export interface FeeLayeredCaptureRestoration {
  readonly kind: 'INTERNAL_FEE_LAYERED_CAPTURE_RESTORATION'; readonly version: '0.1';
  readonly financial_writes: 0; readonly import_authority: false; readonly confirmation_authority: false; readonly runtime_integrated: false;
  readonly retained_root: unknown; readonly capture: RuntimeFeeWorkbenchCapture;
}
export class FeeBrowserNativeCodecError extends Error {
  constructor(readonly code: string) {super('FEE_BROWSER_NATIVE_CODEC_' + code);}
}
function fail(code: string): never {throw new FeeBrowserNativeCodecError(code);}
/** Strict UTF-8 count without allocating a second complete byte array. */
export function feeBrowserNativeUtf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) fail('UNICODE'); bytes += 4;
    } else {if (code >= 0xdc00 && code <= 0xdfff) fail('UNICODE'); bytes += 3;}
  }
  return bytes;
}
function current(signal: AbortSignal): void {if (signal.aborted) fail('CANCELLED');}
async function sha(text: string, signal: AbortSignal): Promise<string> {
  current(signal);
  if (!globalThis.crypto?.subtle) fail('CRYPTO_UNAVAILABLE');
  let digest: ArrayBuffer;
  try {digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));}
  catch {current(signal); return fail('CRYPTO_FAILED');} // Never inspect external exceptions or abort reasons.
  current(signal);
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}
const count = (v: unknown, maximum: number): v is number => Number.isSafeInteger(v) && !Object.is(v, -0) && (v as number) >= 0 && (v as number) <= maximum;
const format = (v: unknown): v is FeeLayeredRetainedFormat => v === 'COMPACT' || v === 'PRETTY_LF';
const shellKeys = ['scope', 'envelope_json', 'sources', 'fx', 'files', 'editors', 'activity', 'blockers'];
function freeze<T>(value: T): T {if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);} return value;}
function own(value: unknown, expected?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail('OBJECT');
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.some(k => typeof k !== 'string' || !descriptors[k]?.enumerable || !('value' in descriptors[k]!)) ||
    expected && (keys.length !== expected.length || expected.some(k => !Object.hasOwn(descriptors, k)))) return fail('FIELDS');
  return Object.fromEntries(keys.map(k => [k, descriptors[k as string]!.value]));
}
/** Sizes of a JSON string token, and of that token escaped once more as opaque retained text. */
function textMetrics(text: string): Metrics {
  const bytes = feeBrowserNativeUtf8Bytes(text); let compact = bytes + 2, escaped = bytes + 4;
  for (const match of text.matchAll(/["\\\u0000-\u001f\ud800-\udfff]/g)) {
    const i = match.index, code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {if (!(text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff)) fail('UNICODE'); continue;}
    if (code >= 0xdc00 && code <= 0xdfff) {if (!(text.charCodeAt(i - 1) >= 0xd800 && text.charCodeAt(i - 1) <= 0xdbff)) fail('UNICODE'); continue;}
    if (code === 34 || code === 92) {compact++; escaped += 3;}
    else if ([8, 9, 10, 12, 13].includes(code)) {compact++; escaped += 2;}
    else {compact += 5; escaped += 6;}
  }
  return {compact, pretty: compact, escapedCompact: escaped, escapedPretty: escaped};
}
const scalarMetrics = (size: number): Metrics => ({compact: size, pretty: size, escapedCompact: size, escapedPretty: size});
function containerMetrics(children: readonly Metrics[], keys: readonly string[] | null, depth: number, metric: (s: string) => Metrics): Metrics {
  const n = children.length, punctuation = 2 + Math.max(0, n - 1), indentation = n ? 2 * ((depth + 1) * n + depth) : 0;
  const result = {compact: punctuation, pretty: punctuation + indentation + (n ? n + 1 : 0),
    escapedCompact: punctuation, escapedPretty: punctuation + indentation + (n ? 2 * (n + 1) : 0)};
  children.forEach((child, i) => {
    const k = keys ? metric(keys[i]!) : scalarMetrics(0);
    result.compact += child.compact + k.compact + (keys ? 1 : 0);
    result.pretty += child.pretty + k.pretty + (keys ? 2 : 0);
    result.escapedCompact += child.escapedCompact + k.escapedCompact + (keys ? 1 : 0);
    result.escapedPretty += child.escapedPretty + k.escapedPretty + (keys ? 2 : 0);
  });
  return result;
}
/** Structural containers are expanded, never referenced. Only complete immutable string leaves may share. */
function forest(parts: FeeLayeredCaptureParts) {
  const nodes: Node[] = [], texts: string[] = [], ids = new Map<string, number>(), parents = new Set<object>();
  let semanticNodes = 0;
  const visit = (value: unknown, depth: number): void => {
    if (++semanticNodes > FEE_LAYERED_CAPTURE_LIMITS.semantic_nodes || depth > FEE_LAYERED_CAPTURE_LIMITS.semantic_depth) fail('SEMANTIC_LIMIT');
    if (value === null) {nodes.push(['null']); return;}
    if (typeof value === 'boolean') {nodes.push(['boolean', value]); return;}
    if (typeof value === 'number') {if (!Number.isFinite(value)) fail('NUMBER'); nodes.push(Object.is(value, -0) ? ['negative-zero'] : ['number', value]); return;}
    if (typeof value === 'string') {
      textMetrics(value);
      if (feeBrowserNativeUtf8Bytes(value) < FEE_LAYERED_CAPTURE_LIMITS.shared_text_min_bytes) nodes.push(['text', value]);
      else {let id = ids.get(value); if (id === undefined) {if (texts.length >= FEE_LAYERED_CAPTURE_LIMITS.text_entries) fail('TEXT_LIMIT'); id = texts.length; ids.set(value, id); texts.push(value);} nodes.push(['text-ref', id]);}
      return;
    }
    if (!value || typeof value !== 'object' || parents.has(value)) return fail('DATA_OR_CYCLE');
    parents.add(value); const ds = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(ds);
    if (keys.some(k => typeof k !== 'string')) fail('FIELDS');
    if (Array.isArray(value)) {
      const length = ds.length?.value;
      if (Object.getPrototypeOf(value) !== Array.prototype || !count(length, 300000) || keys.length !== length + 1) fail('ARRAY');
      nodes.push(['array', length]);
      for (let i = 0; i < length; i++) {const d = ds[String(i)]; if (!d?.enumerable || !('value' in d)) fail('FIELDS'); visit(d.value, depth + 1);}
    } else {
      const fields = own(value), names = Object.keys(fields); names.forEach(textMetrics);
      nodes.push(['object', JSON.stringify(names)]); names.forEach(k => visit(fields[k], depth + 1));
    }
    parents.delete(value);
  };
  visit(parts.retained_root, 0); const retainedNodes = nodes.length;
  semanticNodes = 0; visit(parts.capture_shell, 0);
  return {nodes, texts, retainedNodes};
}
function inspect(nodes: readonly unknown[], texts: readonly unknown[], retainedNodes: number, retainedFormat: FeeLayeredRetainedFormat) {
  if (!count(retainedNodes, 300000) || !retainedNodes || nodes.length > 600000 || texts.length > 4096) fail('TABLE_LIMIT');
  const unique = new Set<string>();
  for (const t of texts) {if (typeof t !== 'string' || feeBrowserNativeUtf8Bytes(t) < 1024) fail('TEXT_ENTRY'); textMetrics(t); if (unique.has(t)) fail('DUPLICATE_TEXT'); unique.add(t);}
  const used = new Set<number>(), cache = new Map<string, Metrics>(), names = new Map<number, string[]>(); let at = 0, rootNodes = 0, rootDepth = 0;
  const metric = (s: string) => {let m = cache.get(s); if (!m) {m = textMetrics(s); if (s.length >= 512 && cache.size < 4096) cache.set(s, m);} return m;};
  const walk = (depth: number): Metrics => {
    if (++rootNodes > 300000 || depth > 32) fail('SEMANTIC_LIMIT'); rootDepth = Math.max(rootDepth, depth);
    const id = at++, node = nodes[id];
    if (!Array.isArray(node) || !node.length) return fail('NODE_SHAPE');
    const tag = node[0]; let m: Metrics;
    if (tag === 'null' || tag === 'negative-zero') {if (node.length !== 1) fail('NODE_SHAPE'); m = scalarMetrics(tag === 'null' ? 4 : 1);}
    else {
      if (node.length !== 2) fail('NODE_SHAPE'); const v: unknown = node[1];
      if (tag === 'boolean') {if (typeof v !== 'boolean') fail('NODE_SHAPE'); m = scalarMetrics(v ? 4 : 5);}
      else if (tag === 'number') {if (typeof v !== 'number' || !Number.isFinite(v) || Object.is(v, -0)) fail('NODE_SHAPE'); m = scalarMetrics(String(v).length);}
      else if (tag === 'text') {if (typeof v !== 'string' || feeBrowserNativeUtf8Bytes(v) >= 1024) fail('TEXT_ENTRY'); m = metric(v);}
      else if (tag === 'text-ref') {
        if (!count(v, texts.length - 1)) fail('TEXT_REFERENCE');
        if (!used.has(v)) {if (v !== used.size) fail('TEXT_ORDER'); used.add(v);} m = metric(texts[v] as string);
      } else if (tag === 'array' || tag === 'object') {
        let keys: string[] | null = null, length: number;
        if (tag === 'array') {if (!count(v, 300000)) fail('NODE_SHAPE'); length = v;}
        else {
          if (typeof v !== 'string') fail('KEYS'); const parsed = parseFeeEnvelopeJson(v);
          if (!Array.isArray(parsed) || parsed.some(k => typeof k !== 'string') || new Set(parsed).size !== parsed.length) fail('KEYS');
          keys = parsed as string[]; length = keys.length;
          if (JSON.stringify(Object.keys(Object.fromEntries(keys.map(k => [k, null])))) !== JSON.stringify(keys)) fail('KEY_ORDER'); names.set(id, keys);
        }
        if (length > 300000 - rootNodes || length > nodes.length - at) fail('SEMANTIC_LIMIT');
        const children = Array.from({length}, () => walk(depth + 1)); m = containerMetrics(children, keys, depth, metric);
      } else return fail('NODE_TAG');
    }
    if (m.compact > FEE_ENVELOPE_BYTES) fail('ROOT_BYTES'); return m;
  };
  const retained = walk(0), retainedSummary = {compact_utf8_bytes: retained.compact, nodes: rootNodes, root_zero_depth: rootDepth};
  if (at !== retainedNodes) fail('ROOT_BOUNDARY'); rootNodes = 0; rootDepth = 0;
  const shell = walk(0), shellCount = rootNodes, shellDepth = rootDepth;
  if (at !== nodes.length) fail('UNREACHABLE_NODE'); if (used.size !== texts.length) fail('UNUSED_TEXT');
  const shellNames = names.get(retainedNodes); if (!shellNames || JSON.stringify(shellNames) !== JSON.stringify(shellKeys)) fail('CAPTURE_SHELL');
  const retainedTextBytes = retainedFormat === 'COMPACT' ? retained.compact : retained.pretty + 1;
  const escaped = retainedFormat === 'COMPACT' ? retained.escapedCompact : retained.escapedPretty + 2;
  const full = shell.compact + 1 + textMetrics('retained_json').compact + 1 + escaped + 2;
  if (retainedTextBytes > FEE_ENVELOPE_BYTES) fail('RETAINED_TEXT_BYTES');
  if (full > FEE_ENVELOPE_BYTES) fail('CAPTURE_BYTES'); if (shellCount + 1 > 300000) fail('SEMANTIC_LIMIT');
  const summary: Summary = {retained: retainedSummary, capture: {compact_utf8_bytes: full, nodes: shellCount + 1, root_zero_depth: Math.max(1, shellDepth)}, retained_text_utf8_bytes: retainedTextBytes};
  const restore = (index: {at: number}): unknown => {
    const id = index.at++, node = nodes[id] as Node;
    switch (node[0]) {
      case 'null': return null; case 'negative-zero': return -0;
      case 'number': case 'boolean': case 'text': return node[1]; case 'text-ref': return texts[node[1]];
      case 'array': return Array.from({length: node[1]}, () => restore(index));
      case 'object': return Object.fromEntries(names.get(id)!.map(k => [k, restore(index)]));
    }
  };
  return {summary, materialize: () => {
    // Materialization begins only after both logical roots and the reconstructed complete capture pass preflight.
    const cursor = {at: 0}, retainedRoot = restore(cursor), shellRoot = restore(cursor) as FeeLayeredCaptureParts['capture_shell'];
    const retainedJson = retainedFormat === 'COMPACT' ? JSON.stringify(retainedRoot) : JSON.stringify(retainedRoot, null, 2) + '\n';
    const {blockers, ...beforeRetained} = shellRoot;
    const capture = projectFeeSemanticCapture({kind: 'INTERNAL_FEE_WORKBENCH_SEMANTIC_CAPTURE', version: '0.2', financial_writes: 0, import_authority: false, confirmation_authority: false,
      capture: {...beforeRetained, retained_json: retainedJson, blockers}});
    const raw = JSON.stringify(capture);
    if (feeBrowserNativeUtf8Bytes(retainedJson) !== retainedTextBytes || feeBrowserNativeUtf8Bytes(raw) !== full) fail('PREFLIGHT_MISMATCH');
    return {retainedRoot, capture, retainedJson, raw};
  }};
}
async function packet(input: FeeLayeredCaptureParts, signal: AbortSignal): Promise<FeeLayeredCapturePacket> {
  const parts = own(input, ['retained_root', 'capture_shell', 'retained_format']); if (!format(parts.retained_format)) fail('FORMAT');
  const tree = forest(parts as unknown as FeeLayeredCaptureParts), checked = inspect(tree.nodes, tree.texts, tree.retainedNodes, parts.retained_format), restored = checked.materialize();
  current(signal);
  // Both roots have been fully validated and detached synchronously before this first yield.
  const retainedSha = await sha(restored.retainedJson, signal), captureSha = await sha(restored.raw, signal);
  const chunks: string[] = [];
  for (let i = 0; i < tree.nodes.length; i += 512) {const chunk = JSON.stringify(tree.nodes.slice(i, i + 512)); parseFeeEnvelopeJson(chunk); chunks.push(chunk);}
  const value: FeeLayeredCapturePacket = {kind: 'INTERNAL_FEE_LAYERED_CAPTURE_PROTOTYPE', version: '0.1', financial_writes: 0, import_authority: false, confirmation_authority: false, runtime_integrated: false,
    retained_format: parts.retained_format, retained_nodes: tree.retainedNodes, texts: tree.texts, chunks, summary: checked.summary, retained_sha256: retainedSha, capture_sha256: captureSha};
  if (validatedJsonBytes(value) > FEE_LAYERED_CAPTURE_LIMITS.encoded_bytes) fail('ENCODED_BYTES');
  return freeze(value);
}
/** Counts only: not a valid-source, transport-acceptance, freshness or transaction-readiness result. */
export function inspectFeeBrowserNativeCaptureBudget(input: FeeLayeredCaptureParts): Readonly<Summary> {
  const parts = own(input, ['retained_root', 'capture_shell', 'retained_format']); if (!format(parts.retained_format)) fail('FORMAT');
  const tree = forest(parts as unknown as FeeLayeredCaptureParts); return freeze(inspect(tree.nodes, tree.texts, tree.retainedNodes, parts.retained_format).summary);
}
/** Content integrity and diagnostic restoration only. No private issued identity is reconstructed. */
async function restore(wire: unknown, signal: AbortSignal): Promise<FeeLayeredCaptureRestoration> {
  const d = own(parseFeeEnvelopeJson(wire), ['kind', 'version', 'financial_writes', 'import_authority', 'confirmation_authority', 'runtime_integrated', 'retained_format', 'retained_nodes', 'texts', 'chunks', 'summary', 'retained_sha256', 'capture_sha256']);
  if (d.kind !== 'INTERNAL_FEE_LAYERED_CAPTURE_PROTOTYPE' || d.version !== '0.1' || d.financial_writes !== 0 || d.import_authority !== false || d.confirmation_authority !== false || d.runtime_integrated !== false || !format(d.retained_format)) fail('HEADER');
  if (!Array.isArray(d.texts) || d.texts.length > 4096 || !Array.isArray(d.chunks) || !d.chunks.length || d.chunks.length > Math.ceil(600000 / 512) || !count(d.retained_nodes, 300000)) fail('TABLE_LIMIT');
  const nodes: unknown[] = [], chunks = d.chunks;
  chunks.forEach((chunk, i) => {const rows = parseFeeEnvelopeJson(chunk); if (!Array.isArray(rows) || !rows.length || rows.length > 512 || i < chunks.length - 1 && rows.length !== 512) fail('CHUNK'); nodes.push(...rows);});
  const checked = inspect(nodes, d.texts, d.retained_nodes, d.retained_format);
  if (JSON.stringify(d.summary) !== JSON.stringify(checked.summary)) fail('SUMMARY');
  const restored = checked.materialize();
  current(signal);
  const retainedSha = await sha(restored.retainedJson, signal), captureSha = await sha(restored.raw, signal);
  if (d.retained_sha256 !== retainedSha || d.capture_sha256 !== captureSha) fail('DIGEST');
  return freeze({kind: 'INTERNAL_FEE_LAYERED_CAPTURE_RESTORATION', version: '0.1', financial_writes: 0, import_authority: false, confirmation_authority: false, runtime_integrated: false,
    retained_root: restored.retainedRoot, capture: restored.capture});
}

/** Only validated internal packet values reach this counter; no user callbacks or coercion. */
function validatedJsonBytes(value: unknown): number {
  if (value === null) return 4;
  if (typeof value === 'string') return textMetrics(value).compact;
  if (typeof value === 'boolean') return value ? 4 : 5;
  if (typeof value === 'number') return String(value).length;
  if (Array.isArray(value)) return 2 + Math.max(0, value.length - 1) + value.reduce((sum: number, v: unknown) => sum + validatedJsonBytes(v), 0);
  const entries = Object.entries(value as Record<string, unknown>);
  return 2 + Math.max(0, entries.length - 1) + entries.reduce((sum, [k, v]) => sum + textMetrics(k).compact + 1 + validatedJsonBytes(v), 0);
}

/** One active encode OR decode per instance, no pending queue. A cancelled in-flight digest retains the slot
 * until it actually settles. The external capture contract rejects promptly; WebCrypto is not physically aborted.
 * Reuse the same instance for a workbench. Separate instances are independent resource owners. */
export class FeeBrowserNativeCodec implements FeeBrowserCaptureCodec {
  private busy = false;
  state(): 'IDLE' | 'WORKING' {return this.busy ? 'WORKING' : 'IDLE';}
  private async run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    current(signal); if (this.busy) fail('BUSY'); this.busy = true;
    try {const result = await work(); current(signal); return result;}
    finally {this.busy = false;}
  }
  encode(parts: FeeLayeredCaptureParts, signal: AbortSignal): Promise<string> {
    return this.run(signal, async () => JSON.stringify(await packet(parts, signal)));
  }
  decode(wire: string, signal: AbortSignal): Promise<FeeLayeredCaptureRestoration> {
    return this.run(signal, () => restore(wire, signal));
  }
}
/** Diagnostic harness convenience functions share one slot; callers using the contract should pass this instance. */
export const feeBrowserNativeCodec = new FeeBrowserNativeCodec();
export const encodeFeeBrowserNativeCapture = (parts: FeeLayeredCaptureParts, signal = new AbortController().signal): Promise<string> => feeBrowserNativeCodec.encode(parts, signal);
export const decodeFeeBrowserNativeCapture = (wire: string, signal = new AbortController().signal): Promise<FeeLayeredCaptureRestoration> => feeBrowserNativeCodec.decode(wire, signal);
