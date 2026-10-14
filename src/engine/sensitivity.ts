import type Decimal from 'decimal.js';
import { d, q, sub, type Numeric } from '../domain/decimal.js';
import type { CostItem } from '../domain/cost-item.js';
import type { ComparisonAnchor, Scenario } from '../domain/scenario.js';
import type { Incoterm } from '../domain/enums.js';
import { compare, type CompareInput, type ComparisonColumn } from './compare.js';

export type SensitivityVariable =
  | { kind: 'FREIGHT'; cost_id: string }
  | { kind: 'FX'; book_id: string; pair: string }
  | { kind: 'RESPONSIBILITY'; cost_id: string };
export interface SensitivityRequest {
  variable: SensitivityVariable;
  range: { from: string; to: string; step: string };
}
export interface MetricChange { value: Decimal | null; delta: Decimal | null; percent: Decimal | null }
export interface SensitivityRow {
  incoterm: Incoterm;
  feasible: boolean;
  checks_passed: boolean;
  issues: string[];
  quote: MetricChange;
  profit: MetricChange;
  payment: MetricChange;
  net_payment: MetricChange;
  tax: MetricChange;
  dutiable: MetricChange;
}
export interface SensitivityPoint {
  label: string;
  change: string;
  hypothetical: boolean;
  rows: SensitivityRow[];
  error: string | null;
}
export interface SensitivityResult {
  version: '1.0';
  base_currency: string;
  anchor: ComparisonAnchor;
  request: SensitivityRequest;
  variable_label: string;
  adjustment_note: string;
  baseline: SensitivityPoint;
  points: SensitivityPoint[];
}
export class SensitivityInputError extends Error {}
const fail = (message: string): never => { throw new SensitivityInputError(message); };
function number(value: Numeric, label: string): Decimal {
  try { const n=d(value); if(n.isFinite()) return n; } catch { /* 用户输入错误在此转成可行动提示。 */ }
  return fail(`${label}须为有限数字`);
}

/** 独立假设，不补造任何来源确认。领域输入只含JSON数据，Decimal以精确字符串复制。 */
function copy(input: CompareInput): CompareInput { return JSON.parse(JSON.stringify(input)) as CompareInput; }
export function sensitivityOffsets(request: SensitivityRequest): string[] {
  if(request.variable.kind==='RESPONSIBILITY') return ['SELLER','BUYER'];
  const from=number(request.range.from,'起始变化'),to=number(request.range.to,'结束变化'),step=number(request.range.step,'变化步长');
  if(step.lte(0)||to.lt(from)) return fail('步长须大于零，结束变化须不小于起始变化');
  if(from.lt(-100)||(request.variable.kind==='FX'&&from.lte(-100))) return fail(request.variable.kind==='FX'?'汇率变化须大于-100%，不能使汇率为零或负数':'运费变化不能低于-100%');
  const steps=to.minus(from).div(step);
  if(!steps.isInteger()) return fail('变化区间须能被步长整除，避免遗漏终点');
  if(steps.gt(20)) return fail('每次最多21个变化点，请增大步长或缩小范围');
  const offsets=Array.from({length:steps.toNumber()+1},(_,i)=>from.plus(step.times(i)).toString());
  return offsets;
}

export function metricChange(value: Decimal | null, baseline: Decimal | null): MetricChange {
  if(value===null||baseline===null) return {value,delta:null,percent:null};
  const delta=sub(value,baseline);
  return {value,delta,percent:baseline.isZero()?null:q(delta.div(baseline.abs()).times(100))};
}
function row(column: ComparisonColumn, baseline?: ComparisonColumn): SensitivityRow {
  const metric=(read:(c:ComparisonColumn)=>Decimal|null)=>metricChange(column.feasible?read(column):null,baseline?.feasible?read(baseline):null);
  return {incoterm:column.incoterm,feasible:column.feasible,checks_passed:column.decision_ready,
    issues:[...(column.infeasible_reason?[column.infeasible_reason]:[]),...column.decision_issues],
    quote:metric(c=>c.quote_amount),profit:metric(c=>c.seller.margin),payment:metric(c=>c.buyer.landed_cost_with_tax),
    net_payment:metric(c=>c.buyer.landed_cost_ex_deductible),tax:metric(c=>c.import_tax_total),dutiable:metric(c=>c.result?.dutiable_value.value??null)};
}
function scaleFreight(item: CostItem, factor: Decimal): CostItem {
  const scale=(value:Numeric|undefined,label:string):string=>{if(value===undefined) return fail(`运费${label}未填写`);const n=number(value,`运费${label}`);if(n.lt(0))return fail('退款或负运费不属于本项运价涨跌假设');return q(n.times(factor)).toString();};
  if(item.pricing_method==='FIXED'||item.pricing_method==='ACTUAL') return {...item,amount:scale(item.amount,'金额')};
  if(item.pricing_method==='TIERED') {
    if(!item.tiers?.length) return fail('阶梯运价缺少档位');
    return {...item,tiers:item.tiers.map(t=>({...t,rate:scale(t.rate,'档位费率')}))};
  }
  return {...item,rate:scale(item.rate,'费率')};
}
function scenarioOverride(scenario: Scenario, id: string, party: 'SELLER'|'BUYER'): Scenario {
  return {...scenario,responsibility_overrides:{...scenario.responsibility_overrides,[id]:{responsibility:party,reason:'假设分析：单项费用承担情景，未形成已确认合同'}}};
}

/** 复用完整比较/核验管线；局部失败保留错误和空值，不沿用基准金额，不对假设排名。 */
export function runSensitivity(input: CompareInput, request: SensitivityRequest): SensitivityResult {
  const offsets=sensitivityOffsets(request),snapshot=copy(input),baselineComparison=compare(snapshot);
  const variable=request.variable;
  let label='',note='';
  if(variable.kind==='FX') {
    const books=snapshot.fxBooks.filter(b=>b.id===variable.book_id);if(books.length!==1)return fail('所选汇率表不存在或编号重复');
    const book=books[0]!;if(book.type==='CUSTOMS')note='仅改变该海关汇率行；实际申报日期和有效期保持，假设汇率不是可用于申报的官方汇率。';
    else note='仅改变该商业汇率行；显式汇率、其他汇率类型和其他表不随动。';
    if(!/^[A-Z]{3}\/[A-Z]{3}$/.test(variable.pair)||variable.pair.split('/')[0]===variable.pair.split('/')[1])return fail('请选择两个不同币种的有效汇率行');
    const rate=book.rates[variable.pair];if(rate===undefined||number(rate,'基准汇率').lte(0))return fail('所选基准汇率须为正数');
    label=`${book.name} · ${book.type} · ${variable.pair}（1 ${variable.pair.slice(0,3)} = ${rate} ${variable.pair.slice(4)}）`;
  } else {
    const items=snapshot.trade.items.filter(i=>i.cost_id===variable.cost_id);if(items.length!==1)return fail('所选费用不存在或编号重复');
    const item=items[0]!;label=item.cost_name;
    if(variable.kind==='FREIGHT') {
      if(!['MAIN_CARRIAGE','INLAND_TRANSPORT','DESTINATION_TRANSPORT'].includes(item.cost_category)||item.is_goods_value||item.source==='DERIVED')return fail('请选择明确的运输费用，不调整货值或派生税款');
      scaleFreight(item,d(1));note='按变化比例调整原币金额或费率，阶梯各档费率同步缩放；数量、天数、档位边界和适用术语保持，依赖费用及税额重新计算。';
    } else {
      if(!baselineComparison.columns.some(c=>c.result?.items.some(i=>i.item.cost_id===item.cost_id&&['CONDITIONAL','SHARED'].includes(i.responsibility))))return fail('请选择承担未确定或尚未分摊的费用');
      note='一次仅假设这一笔费用全归卖方或买方；其他未决费用保持，不能代表全部合同已确认，也不解析共担比例。';
    }
    if(!baselineComparison.columns.some(c=>c.result?.items.some(i=>i.item.cost_id===item.cost_id)))return fail('所选费用未在参与分析的方案中启用，或方案无法计算');
    if(variable.kind==='FREIGHT'&&baselineComparison.columns.some(c=>c.result?.items.some(i=>i.item.cost_id===item.cost_id&&i.gross_amount.lt(0))))return fail('退款或负运费不属于本项运价涨跌假设');
  }
  const baseline: SensitivityPoint={label:'当前基准',change:'0',hypothetical:false,rows:baselineComparison.columns.map(c=>row(c,c)),error:null};
  const points=offsets.map(change=>{
    const point: SensitivityPoint={label:variable.kind==='RESPONSIBILITY'?(change==='SELLER'?'假设卖方承担':'假设买方承担'):`${change}%`,change,hypothetical:true,rows:[],error:null};
    try {
      // 数值零变化直接复用基准，避免重新量化原始输入导致所谓0%变化。
      if(variable.kind!=='RESPONSIBILITY'&&d(change).isZero()) {point.hypothetical=false;point.rows=baseline.rows;return point;}
      const variant=copy(snapshot),factor=d(1).plus(d(variable.kind==='RESPONSIBILITY'?'0':change).div(100));
      if(variable.kind==='FREIGHT')variant.trade.items=variant.trade.items.map(item=>item.cost_id===variable.cost_id?scaleFreight(item,factor):item);
      else if(variable.kind==='FX')variant.fxBooks=variant.fxBooks.map(book=>{
        if(book.id!==variable.book_id)return book;
        const rate=q(number(book.rates[variable.pair]!,'汇率').times(factor));if(rate.lte(0))return fail('变化后的汇率在当前精度下为零，请调整范围');
        return {...book,rates:{...book.rates,[variable.pair]:rate.toString()}};
      });
      else {
        const party=change as 'SELLER'|'BUYER';variant.template=scenarioOverride(variant.template,variable.cost_id,party);
        if(variant.scenarios)variant.scenarios=Object.fromEntries(Object.entries(variant.scenarios).map(([term,s])=>[term,scenarioOverride(s,variable.cost_id,party)]));
      }
      const comparison=compare(variant);point.rows=comparison.columns.map(c=>row(c,baselineComparison.columns.find(b=>b.incoterm===c.incoterm)));
    } catch(error) {point.error=error instanceof Error?error.message:String(error);}
    return point;
  });
  return {version:'1.0',base_currency:baselineComparison.base_currency,anchor:baselineComparison.anchor,request:JSON.parse(JSON.stringify(request)) as SensitivityRequest,variable_label:label,adjustment_note:note,baseline,points};
}
