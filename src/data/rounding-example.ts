import {createFundingExample} from './funding-example.js';
import {serializeProject,type ProjectFile} from './project-file.js';
import {settlementBinding} from './settlement-context.js';
import {serializeSettlementPlan} from './settlement-file.js';
import {enableFundingRates,enableFundingRounding,type SettlementPlan} from '../domain/settlement.js';

export const ROUNDING_EXAMPLE_AT='2026-10-13T00:00:00Z';
export const ROUNDING_EXAMPLE_FILES={project:'synthetic-rounding-example.project.json',plan:'synthetic-rounding-example.plan.json',record:'synthetic-rounding-example.check.json',guide:'synthetic-rounding-example.guide.html'} as const;
export type RoundingExampleKind=keyof typeof ROUNDING_EXAMPLE_FILES;
/** Deterministic production-only synthetic inputs; no active transaction or browser state. */
export function createRoundingExample():{project:ProjectFile;plan:SettlementPlan}{
  const seed=createFundingExample(),project=seed.project;
  project.name='合成案例：金额舍入与层级差异（非真实交易）';project.updated_at=ROUNDING_EXAMPLE_AT;
  const plan=enableFundingRounding(enableFundingRates(seed.plan));
  plan.binding=settlementBinding(project);
  plan.payments=[{id:'synthetic-payment',basis:'PERCENT',value:'100',date:'2026-09-04',trigger:'合成全额价款计划，不是实际付款或融资到账'}];
  plan.notes='全部为合成输入。本金6 USD与报价独立，刻意用于放大舍入层级差异；同率生效记录用于演示区间拆分，不证明银行结息日。默认合计后舍入，逐区间仅比较，边界未确认。';
  Object.assign(plan.funding!,{status:'PROVIDED',kind:'FINANCING',party:'SELLER',principal:'6',currency:'USD',start_date:'2026-09-01',end_date:'2026-09-04',annual_rate:'36',day_basis:'ACT_360',
    reference:'合成本金6 USD、年利率36%、ACT/360，含起日不含止日；就绪状态仅指例题输入，不是银行合同认证',events:[],rate_events:[
      {id:'synthetic-rate-2',date:'2026-09-02',annual_rate:'36',reference:'合成同率生效记录：仅演示计算区间，不是实际银行结息'},
      {id:'synthetic-rate-3',date:'2026-09-03',annual_rate:'36',reference:'合成同率生效记录：仅演示计算区间，不是实际银行结息'},
    ],rounding:{status:'APPLIED',scope:'TOTAL',mode:'HALF_UP',unit:'0.01',reference:'合成约定：整个期间合计后按0.01 USD步长就近舍入，恰半向上；不是货币或银行默认规则',intervals_confirmed:false}});
  return{project,plan};
}
/** Fixed hand calculations. Never obtain expected values from the production engine. */
export function roundingExampleRecord(){
  return{kind:'SYNTHETIC_ROUNDING_CHECK_RECORD',version:'1.0',synthetic:true,generated_at:ROUNDING_EXAMPLE_AT,files:{...ROUNDING_EXAMPLE_FILES},project_version:'0.8',plan_version:'1.4',
    purpose:'舍入层级合成手算记录，不是可导入项目/付款、银行账单或认证',
    expected:{currency:'USD',principal:'6',closing_principal:'6',annual_rate_percent:'36',denominator:360,days:3,unit:'0.01',scope:'TOTAL',mode:'HALF_UP',intervals_confirmed:false,
      cost:'0.018',cost_exact:'9/500',rounded_cost:'0.02',adjustment:'0.002',adjustment_exact:'1/500',formula:'6 × 36 ÷ 100 × 3 ÷ 360 = 0.018；合计后按0.01舍入 = 0.02',
      segments:[{start_date:'2026-09-01',end_date:'2026-09-02',days:1,cost:'0.006',cost_exact:'3/500'},
        {start_date:'2026-09-02',end_date:'2026-09-03',days:1,cost:'0.006',cost_exact:'3/500'},
        {start_date:'2026-09-03',end_date:'2026-09-04',days:1,cost:'0.006',cost_exact:'3/500'}],
      comparisons:[{mode:'HALF_UP',total:'0.02',per_interval:'0.01',interval_sum:'0.03',interval_minus_total:'0.01'},
        {mode:'HALF_EVEN',total:'0.02',per_interval:'0.01',interval_sum:'0.03',interval_minus_total:'0.01'},
        {mode:'DOWN',total:'0.01',per_interval:'0.00',interval_sum:'0.00',interval_minus_total:'-0.01'}]},
    notes:['就绪及应用状态是例题设定，不是用户交易的事实确认。','同率生效记录人为拆成三段，逐段舍入不能自动当银行结息。','本金独立于108300 USD合成报价；不从合同价、付款方式或币种推定。','合计模型未确认逐区间边界；切换INTERVALS须重新确认应用及边界。','原始单利、舍入值和调整分别核对；不按显示近似值重复舍入。','改变输入后本记录固定预期不再适用；来源仍EXAMPLE，不升级业务确认。']};
}
export function roundingExampleJson(kind:'project'|'plan'|'record'):string{
  if(kind==='record')return JSON.stringify(roundingExampleRecord(),null,2)+'\n';
  const{project,plan}=createRoundingExample();return kind==='project'?serializeProject(project):serializeSettlementPlan(plan);
}
