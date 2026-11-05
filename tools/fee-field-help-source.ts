/** Only the pinned original module is passed by the diagnostic server. No eval or Node APIs. */
export const FIELD_HELP_PORT_IMPORT="import{registerFieldHelpListener as __fieldHelpListen120}from'/tools/fee-field-help-scope.ts';\n";
export function fieldHelpScopePrefix(prefix:string):string{
 if(typeof prefix!=='string'||!/^field120-[a-z0-9]{1,32}$/.test(prefix))throw Error('FIELD_HELP_SCOPE_PREFIX');
 return prefix;
}
export function transformFieldHelpSource(input:string,prefix:string){
 fieldHelpScopePrefix(prefix);
 const source=input.replace(/\r\n/g,'\n');
 const count=(text:string,part:string)=>text.split(part).length-1;
 if(source.includes('__fieldHelpListen120')||count(source,"dialog.addEventListener('close',")!==1||count(source,"dialog.addEventListener('keydown',")!==1||count(source,'dialog.addEventListener(')!==2)throw Error('FIELD_HELP_SOURCE_LISTENERS');
 const ids={'field-help-dialog':prefix+'-dialog','field-help-title':prefix+'-title','field-help-content':prefix+'-content'};
 const counts=Object.fromEntries(Object.keys(ids).map(id=>[id,count(source,id)]));
 if(counts['field-help-dialog']!==5||counts['field-help-title']!==2||counts['field-help-content']!==2)throw Error('FIELD_HELP_SOURCE_IDS');
 let code=source;
 for(const[from,to]of Object.entries(ids))code=code.replaceAll(from,to);
 code=FIELD_HELP_PORT_IMPORT+code.replaceAll('dialog.addEventListener(','__fieldHelpListen120(dialog,');
 let original=code.slice(FIELD_HELP_PORT_IMPORT.length).replaceAll('__fieldHelpListen120(dialog,','dialog.addEventListener(');
 for(const[from,to]of Object.entries(ids))original=original.replaceAll(to,from);
 if(original!==source)throw Error('FIELD_HELP_SOURCE_ROUNDTRIP');
 return{code,source,roundtrip:true,listener_sites:2,id_replacements:counts,prefix,production_source_changed:false};
}
