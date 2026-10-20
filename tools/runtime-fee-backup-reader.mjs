import {gunzipSync} from 'node:zlib';
/** Decode our diagnostic output for inspection only. The returned data never authorizes source installation or a fee replay. */
export function readRuntimeFeeBackup(value) {
  if(value?.kind!=='INTERNAL_RUNTIME_FEE_BACKUP_ARCHIVE')return value;
  if(value.version!=='0.1'||value.encoding!=='GZIP_BASE64_UTF8'||value.import_authority!==false||!Number.isSafeInteger(value.raw_bytes)||value.raw_bytes<1||value.raw_bytes>256*1024*1024||typeof value.data!=='string'||value.data.length>64*1024*1024||value.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.data))throw Error('INVALID_DIAGNOSTIC_ARCHIVE');
  const compressed=Buffer.from(value.data,'base64');if(compressed.toString('base64')!==value.data)throw Error('INVALID_DIAGNOSTIC_BASE64');
  const bytes=gunzipSync(compressed,{maxOutputLength:value.raw_bytes});
  if(bytes.length!==value.raw_bytes)throw Error('DIAGNOSTIC_ARCHIVE_SIZE');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
