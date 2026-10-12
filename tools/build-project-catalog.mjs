import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
const root=resolve(import.meta.dirname,'..'),server=await createServer({root,configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom'});
const json=value=>JSON.stringify(value,null,2)+'\n';
try {
 const {projectJsonSchema}=await server.ssrLoadModule('/src/data/project-validation.ts');
 const {PROJECT_TEMPLATES,projectTemplateText,projectTemplateCatalog}=await server.ssrLoadModule('/src/data/project-templates.ts');
 mkdirSync(join(root,'schemas'),{recursive:true});mkdirSync(join(root,'templates'),{recursive:true});
 writeFileSync(join(root,'schemas/project-0.8.schema.json'),json(projectJsonSchema()));writeFileSync(join(root,'schemas/project-import-0.1-0.8.schema.json'),json(projectJsonSchema(true)));
 for(const entry of PROJECT_TEMPLATES)writeFileSync(join(root,'templates',entry.id+'.json'),projectTemplateText(entry.id));
 writeFileSync(join(root,'templates/catalog.json'),json(projectTemplateCatalog()));console.log(`Generated 2 schemas and ${PROJECT_TEMPLATES.length} project templates from source`);
}finally{await server.close();}
