import type {FeeEnvelopeLease} from './fee-envelope.js';

export class FeeApplicationTransactionError extends Error {
  constructor(readonly reason: string) { super('FEE_APPLICATION_TRANSACTION_INVALID:' + reason); this.name = 'FeeApplicationTransactionError'; }
}
/** A frozen review capability issued by the independent staging module, never an import format. */
export interface FeeApplicationTransactionPreview {
  readonly scope: 'INDEPENDENT_FEE_APPLICATION_PREVIEW';
  readonly status: 'STAGED' | 'BLOCKED';
  readonly transaction_id: string;
  readonly before_json: string;
  readonly before_lease: Readonly<FeeEnvelopeLease>;
  readonly plan_json: string | null;
  readonly issues: readonly string[];
  readonly diagnostics: readonly string[];
  readonly costs_added: number;
  readonly references_recorded: number;
  readonly workbench_writes: 0;
}
export type FeeApplicationReplayStatus = 'NOT_RECORDED' | 'HISTORY_UNKNOWN' | 'BUSINESS_MISMATCH' | 'TRANSACTION_ID_COLLISION' | 'ALREADY_RECORDED_NO_WRITE' | 'RECORDED_HISTORY_REQUIRES_REVIEW';
export interface FeeApplicationStageResult {
  readonly status: 'STAGED' | 'STALE_CONTEXT' | FeeApplicationReplayStatus;
  readonly envelope_json: string | null;
  readonly lease: Readonly<FeeEnvelopeLease> | null;
  readonly workbench_writes: 0;
}
