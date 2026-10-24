/** Executable interface contract only. No native codec implementation or application binding. */
import type {WorkbenchCheckpoint, WorkbenchStateOwner} from '../src/ui/workbench-state';
import type {FeeLayeredCaptureParts, FeeLayeredCaptureRestoration} from './fee-layered-capture-prototype';

/** Trusted implementation must detach/validate borrowed parts before its first asynchronous yield. */
export interface FeeBrowserCaptureCodec {
  encode(parts: FeeLayeredCaptureParts, signal: AbortSignal): Promise<string>;
  decode(wire: string, signal: AbortSignal): Promise<FeeLayeredCaptureRestoration>;
}
export type FeeBrowserCapturePhase = 'IDLE' | 'READING' | 'ENCODING' | 'VERIFYING' | 'ISSUED' | 'STALE' | 'CLOSED';
export type FeeBrowserCaptureErrorCode = 'CANCELLED' | 'STALE' | 'CLOSED' | 'UNAVAILABLE' | 'READ_FAILED' | 'ENCODE_FAILED' | 'VERIFY_FAILED' | 'FOREIGN_OR_STALE';
export class FeeBrowserCaptureContractError extends Error {
  constructor(readonly code: FeeBrowserCaptureErrorCode) {super('FEE_BROWSER_CAPTURE_CONTRACT_' + code);}
}
export interface FeeBrowserCaptureObservation {
  readonly kind: 'INTERNAL_FEE_BROWSER_CAPTURE_OBSERVATION'; readonly version: '0.1';
  readonly wire: string; readonly restoration: FeeLayeredCaptureRestoration;
  readonly financial_writes: 0; readonly import_authority: false; readonly confirmation_authority: false; readonly runtime_integrated: false;
}
interface Operation {
  checkpoint: WorkbenchCheckpoint; controller: AbortController; external: AbortSignal | undefined;
  interrupted: Promise<never>; reject: (reason: Error) => void; phase: FeeBrowserCapturePhase;
}
const fail = (code: FeeBrowserCaptureErrorCode): never => {throw new FeeBrowserCaptureContractError(code);};
function verifiedData(value: FeeLayeredCaptureRestoration): boolean {
  if (!value || typeof value !== 'object' || !Object.isFrozen(value)) return false;
  const ds = Object.getOwnPropertyDescriptors(value), names = ['kind','version','financial_writes','import_authority','confirmation_authority','runtime_integrated','retained_root','capture'];
  if (Reflect.ownKeys(ds).length !== names.length || names.some(k => !ds[k]?.enumerable || !('value' in ds[k]!))) return false;
  return ds.kind!.value === 'INTERNAL_FEE_LAYERED_CAPTURE_RESTORATION' && ds.version!.value === '0.1' && ds.financial_writes!.value === 0 &&
    ds.import_authority!.value === false && ds.confirmation_authority!.value === false && ds.runtime_integrated!.value === false;
}

/** Latest request owns the observation. Cancellation rejects promptly; it cannot physically stop WebCrypto or trusted side effects. */
export class FeeBrowserCaptureContract {
  private operation: Operation | null = null;
  private closed = false;
  private readonly issued = new WeakMap<object, Operation>();
  constructor(private readonly owner: WorkbenchStateOwner, private readonly codec: FeeBrowserCaptureCodec) {}
  private interrupt(op: Operation): void {
    op.reject(new FeeBrowserCaptureContractError('CANCELLED'));
    op.controller.abort();
  }
  private current(op: Operation): boolean {
    return !this.closed && this.operation === op && !op.controller.signal.aborted && !op.external?.aborted && this.owner.isCurrent(op.checkpoint);
  }
  private check(op: Operation): void {
    if (this.closed) fail('CLOSED');
    if (op.controller.signal.aborted || op.external?.aborted) fail('CANCELLED');
    if (!this.current(op)) fail('STALE');
  }
  cancel(): void {const old = this.operation; this.operation = null; if (old) this.interrupt(old);}
  dispose(): void {this.closed = true; this.cancel();}
  state(): FeeBrowserCapturePhase {return this.closed ? 'CLOSED' : !this.operation ? 'IDLE' : this.current(this.operation) ? this.operation.phase : 'STALE';}
  async capture(read: (signal: AbortSignal) => FeeLayeredCaptureParts | Promise<FeeLayeredCaptureParts>, signal?: AbortSignal): Promise<FeeBrowserCaptureObservation> {
    if (this.closed) fail('CLOSED');
    if (typeof AbortController !== 'function') fail('UNAVAILABLE');
    let reject!: (reason: Error) => void;
    const interrupted = new Promise<never>((_, no) => {reject = no;});
    // Also handles cancellation before a synchronous reader throws or before a race is installed.
    void interrupted.catch(() => {});
    const op: Operation = {checkpoint: this.owner.checkpoint(), controller: new AbortController(), external: signal, interrupted, reject, phase: 'READING'};
    const old = this.operation; this.operation = op;
    // Install the new identity first: an old trusted abort listener may synchronously start a newer request.
    if (old) this.interrupt(old);
    const abort = () => {if (this.operation === op) this.operation = null; this.interrupt(op);};
    signal?.addEventListener('abort', abort, {once: true});
    let errorCode: FeeBrowserCaptureErrorCode = 'READ_FAILED';
    try {
      this.check(op);
      const parts = await Promise.race([read(op.controller.signal), interrupted]); this.check(op);
      op.phase = 'ENCODING'; errorCode = 'ENCODE_FAILED';
      const wire = await Promise.race([this.codec.encode(parts, op.controller.signal), interrupted]); this.check(op);
      if (typeof wire !== 'string') fail('ENCODE_FAILED');
      op.phase = 'VERIFYING'; errorCode = 'VERIFY_FAILED';
      const restoration = await Promise.race([this.codec.decode(wire, op.controller.signal), interrupted]); this.check(op);
      if (!verifiedData(restoration)) fail('VERIFY_FAILED');
      this.check(op);
      const value: FeeBrowserCaptureObservation = Object.freeze({kind: 'INTERNAL_FEE_BROWSER_CAPTURE_OBSERVATION', version: '0.1', wire, restoration,
        financial_writes: 0, import_authority: false, confirmation_authority: false, runtime_integrated: false});
      op.phase = 'ISSUED'; this.issued.set(value, op); return value;
    } catch {
      this.check(op); return fail(errorCode); // Do not read an untrusted error message, stack or abort reason.
    } finally {
      signal?.removeEventListener('abort', abort);
      if (this.operation === op && op.phase !== 'ISSUED') this.operation = null;
    }
  }
  isCurrent(value: unknown): value is FeeBrowserCaptureObservation {
    if (!value || typeof value !== 'object') return false;
    const op = this.issued.get(value); return op !== undefined && this.current(op);
  }
  exportWire(value: FeeBrowserCaptureObservation): string {if (!this.isCurrent(value)) return fail('FOREIGN_OR_STALE'); return value.wire;}
}
