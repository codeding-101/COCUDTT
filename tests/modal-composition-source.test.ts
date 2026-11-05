import{describe,it,expect}from'vitest';import{readFileSync}from'node:fs';
import{transformModalCompositionSource,modalCompositionPrefix,type ModalRole}from'../tools/fee-modal-composition-source';
import{modalCompositionPort}from'../tools/fee-modal-composition-scope';
const paths={mobile:'mobile-settings',field:'field-help',guide:'onboarding'};
const sources=Object.fromEntries(Object.entries(paths).map(([role,name])=>[role,readFileSync(new URL('../src/ui/'+name+'.ts',import.meta.url),'utf8').replace(/\r\n/g,'\n')]))as Record<ModalRole,string>;
describe('bounded composition source adaptations',()=>{
 for(const role of['mobile','field','guide']as const){
  it(role+' only redirects registered presentation ports and restores exactly',()=>{const r=transformModalCompositionSource(sources[role],'modal126-test',role);expect(r.roundtrip).toBe(true);expect(r.source).toBe(sources[role]);expect(r.production_source_changed).toBe(false);expect(r.root_queries_scoped).toBe(true);expect(r.code).not.toMatch(/(?<!__modal126\.)document\./);expect(r.code).not.toContain('dialog.addEventListener(');});
  it(role+' namespaces dialog references without changing the input module',()=>{const before=sources[role],a=transformModalCompositionSource(before,'modal126-a',role),b=transformModalCompositionSource(before,'modal126-b',role);expect(a.code).toContain('modal126-a-'+role);expect(b.code).not.toContain('modal126-a-');expect(sources[role]).toBe(before);expect(a.listener_sites).toBe(role==='field'?2:3);});
  it(role+' refuses repeated adaptation',()=>{const adapted=transformModalCompositionSource(sources[role],'modal126-a',role);expect(()=>transformModalCompositionSource(adapted.code,'modal126-b',role)).toThrow('ALREADY_ADAPTED');});
 }
 it('removes persistent preference access from the copy',()=>{const r=transformModalCompositionSource(sources.guide,'modal126-a','guide');expect(r.code).not.toContain('localStorage.');expect(r.code).toContain('本次副本会话不再自动显示');expect(r.code).toContain('__modal126.readPreference()');});
 it('redirects mobile scroll ownership while keeping native layout and beforeRender',()=>{const r=transformModalCompositionSource(sources.mobile,'modal126-a','mobile');expect(r.code).toContain('__modal126.lockScroll()');expect(r.code).toContain('__modal126.unlockScroll(this.overflow)');expect(r.code).toContain('beforeRender(project:object)');expect(r.code).toContain('private restorePanel(');expect(r.code).not.toContain('document.body.style');});
 it('routes a captured placement dialog through the same close port',()=>{const r=transformModalCompositionSource(sources.mobile,'modal126-a','mobile');expect(r.code).toContain('__modal126.closeModal(placement.dialog)');expect(r.code).not.toContain('placement.__modal126');});
 it('refuses an unexpected qualified close receiver',()=>{expect(()=>transformModalCompositionSource(sources.mobile.replace('placement.dialog.close()','other.dialog.close()'),'modal126-a','mobile')).toThrow();});
 it('rejects an added unregistered native listener',()=>{expect(()=>transformModalCompositionSource(sources.mobile+"\ndialog.addEventListener('click',()=>{});",'modal126-a','mobile')).toThrow('LISTENERS');});
 it('rejects a missing markup identity',()=>{expect(()=>transformModalCompositionSource(sources.field.replaceAll('field-help-title','other-title'),'modal126-a','field')).toThrow('ID_SITE');});
 it('rejects altered preference access sites',()=>{expect(()=>transformModalCompositionSource(sources.guide.replace('localStorage.getItem(ONBOARDING_KEY)','localStorage.getItem("other")'),'modal126-a','guide')).toThrow('PREFERENCE');});
 it('rejects an altered mobile scroll structure',()=>{expect(()=>transformModalCompositionSource(sources.mobile.replace('private releaseOverflow()','private otherOverflow()'),'modal126-a','mobile')).toThrow('SCROLL_SITES');});
 it('normalizes CRLF only',()=>{expect(transformModalCompositionSource(sources.field.replaceAll('\n','\r\n'),'modal126-a','field').source).toBe(sources.field);});
 it.each(['','modal126-','modal126-a"','modal126-a/b','modal126-A','modal126-'+('a'.repeat(25))])('rejects unsafe scope %j',value=>{expect(()=>modalCompositionPrefix(value)).toThrow('PREFIX');});
 it('an unissued module port cannot query or lock a document',()=>{const p=modalCompositionPort('modal126-unissued','mobile');expect(()=>p.document.querySelector('input')).toThrow('UNISSUED_PORT');expect(()=>p.lockScroll()).toThrow('UNISSUED_PORT');});
 it('rejects an unknown component role',()=>{expect(()=>modalCompositionPort('modal126-unissued','other' as ModalRole)).toThrow('ROLE');});
});
