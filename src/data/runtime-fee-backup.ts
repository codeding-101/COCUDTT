import {gzipSync, strFromU8} from 'fflate';

/** Diagnostic output only. Compression preserves every original UTF-8 byte; it grants no import or application authority. */
export function encodeRuntimeFeeBackup(raw: string): string {
  const bytes = new TextEncoder().encode(raw);
  if (bytes.length > 256 * 1024 * 1024) throw Error('RUNTIME_BACKUP_RAW_SIZE');
  if (bytes.length <= 48 * 1024 * 1024) return raw;
  const data = btoa(strFromU8(gzipSync(bytes, {level: 1, mtime: 0}), true));
  const archive = JSON.stringify({kind: 'INTERNAL_RUNTIME_FEE_BACKUP_ARCHIVE', version: '0.1', encoding: 'GZIP_BASE64_UTF8', raw_bytes: bytes.length, data, import_authority: false}, null, 2) + '\n';
  if (new TextEncoder().encode(archive).length > 64 * 1024 * 1024) throw Error('RUNTIME_BACKUP_ENCODED_SIZE');
  return archive;
}
