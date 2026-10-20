import {beforeAll, describe, expect, it, vi, afterEach} from 'vitest';
import {createHash} from 'node:crypto';
import {strFromU8, unzipSync} from 'fflate';
import {buildFeeWorkflowExercisePack} from '../src/data/fee-workflow-exercises';
import {parseProject} from '../src/data/project-file';
import {parseContainerBillDraft} from '../src/data/container-bill-file';
import {parseContainerCostPair} from '../src/data/container-cost-pair';
import {parseFeeTaxAttachment, reviewFeeTaxAttachment, acknowledgeFeeTaxAttachmentRecord} from '../src/data/fee-tax-attachment';
import {parseFeePrecisionSelection} from '../src/data/fee-precision-selection';
import {parseFeeEnvelope} from '../src/data/fee-envelope';
import {booksToRows} from '../src/ui/fx-rows';
import {previewRuntimeFeeWorkbench, runtimeFeeWorkbenchPreparedSnapshot, type RuntimeFeeWorkbenchCapture} from '../src/ui/fee-workbench-preview';
import {FEE_WORKBENCH_FILES} from '../src/domain/fee-workbench';

let files: Record<string, Uint8Array>;
const text = (path: string) => strFromU8(files[path]!);
beforeAll(async () => {files = unzipSync((await buildFeeWorkflowExercisePack()).bytes);}, 30000);
afterEach(() => vi.unstubAllGlobals());
describe('独立合成练习包：正式文件、示例来源与未知边界', {timeout: 30000}, () => {
  it('ZIP20份文件，19份内容的SHA256和UTF8字节数由独立Node实现逐一核对', () => {
    expect(Object.keys(files)).toHaveLength(20);
    const manifest = JSON.parse(text('manifest.json')); expect(manifest).toMatchObject({version: '0.1', synthetic: true, financial_authority: false}); expect(manifest.files).toHaveLength(19);
    for (const f of manifest.files) {expect(files[f.path]!.length).toBe(f.bytes); expect(createHash('sha256').update(files[f.path]!).digest('hex')).toBe(f.sha256); expect(f.path).not.toMatch(/(^\/|\.\.|\\)/);}
    expect(() => parseProject(text('manifest.json'))).toThrow();
  });
  it.each(['01-new','02-reference','03-mixed'])('%s 六类正式解析器通过，嵌入来源与独立文件逐字相符且没有回执', async id => {
    const project = parseProject(text(id + '/project.json')), bill = parseContainerBillDraft(text(id + '/bill.json')), pair = parseContainerCostPair(text(id + '/pair.json'));
    const attachment = await parseFeeTaxAttachment(text(id + '/attachment.json')), precision = await parseFeePrecisionSelection(text(id + '/precision.json')), envelope = await parseFeeEnvelope(text(id + '/envelope.json'));
    expect(pair.project).toEqual(project); expect(pair.bill).toEqual(bill); expect(attachment.pair_snapshot_json).toBe(text(id + '/pair.json')); expect(precision.pair_snapshot_json).toBe(text(id + '/pair.json')); expect(precision.attachment_snapshot_json).toBe(text(id + '/attachment.json'));
    expect(envelope.current_sources).toEqual({project_json:text(id+'/project.json'),bill_json:text(id+'/bill.json'),pair_json:text(id+'/pair.json'),attachment_json:text(id+'/attachment.json'),precision_json:text(id+'/precision.json')});
    expect(envelope.history_origin).toBe('UNKNOWN_IMPORTED'); expect(JSON.parse(envelope.ledger_json).receipt_refs).toEqual([]);
    expect(JSON.stringify([project,bill,pair])).not.toContain('USER_CONFIRMED'); expect(bill.rows.every(r=>r.evidence?.status==='EXAMPLE')).toBe(true);
    for(const record of attachment.records){expect(Object.values(record.acknowledgements)).toEqual([null,null,null]);expect(Object.values(record.sources).every(s=>s.provenance==='EXAMPLE')).toBe(true);}
    expect(precision.records.every(r=>r.acknowledgement===null&&r.choice.kind==='UNRESOLVED')).toBe(true);
  });
  it('三题分别保留新建/引用/混合，不用账单合计充当待新增金额', () => {
    const pairs = ['01-new','02-reference','03-mixed'].map(id=>parseContainerCostPair(text(id+'/pair.json')));
    expect(pairs.map(p=>p.mapping.entries.map(r=>r.operation))).toEqual([['CREATE_NEW'],['REFERENCE_EXISTING'],['REFERENCE_EXISTING','CREATE_NEW']]);
    expect(pairs[0]!.project.items.some(c=>c.cost_id==='exercise-service-1')).toBe(false);
    expect(pairs[1]!.project.items.find(c=>c.cost_id==='exercise-service-1')?.amount).toBe('113');
    expect(pairs[2]!.project.items.some(c=>c.cost_id==='exercise-service-2')).toBe(false);
    expect(pairs[2]!.selection.intents[1]).toMatchObject({new_cost:{amount:'20',fx_rate:'7'}});
    expect(pairs[2]!.bill.rows.map(r=>r.input.rate)).toEqual(['113','20']);
  });
  it('成分未知保持null，尝试确认示例来源被拒绝且不改原文件', async () => {
    const raw=text('01-new/attachment.json'),a=await parseFeeTaxAttachment(raw),r=await reviewFeeTaxAttachment(a,text('01-new/pair.json'));
    expect(r.rows[0]!.calculation.channels.cash).toEqual({numerator:'113',denominator:'1'});
    for(const key of ['net','tax','credit','economic','customs'] as const)expect(r.rows[0]!.calculation.channels[key]).toBeNull();
    await expect(acknowledgeFeeTaxAttachmentRecord(a,{revision:a.revision,content_sha256:a.content_sha256},text('01-new/pair.json'),a.records[0]!.record_id,'tax')).rejects.toThrow();
    expect(JSON.stringify(a.records[0]!.acknowledgements)).toBe('{"tax":null,"credit":null,"customs":null}');expect(text('01-new/attachment.json')).toBe(raw);
  });
  it.each(['01-new','02-reference','03-mixed'])('%s 实际完整预览必须阻断；解压与打开文件不给费用应用能力', async id => {
    const envelope=await parseFeeEnvelope(text(id+'/envelope.json')),p=parseProject(envelope.current_sources.project_json),rows=booksToRows(p.fx_books);
    const c:RuntimeFeeWorkbenchCapture={scope:'RUNTIME_FEE_WORKBENCH_CAPTURE',envelope_json:text(id+'/envelope.json'),sources:envelope.current_sources,fx:{rows_json:JSON.stringify(rows),preserved_row_key:JSON.stringify(rows),preserved_books_json:JSON.stringify(p.fx_books)},files:Object.fromEntries(FEE_WORKBENCH_FILES.map(k=>[k,{name:null,saved_raw:null,saved_at:null}])) as RuntimeFeeWorkbenchCapture['files'],editors:{cost:null,review:null,attachment:null,precision:null,pending_input:null},activity:{project_read:false,bill_read:false,pair_read:false,attachment_mutation:false,precision_mutation:false,recovery:false},retained_json:'{}',blockers:[]};
    const before=JSON.stringify(c),r=await previewRuntimeFeeWorkbench(c,'exercise-'+id);expect(r.status).toBe('BLOCKED');expect(r.issues).toContain('HISTORY_NOT_ESTABLISHED');expect(r.runtime_writes).toBe(0);expect(()=>runtimeFeeWorkbenchPreparedSnapshot(r)).toThrow();expect(JSON.stringify(c)).toBe(before);
  });
  it('重新下载产生独立身份，不伪装成旧案例的后续修订；构建无需工作台或浏览器存储', async () => {
    vi.stubGlobal('localStorage',{getItem:()=>{throw Error('current data must not be read')},setItem:()=>{throw Error('current data must not be written')}});
    const next=unzipSync((await buildFeeWorkflowExercisePack()).bytes);
    for(const id of ['01-new','02-reference','03-mixed']){const a=parseContainerCostPair(text(id+'/pair.json')),b=parseContainerCostPair(strFromU8(next[id+'/pair.json']!));expect(a.pair_id).not.toBe(b.pair_id);expect(a.bill.id).not.toBe(b.bill.id);expect(b.project.name).toBe(a.project.name);}
  });
  it('核对题解释独立案例、旧映射悬空、显式新建记录与客户重新确认', () => {
    const readme=text('README.md');for(const phrase of ['三组独立练习','UNKNOWN_IMPORTED','EXAMPLE','应显示未知而非零','退休映射保留','不能偷偷换目标','精度重绑同样撤销政策确认','重新明确客户确认'])expect(readme).toContain(phrase);
  });
});
