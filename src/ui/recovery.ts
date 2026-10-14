import { escapeHtml } from './format.js';
export type FailureStage = 'STARTUP' | 'RENDER' | 'INTERACTION';
const labels: Record<FailureStage,string> = {STARTUP:'启动',RENDER:'界面显示',INTERACTION:'操作处理'};
export interface RecoveryActions { retry: () => void; backup: () => void }

/** Separate from the failed application renderer, with its own button listeners. */
export function showRecoveryView(stage: FailureStage, actions: RecoveryActions, status = ''): void {
  const app = document.querySelector<HTMLElement>('#app');
  if (!app) return;
  app.hidden = true;
  document.querySelector('#app-recovery')?.remove();
  const panel = document.createElement('section');
  panel.id = 'app-recovery'; panel.className = 'panel recovery-panel';
  panel.setAttribute('role','alert');
  panel.innerHTML = `<div class="panel-body"><h1>界面暂时无法显示</h1><p>${labels[stage]}过程中发生异常，已停止显示本次结果。</p><p>当前内存中的输入不会因重试而重置。请先下载内部恢复备份，再尝试重新显示；刷新会丢失未单独保存的付款计划和临时参数。</p><p class="hint">备份包含内部项目、汇率行、本页参数及独立账单，可能有客户资料和成本。它用于人工恢复，不能作为项目JSON直接打开，也不表示内容已经通过校验。</p><button id="recovery-backup">下载内部恢复备份</button><button id="recovery-retry">重试界面（保留当前输入）</button><p role="status" aria-live="polite">${escapeHtml(status)}</p></div>`;
  app.insertAdjacentElement('afterend',panel);
  panel.querySelector('#recovery-retry')?.addEventListener('click',actions.retry);
  panel.querySelector('#recovery-backup')?.addEventListener('click',actions.backup);
}
export function clearRecoveryView(): void {
  document.querySelector('#app-recovery')?.remove();
  const app = document.querySelector<HTMLElement>('#app');
  if (app) app.hidden = false;
}
