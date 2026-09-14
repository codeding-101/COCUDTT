import { defineConfig } from 'vite';

export default defineConfig({
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
