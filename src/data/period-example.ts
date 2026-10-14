import {createRoundingExample} from './rounding-example.js';
import {serializeProject,type ProjectFile} from './project-file.js';
import {settlementBinding} from './settlement-context.js';
import {serializeSettlementPlan} from './settlement-file.js';
import {enableFundingPeriods,type SettlementPlan} from '../domain/settlement.js';

export const PERIOD_EXAMPLE_AT='2026-10-14T00:00:00Z';
export const PERIOD_EXAMPLE_FILES={project:'synthetic-period-example.project.json',plan:'synthetic-period-example.plan.json',record:'synthetic-period-example.check.json',guide:'synthetic-period-example.guide.html'} as const;
export type PeriodExampleKind=keyof typeof PERIOD_EXAMPLE_FILES;
/** Fixed synthetic inputs, independent of active business data and browser storage. */
export function createPeriodExample():{project:ProjectFile;plan:SettlementPlan}{
 const seed=createRoundingExample(),project=seed.project;
 project.name='合成案例：计算分段与明确归集期（非真实交易）';project.updated_at=PERIOD_EXAMPLE_AT;
 const plan=enableFundingPeriods(seed.plan);plan.binding=settlementBinding(project);
 plan.payments=[{id:'synthetic-payment',basis:'PERCENT',value:'100',date:'2026-09-05',trigger:'合成全额价款计划，不是实际付款或银行结息'}];
 plan.notes='全部为合成输入。本金、利率、归集期及确认仅是例题设定，不是用户交易的事实确认。计算分段、归集期与付款日期分别记录；不生成本金清偿或银行扣款。';
 Object.assign(plan.funding!,{status:'PROVIDED',principal:'6',start_date:'2026-09-01',end_date:'2026-09-05',annual_rate:'36',
  reference:'合成期初本金6 USD、年利率36%、ACT/360；含起日不含止日，事件当日计息前生效，非银行合同认证',
  events:[{id:'synthetic-increase',date:'2026-09-02',direction:'INCREASE',amount:'6',currency:'USD',reference:'合成9月2日计息前本金增加6 USD，余额12；不证明融资到账'}],
  rate_events:[{id:'synthetic-rate',date:'2026-09-03',annual_rate:'18',reference:'合成9月3日计息前年利率改为18%，不是实际重定价通知'}],
  rounding:{status:'APPLIED',scope:'PERIODS',mode:'HALF_UP',unit:'0.01',intervals_confirmed:false,reference:'合成约定：每个明确期间先精确汇总，再按0.01 USD步长HALF_UP一次舍入；不推定实际银行约定'},
  period_schedule:{status:'PROVIDED',reference:'合成内部应计期间：9月1日至4日、4日至5日，含起不含止；短尾期仅内部应计，不称已结息',periods_confirmed:true,periods:[
   {id:'synthetic-period-a',start_date:'2026-09-01',end_date:'2026-09-04',reference:'合成首期3天，跨本金/利率变化；9月4日为内部假设边界，不是银行结息事实'},
   {id:'synthetic-period-b',start_date:'2026-09-04',end_date:'2026-09-05',reference:'合成短尾期1天，仅内部应计，结束日不代表已结息、扣款或还本'},
  ]}});
 return{project,plan};
}
/** Literal hand-worked expectations; do not derive expected answers from the engine. */
export function periodExampleRecord(){
 return{kind:'SYNTHETIC_PERIOD_CHECK_RECORD',version:'1.0',synthetic:true,generated_at:PERIOD_EXAMPLE_AT,files:{...PERIOD_EXAMPLE_FILES},project_version:'0.8',plan_version:'1.5',
  purpose:'明确期间合成手算记录，不可导入为项目/付款；不是银行账单或认证',
  expected:{currency:'USD',opening_principal:'6',closing_principal:'12',days:4,denominator:360,cost:'0.03',cost_exact:'3/100',scope:'PERIODS',mode:'HALF_UP',unit:'0.01',periods_confirmed:true,intervals_confirmed:false,
   calculation_segment_count:3,fragment_count:4,rounded_cost:'0.03',total_rounded:'0.03',scope_difference:'0.00',adjustment:'0',adjustment_exact:'0/1',
   formula:'(6 × 36 × 1 + 12 × 36 × 1 + 12 × 18 × 2) ÷ 100 ÷ 360 = 0.03',
   segments:[{start_date:'2026-09-01',end_date:'2026-09-02',principal:'6',annual_rate:'36',days:1,cost:'0.006',cost_exact:'3/500'},
    {start_date:'2026-09-02',end_date:'2026-09-03',principal:'12',annual_rate:'36',days:1,cost:'0.012',cost_exact:'3/250'},
    {start_date:'2026-09-03',end_date:'2026-09-05',principal:'12',annual_rate:'18',days:2,cost:'0.012',cost_exact:'3/250'}],
   periods:[{start_date:'2026-09-01',end_date:'2026-09-04',days:3,cost:'0.024',cost_exact:'3/125',rounded:'0.02',adjustment:'-0.004',adjustment_exact:'-1/250',source_segments:[1,2,3],fragment_costs:['0.006','0.012','0.006'],fragment_fractions:['3/500','3/250','3/500']},
    {start_date:'2026-09-04',end_date:'2026-09-05',days:1,cost:'0.006',cost_exact:'3/500',rounded:'0.01',adjustment:'0.004',adjustment_exact:'1/250',source_segments:[3],fragment_costs:['0.006'],fragment_fractions:['3/500']}],
   daily_costs:['0.006','0.012','0.006','0.006'],
   comparisons:[{mode:'HALF_UP',total:'0.03',calculation_intervals:'0.03',explicit_periods:'0.03',daily_periods:'0.04',period_minus_total:'0.00',daily_minus_total:'0.01'},
    {mode:'HALF_EVEN',total:'0.03',calculation_intervals:'0.03',explicit_periods:'0.03',daily_periods:'0.04',period_minus_total:'0.00',daily_minus_total:'0.01'},
    {mode:'DOWN',total:'0.03',calculation_intervals:'0.02',explicit_periods:'0.02',daily_periods:'0.01',period_minus_total:'-0.01',daily_minus_total:'-0.02'}]},
  notes:['就绪、应用及期间确认仅适用于此固定合成例题，不证明用户的银行合同事实。','本金6/12 USD与108300 USD合成报价独立，不据TT、币种或贸易术语推定。','归集首期跨三个计算段，第三段被归集切点分为两个交集；原分段仍三段。','逐日比较指人为设置四个一天归集期，不是新增自动逐日舍入功能。','修改任何输入后固定预期不再适用，须重新复核确认；短尾期仅内部应计。','资金假设独立于利润、税费和价款收付，截止日不推定本金归还。']};
}
export function periodExampleJson(kind:'project'|'plan'|'record'):string{
 if(kind==='record')return JSON.stringify(periodExampleRecord(),null,2)+'\n';
 const{project,plan}=createPeriodExample();return kind==='project'?serializeProject(project):serializeSettlementPlan(plan);
}
