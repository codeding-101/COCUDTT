import type {FeeEnvelopeSources} from './fee-envelope.js';

export const FEE_WORKBENCH_FILES = ['project', 'bill', 'pair', 'attachment', 'precision', 'envelope'] as const;
export type FeeWorkbenchFile = typeof FEE_WORKBENCH_FILES[number];
export const FEE_WORKBENCH_EDITORS = ['cost', 'review', 'attachment', 'precision', 'pending_input'] as const;
export const FEE_WORKBENCH_ACTIVITY = ['project_read', 'bill_read', 'pair_read', 'attachment_mutation', 'precision_mutation', 'recovery'] as const;
export interface FeeWorkbenchFileState {name: string | null; saved_raw: string | null; saved_at: string | null}
/** Private integration contract, not an import format or a claim that the running app uses it. */
export interface FeeWorkbenchInput {
  envelope_json: string;
  sources: FeeEnvelopeSources;
  fx: {rows_json: string; preserved_row_key: string | null; preserved_books_json: string | null};
  files: Record<FeeWorkbenchFile, FeeWorkbenchFileState>;
  editors: Record<typeof FEE_WORKBENCH_EDITORS[number], string | null>;
  activity: Record<typeof FEE_WORKBENCH_ACTIVITY[number], boolean>;
  /** Archived exact JSON of auxiliary UI state; never active results or customer approval. */
  retained_json: string;
}
export type FeeWorkbenchSnapshot = Readonly<{
  input: FeeWorkbenchInput;
  dirty_files: readonly FeeWorkbenchFile[];
  commit: Readonly<{transaction_id: string; costs_added: number; receipts_added: 1}> | null;
  requires_recompute: true;
  customer_review_valid: false;
}>;
export interface FeeWorkbenchPreview {
  readonly scope: 'FEE_WORKBENCH_SNAPSHOT_PREVIEW';
  readonly status: 'STAGED' | 'BLOCKED';
  readonly transaction_id: string;
  readonly issues: readonly string[];
  readonly costs_added: number;
  readonly references_recorded: number;
  readonly before_sources: Readonly<FeeEnvelopeSources>;
  readonly after_sources: Readonly<FeeEnvelopeSources> | null;
  readonly historical_sources: readonly ('pair' | 'attachment' | 'precision')[];
  readonly runtime_writes: 0;
}
export type FeeWorkbenchEffectKind = 'CACHE' | 'RENDER' | 'FILE_SAVE';
export type FeeWorkbenchEffectStatus = 'CONFIRMED' | 'CONFLICT' | 'UNCONFIRMED' | 'DOWNLOAD_STARTED' | 'FAILED' | 'BUSY' | 'BLOCKED';
export interface FeeWorkbenchEffectResult {
  readonly kind: FeeWorkbenchEffectKind;
  readonly status: FeeWorkbenchEffectStatus;
  readonly stale_context: boolean;
  readonly envelope_json: string;
  readonly backup_json: string;
  readonly financial_rollback: false;
}
