/** Development-only diagnostic codec. No runtime import, installation, confirmation or fee authority. */
import {createHash} from 'node:crypto';
import {copyFeeEnvelopeJson, parseFeeEnvelopeJson} from '../src/data/fee-envelope-json';
import {FEE_ENVELOPE_BYTES} from '../src/domain/fee-envelope';
import {projectedJsonBytes} from './fee-performance-size';

export const TEXT_SHARING_PROTOTYPE_LIMITS = Object.freeze({
  encoded_bytes: FEE_ENVELOPE_BYTES, expanded_json_bytes: FEE_ENVELOPE_BYTES,
  semantic_nodes: 300000, semantic_depth: 32, shared_texts: 4096, minimum_shared_utf8_bytes: 1024,
});
type Node = ['null'] | ['boolean', boolean] | ['number', number] | ['negative-zero'] | ['text', string] | ['ref', number] | ['array', number[]] | ['object', [string, number][]];
interface Document {
  kind: 'INTERNAL_FEE_TEXT_SHARING_PROTOTYPE'; version: '0.1';
  financial_writes: 0; import_authority: false; confirmation_authority: false;
  expanded_json_utf8_bytes: number; expanded_json_sha256: string; root: 0;
  texts: string[]; nodes: Node[];
}
export class FeeTextSharingPrototypeError extends Error {
  constructor(readonly code: string) {super('FEE_TEXT_SHARING_PROTOTYPE_' + code);}
}
const fail = (code: string): never => {throw new FeeTextSharingPrototypeError(code);};
const utf8 = (text: string) => Buffer.byteLength(text, 'utf8');
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const index = (value: unknown, length: number): value is number => Number.isInteger(value) && !Object.is(value, -0) && (value as number) >= 0 && (value as number) < length;

/** Original strict input guard runs first. It is deliberately not bypassed by text sharing. */
export function encodeFeeTextSharingPrototype(value: unknown): string {
  const plain = copyFeeEnvelopeJson(value), raw = JSON.stringify(plain);
  const texts: string[] = [], nodes: Node[] = [], ids = new Map<string, number>();
  const visit = (v: unknown): number => {
    const at = nodes.length; nodes.push(['null']);
    if (v === null) return at;
    if (typeof v === 'boolean') nodes[at] = ['boolean', v];
    else if (typeof v === 'number') nodes[at] = Object.is(v, -0) ? ['negative-zero'] : ['number', v];
    else if (typeof v === 'string') {
      if (utf8(v) < TEXT_SHARING_PROTOTYPE_LIMITS.minimum_shared_utf8_bytes) nodes[at] = ['text', v];
      else {
        let id = ids.get(v);
        if (id === undefined) {if (texts.length >= TEXT_SHARING_PROTOTYPE_LIMITS.shared_texts) fail('TEXT_LIMIT'); id = texts.length; ids.set(v, id); texts.push(v);}
        nodes[at] = ['ref', id];
      }
    } else if (Array.isArray(v)) nodes[at] = ['array', v.map(visit)];
    else nodes[at] = ['object', Object.entries(v as Record<string, unknown>).map(([key, child]): [string, number] => [key, visit(child)])];
    return at;
  };
  visit(plain);
  const doc: Document = {kind: 'INTERNAL_FEE_TEXT_SHARING_PROTOTYPE', version: '0.1', financial_writes: 0, import_authority: false, confirmation_authority: false,
    expanded_json_utf8_bytes: utf8(raw), expanded_json_sha256: digest(raw), root: 0, texts, nodes};
  const wire = JSON.stringify(doc);
  // The existing wire parser also imposes its original 300000 syntax-node and 32-depth limits.
  // Flat nodes keep wire depth bounded; some large semantic trees may hit the wire limit first.
  parseFeeEnvelopeJson(wire, TEXT_SHARING_PROTOTYPE_LIMITS.encoded_bytes);
  return wire;
}

/** Strict wire preflight before building restored objects; hashes establish content integrity only. */
export function decodeFeeTextSharingPrototype(wire: unknown): unknown {
  const parsed = parseFeeEnvelopeJson(wire, TEXT_SHARING_PROTOTYPE_LIMITS.encoded_bytes);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('HEADER');
  const doc = parsed as Record<string, unknown>;
  const fields = ['kind', 'version', 'financial_writes', 'import_authority', 'confirmation_authority', 'expanded_json_utf8_bytes', 'expanded_json_sha256', 'root', 'texts', 'nodes'];
  if (Object.keys(doc).sort().join('|') !== fields.sort().join('|') || doc.kind !== 'INTERNAL_FEE_TEXT_SHARING_PROTOTYPE' || doc.version !== '0.1' || doc.financial_writes !== 0 || doc.import_authority !== false || doc.confirmation_authority !== false || doc.root !== 0 || Object.is(doc.root, -0)) return fail('HEADER');
  if (!Number.isSafeInteger(doc.expanded_json_utf8_bytes) || (doc.expanded_json_utf8_bytes as number) < 1 || (doc.expanded_json_utf8_bytes as number) > TEXT_SHARING_PROTOTYPE_LIMITS.expanded_json_bytes || typeof doc.expanded_json_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(doc.expanded_json_sha256)) return fail('DECLARED_INTEGRITY');
  if (!Array.isArray(doc.texts) || doc.texts.length > TEXT_SHARING_PROTOTYPE_LIMITS.shared_texts || !Array.isArray(doc.nodes) || !doc.nodes.length || doc.nodes.length > TEXT_SHARING_PROTOTYPE_LIMITS.semantic_nodes) return fail('TABLE_LIMIT');
  const texts = doc.texts as unknown[], nodes = doc.nodes as unknown[], textSet = new Set<string>();
  for (const text of texts) {
    if (typeof text !== 'string' || utf8(text) < TEXT_SHARING_PROTOTYPE_LIMITS.minimum_shared_utf8_bytes) fail('TEXT_ENTRY');
    if (textSet.has(text as string)) fail('DUPLICATE_TEXT'); textSet.add(text as string);
  }
  const active = new Set<number>(), seen = new Set<number>(), usedTexts = new Set<number>(), stringSizes = new Map<string, number>();
  const stringSize = (text: string) => {let size = stringSizes.get(text); if (size === undefined) {size = projectedJsonBytes(text); stringSizes.set(text, size);} return size;};
  let nextNode = 0, nextText = 0;
  const bounded = (size: number) => {if (size > TEXT_SHARING_PROTOTYPE_LIMITS.expanded_json_bytes) return fail('EXPANDED_LIMIT'); return size;};
  const walk = (id: unknown, depth: number): number => {
    if (!index(id, nodes.length)) return fail('NODE_REFERENCE');
    if (active.has(id)) return fail('REFERENCE_CYCLE');
    if (seen.has(id)) return fail('NODE_ALIAS');
    if (id !== nextNode++) return fail('NODE_ORDER');
    if (depth > TEXT_SHARING_PROTOTYPE_LIMITS.semantic_depth) return fail('DEPTH');
    seen.add(id); active.add(id);
    const node = nodes[id];
    if (!Array.isArray(node) || typeof node[0] !== 'string') return fail('NODE_SHAPE');
    const tag = node[0]; let size: number;
    if (tag === 'null' || tag === 'negative-zero') {if (node.length !== 1) return fail('NODE_SHAPE'); size = tag === 'null' ? 4 : 1;}
    else {
      if (node.length !== 2) return fail('NODE_SHAPE'); const value = node[1];
      if (tag === 'boolean') {if (typeof value !== 'boolean') return fail('NODE_SHAPE'); size = value ? 4 : 5;}
      else if (tag === 'number') {if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) return fail('NODE_SHAPE'); size = String(value).length;}
      else if (tag === 'text') {if (typeof value !== 'string' || utf8(value) >= TEXT_SHARING_PROTOTYPE_LIMITS.minimum_shared_utf8_bytes) return fail('TEXT_ENTRY'); size = stringSize(value);}
      else if (tag === 'ref') {
        if (!index(value, texts.length)) return fail('TEXT_REFERENCE');
        if (!usedTexts.has(value)) {if (value !== nextText++) return fail('TEXT_ORDER'); usedTexts.add(value);}
        size = stringSize(texts[value] as string);
      } else if (tag === 'array') {
        if (!Array.isArray(value)) return fail('NODE_SHAPE'); size = 2 + Math.max(0, value.length - 1);
        for (const child of value) size = bounded(size + walk(child, depth + 1));
      } else if (tag === 'object') {
        if (!Array.isArray(value)) return fail('NODE_SHAPE'); const keys = new Set<string>(); size = 2 + Math.max(0, value.length - 1);
        for (const pair of value) {
          if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string') return fail('OBJECT_ENTRY');
          if (keys.has(pair[0])) return fail('DUPLICATE_KEY'); keys.add(pair[0]);
          size = bounded(size + stringSize(pair[0]) + 1 + walk(pair[1], depth + 1));
        }
      } else return fail('NODE_TAG');
    }
    active.delete(id); return bounded(size);
  };
  const expanded = walk(doc.root, 0);
  if (seen.size !== nodes.length) return fail('UNREACHABLE_NODE');
  if (usedTexts.size !== texts.length) return fail('UNUSED_TEXT');
  if (expanded !== doc.expanded_json_utf8_bytes) return fail('SIZE_MISMATCH');
  // All references, cycles, aliases, depth and expanded bytes have been checked above.
  const restore = (id: number): unknown => {
    const node = nodes[id] as Node;
    switch (node[0]) {
      case 'null': return null;
      case 'negative-zero': return -0;
      case 'boolean': case 'number': case 'text': return node[1];
      case 'ref': return texts[node[1]];
      case 'array': return node[1].map(restore);
      case 'object': return Object.fromEntries(node[1].map(([key, child]) => [key, restore(child)]));
    }
  };
  const result = restore(0), raw = JSON.stringify(result);
  if (utf8(raw) !== expanded || digest(raw) !== doc.expanded_json_sha256) return fail('DIGEST_MISMATCH');
  return result;
}
