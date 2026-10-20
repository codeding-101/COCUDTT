/** Evidence of text read from a file or acknowledged by the injected writer; never a download receipt. */
export interface FileEvidence {readonly name: string | null; readonly saved_raw: string | null; readonly saved_at: string | null}
export const unknownFileEvidence = (): FileEvidence => Object.freeze({name: null, saved_raw: null, saved_at: null});
export function openedFileEvidence(raw: string, name: string | null = null): FileEvidence {
  if (typeof raw !== 'string' || name !== null && typeof name !== 'string') throw Error('FILE_EVIDENCE_TEXT');
  return Object.freeze({name, saved_raw: raw, saved_at: null});
}
export function savedFileEvidence(raw: string, name: string | null = null): FileEvidence {
  return Object.freeze({...openedFileEvidence(raw, name), saved_at: new Date().toISOString()});
}
