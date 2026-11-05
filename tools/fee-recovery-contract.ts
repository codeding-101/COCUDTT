/** Explicit current-term actual quote re-entry, using the original project and analysis paths. */
import{parseProject,type ProjectFile}from'../src/data/project-file';
import{FX_TYPES}from'../src/domain/enums';
import{invalidateEvidence}from'../src/domain/source-evidence';
import{emptyContractQuote}from'../src/ui/contracts-input';
import{workspaceIssues}from'../src/ui/workspace';
import{booksToRows}from'../src/ui/fx-rows';
import{calculateRecoveredTrade,type RecoveredTradeAccess}from'./fee-recovery-trade';
import{freezeRecoveryData}from'./fee-recovery-supplement';
import type{WorkbenchCheckpoint}from'../src/ui/workbench-state';
export const CONTRACT_FIELDS=['amount','currency','named_place','fx_type','fx_date']as const;
export type ContractField=typeof CONTRACT_FIELDS[number];
export class RecoveryContractError extends Error{constructor(readonly code:string){super('RECOVERED_CONTRACT_'+code);}}
function fail(code:string):never{throw new RecoveryContractError(code);}
const values=(p:ProjectFile)=>{const q=p.term_scenarios?.[p.incoterm]?.quote??emptyContractQuote(p);return{amount:String(q.amount),currency:q.currency,named_place:q.named_place??'',fx_type:q.fx_type,fx_date:q.fx_date??''};};
export class FeeRecoveryContract{
 private draft:Record<ContractField,string>|null=null;private checkpoint:WorkbenchCheckpoint|null=null;private message='';private closed=false;private commits=0;
 constructor(private readonly access:RecoveredTradeAccess){}
 private available(){if(this.closed)fail('CLOSED');}
 hasPending(){return this.draft!==null;}
 private start(){this.available();if(this.checkpoint&&!this.access.isCurrent(this.checkpoint))fail('STALE_INPUT');this.checkpoint=this.access.begin();this.draft??=values(this.access.project());this.message='';}
 begin(choice:'EDIT_CURRENT_ACTUAL_QUOTE'){if(choice!=='EDIT_CURRENT_ACTUAL_QUOTE')fail('EXPLICIT_ACTUAL_QUOTE_REQUIRED');this.start();}
 edit(field:ContractField,value:string){if(!CONTRACT_FIELDS.includes(field)||typeof value!=='string'||value.length>2048)fail('FIELD');if(!this.draft&&this.access.project().anchor.kind!=='ACTUAL_QUOTES')fail('EXPLICIT_ACTUAL_QUOTE_REQUIRED');this.start();this.draft![field]=value;}
 commit(){this.available();if(!this.draft)return false;if(!this.access.isCurrent(this.checkpoint!)){this.message='当前业务已变化，输入保留，请放弃本次缓冲后重新录入。';fail('STALE_INPUT');}
  try{const p=structuredClone(this.access.project()),d=this.draft;if(!FX_TYPES.includes(d.fx_type as typeof FX_TYPES[number]))fail('FX_TYPE');const before=values(p);p.anchor={kind:'ACTUAL_QUOTES'};p.term_scenarios??={};const record=p.term_scenarios[p.incoterm]??={};record.quote={...(record.quote??emptyContractQuote(p)),amount:d.amount.trim(),currency:d.currency.trim(),named_place:d.named_place.trim(),fx_type:d.fx_type as typeof FX_TYPES[number]};if(d.fx_date.trim())record.quote.fx_date=d.fx_date.trim();else delete record.quote.fx_date;
   if(JSON.stringify(before)!==JSON.stringify(d))invalidateEvidence(record.quote_evidence);
   const parsed=parseProject(JSON.stringify(p)),issues=workspaceIssues(parsed,booksToRows(parsed.fx_books));if(issues.length){this.message=issues.map(i=>i.message).join('；');fail('INPUT_REVIEW_REQUIRED');}const prepared=calculateRecoveredTrade(parsed);prepared.project.updated_at=new Date().toISOString();this.access.install(this.checkpoint!,prepared);this.draft=null;this.checkpoint=null;this.message='实际报价已沿原校验提交，来源与付款绑定仍须核对。';this.commits++;return true;
  }catch(e){if(!this.message)this.message=e instanceof Error?e.message:'报价未提交，原资料保持。';throw e;}
 }
 discard(){this.available();this.draft=null;this.checkpoint=null;this.message='已放弃本次报价缓冲，已提交资料保持。';}
 view(){this.available();const p=this.access.project(),pending=this.hasPending();return freezeRecoveryData({scope:'INDEPENDENT_ACTUAL_QUOTE_REENTRY',incoterm:p.incoterm,anchor:p.anchor.kind,values:{...(this.draft??values(p))},pending,stale:!!this.checkpoint&&!this.access.isCurrent(this.checkpoint),message:this.message,commits:this.commits,actual_quote_present:!!p.term_scenarios?.[p.incoterm]?.quote,public_quote_not_used:true,financial_writes:0,customer_approval:false});}
 dispose(){this.closed=true;this.draft=null;this.checkpoint=null;}
}
