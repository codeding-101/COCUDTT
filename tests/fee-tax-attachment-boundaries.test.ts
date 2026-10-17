import {describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {completePair,populatedAttachment,lease} from './fixtures/fee-tax-attachment';
import {createFeeTaxAttachment,setFeeTaxAttachmentRecord,reviewFeeTaxAttachment,acknowledgeFeeTaxAttachmentRecord,removeFeeTaxAttachmentRecord,validateFeeTaxAttachment,serializeFeeTaxAttachment} from '../src/data/fee-tax-attachment';
import {canonicalFeeTaxAttachmentJson} from '../src/data/fee-tax-attachment-json';
import {createContainerCostPair,serializeContainerCostPair,updateContainerCostPair} from '../src/data/container-cost-pair';
import {bindContainerBillDraft} from '../src/data/container-bill-context';
import {confirmContainerBillLine,confirmContainerBillCostReference} from '../src/engine/container-bill-draft';
import type {FeeTaxAttachment} from '../src/domain/fee-tax-attachment';
function resigned(a:FeeTaxAttachment){const{content_sha256:_,...body}=a;return{...a,content_sha256:createHash('sha256').update(canonicalFeeTaxAttachmentJson(body)).digest('hex')};}
function referencePair(source:'USER'|'DERIVED'='USER'){
 const s=completePair(),intent=s.pair.selection.intents[0]!;if(intent.operation!=='CREATE_NEW')throw Error();
 const project=structuredClone(s.pair.project);project.items.push({...intent.new_cost,source});let bill=bindContainerBillDraft(s.pair.bill,project);const id=bill.rows[0]!.input.line_id;
 const evidence={status:'UNVERIFIED' as const,reference:'合成引用非实际凭证',valid_from:'2026-10-01',valid_to:'2026-10-31',checked_on:'2026-10-17'};
 bill=confirmContainerBillLine(bill,id,evidence);bill.rows[0]!.cost_reference={cost_id:intent.new_cost.cost_id,note:'仅引用已有服务费'};bill=confirmContainerBillCostReference(bill,id,project,evidence);
 const pair=createContainerCostPair(project,bill,{version:'0.1',intents:[{operation:'REFERENCE_EXISTING',line_id:id,cost_id:intent.new_cost.cost_id,note:'引用非重复纳入'}]});return{pair,raw:serializeContainerCostPair(pair),record:{...s.record,target:{...pair.mapping.entries[0]!}}};
}
describe('完整来源、原提案阻断和容量',()=>{
 it.each(['USER','DERIVED'] as const)('已有%s费用引用不会转成新成本或抵扣资格',async source=>{
  const s=referencePair(source);let a=await createFeeTaxAttachment(s.raw);a=await setFeeTaxAttachmentRecord(a,lease(a),s.record);const report=await reviewFeeTaxAttachment(a,s.raw);
  if(source==='USER'){expect(report.rows[0]!.issues).toEqual([]);a=await acknowledgeFeeTaxAttachmentRecord(a,lease(a),s.raw,a.records[0]!.record_id,'credit');expect((await reviewFeeTaxAttachment(a,s.raw)).rows[0]!.acknowledgements.credit.status).toBe('RECORDED_ASSUMPTION');}
  else{expect(report.rows[0]!.issues).toContain('SERVICE_FEE_TARGET_UNSUPPORTED');await expect(acknowledgeFeeTaxAttachmentRecord(a,lease(a),s.raw,a.records[0]!.record_id,'credit')).rejects.toThrow();}
  expect(serializeContainerCostPair(s.pair)).toBe(s.raw);
 });
 it.each(['IMPORT_DUTIES','GOODS_AND_PACKING'] as const)('费用类别%s不进入服务费回执',async category=>{
  const s=completePair(),intent=s.pair.selection.intents[0]!;if(intent.operation!=='CREATE_NEW')throw Error();const selection=structuredClone(s.pair.selection);if(selection.intents[0]!.operation==='CREATE_NEW')selection.intents[0]!.new_cost.cost_category=category;const pair=updateContainerCostPair(s.pair,s.pair.content_key,s.pair.project,s.pair.bill,selection),raw=serializeContainerCostPair(pair);let a=await createFeeTaxAttachment(raw);a=await setFeeTaxAttachmentRecord(a,lease(a),s.record);expect((await reviewFeeTaxAttachment(a,raw)).rows[0]!.issues).toContain('SERVICE_FEE_TARGET_UNSUPPORTED');
 });
 it.each(['name','quantity','quote','extension','fx'] as const)('完整项目%s变化使旧回执失效',async field=>{
  const s=await populatedAttachment();s.attachment=await acknowledgeFeeTaxAttachmentRecord(s.attachment,lease(s.attachment),s.raw,s.id,'tax');const p=structuredClone(s.pair.project);
  if(field==='name')p.name+=' edited';if(field==='quantity')p.goods.quantity='2';if(field==='quote')p.quote.amount='1';if(field==='extension')(p as any).fee_tax_attachment={confirmed:true};if(field==='fx')p.fx_books.push({id:'extra-fx',name:'Changed source',type:'MARKET',date:'2026-10-17',rates:{'USD/CNY':'7'}});
  const pair=updateContainerCostPair(s.pair,s.pair.content_key,p,s.pair.bill,s.pair.selection),raw=serializeContainerCostPair(pair),report=await reviewFeeTaxAttachment(s.attachment,raw);expect(report.pair_is_current).toBe(false);expect(report.rows[0]!.acknowledgements.tax.status).toBe('NEEDS_REVIEW');await expect(acknowledgeFeeTaxAttachmentRecord(s.attachment,lease(s.attachment),raw,s.id,'credit')).rejects.toThrow();
 });
 it('8条可保存，9条/重复成分或映射拒绝；失败不修改旧资料',async()=>{
  const s=completePair();let a=await createFeeTaxAttachment(s.raw);for(let i=0;i<8;i++){const r=structuredClone(s.record);r.target.mapping_id='orphan-'+i;r.input.line_id='component-'+i;a=await setFeeTaxAttachmentRecord(a,lease(a),r);}
  expect(a.records).toHaveLength(8);const before=await serializeFeeTaxAttachment(a);await expect(setFeeTaxAttachmentRecord(a,lease(a),s.record)).rejects.toThrow('RECORD_LIMIT');expect(await serializeFeeTaxAttachment(a)).toBe(before);
  const b=await createFeeTaxAttachment(s.raw),first=await setFeeTaxAttachmentRecord(b,lease(b),s.record);await expect(setFeeTaxAttachmentRecord(first,lease(first),s.record)).rejects.toThrow('DUPLICATE_RECORD');
 });
 it('200个退休ID与修订上限分别阻断，旧记录不被回收或回绕',async()=>{
  const s=await populatedAttachment(),retired=resigned({...s.attachment,retired_record_ids:Array.from({length:200},(_,i)=>'retired-'+i)});await validateFeeTaxAttachment(retired);await expect(removeFeeTaxAttachmentRecord(retired,lease(retired),s.id)).rejects.toThrow('RETIRED_LIMIT');
  const max=resigned({...s.attachment,revision:1000000000});await validateFeeTaxAttachment(max);const r=structuredClone(s.record);r.sources.tax.reference='changed';await expect(setFeeTaxAttachmentRecord(max,lease(max),r,s.id)).rejects.toThrow('REVISION_LIMIT');
 });
 it('异步编辑先复制候选，另一条记录的内容与回执不会被编辑清空',async()=>{
  const s=await populatedAttachment(),r=structuredClone(s.record),pending=setFeeTaxAttachmentRecord(s.attachment,lease(s.attachment),r,s.id);r.input.gross='999';expect((await pending).records[0]!.input.gross).toBe('113');
  let a=await acknowledgeFeeTaxAttachmentRecord(s.attachment,lease(s.attachment),s.raw,s.id,'tax');const other=structuredClone(s.record);other.input.line_id='other';other.target.mapping_id='orphan-other';a=await setFeeTaxAttachmentRecord(a,lease(a),other);const first=structuredClone(a.records[0]);other.sources.tax.reference='changed';a=await setFeeTaxAttachmentRecord(a,lease(a),other,a.records[1]!.record_id);expect(a.records[0]).toEqual(first);expect((await reviewFeeTaxAttachment(a,s.raw)).rows[0]!.acknowledgements.tax.status).toBe('RECORDED_ASSUMPTION');
 });
 it('真实UTF-8文件与配对大小分别限制，不用字符数或Schema代替',async()=>{
  const s=await populatedAttachment(),pairTooLarge={...s.attachment,pair_snapshot_json:' '.repeat(10*1024*1024+1)};await expect(validateFeeTaxAttachment(pairTooLarge)).rejects.toThrow('UTF8_SIZE');
  await expect(import('../src/data/fee-tax-attachment').then(m=>m.parseFeeTaxAttachment(' '.repeat(24*1024*1024+1)))).rejects.toThrow('UTF8_SIZE');
 });
});
