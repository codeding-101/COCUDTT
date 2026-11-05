/** Local, independent display only. No project, financial, cache, file or customer approval mutation. */
import {WorkbenchStateOwner, type WorkbenchCheckpoint} from '../src/ui/workbench-state';
import {INPUT_SECTION_LABELS} from '../src/ui/input-location';
import {copyFeeEnvelopeJson} from '../src/data/fee-envelope-json';
import {freezeRecoveryData} from './fee-recovery-supplement';
import {FeeRecoveryReview, type RecoveryReviewManifest} from './fee-recovery-review';
import type {FeeRecoveryData} from './fee-recovery-format';

export const PREFERENCE_GROUPS = ['workspace_mode','collapsed_sections','expanded_evidence_sections'] as const;
export type PreferenceGroup = typeof PREFERENCE_GROUPS[number];
export const DISPLAY_EVIDENCE_LABELS = Object.freeze({'advanced-settings':'高级设置','full-results':'完整计算说明','workspace-help':'帮助与说明','container-bill':'独立箱费账单','container-cost-pair':'项目与账单配对','fee-tax-attachment':'费用税务成分','fee-precision-selection':'精度与换汇政策','fee-envelope':'项目资料封套',settlement:'付款与资金假设',sensitivity:'假设分析','customer-quote':'客户公开资料'});
export const COLLAPSIBLE_IDS: readonly string[] = Object.freeze([...Object.keys(INPUT_SECTION_LABELS),'advanced-settings','full-results','workspace-help']);
export const EXPANDABLE_IDS: readonly string[] = Object.freeze(Object.keys(DISPLAY_EVIDENCE_LABELS));
export interface IndependentDisplayPreferences {readonly workspace_mode:'beginner'|'professional'; readonly collapsed_sections:readonly string[]; readonly expanded_evidence_sections:readonly string[]}
export type ReentryDestination = keyof typeof INPUT_SECTION_LABELS | 'container-bill' | 'container-cost-pair' | 'fee-tax-attachment' | 'fee-precision-selection' | 'fee-envelope' | 'settlement' | 'sensitivity' | 'customer-quote' | 'workspace-help';
export interface ReentryGuide {readonly scope:'INDEPENDENT_REENTRY_INSTRUCTION'; readonly source_path:string; readonly destination:ReentryDestination|null; readonly label:string; readonly instruction:string; readonly kind:'FIELD_REENTRY'|'FILE_RESELECT'|'SECTION_REENTRY'|'MANUAL_REVIEW'; readonly applies_archived_value:false}
export interface DisplayPreferenceCandidate {readonly scope:'INDEPENDENT_DISPLAY_CANDIDATE'; readonly selected_groups:readonly PreferenceGroup[]; readonly proposed:IndependentDisplayPreferences; readonly ignored_identifier_count:number; readonly skipped_groups:readonly PreferenceGroup[]; readonly source_sha256:string; readonly supplement_sha256:string; readonly required_choice:'APPLY_SUPPORTED_DISPLAY_ONLY'; readonly financial_writes:0; readonly customer_approval:false}
interface Basis {manifest:RecoveryReviewManifest;archive:FeeRecoveryData;stamp:object}
interface Prepared {candidate:DisplayPreferenceCandidate;basis:Basis;checkpoint:WorkbenchCheckpoint;generation:number;external?:AbortSignal;cleanup:()=>void}
interface Operation {generation:number;basis:Basis;checkpoint:WorkbenchCheckpoint;controller:AbortController;reject:(error:Error)=>void;cleanup:()=>void}
export class RecoveryPreferenceError extends Error {constructor(readonly code:string){super('FEE_RECOVERY_PREFERENCES_'+code);}}
function fail(code:string):never{throw new RecoveryPreferenceError(code);}
const initial=():IndependentDisplayPreferences=>freezeRecoveryData({workspace_mode:'beginner',collapsed_sections:[],expanded_evidence_sections:[]});
const own=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const meaningful=(v:unknown)=>v!==null&&v!==''&&(typeof v!=='object'||Object.keys(v as object).length>0);
const FIELD_GUIDES:Readonly<Record<string,{destination:ReentryDestination;label:string}>>=Object.freeze({
  name:{destination:'goods',label:'项目名称'},'goods.name':{destination:'goods',label:'商品名称'},'goods.quantity':{destination:'goods',label:'数量'},'goods.unit':{destination:'goods',label:'单位'},
  'goods.trade_value.amount':{destination:'goods',label:'货物金额'},'goods.trade_value.currency':{destination:'goods',label:'货值币种'},'goods.seller_goods_cost.amount':{destination:'goods',label:'卖方采购成本'},
  'quote.amount':{destination:'quote',label:'报价金额'},'quote.currency':{destination:'quote',label:'报价币种'},incoterm:{destination:'quote',label:'贸易术语'},'anchor.kind':{destination:'quote',label:'比较基准'},
  'tax_profile.import.declarationDate':{destination:'import-tax',label:'进口申报日期'},'tax_profile.import.vatRate':{destination:'import-tax',label:'进口增值税率'},
});
const FILE_GUIDES:Readonly<Record<string,{destination:ReentryDestination;label:string}>>=Object.freeze({'file-input':{destination:'goods',label:'项目文件'},'bill-file-input':{destination:'container-bill',label:'账单文件'},'pair-file-input':{destination:'container-cost-pair',label:'配对文件'},'fee-tax-file-input':{destination:'fee-tax-attachment',label:'税务成分文件'},'fee-precision-file-input':{destination:'fee-precision-selection',label:'精度文件'},'fee-envelope-file-input':{destination:'fee-envelope',label:'封套文件'},'settlement-file-input':{destination:'settlement',label:'付款假设文件'}});

/** Staging can prepare a detached view, but only this owner's private explicit choice commits it. */
export class FeeRecoveryPreferences {
  private readonly owner=new WorkbenchStateOwner();
  private readonly target={preferences:initial(),destination:null as ReentryDestination|null,display_applications:0};
  private generation=0; private busy=false; private closed=false; private operation:Operation|null=null; private staged:Prepared|null=null; private physical:Promise<void>=Promise.resolve();
  private readonly issued=new WeakMap<object,Prepared>(); private readonly guideBasis=new WeakMap<object,Basis>();
  constructor(private readonly review:FeeRecoveryReview,private readonly prepareView:(view:IndependentDisplayPreferences)=>Promise<IndependentDisplayPreferences>=async view=>view){this.owner.bind(this.target,'independent-display');}
  private available(){if(this.closed)fail('CLOSED');}
  private basis():Basis {this.available();const manifest=this.review.current(),archive=this.review.archive();if(!manifest||!archive||this.review.state().phase!=='OPEN')fail('OPEN_REVIEW_REQUIRED');return{manifest,archive,stamp:this.review.contextStamp()};}
  private current(b:Basis){return!this.closed&&this.review.state().phase==='OPEN'&&this.review.current()===b.manifest&&this.review.archive()===b.archive&&this.review.contextStamp()===b.stamp;}
  private refreshCandidate(){if(this.staged&&(!this.current(this.staged.basis)||!this.owner.isCurrent(this.staged.checkpoint)))this.cancel();}
  private check(op:Operation){if(this.closed)fail('CLOSED');if(this.operation!==op||this.generation!==op.generation||op.controller.signal.aborted||!this.current(op.basis)||!this.owner.isCurrent(op.checkpoint))fail('CANCELLED_OR_STALE');}
  view(){return freezeRecoveryData({preferences:this.target.preferences,destination:this.target.destination,display_applications:this.target.display_applications});}
  state(){this.refreshCandidate();return freezeRecoveryData({scope:'INDEPENDENT_DISPLAY_AND_REENTRY',phase:this.closed?'CLOSED':this.busy?this.operation?'PREPARING':'SETTLING':this.staged?'READY':'OPEN',owner_revision:this.owner.status().revision,...this.view(),financial_writes:0,customer_approval:false,storage_writes:0,file_writes:0,production_integrated:false,actual_workbench_navigation:false});}
  whenIdle(){return this.physical;}
  pending(){this.refreshCandidate();return this.staged?.candidate??null;}
  cancel(){this.generation++;if(this.staged){this.staged.cleanup();this.issued.delete(this.staged.candidate);}this.staged=null;const op=this.operation;this.operation=null;if(op){op.cleanup();op.reject(new RecoveryPreferenceError('CANCELLED_OR_STALE'));op.controller.abort();}}
  resetDisplay(){this.available();this.cancel();const checkpoint=this.owner.checkpoint();if(!this.owner.commit(checkpoint,[{target:this.target,values:{preferences:initial(),destination:null}}]))fail('CANCELLED_OR_STALE');}
  isOpen(id:string){const p=this.target.preferences;if(p.expanded_evidence_sections.includes(id))return true;if(p.collapsed_sections.includes(id))return false;return Object.hasOwn(INPUT_SECTION_LABELS,id)||['advanced-settings','full-results','workspace-help'].includes(id)&&p.workspace_mode==='professional';}
  toggle(id:string,open:boolean){
    this.available();if(typeof open!=='boolean'||!COLLAPSIBLE_IDS.includes(id)&&!EXPANDABLE_IDS.includes(id))fail('UNKNOWN_DISPLAY_TARGET');this.cancel();
    const p=this.target.preferences,closed=new Set(p.collapsed_sections),expanded=new Set(p.expanded_evidence_sections);
    if(COLLAPSIBLE_IDS.includes(id)){if(open)closed.delete(id);else closed.add(id);}if(EXPANDABLE_IDS.includes(id)){if(open)expanded.add(id);else expanded.delete(id);}
    const prefs=freezeRecoveryData({...p,collapsed_sections:[...closed],expanded_evidence_sections:[...expanded]}),checkpoint=this.owner.checkpoint();
    if(!this.owner.commit(checkpoint,[{target:this.target,values:{preferences:prefs}}]))fail('CANCELLED_OR_STALE');
  }
  private proposed(b:Basis,selection:readonly PreferenceGroup[]){
    const selected=copyFeeEnvelopeJson(selection) as unknown;if(!Array.isArray(selected)||!selected.length||selected.length>3||selected.some(v=>!(PREFERENCE_GROUPS as readonly unknown[]).includes(v))||new Set(selected).size!==selected.length)fail('EXPLICIT_GROUPS_REQUIRED');
    const chosen=selected as PreferenceGroup[],next={...this.target.preferences},skipped:PreferenceGroup[]=[];let ignored=0;
    for(const key of chosen){if(key==='workspace_mode'){const mode=b.archive.supplement.workflow.workspace_mode;if(mode!=='beginner'&&mode!=='professional')fail('UNSUPPORTED_MODE');next.workspace_mode=mode;continue;}
      const value=b.archive.supplement.view[key];if(!Array.isArray(value)||value.length>256||value.some(v=>typeof v!=='string'))fail('DISPLAY_LIST_LIMIT');
      const supported=key==='collapsed_sections'?COLLAPSIBLE_IDS:EXPANDABLE_IDS,accepted=[...new Set(value.filter(v=>supported.includes(v)))];ignored+=value.filter(v=>!supported.includes(v)).length;
      if(value.length&&!accepted.length){skipped.push(key);continue;}next[key]=accepted;
    }
    if(next.collapsed_sections.some(id=>next.expanded_evidence_sections.includes(id)))fail('CONFLICTING_VISIBILITY');
    return{chosen,proposed:freezeRecoveryData(next),ignored,skipped};
  }
  async stage(selection:readonly PreferenceGroup[],external?:AbortSignal):Promise<DisplayPreferenceCandidate>{
    this.available();if(this.busy)fail('BUSY');if(external?.aborted)fail('CANCELLED_OR_STALE');const basis=this.basis(),p=this.proposed(basis,selection);this.cancel();this.busy=true;
    let reject!:(error:Error)=>void;const interrupted=new Promise<never>((_,no)=>{reject=no;});void interrupted.catch(()=>{});
    const op:Operation={generation:this.generation,basis,checkpoint:this.owner.checkpoint(),controller:new AbortController(),reject,cleanup:()=>{}};this.operation=op;
    const abort=()=>{if(this.operation===op||this.staged?.generation===op.generation)this.cancel();};external?.addEventListener('abort',abort,{once:true});op.cleanup=()=>external?.removeEventListener('abort',abort);
    const task=(async()=>{try{this.check(op);const prepared=await this.prepareView(p.proposed);this.check(op);const safe=copyFeeEnvelopeJson(prepared);this.check(op);if(JSON.stringify(safe)!==JSON.stringify(p.proposed))fail('PREPARATION_MISMATCH');
      const candidate:DisplayPreferenceCandidate=freezeRecoveryData({scope:'INDEPENDENT_DISPLAY_CANDIDATE',selected_groups:p.chosen,proposed:p.proposed,ignored_identifier_count:p.ignored,skipped_groups:p.skipped,source_sha256:basis.manifest.source_sha256,supplement_sha256:basis.manifest.supplement_sha256,required_choice:'APPLY_SUPPORTED_DISPLAY_ONLY',financial_writes:0,customer_approval:false});
      const staged={candidate,basis,checkpoint:op.checkpoint,generation:op.generation,external,cleanup:op.cleanup};this.check(op);this.staged=staged;this.issued.set(candidate,staged);return candidate;
    }catch{this.check(op);fail('PREPARATION_FAILED');}finally{if(this.staged?.generation!==op.generation)op.cleanup();if(this.operation===op)this.operation=null;this.busy=false;}})();this.physical=task.then(()=>{},()=>{});return Promise.race([task,interrupted]);
  }
  confirm(candidate:DisplayPreferenceCandidate,choice:'APPLY_SUPPORTED_DISPLAY_ONLY'){
    this.available();const p=this.issued.get(candidate);if(!p||this.staged!==p||p.generation!==this.generation||p.external?.aborted||!this.current(p.basis)||!this.owner.isCurrent(p.checkpoint))fail('FOREIGN_CONSUMED_OR_STALE');if(choice!=='APPLY_SUPPORTED_DISPLAY_ONLY')fail('DISPLAY_CHOICE_REQUIRED');if(this.busy)fail('BUSY');
    if(!this.owner.commit(p.checkpoint,[{target:this.target,values:{preferences:p.candidate.proposed,destination:null,display_applications:this.target.display_applications+1}}]))fail('CANCELLED_OR_STALE');
    this.issued.delete(candidate);p.cleanup();this.staged=null;return this.view();
  }
  guides():readonly ReentryGuide[]{
    const b=this.basis(),a=b.archive,rows:ReentryGuide[]=[];const add=(source_path:string,destination:ReentryDestination|null,label:string,kind:ReentryGuide['kind'])=>{const guide:ReentryGuide=freezeRecoveryData({scope:'INDEPENDENT_REENTRY_INSTRUCTION',source_path,destination,label,kind,instruction:kind==='FILE_RESELECT'?'原档案只有文件元数据，请在原工作台重新选取文件并完成原校验。':destination===null?'这个归档字段没有受支持的定位入口，请人工核对原文并在原工作台重新录入。':'这里只定位到本容器的重新录入说明；实际数据须在原工作台重新填写并通过原校验。',applies_archived_value:false});rows.push(guide);this.guideBasis.set(guide,b);};
    for(const[key,destination,label]of[['cost','items','费用编辑'],['review','container-cost-pair','费用核对记录'],['attachment','fee-tax-attachment','税务成分草稿'],['precision','fee-precision-selection','精度政策草稿']] as const)if(a.restoration.capture.editors[key]!==null)add('/capture/editors/'+key,destination,label,'SECTION_REENTRY');
    const r=own(a.restoration.retained_root);for(const[key,destination,label]of[['settlement_plan','settlement','付款与资金假设'],['sensitivity','sensitivity','假设分析'],['customer_fields','customer-quote','客户公开字段']] as const)if(meaningful(r[key]))add('/retained/'+key,destination,label,'SECTION_REENTRY');
    const c=a.supplement.pending_control;if(c){const dataset=own(c.dataset),path=typeof dataset.path==='string'?dataset.path:null,id=typeof c.id==='string'?c.id:null;
      const unread=c.type==='file'||Array.isArray(c.files)&&c.files.length>0;
      const file=unread&&id&&Object.hasOwn(FILE_GUIDES,id)?FILE_GUIDES[id]:null;
      const field=!unread&&['INPUT','SELECT','TEXTAREA'].includes(String(c.tag))&&path&&Object.hasOwn(FIELD_GUIDES,path)?FIELD_GUIDES[path]:null;
      add('/supplement/pending_control',file?.destination??field?.destination??null,file?.label??field?.label??'未提交输入',unread?'FILE_RESELECT':field?'FIELD_REENTRY':'MANUAL_REVIEW');
    }else if(a.supplement.pending_other||a.supplement.workflow.pending_calculation===true)add('/supplement/pending_other',null,'未提交页面输入','MANUAL_REVIEW');
    return freezeRecoveryData(rows);
  }
  navigate(guide:ReentryGuide){
    this.available();const b=this.guideBasis.get(guide);if(!b||!this.current(b))fail('FOREIGN_OR_STALE_GUIDE');if(guide.destination===null)fail('MANUAL_REENTRY_REQUIRED');if(this.busy||this.staged)fail('BUSY');
    const p=this.target.preferences,d=guide.destination,expanded=new Set(p.expanded_evidence_sections);if(!['goods','quote','workspace-help'].includes(d))expanded.add('advanced-settings');if(EXPANDABLE_IDS.includes(d))expanded.add(d);
    const prefs=freezeRecoveryData({...p,collapsed_sections:p.collapsed_sections.filter(id=>id!==d&&!(expanded.has('advanced-settings')&&id==='advanced-settings')),expanded_evidence_sections:[...expanded]});
    const checkpoint=this.owner.checkpoint();if(!this.owner.commit(checkpoint,[{target:this.target,values:{preferences:prefs,destination:d}}]))fail('CANCELLED_OR_STALE');return d;
  }
  dispose(){this.closed=true;this.cancel();}
}
