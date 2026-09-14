import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 界面契约测试。
 *
 * 这一组断言锁定的都是本次开发中真实踩过的坑，属于"不许再犯"的硬约束，
 * 而不是样式偏好。界面已冻结（设计文档 1.7），若确实需要修改这些行为，
 * 应先在设计文档里写明理由，再改这里的断言——不允许悄悄绕过。
 *
 * 之所以读源文件来断言，是因为界面没有浏览器测试环境；这是退而求其次的做法，
 * 能挡住"改回去"这类回归，挡不住纯视觉走样。
 */

const projectRoot = new URL('..', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, projectRoot), 'utf8');

const css = read('src/ui/styles.css');
const viewsInput = read('src/ui/views-input.ts');
const viewsOutput = read('src/ui/views-output.ts');
const buildScript = read('tools/build-single.mjs');
const viteConfig = read('vite.config.ts');

describe('界面契约', () => {
  it('源文件读取成功（否则下面的断言会变成空转）', () => {
    expect(css.length).toBeGreaterThan(1000);
    expect(viewsInput.length).toBeGreaterThan(1000);
    expect(viewsOutput.length).toBeGreaterThan(1000);
    expect(buildScript.length).toBeGreaterThan(100);
    expect(viteConfig.length).toBeGreaterThan(50);
  });

  it('底部留白足以避开系统任务栏（曾出现内容被任务栏遮挡）', () => {
    const declared = /--bottom-safe:\s*(\d+)px/.exec(css);
    expect(declared, 'styles.css 必须定义 --bottom-safe').not.toBeNull();
    // Windows 任务栏在 200% 缩放下为 96px，留白必须大于它
    expect(Number(declared?.[1])).toBeGreaterThanOrEqual(100);
    expect(css).toMatch(/padding:\s*[^;]*var\(--bottom-safe\)/);
  });

  it('页面容器不设窄限宽（曾出现右侧半屏空白）', () => {
    const mainRule = /main\.layout\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(mainRule, 'styles.css 必须有 main.layout 规则').not.toBe('');
    const maxWidth = /max-width:\s*(\d+)px/.exec(mainRule);
    if (maxWidth !== null) {
      expect(Number(maxWidth[1])).toBeGreaterThanOrEqual(2400);
    }
  });

  it('对比表按容器铺满，不设限宽（曾出现面板内右侧空白）', () => {
    const compareRule = /table\.grid\.compare\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(compareRule).not.toMatch(/max-width/);
  });

  it('对比表是"术语为行"的转置结构（曾因 11 列横排触发横向滚动）', () => {
    expect(viewsOutput).toMatch(/<th class="term">/);
    expect(viewsOutput).toMatch(/data-label=/);
  });

  it('不再把横向滚动当作布局手段（界面不许出现横滚）', () => {
    expect(css).not.toMatch(/\.scroll-x\s*\{/);
    expect(viewsInput).not.toMatch(/class="scroll-x/);
    expect(viewsOutput).not.toMatch(/class="scroll-x/);
  });

  it('费用项用自动换行的卡片，不用多列表格（曾因 11 列表格难以编辑）', () => {
    expect(viewsInput).toMatch(/class="item-card/);
    expect(viewsInput).toMatch(/class="item-fields"/);
    expect(viewsInput).not.toMatch(/<table class="grid items"/);
  });

  it('宽屏下两张结果表并排，且断点不低于 1700px（低于此值并排会挤压出横滚）', () => {
    const breakpoint = /@media \(min-width:\s*(\d+)px\)\s*\{\s*\.result-tables/.exec(css);
    expect(breakpoint, 'styles.css 必须为 .result-tables 定义并排断点').not.toBeNull();
    expect(Number(breakpoint?.[1])).toBeGreaterThanOrEqual(1700);
  });

  it('单文件构建保留 file:// 下可用的三项自检（曾出现白屏）', () => {
    expect(viteConfig).toMatch(/format:\s*'iife'/);
    expect(buildScript).toMatch(/<\/body>/);
    expect(buildScript).toMatch(/type="module"/);
    expect(buildScript).toMatch(/import\|export/);
  });
});
