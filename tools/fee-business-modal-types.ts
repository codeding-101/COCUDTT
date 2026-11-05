/** Compile actual adapted copies against the actual port, including deliberate missing-member probes. */
import{API,DiagnosticCategory}from'typescript/unstable/sync';
import{readFileSync}from'node:fs';import{resolve,dirname}from'node:path';import{fileURLToPath}from'node:url';
import{transformModalCompositionSource,type ModalRole}from'./fee-modal-composition-source';
export function checkBusinessModalTypes(negative=false){
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),names={mobile:'mobile-settings',field:'field-help',guide:'onboarding'},virtual=new Map<string,string>(),clean=(p:string)=>resolve(p).replaceAll('\\','/');
 for(const role of['mobile','field','guide']as const){const original=readFileSync(resolve(root,'src/ui/'+names[role]+'.ts'),'utf8');let code=transformModalCompositionSource(original,'modal126-types',role).code;if(negative){if(role==='mobile')code+='\n__modal126.document.missingCreateElement("div");\n';if(role==='field')code+='\n__modal126.missingCloseReceiver();\n';if(role==='guide')code+='\n__modal126.preferenceWasSavedToBrowser();\n';}virtual.set(clean(resolve(root,'src/ui/__business127_'+role+'.ts')),code);}
 const config=clean(resolve(root,'__business127-types.json')),options=JSON.parse(readFileSync(resolve(root,'tsconfig.json'),'utf8')).compilerOptions;virtual.set(config,JSON.stringify({compilerOptions:{...options,allowImportingTsExtensions:true,paths:{'/tools/*':['./tools/*']}},files:[...virtual.keys(),resolve(root,'tools/fee-business-modal-dom.ts')]}));
 const api=new API({cwd:root,fs:{readFile:path=>virtual.get(clean(path)),fileExists:path=>virtual.has(clean(path))?true:undefined}});
 try{const snapshot=api.updateSnapshot({openProjects:[config]}),project=snapshot.getProject(config);if(!project)throw Error('BUSINESS_MODAL_TYPE_PROJECT');const program=project.program,diagnostics=[...program.getConfigFileParsingDiagnostics(),...program.getProgramDiagnostics(),...program.getGlobalDiagnostics(),...program.getSyntacticDiagnostics(),...program.getSemanticDiagnostics()].filter(d=>d.category===DiagnosticCategory.Error);
  const result={roles:3,negative,diagnostics:diagnostics.map(d=>({code:d.code,file:d.fileName?clean(d.fileName).replace(clean(root)+'/',''):null,line:d.fileName?program.getSourceFile(d.fileName)?.getLineAndCharacterOfPosition(d.pos).line!+1:null,message:d.text})),production_files_written:0};snapshot.dispose();return result;
 }finally{api.close();}
}
