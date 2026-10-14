import {describe,expect,it} from 'vitest';
import {EngineError,type EngineErrorCode} from '../src/engine/errors';
import {inputFailure} from '../src/ui/ui-failure';
describe('输入错误的业务修正提示',()=>{
  it.each([
    ['FX_MISSING','币种对'],['FX_RATE_INVALID','正数汇率'],['PRICING_CURRENCY_MISMATCH','其他类型汇率'],
    ['CN_IMPORT_CONTEXT_INVALID','申报日期'],['TAX_INPUT_INVALID','示例税率'],['HS_SPECIFIC_UNIT_MISMATCH','货值代替数量'],
    ['INCOTERM_MODE_INCOMPATIBLE','海运专用'],['GRAPH_CYCLE','形成循环'],['DUPLICATE_COST_ID','费用ID'],
    ['PRICING_BASE_MISSING','计费基数'],['INPUT_VALUE_MISSING','留空不等于零'],['PRICING_TIER_NOT_COVERED','阶梯范围'],
    ['PROJECT_PARSE_FAILED','付款计划不能作为项目打开'],['PROJECT_VERSION_UNSUPPORTED','保留原文件'],
  ])('%s保留原始错误码与说明，并提示%s，不自动补事实',(code,hint)=>{
    const result=inputFailure(new EngineError(code as EngineErrorCode,'合成错误说明'));expect(result.message).toBe(`[${code}] 合成错误说明`);expect(result.hint).toContain(hint);
  });
  it('未知异常不展示原始私有消息或对任意对象做字符串转换',()=>{
    expect(inputFailure(Error('PRIVATE_BUG_618')).message).not.toContain('PRIVATE_BUG_618');expect(()=>inputFailure({toString(){throw Error('unexpected coercion')}})).not.toThrow();
  });
});
