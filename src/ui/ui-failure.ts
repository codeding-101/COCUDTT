import { isEngineError } from '../engine/errors.js';

/** Actionable input advice. Unexpected exceptions are handled by the runtime boundary. */
export function inputFailure(error: unknown): { message: string; hint: string } {
  if (!isEngineError(error)) return {message:'系统暂时无法完成计算',hint:'请先下载内部恢复备份，再重试界面；不要把旧结果当作本次测算。'};
  const code = error.code;
  let hint = '请按错误说明核对当前输入；缺失资料不代表零成本。';
  if (code.startsWith('FX_') || code === 'PRICING_CURRENCY_MISMATCH') hint = '请核对商业/海关汇率的类型、币种对、正数汇率及适用日期，不用其他类型汇率代替。';
  else if (code === 'CN_IMPORT_CONTEXT_INVALID' || code === 'TAX_INPUT_INVALID') hint = '请核对税务模式、申报日期、计税币种、税率及业务前提；示例税率不能当作实际适用税率。';
  else if (code.startsWith('HS_')) hint = '请核对商品税目、从量税金额、计税数量与单位，不能用货值代替数量。';
  else if (code === 'INCOTERM_MODE_INCOMPATIBLE') hint = '请选择适合当前运输方式的术语；多式联运与海运专用术语须分别核对。';
  else if (code === 'GRAPH_CYCLE' || code === 'PRICING_BASE_MISSING' || code === 'COST_ITEM_NOT_FOUND' || code === 'DUPLICATE_COST_ID') hint = '请核对费用ID、计费基数引用及相互依赖；不要重复引用或形成循环。';
  else if (code.startsWith('PRICING_') || code === 'INPUT_VALUE_MISSING' || code === 'ANCHOR_MARGIN_INVALID') hint = '请填写必要金额、数量或费率，并核对阶梯范围和比较基准；留空不等于零。';
  else if (code === 'PROJECT_PARSE_FAILED' || code === 'PROJECT_VERSION_UNSUPPORTED') hint = '请保留原文件，使用受支持版本的项目JSON；Schema、内部报告和付款计划不能作为项目打开。';
  return {message:`[${code}] ${error.message}`,hint};
}
