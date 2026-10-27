import{describe,it,expect,vi}from'vitest';
import{gzipSync}from'node:zlib';
import{encodeFeeRecoverySharing as encode,decodeFeeRecoverySharing as decode,inspectFeeRecoverySharing as inspect,serializeFeeSharingSupplement as serialize,assessFeeRecoverySharing as assess,countFeeSharingGzipBytes as gzip,FEE_RECOVERY_SHARING_LIMITS as limits}from'../tools/fee-recovery-sharing';
import{feeRecoveryFixture}from'../tools/fee-recovery-cases';
import{FeeRecoveryFormat}from'../tools/fee-recovery-format';import{FeeRecoveryWorkspace}from'../tools/fee-recovery-workspace';
const fixture=()=>feeRecoveryFixture().supplement,signal=()=>new AbortController().signal;
const chunks=(nodes:unknown[])=>Array.from({length:Math.ceil(nodes.length/512)},(_,i)=>JSON.stringify(nodes.slice(i*512,i*512+512)));
function packet(){const f=fixture();f.extensions={a:'中😀"\\\r\n'.repeat(300),b:'中😀"\\\r\n'.repeat(300)};return JSON.parse(encode(f).wire);}
const nodes=(p:ReturnType<typeof packet>):unknown[][]=>p.chunks.flatMap((s:string)=>JSON.parse(s));
function replaceNodes(p:ReturnType<typeof packet>,rows:unknown[][]){p.chunks=chunks(rows);return JSON.stringify(p);}
function expandedBoundary(extra=0){
 const f=fixture();f.extensions={bomb:[]};const base=encode(f),p=JSON.parse(base.wire),rows=nodes(p),index=rows.findIndex(n=>n[0]==='o'&&n[1]==='["bomb"]')+1;
 const n=Math.floor((limits.expanded_bytes-base.summary.expanded_utf8_bytes-2)/1027),tail=limits.expanded_bytes-base.summary.expanded_utf8_bytes-n*1027-2+extra;
 p.texts=['x'.repeat(1024)];const last:unknown[]=tail>=1024?['r',1]:['s','y'.repeat(tail)];if(tail>=1024)p.texts.push('y'.repeat(tail));rows[index]=['a',n+1];const expanded=rows.slice(0,index+1).concat(Array.from({length:n},()=>['r',0]),[last],rows.slice(index+1));p.summary={nodes:expanded.length,root_zero_depth:3,expanded_utf8_bytes:limits.expanded_bytes};return replaceNodes(p,expanded);
}
describe('supplementary immutable string sharing preserves data without changing recovery admission',()=>{
 it('roundtrips all original fields, raw whitespace, unknown history, negative zero and separate objects',()=>{
  const f=fixture(),raw='\ufeff \r\n中😀"\\'.repeat(220);f.extensions={raw,another:raw,negative_zero:-0,unknown:{history_origin:'UNKNOWN_IMPORTED',original:'  {"n":1}\r\n'},holders:[{raw},{raw}],empty:'',missing:null};
  const encoded=encode(f),restored=decode(encoded.wire);expect(serialize(restored)).toBe(encoded.expanded_json);expect(restored).toStrictEqual(f);expect(Object.is(restored.extensions.negative_zero,-0)).toBe(true);expect(Object.isFrozen(restored.extensions)).toBe(true);
  const holders=restored.extensions.holders as object[];expect(holders[0]).not.toBe(holders[1]);expect(encoded.duplicate_occurrences).toBe(3);expect(encoded.representation_saved_bytes).toBeGreaterThan(0);expect(encoded.recovery_archive).toBe(false);expect(encode(restored).wire).toBe(encoded.wire);
 });
 it('keeps null, empty, numeric strings, exact distinct JSON and ordinary prototype-like keys',()=>{
  const f=fixture();f.extensions=JSON.parse('{"__proto__":{"value":1},"constructor":"inert","values":[null,"",false,0,-0,"0","{\\"n\\":1}","{ \\"n\\": 1 }"]}');const result=decode(encode(f).wire);expect(result).toStrictEqual(f);expect(Object.getPrototypeOf(result.extensions)).toBe(Object.prototype);expect(Object.hasOwn(result.extensions,'__proto__')).toBe(true);
 });
 it('leaves source data mutable only at the caller and freezes detached output',()=>{const f=fixture();f.extensions={raw:'x'.repeat(2048)};const e=encode(f);f.extensions.raw='changed';expect(decode(e.wire).extensions.raw).toBe('x'.repeat(2048));expect(Object.isFrozen(f.extensions)).toBe(false);});
 it('reports overhead honestly for small profiles',()=>{const f=fixture(),e=encode(f);expect(e.wire_utf8_bytes).toBe(Buffer.byteLength(e.wire));expect(e.representation_saved_bytes).toBe(e.summary.expanded_utf8_bytes-e.wire_utf8_bytes);expect(e.representation_saved_bytes).toBeLessThan(0);expect(inspect(e.wire)).toEqual(e.summary);});
 it.each(['getter','toJSON','cycle','sparse','prototype','nan','infinity','symbol','lone-surrogate'] as const)('refuses %s without executing customer accessors',kind=>{
  const f=fixture(),call=vi.fn();if(kind==='getter')Object.defineProperty(f.extensions,'x',{enumerable:true,get:call});else if(kind==='toJSON')f.extensions.toJSON=call;else if(kind==='cycle')f.extensions.self=f.extensions;else if(kind==='sparse')f.extensions.x=new Array(2);else if(kind==='prototype')f.extensions.x=new Date();else if(kind==='nan')f.extensions.x=NaN;else if(kind==='infinity')f.extensions.x=Infinity;else if(kind==='symbol')f.extensions.x=Symbol();else f.extensions.x='\ud800';expect(()=>encode(f)).toThrow();expect(call).not.toHaveBeenCalled();
 });
 it.each(['version','authority','archive','summary','duplicate-text','short-text','unused-text','negative-ref','fraction-ref','outside-ref','negative-zero-ref','extra-token','bad-tag','duplicate-key','key-order','chunk-whitespace'] as const)('refuses mutated %s',kind=>{
  const p=packet(),rows=nodes(p),ref=rows.findIndex(n=>n[0]==='r'),object=rows.findIndex(n=>n[0]==='o');
  if(kind==='version')p.version='0.2';else if(kind==='authority')p.import_authority=true;else if(kind==='archive')p.recovery_archive=true;else if(kind==='summary')p.summary.expanded_utf8_bytes++;else if(kind==='duplicate-text')p.texts.push(p.texts[0]);else if(kind==='short-text')p.texts[0]='short';else if(kind==='unused-text')p.texts.push('UNUSED'.repeat(200));else if(kind==='negative-ref')rows[ref]=['r',-1];else if(kind==='fraction-ref')rows[ref]=['r',0.5];else if(kind==='outside-ref')rows[ref]=['r',99];else if(kind==='negative-zero-ref'){const raw=replaceNodes(p,rows).replace('[\\"r\\",0]','[\\"r\\",-0]');expect(()=>decode(raw)).toThrow();return;}else if(kind==='extra-token')rows.push(['null']);else if(kind==='bad-tag')rows[ref]=['eval','PRIVATE'];else if(kind==='duplicate-key')rows[object]=['o','["x","x"]'];else if(kind==='key-order')rows[object]=['o','["2","1"]'];else{p.chunks[0]=' '+p.chunks[0];expect(()=>decode(JSON.stringify(p))).toThrow();return;}
  expect(()=>decode(replaceNodes(p,rows))).toThrow();
 });
 it('checks actual128MiB expanded size before constructing the supplementary object',()=>{const raw=expandedBoundary();expect(inspect(raw).expanded_utf8_bytes).toBe(limits.expanded_bytes);expect(()=>inspect(expandedBoundary(1))).toThrow('EXPANDED_LIMIT');},30000);
 it('checks actual300000 nodes before constructing a profile',()=>{
  const f=fixture();f.extensions={bomb:[]};const e=encode(f),p=JSON.parse(e.wire),rows=nodes(p),index=rows.findIndex(n=>n[0]==='o'&&n[1]==='["bomb"]')+1,n=300000-rows.length;
  rows[index]=['a',n];const expanded=rows.slice(0,index+1).concat(Array.from({length:n},()=>['s','']),rows.slice(index+1));p.summary={nodes:300000,root_zero_depth:3,expanded_utf8_bytes:e.summary.expanded_utf8_bytes+3*n-1};expect(inspect(replaceNodes(p,expanded)).nodes).toBe(300000);
  expanded[index]=['a',n+1];expanded.splice(index+1,0,['s','']);expect(()=>inspect(replaceNodes(p,expanded))).toThrow('SEMANTIC_LIMIT');
 },30000);
 it('retains depth32 and refuses the next structural level',()=>{const f=fixture();let deep:unknown='leaf';for(let i=0;i<30;i++)deep={x:deep};f.extensions={future:deep};const e=encode(f);expect(e.summary.root_zero_depth).toBe(32);expect(decode(e.wire)).toStrictEqual(f);const p=JSON.parse(e.wire),rows=nodes(p),i=rows.findIndex(n=>n[0]==='s'&&n[1]==='leaf');rows.splice(i,0,['o','["x"]']);expect(()=>inspect(replaceNodes(p,rows))).toThrow('SEMANTIC_LIMIT');});
 it('refuses an actual256MiB+1 raw body before parsing it',()=>{expect(()=>decode('x'.repeat(limits.raw_body_bytes+1))).toThrow();});
 it('never uses a smaller representation to admit the143014394-byte candidate',()=>{const a=assess(32776828,110237566,100);expect(a).toMatchObject({aggregate_utf8_bytes:143014394,within_aggregate_limit:false,capacity_decision:'NO_GO_EXPANDED_LIMIT',capacity_changed:false,recovery_archive:false});expect(assess(1,limits.expanded_bytes-1,64).within_aggregate_limit).toBe(true);expect(assess(1,limits.expanded_bytes,1).within_aggregate_limit).toBe(false);});
 it.each([-1,-0,0.5,Infinity,NaN])('refuses invalid budget input %s',value=>{expect(()=>assess(value,1,1)).toThrow('BUDGET_INPUT');});
 it('cannot replace an existing data quarantine through the original recovery reader',async()=>{const f=feeRecoveryFixture(),format=new FeeRecoveryFormat(),store=new FeeRecoveryWorkspace(format),raw=await format.encode(f.parts,f.supplement,signal()),summary=await store.stage(raw),old=store.confirm(summary,'REPLACE_QUARANTINE_DATA');await expect(store.stage(encode(f.supplement).wire)).rejects.toThrow('DECODE_FAILED');expect(store.current()).toBe(old);expect(old.financial_writes).toBe(0);});
 it.each(['','中文😀','a'.repeat(32767)+'😀中'.repeat(200)])('counts the actual native gzip text body without splitting a surrogate pair',async raw=>{expect(await gzip(raw,signal())).toBe(gzipSync(Buffer.from(raw)).length);});
 it('rejects pre-abort and cancels an in-progress gzip observation',async()=>{const before=new AbortController();before.abort();await expect(gzip('x',before.signal)).rejects.toThrow('CANCELLED');const mid=new AbortController(),pending=gzip('x'.repeat(1048576),mid.signal);mid.abort();await expect(pending).rejects.toThrow('CANCELLED');});
});
