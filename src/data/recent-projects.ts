import { parseProject } from './project-file.js';

export const RECENT_PROJECTS_KEY = 'trade-cost-engine:recent-projects-v1';
export const RECENT_PROJECT_LIMIT = 3;
export const RECENT_PROJECT_MAX_BYTES = 256 * 1024;
export const RECENT_CATALOG_MAX_BYTES = 1024 * 1024;
export type RecentProjectErrorCode = 'INVALID' | 'LIMIT' | 'CONSENT' | 'MISSING' | 'STALE' | 'STORAGE' | 'UNCONFIRMED';
export class RecentProjectError extends Error {
  constructor(readonly code: RecentProjectErrorCode, message: string) { super(message); this.name='RecentProjectError'; }
}
export interface RecentProjectEntry { id: string; added_at: string; project_text: string; }
export interface RecentProjects {
  kind: 'COCUDTT_RECENT_PROJECTS'; version: '1.0'; revision: number; entries: RecentProjectEntry[];
}
function fail(code:RecentProjectErrorCode,message:string):never { throw new RecentProjectError(code,message); }
export const recentProjectBytes=(text:string):number=>new TextEncoder().encode(text).byteLength;
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function keys(value:Record<string,unknown>,expected:readonly string[]):boolean {
  return Object.keys(value).length===expected.length&&expected.every(k=>Object.hasOwn(value,k));
}
function within(text:string,max:number):boolean { return text.length<=max&&recentProjectBytes(text)<=max; }
function validId(value:unknown):value is string { return typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value); }
function validTime(value:unknown):value is string {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return false;
  const time=new Date(value);return Number.isFinite(time.getTime())&&time.toISOString()===value;
}
function checkProject(text:unknown):asserts text is string {
  if(typeof text!=='string')fail('INVALID','项目快照文本无效；请保留原缓存');
  if(!within(text,RECENT_PROJECT_MAX_BYTES))fail('LIMIT','单份项目快照超过256 KiB，请单独保存项目JSON');
  try { parseProject(text); } catch { fail('INVALID','项目快照格式不受支持或结构损坏；原文须保留，不自动替换'); }
}
export function emptyRecentProjects():RecentProjects {
  return {kind:'COCUDTT_RECENT_PROJECTS',version:'1.0',revision:0,entries:[]};
}
/** Validate the entire catalog before returning any entry; never migrate or repair stored text. */
export function parseRecentProjects(raw:string|null):RecentProjects {
  if(raw===null)return emptyRecentProjects();
  if(typeof raw!=='string'||!within(raw,RECENT_CATALOG_MAX_BYTES))fail('LIMIT','最近项目缓存超过1 MiB检查上限，请先备份原文');
  let value:unknown;try { value=JSON.parse(raw); } catch { return fail('INVALID','最近项目缓存不是有效JSON；请先备份原文'); }
  if(!object(value)||!keys(value,['kind','version','revision','entries'])||value.kind!=='COCUDTT_RECENT_PROJECTS'||value.version!=='1.0'||!Number.isSafeInteger(value.revision)||Number(value.revision)<1||!Array.isArray(value.entries))fail('INVALID','最近项目缓存版本或结构无效；不自动覆盖');
  if(value.entries.length>RECENT_PROJECT_LIMIT)fail('LIMIT','最近项目缓存超过3份上限；不自动删除');
  const ids=new Set<string>();
  for(const entry of value.entries){
    if(!object(entry)||!keys(entry,['id','added_at','project_text'])||!validId(entry.id)||!validTime(entry.added_at)||ids.has(entry.id))fail('INVALID','最近项目条目或标识无效；不自动跳过损坏条目');
    checkProject(entry.project_text);ids.add(entry.id);
  }
  return value as unknown as RecentProjects;
}
export function serializeRecentProjects(catalog:RecentProjects):string {
  let raw:string;try { raw=JSON.stringify(catalog); } catch { return fail('INVALID','最近项目无法序列化；不写入缓存'); }
  parseRecentProjects(raw);return raw;
}
function nextRevision(catalog:RecentProjects):number {
  if(catalog.revision>=Number.MAX_SAFE_INTEGER)fail('LIMIT','缓存修订号达到上限，请先备份并清理');
  return catalog.revision+1;
}
/** Manual capture: exact JSON text is the deduplication boundary, not project name or business identity. */
export function addRecentProject(raw:string|null,entry:RecentProjectEntry,acknowledgeLocalCopy:boolean):{raw:string;id:string;added:boolean} {
  if(acknowledgeLocalCopy!==true)fail('CONSENT','请先明确接受在本机增加内部项目副本');
  const catalog=parseRecentProjects(raw);
  if(!object(entry)||!keys(entry,['id','added_at','project_text'])||!validId(entry.id)||!validTime(entry.added_at))fail('INVALID','新快照标识或时间无效');
  checkProject(entry.project_text);
  const same=catalog.entries.find(e=>e.project_text===entry.project_text);
  if(same)return {raw:raw!,id:same.id,added:false};
  if(catalog.entries.some(e=>e.id===entry.id))fail('INVALID','快照标识已存在；不覆盖原条目');
  if(catalog.entries.length>=RECENT_PROJECT_LIMIT)fail('LIMIT','已保留3份项目，请先明确删除不需要的快照；不会自动淘汰');
  const next:RecentProjects={...catalog,revision:nextRevision(catalog),entries:[{id:entry.id,added_at:entry.added_at,project_text:entry.project_text},...catalog.entries]};
  return {raw:serializeRecentProjects(next),id:entry.id,added:true};
}
export function removeRecentProject(raw:string|null,id:string):string {
  const catalog=parseRecentProjects(raw);
  if(!validId(id)||!catalog.entries.some(e=>e.id===id))fail('MISSING','该快照已不存在，请重新读取列表');
  return serializeRecentProjects({...catalog,revision:nextRevision(catalog),entries:catalog.entries.filter(e=>e.id!==id)});
}
/** Return the original project JSON, including unknown extensions and original version text. */
export function recentProjectText(raw:string|null,id:string):string {
  const entry=parseRecentProjects(raw).entries.find(e=>e.id===id);
  if(!entry)fail('MISSING','该快照已不存在，请重新读取列表');
  return entry.project_text;
}
