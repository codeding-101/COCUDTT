import { FeeContractSettlementManager,type FeeContractSettlementSession } from './fee-contract-settlement';
import { enterContract,enterPayment,synchronizeContract,captureContractFile } from './fee-contract-settlement-cases';
import type { RecoveredHandoffFile } from './fee-recovery-business-files';

export async function openBankFundingCase(file:RecoveredHandoffFile){const manager=new FeeContractSettlementManager(async()=>{},{bankFunding:true}),p=await manager.stage(file.text);manager.acknowledge(p,true);const session=await manager.confirm(p,'OPEN_INDEPENDENT_QUOTE_PAYMENT_SESSION');return{manager,session,close:()=>manager.dispose()};}
export function enterBankFee(session:FeeContractSettlementSession,amount='100',currency='CNY') {
  const s=session.settlement;s.edit('bank_status','LISTED');s.addBankFee();
  for(const[field,value]of Object.entries({source:'EXTRA',amount,currency,bearer:'SELLER',payer:'SELLER',date:'2026-11-01',reference:'合成银行收费及承担约定，非实际账单'}))s.editBankFee('bank-fee-1',field as 'amount',value);
  s.editBankFee('bank-fee-1','not_in_project',true);s.commit();
}
export function enterFunding(session:FeeContractSettlementSession,day_basis='ACT_360') {
  const s=session.settlement;
  for(const[field,value]of Object.entries({status:'PROVIDED',kind:'FINANCING',party:'SELLER',principal:'7000',currency:'CNY',start_date:'2026-11-01',end_date:'2026-12-01',annual_rate:'6',day_basis,reference:'合成恒定本金单利假设，非融资报价'}))s.editFunding(field as 'principal',value);
  s.commit();
}
export async function probeBankFunding(files:Record<string,RecoveredHandoffFile>) {
  const cases=[];
  for(const kind of ['baseline','unknown','archived']) {
    const f=await openBankFundingCase(files[kind]!);
    try {
      enterContract(f.session);enterPayment(f.session);await synchronizeContract(f.session);
      const before=JSON.stringify(f.session.capture()),history=JSON.stringify(f.session.history());
      enterBankFee(f.session);enterFunding(f.session);
      const v=f.session.settlement.view(),out=await captureContractFile(f.session),raw=f.session.settlement.committedRaw();
      f.session.acknowledgeSaved(out.receipt,'CONFIRM_COMPLETE_FILE_SAVED');
      const r=await openBankFundingCase(out.file);
      try {cases.push({id:kind+'_bank_funding_handoff',checks:{seller_net:v.result?.totals[0]?.seller_net==='9900',funding_cost:v.funding_result?.cost==='35',funding_days:v.funding_result?.days===30,project_and_envelope_exact:JSON.stringify(f.session.capture())===before,source_history_exact:JSON.stringify(f.session.history())===history,plan_raw_exact:r.session.settlement.committedRaw()===raw,reopened_net:r.session.settlement.view().result?.totals[0]?.seller_net==='9900',reopened_funding:r.session.settlement.view().funding_result?.cost==='35',reopened_clean:!r.session.hasUnsaved(),confirmed_clean:!f.session.hasUnsaved(),no_new_fees:r.session.state().financial_writes===0,no_customer_export:r.session.state().customer_export_enabled===false}});}finally{r.close();}
    } finally {f.close();}
  }
  return {scope:'INDEPENDENT_BANK_FEES_AND_CONSTANT_FUNDING',cases,financial_writes:0,new_fee_applications:0,customer_export_enabled:false,production_integrated:false,full_live_workbench_reopen:false};
}
