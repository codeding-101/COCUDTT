import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import Ajv from 'ajv';
import {createFeeTaxAttachment,serializeFeeTaxAttachment,parseFeeTaxAttachment,validateFeeTaxAttachment,reviewFeeTaxAttachment,setFeeTaxAttachmentRecord,acknowledgeFeeTaxAttachmentRecord,rebindFeeTaxAttachment,removeFeeTaxAttachmentRecord,copyFeeTaxAttachmentForNewBusiness,feeTaxAttachmentSchema} from '../src/data/fee-tax-attachment';
import {canonicalFeeTaxAttachmentJson} from '../src/data/fee-tax-attachment-json';
import {FeeTaxAttachmentError,FEE_TAX_ATTACHMENT_FACETS} from '../src/domain/fee-tax-attachment';
import {serializeContainerCostPair,updateContainerCostPair} from '../src/data/container-cost-pair';
import {copyContainerBusiness} from '../src/data/container-business-copy';
import {analyze} from '../src/engine/analyze';
import {toTrade,toScenario,serializeProject,parseProject} from '../src/data/project-file';
import {completePair,populatedAttachment,lease,freeze} from './fixtures/fee-tax-attachment';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
async function allAcknowledged(){let s=await populatedAttachment();for(const f of FEE_TAX_ATTACHMENT_FACETS)s.attachment=await acknowledgeFeeTaxAttachmentRecord(s.attachment,lease(s.attachment),s.raw,s.id,f);return s;}

describe('独立附件完整文件与精确金额',()=>{
 it.each(['1.0','1.1'] as const)('完整配对%s冻结往返与独立指纹',async version=>{
  const s=await populatedAttachment('113',version),a=freeze(s.attachment),text=await serializeFeeTaxAttachment(a),reopened=await parseFeeTaxAttachment(text);
  expect(reopened).toEqual(a);expect(reopened).not.toBe(a);expect(reopened.pair_snapshot_json).toBe(s.raw);expect(reopened.pair_snapshot_sha256).toBe(hash(s.raw));
  const {content_sha256,...body}=a;expect(content_sha256).toBe(hash(canonicalFeeTaxAttachmentJson(body)));
  const report=await reviewFeeTaxAttachment(a,s.raw);expect(report.rows[0]!.issues).toEqual([]);expect(report.rows[0]!.calculation.channels.net).toEqual({numerator:'100',denominator:'1'});expect(report.rows[0]!.calculation.channels.economic).toEqual({numerator:'113',denominator:'1'});
  expect(Object.keys(report).sort()).toEqual(['attachment_id','content_sha256','pair_is_current','revision','rows','scope']);
 });
 it('Schema同源生成，结构通过不等于哈希、日历或算术通过',async()=>{
  const ajv=new Ajv({strict:true}),schema=feeTaxAttachmentSchema(),check=ajv.compile(schema),{attachment}=await populatedAttachment();expect(check(attachment)).toBe(true);
  const altered=structuredClone(attachment);altered.records[0]!.sources.tax.checked_on='2026-02-30';expect(check(altered)).toBe(true);await expect(validateFeeTaxAttachment(altered)).rejects.toThrow(FeeTaxAttachmentError);
  expect(readFileSync(new URL('../schemas/fee-tax-attachment-1.0.schema.json',import.meta.url),'utf8')).toBe(JSON.stringify(schema,null,2)+'\n');
 });
 it.each(['113.000000000000000000','0','0.000000000000000001','123456789012345678.123456','1'])('保留原精度%s与未舍入结果，精度待办不消失',async amount=>{
  const s=await populatedAttachment(amount),r=(await reviewFeeTaxAttachment(s.attachment,s.raw)).rows[0]!;
  expect(r.calculation.input.gross).toBe(amount);expect(r.issues).not.toContain('BILL_AMOUNT_MISMATCH_OR_UNKNOWN');
  if(amount==='0.000000000000000001'){expect(r.issues).toContain('PROPOSAL_CORE_PRECISION_LOSS');await expect(acknowledgeFeeTaxAttachmentRecord(s.attachment,lease(s.attachment),s.raw,s.id,'tax')).rejects.toThrow();}
  if(amount==='1')expect(r.calculation.channels.net).toEqual({numerator:'100',denominator:'113'});
 });
 it('长账单行ID不截断或强制等于短成分ID',async()=>{const s=completePair('113','1.0','账'.repeat(150)),a=await createFeeTaxAttachment(s.raw),saved=await setFeeTaxAttachmentRecord(a,lease(a),s.record);expect(saved.records[0]!.target.line_id.length).toBe(150);expect((await reviewFeeTaxAttachment(saved,s.raw)).rows[0]!.issues).toEqual([]);});
 it('来源原文空白保留，统一序列化比对要求明确重绑',async()=>{
  const s=await populatedAttachment(),raw=s.raw+'\n',a=await rebindFeeTaxAttachment(s.attachment,lease(s.attachment),raw);expect((await parseFeeTaxAttachment(await serializeFeeTaxAttachment(a))).pair_snapshot_json).toBe(raw);
  expect((await reviewFeeTaxAttachment(a,s.raw)).pair_is_current).toBe(false);expect((await reviewFeeTaxAttachment(a,raw)).pair_is_current).toBe(true);
 });
 it('异步保存与校验先捕获输入，调用后修改不混入候选',async()=>{
  const {attachment}=await populatedAttachment(),before=structuredClone(attachment),pending=serializeFeeTaxAttachment(attachment);attachment.records[0]!.input.gross='999';expect(await parseFeeTaxAttachment(await pending)).toEqual(before);
  const pending2=validateFeeTaxAttachment(before);before.records.length=0;expect((await pending2).records).toHaveLength(1);
 });
 it('记录输入/输出与源配对无别名，旧业务金额及未知扩展不激活',async()=>{
  const s=await populatedAttachment(),project=s.pair.project,baseline=analyze({trade:toTrade(project),scenario:toScenario(project),taxProfile:project.tax_profile,fxBooks:project.fx_books});
  const rawProject={...project,fee_tax_attachment:{confirmed:true,amount:'private'}},reopened=parseProject(serializeProject(rawProject));expect((reopened as any).fee_tax_attachment).toEqual(rawProject.fee_tax_attachment);
  const text=await serializeFeeTaxAttachment(s.attachment),report=await reviewFeeTaxAttachment(s.attachment,s.raw);report.rows[0]!.calculation.input.gross='1';expect(await serializeFeeTaxAttachment(s.attachment)).toBe(text);expect(serializeContainerCostPair(s.pair)).toBe(s.raw);
  expect(analyze({trade:toTrade(reopened),scenario:toScenario(reopened),taxProfile:reopened.tax_profile,fxBooks:reopened.fx_books})).toEqual(baseline);
  expect(()=>parseProject(text)).toThrow();
 });
});

describe('回执、租约、失效和身份',()=>{
 it('单项回执不误伤其他项，无变化操作保持修订；全有回执仍不是应用授权',async()=>{
  const s=await allAcknowledged(),a=s.attachment,r=await reviewFeeTaxAttachment(a,s.raw);
  expect(FEE_TAX_ATTACHMENT_FACETS.map(f=>r.rows[0]!.acknowledgements[f].status)).toEqual(['RECORDED_ASSUMPTION','RECORDED_ASSUMPTION','RECORDED_ASSUMPTION']);
  expect(await acknowledgeFeeTaxAttachmentRecord(a,lease(a),s.raw,s.id,'tax')).toEqual(a);expect(await setFeeTaxAttachmentRecord(a,lease(a),s.record,s.id)).toEqual(a);expect(await rebindFeeTaxAttachment(a,lease(a),s.raw)).toEqual(a);
  expect(await parseFeeTaxAttachment(await serializeFeeTaxAttachment(a))).toEqual(a);
 });
 it.each(['tax','credit','customs'] as const)('修改%s来源撤销该记录全部回执',async facet=>{
  const s=await allAcknowledged(),input=structuredClone(s.record);input.sources[facet].reference='新的合成依据';const a=await setFeeTaxAttachmentRecord(s.attachment,lease(s.attachment),input,s.id);
  expect(a.records[0]!.acknowledgements).toEqual({tax:null,credit:null,customs:null});expect(a.revision).toBe(s.attachment.revision+1);
 });
 it.each(['EXAMPLE','UNSPECIFIED'] as const)('%s来源可存但不能确认，未知不补事实',async provenance=>{
  const s=await populatedAttachment(),input=structuredClone(s.record);input.sources.tax={provenance,reference:'',valid_from:'',valid_to:'',checked_on:''};const a=await setFeeTaxAttachmentRecord(s.attachment,lease(s.attachment),input,s.id);await expect(acknowledgeFeeTaxAttachmentRecord(a,lease(a),s.raw,s.id,'tax')).rejects.toThrow();expect((await parseFeeTaxAttachment(await serializeFeeTaxAttachment(a))).records[0]!.sources.tax.reference).toBe('');
 });
 it('EXAMPLE不能仅切换标签，需要新引用且重新明确核对',async()=>{
  const s=await populatedAttachment(),input=structuredClone(s.record);input.sources.tax.provenance='EXAMPLE';let a=await setFeeTaxAttachmentRecord(s.attachment,lease(s.attachment),input,s.id);input.sources.tax.provenance='USER_SUPPLIED';await expect(setFeeTaxAttachmentRecord(a,lease(a),input,s.id)).rejects.toThrow('EXAMPLE_REPLACEMENT_REQUIRED');input.sources.tax.reference='重新提供的合成来源';a=await setFeeTaxAttachmentRecord(a,lease(a),input,s.id);expect(a.records[0]!.acknowledgements.tax).toBeNull();
 });
 it.each(['UNKNOWN','NO_SEPARATION'] as const)('%s分离状态不被解释为零税额',async kind=>{
  const s=await populatedAttachment(),input=structuredClone(s.record);input.input.tax={kind};let a=await setFeeTaxAttachmentRecord(s.attachment,lease(s.attachment),input,s.id);if(kind==='UNKNOWN')await expect(acknowledgeFeeTaxAttachmentRecord(a,lease(a),s.raw,s.id,'tax')).rejects.toThrow();else a=await acknowledgeFeeTaxAttachmentRecord(a,lease(a),s.raw,s.id,'tax');expect((await reviewFeeTaxAttachment(a,s.raw)).rows[0]!.calculation.channels.tax).toBeNull();
 });
 it.each([['valid_to','2026-10-16'],['valid_from','2026-10-18'],['checked_on','2026-10-18'],['checked_on','']] as const)('%s=%s不能确认',async(field,value)=>{const s=await populatedAttachment(),input=structuredClone(s.record);input.sources.credit[field]=value;const a=await setFeeTaxAttachmentRecord(s.attachment,lease(s.attachment),input,s.id);await expect(acknowledgeFeeTaxAttachmentRecord(a,lease(a),s.raw,s.id,'credit')).rejects.toThrow();});
 it('修改完整来源、重绑撤销回执，删除目标保留孤立记录',async()=>{
  const s=await allAcknowledged(),project=structuredClone(s.pair.project);project.name+=' changed';const changed=updateContainerCostPair(s.pair,s.pair.content_key,project,s.pair.bill,s.pair.selection),raw=serializeContainerCostPair(changed);
  expect((await reviewFeeTaxAttachment(s.attachment,raw)).rows[0]!.acknowledgements.tax.status).toBe('NEEDS_REVIEW');let a=await rebindFeeTaxAttachment(s.attachment,lease(s.attachment),raw);expect(a.records[0]!.acknowledgements.tax).toBeNull();
  const removed=updateContainerCostPair(changed,changed.content_key,project,changed.bill,{version:'0.1',intents:[]});a=await rebindFeeTaxAttachment(a,lease(a),serializeContainerCostPair(removed));expect(a.records[0]!.input).toEqual(s.record.input);expect((await reviewFeeTaxAttachment(a,serializeContainerCostPair(removed))).rows[0]!.issues).toContain('ORPHAN_TARGET');
 });
 it('错误租约与固定目标拒绝，删除ID退休，新业务仅创建空附件',async()=>{
  const s=await populatedAttachment(),input=structuredClone(s.record);await expect(setFeeTaxAttachmentRecord(s.attachment,{...lease(s.attachment),revision:0},input,s.id)).rejects.toThrow('STALE_LEASE');input.target.mapping_id+='x';await expect(setFeeTaxAttachmentRecord(s.attachment,lease(s.attachment),input,s.id)).rejects.toThrow('IMMUTABLE_TARGET');
  const removed=await removeFeeTaxAttachmentRecord(s.attachment,lease(s.attachment),s.id);expect(removed.retired_record_ids).toEqual([s.id]);
  const fork=copyContainerBusiness(s.pair,s.pair.content_key,'New synthetic business','2026-10-17T00:00:00.000Z'),copy=await copyFeeTaxAttachmentForNewBusiness(s.attachment,lease(s.attachment),serializeContainerCostPair(fork));expect(copy.attachment_id).not.toBe(s.attachment.attachment_id);expect(copy.records).toEqual([]);expect(copy.retired_record_ids).toEqual([]);await expect(copyFeeTaxAttachmentForNewBusiness(s.attachment,lease(s.attachment),s.raw)).rejects.toThrow('NEW_BUSINESS_IDENTITY');
 });
 it('伪造格式正确的回执不提升状态，完整内容篡改必须重新核对指纹',async()=>{
  const s=await populatedAttachment(),a=structuredClone(s.attachment);a.records[0]!.acknowledgements.credit={basis_sha256:'0'.repeat(64)};
  await expect(validateFeeTaxAttachment(a)).rejects.toThrow('CONTENT_DIGEST');const{content_sha256:_,...body}=a;a.content_sha256=hash(canonicalFeeTaxAttachmentJson(body));const report=await reviewFeeTaxAttachment(await validateFeeTaxAttachment(a),s.raw);expect(report.rows[0]!.acknowledgements.credit.status).toBe('NEEDS_REVIEW');
 });
});
