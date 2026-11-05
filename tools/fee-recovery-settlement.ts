/** Separate committed payment worksheet; drafts are not installed in the legacy workflow. */
import{newSettlementPlan,newPaymentEntry,newBankFeeEntry,type SettlementPlan}from'../src/domain/settlement';
import{parseSettlementPlan,serializeSettlementPlan}from'../src/data/settlement-file';
import{settlementBinding}from'../src/data/settlement-context';
import{calculateSettlement,type SettlementResult}from'../src/engine/settlement';
import{calculateFunding,type FundingResult}from'../src/engine/funding';
import{calculateRecoveredTrade}from'./fee-recovery-trade';
import{freezeRecoveryData}from'./fee-recovery-supplement';
import type{ProjectFile}from'../src/data/project-file';
import{parseFeeEnvelopeJson}from'../src/data/fee-envelope-json';
import{feeBrowserNativeUtf8Bytes}from'./fee-browser-native-codec';
export const SETTLEMENT_INPUT_BYTES=4*1024*1024;
export function checkedSettlementText(raw:string){if(typeof raw!=='string'||raw.length>SETTLEMENT_INPUT_BYTES||feeBrowserNativeUtf8Bytes(raw)>SETTLEMENT_INPUT_BYTES)fail('FILE_SIZE');parseFeeEnvelopeJson(raw,SETTLEMENT_INPUT_BYTES);return parseSettlementPlan(raw);}
export class RecoverySettlementError extends Error{constructor(readonly code:string){super('RECOVERED_SETTLEMENT_'+code);}}
function fail(code:string):never{throw new RecoverySettlementError(code);}
export interface SettlementAccess{project():ProjectFile;beforeEdit():void;context():()=>boolean}
export interface SettlementEditorOptions{readonly bankFunding?:boolean}
export const BANK_FEE_FIELDS=['source','cost_id','amount','currency','bearer','payer','date','reference','not_in_project']as const;
export type BankFeeField=typeof BANK_FEE_FIELDS[number];
export const FUNDING_FIELDS=['status','kind','party','principal','currency','start_date','end_date','annual_rate','day_basis','reference']as const;
export type FundingField=typeof FUNDING_FIELDS[number];
export class FeeRecoverySettlement{
 private raw:string|null;private draft:SettlementPlan|null=null;private currentContext:(()=>boolean)|null=null;private revision=0;private closed=false;private message='';
 constructor(private readonly access:SettlementAccess,raw:string|null=null,private readonly options:SettlementEditorOptions={}){if(raw!==null)checkedSettlementText(raw);this.raw=raw;this.options=Object.freeze({bankFunding:options.bankFunding===true});}
 private available(){if(this.closed)fail('CLOSED');}
 private touch(){if(this.revision===Number.MAX_SAFE_INTEGER)fail('REVISION_LIMIT');this.revision++;}
 private begin(){this.available();if(this.currentContext&&!this.currentContext())fail('STALE_INPUT');this.access.beforeEdit();this.currentContext=this.access.context();this.touch();}
 private editable(){if(this.raw&&parseSettlementPlan(this.raw).version!=='1.1')fail('VERSION_READ_ONLY');}
 create(choice:'CREATE_FROM_CURRENT_ACTUAL_QUOTE'){if(choice!=='CREATE_FROM_CURRENT_ACTUAL_QUOTE')fail('EXPLICIT_CREATE_REQUIRED');if(this.raw||this.draft)fail('PLAN_EXISTS');const p=newSettlementPlan(settlementBinding(this.access.project()));this.begin();this.draft=p;this.message='已新建未提交付款计划；方式、日期和银行费用须明确核对。';}
 import(raw:string,choice:'IMPORT_PAYMENT_PLAN_AS_INTERNAL_DRAFT'){this.available();if(choice!=='IMPORT_PAYMENT_PLAN_AS_INTERNAL_DRAFT')fail('EXPLICIT_IMPORT_REQUIRED');if(this.raw||this.draft)fail('PLAN_EXISTS');checkedSettlementText(raw);this.begin();this.raw=raw;this.draft=null;this.currentContext=null;this.message='已明确载入内部计划，原绑定及未完成条件保留；不批准付款或客户报价。';}
 edit(field:'method'|'bank_status'|'notes',value:string){this.editable();if(!['method','bank_status','notes'].includes(field)||typeof value!=='string'||value.length>4000)fail('FIELD');this.begin();this.draft??=this.raw?parseSettlementPlan(this.raw):fail('NO_PLAN');(this.draft as unknown as Record<string,unknown>)[field]=value;}
 editPayment(id:string,field:'basis'|'value'|'date'|'trigger',value:string){this.editable();if(!['basis','value','date','trigger'].includes(field)||typeof value!=='string'||value.length>4000)fail('FIELD');this.begin();this.draft??=this.raw?parseSettlementPlan(this.raw):fail('NO_PLAN');const row=this.draft.payments.find(r=>r.id===id);if(!row)fail('ROW');(row as unknown as Record<string,unknown>)[field]=value;}
 addPayment(){this.editable();this.begin();this.draft??=this.raw?parseSettlementPlan(this.raw):fail('NO_PLAN');if(this.draft.payments.length>=100)fail('ROW_LIMIT');let n=1;while(this.draft.payments.some(r=>r.id==='payment-'+n))n++;this.draft.payments.push(newPaymentEntry('payment-'+n));}
 removePayment(id:string){this.editable();this.begin();this.draft??=this.raw?parseSettlementPlan(this.raw):fail('NO_PLAN');const at=this.draft.payments.findIndex(r=>r.id===id);if(at<0)fail('ROW');this.draft.payments.splice(at,1);}
 private financialDraft(){this.available();if(!this.options.bankFunding)fail('FINANCIAL_EDITOR_DISABLED');this.editable();this.begin();this.draft??=this.raw?parseSettlementPlan(this.raw):fail('NO_PLAN');return this.draft;}
 addBankFee(){const p=this.financialDraft();if(p.bank_fees.length>=100)fail('ROW_LIMIT');let n=1;while(p.bank_fees.some(r=>r.id==='bank-fee-'+n))n++;p.bank_fees.push(newBankFeeEntry('bank-fee-'+n));}
 removeBankFee(id:string){const p=this.financialDraft(),at=p.bank_fees.findIndex(r=>r.id===id);if(at<0)fail('ROW');p.bank_fees.splice(at,1);}
 editBankFee(id:string,field:BankFeeField,value:string|boolean){if(!BANK_FEE_FIELDS.includes(field)||(field==='not_in_project'?typeof value!=='boolean':typeof value!=='string'||value.length>4000))fail('FIELD');const p=this.financialDraft(),row=p.bank_fees.find(r=>r.id===id);if(!row)fail('ROW');(row as unknown as Record<string,unknown>)[field]=value;}
 editFunding(field:FundingField,value:string){if(!FUNDING_FIELDS.includes(field)||typeof value!=='string'||value.length>4000)fail('FIELD');const p=this.financialDraft();if(!p.funding)fail('FUNDING_REQUIRED');(p.funding as unknown as Record<string,unknown>)[field]=value;}
 commit(){this.available();if(!this.draft)return false;if(!this.currentContext?.()){this.message='报价或业务上下文已变化；付款输入保留，请放弃缓冲后重新核对。';fail('STALE_INPUT');}try{const raw=serializeSettlementPlan(this.draft);checkedSettlementText(raw);this.raw=raw;this.draft=null;this.currentContext=null;this.touch();this.message='付款草稿已提交；能否计算仍按原绑定和付款规则核对。';return true;}catch(e){this.message=e instanceof Error?e.message:'付款草稿未提交。';throw e;}}
 discard(){this.available();this.draft=null;this.currentContext=null;this.touch();this.message='已放弃本次未提交付款输入，已提交计划保持。';}
 rebind(choice:'REBIND_CURRENT_ACTUAL_QUOTE'){this.available();this.editable();if(choice!=='REBIND_CURRENT_ACTUAL_QUOTE')fail('EXPLICIT_REBIND_REQUIRED');if(this.draft)fail('UNCOMMITTED_INPUT');if(!this.raw)fail('NO_PLAN');const p=parseSettlementPlan(this.raw),binding=settlementBinding(this.access.project());p.binding=binding;const raw=serializeSettlementPlan(p);checkedSettlementText(raw);this.begin();this.raw=raw;this.currentContext=null;this.message='已明确重新绑定当前实际报价，金额、日期、银行费用及资金字段未自动缩放。';}
 hasPending(){return this.draft!==null;}
 committedRaw(){this.available();return this.raw;}
 version(){return this.revision;}
 view(){this.available();const plan=this.draft??(this.raw?parseSettlementPlan(this.raw):null);let result:SettlementResult|null=null,error:string|null=null;if(plan&&!this.draft){try{const p=this.access.project(),analysis=calculateRecoveredTrade(p).result;result=calculateSettlement(plan,settlementBinding(p),analysis,p.term_scenarios?.[p.incoterm]?.responsibility_overrides);}catch(e){error=e instanceof Error?e.message:'付款计划未完成';}}
  let funding_result:FundingResult|null=null,funding_error:string|null=null;
  if(this.options.bankFunding&&plan&&!this.draft){try{funding_result=calculateFunding(plan,settlementBinding(this.access.project()));}catch(e){funding_error=e instanceof Error?e.message:'资金假设未完成';}}
  return freezeRecoveryData({scope:'INDEPENDENT_SETTLEMENT_WORKSHEET',plan:plan?structuredClone(plan):null,pending:this.hasPending(),stale:!!this.currentContext&&!this.currentContext(),result,error,message:this.message,revision:this.revision,editable:!plan||plan.version==='1.1',funding_and_bank_rows_read_only:!this.options.bankFunding||!!plan&&plan.version!=='1.1',...(this.options.bankFunding?{funding_result,funding_error}:{}),financial_writes:0,customer_approval:false});
 }
 dispose(){this.closed=true;this.draft=null;this.currentContext=null;}
}
