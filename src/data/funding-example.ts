import { chinaImportSampleProjectFile } from './sample-project.js';
import { serializeProject, type ProjectFile } from './project-file.js';
import { settlementBinding } from './settlement-context.js';
import { serializeSettlementPlan } from './settlement-file.js';
import { enableFundingLedger, newSettlementPlan, type SettlementPlan } from '../domain/settlement.js';

export const FUNDING_EXAMPLE_AT = '2026-10-13T00:00:00Z';
export const FUNDING_EXAMPLE_FILES = {
  project:'synthetic-funding-example.project.json',plan:'synthetic-funding-example.plan.json',
  record:'synthetic-funding-example.check.json',guide:'synthetic-funding-example.guide.html',
} as const;
export type FundingExampleKind = keyof typeof FUNDING_EXAMPLE_FILES;
/** Independent, deterministic synthetic inputs. Never use the active project or test fixtures. */
export function createFundingExample(): {project:ProjectFile;plan:SettlementPlan} {
  const project=chinaImportSampleProjectFile();
  project.name='合成案例：本金事件与分段单利（非真实交易）';project.updated_at=FUNDING_EXAMPLE_AT;
  project.anchor={kind:'ACTUAL_QUOTES'};project.evaluation_date='2026-09-01';project.incoterm='CIF';
  project.quote={...project.quote,named_place:'合成目的港（仅演示）'};
  project.term_scenarios={CIF:{quote:{...project.quote},quote_evidence:{status:'EXAMPLE',reference:'合成报价，仅为文件配对和计算演示；不是真实合同',valid_from:'2026-09-01',valid_to:'2026-09-30',checked_on:''}}};
  const plan=enableFundingLedger(newSettlementPlan(settlementBinding(project)));
  plan.method='TT';plan.bank_status='NO_FEES';
  plan.payments=[{id:'synthetic-payment',basis:'PERCENT',value:'100',date:'2026-10-01',trigger:'合成条件：本例约定的全额价款计划；不是已付款证明'}];
  plan.notes='全部为合成输入。无银行费仅为此例设定；资金本金不是合同价或付款额，不生成实际融资/还款收付，不可套用为真实交易。';
  Object.assign(plan.funding!,{status:'PROVIDED',kind:'FINANCING',party:'SELLER',principal:'12000',currency:'USD',start_date:'2026-09-01',end_date:'2026-10-01',annual_rate:'6',day_basis:'ACT_360',reference:'合成期初本金、固定6%年利率及ACT/360单利；事件当天计息前生效，不是银行计息约定',events:[
    {id:'synthetic-decrease',direction:'DECREASE',amount:'4000',currency:'USD',date:'2026-09-11',reference:'合成设定：9月11日计息前本金减少4000，不冲抵利息'},
    {id:'synthetic-increase',direction:'INCREASE',amount:'2000',currency:'USD',date:'2026-09-21',reference:'合成设定：9月21日计息前本金增加2000，不代表实际融资到账'},
  ]});
  return {project,plan};
}
/** Hand-worked expectations, deliberately independent of the calculation engine. */
export function fundingExampleRecord() {
  return {kind:'SYNTHETIC_FUNDING_CHECK_RECORD',version:'1.0',synthetic:true,generated_at:FUNDING_EXAMPLE_AT,
    files:{...FUNDING_EXAMPLE_FILES},project_version:'0.8',plan_version:'1.2',purpose:'合成手算核对记录，不是内部报告、项目或付款文件，不可导入。',
    expected:{currency:'USD',opening_principal:'12000',closing_principal:'10000',annual_rate_percent:'6',denominator:360,days:30,principal_days:'300000',cost:'50',
      formula:'(12000 × 10 + 8000 × 10 + 10000 × 10) × 6 ÷ 100 ÷ 360 = 50',
      segments:[{start_date:'2026-09-01',end_date:'2026-09-11',principal:'12000',days:10,principal_days:'120000',cost_exact:'20'},
        {start_date:'2026-09-11',end_date:'2026-09-21',principal:'8000',days:10,principal_days:'80000',cost_exact:'40/3'},
        {start_date:'2026-09-21',end_date:'2026-10-01',principal:'10000',days:10,principal_days:'100000',cost_exact:'50/3'}]},
    notes:['每段含起日、不含止日，事件当天计息前生效；不按每月30天。','成本分数与小数表示同一合成算术值；合计先汇总本金×天数。','只提供CIF合成报价，其余术语缺报价，不作为完整方案排名。','来源仍为EXAMPLE，不是业务核对或税则、汇率、银行合同认证。','独立保存项目与付款计划；HTML/Excel/核对记录不能替代可导入JSON。']};
}
export function fundingExampleJson(kind:'project'|'plan'|'record'):string {
  if(kind==='record')return JSON.stringify(fundingExampleRecord(),null,2)+'\n';
  const {project,plan}=createFundingExample();
  return kind==='project'?serializeProject(project):serializeSettlementPlan(plan);
}
