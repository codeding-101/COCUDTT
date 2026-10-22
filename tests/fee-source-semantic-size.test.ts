import {describe,expect,it} from 'vitest';
import {captureFeeSemanticBudget,projectFeeSemanticCapture} from '../tools/fee-source-semantic-budget';
import {FEE_ENVELOPE_BYTES} from '../src/domain/fee-envelope';
import {semanticFixture} from './helpers/fee-semantic-fixture';

describe('compound serialization keeps the original128MiB complete-capture limit',{timeout:180000},()=>{
  // A storage value is quoted first inside retained_json and again in the complete capture.
  // These are actual compound snapshots, not tests of an isolated strict-JSON helper.
  it.each(['"\\\n','中文😀'] as const)('retains nested escaping and UTF8 size for %j',unit=>{
    const f=semanticFixture(),key=Object.keys(f.f.storage)[0]!;
    const base=Buffer.byteLength(JSON.stringify(f.original()));
    f.f.storage[key]={raw:unit,available:true};const one=Buffer.byteLength(JSON.stringify(f.original()));
    // Baseline raw=null uses4bytes; empty JSON string inside retained text uses4escaped bytes too.
    f.f.storage[key]={raw:'',available:true};const empty=Buffer.byteLength(JSON.stringify(f.original())),step=one-empty;
    expect(base).toBeGreaterThan(0);expect(step).toBeGreaterThan(unit.length);
    for(const offset of [-1,0,1]){
      const target=FEE_ENVELOPE_BYTES+offset,remaining=target-empty;
      f.f.storage[key]={raw:unit.repeat(Math.floor(remaining/step))+'a'.repeat(remaining%step),available:true};
      // Build the same controlled original text before invoking its authoritative outer guard.
      const retained_json=JSON.stringify({...f.retained,storage:f.f.storage},null,2)+'\n';
      const wire=JSON.stringify({...f.baseline,retained_json});expect(Buffer.byteLength(wire)).toBe(target);
      expect(Buffer.byteLength(retained_json)).toBeLessThan(FEE_ENVELOPE_BYTES);
      if(offset<=0){
        const capture=captureFeeSemanticBudget(f.owner,f.readers);
        expect(Buffer.byteLength(JSON.stringify(capture.capture))).toBe(target);
        expect(capture.capture.retained_json===retained_json).toBe(true);
        // Reopened JSON must run the original outer and retained checks again.
        expect(Buffer.byteLength(JSON.stringify(projectFeeSemanticCapture(capture)))).toBe(target);
      }else expect(()=>captureFeeSemanticBudget(f.owner,f.readers)).toThrow('STRICT_JSON');
    }
  });
});
