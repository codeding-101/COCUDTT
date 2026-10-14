import { describe, expect, it } from 'vitest';
import { parseProject, serializeProject } from '../src/data/project-file';
import { validateDraftFxRows } from '../src/data/project-validation';
import { sampleProjectFile } from '../src/data/sample-project';
import { EngineError } from '../src/engine/errors';

function invalidAt(path: string, value: unknown, expectedPath = path): void {
  const raw = JSON.parse(serializeProject(sampleProjectFile())) as Record<string, unknown>;
  const keys = path.split('.');
  let cursor = raw;
  for (const key of keys.slice(0, -1)) cursor = cursor[key] as Record<string, unknown>;
  cursor[keys.at(-1)!] = value;
  try {
    parseProject(JSON.stringify(raw));
    throw new Error('坏文件不应通过校验');
  } catch (error) {
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).code).toBe('PROJECT_PARSE_FAILED');
    expect((error as EngineError).detail.field).toBe(`project.${expectedPath.replace(/\.(\d+)/g, '[$1]')}`);
  }
}

describe('项目文件：结构完整后才允许打开', () => {
  it('编辑当前项目的报价不会修改下次载入的示例', () => {
    const first = sampleProjectFile();
    first.quote.amount = '1';
    expect(sampleProjectFile().quote.amount).toBe('108300');
  });
  it('示例存取不改变字段、金额精度或未知扩展信息', () => {
    const raw = { ...sampleProjectFile(), extension: { memo: '合同附件' } };
    raw.items[0]!.amount = '100000.1234567890123456789';
    expect(parseProject(serializeProject(raw))).toEqual(raw);
  });

  it('保留未完成输入，允许用户保存后再次打开继续补全', () => {
    const project = sampleProjectFile();
    project.goods.quantity = '';
    project.items[1]!.amount = '';
    project.fx_books = [];
    project.quote.amount = '';
    expect(parseProject(serializeProject(project))).toEqual(project);
  });

  it.each([
    ['name', null], ['updated_at', 1], ['base_currency', {}], ['carriage_mode', 'SPACESHIP'],
    ['incoterm', 'FOBB'], ['anchor', undefined], ['goods', null], ['goods.name', []],
    ['goods.quantity', {}], ['goods.trade_value', null], ['goods.trade_value.amount', true],
    ['goods.seller_goods_cost.currency', 12], ['items', {}], ['items.0', null],
    ['items.0.cost_category', 'TYPO'], ['items.0.trade_node', 'TYPO'],
    ['items.0.pricing_method', 'TYPO'], ['items.0.tax_included', 'false'],
    ['items.0.included_in_quoted_price', 'true'], ['items.0.fx_type', 'TYPO'],
    ['items.0.responsibility', 'TYPO'], ['items.0.responsibility_source', 'TYPO'],
    ['items.0.source', 'TYPO'], ['items.0.tiers', {}], ['items.0.timing', null],
    ['items.0.calculation_base', null], ['fx_books', null], ['fx_books.0', false],
    ['fx_books.0.rates', []], ['fx_books.0.rates.USD/CNY', 7], ['fx_books.0.type', 'TYPO'],
    ['tax_profile', null], ['tax_profile.import', []], ['tax_profile.import.dutyRates', null],
    ['tax_profile.import.dutyRates.fallback', true], ['tax_profile.import.hsTable.entries', null],
    ['tax_profile.import.hsTable.entries.0.code', 8518],
    ['tax_profile.import.hsTable.entries.0.duty_rates.MFN', {}],
    ['tax_profile.import.vatDeductibleForBuyer', 'false'],
    ['tax_profile.export.rebate.entityType', 'TYPO'], ['tax_profile.customsFx.bookType', 'MARKET'],
    ['quote', null], ['quote.amount', 100000], ['facts', []],
  ])('拒绝字段 %s 的错误结构并指出位置', (path, value) => invalidAt(path as string, value));

  it('检查比较基准所需的字段', () => {
    const raw = sampleProjectFile();
    const text = JSON.stringify({ ...raw, anchor: { kind: 'FIXED_MARKET_PRICE' } });
    expect(() => parseProject(text)).toThrow(/anchor.buyer_total/);
    expect(() => parseProject(JSON.stringify({ ...raw, anchor: { kind: 'FIXED_MARGIN_RATE' } }))).toThrow(/anchor.margin_rate/);
    for (const anchor of [
      { kind: 'FIXED_MARKET_PRICE', buyer_total: '900000', currency: 'CNY' },
      { kind: 'FIXED_MARGIN_RATE', margin_rate: '0.2' },
    ]) expect(parseProject(JSON.stringify({ ...raw, anchor })).anchor).toEqual(anchor);
  });

  it('检查费用依赖、阶梯档位与重复标识', () => {
    invalidAt('items.0.calculation_base', { kind: 'COST_ITEMS', ids: [123] }, 'items.0.calculation_base.ids.0');
    invalidAt('items.0.tiers', [{ up_to: {}, rate: '1' }], 'items.0.tiers.0.up_to');
    invalidAt('items.1.cost_id', 'goods');
    invalidAt('items.0.cost_id', '');
  });

  it('非法 JSON 与不支持的版本保持不同错误码', () => {
    expect(() => parseProject('{')).toThrow(/合法的 JSON/);
    expect(() => parseProject(JSON.stringify({ schema_version: '99' }))).toThrow(
      expect.objectContaining({ code: 'PROJECT_VERSION_UNSUPPORTED' }),
    );
  });

  it('草稿允许未完成的汇率行，但不允许坏结构', () => {
    const row = { row_id: 'fx-1', type: 'MANUAL', date: '', from: '', to: '', rate: '' };
    expect(() => validateDraftFxRows([row])).not.toThrow();
    for (const rows of [null, [null], [{ ...row, rate: 7 }], [{ ...row, type: 'TYPO' }]]) {
      expect(() => validateDraftFxRows(rows)).toThrow(EngineError);
    }
  });
});
