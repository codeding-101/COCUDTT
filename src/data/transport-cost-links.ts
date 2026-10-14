import {INCOTERMS,type Incoterm} from '../domain/enums.js';
import {invalidateEvidence,evidenceKey} from '../domain/source-evidence.js';
import {transportCostLinkEvidenceValues,transportOverlapEvidenceValues} from '../domain/transport-cost-links.js';
import {toScenario,toTrade,type ProjectFile} from './project-file.js';
/** Explicit, non-destructive opt-in. Legacy names are never silently reinterpreted. */
export function enableTransportCostLinks(project:ProjectFile,term:Incoterm=project.incoterm):ProjectFile{
 if(!INCOTERMS.includes(term))throw Error('术语无效');
 if(project.schema_version!=='0.9'){
  if(Object.hasOwn(project,'transport_cost_links')||Object.values(project.term_scenarios??{}).some(r=>Object.hasOwn(r,'transport_cost_links')))throw Error('存在旧同名运输关联扩展，请先保留原文件并核对，不能覆盖');
 }
 const copy=structuredClone(project);copy.schema_version='0.9';
 const record=(copy.term_scenarios??={})[term]??={};record.transport_cost_links??={target_cost_ids:[],links:[]};
 return copy;
}
/** Invalidate only when the raw input/basis changed; unrelated edits do not lose confirmation. */
export function invalidateTransportCostLinks(project:ProjectFile):void{
 if(project.schema_version!=='0.9')return;
 for(const term of INCOTERMS){const input=project.term_scenarios?.[term]?.transport_cost_links;if(!input)continue;const scenario=toScenario(project,term);
  for(const link of input.links){const item=project.items.find(c=>c.cost_id===link.cost_id);if(link.evidence?.status==='USER_CONFIRMED'&&(!item||link.evidence.values_key!==evidenceKey(transportCostLinkEvidenceValues(item,scenario,link),link.evidence)))invalidateEvidence(link.evidence);}
  for(const r of input.overlap_resolutions??[])if(r.evidence?.status==='USER_CONFIRMED'&&r.evidence.values_key!==evidenceKey(transportOverlapEvidenceValues(toTrade(project),scenario,input,r),r.evidence))invalidateEvidence(r.evidence);
 }
}
