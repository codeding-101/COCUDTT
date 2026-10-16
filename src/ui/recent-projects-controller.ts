import { RecentProjectStore, type RecentProjectStorage, type RecentProjectRead } from '../data/recent-project-store.js';
import { RecentProjectError, recentProjectText } from '../data/recent-projects.js';

export interface RecentProjectsEnvironment {
  storage: RecentProjectStorage;
  context(): string;
  capture(): string;
  captureIssues(): readonly string[];
  install(text: string): boolean;
  write(name: string, text: string, mime: string): Promise<'SAVED'|'DOWNLOAD_STARTED'>;
  render(): void;
  blocked(): boolean;
  id(): string;
  now(): string;
}
interface Prepared { kind: 'open'|'delete'|'clear'; raw: string|null; id?: string; context: string; }

/** Reading, accepting a copy and accepting a replacement are separate user actions. */
export class RecentProjectsController {
  read: RecentProjectRead|null = null;
  generation = 0;
  copyAccepted = false;
  actionAccepted = false;
  prepared: Prepared|null = null;
  message = '';
  busy = false;
  private copyContext: string|null = null;
  private readonly store: RecentProjectStore;
  constructor(private readonly env: RecentProjectsEnvironment) { this.store = new RecentProjectStore(env.storage); }
  invalidate(message = '输入或资料已变化，请重新选择并确认。'): boolean {
    if (!this.prepared && !this.copyAccepted) return false;
    this.prepared = null; this.actionAccepted = false; this.copyAccepted = false; this.copyContext = null;
    this.generation++; this.message = message; return true;
  }
  guardContext(): void {
    if (!this.prepared && !this.copyAccepted) return;
    try {
      const key = this.env.context();
      if (this.prepared && this.prepared.context !== key || this.copyAccepted && this.copyContext !== key) this.invalidate();
    } catch { this.invalidate('当前输入无法核对，请先保存项目或恢复备份。'); }
  }
  refresh(message = ''): void {
    if (this.env.blocked() || this.busy) return;
    this.invalidate(); this.generation++; this.read = this.store.read(); this.message = message;
    this.env.render();
  }
  externalChange(): void {
    if (!this.read || this.env.blocked()) return;
    this.invalidate(); this.generation++; this.read = this.store.read();
    this.message = '其他页面的缓存操作已撤销本页确认，请重新核对列表。'; this.env.render();
  }
  private fresh(): boolean {
    if (!this.read) return false;
    const next = this.store.read();
    if (next.status !== this.read.status || next.raw !== this.read.raw) {
      this.invalidate(); this.generation++; this.read = next;
      this.message = '缓存已变化或无法核对，请重新读取并确认。'; return false;
    }
    return next.status !== 'unavailable';
  }
  private valid(generation: string|undefined): boolean {
    this.guardContext();
    return !this.env.blocked() && !this.busy && generation === String(this.generation);
  }
  accept(field: string|undefined, checked: boolean, generation: string|undefined): void {
    if (!this.valid(generation)) { this.env.render(); return; }
    try {
      if (!this.fresh()) return;
      if (field === 'copy' && this.read?.status === 'ready') {
        this.copyContext = checked ? this.env.context() : null; this.copyAccepted = checked;
      }
      if (field === 'action' && this.prepared) this.actionAccepted = checked;
    } catch { this.invalidate(); this.message = '当前状态无法核对，确认未保留。'; }
    finally { this.env.render(); }
  }
  action(action: string, generation: string|undefined, id?: string): void {
    if (this.env.blocked() || this.busy) return;
    if (action === 'recent-refresh') { this.refresh(); return; }
    if (!this.valid(generation)) { this.env.render(); return; }
    try {
      if (action === 'recent-cancel') { this.invalidate('已取消，本次操作未执行。'); return; }
      if (!this.fresh()) return;
      const read = this.read!;
      if (action === 'recent-backup') { if (read.raw !== null) void this.backup(read.raw); return; }
      if (action === 'recent-add' && read.status === 'ready') {
        if (!this.copyAccepted) throw new RecentProjectError('CONSENT','请先接受增加完整内部项目副本。');
        const issues = this.env.captureIssues();
        if (issues.length) throw new RecentProjectError('INVALID', issues.join('；'));
        const result = this.store.add(read.raw,{id:this.env.id(),added_at:this.env.now(),project_text:this.env.capture()},true);
        this.invalidate(); this.generation++; this.read = this.store.read();
        this.message = result.added ? '已核对加入本机快照；尚未保存为独立文件，请另存项目 JSON。' : '相同原文已存在，未重复加入或更新顺序。'; return;
      }
      const kind = action === 'recent-prepare-open' ? 'open' : action === 'recent-prepare-delete' ? 'delete' : action === 'recent-prepare-clear' ? 'clear' : null;
      if (kind) {
        if (kind !== 'clear') {
          if (read.status !== 'ready') return;
          recentProjectText(read.raw,id ?? '');
        } else if (read.raw === null) return;
        this.invalidate(); this.generation++;
        this.prepared = {kind,raw:read.raw,id,context:this.env.context()};
        this.message = ''; return;
      }
      if (action === 'recent-execute') {
        const prepared = this.prepared;
        if (!prepared || !this.actionAccepted || prepared.raw !== read.raw) return;
        if (prepared.kind === 'open') {
          const text = recentProjectText(read.raw,prepared.id!);
          this.invalidate(); this.generation++;
          this.message = this.env.install(text) ? '已打开本机快照；请另存独立项目文件。' : '快照未能打开，请保留原文检查。';
        } else {
          if (prepared.kind === 'delete') this.store.remove(read.raw,prepared.id!);
          else this.store.clear(read.raw,true);
          this.invalidate(); this.generation++; this.read = this.store.read(); this.message = '已核对移除所选缓存；当前交易与其他本机资料保留。';
        }
      }
    } catch (error) {
      this.invalidate(); this.generation++;
      this.message = error instanceof RecentProjectError ? error.message : '操作未完成，请重新读取检查并另存项目 JSON。';
    } finally { this.env.render(); }
  }
  private async backup(raw: string): Promise<void> {
    this.busy = true; this.invalidate(); const generation = ++this.generation;
    this.message = '正在导出缓存原文（内部资料）…'; this.env.render();
    try {
      const outcome = await this.env.write('COCUDTT-recent-projects-internal.json',raw,'application/json');
      if (generation === this.generation) this.message = outcome === 'SAVED' ? '缓存原文已保存；这是内部列表文件，不是可打开的单份项目。' : '已发起缓存原文下载，请检查下载目录；不代表文件已保存。';
    } catch (error) {
      if (generation === this.generation) this.message = error instanceof Error && error.name === 'AbortError' ? '已取消原文导出；缓存保留。' : '原文导出未获确认；缓存保留，请重试。';
    } finally { this.busy = false; this.env.render(); }
  }
}
