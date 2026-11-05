/** Internal handoff only. Rebuilds the original recovery carrier without normalizing its two original text fields. */
import {gzipSync,strFromU8} from 'fflate';
import {feeEnvelopeSha256} from '../src/data/fee-envelope-json';
import {FEE_RECOVERY_LIMITS,type FeeRecoveryData} from './fee-recovery-format';
export async function originalFeeRecoveryFile(a:FeeRecoveryData):Promise<string>{
 const payload={kind:'INTERNAL_FEE_WORKBENCH_RECOVERY_DATA',version:'0.1',captured_at:a.captured_at,source_wire:a.source_wire,supplement_json:a.supplement_json,
  source_sha256:await feeEnvelopeSha256(a.source_wire),supplement_sha256:await feeEnvelopeSha256(a.supplement_json),financial_writes:0,import_authority:false,confirmation_authority:false};
 const raw=JSON.stringify(payload),bytes=new TextEncoder().encode(raw);if(bytes.length>FEE_RECOVERY_LIMITS.raw_bytes)throw Error('RECOVERED_HANDOFF_RAW_LIMIT');
 if(bytes.length<=FEE_RECOVERY_LIMITS.plain_bytes)return raw;
 const data=btoa(strFromU8(gzipSync(bytes,{level:1,mtime:0}),true));
 const wire=JSON.stringify({kind:'INTERNAL_FEE_WORKBENCH_RECOVERY_ARCHIVE',version:'0.1',encoding:'GZIP_BASE64_UTF8',raw_bytes:bytes.length,sha256:await feeEnvelopeSha256(raw),data,financial_writes:0,import_authority:false,confirmation_authority:false});
 if(new TextEncoder().encode(wire).length>FEE_RECOVERY_LIMITS.encoded_bytes)throw Error('RECOVERED_HANDOFF_FILE_LIMIT');return wire;
}
export interface RecoveredHandoffFile {readonly name:string;readonly text:string;readonly mime:'application/json';readonly bytes:number;readonly sha256:string}
export async function recoveredHandoffFile(name:string,text:string):Promise<RecoveredHandoffFile>{
 const bytes=new TextEncoder().encode(text).length;if(bytes>FEE_RECOVERY_LIMITS.encoded_bytes)throw Error('RECOVERED_HANDOFF_FILE_LIMIT');
 return Object.freeze({name,text,mime:'application/json',bytes,sha256:await feeEnvelopeSha256(text)});
}
