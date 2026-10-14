import { describe, expect, it } from 'vitest';
import { inspectRecoveryText, RECOVERY_REVIEW_MAX_BYTES } from '../src/data/recovery-review';
import { actualQuotesProject } from './fixtures/actual-quotes';
import { booksToRows } from '../src/ui/fx-rows';
import { newSensitivityControls } from '../src/ui/sensitivity';
import { emptyCustomerQuoteFields } from '../src/domain/customer-quote';
import { newSettlementPlan } from '../src/domain/settlement';
import { settlementBinding } from '../src/data/settlement-context';
import { renderRecoveryReviewPanel } from '../src/ui/recovery-review';
function snapshot() {
  const project = actualQuotesProject();
  return {kind:'INTERNAL_RECOVERY_SNAPSHOT',version:'1.0',stage:'RENDER',project,
    fx_rows:booksToRows(project.fx_books),settlement_plan:newSettlementPlan(settlementBinding(project)),
    sensitivity:newSensitivityControls(),customer_fields:emptyCustomerQuoteFields(),
    browser_draft_text:JSON.stringify({project,fxRows:booksToRows(project.fx_books)})};
}
const inspect = (v:unknown) => inspectRecoveryText(JSON.stringify(v));
describe('恢复快照只读检查，不迁移、补值或形成业务结论',()=>{
  it('逐部分检查，报告不包含任何原始交易值；输入保持原文',()=>{
    const input=snapshot();input.project.name='PRIVATE_NAME_981';input.customer_fields.remarks='<img src=x onerror=alert(1)>PRIVATE_CLIENT_714';
    const text=JSON.stringify(input);const report=inspectRecoveryText(text);
    expect(report.parts).toHaveLength(6);expect(report.parts.every(p=>p.status==='STRUCTURE_OK')).toBe(true);
    const html=renderRecoveryReviewPanel(report,false,null);expect(html).not.toContain('PRIVATE_');expect(html).not.toContain('<img');expect(JSON.stringify(input)).toBe(text);
    expect(html).toContain('未核对业务有效性');expect(html).toContain('原始汇率编辑行可能与项目汇率簿不同');
  });
  it.each([null,[],{}, {kind:'PROJECT'}, {kind:'INTERNAL_RECOVERY_SNAPSHOT',version:'2.0',stage:'RENDER'}, {kind:'INTERNAL_RECOVERY_SNAPSHOT',version:'1.0',stage:'PRIVATE_BAD_STAGE'}])('拒绝其他格式、未来版本或阶段：%j',value=>expect(()=>inspect(value)).toThrow());
  it('损坏JSON及超大UTF8原文拒绝，异常不带原始敏感内容',()=>{
    expect(()=>inspectRecoveryText('PRIVATE_BAD_JSON_883')).toThrow('不是合法JSON');
    expect(()=>inspectRecoveryText('中'.repeat(Math.floor(RECOVERY_REVIEW_MAX_BYTES/3)+1))).toThrow('5 MiB');
  });
  it('缺失、明确null与坏结构分别记录；不把其余有效部分一起丢弃',()=>{
    const value:Record<string,unknown>=snapshot();delete value.project;value.fx_rows=null;value.settlement_plan={};value.sensitivity={};value.customer_fields={};value.browser_draft_text='PRIVATE_BAD_DRAFT_711';
    expect(inspect(value).parts.map(p=>p.status)).toEqual(['MISSING','ABSENT','INVALID','INVALID','INVALID','INVALID']);
    value.project=snapshot().project;expect(inspect(value).parts[0]?.status).toBe('STRUCTURE_OK');
  });
  it('旧项目只检查支持范围；未知版本标出而非按新版本读取',()=>{
    const value=snapshot();value.project.schema_version='0.1';const before=JSON.stringify(value);expect(inspect(value).parts[0]?.status).toBe('STRUCTURE_OK');expect(JSON.stringify(value)).toBe(before);
    value.project.schema_version='99.0';expect(inspect(value).parts[0]?.status).toBe('UNSUPPORTED');
  });
  it('空金额及空汇率行保留结构状态，不等同计算成功或零成本',()=>{
    const value=snapshot();value.project.goods.quantity='';value.fx_rows=[{row_id:'raw-unfinished',type:'CUSTOMS',date:'',from:'',to:'CNY',rate:''}];
    expect(inspect(value).parts.slice(0,2).every(p=>p.status==='STRUCTURE_OK')).toBe(true);
  });
  it('原始编辑行错误不会被项目汇率簿掩盖；损坏草稿不回写',()=>{
    const value:Record<string,unknown>=snapshot();value.fx_rows=[{row_id:'bad',rate:7}];value.browser_draft_text='{"project":null,"fxRows":[]}';
    const parts=inspect(value).parts;expect(parts[0]?.status).toBe('STRUCTURE_OK');expect(parts[1]?.status).toBe('INVALID');expect(parts[5]?.status).toBe('INVALID');
  });
  it('未知顶层、扩展字段和原始高精度数字留在原文，报告不重新输出数据',()=>{
    const value=snapshot();const text=JSON.stringify(value).slice(0,-1)+',"PRIVATE_EXTRA_771":{"__proto__":{"polluted":true}},"precise":9007199254740993}';
    const report=inspectRecoveryText(text);expect(report.unknownFields).toBe(2);expect(JSON.stringify(report)).not.toContain('PRIVATE_EXTRA_771');expect(Object.prototype).not.toHaveProperty('polluted');
  });
  it('付款旧1.0兼容检查不升级，未来付款版本单独阻断',()=>{
    const value=snapshot();value.settlement_plan.version='1.0';delete value.settlement_plan.funding;expect(inspect(value).parts[2]?.status).toBe('STRUCTURE_OK');expect(value.settlement_plan.version).toBe('1.0');
    const raw:Record<string,unknown>=value;raw.settlement_plan={version:'99.0'};expect(inspect(raw).parts[2]?.status).toBe('INVALID');
  });
  it('界面错误文本被转义，清空状态不残留上次检查结果',()=>{
    expect(renderRecoveryReviewPanel(null,false,'<script>PRIVATE_ERROR</script>')).not.toContain('<script>');
    expect(renderRecoveryReviewPanel(null,true,null)).toContain('正在本机读取');expect(renderRecoveryReviewPanel(null,false,null)).not.toContain('data-recovery-review-result');
  });
});
