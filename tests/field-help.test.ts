import{describe,it,expect,vi,afterEach}from'vitest';
import{FIELD_HELP,FieldHelpController,fieldHelpButton}from'../src/ui/field-help';
describe('field help is local UI state and preserves modal focus',()=>{
 afterEach(()=>vi.unstubAllGlobals());
 it('all topics and return identifiers escape markup without reading business data',()=>{expect(Object.keys(FIELD_HELP)).toHaveLength(7);const html=fieldHelpButton('value','"><script>bad</script>','<img>');expect(html).not.toContain('<script>');expect(html).not.toContain('<img>');expect(html).toContain('&lt;script&gt;');});
 it('unknown topics and unavailable dialog never execute arbitrary content',()=>{const c=new FieldHelpController();vi.stubGlobal('document',{querySelector:()=>null});expect(c.open('__proto__','anchor')).toBe(false);expect(c.open('value','anchor')).toBe(false);expect(c.render()).not.toContain('undefined');});
 it('open, Escape-style close, rerender and fatal dismiss retain only a known topic',()=>{
  const trigger={dataset:{helpAnchor:'test'},focus:vi.fn()};let onClose=()=>{};
  let dialog={innerHTML:'',open:false,isConnected:true,showModal:vi.fn(function(){dialog.open=true}),close:vi.fn(function(){dialog.open=false;onClose()}),addEventListener:(name:string,fn:()=>void)=>{if(name==='close')onClose=fn}};
  vi.stubGlobal('document',{querySelector:()=>dialog,querySelectorAll:()=>[trigger]});const c=new FieldHelpController();
  expect(c.open('anchor','test')).toBe(true);expect(dialog.open).toBe(true);expect(c.render()).toContain('固定目标毛利率');dialog.close();expect(trigger.focus).toHaveBeenCalledOnce();expect(c.render()).not.toContain('固定目标毛利率');
  c.open('value','test');const before=c.render();c.afterRender();expect(c.render()).toBe(before);c.dismiss(false);expect(dialog.open).toBe(false);expect(c.render()).not.toContain('中国进口口径需要');
 });
});
