import { RECENT_PROJECTS_KEY, RecentProjectError, addRecentProject, parseRecentProjects, removeRecentProject, type RecentProjectEntry, type RecentProjects } from './recent-projects.js';

export interface RecentProjectStorage {
  getItem(key:string):string|null; setItem(key:string,value:string):void; removeItem(key:string):void;
}
export type RecentProjectRead =
  | {status:'ready';raw:string|null;catalog:RecentProjects;error:null}
  | {status:'invalid';raw:string;catalog:null;error:RecentProjectError}
  | {status:'unavailable';raw:null;catalog:null;error:RecentProjectError};

/** Injected storage only: construction performs no reads, writes or registration with the application. */
export class RecentProjectStore {
  constructor(private readonly storage:RecentProjectStorage) {}
  private readRaw():string|null {
    try { return this.storage.getItem(RECENT_PROJECTS_KEY); }
    catch { throw new RecentProjectError('STORAGE','本机缓存暂时无法读取；请使用独立项目JSON'); }
  }
  read():RecentProjectRead {
    let raw:string|null;try { raw=this.readRaw(); }
    catch(error) { return {status:'unavailable',raw:null,catalog:null,error:error as RecentProjectError}; }
    try { return {status:'ready',raw,catalog:parseRecentProjects(raw),error:null}; }
    catch(error) { return {status:'invalid',raw:raw!,catalog:null,error:error as RecentProjectError}; }
  }
  private lease(expectedRaw:string|null):void {
    if(this.readRaw()!==expectedRaw)throw new RecentProjectError('STALE','最近项目缓存已变化；请重新读取，不覆盖其他页面内容');
  }
  private commit(expectedRaw:string|null,nextRaw:string|null):void {
    this.lease(expectedRaw);
    if(nextRaw===expectedRaw)return;
    try { if(nextRaw===null)this.storage.removeItem(RECENT_PROJECTS_KEY);else this.storage.setItem(RECENT_PROJECTS_KEY,nextRaw); }
    catch { throw new RecentProjectError('UNCONFIRMED','本机缓存写入或删除未获确认；请重新读取检查并另存项目JSON'); }
    let actual:string|null;
    try { actual=this.readRaw(); } catch { throw new RecentProjectError('UNCONFIRMED','操作后无法核对缓存，请重新读取；不宣称保存或删除成功'); }
    if(actual!==nextRaw)throw new RecentProjectError('UNCONFIRMED','操作后缓存与预期不同，请重新读取；不回滚或覆盖其他页面内容');
  }
  add(expectedRaw:string|null,entry:RecentProjectEntry,acknowledgeLocalCopy:boolean):{raw:string;id:string;added:boolean} {
    const result=addRecentProject(expectedRaw,entry,acknowledgeLocalCopy);
    this.commit(expectedRaw,result.raw);return result;
  }
  remove(expectedRaw:string|null,id:string):string {
    const next=removeRecentProject(expectedRaw,id);this.commit(expectedRaw,next);return next;
  }
  /** Clear can discard an invalid/future catalog only after explicit acknowledgement and a fresh lease. */
  clear(expectedRaw:string|null,acknowledgeDiscard:boolean):void {
    if(acknowledgeDiscard!==true)throw new RecentProjectError('CONSENT','请先备份原文或明确接受丢弃该本机缓存');
    this.commit(expectedRaw,null);
  }
}
