/** Observation only: current production remains the oracle; a smaller wire does not confer readiness. */
import {parseFeeEnvelopeJson} from '../src/data/fee-envelope-json';
import type {FeeSourceReaders} from '../src/ui/fee-workbench-source-readers';
import type {RuntimeFeeWorkbenchCapture} from '../src/ui/fee-workbench-preview';
import type {WorkbenchStateOwner} from '../src/ui/workbench-state';
import {readFeeLayeredWorkbenchRoots} from './fee-layered-source-mapping';
import {encodeFeeBrowserNativeCapture as encode, decodeFeeBrowserNativeCapture as decode} from './fee-browser-native-codec';
type Observation = {status: 'ACCEPTED' | 'REJECTED' | 'NOT_RUN'; reason: string | null};
function reason(error: unknown): string {
  if (error && typeof error === 'object') {const d = Object.getOwnPropertyDescriptor(error, 'message'); if (d && 'value' in d && typeof d.value === 'string' && /^(?:FEE_ENVELOPE_INVALID:(?:STRICT_JSON|UTF8_SIZE)|FEE_SEMANTIC_BUDGET_(?:INVALID|STALE)|FEE_LAYERED_SOURCE_MAPPING_(?:INVALID|STALE)|FEE_BROWSER_NATIVE_CODEC_[A-Z_]+)$/.test(d.value)) return d.value;}
  return 'SOURCE_READER_REJECTED';
}
export async function inspectFeeBrowserNativeMapping(owner: WorkbenchStateOwner, readLegacy: () => RuntimeFeeWorkbenchCapture, readers: FeeSourceReaders, production: () => RuntimeFeeWorkbenchCapture) {
  const checkpoint = owner.checkpoint(), skipped = (): Observation => ({status: 'NOT_RUN', reason: null});
  const out = {kind: 'INTERNAL_FEE_LAYERED_SOURCE_DIAGNOSTIC' as const, version: '0.1' as const, legacy_capture: skipped(), retained_parse: skipped(), production_capture: skipped(), source_mapping: skipped(), protocol_encoding: skipped(), reconstruction: skipped(),
    full_capture_equal: null as boolean | null, legacy_capture_equal: null as boolean | null, acceptance_equal: false, owner_unchanged: true,
    production_action: 'KEEP_CURRENT_CAPTURE' as const, runtime_integrated: false as const, application_readiness: 'NOT_TESTED' as const, financial_writes: 0 as const, import_authority: false as const, confirmation_authority: false as const};
  const current = () => out.owner_unchanged = owner.isCurrent(checkpoint);
  const observe = <T>(field: 'legacy_capture' | 'retained_parse' | 'production_capture' | 'source_mapping', task: () => T): {value: T} | null => {
    if (!current()) return null; try {const value = task(); out[field] = {status: 'ACCEPTED', reason: null}; return {value};} catch (error) {out[field] = {status: 'REJECTED', reason: reason(error)}; return null;}
  };
  const legacy = observe('legacy_capture', readLegacy); if (legacy) observe('retained_parse', () => parseFeeEnvelopeJson(legacy.value.retained_json));
  const actual = observe('production_capture', production), mapped = observe('source_mapping', () => readFeeLayeredWorkbenchRoots(owner, readers));
  let wire: string | null = null, restored: Awaited<ReturnType<typeof decode>> | null = null;
  if (mapped && current()) {try {wire = await encode(mapped.value); out.protocol_encoding = {status: 'ACCEPTED', reason: null};} catch (error) {out.protocol_encoding = {status: 'REJECTED', reason: reason(error)};}}
  if (wire !== null && current()) {try {restored = await decode(wire); out.reconstruction = {status: 'ACCEPTED', reason: null};} catch (error) {out.reconstruction = {status: 'REJECTED', reason: reason(error)};}}
  if (current()) {
    out.acceptance_equal = (actual !== null) === (restored !== null);
    if (actual && restored) out.full_capture_equal = JSON.stringify(actual.value) === JSON.stringify(restored.capture);
    if (legacy && restored && out.retained_parse.status === 'ACCEPTED') out.legacy_capture_equal = JSON.stringify(legacy.value) === JSON.stringify(restored.capture);
  }
  for (const k of ['legacy_capture','retained_parse','production_capture','source_mapping','protocol_encoding','reconstruction'] as const) Object.freeze(out[k]);
  return Object.freeze(out);
}
