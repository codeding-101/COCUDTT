import {describe,expect,it,vi} from 'vitest';
import {gunzipSync} from 'node:zlib';
import {encodeRuntimeFeeBackup} from '../src/data/runtime-fee-backup';

describe('完整诊断备份：标准 JSON 与逐字压缩原文',()=>{
 it('较小备份保留原始空白、中文和非BMP字符',()=>{const raw=' \n{"kind":"INTERNAL_TEST","note":"中文😀\\n"}\n';expect(encodeRuntimeFeeBackup(raw)).toBe(raw);});
 it('超过48MiB的备份以标准gzip无损归档，独立Node解码器恢复每一字节',()=>{const raw=JSON.stringify({kind:'INTERNAL_TEST',before:' \n中文😀\n',retained:'x'.repeat(48*1024*1024),after:'  原文  \n'}),encoded=encodeRuntimeFeeBackup(raw),a=JSON.parse(encoded),bytes=gunzipSync(Buffer.from(a.data,'base64'),{maxOutputLength:256*1024*1024});expect(a).toMatchObject({kind:'INTERNAL_RUNTIME_FEE_BACKUP_ARCHIVE',version:'0.1',encoding:'GZIP_BASE64_UTF8',import_authority:false});expect(bytes.length).toBe(a.raw_bytes);expect(bytes.toString('utf8')).toBe(raw);expect(Buffer.byteLength(encoded)).toBeLessThan(64*1024*1024);},30000);
 it('原文处理大小超限时明确拒绝，不截断后输出',()=>{const spy=vi.spyOn(TextEncoder.prototype,'encode').mockReturnValueOnce({length:256*1024*1024+1} as Uint8Array<ArrayBuffer>);try{expect(()=>encodeRuntimeFeeBackup('{}')).toThrow('RUNTIME_BACKUP_RAW_SIZE');}finally{spy.mockRestore();}});
});
