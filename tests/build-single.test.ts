import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Script } from 'node:vm';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

function build(js: string) {
  const root = mkdtempSync(join(tmpdir(), 'cocudtt-build-test-'));
  roots.push(root);
  mkdirSync(join(root, 'tools'));
  mkdirSync(join(root, 'dist', 'assets'), { recursive: true });
  copyFileSync(new URL('../tools/build-single.mjs', import.meta.url), join(root, 'tools', 'build-single.mjs'));
  writeFileSync(join(root, 'dist', 'index.html'), '<html><head><script type="module" src="./assets/index.js"></script></head><body><div id="app"></div></body></html>');
  writeFileSync(join(root, 'dist', 'assets', 'index.js'), js);
  const result = spawnSync(process.execPath, [join(root, 'tools', 'build-single.mjs')], { encoding: 'utf8' });
  return { result, file: join(root, 'trade-cost-engine.html') };
}

describe('离线单文件构建产物', () => {
  it('保留JavaScript中全部替换令牌的字面内容，不破坏脚本', () => {
    const js = 'globalThis.tokens = ["$&", "$`", "$\'", "</script>"];';
    const { result, file } = build(js);
    expect(result.status).toBe(0);
    const html = readFileSync(file, 'utf8');
    const inline = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
    const context: { tokens?: string[] } = {};
    new Script(inline).runInNewContext(context);
    expect(context.tokens).toEqual(['$&', '$`', "$'", '</script>']);
    expect(html).not.toContain('type="module"');
  });

  it('最终脚本语法错误会令构建失败，不生成白屏交付文件', () => {
    const { result, file } = build('const broken = <div>;');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SyntaxError');
    expect(existsSync(file)).toBe(false);
  });

  it('残留模块语法会令构建失败', () => {
    const { result, file } = build('import x from "./missing.js";');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('模块语法');
    expect(existsSync(file)).toBe(false);
  });
});
