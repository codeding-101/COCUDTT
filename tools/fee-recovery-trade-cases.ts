/** Synthetic local minimal-view cases. Browser fixtures never include the held business archive. */
import {feeReopenFixture} from './fee-recovery-reopen-cases';
import {chinaImportSampleProjectFile} from '../src/data/sample-project';
import {serializeProject,parseProject,type ProjectFile} from '../src/data/project-file';
import {booksToRows} from '../src/ui/fx-rows';
import {FeeRecoveryFormat} from './fee-recovery-format';
import {FeeRecoveryReopen} from './fee-recovery-reopen';
import {emptyCustomerQuoteFields} from '../src/domain/customer-quote';
export type TradeCase='baseline'|'china'|'actual'|'margin'|'extensions'|'markup';
export function tradeReentryFixture(kind:TradeCase='baseline'){
  const f=feeReopenFixture(),r=f.parts.retained_root as Record<string,unknown>,p=kind==='china'?chinaImportSampleProjectFile():r.project_raw as ProjectFile;
  p.updated_at='2026-10-29T00:00:00.000Z';
  if(kind==='china')p.goods.seller_goods_cost.amount='';
  if(kind==='actual'){p.anchor={kind:'ACTUAL_QUOTES'};p.term_scenarios={CIF:{quote:{...p.quote,amount:'130000',named_place:'Shanghai · synthetic'},quote_evidence:{status:'USER_CONFIRMED',reference:'SYNTHETIC_CONTRACT104',valid_from:'2026-09-01',valid_to:'2026-09-30',checked_on:'2026-09-01',values_key:'SYNTHETIC_ONLY_NOT_REAL_APPROVAL'}}};}
  if(kind==='margin')p.anchor={kind:'FIXED_MARGIN_RATE',margin_rate:'0.2'};
  if(kind==='extensions'){Object.assign(p,{future104:{private:'PRIVATE_ARCHIVE104',zero:-0,rows:['\ufeff原文\r\n😀']}});Object.assign(p.goods,{future_goods104:{count:17}});}
  if(kind==='markup')p.name='<img src=x onerror="window.tradeExecuted104=true">';
  r.project_raw=p;r.customer_fields={reference:'PRIVATE_ARCHIVED_CUSTOMER104'};f.supplement.extensions={archive_only104:'PRIVATE_DRAFT_NOT_ADOPTED104'};
  f.parts.capture_shell.sources.project_json=serializeProject(p);const rows=JSON.stringify(booksToRows(p.fx_books));f.parts.capture_shell.fx={rows_json:rows,preserved_row_key:rows,preserved_books_json:JSON.stringify(p.fx_books)};
  return f;
}
export async function tradeReentryWire(kind:TradeCase='baseline'){const f=tradeReentryFixture(kind);return new FeeRecoveryFormat().encode(f.parts,f.supplement,new AbortController().signal,{captured_at:'2026-10-29T00:00:00.000Z'});}
export async function openTradeCase(kind:TradeCase='baseline'){
  const wire=await tradeReentryWire(kind),store=new FeeRecoveryReopen(),manifest=await store.stage(wire),readonly=store.confirm(manifest,'OPEN_SEPARATE_RECOVERY_SESSION'),business=await readonly.newBusinessSession();
  return{wire,store,readonly,business,trade:business.trade(),close:()=>{business.dispose();store.dispose();}};
}
export async function probeRecoveryTrade(){
  const cases=[];
  {
    const f=await openTradeCase(),before=JSON.stringify(f.readonly.capture()),original=f.readonly.archive,s=f.trade.view();f.trade.edit('quote.amount','110000');const rev=f.business.state().owner.revision,editing=f.trade.view();f.trade.commit();const after=f.trade.view();
    cases.push({id:'real_owner_and_recalculation',checks:{seven_fields:Object.keys(s.values).length===7,real_ten_holders:f.business.state().owner.participants.length===10,pending_hides_result:editing.result===null,one_root:f.business.state().owner.revision===rev+1,one_input_commit:after.trade_input_commits===1,new_quote:after.values['quote.amount']==='110000',result_changed:after.result!.seller_profit!==s.result!.seller_profit,readonly_unchanged:JSON.stringify(f.readonly.capture())===before,archive_exact:f.readonly.archive.source_wire===original.source_wire&&f.readonly.archive.supplement_json===original.supplement_json,no_fee_application:f.business.state().financial_writes===0}});f.close();
  }
  {
    const f=await openTradeCase(),before=f.business.capture().sources.project_json;f.trade.edit('goods.quantity','0');f.trade.edit('goods.trade_value.amount','');let rejected=false;try{f.trade.commit();}catch{rejected=true;}const s=f.trade.view();let gated=false;try{await f.business.handoff();}catch{gated=true;}
    cases.push({id:'invalid_buffers_and_consumer_gate',checks:{rejected,all_issues:s.issues.length===2,zero_not_accepted:s.values['goods.quantity']==='0',empty_not_zero:s.values['goods.trade_value.amount']==='',result_hidden:s.result===null,committed_project_unchanged:f.business.capture().sources.project_json===before,handoff_blocked:gated}});f.close();
  }
  {
    const f=await openTradeCase('china');f.trade.edit('goods.quantity','2000');f.trade.commit();const s=f.trade.view();cases.push({id:'china_unknown_procurement',checks:{unknown_preserved:s.values['goods.seller_goods_cost.amount']==='',profit_null:s.result!.seller_profit===null,buyer_available:s.result!.buyer_total!==null,reference_only:!s.result!.decision_ready,no_approval:!f.business.state().customer_reviewed}});f.close();
  }
  {
    const f=await openTradeCase('extensions'),before=parseProject(f.business.capture().sources.project_json!),source=f.readonly.archive.source_wire,supp=f.readonly.archive.supplement_json;f.trade.edit('name','新名称');f.trade.commit();const after=parseProject(f.business.capture().sources.project_json!);
    cases.push({id:'extensions_and_original_archive',checks:{extensions:JSON.stringify((before as unknown as Record<string,unknown>).future104)===JSON.stringify((after as unknown as Record<string,unknown>).future104),goods_exact:JSON.stringify(before.goods)===JSON.stringify(after.goods),source_exact:f.readonly.archive.source_wire===source,supplement_exact:f.readonly.archive.supplement_json===supp,no_draft_adopted:!JSON.stringify(f.trade.view()).includes('PRIVATE_DRAFT_NOT_ADOPTED104')}});f.close();
  }
  {
    const f=await openTradeCase('actual'),fields=emptyCustomerQuoteFields(),old=f.business.stageCustomer(fields);f.business.confirmCustomer(old,'CONFIRM_PUBLIC_CONTENT');const q=f.trade.view().values['goods.quantity'];f.trade.edit('goods.quantity','2000');f.trade.edit('goods.quantity',q);f.trade.commit();let rejected=false;try{f.business.exportCustomer(old);}catch{rejected=true;}const fresh=f.business.stageCustomer(fields);let unreviewed=false;try{f.business.exportCustomer(fresh);}catch{unreviewed=true;}
    cases.push({id:'aba_and_customer_review',checks:{old_customer_rejected:rejected,fresh_needs_review:unreviewed,no_approval:!f.business.state().customer_reviewed,actual_quote_readonly:!f.trade.view().quote_editable,no_public_fallback:f.trade.view().values['quote.amount']==='130000'}});f.close();
  }
  {
    const f=await openTradeCase();f.trade.edit('name','保留未提交');f.business.invalidate();f.business.invalidate();let rejected=false;try{f.trade.commit();}catch{rejected=true;}const stale=f.trade.view();f.trade.discard();cases.push({id:'stale_input_preserved',checks:{rejected,stale:stale.phase==='STALE',buffer_preserved:stale.values.name==='保留未提交',discard_recovers:f.trade.view().phase==='CALCULATED',no_input_commit:f.trade.view().trade_input_commits===0}});f.close();
  }
  {
    const f=await openTradeCase('margin');let rejected=false;try{f.trade.edit('quote.amount','1');}catch{rejected=true;}cases.push({id:'unsupported_quote_mode_readonly',checks:{rejected,not_pending:!f.trade.hasPending(),target_preserved:f.trade.view().anchor==='FIXED_MARGIN_RATE',no_input_commit:f.trade.view().trade_input_commits===0}});f.close();
  }
  {
    const f=await openTradeCase();f.trade.edit('goods.quantity','',true);let rejected=false;try{f.trade.commit();}catch{rejected=true;}const s=f.trade.view();cases.push({id:'native_number_buffer_and_no_effects',checks:{rejected,no_zero:s.values['goods.quantity']==='',specific_issue:s.issues.some(i=>i.message.includes('无效缓冲')),no_storage:f.business.state().storage_reads===0&&f.business.state().storage_writes===0,no_file:f.business.state().file_writes===0,no_notifications:f.business.state().notifications===0,no_production:s.production_integrated===false&&!s.full_live_workbench_reopen}});f.close();
  }
  return{scope:'MINIMAL_INDEPENDENT_TRADE_REENTRY',cases,production_integrated:false,full_live_workbench_reopen:false,archives_uploaded:0};
}
