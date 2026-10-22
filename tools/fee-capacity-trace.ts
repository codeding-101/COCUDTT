/** Test-server observation only. These counters neither validate nor authorize business input. */
export interface JsonShape {compact_utf8_bytes: number; nodes: number; root_zero_depth: number}
export function ordinaryJsonShape(value: unknown): JsonShape {
  const parents = new Set<object>(), strings = new Map<string, number>();
  let nodes = 0, deepest = 0;
  const fail = (): never => {throw Error('CAPACITY_SHAPE_JSON_ONLY');};
  const stringBytes = (s: string): number => {
    const cached = strings.get(s); if (cached !== undefined) return cached;
    let size = 2;
    for (let i = 0; i < s.length; i++) {
      const n = s.charCodeAt(i);
      if (n === 34 || n === 92) size += 2;
      else if (n < 32) size += [8, 9, 10, 12, 13].includes(n) ? 2 : 6;
      else if (n < 128) size++;
      else if (n < 2048) size += 2;
      else if (n >= 0xd800 && n <= 0xdbff && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) {size += 4; i++;}
      else size += n >= 0xd800 && n <= 0xdfff ? 6 : 3;
    }
    strings.set(s, size); return size;
  };
  const visit = (v: unknown, depth: number): number => {
    nodes++; deepest = Math.max(deepest, depth);
    if (depth > 256 || !Number.isSafeInteger(nodes)) return fail();
    if (v === null) return 4;
    if (typeof v === 'string') return stringBytes(v);
    if (typeof v === 'boolean') return v ? 4 : 5;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v).length;
    if (!v || typeof v !== 'object' || parents.has(v)) return fail();
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(descriptors);
    if (keys.some(k => {
      if (typeof k !== 'string') return true;
      if (array && k === 'length') return false;
      return !descriptors[k]!.enumerable || !('value' in descriptors[k]!);
    })) return fail();
    parents.add(v);
    try {
      if (array) {
        const length = descriptors.length?.value;
        if (!Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1) return fail();
        let size = 2 + Math.max(0, length - 1);
        for (let i = 0; i < length; i++) {const d = descriptors[String(i)]; if (!d) return fail(); size += visit(d.value, depth + 1);}
        return size;
      }
      let size = 2 + Math.max(0, keys.length - 1);
      for (const key of keys as string[]) size += stringBytes(key) + 1 + visit(descriptors[key]!.value, depth + 1);
      return size;
    } finally {parents.delete(v);}
  };
  return {compact_utf8_bytes: visit(value, 0), nodes, root_zero_depth: deepest};
}

export type CapacityPhase = 'CAPTURE' | 'RETAINED_ROOT' | 'WHOLE_CAPTURE' | 'RETAINED_REOPEN' | 'PREVIEW' | 'PREPARE' | 'BACKUP_ENCODE' | 'BACKUP_READ';
export interface CapacityEvent {sequence: number; parent: number | null; phase: CapacityPhase; status: 'ACCEPTED' | 'REJECTED'; ms: number | null; code: string | null}
export interface CapacityTrace {mode: 'SHAPE' | 'MEASURE'; events: CapacityEvent[]; retained_roots: ({status: 'COUNTED'; shape: JsonShape; fields: Record<string, JsonShape>} | {status: 'UNAVAILABLE'})[]; complete_captures: ({status: 'COUNTED'; shape: JsonShape} | {status: 'UNAVAILABLE'})[]}
let active: {report: CapacityTrace; stack: number[]; clock: () => number} | null = null;
/** Only fixed codes are published; exception messages may contain sensitive input. */
export function capacityFailureCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'UNCLASSIFIED';
  const d = Object.getOwnPropertyDescriptor(error, 'message'), message = d && 'value' in d ? d.value : null;
  return typeof message === 'string' && /^(?:FEE_ENVELOPE_INVALID:(?:STRICT_JSON|UTF8_SIZE)|FEE_SEMANTIC_BUDGET_(?:INVALID|STALE)|RUNTIME_(?:CAPTURE_SHAPE|CANDIDATE_(?:STALE_CAPTURE|STALE_PREPARATION|STALE_BACKUP|FOREIGN_SUMMARY|FOREIGN_PREVIEW|INCOMPLETE|CALCULATION|BACKUP_SIZE)|BACKUP_(?:RAW_SIZE|ENCODED_SIZE)))$/.test(message) ? message : 'UNCLASSIFIED';
}
export function beginCapacityTrace(mode: CapacityTrace['mode'], clock = () => performance.now()): void {
  if (active) throw Error('CAPACITY_TRACE_BUSY');
  active = {report: {mode, events: [], retained_roots: [], complete_captures: []}, stack: [], clock};
}
export function endCapacityTrace(): CapacityTrace {
  if (!active || active.stack.length) throw Error('CAPACITY_TRACE_UNFINISHED');
  const report = active.report; active = null; return report;
}
export function observeRetainedShape(value: unknown): void {
  if (active?.report.mode !== 'SHAPE') return;
  try {
    const shape = ordinaryJsonShape(value), fields: Record<string, JsonShape> = {};
    for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!('value' in d)) throw Error('CAPACITY_SHAPE_JSON_ONLY');
      fields[key] = ordinaryJsonShape(d.value);
    }
    active.report.retained_roots.push({status: 'COUNTED', shape, fields});
  } catch {active.report.retained_roots.push({status: 'UNAVAILABLE'});}
}
export function observeCompleteShape(value: unknown): void {
  if (active?.report.mode !== 'SHAPE') return;
  try {active.report.complete_captures.push({status: 'COUNTED', shape: ordinaryJsonShape(value)});}
  catch {active.report.complete_captures.push({status: 'UNAVAILABLE'});}
}
function start(phase: CapacityPhase) {
  const session = active; if (!session) return null;
  const event: CapacityEvent = {sequence: session.report.events.length + 1, parent: session.stack.at(-1) ?? null, phase, status: 'ACCEPTED', ms: null, code: null};
  session.report.events.push(event); session.stack.push(event.sequence);
  return {session, event, at: session.report.mode === 'MEASURE' ? session.clock() : null};
}
function finish(frame: ReturnType<typeof start>, rejected: boolean, error?: unknown) {
  if (!frame) return;
  const {session, event, at} = frame;
  if (at !== null) {const duration = session.clock() - at; event.ms = Number.isFinite(duration) && duration >= 0 ? duration : null;}
  if (rejected) {event.status = 'REJECTED'; event.code = capacityFailureCode(error);}
  session.stack.pop();
}
export function traceCapacitySync<T>(phase: CapacityPhase, run: () => T): T {
  const frame = start(phase);
  try {const value = run(); finish(frame, false); return value;} catch (error) {finish(frame, true, error); throw error;}
}
export async function traceCapacityAsync<T>(phase: CapacityPhase, run: () => Promise<T>): Promise<T> {
  const frame = start(phase);
  try {const value = await run(); finish(frame, false); return value;} catch (error) {finish(frame, true, error); throw error;}
}
