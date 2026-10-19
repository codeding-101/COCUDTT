import {FeeApplicationTransactionError, type FeeApplicationTransactionPreview} from '../domain/fee-application-transaction.js';
import type {FeeEnvelopeLease, FeeEnvelopeSources} from '../domain/fee-envelope.js';
import {copyFeeEnvelopeJson as copy} from './fee-envelope-json.js';
import {parseFeeEnvelope, updateFeeEnvelopeSources, serializeFeeEnvelope} from './fee-envelope.js';
import {prepareFeeApplicationTransaction, stageFeeApplicationTransaction, transactionLease} from './fee-application-transaction.js';

type Snapshot = Readonly<{raw_json: string; lease: Readonly<FeeEnvelopeLease>; dirty: boolean}>;
/** Owns a private independent aggregate only. Runtime controllers/storage/renderers are not installed. */
export class FeeApplicationCoordinator {
  private current: Snapshot;
  private generation = 0;
  private blocked = false;
  private busy = false;
  private pending: FeeApplicationTransactionPreview | null = null;
  private readonly issued = new WeakSet<object>();
  private readonly committed = new WeakSet<object>();
  private constructor(raw_json: string, lease: FeeEnvelopeLease) { this.current = this.snapshot(raw_json, lease, false); }
  static async open(raw_json: string) { const a = await parseFeeEnvelope(raw_json); return new FeeApplicationCoordinator(raw_json, transactionLease(a)); }
  private snapshot(raw_json: string, lease: FeeEnvelopeLease, dirty: boolean): Snapshot { return Object.freeze({raw_json, lease: Object.freeze({...lease}), dirty}); }
  private invalidate() { if (this.generation === Number.MAX_SAFE_INTEGER) throw new FeeApplicationTransactionError('GENERATION_LIMIT'); this.generation++; this.pending = null; }
  state() { return Object.freeze({current: this.current, generation: this.generation, blocked: this.blocked, busy: this.busy, has_pending: this.pending !== null, workbench_writes: 0 as const}); }
  cancel() { this.invalidate(); }
  setBlocked(value: boolean) { if (typeof value !== 'boolean') throw new FeeApplicationTransactionError('BLOCKED_FLAG'); if (value !== this.blocked) { this.blocked = value; this.invalidate(); } }
  async preview(transaction_id: string) {
    if (this.blocked || this.busy) throw new FeeApplicationTransactionError('BLOCKED_OR_BUSY');
    this.invalidate(); const generation = this.generation, before = this.current;
    const preview = await prepareFeeApplicationTransaction(before.raw_json, transaction_id);
    if (generation !== this.generation || before !== this.current || this.blocked) throw new FeeApplicationTransactionError('STALE_PREVIEW');
    this.issued.add(preview); if (preview.status === 'STAGED') this.pending = preview; return preview;
  }
  async confirm(preview: FeeApplicationTransactionPreview) {
    const result = (status: string, costs_added = 0, receipts_added = 0) => Object.freeze({status, costs_added, receipts_added, workbench_writes: 0 as const});
    if (!this.issued.has(preview)) throw new FeeApplicationTransactionError('FOREIGN_PREVIEW');
    if (this.blocked) return result('BLOCKED');
    if (this.busy) return result('BUSY');
    if (preview !== this.pending && !this.committed.has(preview)) return result('PREVIEW_EXPIRED');
    const generation = this.generation, before = this.current; this.busy = true;
    try {
      const staged = await stageFeeApplicationTransaction(preview, before.raw_json);
      if (generation !== this.generation || before !== this.current || this.blocked) return result('STALE_CONTEXT');
      if (staged.status !== 'STAGED') return result(staged.status);
      if (preview !== this.pending) return result('PREVIEW_EXPIRED');
      const candidate = this.snapshot(staged.envelope_json!, {...staged.lease!}, true);
      // Every fallible/async step precedes this single aggregate pointer replacement.
      this.invalidate(); this.current = candidate; this.committed.add(preview);
      return result('APPLIED_INDEPENDENT_MEMORY', preview.costs_added, 1);
    } finally { this.busy = false; }
  }
  /** Explicit manual source update; a concurrent pending confirmation is invalidated before any await. */
  async updateSources(lease: FeeEnvelopeLease, sources: FeeEnvelopeSources) {
    const captured = copy(sources), expected = copy(lease) as FeeEnvelopeLease;
    if (this.blocked) throw new FeeApplicationTransactionError('BLOCKED');
    this.invalidate(); const generation = this.generation, before = this.current;
    const a = await parseFeeEnvelope(before.raw_json), next = await updateFeeEnvelopeSources(a, expected, captured);
    const raw_json = next.content_sha256 === a.content_sha256 ? before.raw_json : await serializeFeeEnvelope(next);
    if (generation !== this.generation || before !== this.current || this.blocked) throw new FeeApplicationTransactionError('STALE_UPDATE');
    if (raw_json !== before.raw_json) this.current = this.snapshot(raw_json, transactionLease(next), true);
    return this.state();
  }
}
