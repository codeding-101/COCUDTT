import { describe, expect, it } from 'vitest';
import { chinaImportSampleProjectFile, newChinaImportProjectFile } from '../src/data/sample-project';
import { createProjectReport } from '../src/ui/project-report';

describe('内部测算报告', () => {
  it('生成离线报告，保留金额、贸易条件、实际来源、示例状态和输入快照', () => {
    const p = chinaImportSampleProjectFile();
    const html = createProjectReport(p, '2026-10-11T08:00:00Z');
    expect(html).toContain('901,101.49');
    expect(html).toContain('104,663.29');
    expect(html).toContain('参考测算');
    expect(html).toContain('内置虚构税率');
    expect(html).toContain('德国（演示）');
    expect(html).toContain('完整项目输入快照');
    expect(html).toContain('2026-10-11T08:00:00Z');
    expect(html).toMatch(/<details[^>]* open>/);
    expect(html).not.toMatch(/<script|<link|<iframe|<form|data-action=/i);
  });

  it('报告中的未知卖方利润不会变成零利润；后续编辑不改变已经生成的报告', () => {
    const p = chinaImportSampleProjectFile(); p.goods.seller_goods_cost.amount = '';
    const before = JSON.stringify(p); const html = createProjectReport(p);
    expect(JSON.stringify(p)).toBe(before);
    expect(html).toContain('无法评估');
    expect(html).toContain('未知，利润无法评估');
    p.quote.amount = '1'; p.name = '后来编辑';
    expect(html).toContain('901,101.49');
    expect(html).not.toContain('后来编辑');
  });

  it('项目名、商品名及来源中的HTML按文本显示，报告不执行用户内容', () => {
    const p = chinaImportSampleProjectFile();
    p.name = '<script>alert(1)</script>'; p.goods.name = '<img src=x onerror=alert(1)>';
    p.tax_profile.import.rateEvidence!.reference = '</pre><script>alert(2)</script>';
    const html = createProjectReport(p);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<script'); expect(html).not.toContain('<img');
  });

  it('尚未完成输入不能生成看似完整的报告', () => {
    expect(() => createProjectReport(newChinaImportProjectFile())).toThrow(/申报日期/);
  });
});
