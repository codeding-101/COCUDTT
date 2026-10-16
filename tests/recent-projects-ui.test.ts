import { describe, it, expect, vi } from 'vitest';
import { RecentProjectsController, type RecentProjectsEnvironment } from '../src/ui/recent-projects-controller';
import { renderRecentProjects } from '../src/ui/recent-projects';
import { RECENT_PROJECTS_KEY, addRecentProject } from '../src/data/recent-projects';
import { sampleProjectFile } from '../src/data/sample-project';
import { serializeProject } from '../src/data/project-file';

const date='2026-10-16T01:00:00.000Z';
const text=(name='SNAPSHOT')=>serializeProject({...sampleProjectFile(),name,updated_at:date});
function fixture(raw:string|null=null) {
 const storage=new Map<string,string>([['unrelated','KEEP']]);if(raw!==null)storage.set(RECENT_PROJECTS_KEY,raw);
 let context='original',project=text(),blocked=false,id=0;
 const env:RecentProjectsEnvironment={
  storage:{getItem:vi.fn(k=>storage.get(k)??null),setItem:vi.fn((k,v)=>{storage.set(k,v)}),removeItem:vi.fn(k=>{storage.delete(k)})},
  context:()=>context,capture:()=>project,captureIssues:()=>[],install:vi.fn(()=>true),write:vi.fn(async()=> 'SAVED' as const),render:vi.fn(),blocked:()=>blocked,id:()=>`p${++id}`,now:()=>date,
 };
 const c=new RecentProjectsController(env);
 const action=(action:string,id?:string,g=String(c.generation))=>c.action(action,g,id);
 const accept=(field='copy',checked=true,g=String(c.generation))=>c.accept(field,checked,g);
 const load=()=>action('recent-refresh');
 const add=()=>{accept();action('recent-add')};
 const prepare=(kind='open',id='p1')=>{action(`recent-prepare-${kind}`,id);accept('action')};
 return {c,env,storage,action,accept,load,add,prepare,edit:()=>{context+='changed'},project:(value:string)=>{project=value},block:()=>{blocked=true}};
}
const one=(value=text())=>addRecentProject(null,{id:'p1',added_at:date,project_text:value},true).raw;
describe('recent project UI controller and renderer',()=>{
 it('construction and initial collapsed render perform zero storage IO',()=>{
  const f=fixture();expect(renderRecentProjects(f.c,false)).toContain('尚未读取');expect(f.env.storage.getItem).not.toHaveBeenCalled();expect(f.env.storage.setItem).not.toHaveBeenCalled();expect(f.c.read).toBeNull();
 });
 it('explicit read is memory-only and does not mutate business or write an empty catalog',()=>{
  const f=fixture();f.load();expect(f.c.read?.status).toBe('ready');expect(f.env.install).not.toHaveBeenCalled();expect(f.env.storage.setItem).not.toHaveBeenCalled();expect(f.storage.size).toBe(1);
 });
 it('requires explicit copy consent, and a successful capture revokes it',()=>{
  const f=fixture();f.load();f.action('recent-add');expect(f.storage.has(RECENT_PROJECTS_KEY)).toBe(false);f.add();expect(f.c.copyAccepted).toBe(false);expect(f.storage.has(RECENT_PROJECTS_KEY)).toBe(true);expect(f.env.install).not.toHaveBeenCalled();
 });
 it('retains exact precision and extensions; exact duplicate has no second write',()=>{
  const f=fixture();const p=sampleProjectFile();p.goods.quantity='123.123456789012345678';const extended={...p,private_extension:'PRIVATE_RAW'};const original=serializeProject(extended);f.project(original);f.load();f.add();f.add();expect(f.env.storage.setItem).toHaveBeenCalledTimes(1);expect(JSON.parse(f.storage.get(RECENT_PROJECTS_KEY)!).entries[0].project_text).toBe(original);expect(f.c.message).toContain('未重复');
 });
 it.each(['汇率行尚未填写完整','重复币种对'])('refuses lossy FX projection: %s',issue=>{
  const f=fixture();f.env.captureIssues=()=>[issue];f.load();f.add();expect(f.c.message).toContain(issue);expect(f.env.storage.setItem).not.toHaveBeenCalled();expect(f.env.install).not.toHaveBeenCalled();
 });
 it('state change revokes capture consent before writing even without an input event',()=>{
  const f=fixture();f.load();f.accept();f.edit();f.action('recent-add');expect(f.env.storage.setItem).not.toHaveBeenCalled();expect(f.c.copyAccepted).toBe(false);
 });
 it('does not evict or replace same-name differing text when full',()=>{
  const f=fixture();f.load();for(let n=0;n<3;n++){f.project(text('SAME'+n));f.add();}const raw=f.storage.get(RECENT_PROJECTS_KEY);f.project(text('FOURTH'));f.add();expect(f.storage.get(RECENT_PROJECTS_KEY)).toBe(raw);expect(f.c.message).toContain('3份');
 });
 it('opening requires preparation, separate acceptance and execute; leaves cache raw untouched',()=>{
  const raw=one(),f=fixture(raw);f.load();f.action('recent-prepare-open','p1');f.action('recent-execute');expect(f.env.install).not.toHaveBeenCalled();f.accept('action');f.action('recent-execute');expect(f.env.install).toHaveBeenCalledExactlyOnceWith(text());expect(f.storage.get(RECENT_PROJECTS_KEY)).toBe(raw);expect(f.env.storage.setItem).not.toHaveBeenCalled();
 });
 it('edits revoke prepared opening and stale DOM acceptance cannot restore it',()=>{
  const f=fixture(one());f.load();f.prepare();const old=String(f.c.generation);f.edit();f.accept('action',true,old);f.action('recent-execute',undefined,old);expect(f.env.install).not.toHaveBeenCalled();expect(f.c.prepared).toBeNull();expect(f.c.actionAccepted).toBe(false);
 });
 it('uncommitted input invalidation revokes consent immediately',()=>{
  const f=fixture(one());f.load();f.prepare();expect(f.c.invalidate()).toBe(true);expect(f.c.prepared).toBeNull();expect(f.c.actionAccepted).toBe(false);expect(f.c.invalidate()).toBe(false);
 });
 it('renderer guard rejects asynchronous changes to independent editing state',()=>{
  const f=fixture(one());f.load();f.prepare();f.edit();expect(renderRecentProjects(f.c,true)).not.toContain('data-recent-field="action"');expect(f.c.prepared).toBeNull();
 });
 it('changed cache is caught on execute without relying on storage events',()=>{
  const f=fixture(one());f.load();f.prepare();const other=one(text('OTHER'));f.storage.set(RECENT_PROJECTS_KEY,other);f.action('recent-execute');expect(f.env.install).not.toHaveBeenCalled();expect(f.storage.get(RECENT_PROJECTS_KEY)).toBe(other);expect(f.c.actionAccepted).toBe(false);
 });
 it('external events do nothing until user reads; afterwards revoke even equal-raw acceptance',()=>{
  const f=fixture(one());f.c.externalChange();expect(f.env.storage.getItem).not.toHaveBeenCalled();f.load();f.prepare();f.c.externalChange();expect(f.c.prepared).toBeNull();expect(f.c.actionAccepted).toBe(false);
 });
 it('delete removes only selected cache entry and never installs a project',()=>{
  const f=fixture(one());f.load();f.prepare('delete');f.action('recent-execute');expect(JSON.parse(f.storage.get(RECENT_PROJECTS_KEY)!).entries).toEqual([]);expect(f.storage.get('unrelated')).toBe('KEEP');expect(f.env.install).not.toHaveBeenCalled();
 });
 it('cancel preserves current and cached state',()=>{
  const raw=one(),f=fixture(raw);f.load();f.prepare();f.action('recent-cancel');f.action('recent-execute');expect(f.storage.get(RECENT_PROJECTS_KEY)).toBe(raw);expect(f.env.install).not.toHaveBeenCalled();
 });
 it('bad cache supports exact raw backup and explicit target-only clear',async()=>{
  const raw=' {"future":42} \n',f=fixture(raw);f.load();expect(f.c.read?.status).toBe('invalid');expect(renderRecentProjects(f.c,true)).not.toContain('data-recent-field="copy"');f.action('recent-backup');await vi.waitFor(()=>expect(f.c.busy).toBe(false));expect(f.env.write).toHaveBeenCalledExactlyOnceWith('COCUDTT-recent-projects-internal.json',raw,'application/json');f.prepare('clear');f.action('recent-execute');expect(f.storage.has(RECENT_PROJECTS_KEY)).toBe(false);expect(f.storage.get('unrelated')).toBe('KEEP');
 });
 it('empty malformed raw is backupable, and clear cannot skip acceptance',async()=>{
  const f=fixture('');f.load();f.action('recent-backup');await vi.waitFor(()=>expect(f.c.busy).toBe(false));expect(f.env.write).toHaveBeenCalledWith(expect.any(String),'',expect.any(String));f.action('recent-prepare-clear');f.action('recent-execute');expect(f.storage.has(RECENT_PROJECTS_KEY)).toBe(true);
 });
 it('blocked/unavailable storage offers no business mutation or hidden fallback',()=>{
  const f=fixture();f.env.storage.getItem=()=>{throw Error('SECRET')};f.load();expect(f.c.read?.status).toBe('unavailable');f.add();expect(f.env.storage.setItem).not.toHaveBeenCalled();expect(renderRecentProjects(f.c,true)).not.toContain('SECRET');f.block();f.load();expect(f.env.install).not.toHaveBeenCalled();
 });
 it('quota failure leaves current data and original catalog; consent revoked',()=>{
  const f=fixture();f.env.storage.setItem=()=>{throw Error('SECRET_QUOTA')};f.load();f.add();expect(f.storage.has(RECENT_PROJECTS_KEY)).toBe(false);expect(f.env.install).not.toHaveBeenCalled();expect(f.c.message).toContain('未获确认');expect(f.c.copyAccepted).toBe(false);
 });
 it('remove failure is unconfirmed and retains cache',()=>{
  const raw=one(),f=fixture(raw);f.env.storage.removeItem=()=>{throw Error('SECRET')};f.load();f.prepare('clear');f.action('recent-execute');expect(f.storage.get(RECENT_PROJECTS_KEY)).toBe(raw);expect(f.c.message).toContain('未获确认');expect(f.env.install).not.toHaveBeenCalled();
 });
 it.each(['AbortError','Error'])('backup %s does not change raw or falsely say saved',async name=>{
  const raw=one(),f=fixture(raw);f.env.write=vi.fn(async()=>{const e=Error('PRIVATE_WRITE');e.name=name;throw e});f.load();f.action('recent-backup');await vi.waitFor(()=>expect(f.c.busy).toBe(false));expect(f.storage.get(RECENT_PROJECTS_KEY)).toBe(raw);expect(f.c.message).not.toContain('已保存');expect(f.c.message).not.toContain('PRIVATE_WRITE');
 });
 it('backup does not allow duplicate operations or overwrite a newer tab notification',async()=>{
  const f=fixture(one());let resolve!:(v:'SAVED')=>void;f.env.write=()=>new Promise(r=>{resolve=r});f.load();f.action('recent-backup');f.prepare('clear');expect(f.c.prepared).toBeNull();f.c.externalChange();const message=f.c.message;resolve('SAVED');await vi.waitFor(()=>expect(f.c.busy).toBe(false));expect(f.c.message).toBe(message);
 });
 it('download fallback only reports started, never saved',async()=>{
  const f=fixture(one());f.env.write=async()=>'DOWNLOAD_STARTED';f.load();f.action('recent-backup');await vi.waitFor(()=>expect(f.c.busy).toBe(false));expect(f.c.message).toContain('已发起');expect(f.c.message).toContain('不代表文件已保存');
 });
 it('titles are escaped and limited; project raw and unknown secrets are never rendered',()=>{
  const p={...sampleProjectFile(),name:'<img src=x onerror=alert(1)>'.repeat(20),secret:'INTERNAL_NOT_FOR_DOM'};const f=fixture(one(serializeProject(p)));f.load();const html=renderRecentProjects(f.c,true);expect(html).toContain('&lt;img');expect(html).not.toContain('<img');expect(html).not.toContain('INTERNAL_NOT_FOR_DOM');expect(html).not.toContain('project_text');expect(html).not.toContain(p.name);f.prepare();expect(renderRecentProjects(f.c,true)).toContain('标识 p1');
 });
 it('missing ids and forged stale controls cannot install or delete another entry',()=>{
  const f=fixture(one());f.load();f.action('recent-prepare-open','missing');expect(f.c.prepared).toBeNull();f.action('recent-prepare-delete','p1','-1');expect(f.c.prepared).toBeNull();expect(f.env.install).not.toHaveBeenCalled();expect(f.env.storage.setItem).not.toHaveBeenCalled();
 });
});
