/** Independent sensitivity/customer inputs and fresh, session-local public review. */
import type { ProjectFile } from '../src/data/project-file';
import { CUSTOMER_QUOTE_FIELDS,type CustomerQuoteFields,type CustomerQuote } from '../src/domain/customer-quote';
import { projectCustomerQuote } from '../src/data/customer-quote';
import { requireCustomerQuoteView } from '../src/data/customer-quote-view';
import { sensitivityOptions,projectSensitivity,type SensitivityControls } from '../src/ui/sensitivity';
import type { SensitivityResult } from '../src/engine/sensitivity';
import { calculateRecoveredTrade } from './fee-recovery-trade';
import { freezeRecoveryData } from './fee-recovery-supplement';
import { newTradeFormsInput,readTradeFormsInput,writeTradeFormsInput,type TradeFormsInput } from './fee-trade-forms-format';
import { tradeFormsCustomerArtifact,type CustomerArtifact,type CustomerArtifactFormat } from './fee-trade-forms-customer';

export class TradeFormsError extends Error {constructor(readonly code:string){super('TRADE_FORMS_'+code);}}
function fail(code:string):never{throw new TradeFormsError(code);}
export interface TradeFormsAccess {project():ProjectFile;beforeEdit():void;beforeCustomer():void;context():()=>boolean;pendingBusiness?():boolean}
export interface CustomerReview {readonly scope:'PUBLIC_CUSTOMER_DRAFT_REVIEW';readonly quote:CustomerQuote;readonly view:'full'|'compact';readonly generated_at:string;readonly required_choice:'REVIEW_CURRENT_PUBLIC_FIELDS'}
interface Review {token:CustomerReview;context:()=>boolean;revision:number;generation:number;checked:boolean}

export class FeeTradeForms {
  private raw:string|null;private draft:TradeFormsInput|null=null;private context:(()=>boolean)|null=null;private revision=0;private generation=0;private closed=false;
  private review:Review|null=null;private physical=false;private rejectTask:((e:Error)=>void)|null=null;private idle:Promise<void>=Promise.resolve();private message='敏感性与客户字段分别填写，仅作为内部草稿。';
  constructor(private readonly access:TradeFormsAccess,raw:string|null=null){if(raw!==null)readTradeFormsInput(raw);this.raw=raw;}
  private available(){if(this.closed)fail('CLOSED');}
  private touch(){if(this.revision===Number.MAX_SAFE_INTEGER)fail('REVISION_LIMIT');this.revision++;}
  private begin(){this.available();if(this.context&&!this.context())fail('STALE_INPUT');this.access.beforeEdit();this.cancelCustomer();this.context=this.access.context();this.draft??=this.raw?readTradeFormsInput(this.raw):newTradeFormsInput();this.touch();}
  editSensitivity(field:keyof SensitivityControls,value:string|boolean){if(!['enabled','kind','target','from','to','step'].includes(field)||(field==='enabled'?typeof value!=='boolean':typeof value!=='string'||value.length>4000))fail('FIELD');this.begin();(this.draft!.sensitivity as unknown as Record<string,unknown>)[field]=value;this.message='敏感性输入尚未提交，旧结果暂不展示。';}
  editCustomer(field:keyof CustomerQuoteFields,value:string){if(!CUSTOMER_QUOTE_FIELDS.includes(field)||typeof value!=='string'||value.length>4000)fail('FIELD');this.begin();this.draft!.customer_fields[field]=value;this.message='公开字段尚未提交，旧客户核对已失效。';}
  editView(view:'full'|'compact'){requireCustomerQuoteView(view);this.begin();this.draft!.customer_view=view;}
  commit(){this.available();if(!this.draft)return false;if(!this.context?.()){this.message='业务或付款上下文已变化，输入保留；请放弃本次缓冲后重新核对。';fail('STALE_INPUT');}const raw=writeTradeFormsInput(this.draft);this.raw=raw;this.draft=null;this.context=null;this.touch();this.message='内部表单草稿已提交；计算与客户公开内容继续沿原校验核对。';return true;}
  discard(){this.available();this.draft=null;this.context=null;this.touch();this.cancelCustomer();this.message='已放弃本次整份表单缓冲，已提交输入保持。';}
  hasPending(){return this.draft!==null;}
  committedRaw(){this.available();return this.raw;}
  version(){return this.revision;}
  lifecycleContext(){const revision=this.revision,generation=this.generation,context=this.access.context();return()=>!this.closed&&this.revision===revision&&this.generation===generation&&context();}
  busy(){return this.physical;}
  whenIdle(){return this.idle;}
  private current(p:Review){return!this.closed&&p===this.review&&p.revision===this.revision&&p.generation===this.generation&&!this.draft&&p.context();}
  pendingReview(){if(this.review&&!this.current(this.review))this.review=null;return this.review?.token??null;}
  cancelCustomer(){this.generation++;this.review=null;const reject=this.rejectTask;this.rejectTask=null;reject?.(new TradeFormsError('CANCELLED'));}
  prepareCustomer():CustomerReview{this.available();this.access.beforeCustomer();if(this.draft)fail('UNCOMMITTED_INPUT');this.cancelCustomer();const input=this.raw?readTradeFormsInput(this.raw):newTradeFormsInput(),context=this.access.context(),quote=projectCustomerQuote(this.access.project(),input.customer_fields);if(!context())fail('STALE_INPUT');const token=freezeRecoveryData({scope:'PUBLIC_CUSTOMER_DRAFT_REVIEW' as const,quote,view:input.customer_view,generated_at:new Date().toISOString(),required_choice:'REVIEW_CURRENT_PUBLIC_FIELDS' as const});this.review={token,context,revision:this.revision,generation:this.generation,checked:false};return token;}
  acknowledgeCustomer(token:CustomerReview,checked:boolean){this.available();const p=this.review;if(!p||p.token!==token||!this.current(p))fail('FOREIGN_OR_STALE');if(typeof checked!=='boolean')fail('ACKNOWLEDGEMENT');p.checked=checked;}
  private async customerTask<T>(token:CustomerReview,format:CustomerArtifactFormat,use:(file:CustomerArtifact)=>Promise<T>,signal?:AbortSignal):Promise<T>{
    this.available();if(this.physical)fail('BUSY');const p=this.review;if(!p||p.token!==token||!this.current(p))fail('FOREIGN_OR_STALE');if(!p.checked)fail('FRESH_REVIEW_REQUIRED');if(signal?.aborted)return Promise.reject(new TradeFormsError('CANCELLED'));
    this.physical=true;let reject!:(e:Error)=>void;const interrupt=new Promise<never>((_,no)=>{reject=no;});void interrupt.catch(()=>{});this.rejectTask=reject;
    const abort=()=>this.cancelCustomer();signal?.addEventListener('abort',abort,{once:true});
    const work=(async()=>{try{const file=await tradeFormsCustomerArtifact(token.quote,token.generated_at,token.view,format);if(!this.current(p)||!p.checked||signal?.aborted)fail('CANCELLED_OR_STALE');const result=await use(file);if(!this.current(p)||!p.checked||signal?.aborted)fail('CANCELLED_OR_STALE');return result;}finally{signal?.removeEventListener('abort',abort);if(this.rejectTask===reject)this.rejectTask=null;this.physical=false;}})();void work.catch(()=>{});this.idle=work.then(()=>{},()=>{});return Promise.race([work,interrupt]);
  }
  customerFile(token:CustomerReview,format:CustomerArtifactFormat,signal?:AbortSignal){return this.customerTask(token,format,async f=>f,signal);}
  deliverCustomer(token:CustomerReview,format:CustomerArtifactFormat,writer:(file:CustomerArtifact)=>Promise<'DOWNLOAD_STARTED'|'SAVED'>,signal?:AbortSignal){return this.customerTask(token,format,async file=>{let result:'DOWNLOAD_STARTED'|'SAVED';try{result=await writer(file);}catch(e){if(e instanceof DOMException&&e.name==='AbortError')fail('WRITE_CANCELLED');fail('WRITE_FAILED');}if(!['DOWNLOAD_STARTED','SAVED'].includes(result))fail('WRITE_RESULT');return Object.freeze({scope:'PUBLIC_CUSTOMER_DRAFT_DELIVERY',name:file.name,mime:file.mime,bytes:file.data.byteLength,result,view:token.view});},signal);}
  view(){
    this.available();const input=this.draft??(this.raw?readTradeFormsInput(this.raw):newTradeFormsInput()),blocked=this.access.pendingBusiness?.()??false;let sensitivity:SensitivityResult|null=null,sensitivity_error:string|null=null,customer:CustomerQuote|null=null,customer_error:string|null=null;
    if(!this.draft&&!blocked){const p=this.access.project();if(input.sensitivity.enabled)try{const result=calculateRecoveredTrade(p).result;if(!sensitivityOptions(p,result,input.sensitivity.kind).some(o=>o.value===input.sensitivity.target))throw Error('调整对象不在当前方案可选范围，请重新选择');sensitivity=projectSensitivity(p,input.sensitivity);}catch(e){sensitivity_error=e instanceof Error?e.message:'敏感性分析未完成';}try{customer=projectCustomerQuote(p,input.customer_fields);}catch(e){customer_error=e instanceof Error?e.message:'客户公开字段未完成';}}
    if(blocked)sensitivity_error=customer_error='业务或付款输入尚未提交，旧分析和客户预览暂不展示。';
    const token=this.pendingReview();return freezeRecoveryData({scope:'INDEPENDENT_SENSITIVITY_CUSTOMER_INPUTS',input:structuredClone(input),pending:!!this.draft,blocked,stale:!!this.context&&!this.context(),message:this.message,revision:this.revision,sensitivity,sensitivity_error,customer,customer_error,review:token,reviewed:!!token&&this.review!.checked,physical:this.physical,financial_writes:0,customer_document_scope:'PUBLIC_PROJECTION_ONLY'});
  }
  dispose(){if(this.closed)return;this.closed=true;this.cancelCustomer();this.draft=null;this.context=null;}
}
