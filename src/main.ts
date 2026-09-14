import './ui/styles.css';
import { start } from './ui/app.js';

/*
 * 内联成单文件后脚本是经典脚本，会在 </body> 之前的解析阶段立即执行。
 * 这里做一次就绪判断，使挂载点无论出现在脚本之前还是之后都能正确启动。
 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => start(), { once: true });
} else {
  start();
}
