/** Diagnostic adaptations of pinned UI modules; production files and business rules are untouched. */
export type ModalRole='mobile'|'field'|'guide';
export const MODAL_SCOPE_IMPORT="import{modalCompositionPort as __modalPort126}from'/tools/fee-modal-composition-scope.ts';\n";
export function modalCompositionPrefix(value:string){if(typeof value!=='string'||!/^modal126-[a-z0-9]{1,24}$/.test(value))throw Error('MODAL_COMPOSITION_PREFIX');return value;}
export function transformModalCompositionSource(input:string,prefix:string,role:ModalRole){
 modalCompositionPrefix(prefix);if(!['mobile','field','guide'].includes(role))throw Error('MODAL_COMPOSITION_ROLE');
 const source=input.replace(/\r\n/g,'\n'),count=(s:string,p:string)=>s.split(p).length-1,replacements:[string,string][]=[];
 if(source.includes('__modal126')||source.includes('__modalPort126'))throw Error('MODAL_COMPOSITION_ALREADY_ADAPTED');
 const ids=role==='mobile'?['mobile-settings-dialog','mobile-settings-title','data-mobile-settings-feedback']:role==='field'?['field-help-dialog','field-help-title','field-help-content']:['onboarding-dialog','onboarding-title','data-onboarding-status'];
 for(const id of ids){const n=count(source,id);if(n<2)throw Error('MODAL_COMPOSITION_ID_SITE');replacements.push([id,id.startsWith('data-')?'data-'+prefix+'-'+role+'-'+id.slice(5):prefix+'-'+role+'-'+id]);}
 const listeners=role==='field'?2:3;if(count(source,'dialog.addEventListener(')!==listeners)throw Error('MODAL_COMPOSITION_LISTENERS');
 const close=role==='mobile'?'placement.dialog.close()':'dialog.close()',closeCalls=source.match(/\b(?:[A-Za-z_$][\w$]*\.)*dialog\.close\(\)/g)??[];
 if(JSON.stringify(closeCalls)!==JSON.stringify([close]))throw Error('MODAL_COMPOSITION_CLOSE_RECEIVER');
 replacements.push(['dialog.addEventListener(','__modal126.listen(dialog,'],['dialog.showModal()','__modal126.showModal(dialog)'],[close,role==='mobile'?'__modal126.closeModal(placement.dialog)':'__modal126.closeModal(dialog)']);
 if(role==='guide'){
  const read='localStorage.getItem(ONBOARDING_KEY)',write="localStorage.setItem(ONBOARDING_KEY,this.hidden?'hidden':'show')";if(count(source,read)!==1||count(source,write)!==1||count(source,'localStorage.')!==2)throw Error('MODAL_COMPOSITION_PREFERENCE');
  replacements.push([read,'__modal126.readPreference()'],[write,"__modal126.writePreference(this.hidden?'hidden':'show')"],['以后不再自动显示（仅此浏览器）','本次副本会话不再自动显示'],['关闭后可从“使用引导”再次打开；偏好在关闭时保存。','关闭后可从“使用引导”再次打开；偏好仅在本次副本会话保留。']);
 }
 if(role==='mobile'){
  const lease='interface OverflowLease {style:CSSStyleDeclaration;axes:{name:string;value:string;priority:string}[];}';
  const start=source.indexOf(' private lockOverflow():void{'),end=source.indexOf(' private restorePanel(',start);if(start<0||end<start||count(source,' private releaseOverflow():void{')!==1||count(source,lease)!==1)throw Error('MODAL_COMPOSITION_SCROLL_SITES');
  replacements.push([lease,'type OverflowLease=ReturnType<typeof __modal126.lockScroll>;'],[source.slice(start,end),' private lockOverflow():void{if(!this.overflow)this.overflow=__modal126.lockScroll();}\n private releaseOverflow():void{if(this.overflow){__modal126.unlockScroll(this.overflow);this.overflow=null;}}\n']);
  replacements.push(["typeof matchMedia==='function'&&matchMedia(","__modal126.matchMedia("],['window.','__modal126.window.']);
 }
 replacements.push(['document.','__modal126.document.']);
 let code=source;for(const[a,b]of replacements){if(!code.includes(a))throw Error('MODAL_COMPOSITION_MISSING_SITE '+a);code=code.replaceAll(a,b);}
 const head=MODAL_SCOPE_IMPORT+`const __modal126=__modalPort126('${prefix}','${role}');\n`;code=head+code;
 let restored=code.slice(head.length);for(const[a,b]of [...replacements].reverse())restored=restored.replaceAll(b,a);
 if(restored!==source||role==='guide'&&code.includes('localStorage.'))throw Error('MODAL_COMPOSITION_ROUNDTRIP');
 return{code,source,role,prefix,roundtrip:true,listener_sites:listeners,id_sites:Object.fromEntries(ids.map(id=>[id,count(source,id)])),scroll_adapter:role==='mobile',preference_adapter:role==='guide',root_queries_scoped:true,production_source_changed:false};
}
