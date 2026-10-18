import{afterEach,describe,expect,it,vi}from'vitest';
import{FeePrecisionSelectionWorkspace}from'../src/ui/fee-precision-selection-workspace';
import{readFeePrecisionForm,newFeePrecisionForm,changeFeePrecisionForm}from'../src/ui/fee-precision-selection-form';
import{FEE_PRECISION_SELECTION_STORAGE_KEYS as KEYS,type FeePrecisionCurrentSources}from'../src/ui/fee-precision-selection-controller';
import{parseFeePrecisionSelection}from'../src/data/fee-precision-selection';
import{precisionText,deferred}from'./fixtures/fee-precision-controller';
import{unzipSync,strFromU8}from'fflate';
afterEach(()=>vi.unstubAllGlobals());
async function setup(adopt=true){
 vi.stubGlobal('document',{querySelector:()=>null});
 const a=await parseFeePrecisionSelection(precisionText);let live:FeePrecisionCurrentSources|null={pair_json:a.pair_snapshot_json,attachment_json:a.attachment_snapshot_json},blocked=false;
 const storage=new Map<string,string>(),writes:{name:string,data:string|Uint8Array<ArrayBuffer>,mime:string}[]=[];
 const env={storage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>{storage.set(key,value);}},currentSources:()=>live,blocked:()=>blocked,write:vi.fn(async(name:string,data:string|Uint8Array<ArrayBuffer>,mime:string)=>{writes.push({name,data,mime});return'SAVED' as const;})};
 const w=new FeePrecisionSelectionWorkspace(env),action=(key:string,data:Record<string,string>={})=>w.action('fee-precision-'+key,data);
 const confirm=async()=>{const token=w.render().match(/data-action="fee-precision-confirm"[^>]*data-fee-precision-token="([^"]+)"/)?.[1];expect(token).toBeTruthy();await action('confirm',{feePrecisionToken:token!});};
 if(adopt){await w.controller.openFile({text:async()=>precisionText});await action('adopt',{feePrecisionId:String(w.controller.state().preview!.token)});await confirm();}
 return{a,w,action,confirm,env,storage,writes,setLive:(v:FeePrecisionCurrentSources|null)=>{live=v;},block:()=>{blocked=true;}};
}
describe('precision structured editor preserves drafts and immutable source fields',()=>{
 it('starts unresolved with no default component, channel, money, mode or rate',()=>{expect(JSON.parse(newFeePrecisionForm())).toEqual({component_record_id:'',channel:'',choice:{kind:'UNRESOLVED'}});});
 it('preserves unfinished exact strings and source whitespace',()=>{
  let raw=changeFeePrecisionForm(newFeePrecisionForm(),true,'choice.kind','FX')!;
  for(const[path,value]of[['policy.unit','0.000001'],['policy.basis','  explicit  '],['rate_source.rate','7.000000000000000001'],['as_of','2026-'],['to','unfinished']])raw=changeFeePrecisionForm(raw,true,path!,value!)!;
  expect(raw).toContain('7.000000000000000001');expect(raw).toContain('  explicit  ');expect(readFeePrecisionForm(raw,true)).not.toBeNull();
 });
 it('requires explicit mode and FX purpose and resets only on explicit branch change',()=>{
  const raw=changeFeePrecisionForm(newFeePrecisionForm(),true,'choice.kind','FX')!,v=JSON.parse(raw);expect(v.choice.policy).toEqual({kind:'EXPLICIT',unit:'',mode:'',basis:''});expect(v.choice.purpose).toBe('');expect(Object.values(v.choice.rate_source).every(x=>x==='')).toBe(true);
  const chosen=changeFeePrecisionForm(raw,true,'component_record_id','component-explicit')!,next=JSON.parse(changeFeePrecisionForm(chosen,true,'choice.kind','ROUND')!);expect(next.component_record_id).toBe('component-explicit');expect(next.choice).toEqual({kind:'ROUND',policy:{kind:'EXPLICIT',unit:'',mode:'',basis:''}});
 });
 it.each(['original','target.cost_id','currency','record_id','choice.amount','policy.kind','policy.__proto__','rate_source.constructor','unknown'])('rejects forbidden path %s without changing raw',path=>{const raw=changeFeePrecisionForm(newFeePrecisionForm(),true,'choice.kind','FX')!;expect(changeFeePrecisionForm(raw,true,path,'0')).toBeNull();});
 it.each(['component_record_id','channel'])('existing choice cannot edit source slot %s',path=>{expect(changeFeePrecisionForm('{"kind":"UNRESOLVED"}',false,path,'cash')).toBeNull();});
 it.each(['null','[]','{','{"kind":"UNRESOLVED","kind":"ROUND"}','{"kind":"UNRESOLVED","extra":"retain"}','{"kind":"FUTURE"}'])('does not silently project unknown recovered raw %s',raw=>expect(readFeePrecisionForm(raw,false)).toBeNull());
 it.each([['policy.mode','FUTURE'],['purpose','UNKNOWN'],['rate_source.type','SPOT'],['channel','profit']])('rejects unknown enumerations %s',([path,value])=>{const raw=changeFeePrecisionForm(newFeePrecisionForm(),true,'choice.kind','FX')!;expect(changeFeePrecisionForm(raw,true,path!,value!)).toBeNull();});
});
describe('precision workspace explicit replacements and dual-source boundaries',()=>{
 it('does not install file preview until both replacement steps are explicit',async()=>{
  const t=await setup(false);await t.w.controller.openFile({text:async()=>precisionText});await t.action('adopt',{feePrecisionId:String(t.w.controller.state().preview!.token)});expect(t.w.controller.state().selection).toBeNull();await t.confirm();expect(t.w.controller.state().selection?.selection_id).toBe(t.a.selection_id);
 });
 it.each(['pair','attachment'])('replacement confirmation binds exact live %s text',async source=>{
  const t=await setup();await t.action('create');t.setLive({pair_json:t.a.pair_snapshot_json+(source==='pair'?'\n':''),attachment_json:t.a.attachment_snapshot_json+(source==='attachment'?'\n':'')});await t.confirm();expect(t.w.controller.state().selection?.content_sha256).toBe(t.a.content_sha256);expect(t.w.render()).toContain('资料已变化');
 });
 it('new records require explicit slot and capture original from source only on submit',async()=>{
  const t=await setup();await t.action('add');expect(t.w.controller.state().editor?.record_json).toBe('');await t.action('start');t.w.field('component_record_id',t.a.records[0]!.component_record_id);t.w.field('channel','tax');await t.action('submit');const r=t.w.controller.state().selection!.records.at(-1)!;expect(r.channel).toBe('tax');expect(r.choice).toEqual({kind:'UNRESOLVED'});expect(r.acknowledgement).toBeNull();expect(r.original).not.toEqual(t.a.records[0]!.original);
 });
 it('keeps incomplete fields in the independent editor and blocks committed exports',async()=>{
  const t=await setup();await t.action('edit',{feePrecisionId:t.a.records[0]!.record_id});t.w.field('policy.unit','unfinished',true);expect(JSON.parse(t.storage.get(KEYS.editor)!).record_json).toContain('unfinished');await t.action('submit');for(const k of['save','html','xlsx'])await t.action(k);expect(t.writes).toHaveLength(0);expect(t.w.controller.state().selection!.content_sha256).toBe(t.a.content_sha256);expect(t.w.controller.state().editor).not.toBeNull();
 });
 it('only edits choice; changing policy clears its receipt without changing exact original',async()=>{
  const t=await setup(),r=t.a.records[0]!;await t.action('ack',{feePrecisionId:r.record_id});await t.action('edit',{feePrecisionId:r.record_id});t.w.field('policy.basis','PRIVATE68 explicit policy');await t.action('submit');const next=t.w.controller.state().selection!.records[0]!;expect(next.original).toEqual(r.original);expect(next.target).toEqual(r.target);expect(next.acknowledgement).toBeNull();expect(next.choice).not.toEqual(r.choice);
 });
 it('exports real internal HTML/XLSX preserving exact values without modifying sources',async()=>{
  const t=await setup();await t.action('html');await t.action('xlsx');expect(t.writes.map(w=>w.name)).toEqual(['internal-fee-precision-selection.html','internal-fee-precision-selection.xlsx']);expect(t.writes[0]!.data).toContain('10050001');const book=Object.values(unzipSync(t.writes[1]!.data as Uint8Array<ArrayBuffer>)).map(b=>strFromU8(b)).join('');expect(book).toContain('INTERNAL_FEE_PRECISION_SELECTION');expect(book).toContain('EXAMPLE');expect(t.env.currentSources()).toEqual({pair_json:t.a.pair_snapshot_json,attachment_json:t.a.attachment_snapshot_json});
 });
 it('blocks audit exports with missing live sources while JSON/backup preserve historical file',async()=>{
  const t=await setup();t.setLive(null);await t.action('html');await t.action('xlsx');expect(t.writes).toHaveLength(0);await t.action('save');await t.action('backup-memory');expect(t.writes).toHaveLength(2);expect(t.w.render()).toContain('历史假设');
 });
 it('binds destructive confirmation to raw editor text and rejects stale tokens',async()=>{
  const t=await setup();await t.action('edit',{feePrecisionId:t.a.records[0]!.record_id});await t.action('discard');const token=t.w.render().match(/data-action="fee-precision-confirm"[^>]*data-fee-precision-token="([^"]+)"/)![1]!;t.w.field('policy.basis','new raw');await t.action('confirm',{feePrecisionToken:token});expect(t.w.controller.state().editor).not.toBeNull();await t.action('remove',{feePrecisionId:t.a.records[0]!.record_id});await t.action('confirm',{feePrecisionToken:'old'});expect(t.w.controller.state().selection!.records).toHaveLength(2);
 });
 it('protects conflicting storage and requires precise raw confirmation before clearing',async()=>{
  const t=await setup();t.storage.set(KEYS.committed,'PRIVATE68_OTHER_TAB');t.w.storageChanged(KEYS.committed);await t.action('backup-committed');expect(t.writes[0]!.data).toBe('PRIVATE68_OTHER_TAB');await t.action('clear-committed');t.storage.set(KEYS.committed,'NEWER_OTHER_TAB');await t.confirm();expect(t.storage.get(KEYS.committed)).toBe('NEWER_OTHER_TAB');await t.action('clear-committed');await t.confirm();expect(t.storage.get(KEYS.committed)).toBe('null');expect(t.w.controller.state().selection).not.toBeNull();
 });
 it('restores only after explicit recovery confirmation and leaves embedded sources detached',async()=>{
  const t=await setup();await t.action('edit',{feePrecisionId:t.a.records[0]!.record_id});t.w.field('policy.basis','pending68');const w=new FeePrecisionSelectionWorkspace(t.env);await w.controller.prepareLocalRecovery();expect(w.controller.state().selection).toBeNull();await w.action('fee-precision-restore',{feePrecisionId:String(w.controller.state().recovery!.token)});expect(w.controller.state().selection).toBeNull();const token=w.render().match(/data-action="fee-precision-confirm"[^>]*data-fee-precision-token="([^"]+)"/)![1]!;await w.action('fee-precision-confirm',{feePrecisionToken:token});expect(w.controller.state().editor!.record_json).toContain('pending68');
 });
 it('freezes click-time internal export and labels changes during asynchronous writing',async()=>{
  const t=await setup(),gate=deferred<'SAVED'>();t.env.write.mockImplementationOnce(async(name,data,mime)=>{t.writes.push({name,data,mime});return gate.promise;});const work=t.action('html');await vi.waitFor(()=>expect(t.env.write).toHaveBeenCalled());await t.action('edit',{feePrecisionId:t.a.records[0]!.record_id});t.w.field('policy.basis','PRIVATE68_PENDING');gate.resolve('SAVED');await work;expect(t.writes[0]!.data).not.toContain('PRIVATE68_PENDING');expect(t.w.render()).toContain('期间资料已变化');expect(t.w.controller.state().editor).not.toBeNull();
 });
 it('failure-mode blocking preserves current memory and prevents actions/exports',async()=>{const t=await setup();t.block();await t.action('create');await t.action('html');await t.action('edit',{feePrecisionId:t.a.records[0]!.record_id});expect(t.writes).toHaveLength(0);expect(t.w.controller.state().editor).toBeNull();expect(t.w.controller.state().selection!.content_sha256).toBe(t.a.content_sha256);});
 it('shows policy, original source provenance and unresolved business issues separately',async()=>{
  const t=await setup();await t.action('ack',{feePrecisionId:t.a.records[0]!.record_id});t.w.afterRender();await vi.waitFor(()=>expect(t.w.render()).toContain('EXAMPLE'));const html=t.w.render();expect(html).toContain('已记录算术政策假设');expect(html).toContain('SOURCE_NOT_USER_SUPPLIED');expect(html).toContain('PROPOSAL_CORE_PRECISION_LOSS');t.setLive(null);t.w.afterRender();await vi.waitFor(()=>expect(t.w.render()).toContain('历史回执不能确认当前政策'));
 });
 it('backs up recovered opaque editor text without dropping unsupported fields',async()=>{
  const t=await setup();await t.action('edit',{feePrecisionId:t.a.records[0]!.record_id});const raw='{"kind":"UNRESOLVED","future":"PRIVATE68_RETAIN"}';t.w.controller.editText(raw);t.w.field('choice.kind','ROUND');expect(t.w.controller.state().editor!.record_json).toBe(raw);expect(t.w.render()).toContain('未重建或删除字段');await t.action('backup-memory');expect(JSON.parse(String(t.writes[0]!.data)).editor_json).toContain('PRIVATE68_RETAIN');
 });
 it('does not claim success on an invalid writer result or expose writer error details',async()=>{
  const t=await setup();t.env.write.mockResolvedValueOnce('INVALID' as 'SAVED');await t.action('html');expect(t.w.render()).toContain('内部导出失败');t.env.write.mockRejectedValueOnce(Error('PRIVATE68_DISK_DETAILS'));await t.action('xlsx');expect(t.w.render()).not.toContain('PRIVATE68_DISK_DETAILS');expect(t.w.controller.state().selection!.content_sha256).toBe(t.a.content_sha256);
 });
 it('cancelled internal export keeps the current file and editable policy',async()=>{
  const t=await setup();t.env.write.mockRejectedValueOnce(new DOMException('cancel','AbortError'));await t.action('html');expect(t.w.render()).toContain('已取消内部导出');await t.action('edit',{feePrecisionId:t.a.records[0]!.record_id});expect(t.w.controller.state().editor).not.toBeNull();
 });
});
