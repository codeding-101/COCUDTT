import{writeFileSync}from'node:fs';import{join}from'node:path';
/** Fixed synthetic sources only; never imports local user files, drafts or current workspace. */
export async function buildFeePrecisionSelectionTemplates(server,root){
 const load=p=>server.ssrLoadModule('/src/'+p+'.ts');
 const {createProjectTemplate}=await load('data/project-templates'),{containerBillTemplate}=await load('data/container-bill-templates'),{bindContainerBillDraft}=await load('data/container-bill-context');
 const {createContainerCostPair,serializeContainerCostPair}=await load('data/container-cost-pair'),{evidenceKey,emptyEvidence}=await load('domain/source-evidence');
 const {createFeeTaxAttachment,setFeeTaxAttachmentRecord,serializeFeeTaxAttachment}=await load('data/fee-tax-attachment');
 const {createFeePrecisionSelection,addFeePrecisionSelectionRecord,serializeFeePrecisionSelection}=await load('data/fee-precision-selection');
 const {canonicalFeePrecisionSelectionJson:canonical,feePrecisionSelectionSha256:sha}=await load('data/fee-precision-selection-json');
 const project=createProjectTemplate('china-import-synthetic-example'),amount='1.0050001';project.name='精度选择 · 固定合成来源，非真实业务';
 const bill=bindContainerBillDraft(containerBillTemplate('container-bill-synthetic-example'),project);bill.id='precision-synthetic-bill';bill.review_date='2026-10-18';
 bill.rows=[{input:{line_id:'precision-synthetic-line',scope_id:'precision-synthetic-scope',direction:'IMPORT',equipment_type:'20GP (synthetic)',container_ids:['SYNTHETIC-PRECISION'],currency:'USD',reference:'合成算术例题，无真实账单',charge_kind:'INSPECTION',mode:'PER_CONTAINER',rate:amount},evidence:{status:'EXAMPLE',reference:'合成来源，不得当作真实费率或税率',valid_from:'2026-10-01',valid_to:'2026-10-31',checked_on:'2026-10-18'}}];
 const cost={cost_id:'precision-synthetic-cost',cost_name:'合成服务费精度例题（未应用）',cost_category:'CUSTOM',trade_node:'DESTINATION_TERMINAL',pricing_method:'FIXED',amount,currency:'USD',base_currency:project.base_currency,fx_type:'MARKET',tax_included:false,responsibility:'BUYER',responsibility_source:'CONTRACT',payment_party:'BUYER',economic_bearer:'BUYER',occurrence_reason:'NORMAL_OPERATION',customs_value:'EXCLUDE',included_in_quoted_price:false,is_custom:true,source:'USER',container_charge:'INSPECTION',container_charge_scope:'precision-synthetic-scope',applicable_incoterms:[project.incoterm]};
 const pair=createContainerCostPair(project,bill,{version:'0.1',intents:[{operation:'CREATE_NEW',line_id:bill.rows[0].input.line_id,new_cost:cost,note:'合成精度审计，不应用费用',evidence:bill.rows[0].evidence}]});pair.pair_id='precision-synthetic-pair';pair.mapping.entries[0].mapping_id='precision-synthetic-mapping';
 const {content_key:_,...pairBody}=pair;pair.content_key=evidenceKey(pairBody,emptyEvidence());const pairText=serializeContainerCostPair(pair);
 const lease=a=>({revision:a.revision,content_sha256:a.content_sha256}),seal=async a=>{const{content_sha256:_,...body}=a;a.content_sha256=await sha(canonical(body));return a;};
 let attachment=await createFeeTaxAttachment(pairText);
 const source=()=>({provenance:'EXAMPLE',reference:'合成13%算术和无抵扣假设，不代表法定税率或资格',valid_from:'2026-10-01',valid_to:'2026-10-31',checked_on:'2026-10-18'});
 attachment=await setFeeTaxAttachmentRecord(attachment,lease(attachment),{target:pair.mapping.entries[0],input:{line_id:'precision-component-short',currency:'USD',gross:amount,tax:{kind:'GROSS_RATE',rate:'0.13'},credit:{kind:'NONE',basis:'合成例题不作抵扣调整'},customs:{kind:'UNKNOWN'}},sources:{tax:source(),credit:source(),customs:source()}});
 attachment.attachment_id='precision-synthetic-attachment';attachment.records[0].record_id='precision-synthetic-component';await seal(attachment);const attachmentText=await serializeFeeTaxAttachment(attachment);
 const unit={kind:'EXPLICIT',unit:'0.01',mode:'HALF_UP',basis:'合成算术政策，非真实合同约定'};
 let selection=await createFeePrecisionSelection(pairText,attachmentText);selection.selection_id='precision-empty-synthetic';await seal(selection);
 writeFileSync(join(root,'templates/fee-precision-selection-empty.json'),await serializeFeePrecisionSelection(selection));
 selection=await addFeePrecisionSelectionRecord(selection,lease(selection),{component_record_id:attachment.records[0].record_id,channel:'cash',choice:{kind:'ROUND',policy:unit}});
 selection=await addFeePrecisionSelectionRecord(selection,lease(selection),{component_record_id:attachment.records[0].record_id,channel:'net',choice:{kind:'FX',to:'CNY',purpose:'COMMERCIAL_REVIEW',as_of:'2026-10-18',rate_source:{base:'USD',quote:'CNY',rate:'7',type:'CONTRACT',rate_date:'2026-10-01',valid_from:'2026-10-01',valid_to:'2026-10-31',reference:'合成换算比例，非实际汇率'},policy:unit}});
 selection.selection_id='precision-example-synthetic';selection.records.forEach((r,i)=>r.record_id='precision-synthetic-record-'+(i+1));await seal(selection);
 writeFileSync(join(root,'templates/fee-precision-selection-synthetic-example.json'),await serializeFeePrecisionSelection(selection));
 console.log('Generated 2 independent precision selection templates, fixed synthetic sources, no receipts or fee application');
}
