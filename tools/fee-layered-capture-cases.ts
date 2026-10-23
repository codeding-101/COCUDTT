/** Fixed synthetic roots for independent protocol checks; not a trade template or source qualification. */
import type {FeeLayeredCaptureParts, FeeLayeredRetainedFormat} from './fee-layered-capture-prototype';
import {unknownFileEvidence} from '../src/ui/file-evidence';
export function feeLayeredParts(retained_root: unknown = {pending: null, history: 'UNKNOWN_IMPORTED'}, retained_format: FeeLayeredRetainedFormat = 'PRETTY_LF'): FeeLayeredCaptureParts {
  return {retained_root, retained_format, capture_shell: {scope: 'RUNTIME_FEE_WORKBENCH_CAPTURE', envelope_json: null,
    sources: {project_json: null, bill_json: null, pair_json: null, attachment_json: null, precision_json: null},
    fx: {rows_json: '[]', preserved_row_key: null, preserved_books_json: null},
    files: {project: unknownFileEvidence(), bill: unknownFileEvidence(), pair: unknownFileEvidence(), attachment: unknownFileEvidence(), precision: unknownFileEvidence(), envelope: unknownFileEvidence()},
    editors: {cost: null, review: null, attachment: null, precision: null, pending_input: null},
    activity: {project_read: false, bill_read: false, pair_read: false, attachment_mutation: false, precision_mutation: false, recovery: false}, blockers: []}};
}
