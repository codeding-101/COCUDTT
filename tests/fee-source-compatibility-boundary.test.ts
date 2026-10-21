import {describe,expect,it} from 'vitest';
import {copyFeeEnvelopeJson,parseFeeEnvelopeJson} from '../src/data/fee-envelope-json';
import {FEE_ENVELOPE_BYTES} from '../src/domain/fee-envelope';

describe('unchanged strict JSON boundaries used by both capture paths',{timeout:120000},()=>{
  it.each([31,32,33])('measures root-relative depth %i',depth=>{
    let value:unknown='LEAF';for(let n=0;n<depth;n++)value={next:value};
    if(depth<=32){expect(copyFeeEnvelopeJson(value)).toEqual(value);expect(parseFeeEnvelopeJson(JSON.stringify(value))).toEqual(value);}
    else {expect(()=>copyFeeEnvelopeJson(value)).toThrow('STRICT_JSON');expect(()=>parseFeeEnvelopeJson(JSON.stringify(value))).toThrow('STRICT_JSON');}
  });
  it.each([299999,300000,300001])('counts root plus leaves at %i total nodes',nodes=>{
    const value=Array.from({length:nodes-1},()=>0),raw=JSON.stringify(value);
    if(nodes<=300000){expect((copyFeeEnvelopeJson(value) as unknown[]).length).toBe(nodes-1);expect((parseFeeEnvelopeJson(raw) as unknown[]).length).toBe(nodes-1);}
    else {expect(()=>copyFeeEnvelopeJson(value)).toThrow('STRICT_JSON');expect(()=>parseFeeEnvelopeJson(raw)).toThrow('STRICT_JSON');}
  });
  it.each([-1,0,1])('checks actual128MiB ASCII JSON-byte limit at offset %i',offset=>{
    const value='a'.repeat(FEE_ENVELOPE_BYTES-2+offset);
    expect(Buffer.byteLength(JSON.stringify(value))).toBe(FEE_ENVELOPE_BYTES+offset);
    if(offset<=0)expect(copyFeeEnvelopeJson(value)).toBe(value);else expect(()=>copyFeeEnvelopeJson(value)).toThrow('STRICT_JSON');
  });
  it.each([-1,0,1])('checks actual128MiB multibyte JSON-byte limit at offset %i',offset=>{
    const contentBytes=FEE_ENVELOPE_BYTES-2+offset,value='中'.repeat(Math.floor(contentBytes/3))+'a'.repeat(contentBytes%3);
    expect(value.length).toBeLessThan(FEE_ENVELOPE_BYTES);expect(Buffer.byteLength(JSON.stringify(value))).toBe(FEE_ENVELOPE_BYTES+offset);
    if(offset<=0)expect(copyFeeEnvelopeJson(value)).toBe(value);else expect(()=>copyFeeEnvelopeJson(value)).toThrow('STRICT_JSON');
  });
  it('accepts exactly128MiB parser input including whitespace, and rejects the next byte',()=>{
    const raw='0'+' '.repeat(FEE_ENVELOPE_BYTES-1);expect(parseFeeEnvelopeJson(raw)).toBe(0);expect(()=>parseFeeEnvelopeJson(raw+' ')).toThrow('UTF8_SIZE');
  });
  it('rejects UTF8 overflow even when parser input code units remain below128MiB',()=>{
    const raw='"'+'中'.repeat(Math.ceil(FEE_ENVELOPE_BYTES/3))+'"';expect(raw.length).toBeLessThan(FEE_ENVELOPE_BYTES);expect(()=>parseFeeEnvelopeJson(raw)).toThrow('UTF8_SIZE');
  });
  it('keeps escaped duplicate keys and lone-surrogate rejection separate from size failures',()=>{
    expect(()=>parseFeeEnvelopeJson('{"key":1,"\\u006bey":2}')).toThrow('STRICT_JSON');expect(()=>parseFeeEnvelopeJson('"\\ud800"')).toThrow('STRICT_JSON');
  });
});
