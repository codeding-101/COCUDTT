/** Source-scoped entries close cached-reference gaps without replacing functions or collections. */
import{API}from'typescript/unstable/sync';import*as ast from'typescript/unstable/ast';import{resolve,join}from'node:path';import{createHash}from'node:crypto';import{buildWorkbenchObservationPlan}from'./fee-workbench-observation-inventory.mjs';
const root=resolve(import.meta.dirname,'..'),blob=s=>{const b=Buffer.from(s.replace(/\r\n/g,'\n'));return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
export function buildWorkbenchBoundaryPlan(){
 const original=buildWorkbenchObservationPlan(),api=new API({cwd:root});try{
  const snapshot=api.updateSnapshot({openProjects:[join(root,'tsconfig.json')]}),project=snapshot.getProject(join(root,'tsconfig.json')),sites=[];if(!project)throw Error('Boundary parser project');
  for(const p of Object.keys(original.source_fingerprints)){
   const s=project.program.getSourceFile(join(root,p));if(!s)throw Error('Boundary source '+p);const text=s.getFullText(),offset=n=>text.slice(0,n).replace(/\r\n/g,'\n').length;
   const add=(n,data)=>{const line=s.getLineAndCharacterOfPosition(n.getStart(s)).line+1;sites.push({id:p+':'+line+':'+data.kind+':'+offset(n.getStart(s)),path:p,line,...data});};
   for(const h of original.holders.filter(h=>h.path===p)){
    const cls=s.statements.find(n=>ast.isClassDeclaration(n)&&n.members.some(m=>ast.isMethodDeclaration(m)&&m.body)&&n.name?.text===({'quick-costs':'QuickCostsController','field-help':'FieldHelpController','mobile-settings':'MobileSettingsController',onboarding:'OnboardingController','recent-projects':'RecentProjectsController'}[h.id]));
    if(!cls)throw Error('Boundary class '+h.id);
    for(const m of cls.members.filter(n=>ast.isMethodDeclaration(n)&&n.body)){
     if(m.asteriskToken)throw Error('Unsupported generator boundary');
     add(m,{owner:h.id,kind:'METHOD_ENTRY',method:m.name.getText(s),body_start:offset(m.body.getStart(s)+1)});
    }
   }
   function walk(n){
    if(ast.isCallExpression(n)&&ast.isPropertyAccessExpression(n.expression)&&['add','delete','clear'].includes(n.expression.name.text)){
     const e=n.expression,receiver=e.expression.getText(s);let owner,field;
     if(p==='src/ui/app.ts'&&['collapsedSections','expandedEvidenceSections','boundEvents'].includes(receiver))owner=receiver;
     if(receiver==='this.bound'){const h=original.holders.find(h=>h.path===p&&h.fields.includes('bound'));if(h){owner=h.id;field='bound';}}
     if(owner){if(e.questionDotToken||n.questionDotToken)throw Error('Optional collection boundary');const open=text.indexOf('(',e.end);add(n,{owner,kind:'COLLECTION_CALL',method:e.name.text,...field?{field}:{},receiver,callee_start:offset(e.getStart(s)),callee_end:offset(e.end),args_start:offset(open+1)});}
    }n.forEachChild(walk);
   }walk(s);
  }
  snapshot.dispose();return{kind:'LOCAL_WORKBENCH_BOUNDARY_PLAN',version:'0.1',sites:sites.sort((a,b)=>a.id.localeCompare(b.id)),source_fingerprints:original.source_fingerprints,method_entries:sites.filter(s=>s.kind==='METHOD_ENTRY').length,collection_calls:sites.filter(s=>s.kind==='COLLECTION_CALL').length,owners:[...new Set(sites.map(s=>s.owner))].sort(),full_freshness_verified:false,production_integrated:false};
 }finally{api.close();}
}
export function instrumentWorkbenchBoundarySource(code,path,plan,resources){
 if(!plan.source_fingerprints[path])return null;if(blob(code)!==plan.source_fingerprints[path])throw Error('Boundary source fingerprint '+path);
 const edits=[];for(const s of plan.sites.filter(s=>s.path===path)){
  if(s.kind==='METHOD_ENTRY')edits.push({start:s.body_start,end:s.body_start,text:'\n__boundary115Calls.entry('+JSON.stringify(s.id)+',this);\n'});
  else edits.push({start:s.callee_start,end:s.callee_end,text:'__boundary115Calls.prepareCollection('+JSON.stringify(s.id)+', '+s.receiver+', '+JSON.stringify(s.method)+')'});
 }
 if(resources){if(resources.source_fingerprints[path]!==plan.source_fingerprints[path])throw Error('Resource/boundary source mismatch');for(const s of resources.sites.filter(s=>s.path===path))edits.push({start:s.callee_start,end:s.callee_end,text:'__obs114Calls.'+s.method},{start:s.args_start,end:s.args_start,text:JSON.stringify(s.id)+', '+(s.receiver?s.receiver+', ':'')});}
 for(const e of edits)if(edits.some(x=>x!==e&&x.start<e.start&&x.end>e.start))throw Error('Overlapping boundary source edit');
 let text=code.replace(/\r\n/g,'\n');for(const e of edits.sort((a,b)=>b.start-a.start||b.end-a.end))text=text.slice(0,e.start)+e.text+text.slice(e.end);
 return'import {workbenchBoundaryCalls as __boundary115Calls} from "/tools/fee-workbench-boundaries.ts";\n'+(resources?'import {workbenchResourceCalls as __obs114Calls} from "/tools/fee-workbench-resources.ts";\nimport "virtual:workbench-observation114";\n':'')+text;
}
