import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

export default defineConfig({
  // 独立离线介绍页在仓库中链接单文件工具，在静态站点中链接index入口。
  plugins: [{
    name: 'project-introduction',
    generateBundle() {
      const source = readFileSync(new URL('./project-introduction.html', import.meta.url), 'utf8');
      this.emitFile({ type: 'asset', fileName: 'project-introduction.html', source: source.replace('href="trade-cost-engine.html"', 'href="index.html"') });
      const walkthrough = readFileSync(new URL('./china-import-walkthrough.html', import.meta.url), 'utf8');
      this.emitFile({ type: 'asset', fileName: 'china-import-walkthrough.html', source: walkthrough.replace('href="trade-cost-engine.html"','href="index.html"') });
    },
  }],
  // 相对路径：构建产物既能放在子目录，也能直接双击打开
  base: './',
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        /*
         * 打成 IIFE 经典脚本而不是 ES 模块。
         * 原因：file:// 下浏览器把页面视为不透明源，外链 ES 模块会被 CORS 拦掉。
         * 经典脚本没有这个问题，双击即可运行。
         */
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
