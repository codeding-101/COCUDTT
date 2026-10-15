import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
const root=resolve(import.meta.dirname,'..'),server=await createServer({root,configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom'});
const json=value=>JSON.stringify(value,null,2)+'\n';
try {
 const {projectJsonSchema}=await server.ssrLoadModule('/src/data/project-validation.ts');
 const {transportProjectSchema}=await server.ssrLoadModule('/src/data/transport-project-schema.ts');
 const {containerBillDraftSchema}=await server.ssrLoadModule('/src/data/container-bill-file.ts');
 const {containerCostPairSchema}=await server.ssrLoadModule('/src/data/container-cost-pair.ts');
 const {containerCostReviewPlanSchema}=await server.ssrLoadModule('/src/data/container-cost-review-plan.ts');
 const {CONTAINER_BILL_TEMPLATES,containerBillTemplateText}=await server.ssrLoadModule('/src/data/container-bill-templates.ts');
 writeFileSync(join(root,'schemas/project-0.9.schema.json'),json(transportProjectSchema()));
 const {PROJECT_TEMPLATES,projectTemplateText,projectTemplateCatalog}=await server.ssrLoadModule('/src/data/project-templates.ts');
 const {FUNDING_EXAMPLE_FILES}=await server.ssrLoadModule('/src/data/funding-example.ts');
 const {ROUNDING_EXAMPLE_FILES}=await server.ssrLoadModule('/src/data/rounding-example.ts');
 const {roundingExampleResource}=await server.ssrLoadModule('/src/ui/rounding-example.ts');
 const {PERIOD_EXAMPLE_FILES}=await server.ssrLoadModule('/src/data/period-example.ts');
 const {periodExampleResource}=await server.ssrLoadModule('/src/ui/period-example.ts');
 const {fundingExampleResource}=await server.ssrLoadModule('/src/ui/funding-example.ts');
 mkdirSync(join(root,'schemas'),{recursive:true});mkdirSync(join(root,'templates'),{recursive:true});
 writeFileSync(join(root,'schemas/container-bill-1.0.schema.json'),json(containerBillDraftSchema()));
 writeFileSync(join(root,'schemas/container-cost-pair-1.0.schema.json'),json(containerCostPairSchema()));
 writeFileSync(join(root,'schemas/container-cost-review-plan-0.1.schema.json'),json(containerCostReviewPlanSchema()));
 console.log('Generated 1 independent container cost review plan schema');
 console.log('Generated 1 independent container cost pair schema');
 for(const id of CONTAINER_BILL_TEMPLATES)writeFileSync(join(root,'templates',id+'.json'),containerBillTemplateText(id));
 console.log('Generated 1 independent container bill schema and 2 draft templates from source');
 writeFileSync(join(root,'schemas/project-0.8.schema.json'),json(projectJsonSchema()));writeFileSync(join(root,'schemas/project-import-0.1-0.8.schema.json'),json(projectJsonSchema(true)));
 for(const entry of PROJECT_TEMPLATES)writeFileSync(join(root,'templates',entry.id+'.json'),projectTemplateText(entry.id));
 writeFileSync(join(root,'templates/catalog.json'),json(projectTemplateCatalog()));console.log(`Generated 3 schemas and ${PROJECT_TEMPLATES.length} project templates from source`);
 for(const kind of Object.keys(FUNDING_EXAMPLE_FILES)){const resource=fundingExampleResource(kind);writeFileSync(join(root,'templates',resource.name),resource.text);}
 console.log('Generated 4 synthetic funding example resources from source');
 for(const kind of Object.keys(ROUNDING_EXAMPLE_FILES)){const resource=roundingExampleResource(kind);writeFileSync(join(root,'templates',resource.name),resource.text);}
 console.log('Generated 4 synthetic rounding example resources from source');
 for(const kind of Object.keys(PERIOD_EXAMPLE_FILES)){const resource=periodExampleResource(kind);writeFileSync(join(root,'templates',resource.name),resource.text);}
 console.log('Generated 4 synthetic period example resources from source');
}finally{await server.close();}
