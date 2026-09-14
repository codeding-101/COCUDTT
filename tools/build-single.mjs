import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * 把 vite build 的产物内联成单个 HTML 文件。
 *
 * 目的：让交付物是一个双击就能打开的正常网页，不需要开发服务器、
 * 不需要 Node、不需要联网。样式与脚本全部内联，因此也不受 file:// 下
 * ES 模块被 CORS 拦截的限制。
 */

const root = resolve(import.meta.dirname, '..');
const distDir = join(root, 'dist');
const outFile = join(root, 'trade-cost-engine.html');

let html = readFileSync(join(distDir, 'index.html'), 'utf8');

function readAsset(href) {
  const relative = href.replace(/^\.?\//, '');
  return readFileSync(join(distDir, relative), 'utf8');
}

let inlinedCss = 0;
let inlinedJs = 0;

html = html.replace(/<link[^>]*rel="stylesheet"[^>]*>/g, (tag) => {
  const href = /href="([^"]+)"/.exec(tag)?.[1];
  if (href === undefined) return tag;
  inlinedCss += 1;
  return `<style>\n${readAsset(href)}\n</style>`;
});

/*
 * 脚本必须先摘出来、再插到 </body> 之前。
 * Vite 把它放在 <head> 且声明为 type="module"——模块脚本会自动延迟到 DOM 解析完，
 * 但内联的经典脚本是**立即执行**的，此时 #app 还不存在，界面会白屏且不报错。
 */
const scripts = [];
html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (_tag, src) => {
  inlinedJs += 1;
  // 内联脚本里若出现 </script 会提前结束脚本块，必须转义
  const js = readAsset(src).replace(/<\/script/gi, '<\\/script');
  scripts.push(`<script>\n${js}\n</script>`);
  return '';
});

if (scripts.length > 0) {
  html = html.replace(/<\/body>/, `${scripts.join('\n')}\n</body>`);
}

const remaining = html.match(/(?:src|href)="(\.\/assets\/[^"]+)"/g) ?? [];
if (remaining.length > 0) {
  throw new Error(`仍有未内联的外链资源：${remaining.join(', ')}`);
}

/*
 * 自检：file:// 下浏览器把页面视为不透明源，外链 ES 模块会被 CORS 拦掉。
 * 因此单文件里不能残留 type="module" 的外链脚本，内联脚本也不能是模块。
 */
if (/<script[^>]*type="module"[^>]*src=/.test(html)) {
  throw new Error('仍有外链 ES 模块脚本，file:// 下会被 CORS 拦截');
}
if (/<script[^>]*type="module"/.test(html)) {
  throw new Error('内联脚本仍标记为 module，请把 vite.config.ts 的 output.format 设为 iife');
}
const inlineImports = html.match(/^\s*(?:import|export)\s/m);
if (inlineImports !== null) {
  throw new Error('内联脚本中仍存在模块语法（import/export），无法作为经典脚本执行');
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log(`已生成单文件网页：${outFile}`);
console.log(`  内联 CSS ${inlinedCss} 个、脚本 ${inlinedJs} 个，文件大小 ${kb} KB`);
