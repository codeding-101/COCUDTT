import {beforeAll, describe, expect, it} from 'vitest';
import {captureFeeWorkbenchSourceFrame as capture, projectFeeSourceFrameToLegacy as project, observeFeeSourceStorage, FEE_SOURCE_STORAGE_KEYS, type FeeWorkbenchSourceFrame} from '../src/ui/fee-workbench-source-adapter';
import {feeSourceAdapterFixture} from '../tools/fee-source-adapter-fixture';
import {serializeProject} from '../src/data/project-file';
import {booksToRows, rowsToBooks} from '../src/ui/fx-rows';

describe('browser-compatible source adapter independent contract', () => {
  let base: FeeWorkbenchSourceFrame;
  beforeAll(async () => {
    const f=await feeSourceAdapterFixture(); base=structuredClone(capture(f.h.owner,f.readers));
    // Small diagnostic states for flag truth tables. Real populated controllers are tested separately.
    base.producers.bill.draft=null; base.producers.pair.pair=null;
    base.producers.attachment.attachment=null; base.producers.attachment.observed={};
    base.producers.precision.selection=null; base.producers.precision.observed={};
    Object.assign(base.producers.envelope,{current:null,origin_raw:null,previous_raw:null,incoming_raw:null,observed_local_raw:null,retained_local_raw:null,last_write_raw:null,last_cache_write_raw:null,saved_raw:null});
    for(const c of [base.producers.bill.capture,base.producers.pair.capture,base.producers.attachment,base.producers.precision,base.producers.envelope])c.file_evidence={name:null,saved_raw:null,saved_at:null};
    const app=base.producers.project!;
    app.project.fx_books=[{id:'synthetic-adapter-market',name:'SYNTHETIC_MARKET',type:'MARKET',date:'2026-01-01',rates:{'USD/CNY':'7'}}];
    app.fxRows=booksToRows(app.project.fx_books); base.producers.workflow.pairFxLease={row_key:JSON.stringify(app.fxRows),books:structuredClone(app.project.fx_books)};
  },60000);
  const fresh=()=>structuredClone(base);
  it('retains the original committed sources, file evidence and raw unknown profit inputs', () => {
    const legacy=project(base), p=base.producers;
    expect(legacy.sources.project_json).toBe(serializeProject(p.project!.project));
    expect(legacy.envelope_json).toBe(p.envelope.current?.raw_json??null);
    expect(legacy.files.attachment).toStrictEqual(p.attachment.file_evidence); expect(legacy.files.precision).toStrictEqual(p.precision.file_evidence);
    expect(JSON.parse(legacy.retained_json).project_file).toEqual({name:null,saved_at:null,dirty:true,saved_raw_known:false});
    expect(legacy.blockers).toEqual([]); expect(Object.isFrozen(legacy.sources)).toBe(true);
  });
  it('preserves a matching FX lease including book identity and unknown book extensions', () => {
    const f=fresh(), app=f.producers.project!, w=f.producers.workflow;
    w.pairFxLease!.books[0]!.name='SYNTHETIC_PRESERVED_BOOK'; Object.assign(w.pairFxLease!.books[0]!,{unknown_extension:{literal:'KEEP'}});
    const legacy=project(f), source=JSON.parse(legacy.sources.project_json!);
    expect(source.fx_books).toStrictEqual(w.pairFxLease!.books); expect(legacy.fx.preserved_books_json).toBe(JSON.stringify(w.pairFxLease!.books));
    expect(legacy.fx.rows_json).toBe(JSON.stringify(app.fxRows));
  });
  it('reconstructs from changed FX rows while separately retaining the old books and raw rows', () => {
    const f=fresh(), app=f.producers.project!, before=JSON.stringify(f.producers.workflow.pairFxLease!.books); app.fxRows[0]!.rate='9.123456';
    const legacy=project(f); expect(JSON.parse(legacy.sources.project_json!).fx_books).toStrictEqual(rowsToBooks(app.fxRows));
    expect(legacy.fx.preserved_books_json).toBe(before); expect(legacy.fx.rows_json).toBe(JSON.stringify(app.fxRows));
    expect(JSON.parse(legacy.retained_json).project_raw).toStrictEqual(app.project);
  });
  it('preserves incomplete FX input separately from the original project books', () => {
    const f=fresh(); f.producers.project!.fxRows[0]!.rate=''; const legacy=project(f);
    expect(JSON.parse(legacy.fx.rows_json)[0].rate).toBe('');
    expect(JSON.parse(legacy.retained_json).project_raw.fx_books).toStrictEqual(base.producers.project!.project.fx_books);
  },60000);
  it('keeps uninitialized project values unknown without borrowing the previous project', () => {
    const f=fresh(); f.producers.workflow.stateInitialized=false; f.producers.project=null;
    const legacy=project(f), retained=JSON.parse(legacy.retained_json);
    expect(legacy.sources.project_json).toBeNull(); expect(legacy.fx.rows_json).toBe('[]'); expect(legacy.files.project).toEqual({name:null,saved_raw:null,saved_at:null});
    expect(retained.project_raw).toBeNull(); expect(retained.project_file).toEqual({name:null,saved_at:null,dirty:null,saved_raw_known:false});
  });
  it('rejects inconsistent initialization rather than substituting a default project', () => {
    const f=fresh(); f.producers.workflow.stateInitialized=false; expect(()=>project(f)).toThrow('UNINITIALIZED_PROJECT');
    f.producers.workflow.stateInitialized=true; f.producers.project=null; expect(()=>project(f)).toThrow('SHAPE');
  });
  it.each(['absent','pending_only','unsupported_control','form_control'])('preserves %s pending input separately from committed sources', kind => {
    const f=fresh(); f.producers.workflow.pendingCalculation=kind==='pending_only';
    f.pending=kind==='form_control'?{present:true,control:{tag:'INPUT',id:'pending',type:'text',value:'{未提交\r\n',dataset:{path:'name'},connected:false}}:{present:kind==='unsupported_control',control:null};
    const legacy=project(f);
    if(kind==='absent')expect(legacy.editors.pending_input).toBeNull();
    else expect(JSON.parse(legacy.editors.pending_input!)).toEqual({pending_calculation:kind==='pending_only',control:f.pending.control});
    expect(legacy.sources.project_json).toBe(project(base).sources.project_json);
  });
  it.each(['projectSaveBusy','projectResourceBusy','settlementBusy','customerSummaryBusy','customerPdfBusy'] as const)('includes file blocker for %s without inventing a fee', field => {
    const f=fresh(); f.producers.workflow[field]=true;
    expect(project(f).blockers).toEqual(['ACTIVE_FILE_WRITE']);
  });
  it.each(['reading','mutation_busy','write_busy','cache_busy','preview','workspace_pending','workspace_busy','workspace_exporting'])('includes envelope blocker for %s', field => {
    const f=fresh(); if(field==='preview') Object.assign(f.producers.envelope,{preview:{synthetic:'UNADOPTED'}});
    else if(field==='workspace_pending')Object.assign(f.producers.envelope_workspace,{pending:{synthetic:'PENDING'}});
    else if(field==='workspace_busy')f.producers.envelope_workspace.busy=true;
    else if(field==='workspace_exporting')f.producers.envelope_workspace.exporting=true;
    else Object.assign(f.producers.envelope,{[field]:true});
    expect(project(f).blockers).toEqual(['ACTIVE_ENVELOPE']);
  });
  it.each(['reading','mutation_busy','write_busy','preview','recovery','workspace_pending','workspace_exporting'])('retains attachment and precision activity for %s', field => {
    const f=fresh(); for(const source of ['attachment','precision'] as const){
      if(field==='preview'||field==='recovery')Object.assign(f.producers[source],{[field]:{synthetic:'PENDING'}});
      else if(field==='workspace_pending')Object.assign(source==='attachment'?f.producers.attachment_workspace:f.producers.precision_workspace,{pending:{synthetic:'PENDING'}});
      else if(field==='workspace_exporting')(source==='attachment'?f.producers.attachment_workspace:f.producers.precision_workspace).export_busy=true;
      else Object.assign(f.producers[source],{[field]:true});
    }
    const legacy=project(f); expect(legacy.activity.attachment_mutation).toBe(true); expect(legacy.activity.precision_mutation).toBe(true);
  });
  it('keeps source failure and all independent blockers in the original order', () => {
    const f=fresh(); Object.assign(f.producers.project!.fxRows[0]!,{rate:7}); f.producers.envelope.cache_busy=true; f.producers.workflow.customerPdfBusy=true;
    const legacy=project(f); expect(legacy.sources.project_json).toBeNull(); expect(legacy.blockers).toEqual(['INVALID_FX_OR_PROJECT','ACTIVE_ENVELOPE','ACTIVE_FILE_WRITE']);
    expect(JSON.parse(legacy.fx.rows_json)[0].rate).toBe(7);
  });
  it('keeps project read token identity, stale tokens and recovery separate', () => {
    const f=fresh(); f.producers.workflow.projectReadEpoch=8; f.producers.workflow.projectReadToken=7;
    expect(project(f).activity.project_read).toBe(false); f.producers.workflow.projectReadToken=8; expect(project(f).activity.project_read).toBe(true);
    f.producers.workflow.recoveryReviewBusy=true; expect(project(f).activity.recovery).toBe(true);
  });
  it('does not invent a save receipt or combine equal saved texts from different files', () => {
    const f=fresh(), raw='\uFEFFSYNTHETIC\r\n{"unknown":'.repeat(10);
    f.producers.project!.fileEvidence={name:'报价A.json',saved_raw:raw,saved_at:null}; f.producers.project!.fileName='报价A.json'; f.producers.project!.dirty=true;
    f.producers.bill.capture.file_evidence={name:'账单B.json',saved_raw:raw,saved_at:'SYNTHETIC_TIME'};
    const legacy=project(f); expect(legacy.files.project.saved_at).toBeNull(); expect(legacy.files.bill.saved_at).toBe('SYNTHETIC_TIME'); expect(legacy.files.project).not.toBe(legacy.files.bill);
    expect(JSON.parse(legacy.retained_json).project_file).toEqual({name:'报价A.json',saved_at:null,dirty:true,saved_raw_known:true});
  });
  it.each(['missing_flag','boolean_string','missing_storage','unavailable_raw','unknown_root','wrong_version','live_getter'])('rejects %s frame corruption without normalizing it to a valid input', kind => {
    const f=fresh(); let called=false;
    if(kind==='missing_flag')delete (f.producers.workflow as unknown as Record<string,unknown>).pendingCalculation;
    if(kind==='boolean_string')Object.assign(f.producers.workflow,{projectSaveBusy:'false'});
    if(kind==='missing_storage')delete f.storage[FEE_SOURCE_STORAGE_KEYS[0]!];
    if(kind==='unavailable_raw')f.storage[FEE_SOURCE_STORAGE_KEYS[0]!] = {raw:'MISSING_IS_NOT_UNAVAILABLE',available:false};
    if(kind==='unknown_root')Object.assign(f,{unknown:true}); if(kind==='wrong_version')Object.assign(f,{version:'FUTURE'});
    if(kind==='live_getter')Object.defineProperty(f.pending,'control',{enumerable:true,get:()=>{called=true;return null;}});
    expect(()=>project(f)).toThrow(); expect(called).toBe(false);
  });
});

describe('storage observation preserves absence, unreadability and raw text', () => {
  it('observes the exact ten original keys once without requiring a writer', () => {
    const seen:string[]=[], result=observeFeeSourceStorage(key=>{seen.push(key);return key===FEE_SOURCE_STORAGE_KEYS[0]?'':null;});
    expect(seen).toEqual(FEE_SOURCE_STORAGE_KEYS); expect(seen).toHaveLength(10);
    expect(result[seen[0]!]).toEqual({raw:'',available:true}); expect(result[seen[1]!]).toEqual({raw:null,available:true});
  });
  it('keeps a failed key unavailable while continuing to preserve other corrupt original text', () => {
    const raw='\uFEFF{未完成\r\n', result=observeFeeSourceStorage(key=>{if(key===FEE_SOURCE_STORAGE_KEYS[0])throw Error('SYNTHETIC_STORAGE_DENIED');return raw;});
    expect(result[FEE_SOURCE_STORAGE_KEYS[0]!]).toEqual({raw:null,available:false}); expect(result[FEE_SOURCE_STORAGE_KEYS[1]!]).toEqual({raw,available:true});
  });
  it('rejects a non-native storage return value instead of coercing undefined to absent', () => {
    expect(()=>observeFeeSourceStorage(()=>undefined as unknown as null)).toThrow('STORAGE_VALUE');
  });
});
