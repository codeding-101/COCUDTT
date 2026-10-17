import {afterEach,describe,expect,it,vi} from 'vitest';
import {FeeTaxAttachmentWorkspace} from '../src/ui/fee-tax-attachment-workspace';
import {changeFeeTaxForm,newFeeTaxForm,readFeeTaxForm} from '../src/ui/fee-tax-attachment-form';
import {FEE_TAX_ATTACHMENT_STORAGE_KEYS} from '../src/ui/fee-tax-attachment-controller';
import {completePair} from './fixtures/fee-tax-attachment';
import {unzipSync,strFromU8} from 'fflate';
afterEach(()=>vi.unstubAllGlobals());
function setup(){
 vi.stubGlobal('document',{querySelector:()=>null});
 const sample=completePair();let raw:string|null=sample.raw,blocked=false;
 const storage=new Map<string,string>(),writes:{name:string,data:string|Uint8Array<ArrayBuffer>,mime:string}[]=[];
 const workspace=new FeeTaxAttachmentWorkspace({storage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>{storage.set(k,v);}},currentPairText:()=>raw,blocked:()=>blocked,write:async(name,data,mime)=>{writes.push({name,data,mime});return'SAVED';}});
 const action=(key:string,data:Record<string,string>={})=>workspace.action('fee-tax-'+key,data);
 const confirm=async()=>{const token=workspace.render().match(/data-action="fee-tax-confirm"[^>]*data-fee-tax-token="([^"]+)"/)?.[1];expect(token).toBeTruthy();await action('confirm',{feeTaxToken:token!});};
 const create=async()=>{await action('create');await confirm();};
 return{sample,workspace,storage,writes,action,confirm,create,setRaw:(value:string|null)=>{raw=value;},block:()=>{blocked=true;}};
}
describe('structured attachment form',()=>{
 it('starts with unknown assumptions and no copied money or sources',()=>{
  const sample=completePair(),f=newFeeTaxForm(sample.record.target,'component-new');expect(f.input).toEqual({line_id:'component-new',currency:'',gross:null,tax:{kind:'UNKNOWN'},credit:{kind:'UNKNOWN'},customs:{kind:'UNKNOWN'}});expect(f.sources.tax.provenance).toBe('UNSPECIFIED');
 });
 it('preserves exact decimal text, explicit zero and source whitespace',()=>{
  let text=JSON.stringify(completePair().record);text=changeFeeTaxForm(text,'input.gross','0.000000000000000001')!;text=changeFeeTaxForm(text,'sources.credit.reference','  private proof  ')!;expect(readFeeTaxForm(text)?.input.gross).toBe('0.000000000000000001');expect(readFeeTaxForm(text)?.sources.credit.reference).toBe('  private proof  ');expect(readFeeTaxForm(changeFeeTaxForm(text,'input.gross','0')!)?.input.gross).toBe('0');expect(readFeeTaxForm(changeFeeTaxForm(text,'input.gross','')!)?.input.gross).toBeNull();
 });
 it('changes only the selected branch, never generates a rate or a source confirmation',()=>{
  const r=completePair().record,changed=readFeeTaxForm(changeFeeTaxForm(JSON.stringify(r),'input.tax.kind','EXPLICIT')!)!;expect(changed.input.tax).toEqual({kind:'EXPLICIT',net:'',tax:''});expect(changed.input.credit).toEqual(r.input.credit);expect(changed.sources).toEqual(r.sources);expect(changeFeeTaxForm(JSON.stringify(r),'input.credit.kind','ASSUMED')).toContain('"eligibility_ref": ""');
 });
 it.each(['target.mapping_id','input.line_id','input.__proto__.x','sources.tax.constructor','sources.tax.status','input.tax.amount','unknown'])('rejects forbidden field %s without modifying the source',path=>{const text=JSON.stringify(completePair().record);expect(changeFeeTaxForm(text,path,'bad')).toBeNull();expect(readFeeTaxForm(text)?.input.gross).toBe('113');});
 it.each(['{"input":','null','[]','{"target":{},"input":{},"sources":{}}'])('keeps malformed recovery opaque: %s',text=>expect(readFeeTaxForm(text)).toBeNull());
 it('does not project duplicate keys, unknown extensions, unknown branches or wrong scalar types',()=>{
  const r=completePair().record;expect(readFeeTaxForm(JSON.stringify({...r,extension:'private'}))).toBeNull();expect(readFeeTaxForm(JSON.stringify(r).replace('"gross":"113"','"gross":"113","gross":"0"'))).toBeNull();expect(readFeeTaxForm(JSON.stringify({...r,input:{...r.input,tax:{kind:'FUTURE'}}}))).toBeNull();expect(readFeeTaxForm(JSON.stringify({...r,input:{...r.input,gross:113}}))).toBeNull();
 });
});
describe('workspace binding, explicit actions and audience',()=>{
 it('requires explicit replacement confirmation and rechecks the full live basis',async()=>{
  const t=setup();await t.action('create');expect(t.workspace.controller.state().attachment).toBeNull();t.setRaw(null);await t.confirm();expect(t.workspace.controller.state().attachment).toBeNull();expect(t.workspace.render()).toContain('资料已变化');
 });
 it('chooses a mapping explicitly and copies only exact bill facts on request',async()=>{
  const t=setup();await t.create();await t.action('add');expect(t.workspace.render()).toContain('目标不会自动猜测');t.workspace.field('target',t.sample.record.target.mapping_id);let f=readFeeTaxForm(t.workspace.controller.state().editor!.record_json)!;expect(f.input.gross).toBeNull();expect(f.input.currency).toBe('');await t.action('facts');f=readFeeTaxForm(t.workspace.controller.state().editor!.record_json)!;expect(f.input.gross).toBe('113');expect(f.input.currency).toBe('USD');expect(f.input.tax.kind).toBe('UNKNOWN');expect(f.sources.tax.provenance).toBe('UNSPECIFIED');
 });
 it('keeps unfinished structured input in its own draft and blocks all committed exports',async()=>{
  const t=setup();await t.create();await t.action('add');t.workspace.field('target',t.sample.record.target.mapping_id);t.workspace.field('input.gross','not a number',true);expect(JSON.parse(t.storage.get(FEE_TAX_ATTACHMENT_STORAGE_KEYS.editor)!).record_json).toContain('not a number');await t.action('submit');expect(t.workspace.controller.state().editor).not.toBeNull();expect(t.workspace.controller.state().attachment?.records).toHaveLength(0);for(const action of['save','html','xlsx'])await t.action(action);expect(t.writes).toHaveLength(0);
 });
 it('submits explicit unknowns without zero filling; exports standalone internal HTML and real XLSX',async()=>{
  const t=setup();await t.create();await t.action('add');t.workspace.field('target',t.sample.record.target.mapping_id);t.workspace.field('input.currency','USD');await t.action('submit');expect(t.workspace.controller.state().editor).toBeNull();const a=t.workspace.controller.state().attachment!;expect(a.records[0]!.input.gross).toBeNull();const project=JSON.stringify(t.sample.pair.project);await t.action('html');await t.action('xlsx');expect(t.writes.map(x=>x.name)).toEqual(['internal-fee-tax-attachment.html','internal-fee-tax-attachment.xlsx']);expect(t.writes[0]!.data).toContain('未知');const book=Object.values(unzipSync(t.writes[1]!.data as Uint8Array<ArrayBuffer>)).map(b=>strFromU8(b)).join('');expect(book).toContain('INTERNAL_FEE_TAX_ATTACHMENT');expect(book).toContain('未知');expect(JSON.stringify(t.sample.pair.project)).toBe(project);expect(t.workspace.controller.state().dirty).toBe(true);
 });
 it('exports unavailable live source as historical, never as matching the embedded pair',async()=>{
  const t=setup();await t.create();t.setRaw(null);await t.action('html');expect(t.writes[0]!.data).toContain('来源失配');expect(t.writes[0]!.data).not.toContain('与提供的当前配对原文相符');
 });
 it('protects old cache, exposes raw backup, and clears only after explicit CAS confirmation',async()=>{
  const t=setup(),key=FEE_TAX_ATTACHMENT_STORAGE_KEYS.committed;t.storage.set(key,'PRIVATE_OLD_RAW');await t.create();expect(t.storage.get(key)).toBe('PRIVATE_OLD_RAW');await t.action('backup-committed');expect(t.writes[0]!.data).toBe('PRIVATE_OLD_RAW');await t.action('clear-committed');t.storage.set(key,'OTHER_TAB');await t.confirm();expect(t.storage.get(key)).toBe('OTHER_TAB');await t.action('clear-committed');await t.confirm();expect(t.storage.get(key)).toBe('null');expect(t.workspace.controller.state().attachment).not.toBeNull();await t.action('persist');expect(JSON.parse(t.storage.get(key)!).kind).toBe('INTERNAL_FEE_TAX_ATTACHMENT');
 });
 it('keeps destructive confirmation bound to the editor text and honors failure-mode blocking',async()=>{
  const t=setup();await t.create();await t.action('add');await t.action('discard');const token=t.workspace.render().match(/data-action="fee-tax-confirm"[^>]*data-fee-tax-token="([^"]+)"/)![1]!;t.workspace.field('target',t.sample.record.target.mapping_id);await t.action('confirm',{feeTaxToken:token});expect(t.workspace.controller.state().editor).not.toBeNull();t.block();await t.action('discard');expect(t.workspace.controller.state().editor).not.toBeNull();await t.action('backup-memory');expect(t.writes).toHaveLength(0);
 });
});
