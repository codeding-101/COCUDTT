/** Minimal, developer-only re-entry into a separate recovered business owner. Never adopts archived drafts. */
import {parseProject,toTrade,toScenario,toScenarios,type ProjectFile} from '../src/data/project-file';
import {analyze,type AnalysisResult} from '../src/engine/analyze';
import {compare,scenarioWithDerivedInclusions,type Comparison} from '../src/engine/compare';
import {EngineError} from '../src/engine/errors';
import {invalidateEvidence} from '../src/domain/source-evidence';
import {workspaceIssues} from '../src/ui/workspace';
import {inputReviews} from '../src/ui/input-review';
import {booksToRows} from '../src/ui/fx-rows';
import type {WorkbenchCheckpoint} from '../src/ui/workbench-state';
import {freezeRecoveryData} from './fee-recovery-supplement';

export const RECOVERED_TRADE_FIELDS=Object.freeze(['name','goods.name','goods.quantity','goods.unit','goods.trade_value.amount','goods.seller_goods_cost.amount','quote.amount'] as const);
export type RecoveredTradeField=typeof RECOVERED_TRADE_FIELDS[number];
export interface TradeReentryIssue {readonly message:string;readonly field:RecoveredTradeField|null}
export interface RecoveredTradeCalculation {readonly project:ProjectFile;readonly result:AnalysisResult;readonly comparison:Comparison}
export interface RecoveredTradeAccess {
  project():ProjectFile;
  begin():WorkbenchCheckpoint;
  isCurrent(checkpoint:WorkbenchCheckpoint):boolean;
  install(checkpoint:WorkbenchCheckpoint,prepared:RecoveredTradeCalculation):void;
}
export class RecoveryTradeError extends Error {constructor(readonly code:string){super('RECOVERED_TRADE_'+code);this.name='RecoveryTradeError';}}
function fail(code:string):never{throw new RecoveryTradeError(code);}
const known=(field:unknown):field is RecoveredTradeField=>typeof field==='string'&&(RECOVERED_TRADE_FIELDS as readonly string[]).includes(field);
function inputs(p:ProjectFile):Record<RecoveredTradeField,string>{return{name:p.name,'goods.name':p.goods.name,'goods.quantity':String(p.goods.quantity),'goods.unit':p.goods.unit,'goods.trade_value.amount':String(p.goods.trade_value.amount),'goods.seller_goods_cost.amount':String(p.goods.seller_goods_cost.amount),'quote.amount':toScenario(p).quote.amount.toString()};}
/** The original structure validator and exact single-scenario/comparison engine paths, with no simplified formula. */
export function calculateRecoveredTrade(project:ProjectFile):RecoveredTradeCalculation {
  const p=parseProject(JSON.stringify(project)),trade=toTrade(p),template=toScenario(p),today=p.export_date===undefined?{}:{today:p.export_date};
  const result=analyze({trade,scenario:scenarioWithDerivedInclusions(template,trade),taxProfile:p.tax_profile,fxBooks:p.fx_books,...today});
  const comparison=compare({trade,template,scenarios:toScenarios(p),anchor:p.anchor,taxProfile:p.tax_profile,fxBooks:p.fx_books,...today});
  const error=result.warnings.find(w=>w.level==='ERROR');if(error)throw new EngineError('INPUT_VALUE_MISSING',error.message);
  const totals=[result.seller.margin,result.buyer.landed_cost_with_tax,result.import_tax.duty,result.import_tax.vat,result.import_tax.consumption_tax];
  if(totals.some(n=>n!==null&&!n.isFinite()))fail('NONFINITE_RESULT');
  return{project:p,result,comparison};
}
function metrics(r:AnalysisResult){return{seller_profit:r.seller.margin?.toString()??null,buyer_total:r.buyer.landed_cost_with_tax.toString(),base_currency:r.base_currency,decision_ready:r.decision.ready,decision_issues:[...r.decision.issues]};}
/** Synchronous re-entry only. Pending buffers are private and block fee application preparation, handoff and customer staging. */
export class FeeRecoveryTrade {
  private draft:Record<RecoveredTradeField,string>|null=null;private checkpoint:WorkbenchCheckpoint|null=null;
  private readonly badNumbers=new Set<RecoveredTradeField>();private readonly changed=new Set<RecoveredTradeField>();private problems:TradeReentryIssue[]=[];private commits=0;private closed=false;
  constructor(private readonly access:RecoveredTradeAccess){}
  private available(){if(this.closed)fail('CLOSED');}
  hasPending(){return this.draft!==null;}
  isStale(){return this.checkpoint!==null&&!this.access.isCurrent(this.checkpoint);}
  edit(field:RecoveredTradeField,value:string,badInput=false){
    this.available();if(!known(field)||typeof value!=='string'||typeof badInput!=='boolean')fail('FIELD');
    const p=this.access.project();if(field==='quote.amount'&&p.anchor.kind!=='FIXED_QUOTE')fail('QUOTE_MODE_READ_ONLY');
    if(value.length>2048)fail('INPUT_LENGTH');if(this.isStale())fail('STALE_INPUT');
    const checkpoint=this.access.begin();if(this.draft===null)this.draft=inputs(p);this.checkpoint=checkpoint;this.draft[field]=value;this.changed.add(field);
    badInput?this.badNumbers.add(field):this.badNumbers.delete(field);this.problems=[];
  }
  private projectFromDraft(){
    const p=structuredClone(this.access.project()),d=this.draft!;
    for(const field of this.changed){const value=d[field].trim();switch(field){case 'name':p.name=value;break;case 'goods.name':p.goods.name=value;break;case 'goods.quantity':p.goods.quantity=value;break;case 'goods.unit':p.goods.unit=value;break;case 'goods.trade_value.amount':p.goods.trade_value.amount=value;break;case 'goods.seller_goods_cost.amount':p.goods.seller_goods_cost.amount=value;break;case 'quote.amount':if(p.anchor.kind!=='FIXED_QUOTE')fail('QUOTE_MODE_READ_ONLY');p.quote.amount=value;break;}}
    const before=inputs(this.access.project()),goodsChanged=[...this.changed].some(f=>f.startsWith('goods.')&&d[f].trim()!==before[f]),quoteChanged=this.changed.has('quote.amount')&&d['quote.amount'].trim()!==before['quote.amount'];
    // Same goods-field rule as the original form; changed amounts never carry an old contract/insurance approval.
    if(goodsChanged||quoteChanged)for(const r of Object.values(p.term_scenarios??{})){invalidateEvidence(r.quote_evidence);invalidateEvidence(r.insurance?.evidence);invalidateEvidence(r.transport?.evidence);}
    return p;
  }
  commit():boolean {
    this.available();if(!this.draft)return false;if(this.isStale()){this.problems=[{message:'资料上下文已变化；输入保留，请放弃本次输入后按当前资料重新填写。',field:null}];fail('STALE_INPUT');}
    this.problems=[...this.badNumbers].map(field=>({message:'浏览器中的数字尚未完成，请重新填写；不能把无效缓冲当作零。',field}));
    if(this.problems.length)fail('BROWSER_NUMBER_REENTRY');
    const p=this.projectFromDraft();
    this.problems=workspaceIssues(p,booksToRows(p.fx_books)).map(issue=>({message:issue.message,field:known(issue.path)?issue.path:null}));
    if(this.problems.length)fail('INPUT_REVIEW_REQUIRED');
    try{const prepared=calculateRecoveredTrade(p);prepared.project.updated_at=new Date().toISOString();this.access.install(this.checkpoint!,prepared);}
    catch(error){this.problems=[{message:error instanceof EngineError?error.message:error instanceof RecoveryTradeError&&error.code==='NONFINITE_RESULT'?'结果包含非有限金额，请检查数量级、单位和币种。':'本次输入未提交，已提交资料保持；请核对上下文或稍后重试。',field:null}];throw error;}
    this.draft=null;this.checkpoint=null;this.badNumbers.clear();this.changed.clear();this.problems=[];this.commits++;return true;
  }
  discard(){this.available();this.draft=null;this.checkpoint=null;this.badNumbers.clear();this.changed.clear();this.problems=[];}
  view(){
    this.available();const p=this.access.project(),calculated=calculateRecoveredTrade(p),values=this.draft??inputs(p),pending=this.hasPending(),stale=this.isStale();
    const problems=stale?[{message:'资料上下文已变化，请重新录入；本次输入仍保留。',field:null},...this.problems]:this.problems;
    return freezeRecoveryData({scope:'INDEPENDENT_RECOVERED_TRADE_REENTRY',phase:stale?'STALE':pending?problems.length?'BLOCKED':'EDITING':'CALCULATED',
      name:p.name,incoterm:p.incoterm,carriage_mode:p.carriage_mode,anchor:p.anchor.kind,base_currency:p.base_currency,quote_currency:toScenario(p).quote.currency,
      goods_currency:p.goods.trade_value.currency,cost_currency:p.goods.seller_goods_cost.currency,quote_editable:p.anchor.kind==='FIXED_QUOTE',values:{...values},pending,issues:problems,
      result:pending?null:metrics(calculated.result),committed_result:metrics(calculated.result),trade_input_commits:this.commits,cost_count:p.items.length,comparison_count:calculated.comparison.columns.length,
      precision_notes:inputReviews(p,booksToRows(p.fx_books)).map(r=>({code:r.code,label:r.label,message:r.message})),
      archive_drafts_installed:false,customer_approval:false,production_integrated:false,full_live_workbench_reopen:false});
  }
  dispose(){this.closed=true;this.draft=null;this.checkpoint=null;this.badNumbers.clear();this.changed.clear();this.problems=[];}
}
