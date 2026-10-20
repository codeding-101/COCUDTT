import {strToU8, zipSync} from 'fflate';
import {chinaImportSampleProjectFile} from './sample-project.js';
import {serializeProject} from './project-file.js';
import {emptyContainerBillDraft} from '../domain/container-bill-draft.js';
import {bindContainerBillDraft} from './container-bill-context.js';
import {serializeContainerBillDraft} from './container-bill-file.js';
import {createContainerCostPair, serializeContainerCostPair} from './container-cost-pair.js';
import {createFeeTaxAttachment, setFeeTaxAttachmentRecord, serializeFeeTaxAttachment} from './fee-tax-attachment.js';
import {createFeePrecisionSelection, addFeePrecisionSelectionRecord, serializeFeePrecisionSelection} from './fee-precision-selection.js';
import {adoptLegacyFeeEnvelope, serializeFeeEnvelope} from './fee-envelope.js';
import {feeEnvelopeSha256} from './fee-envelope-json.js';
import type {CostItem} from '../domain/cost-item.js';
import type {ContainerCostIntent} from '../domain/container-cost-proposal.js';
import type {FeeEnvelopeSources} from '../domain/fee-envelope.js';

const specs = [
  {id: '01-new', title: '新增113 USD', reference: false, mixed: false, hypothetical_increment_cny: '791'},
  {id: '02-reference', title: '仅引用已有113 USD', reference: true, mixed: false, hypothetical_increment_cny: '0'},
  {id: '03-mixed', title: '引用已有113 USD并拟新增20 USD', reference: true, mixed: true, hypothetical_increment_cny: '140'},
] as const;
const source = () => ({provenance: 'EXAMPLE' as const, reference: '纯合成练习资料；不是账单、合同或税务资格', valid_from: '2026-09-01', valid_to: '2026-09-30', checked_on: '2026-09-18'});
const evidence = () => {const {provenance: _, ...fields} = source(); return {...fields, status: 'EXAMPLE' as const};};
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

async function buildCase(spec: typeof specs[number]) {
  const project = chinaImportSampleProjectFile(); project.name = '合成练习 · ' + spec.title; project.updated_at = '2026-09-18T00:00:00.000Z';
  const bill = emptyContainerBillDraft('exercise-bill-' + crypto.randomUUID()); bill.name = project.name; bill.review_date = '2026-09-18';
  bill.notes = '独立合成练习；金额按一箱固定项录入。来源EXAMPLE不可确认，当前费用未应用，没有应用回执。';
  const intents: ContainerCostIntent[] = [];
  for (let n = 0; n < (spec.mixed ? 2 : 1); n++) {
    const amount = n === 0 ? '113' : '20', line_id = 'exercise-line-' + (n + 1), cost_id = 'exercise-service-' + (n + 1), scope_id = 'exercise-scope-' + (n + 1);
    const cost: CostItem = {cost_id, cost_name: '合成服务费 ' + amount + ' USD', cost_category: 'CUSTOM', trade_node: 'IMPORT_CLEARANCE', pricing_method: 'FIXED', amount, currency: 'USD', base_currency: 'CNY', fx_type: 'MARKET', fx_rate: '7', fx_evidence: evidence(), tax_included: false, responsibility: 'BUYER', responsibility_source: 'CONTRACT', payment_party: 'BUYER', economic_bearer: 'BUYER', occurrence_reason: 'NORMAL_OPERATION', customs_value: 'EXCLUDE', included_in_quoted_price: false, is_custom: true, source: 'USER', container_charge: n === 0 ? 'INSPECTION' : 'THC_DESTINATION', container_charge_scope: scope_id, applicable_incoterms: ['CIF']};
    const reference = spec.reference && n === 0;
    if (reference) project.items.push(structuredClone(cost));
    bill.rows.push({input: {line_id, scope_id, direction: 'IMPORT', equipment_type: '合成40HC', container_ids: ['SYNTHETIC-' + (n + 1)], currency: 'USD', reference: '合成一箱固定收费，不对应承运人价目', charge_kind: cost.container_charge!, mode: 'PER_CONTAINER', rate: amount}, evidence: evidence(), ...(reference ? {cost_reference: {cost_id, note: '此练习项目已预置这笔费用，不得再新增', evidence: evidence()}} : {})});
    intents.push(reference ? {operation: 'REFERENCE_EXISTING', line_id, cost_id, note: '合成已有费用引用；来源仍待复核'} : {operation: 'CREATE_NEW', line_id, new_cost: cost, note: '仅为拟新增练习选择，未应用费用', evidence: evidence()});
  }
  const bound = bindContainerBillDraft(bill, project), pair = createContainerCostPair(project, bound, {version: '0.1', intents}), pair_json = serializeContainerCostPair(pair);
  let attachment = await createFeeTaxAttachment(pair_json);
  for (const target of pair.mapping.entries) {
    const row = bound.rows.find(r => r.input.line_id === target.line_id)!;
    attachment = await setFeeTaxAttachmentRecord(attachment, {revision: attachment.revision, content_sha256: attachment.content_sha256}, {target, input: {line_id: 'component-' + row.input.line_id, currency: 'USD', gross: row.input.rate!, tax: {kind: 'UNKNOWN'}, credit: {kind: 'UNKNOWN'}, customs: {kind: 'UNKNOWN'}}, sources: {tax: source(), credit: source(), customs: source()}});
  }
  const attachment_json = await serializeFeeTaxAttachment(attachment);
  let precision = await createFeePrecisionSelection(pair_json, attachment_json);
  for (const component of attachment.records) precision = await addFeePrecisionSelectionRecord(precision, {revision: precision.revision, content_sha256: precision.content_sha256}, {component_record_id: component.record_id, channel: 'cash', choice: {kind: 'UNRESOLVED'}});
  const sources: FeeEnvelopeSources = {project_json: serializeProject(project), bill_json: serializeContainerBillDraft(bound), pair_json, attachment_json, precision_json: await serializeFeePrecisionSelection(precision)};
  const envelope_json = await serializeFeeEnvelope(await adoptLegacyFeeEnvelope(sources));
  return {spec, sources, envelope_json};
}

const readme = `# 费用工作流合成练习包

这是三组独立练习，不是同一订单的前后修订。仅供学习与内部测算，不构成专业建议。金额、汇率、税率、商品、箱号和来源全部虚构。来源EXAMPLE不能作为真实依据确认；封套历史为UNKNOWN_IMPORTED，没有费用应用回执。

## 先保存自己的资料

下载只生成ZIP，不读取或替换当前交易，也不标记任何项目文件已保存。解压后先读本说明。打开配对文件会安装其中项目与账单，请先另存自己的项目及独立附件。三组不要混用；重新下载生成新资料身份，不能当作原业务的后续版本。

## 文件与操作顺序

每组都有project.json、bill.json、pair.json、attachment.json、precision.json、envelope.json，使用现有正式JSON格式。manifest.json仅列文件字节数与SHA-256完整性指纹，不是导入文件或授权；ZIP不能作为项目JSON打开。

1. 在“项目＋账单配对交接”打开该组pair.json。它同时包含同组project.json和bill.json；无需反复分别打开。观察每行新建/引用选择及已有费用，尚未应用任何新增费用。
2. 在“费用与税务成分”打开同组attachment.json并明确采用。G应付原币金额已录入；拆税、抵扣、海关成分均为UNKNOWN，应显示未知而非零。这里只替换附件，不安装其项目或账单。
3. 在“精度与换汇政策”打开同组precision.json并明确采用。现金通道保留原币原值，但政策UNRESOLVED、确认空白；不得把算术政策当成业务资格。
4. 打开同组envelope.json，核对候选并明确采用；这仅替换封套面板，不安装封套中的其他来源。然后从“费用工作流”检查整批候选。
5. 正确结果是保留待办、没有应用入口：至少历史未知，且账单/提案来源为示例，成分未知、政策未决。不要为“跑通”改成已确认或复制新业务来绕过。需要真实单据和独立核对才能判断实际业务。

## 三个核对题

- 01-new：项目尚无113 USD服务费；配对仅拟新增113 USD。为什么下载、打开和预览都不应新增费用？
- 02-reference：项目已预置113 USD，配对只引用它。这是练习初始条件，不是“曾通过应用”的证明。若再复制为新增会重复计费。
- 03-mixed：已有113 USD只引用，20 USD仍为拟新增。原币账单合计133 USD不等于待新增金额133 USD；各行不能因同币种就丢掉其不同操作。

## 手算只作条件题

假定将来真实来源、历史和资格全部满足，新增项由买方承担、报价未含、海关排除且无抵扣，商业换算1 USD=7 CNY且其他条件保持：新增113的变化为791 CNY，仅引用113的变化为0，混合批次仅新增20的变化为140 CNY。这不是本包可实际应用或税务口径已确定的结论。海关汇率和海关加计须分别核对；未知卖方利润仍为未知。

## 应用后的连续核对题

本包没有已应用样本或恢复回放入口。实际业务成功应用后，请另存项目、封套和恢复备份，保留原配对/成分/精度文件。原CREATE_NEW资料保持历史，不会自动变成已有引用。

需要继续核对时，先明确移除旧配对选择（退休映射保留），核对当前账单与已有费用引用，再捕获修订并明确加入引用。附件重绑会撤销全部来源确认，旧映射记录仍可能悬空；重绑不能偷偷换目标。确需新目标时须明确删除旧记录并新增，保留退休编号。精度重绑同样撤销政策确认，不会自动指向新成分记录。

每一步都应保持既有费用和回执，旧文件逐字保管；恢复备份不能直接重放费用。最后再核对客户报价金额、币种和条款，重新明确客户确认后导出。示例不提供实际合同或税务结论。
`;

/** Self-contained synthetic files only. No workbench input, acknowledgement, application or storage API. */
export async function buildFeeWorkflowExercisePack(): Promise<{name: string; bytes: Uint8Array<ArrayBuffer>}> {
  const files: Record<string, Uint8Array> = {'README.md': strToU8(readme)}, cases = [];
  for (const spec of specs) {
    const item = await buildCase(spec), names = {project_json: 'project.json', bill_json: 'bill.json', pair_json: 'pair.json', attachment_json: 'attachment.json', precision_json: 'precision.json'} as const;
    for (const [key, name] of Object.entries(names)) files[spec.id + '/' + name] = strToU8(item.sources[key as keyof FeeEnvelopeSources]!);
    files[spec.id + '/envelope.json'] = strToU8(item.envelope_json);
    cases.push({...spec, financial_authority: false, history_origin: 'UNKNOWN_IMPORTED'});
  }
  const inventory = [];
  for (const [path, bytes] of Object.entries(files)) inventory.push({path, bytes: bytes.length, sha256: await feeEnvelopeSha256(new TextDecoder().decode(bytes))});
  files['manifest.json'] = strToU8(json({kind: 'INTERNAL_FEE_WORKFLOW_EXERCISE_PACK_INDEX', version: '0.1', financial_authority: false, synthetic: true, cases, files: inventory}));
  return {name: 'COCUDTT-synthetic-fee-exercises.zip', bytes: new Uint8Array(zipSync(files, {level: 6, mtime: new Date('2026-09-18T00:00:00Z')}))};
}
