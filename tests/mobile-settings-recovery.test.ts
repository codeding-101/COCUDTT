import{afterEach,describe,expect,it,vi}from'vitest';
import{MobileSettingsController}from'../src/ui/mobile-settings';
import{mobileSettingsEnvironment}from'./helpers/mobile-settings-dom';

function setup(){
 const e=mobileSettingsEnvironment(),c=new MobileSettingsController(),p={quantity:'123.000001'};
 c.beforeRender(p);const input=e.create('input'),file=new File(['RAW_IMPORT'],'pending.json');input.value='-e';input.files=[file];e.panel.append(input);
 const open=()=>c.open(e.trigger as unknown as HTMLElement);
 const restored=()=>{expect(c.isOpen).toBe(false);expect(e.dialog.open).toBe(false);expect(input.isConnected).toBe(true);expect(e.panel.contains(input)).toBe(true);expect(input.value).toBe('-e');expect(input.files[0]).toBe(file);expect(p).toEqual({quantity:'123.000001'});};
 return{e,c,p,input,file,open,restored};
}
describe('mobile modal failure recovery keeps the original inputs and ownership',()=>{
 afterEach(()=>vi.unstubAllGlobals());
 it.each([['',''],['auto','important'],['scroll',''],['hidden','important']])('restores overflow %s with original priority %s',(value,priority)=>{
  const s=setup();s.e.body.style.setProperty('overflow',value,priority);expect(s.open()).toBe(true);s.c.dismiss();s.restored();expect(s.e.body.style.getPropertyValue('overflow')).toBe(value);expect(s.e.body.style.getPropertyPriority('overflow')).toBe(priority);
 });
 it('restores distinct axis values and priorities without clearing unrelated styles',()=>{
  const s=setup(),style=s.e.body.style;style.setProperty('overflow-x','scroll','important');style.setProperty('overflow-y','auto');style.setProperty('color','blue');s.open();s.c.dismiss();s.restored();expect(style.getPropertyValue('overflow-x')).toBe('scroll');expect(style.getPropertyPriority('overflow-x')).toBe('important');expect(style.getPropertyValue('overflow-y')).toBe('auto');expect(style.getPropertyPriority('overflow-y')).toBe('');expect(style.getPropertyValue('color')).toBe('blue');
 });
 it('keeps foreign overflow through another mount and close',()=>{
  const s=setup();s.open();s.e.body.style.setProperty('overflow','clip','important');s.c.afterRender();expect(s.e.body.style.overflow).toBe('clip');s.c.dismiss();s.restored();expect(s.e.body.style.overflow).toBe('clip');expect(s.e.body.style.getPropertyPriority('overflow')).toBe('important');
 });
 it('restores only the unchanged axis after a foreign axis update',()=>{
  const s=setup();s.open();s.e.body.style.setProperty('overflow-x','clip','important');s.c.dismiss();s.restored();expect(s.e.body.style.getPropertyValue('overflow-x')).toBe('clip');expect(s.e.body.style.getPropertyPriority('overflow-x')).toBe('important');expect(s.e.body.style.getPropertyValue('overflow-y')).toBe('auto');
 });
 it('uses the saved parent and next sibling after the marker disappears',()=>{
  const s=setup();s.open();s.e.marker!.remove();s.c.dismiss();s.restored();expect(s.e.panel.parentNode).toBe(s.e.original);expect(s.e.panel.nextSibling).toBe(s.e.next);
 });
 it('leaves a marker moved into a foreign container untouched',()=>{
  const s=setup();s.open();const marker=s.e.marker!,foreign=s.e.create();s.e.body.append(foreign);foreign.append(marker);s.c.dismiss();s.restored();expect(marker.parentNode).toBe(foreign);expect(s.e.panel.parentNode).toBe(s.e.original);
 });
 it('does not replace a foreign substitute marker',()=>{
  const s=setup();s.open();const foreign=s.e.create();foreign.dataset.mobileSettingsPlaceholder='';s.e.marker!.replaceWith(foreign);s.c.dismiss();s.restored();expect(foreign.parentNode).toBe(s.e.original);expect(s.e.panel.nextSibling).toBe(s.e.next);
 });
 it('falls back outside the closed dialog when the original parent is removed',()=>{
  const s=setup();s.open();s.e.original.remove();s.c.dismiss();s.restored();expect(s.e.panel.parentNode).toBe(s.e.body);expect(s.e.panel.closest('dialog')).toBeNull();
 });
 it('uses the body when both original parent and dialog were detached',()=>{
  const s=setup();s.open();s.e.original.remove();s.e.dialog.remove();s.c.dismiss();expect(s.c.isOpen).toBe(false);expect(s.input.isConnected).toBe(true);expect(s.e.panel.parentNode).toBe(s.e.body);expect(s.input.files[0]).toBe(s.file);expect(s.e.body.style.overflow).toBe('auto');
 });
 it('rejects an absent host and supports an explicit repaired retry',()=>{
  const s=setup();s.e.host.remove();expect(s.open()).toBe(false);s.restored();expect(s.e.dialog.showModal).not.toHaveBeenCalled();expect(s.e.body.style.overflow).toBe('auto');expect(s.e.feedback.textContent).toContain('重试');s.e.dialog.append(s.e.host);expect(s.open()).toBe(true);expect(s.e.feedback.hidden).toBe(true);s.c.dismiss();s.restored();
 });
 it('recovers an actively removed host with its original File node',()=>{
  const s=setup();s.open();s.e.host.remove();s.c.afterRender();s.restored();expect(s.e.panel.parentNode).toBe(s.e.original);expect(s.e.body.style.overflow).toBe('auto');
 });
 it.each(['throw','no-open','open-then-throw'])('rolls back showModal %s before an explicit retry',mode=>{
  const s=setup(),normal=()=>{s.e.dialog.open=true;};s.e.dialog.showModal.mockImplementation(()=>{if(mode==='open-then-throw')normal();if(mode!=='no-open')throw new DOMException('Synthetic open failure','InvalidStateError');});expect(s.open()).toBe(false);s.restored();expect(s.e.panel.parentNode).toBe(s.e.original);expect(s.e.body.style.overflow).toBe('auto');expect(s.e.feedback.textContent).toContain('重试');s.e.dialog.showModal.mockImplementation(normal);expect(s.open()).toBe(true);s.c.dismiss();s.restored();
 });
 it.each(['throw','no-close'])('retains the open form on close %s until a successful retry',mode=>{
  const s=setup();s.open();s.e.dialog.close.mockImplementation(()=>{if(mode==='throw')throw Error('Synthetic close failure');});s.c.dismiss();expect(s.c.isOpen).toBe(true);expect(s.e.dialog.open).toBe(true);expect(s.e.panel.parentNode).toBe(s.e.host);expect(s.input.files[0]).toBe(s.file);expect(s.e.body.style.overflow).toBe('hidden');expect(s.e.feedback.textContent).toContain('重试');s.e.dialog.close.mockImplementation(()=>{s.e.dialog.open=false;s.e.events.get('close')?.({});});s.c.dismiss();s.restored();expect(s.e.body.style.overflow).toBe('auto');expect(s.e.trigger.focus).toHaveBeenCalledWith({preventScroll:true});
 });
 it('settles a native close that completed before throwing',()=>{
  const s=setup();s.open();s.e.dialog.close.mockImplementation(()=>{s.e.dialog.open=false;throw Error('Post-close failure');});s.c.dismiss();s.restored();expect(s.e.body.style.overflow).toBe('auto');
 });
 it('keeps an interrupted desktop return retryable',()=>{
  const s=setup();s.open();s.e.desktop();s.e.dialog.close.mockImplementation(()=>{throw Error('Close failure');});s.c.resize();expect(s.c.isOpen).toBe(true);expect(s.e.panel.parentNode).toBe(s.e.host);s.e.dialog.close.mockImplementation(()=>{s.e.dialog.open=false;});s.c.resize();s.restored();
 });
 it('restores a panel moved away from its owned host',()=>{
  const s=setup();s.open();const foreign=s.e.create();s.e.body.append(foreign);foreign.append(s.e.panel);s.c.afterRender();s.restored();expect(s.e.panel.parentNode).toBe(s.e.original);
 });
 it('restores an owned form after its whole dialog was removed',()=>{
  const s=setup();s.open();s.e.dialog.remove();s.c.afterRender();expect(s.c.isOpen).toBe(false);expect(s.e.panel.parentNode).toBe(s.e.original);expect(s.input.isConnected).toBe(true);expect(s.input.files[0]).toBe(s.file);expect(s.e.body.style.overflow).toBe('auto');
 });
 it('does not resurrect old inputs after an explicit project replacement renders',()=>{
  const s=setup();s.open();s.e.dialog.close.mockImplementation(()=>{throw Error('Close failure');});const nextProject={quantity:'7'};expect(s.c.beforeRender(nextProject)).toBe(true);expect(s.c.isOpen).toBe(true);s.e.replaceView();s.c.afterRender();expect(s.c.isOpen).toBe(false);expect(s.e.dialog.open).toBe(false);expect(s.c.isSameProject(nextProject)).toBe(true);expect(s.input.isConnected).toBe(false);expect(s.e.body.style.overflow).toBe('auto');
 });
 it('an open request repairs an active missing host before falling back',()=>{
  const s=setup();s.open();s.e.host.remove();expect(s.open()).toBe(false);s.restored();expect(s.e.body.style.overflow).toBe('auto');
 });
 it('repairs a detached form before a same-project renderer scans selected Files',()=>{
  const s=setup();s.open();s.e.host.remove();s.c.beforeRender(s.p);s.restored();expect(s.input.isConnected).toBe(true);expect(s.e.panel.parentNode).toBe(s.e.original);
 });
 it('reattaches an owned host when native close fails before a redraw',()=>{
  const s=setup();s.open();s.e.host.remove();s.e.dialog.close.mockImplementation(()=>{throw Error('Close failure');});s.c.beforeRender(s.p);expect(s.c.isOpen).toBe(true);expect(s.e.dialog.open).toBe(true);expect(s.input.isConnected).toBe(true);expect(s.e.panel.parentNode).toBe(s.e.host);expect(s.input.files[0]).toBe(s.file);
 });
 it('does not reopen a replacement dialog or resurrect old forms during native close',()=>{
  const s=setup();s.open();const previous=s.e.dialog;
  previous.close.mockImplementation(()=>{previous.open=false;s.c.beforeRender(s.p);s.e.replaceView();s.c.afterRender();});
  s.c.dismiss();expect(s.c.isOpen).toBe(false);expect(s.e.dialog.open).toBe(false);expect(s.e.doc.querySelectorAll('[data-evidence-section="advanced-settings"]')).toHaveLength(1);expect(s.input.isConnected).toBe(false);expect(s.e.body.style.overflow).toBe('auto');
 });
 it('suppresses reentrant dismissal while native close is on the stack',()=>{
  const s=setup();s.open();let calls=0;s.e.dialog.close.mockImplementation(()=>{calls++;if(calls===1)s.c.dismiss(false);s.e.dialog.open=false;});s.c.dismiss();expect(calls).toBe(1);s.restored();
 });
 it('settles an old disconnected modal after close rerenders and then throws',()=>{
  const s=setup();s.open();const previous=s.e.dialog;
  previous.close.mockImplementation(()=>{s.c.beforeRender(s.p);s.e.replaceView();s.c.afterRender();throw Error('Close failed after replacement');});
  s.c.dismiss();expect(previous.isConnected).toBe(false);expect(s.c.isOpen).toBe(false);expect(s.e.dialog.open).toBe(false);expect(s.e.doc.querySelectorAll('[data-evidence-section="advanced-settings"]')).toHaveLength(1);expect(s.input.isConnected).toBe(false);expect(s.e.body.style.overflow).toBe('auto');
 });
 it('a same-project render reopens the new tree and keeps its scroll and return point',()=>{
  const s=setup();s.open();s.e.host.scrollTop=812;s.c.beforeRender(s.p);s.e.replaceView();s.c.afterRender();expect(s.c.isOpen).toBe(true);expect(s.e.dialog.open).toBe(true);expect(s.e.host.scrollTop).toBe(812);s.c.dismiss();expect(s.e.panel.parentNode).toBe(s.e.original);expect(s.e.trigger.focus).toHaveBeenCalledWith({preventScroll:true});expect(window.scrollTo).toHaveBeenCalledWith({left:5,top:456,behavior:'instant'});
 });
});
