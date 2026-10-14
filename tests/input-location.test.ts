import { afterEach, describe, expect, it, vi } from 'vitest';
import { inputSections, focusInputSection } from '../src/ui/input-location';
import { EngineError, type EngineErrorCode } from '../src/engine/errors';
import { renderFormsRow, renderFxPanel, renderHsPanel, renderImportTaxPanel, renderItemsPanel } from '../src/ui/views-input';
import { actualQuotesProject } from './fixtures/actual-quotes';
describe('输入定位仅展开已有面板，不猜测具体字段或修改输入',()=>{
  afterEach(()=>vi.unstubAllGlobals());
  it.each([
    ['FX_MISSING',['fx']],['FX_RATE_INVALID',['fx']],['PRICING_CURRENCY_MISMATCH',['items','fx']],
    ['CN_IMPORT_CONTEXT_INVALID',['import-tax','hs']],['TAX_INPUT_INVALID',['import-tax','hs']],
    ['HS_SPECIFIC_UNIT_MISMATCH',['hs','goods']],['INCOTERM_MODE_INCOMPATIBLE',['goods','quote']],
    ['ANCHOR_MARGIN_INVALID',['quote']],['CONTRACT_CLAUSE_TOO_BROAD',['contract','items']],
    ['INPUT_VALUE_MISSING',['goods','quote','contract']],['GRAPH_CYCLE',['items']],['PROJECT_PARSE_FAILED',[]],
  ])('%s只提供实际可核对面板',(code,sections)=>expect(inputSections(new EngineError(code as EngineErrorCode,'原始说明'))).toEqual(sections));
  it('每个错误入口在真实输入渲染中存在，不以任意detail构建CSS选择器',()=>{
    const project=actualQuotesProject(),html=renderFormsRow(project)+renderFxPanel([])+renderHsPanel(project)+renderImportTaxPanel(project)+renderItemsPanel(project,new Map());
    const codes:EngineErrorCode[]=['FX_MISSING','CN_IMPORT_CONTEXT_INVALID','HS_SPECIFIC_UNIT_MISMATCH','INPUT_VALUE_MISSING','CONTRACT_CLAUSE_TOO_BROAD','GRAPH_CYCLE'];
    for(const code of codes)for(const section of inputSections(new EngineError(code,'', {cost_id:'"]<script>bad</script>'})))expect(html).toContain(`data-section="${section}"`);
    expect(inputSections(Error('PRIVATE_FAULT'))).toEqual([]);
  });
  it('展开并聚焦summary，保留输入值；无面板时返回false',()=>{
    const summary={tabIndex:0,focus:vi.fn()},panel={dataset:{section:'fx'},open:false,querySelector:()=>summary,scrollIntoView:vi.fn(),inputValue:'PRIVATE_RATE_981'};
    vi.stubGlobal('document',{querySelectorAll:()=>[panel]});expect(focusInputSection('fx')).toBe(true);expect(panel.open).toBe(true);expect(summary.focus).toHaveBeenCalledOnce();expect(panel.inputValue).toBe('PRIVATE_RATE_981');expect(focusInputSection('hs')).toBe(false);
  });
});
