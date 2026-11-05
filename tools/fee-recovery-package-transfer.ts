/** One local transfer slot. Readonly file inspection never installs into the producing business session. */
import {parseRecoveredPackage,RECOVERED_PACKAGE_LIMITS,RecoveryPackageError,type RecoveredPackageReview} from './fee-recovery-package';
import {recoveredHandoffFile,type RecoveredHandoffFile} from './fee-recovery-business-files';
import {feeEnvelopeSha256} from '../src/data/fee-envelope-json';
import {freezeRecoveryData} from './fee-recovery-supplement';
export interface RecoveredPackageBackend{build():Promise<RecoveredHandoffFile>;lease():object;current(lease:object):boolean}
export interface RecoveredPackageFileSource{readonly name?:string;readonly size:number;arrayBuffer():Promise<ArrayBuffer>}
export type PackageWriteResult='SAVED'|'DOWNLOAD_STARTED';
export type PackageWriter=(file:RecoveredHandoffFile)=>Promise<PackageWriteResult>;
export interface RecoveredPackageChoice{readonly scope:'RECOVERED_PACKAGE_EXPORT'|'RECOVERED_PACKAGE_READONLY_OPEN';readonly name:string;readonly bytes:number;readonly sha256:string;readonly review:RecoveredPackageReview;readonly required_choice:'EXPORT_INTERNAL_PACKAGE'|'OPEN_READ_ONLY_PACKAGE'}
interface Pending{readonly token:RecoveredPackageChoice;readonly file:RecoveredHandoffFile;readonly lease:object;readonly generation:number;readonly signal?:AbortSignal;readonly cleanup:()=>void}
interface Operation{readonly reject:(e:Error)=>void;readonly cleanup:()=>void}
function fail(code:string):never{throw new RecoveryPackageError(code);}
export class RecoveredPackageTransfer{
  private generation=0;private physical=false;private operation:Operation|null=null;private mode='IDLE';private staged:Pending|null=null;private readonly issued=new WeakMap<object,Pending>();private closed=false;private idle:Promise<void>=Promise.resolve();
  private retained:RecoveredHandoffFile|null=null;private incomingBytes=0;private opened:RecoveredPackageReview|null=null;private delivery:{name:string;bytes:number;sha256:string;result:PackageWriteResult}|null=null;
  constructor(private readonly backend:RecoveredPackageBackend,private readonly afterPrepare:()=>Promise<void>=async()=>{}){}
  private available(){if(this.closed)fail('CLOSED');}
  private current(generation:number,lease:object,signal?:AbortSignal){try{return!this.closed&&generation===this.generation&&!signal?.aborted&&this.backend.current(lease);}catch{return false;}}
  private valid(p:Pending){return this.staged===p&&this.current(p.generation,p.lease,p.signal);}
  cancel(){this.generation++;if(this.staged){this.issued.delete(this.staged.token);this.staged.cleanup();}this.staged=null;const op=this.operation;this.operation=null;if(op){op.cleanup();op.reject(new RecoveryPackageError('CANCELLED'));}}
  pending(){if(this.staged&&!this.valid(this.staged))this.cancel();return this.staged?.token??null;}
  busy(){return this.physical;}
  whenIdle(){return this.idle;}
  currentReview(){return this.opened;}
  state(){const p=this.pending();return freezeRecoveryData({scope:'INDEPENDENT_INTERNAL_PACKAGE_TRANSFER',phase:this.closed?'CLOSED':this.physical?this.operation?this.mode:'SETTLING':p?'AWAITING_EXPLICIT_CHOICE':this.opened?'READ_ONLY_OPEN':'IDLE',pending:p!==null,retained_package_bytes:this.retained?.bytes??0,incoming_bytes:this.incomingBytes,last_delivery:this.delivery,readonly_open:this.opened!==null,financial_writes:0,import_authority:false,customer_approval:false,full_live_workbench_reopen:false,production_integrated:false});}
  async prepareExport(signal?:AbortSignal){
    return this.prepare('BUILDING','RECOVERED_PACKAGE_EXPORT',async()=>this.backend.build(),signal);
  }
  async stageFile(file:RecoveredPackageFileSource,signal?:AbortSignal){
    this.available();if(this.physical)fail('BUSY');const size=file.size,name=file.name??'recovered-business-package.json';if(!Number.isSafeInteger(size)||size<1||size>RECOVERED_PACKAGE_LIMITS.file_bytes||typeof name!=='string')fail('FILE_SIZE');
    return this.prepare('READING','RECOVERED_PACKAGE_READONLY_OPEN',async()=>{const buffer=await file.arrayBuffer();if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==size||buffer.byteLength>RECOVERED_PACKAGE_LIMITS.file_bytes)fail('FILE_BYTES');this.incomingBytes=buffer.byteLength;let raw:string;try{raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer);}catch{return fail('FILE_UTF8');}return recoveredHandoffFile(name.slice(0,200),raw);},signal);
  }
  private async prepare(mode:string,scope:RecoveredPackageChoice['scope'],read:()=>Promise<RecoveredHandoffFile>,signal?:AbortSignal):Promise<RecoveredPackageChoice>{
    this.available();if(this.physical)fail('BUSY');if(signal?.aborted)fail('CANCELLED');this.cancel();const lease=this.backend.lease(),generation=this.generation;this.physical=true;this.mode=mode;
    return this.run(generation,lease,signal,async cleanup=>{const file=await read();if(!this.current(generation,lease,signal))fail('CANCELLED_OR_STALE');if(file.bytes!==new TextEncoder().encode(file.text).length||file.sha256!==await feeEnvelopeSha256(file.text)||file.mime!=='application/json')fail('FILE_DIGEST_OR_NAME');const parsed=await parseRecoveredPackage(file.text);await this.afterPrepare();if(!this.current(generation,lease,signal))fail('CANCELLED_OR_STALE');
      const token:RecoveredPackageChoice=freezeRecoveryData({scope,name:file.name,bytes:file.bytes,sha256:file.sha256,review:parsed.review,required_choice:scope==='RECOVERED_PACKAGE_EXPORT'?'EXPORT_INTERNAL_PACKAGE':'OPEN_READ_ONLY_PACKAGE'});const p:Pending={token,file,lease,generation,signal,cleanup};this.staged=p;this.issued.set(token,p);this.retained=file;return token;});
  }
  async deliver(token:RecoveredPackageChoice,choice:'EXPORT_INTERNAL_PACKAGE',write:PackageWriter,signal?:AbortSignal){
    this.available();if(this.physical)fail('BUSY');const p=this.issued.get(token);if(!p||!this.valid(p)||token.scope!=='RECOVERED_PACKAGE_EXPORT')fail('FOREIGN_CONSUMED_OR_STALE');if(choice!=='EXPORT_INTERNAL_PACKAGE')fail('EXPLICIT_CHOICE_REQUIRED');if(signal?.aborted)fail('CANCELLED');this.issued.delete(token);this.staged=null;this.physical=true;this.mode='DELIVERING';
    try{return await this.run(p.generation,p.lease,signal,async()=>{let result:PackageWriteResult;try{result=await write(p.file);}catch(error){if(error instanceof DOMException&&error.name==='AbortError')fail('DELIVERY_CANCELLED');return fail('WRITE_FAILED');}if(result!=='SAVED'&&result!=='DOWNLOAD_STARTED')fail('WRITE_RESULT');if(!this.current(p.generation,p.lease,signal)||p.signal?.aborted)fail('CANCELLED_OR_STALE');const delivery=Object.freeze({name:p.file.name,bytes:p.file.bytes,sha256:p.file.sha256,result});this.delivery=delivery;return delivery;});}finally{p.cleanup();}
  }
  openReadOnly(token:RecoveredPackageChoice,choice:'OPEN_READ_ONLY_PACKAGE'){
    this.available();if(this.physical)fail('BUSY');const p=this.issued.get(token);if(!p||!this.valid(p)||token.scope!=='RECOVERED_PACKAGE_READONLY_OPEN')fail('FOREIGN_CONSUMED_OR_STALE');if(choice!=='OPEN_READ_ONLY_PACKAGE')fail('EXPLICIT_CHOICE_REQUIRED');this.issued.delete(token);p.cleanup();this.staged=null;this.generation++;this.opened=token.review;return this.opened;
  }
  private run<T>(generation:number,lease:object,signal:AbortSignal|undefined,task:(cleanup:()=>void)=>Promise<T>):Promise<T>{
    let reject!:(e:Error)=>void;const interrupted=new Promise<never>((_,no)=>{reject=no;});void interrupted.catch(()=>{});const abort=()=>this.cancel(),cleanup=()=>signal?.removeEventListener('abort',abort);signal?.addEventListener('abort',abort,{once:true});const op:Operation={reject,cleanup};this.operation=op;
    const work=(async()=>{try{if(!this.current(generation,lease,signal))fail('CANCELLED_OR_STALE');return await task(cleanup);}catch(error){if(!this.current(generation,lease,signal))fail('CANCELLED_OR_STALE');if(error instanceof RecoveryPackageError)throw error;throw new RecoveryPackageError('PREPARATION_FAILED');}finally{if(this.staged?.generation!==generation)cleanup();if(this.operation===op)this.operation=null;this.physical=false;this.mode='IDLE';}})();void work.catch(()=>{});this.idle=work.then(()=>{},()=>{});return Promise.race([work,interrupted]);
  }
  dispose(){this.closed=true;this.cancel();}
}
