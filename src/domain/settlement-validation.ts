import { SETTLEMENT_METHODS, type SettlementPlan } from './settlement.js';

const fail = (message: string): never => { throw new Error(`付款计划：${message}`); };
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(`${label}须为对象`);
  return value as Record<string, unknown>;
}
function texts(row: Record<string, unknown>, keys: readonly string[], label: string): void {
  for (const key of keys) if (typeof row[key] !== 'string' || (row[key] as string).length > 4000) fail(`${label}.${key}须为不超过4000字符的文本`);
}
function choice(row: Record<string, unknown>, key: string, values: readonly string[]): void {
  if (typeof row[key] !== 'string' || !values.includes(row[key] as string)) fail(`${key}选项无效`);
}
export function validateSettlementPlan(value: unknown): asserts value is SettlementPlan {
  const plan = object(value, '文件');
  if (plan.version !== '1.0' || plan.kind !== 'INTERNAL_SETTLEMENT_PLAN') fail('不是受支持的内部付款计划1.0，不能作为项目JSON使用');
  texts(plan, ['notes'], '文件');
  texts(object(plan.binding, '报价绑定'), ['project_name','goods_name','quantity','unit','incoterm','named_place','amount','currency'], '报价绑定');
  choice(plan, 'method', SETTLEMENT_METHODS);
  choice(plan, 'bank_status', ['UNCONFIRMED','NO_FEES','LISTED']);
  for (const kind of ['payments','bank_fees'] as const) {
    const rows = plan[kind];
    if (!Array.isArray(rows) || rows.length > 100) return fail(`${kind}须为最多100行的数组`);
    const ids = new Set<string>();
    rows.forEach((value, index) => {
      const row = object(value, `${kind}[${index}]`);
      texts(row, kind === 'payments' ? ['id','value','date','trigger'] : ['id','cost_id','amount','currency','date','reference'], kind);
      const id = row.id as string;
      if (!id.trim() || ['__proto__','constructor','prototype'].includes(id) || ids.has(id)) fail(`${kind}行ID为空、保留名称或重复`);
      ids.add(id);
      if (kind === 'payments') choice(row, 'basis', ['AMOUNT','PERCENT']);
      else {
        choice(row, 'source', ['EXISTING','EXTRA']);
        choice(row, 'bearer', ['UNCONFIRMED','BUYER','SELLER']);
        choice(row, 'payer', ['UNCONFIRMED','BUYER','SELLER']);
        if (typeof row.not_in_project !== 'boolean') fail('新增费用确认须为布尔值');
      }
    });
  }
}
