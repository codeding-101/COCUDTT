/** Independent developer prototype. No application, import, storage, save or confirmation API. */
import {copyFeeEnvelopeJson} from '../src/data/fee-envelope-json';
import {FEE_ENVELOPE_BYTES} from '../src/domain/fee-envelope';
import {WorkbenchStateOwner, type WorkbenchCheckpoint} from '../src/ui/workbench-state';
import {encodeFeeTextSharingPrototype, decodeFeeTextSharingPrototype} from './fee-text-sharing-prototype';
import {projectedJsonBytes} from './fee-performance-size';

export const FEE_SOURCE_VIEW_PRODUCERS = Object.freeze([
  'project', 'workflow', 'bill', 'pair', 'attachment', 'precision', 'envelope',
  'attachment_workspace', 'precision_workspace', 'envelope_workspace',
] as const);
export type FeeSourceViewProducer = typeof FEE_SOURCE_VIEW_PRODUCERS[number];
type Json = null | boolean | number | string | readonly Json[] | {readonly [key: string]: Json};
export interface FeeSourceViewReader {readonly producer: FeeSourceViewProducer; readonly read: () => unknown}
export interface FeeSourceViewDocument {
  readonly kind: 'INTERNAL_FEE_SOURCE_VIEWS_PROTOTYPE'; readonly version: '0.1';
  readonly financial_writes: 0; readonly import_authority: false; readonly confirmation_authority: false;
  readonly runtime_integrated: false;
  readonly producers: readonly {readonly producer: FeeSourceViewProducer; readonly value: Json}[];
}
export const FEE_SOURCE_VIEW_LIMITS = Object.freeze({
  producer_json_bytes: FEE_ENVELOPE_BYTES, logical_graph_json_bytes: FEE_ENVELOPE_BYTES,
  encoded_bytes: FEE_ENVELOPE_BYTES, producers: FEE_SOURCE_VIEW_PRODUCERS.length,
});
const fail = (code: string): never => {throw Error('FEE_SOURCE_VIEW_PROTOTYPE_' + code);};
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);}
  return value;
}
function fields(value: object, expected: string[]): boolean {
  return Object.keys(value).sort().join('|') === [...expected].sort().join('|');
}
/** Trusted producer callbacks only. Inspect specifications without executing getters. */
function readers(input: readonly FeeSourceViewReader[]): (() => unknown)[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length !== FEE_SOURCE_VIEW_PRODUCERS.length) return fail('PRODUCERS');
  const list = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(list).length !== input.length + 1) return fail('PRODUCERS');
  return FEE_SOURCE_VIEW_PRODUCERS.map((producer, i) => {
    const item = list[String(i)];
    if (!item?.enumerable || !('value' in item) || !item.value || typeof item.value !== 'object') return fail('PRODUCERS');
    const spec = Object.getOwnPropertyDescriptors(item.value);
    if (![Object.prototype, null].includes(Object.getPrototypeOf(item.value)) || Reflect.ownKeys(spec).length !== 2 || !spec.producer?.enumerable || !('value' in spec.producer) || spec.producer.value !== producer || !spec.read?.enumerable || !('value' in spec.read) || typeof spec.read.value !== 'function') return fail('PRODUCERS');
    return spec.read.value as () => unknown;
  });
}
/** Private freshness belongs to this session and the existing owner, never to JSON or a digest. */
export class FeeSourceViewPrototype {
  private readonly issued = new WeakMap<object, WorkbenchCheckpoint>();
  constructor(private readonly owner: WorkbenchStateOwner) {}
  capture(input: readonly FeeSourceViewReader[]): FeeSourceViewDocument {
    const token = this.owner.checkpoint(), callbacks = readers(input), producers: {producer: FeeSourceViewProducer; value: Json}[] = [];
    for (let i = 0; i < callbacks.length; i++) {
      if (!this.owner.isCurrent(token)) return fail('STALE');
      // Each producer returns explicit JSON state; opaque strings are never parsed here.
      const value = copyFeeEnvelopeJson(callbacks[i]!()) as Json;
      if (!this.owner.isCurrent(token)) return fail('STALE');
      producers.push({producer: FEE_SOURCE_VIEW_PRODUCERS[i]!, value});
      if (projectedJsonBytes(producers) > FEE_SOURCE_VIEW_LIMITS.logical_graph_json_bytes) return fail('LOGICAL_BUDGET');
    }
    const document = freeze(copyFeeEnvelopeJson({kind: 'INTERNAL_FEE_SOURCE_VIEWS_PROTOTYPE', version: '0.1',
      financial_writes: 0, import_authority: false, confirmation_authority: false, runtime_integrated: false, producers}) as FeeSourceViewDocument);
    if (!this.owner.isCurrent(token)) return fail('STALE');
    this.issued.set(document, token); return document;
  }
  isCurrent(value: unknown): value is FeeSourceViewDocument {
    if (!value || typeof value !== 'object') return false;
    const token = this.issued.get(value); return token !== undefined && this.owner.isCurrent(token);
  }
  encode(value: FeeSourceViewDocument): string {
    if (!this.isCurrent(value)) return fail('FOREIGN_OR_STALE');
    const wire = encodeFeeTextSharingPrototype(value);
    if (!this.isCurrent(value)) return fail('STALE');
    return wire;
  }
}
/** Restores diagnostic data only. No private issued view or runtime checkpoint is reconstructed. */
export function decodeFeeSourceViewPrototype(wire: unknown): FeeSourceViewDocument {
  const value = decodeFeeTextSharingPrototype(wire);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('DOCUMENT');
  const doc = value as Record<string, unknown>;
  if (!fields(doc, ['kind', 'version', 'financial_writes', 'import_authority', 'confirmation_authority', 'runtime_integrated', 'producers']) || doc.kind !== 'INTERNAL_FEE_SOURCE_VIEWS_PROTOTYPE' || doc.version !== '0.1' || doc.financial_writes !== 0 || doc.import_authority !== false || doc.confirmation_authority !== false || doc.runtime_integrated !== false || !Array.isArray(doc.producers) || doc.producers.length !== FEE_SOURCE_VIEW_PRODUCERS.length) return fail('DOCUMENT');
  for (let i = 0; i < doc.producers.length; i++) {
    const item = doc.producers[i];
    if (!item || typeof item !== 'object' || Array.isArray(item) || !fields(item, ['producer', 'value']) || item.producer !== FEE_SOURCE_VIEW_PRODUCERS[i]) return fail('PRODUCERS');
  }
  return freeze(value as FeeSourceViewDocument);
}
