import {projectJsonSchema,type JsonSchema} from './project-validation.js';
import {TRANSPORT_CHARGE_KINDS} from '../domain/transport-cost-links.js';
/** Separate 0.9 schema; keep published 0.8 and 0.1–0.8 resources byte-identical. */
export function transportProjectSchema():JsonSchema{
 const schema=projectJsonSchema();schema.$id='urn:cocudtt:project:0.9';schema.title='COCUDTT project file 0.9';
 const properties=schema.properties as Record<string,JsonSchema>;properties.schema_version={const:'0.9',type:'string'};
 const term=(properties.term_scenarios!.additionalProperties as JsonSchema),fields=term.properties as Record<string,JsonSchema>;
 const text={type:'string',maxLength:200},id={...text,pattern:'\\S'};
 const source=structuredClone(fields.quote_evidence as JsonSchema),sourceFields=source.properties as Record<string,JsonSchema>;
 for(const key of ['reference','valid_from','valid_to','checked_on'])sourceFields[key]!.maxLength=4000;
 sourceFields.values_key!.maxLength=1048576;
 fields.transport_cost_links={type:'object',required:['target_cost_ids','links'],properties:{target_cost_ids:{type:'array',maxItems:100,uniqueItems:true,items:id},links:{type:'array',maxItems:100,items:{type:'object',required:['cost_id','state','segment_ids','charge_kind','scope_id'],properties:{cost_id:id,state:{enum:['UNCONFIRMED','LINKED','NOT_APPLICABLE']},segment_ids:{type:'array',maxItems:100,items:id},charge_kind:{enum:[...TRANSPORT_CHARGE_KINDS]},scope_id:text,evidence:structuredClone(source)},additionalProperties:true}}},additionalProperties:true};
 ((fields.transport_cost_links!.properties as Record<string,JsonSchema>)).overlap_resolutions={type:'array',maxItems:100,items:{type:'object',required:['cost_ids','basis','note'],properties:{cost_ids:{type:'array',minItems:2,maxItems:2,items:text},basis:{type:'string',enum:['EXISTING_CONTAINMENT','DISTINCT_BILLING']},note:{type:'string',maxLength:4000},evidence:structuredClone(source)},additionalProperties:true}};
 return schema;
}
