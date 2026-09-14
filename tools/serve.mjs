import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';

/**
 * 本地静态服务，用来把**发布产物本身**（trade-cost-engine.html）原样提供给浏览器。
 *
 * 为什么不用 vite dev：
 *   vite 会给它经手的 HTML 注入自己的 HMR 客户端，那就不是纯粹测产物了。
 * 为什么不用 vite preview：
 *   它只服务 dist/，而单文件产物在项目根目录。
 */

const root = resolve(import.meta.dirname, '..');
const file = join(root, 'trade-cost-engine.html');
const port = Number(process.argv[2] ?? 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

if (!existsSync(file)) {
  console.error('找不到单文件产物，请先运行 npm run build:single');
  process.exit(1);
}

createServer((request, response) => {
  const url = request.url ?? '/';
  // 任何路径都回这一个文件：单文件应用没有子资源
  if (url !== '/' && url !== '/index.html' && !url.startsWith('/?')) {
    response.writeHead(404, { 'Content-Type': TYPES['.txt'] });
    response.end('Not found. 本服务只提供 / 与 trade-cost-engine.html');
    return;
  }
  response.writeHead(200, {
    'Content-Type': TYPES['.html'],
    'Cache-Control': 'no-store',
    'Content-Length': statSync(file).size,
  });
  createReadStream(file).pipe(response);
}).listen(port, () => {
  console.log(`单文件产物已就绪：http://localhost:${port}/`);
  console.log(`文件：${file}（${(statSync(file).size / 1024).toFixed(1)} KB）`);
});
