import {describe,it,expect,vi} from 'vitest';
import {gzipSync,gunzipSync,createGzip} from 'node:zlib';
import {once} from 'node:events';
import {FeeRecoveryFormat,FEE_RECOVERY_LIMITS as limits} from '../tools/fee-recovery-format';
import {feeRecoveryFixture as fixture,FEE_RECOVERY_CASE_DATE as captured_at} from '../tools/fee-recovery-cases';
import {encodeFeeLayeredCapturePrototype as nodeEncode,decodeFeeLayeredCapturePrototype as nodeDecode} from '../tools/fee-layered-capture-prototype';
import {feeEnvelopeSha256 as sha} from '../src/data/fee-envelope-json';
const signal=()=>new AbortController().signal;
async function encoded(compression:'NONE'|'GZIP'='NONE'){const f=fixture();return new FeeRecoveryFormat().encode(f.parts,f.supplement,signal(),{compression,captured_at});}
function unpack(raw:string){const d=JSON.parse(raw);return d.kind==='INTERNAL_FEE_WORKBENCH_RECOVERY_ARCHIVE'?gunzipSync(Buffer.from(d.data,'base64')).toString('utf8'):raw;}
async function wrapped(bytes:Uint8Array,raw_bytes=bytes.length,sha256?:string){const digest=sha256??await sha(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));return JSON.stringify({kind:'INTERNAL_FEE_WORKBENCH_RECOVERY_ARCHIVE',version:'0.1',encoding:'GZIP_BASE64_UTF8',raw_bytes,sha256:digest,data:gzipSync(bytes).toString('base64'),financial_writes:0,import_authority:false,confirmation_authority:false});}
describe('complete recovery data archive preserves sources, auxiliary history and explicit boundaries',()=>{
  it.each(['NONE','GZIP'] as const)('%s opens exact Node-compatible source wire and every supplemental value',async compression=>{
    const f=fixture(),format=new FeeRecoveryFormat(),input=await format.encode(f.parts,f.supplement,signal(),{compression,captured_at}),data=await format.decode(input,signal());
    expect(data.source_wire).toBe(nodeEncode(f.parts));expect(data.restoration).toStrictEqual(nodeDecode(data.source_wire));expect(data.supplement).toStrictEqual(f.supplement);
    expect(data).toMatchObject({captured_at,financial_writes:0,import_authority:false,confirmation_authority:false,runtime_installed:false});expect(Object.isFrozen(data.supplement.envelope_ui)).toBe(true);
    if(compression==='GZIP'){const d=JSON.parse(input),raw=unpack(input);expect(Buffer.byteLength(raw)).toBe(d.raw_bytes);expect(await sha(raw)).toBe(d.sha256);}
  });
  it.each(['\ufeff RAW 中😀\r\n"\\\u0000','',null] as const)('keeps opaque supplemental backup text, null and empty distinctly %#',async raw=>{
    const f=fixture();f.supplement.envelope_ui.workbench_candidate=raw===null?null:{backup_json:raw,summary:{transaction_id:'SYNTHETIC'}};
    f.supplement.envelope_ui.workbench_application={backup_json:'{"pending_patches":[{"operation":"DO_NOT_EXECUTE"}]}',receipts_added:1};
    const c=new FeeRecoveryFormat(),data=await c.decode(await c.encode(f.parts,f.supplement,signal(),{captured_at}),signal());
    expect(data.supplement.envelope_ui).toStrictEqual(f.supplement.envelope_ui);
  });
  it('keeps unknown nested values, special keys, structural holders and negative zero without coercion',async()=>{
    const f=fixture();f.supplement.extensions=JSON.parse('{"__proto__":{"preserved":true},"n":-0,"a":{"raw":"A"},"b":{"raw":"A"}}');
    const c=new FeeRecoveryFormat(),d=await c.decode(await c.encode(f.parts,f.supplement,signal(),{captured_at}),signal());
    expect(Object.is(d.supplement.extensions.n,-0)).toBe(true);expect(Object.hasOwn(d.supplement.extensions,'__proto__')).toBe(true);expect(d.supplement.extensions.a).not.toBe(d.supplement.extensions.b);expect(d.supplement).toStrictEqual(f.supplement);
  });
  it('detaches both roots and supplemental history before first async yield',async()=>{
    const f=fixture(),expected=nodeEncode(f.parts),c=new FeeRecoveryFormat();f.supplement.extensions={raw:'BEFORE'};
    const pending=c.encode(f.parts,f.supplement,signal(),{captured_at});f.supplement.extensions.raw='AFTER';(f.parts.retained_root as Record<string,unknown>).sensitivity='AFTER';
    const d=await c.decode(await pending,signal());expect(d.source_wire).toBe(expected);expect(d.supplement.extensions.raw).toBe('BEFORE');
  });
  it('preserves an unchecked pending checkbox and refuses missing supplemental checked state',async()=>{
    const f=fixture(),root=f.parts.retained_root as Record<string,unknown>,control={tag:'INPUT',id:'synthetic-check',type:'checkbox',value:'on',dataset:{path:'synthetic'},connected:false};
    root.pending_control=control;f.parts.capture_shell.editors.pending_input=JSON.stringify({pending_calculation:false,control});
    f.supplement.pending_present=true;f.supplement.pending_control={...control,checked:false,selection_start:null,selection_end:null,selected_values:null,bad_input:false,validation_message:'',files:null};
    const format=new FeeRecoveryFormat(),raw=await format.encode(f.parts,f.supplement,signal(),{captured_at}),data=await format.decode(raw,signal());expect(data.supplement.pending_control).toMatchObject({value:'on',checked:false,connected:false});
    delete f.supplement.pending_control.checked;await expect(format.encode(f.parts,f.supplement,signal(),{captured_at})).rejects.toThrow();
  });
  it('independently accepts standard Node gzip and rejects raw UTF-8 corruption',async()=>{
    const raw=await encoded(),c=new FeeRecoveryFormat();expect((await c.decode(await wrapped(new TextEncoder().encode(raw)),signal())).captured_at).toBe(captured_at);
    await expect(c.decode(await wrapped(Uint8Array.from([0xff,0xfe]),2,'0'.repeat(64)),signal())).rejects.toThrow();
  });
  it.each(['truncated','checksum','trailing','members'] as const)('rejects actual malformed gzip %s',async mutation=>{
    const raw=await encoded(),a=JSON.parse(await wrapped(new TextEncoder().encode(raw))),gzip=Buffer.from(a.data,'base64');
    if(mutation==='truncated')a.data=gzip.subarray(0,-3).toString('base64');else if(mutation==='checksum'){gzip[gzip.length-8]=gzip[gzip.length-8]!^1;a.data=gzip.toString('base64');}else a.data=Buffer.concat([gzip,mutation==='members'?gzipSync('SECOND_MEMBER'):Buffer.from([0])]).toString('base64');
    await expect(new FeeRecoveryFormat().decode(JSON.stringify(a),signal())).rejects.toThrow();
  });
  it.each(['base64','base64-padding','raw-size','raw-too-big','archive-digest','archive-version','financial-authority'] as const)('rejects altered compressed header %s',async mutation=>{
    const a=JSON.parse(await encoded('GZIP'));if(mutation==='base64')a.data='!!!!';if(mutation==='base64-padding')a.data='AB==';if(mutation==='raw-size')a.raw_bytes++;if(mutation==='raw-too-big')a.raw_bytes=limits.raw_bytes+1;if(mutation==='archive-digest')a.sha256='0'.repeat(64);if(mutation==='archive-version')a.version='2.0';if(mutation==='financial-authority')a.import_authority=true;
    await expect(new FeeRecoveryFormat().decode(JSON.stringify(a),signal())).rejects.toThrow();
  });
  it.each(['data-version','source-digest','supplement-digest','timestamp','unknown-header','duplicate-key'] as const)('rejects altered plain data %s',async mutation=>{
    const d=JSON.parse(await encoded());if(mutation==='data-version')d.version='2.0';if(mutation==='source-digest')d.source_sha256='0'.repeat(64);if(mutation==='supplement-digest')d.supplement_json+=' ';if(mutation==='timestamp')d.captured_at='2026-02-30T00:00:00.000Z';if(mutation==='unknown-header')d.execute=true;
    let raw=JSON.stringify(d);if(mutation==='duplicate-key')raw=raw.replace('"version":"0.1"','"version":"0.1","version":"0.1"');await expect(new FeeRecoveryFormat().decode(raw,signal())).rejects.toThrow();
  });
  it('rejects a generic Node protocol packet masquerading as complete-profile data even with matching hashes',async()=>{
    const d=JSON.parse(await encoded()),f=fixture();delete (f.parts.retained_root as Record<string,unknown>).storage;d.source_wire=nodeEncode(f.parts);d.source_sha256=await sha(d.source_wire);
    await expect(new FeeRecoveryFormat().decode(JSON.stringify(d),signal())).rejects.toThrow();
  });
  it('rejects contradictory initialization, missing application history and incomplete pending-control coverage before hashing',async()=>{
    for(const change of[(f:ReturnType<typeof fixture>)=>{f.supplement.workflow.state_initialized=true;},(f:ReturnType<typeof fixture>)=>{delete f.supplement.envelope_ui.workbench_application;},(f:ReturnType<typeof fixture>)=>{f.supplement.workflow.pending_calculation=true;}]){
      const f=fixture();change(f);const digest=vi.spyOn(crypto.subtle,'digest');try{await expect(new FeeRecoveryFormat().encode(f.parts,f.supplement,signal(),{captured_at})).rejects.toThrow();expect(digest).not.toHaveBeenCalled();}finally{digest.mockRestore();}
    }
  });
  it('rejects data/options accessors and unsupported unknown values without invoking user code',async()=>{
    const f=fixture(),get=vi.fn(),c=new FeeRecoveryFormat();Object.defineProperty(f.supplement.extensions,'raw',{enumerable:true,get});await expect(c.encode(f.parts,f.supplement,signal())).rejects.toThrow();
    const clean=fixture(),options={};Object.defineProperty(options,'compression',{enumerable:true,get});await expect(c.encode(clean.parts,clean.supplement,signal(),options)).rejects.toThrow();expect(get).not.toHaveBeenCalled();
  });
  it('enforces real streaming expanded bytes against the declared size, independent of gzip size',async()=>{
    const bytes=new TextEncoder().encode('x'.repeat(2*1024*1024));await expect(new FeeRecoveryFormat().decode(await wrapped(bytes,1024,'0'.repeat(64)),signal())).rejects.toThrow('EXPANSION_LIMIT');
  });
  it('rejects an actual256MiB+1 expansion at the fixed ceiling without building the uncompressed test input',async()=>{
    const zipper=createGzip(),chunks:Buffer[]=[];zipper.on('data',b=>chunks.push(b));const done=once(zipper,'end'),block=Buffer.alloc(1024*1024,120);
    for(let i=0;i<256;i++)if(!zipper.write(block))await once(zipper,'drain');zipper.end(Buffer.from([120]));await done;
    const a={kind:'INTERNAL_FEE_WORKBENCH_RECOVERY_ARCHIVE',version:'0.1',encoding:'GZIP_BASE64_UTF8',raw_bytes:limits.raw_bytes,sha256:'0'.repeat(64),data:Buffer.concat(chunks).toString('base64'),financial_writes:0,import_authority:false,confirmation_authority:false};
    await expect(new FeeRecoveryFormat().decode(JSON.stringify(a),signal())).rejects.toThrow('EXPANSION_LIMIT');
  },90000);
  it('keeps pre-abort and one outstanding operation distinct, releasing only after actual crypto settles',async()=>{
    const f=fixture(),c=new FeeRecoveryFormat(),controller=new AbortController();controller.abort('PRIVATE');await expect(c.encode(f.parts,f.supplement,controller.signal)).rejects.toThrow('CANCELLED');
    let finish!:(v:ArrayBuffer)=>void;const held=new Promise<ArrayBuffer>(yes=>{finish=yes;}),spy=vi.spyOn(crypto.subtle,'digest').mockImplementationOnce(()=>held),s=new AbortController();
    try{const old=c.encode(f.parts,f.supplement,s.signal).catch(e=>e.code);s.abort();expect(c.state()).toBe('WORKING');await expect(c.decode('BAD',signal())).rejects.toThrow('BUSY');finish(new Uint8Array(32).buffer);expect(await old).toBe('CANCELLED');expect(c.state()).toBe('IDLE');}finally{finish(new Uint8Array(32).buffer);spy.mockRestore();}
  });
  it('uses exact48MiB plain data and switches AUTO to gzip at the next byte',async()=>{
    const f=fixture(),c=new FeeRecoveryFormat();f.supplement.extensions={raw:''};const fixed=Buffer.byteLength(await c.encode(f.parts,f.supplement,signal(),{compression:'NONE',captured_at}));
    f.supplement.extensions.raw='x'.repeat(limits.plain_bytes-fixed);const exact=await c.encode(f.parts,f.supplement,signal(),{compression:'NONE',captured_at});expect(Buffer.byteLength(exact)).toBe(limits.plain_bytes);
    f.supplement.extensions.raw+='x';await expect(c.encode(f.parts,f.supplement,signal(),{compression:'NONE',captured_at})).rejects.toThrow('PLAIN_SIZE');
    const compressed=await c.encode(f.parts,f.supplement,signal(),{captured_at}),a=JSON.parse(compressed);expect(a.kind).toBe('INTERNAL_FEE_WORKBENCH_RECOVERY_ARCHIVE');expect(a.raw_bytes).toBe(limits.plain_bytes+1);expect(gunzipSync(Buffer.from(a.data,'base64')).length).toBe(limits.plain_bytes+1);
    expect((await c.decode(compressed,signal())).supplement.extensions.raw).toBe(f.supplement.extensions.raw);
  },90000);
  it('counts the complete supplemental data together with the old capture before starting crypto',async()=>{
    const f=fixture();(f.parts.retained_root as Record<string,unknown>).sensitivity={raw:'x'.repeat(50*1024*1024)};f.supplement.extensions={raw:'y'.repeat(80*1024*1024)};
    const spy=vi.spyOn(crypto.subtle,'digest');try{await expect(new FeeRecoveryFormat().encode(f.parts,f.supplement,signal(),{captured_at})).rejects.toThrow('LOGICAL_SIZE');expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}
  },90000);
});
