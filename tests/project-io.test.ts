import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleProjectFile } from '../src/data/sample-project';
import { serializeProject, SCHEMA_VERSION } from '../src/data/project-file';
import { booksToRows } from '../src/ui/fx-rows';

// 测试真实的界面事件处理与渲染输出；最小 DOM 替身不负责布局或 HTML 解析。
class ElementStub {
  dataset: Record<string, string> = {};
}
class InputStub extends ElementStub {
  id = 'file-input';
  value = '';
  checked = false;
  type = 'text';
  files: { name: string; text: () => Promise<string> }[] = [];
}

describe('打开、保存项目的失败处理', () => {
  let html: string;
  let listeners: Map<string, (event: { target: ElementStub }) => void>;
  let storage: Map<string, string>;
  let createElement: ReturnType<typeof vi.fn>;
  const key = 'trade-cost-engine:draft-v1';

  beforeEach(() => {
    vi.resetModules();
    html = '';
    listeners = new Map();
    storage = new Map();
    createElement = vi.fn();
    const app = {
      get innerHTML() { return html; },
      set innerHTML(value: string) { html = value; },
      addEventListener: (name: string, handler: (event: { target: ElementStub }) => void) => listeners.set(name, handler),
    };
    vi.stubGlobal('HTMLElement', ElementStub);
    vi.stubGlobal('HTMLInputElement', InputStub);
    vi.stubGlobal('HTMLSelectElement', class extends ElementStub {});
    vi.stubGlobal('document', {
      querySelector: (selector: string) => selector === '#app' ? app : null,
      querySelectorAll: () => [], activeElement: null, body: new ElementStub(), createElement,
    });
    vi.stubGlobal('localStorage', {
      getItem: (name: string) => storage.get(name) ?? null,
      setItem: (name: string, value: string) => storage.set(name, value),
    });
    vi.stubGlobal('window', {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  async function start() {
    const app = await import('../src/ui/app');
    app.start();
  }
  function open(text: () => Promise<string>, name = 'test.json') {
    const input = new InputStub();
    input.files = [{ name, text }];
    listeners.get('change')!({ target: input });
  }
  function save() {
    const button = new ElementStub();
    button.dataset.action = 'save';
    listeners.get('click')!({ target: button });
  }

  function chinaImport() {
    const button = new ElementStub();
    button.dataset.action = 'new-china-import';
    listeners.get('click')!({ target: button });
  }
  function action(name: string) {
    const button = new ElementStub(); button.dataset.action = name; listeners.get('click')!({ target: button });
  }
  function change(path: string, value: string, checked = false) {
    const field = new InputStub();
    field.id = '';
    field.dataset.path = path;
    field.value = value;
    field.checked = checked;
    listeners.get('change')!({ target: field });
  }

  function evidence(owner: string, id: string, field: string, value: string) {
    const input = new InputStub();
    input.id = '';
    input.dataset.evidenceOwner = owner;
    input.dataset.evidenceId = id;
    input.dataset.evidenceField = field;
    input.value = value;
    listeners.get('change')!({ target: input });
  }

  function confirmSources() {
    const draft = JSON.parse(storage.get(key)!);
    for (const [owner, id] of [['tax', ''], ['duty-eligibility', ''], ...draft.fxRows.map((row: { row_id: string }) => ['fx', row.row_id])]) {
      evidence(owner, id, 'reference', '人工核对测试文件');
      evidence(owner, id, 'valid_from', '2026-08-01');
      evidence(owner, id, 'valid_to', '2026-09-30');
      evidence(owner, id, 'checked_on', '2026-10-11');
      evidence(owner, id, 'status', 'USER_CONFIRMED');
    }
  }

  it('费用适用范围的真实事件写入草稿，逐项选择、空选和恢复全部均生效', async () => {
    await start(); chinaImport();
    const costId = JSON.parse(storage.get(key)!).project.items.find((item: { cost_category: string })=>item.cost_category==='MAIN_CARRIAGE').cost_id;
    const itemField = (field:string,value:string,checked=false,term='')=>{
      const input=new InputStub();input.id='';input.dataset.item=costId;input.dataset.itemField=field;input.dataset.term=term;
      input.value=value;input.type=field==='applicable_term'?'checkbox':'text';input.checked=checked;listeners.get('change')!({target:input});
    };
    itemField('applicability','BUYER');
    expect(JSON.parse(storage.get(key)!).project.items.find((x:{cost_id:string})=>x.cost_id===costId).applicable_incoterms).toEqual(['EXW','FCA','FAS','FOB']);
    expect(html).toContain('本方案未启用');
    itemField('applicable_term','',true,'CIF');
    expect(JSON.parse(storage.get(key)!).project.items.find((x:{cost_id:string})=>x.cost_id===costId).applicable_incoterms).toContain('CIF');
    itemField('alternative_group','运输替代报价');
    expect(JSON.parse(storage.get(key)!).project.items.find((x:{cost_id:string})=>x.cost_id===costId).alternative_group).toBe('运输替代报价');
    itemField('applicability','NONE'); expect(html).toContain('适用贸易术语：不启用');
    itemField('applicability','ALL');
    expect(JSON.parse(storage.get(key)!).project.items.find((x:{cost_id:string})=>x.cost_id===costId).applicable_incoterms).toBeUndefined();
    expect(html).toContain('901,101.49');
  });

  it('当前术语费用缺失时仍显示其他可计算方案，不沿用当前旧金额', async () => {
    await start(); chinaImport();
    const draft=JSON.parse(storage.get(key)!);const freight=draft.project.items.find((x:{cost_category:string})=>x.cost_category==='MAIN_CARRIAGE');
    freight.applicable_incoterms=['CIF'];freight.amount='';
    open(async()=>serializeProject(draft.project));
    await vi.waitFor(()=>expect(html).toContain('无法计算'));
    expect(html).toContain('11 术语横向对比'); expect(html).toContain('FOB');
    expect(html).not.toContain('901,101.49');
  });

  it('示例来源未核对时显示参考状态；逐项完成核对后恢复排名', async () => {
    await start(); chinaImport();
    expect(html).toContain('当前没有可参与排名的方案');
    expect(html).toContain('参考方案');
    confirmSources();
    expect(html).toContain('符合当前排名检查条件');
    expect(html).toContain('可排名方案中卖方利润最高');
    expect(html).not.toContain('当前没有可参与排名的方案');
    const project = JSON.parse(storage.get(key)!).project;
    expect(project.tax_profile.import.rateEvidence.status).toBe('USER_CONFIRMED');
    expect(project.tax_profile.import.rateEvidence.values_key).toBeTypeOf('string');
  });

  it('已核对税率或来源修改后撤销确认，而不是自动沿用旧证明', async () => {
    await start(); chinaImport(); confirmSources();
    change('tax_profile.import.vatRate', '0.09');
    expect(html).toContain('参考测算，仍待核对');
    expect(JSON.parse(storage.get(key)!).project.tax_profile.import.rateEvidence.status).toBe('UNVERIFIED');
    evidence('tax', '', 'status', 'USER_CONFIRMED');
    expect(html).toContain('符合当前排名检查条件');
    evidence('tax', '', 'reference', '另一个来源');
    expect(JSON.parse(storage.get(key)!).project.tax_profile.import.rateEvidence.status).toBe('UNVERIFIED');
  });

  it('汇率修改撤销对应币种对确认，保存文件仍保留来源和新格式版本', async () => {
    await start(); chinaImport(); confirmSources();
    const rowId = JSON.parse(storage.get(key)!).fxRows[0].row_id;
    const field = new InputStub(); field.id = ''; field.value = '7.1'; field.dataset.fx = rowId; field.dataset.fxField = 'rate';
    listeners.get('change')!({ target: field });
    expect(JSON.parse(storage.get(key)!).fxRows[0].evidence.status).toBe('UNVERIFIED');
    let saved = '';
    vi.stubGlobal('window', { showSaveFilePicker: async () => ({ name: 'source.json', createWritable: async () => ({ write: async (text: string) => { saved = text; }, close: async () => {} }) }) });
    save();
    await vi.waitFor(() => expect(saved).not.toBe(''));
    const project = JSON.parse(saved);
    expect(project.schema_version).toBe(SCHEMA_VERSION);
    expect(project.fx_books[0].evidence['USD/CNY'].reference).toBe('人工核对测试文件');
    expect(project.fx_books[0].evidence['USD/CNY'].status).toBe('UNVERIFIED');
  });

  it('中国进口示例入口实际接通，结果显示适用模式和退税不适用', async () => {
    await start();
    chinaImport();
    expect(html).toContain('示例：中国一般贸易进口（虚构税率）');
    expect(html).toContain('中国一般贸易进口 · CNY 计税 · 税款舍入至分');
    expect(html).toContain('货物净价（不含运保费）');
    expect(html).toContain('不适用');
    expect(html).toContain('901,101.49');
    expect(JSON.parse(storage.get(key)!).project.tax_profile.import.calculationMode).toBe('CN_GENERAL_TRADE');
  });

  it('新建入口产生真正空白的中国交易，可保存未完成输入后继续打开', async () => {
    await start(); action('new-china-blank');
    const project = JSON.parse(storage.get(key)!).project;
    expect(project.goods.name).toBe(''); expect(project.goods.trade_value.amount).toBe('');
    expect(project.items).toEqual([]); expect(project.fx_books).toEqual([]);
    expect(html).toContain('中国进口录入提示');
    expect(html).toContain('卖方采购成本（未知可留空）');
    let saved = '';
    vi.stubGlobal('window', { showSaveFilePicker: async () => ({ name: 'blank.json', createWritable: async () => ({ write: async (text: string) => { saved = text; }, close: async () => {} }) }) });
    save(); await vi.waitFor(() => expect(saved).not.toBe(''));
    open(async () => saved, 'blank.json');
    await vi.waitFor(() => expect(html).toContain('blank.json'));
    expect(JSON.parse(storage.get(key)!).project.goods.trade_value.amount).toBe('');
  });

  it('界面清空卖方成本后保留买方金额；恢复实际成本后恢复利润', async () => {
    await start(); chinaImport(); confirmSources();
    change('goods.seller_goods_cost.amount', '');
    expect(html).toContain('901,101.49'); expect(html).toContain('无法评估');
    expect(html).not.toContain('可排名方案中卖方利润最高');
    expect(html).toContain('可排名方案中买方总支付最低');
    change('goods.seller_goods_cost.amount', '620000');
    expect(html).toContain('80,000.00');
    expect(html).toContain('可排名方案中卖方利润最高');
  });

  it('新加费用保留空金额，不能自动成为已知零费用', async () => {
    await start(); chinaImport(); action('add-custom');
    const items = JSON.parse(storage.get(key)!).project.items;
    expect(items.at(-1).amount).toBe('');
    expect(html).toContain('无法计算');
    expect(html).toContain('缺少「金额」');
  });

  it('导出报告保存当前输入与结果，但不代替项目保存或修改草稿', async () => {
    await start(); chinaImport();
    const before = storage.get(key); let saved = '';
    vi.stubGlobal('window', { showSaveFilePicker: async () => ({ name: 'report.html', createWritable: async () => ({ write: async (text: string) => { saved = text; }, close: async () => {} }) }) });
    action('export-report'); await vi.waitFor(() => expect(saved).toContain('901,101.49'));
    await vi.waitFor(() => expect(html).toContain('已导出报告 report.html'));
    expect(storage.get(key)).toBe(before);
    expect(html).toContain('项目文件仍需单独保存');
    expect(html).toContain('有未保存改动');
  });

  it('取消报告导出和写盘失败会提示，不覆盖项目或改成下载', async () => {
    await start(); chinaImport(); const before = storage.get(key);
    const cancelled = new Error('cancel'); cancelled.name = 'AbortError';
    vi.stubGlobal('window', { showSaveFilePicker: async () => { throw cancelled; } });
    action('export-report'); await vi.waitFor(() => expect(html).toContain('已取消报告导出'));
    vi.stubGlobal('window', { showSaveFilePicker: async () => ({ name: 'report.html', createWritable: async () => ({ write: async () => { throw new Error('disk-full'); }, close: async () => {} }) }) });
    action('export-report'); await vi.waitFor(() => expect(html).toContain('报告导出失败'));
    expect(html).toContain('disk-full'); expect(storage.get(key)).toBe(before);
    expect(createElement).not.toHaveBeenCalled();
  });

  async function customerProject() {
    const {actualQuotesProject}=await import('./fixtures/actual-quotes');
    const p=actualQuotesProject();p.incoterm='FOB';p.name='PRIVATE_CUSTOMER_FILENAME_997';
    open(async()=>serializeProject(p));await vi.waitFor(()=>expect(html).toContain('10,000.00'));
  }
  function customer(field:string,value:string,checked=false) {
    const input=new InputStub();input.id='';input.dataset.customerField=field;input.value=value;input.checked=checked;listeners.get('change')!({target:input});
  }
  it('客户公开字段编辑和导出不改项目/草稿，文件不含内部项目名',async()=>{
    await start();await customerProject();const before=storage.get(key);customer('reference','PUBLIC-Q-001');customer('payment_terms','公开付款安排');customer('reviewed','',true);
    let saved='',suggested='';vi.stubGlobal('window',{showSaveFilePicker:async(options:{suggestedName:string})=>{suggested=options.suggestedName;return{name:'public.html',createWritable:async()=>({write:async(text:string)=>{saved=text;},close:async()=>{}})}}});
    action('export-customer-quote');await vi.waitFor(()=>expect(saved).toContain('PUBLIC-Q-001'));
    expect(saved).toContain('公开付款安排');expect(saved).not.toContain('PRIVATE_CUSTOMER_FILENAME_997');expect(suggested).not.toContain('PRIVATE_CUSTOMER_FILENAME_997');expect(storage.get(key)).toBe(before);expect(html).toContain('项目文件仍需单独保存');
  });
  it('编辑公开或项目字段撤销客户预览检查，未检查不调用文件写盘',async()=>{
    await start();await customerProject();const picker=vi.fn();vi.stubGlobal('window',{showSaveFilePicker:picker});
    customer('reviewed','',true);customer('reference','NEW-Q');action('export-customer-quote');await vi.waitFor(()=>expect(html).toContain('请先检查客户预览'));expect(picker).not.toHaveBeenCalled();
    customer('reviewed','',true);change('goods.name','变更商品');action('export-customer-quote');await vi.waitFor(()=>expect(html).toContain('请先检查客户预览'));expect(picker).not.toHaveBeenCalled();
  });
  it('客户取消/写盘失败不覆盖项目，不降级下载，新项目清空公开参数',async()=>{
    await start();await customerProject();customer('reference','TEMP-PUBLIC-Q');customer('reviewed','',true);const before=storage.get(key),cancel=new Error('cancel');cancel.name='AbortError';
    vi.stubGlobal('window',{showSaveFilePicker:async()=>{throw cancel;}});action('export-customer-quote');await vi.waitFor(()=>expect(html).toContain('已取消客户报价导出'));
    vi.stubGlobal('window',{showSaveFilePicker:async()=>({name:'q.html',createWritable:async()=>({write:async()=>{throw new Error('disk-full');},close:async()=>{}})})});action('export-customer-quote');await vi.waitFor(()=>expect(html).toContain('客户报价导出失败'));
    expect(storage.get(key)).toBe(before);expect(createElement).not.toHaveBeenCalled();action('new-china-blank');expect(html).not.toContain('TEMP-PUBLIC-Q');
  });

  it('原产地修改撤销待遇核对，重新核对后恢复排名', async () => {
    await start(); chinaImport(); confirmSources();
    change('route.origin_country', '法国');
    expect(html).toContain('当前没有可参与排名的方案');
    expect(JSON.parse(storage.get(key)!).project.tax_profile.import.eligibility.duty_evidence.status).toBe('UNVERIFIED');
    evidence('duty-eligibility', '', 'status', 'USER_CONFIRMED');
    expect(html).toContain('符合当前排名检查条件');
    expect(html).toContain('原产国/地区：法国');
  });

  it('客户Excel写入原生二进制文件，不改草稿，内部数据不进入任何部件',async()=>{
    await start();await customerProject();customer('reference','PUBLIC-EXCEL');customer('reviewed','',true);const before=storage.get(key);let blob:Blob|null=null,suggested='';
    vi.stubGlobal('window',{showSaveFilePicker:async(options:{suggestedName:string})=>{suggested=options.suggestedName;return{name:'public.xlsx',createWritable:async()=>({write:async(data:Blob)=>{blob=data;},close:async()=>{}})}}});
    action('export-customer-xlsx');await vi.waitFor(()=>expect(blob).not.toBeNull());const {unzipSync,strFromU8}=await import('fflate');const all=Object.values(unzipSync(new Uint8Array(await blob!.arrayBuffer()))).map(bytes=>strFromU8(bytes)).join('');
    expect(suggested).toBe('PUBLIC-EXCEL-客户报价草稿.xlsx');expect(all).toContain('PUBLIC-EXCEL');expect(all).not.toContain('PRIVATE_CUSTOMER_FILENAME_997');expect(all).not.toContain('seller_goods_cost');expect(storage.get(key)).toBe(before);expect(html).toContain('已导出客户报价 Excel 草稿');
  });
  it('客户Excel未检查/修改后阻止写盘，取消与失败不触发降级下载',async()=>{
    await start();await customerProject();const picker=vi.fn();vi.stubGlobal('window',{showSaveFilePicker:picker});action('export-customer-xlsx');await vi.waitFor(()=>expect(html).toContain('请先检查客户预览'));expect(picker).not.toHaveBeenCalled();
    customer('reviewed','',true);customer('reference','MODIFIED');action('export-customer-xlsx');await vi.waitFor(()=>expect(html).toContain('请先检查客户预览'));expect(picker).not.toHaveBeenCalled();
    customer('reviewed','',true);const before=storage.get(key);vi.stubGlobal('window',{showSaveFilePicker:async()=>{throw new DOMException('cancel','AbortError');}});action('export-customer-xlsx');await vi.waitFor(()=>expect(html).toContain('已取消客户报价 Excel 草稿'));
    vi.stubGlobal('window',{showSaveFilePicker:async()=>({name:'public.xlsx',createWritable:async()=>({write:async()=>{throw new Error('disk-full');},close:async()=>{}})})});action('export-customer-xlsx');await vi.waitFor(()=>expect(html).toContain('Excel 草稿导出失败'));expect(storage.get(key)).toBe(before);expect(createElement).not.toHaveBeenCalled();
  });
  it('文件选择期间修改项目不改变已生成的Excel快照',async()=>{
    await start();await customerProject();customer('reviewed','',true);let resolvePicker!:(handle:unknown)=>void;let blob:Blob|null=null;
    vi.stubGlobal('window',{showSaveFilePicker:()=>new Promise(resolve=>{resolvePicker=resolve;})});action('export-customer-xlsx');change('term_scenarios.FOB.quote.amount','12345');
    resolvePicker({name:'public.xlsx',createWritable:async()=>({write:async(data:Blob)=>{blob=data;},close:async()=>{}})});await vi.waitFor(()=>expect(blob).not.toBeNull());const {unzipSync,strFromU8}=await import('fflate');const text=strFromU8(unzipSync(new Uint8Array(await blob!.arrayBuffer()))['xl/worksheets/sheet1.xml']!);expect(text).toContain('<v>10000</v>');expect(text).not.toContain('<v>12345</v>');expect(JSON.parse(storage.get(key)!).project.term_scenarios.FOB.quote.amount).toBe('12345');
  });
  it('内部Excel保留内部项目和完整输入，导出不代表项目已保存',async()=>{
    await start();await customerProject();const before=storage.get(key);let blob:Blob|null=null;
    vi.stubGlobal('window',{showSaveFilePicker:async()=>({name:'internal.xlsx',createWritable:async()=>({write:async(data:Blob)=>{blob=data;},close:async()=>{}})})});action('export-internal-xlsx');await vi.waitFor(()=>expect(blob).not.toBeNull());const {unzipSync,strFromU8}=await import('fflate');const all=Object.values(unzipSync(new Uint8Array(await blob!.arrayBuffer()))).map(bytes=>strFromU8(bytes)).join('');expect(all).toContain('PRIVATE_CUSTOMER_FILENAME_997');expect(all).toContain('seller_goods_cost');expect(html).toContain('项目文件仍需单独保存');expect(storage.get(key)).toBe(before);
  });
  it('Excel下载回退保持草稿和未保存状态，不能把导出当项目保存',async()=>{
    await start();await customerProject();customer('reviewed','',true);const before=storage.get(key),click=vi.fn(),revoke=vi.fn();let blob:Blob|null=null;
    createElement.mockReturnValue({click});vi.spyOn(URL,'createObjectURL').mockImplementation(data=>{if(!(data instanceof Blob))throw new Error('Expected Blob');blob=data;return 'blob:test';});vi.spyOn(URL,'revokeObjectURL').mockImplementation(revoke);
    action('export-customer-xlsx');await vi.waitFor(()=>expect(html).toContain('已发起客户报价 Excel 草稿下载'));expect(click).toHaveBeenCalledOnce();expect(blob).toBeInstanceOf(Blob);expect(storage.get(key)).toBe(before);expect(html).toContain('项目保存状态未改变');await vi.waitFor(()=>expect(revoke).toHaveBeenCalledWith('blob:test'),{timeout:1500});vi.restoreAllMocks();
  });

  it('抵扣开关不能替代身份、用途及凭证核对，修改用途撤销确认', async () => {
    await start(); chinaImport(); confirmSources();
    change('tax_profile.import.vatDeductibleForBuyer', '', true);
    expect(html).toContain('当前没有可参与排名的方案');
    change('tax_profile.import.eligibility.vat_taxpayer', 'GENERAL');
    change('tax_profile.import.eligibility.vat_use', 'TAXABLE_BUSINESS');
    for (const [field, value] of Object.entries({ reference: '身份与凭证条件核对文件', valid_from: '2026-09-01', valid_to: '2026-09-30', checked_on: '2026-10-11', status: 'USER_CONFIRMED' })) evidence('vat-eligibility', '', field, value);
    expect(html).toContain('符合当前排名检查条件');
    change('tax_profile.import.eligibility.vat_use', 'OTHER');
    expect(JSON.parse(storage.get(key)!).project.tax_profile.import.eligibility.vat_evidence.status).toBe('UNVERIFIED');
    expect(html).toContain('混合用途');
    expect(html).toContain('当前没有可参与排名的方案');
  });

  it('旧项目缺少路线和资格对象时，首次编辑建立完整可保存结构', async () => {
    await start();
    change('tax_profile.import.calculationMode', 'CN_GENERAL_TRADE');
    change('route.export_country', '德国');
    change('tax_profile.import.eligibility.agreement_name', '测试协定');
    const project = JSON.parse(storage.get(key)!).project;
    const { parseProject } = await import('../src/data/project-file');
    expect(() => parseProject(serializeProject(project))).not.toThrow();
    expect(project.route.origin_country).toBe('');
    expect(project.route.customs_regime).toBe('UNCONFIRMED');
    expect(project.tax_profile.import.eligibility.vat_taxpayer).toBe('UNCONFIRMED');
  });

  it('中国税务控件按数值、布尔类型写入；消费税留空可正确存取', async () => {
    await start();
    chinaImport();
    change('tax_profile.import.consumptionTax.rate', '0.1');
    let project = JSON.parse(storage.get(key)!).project;
    expect(project.tax_profile.import.consumptionTax).toEqual({ rate: '0.1', basis: 'DUTIABLE_PLUS_DUTY' });
    change('tax_profile.import.vatDeductibleForBuyer', 'on', true);
    project = JSON.parse(storage.get(key)!).project;
    expect(project.tax_profile.import.vatDeductibleForBuyer).toBe(true);
    change('tax_profile.import.consumptionTax.rate', '');
    expect(JSON.parse(storage.get(key)!).project.tax_profile.import.consumptionTax).toBeNull();
  });

  it('中国模式缺少申报日期时界面阻断，填回日期后重新得出结果', async () => {
    await start();
    chinaImport();
    change('tax_profile.import.declarationDate', '');
    expect(html).toContain('CN_IMPORT_CONTEXT_INVALID');
    change('tax_profile.import.declarationDate', '2026-09-10');
    expect(html).not.toContain('CN_IMPORT_CONTEXT_INVALID');
    expect(html).toContain('901,101.49');
  });

  it('坏文件保留当前项目、计算结果和草稿，并持续显示失败原因', async () => {
    await start();
    const draft = storage.get(key);
    const project = sampleProjectFile();
    open(async () => JSON.stringify({ ...project, name: '坏文件不能替换当前交易', fx_books: null }));
    await vi.waitFor(() => expect(html).toContain('PROJECT_PARSE_FAILED'));
    expect(html).toContain('project.fx_books');
    expect(html).toContain('示例：CIF 报价 USD 108,300');
    expect(html).not.toContain('坏文件不能替换当前交易');
    expect(html).toContain('卖方利润');
    expect(storage.get(key)).toBe(draft);
  });

  it('文件读取失败不会丢失当前内容', async () => {
    await start();
    const draft = storage.get(key);
    open(async () => { throw new Error('无法读取文件'); });
    await vi.waitFor(() => expect(html).toContain('打开失败：Error: 无法读取文件'));
    expect(storage.get(key)).toBe(draft);
  });

  it('成功打开文件后更新项目与草稿，文件名按纯文本展示', async () => {
    await start();
    const project = sampleProjectFile();
    project.name = '客户 A 的真实交易';
    open(async () => serializeProject(project), '<img src=x onerror=alert(1)>.json');
    await vi.waitFor(() => expect(html).toContain('客户 A 的真实交易'));
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;.json');
    expect(html).not.toContain('<img src=x');
    expect(JSON.parse(storage.get(key)!).project.name).toBe(project.name);
  });

  it('坏文件里的版本信息不会被作为 HTML 注入', async () => {
    await start();
    open(async () => JSON.stringify({ schema_version: '<img src=x onerror=alert(1)>' }));
    await vi.waitFor(() => expect(html).toContain('PROJECT_VERSION_UNSUPPORTED'));
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
  });

  it('草稿汇率行损坏时显示恢复失败，启动时不覆盖原草稿', async () => {
    const broken = JSON.stringify({ project: sampleProjectFile(), fxRows: [null] });
    storage.set(key, broken);
    await start();
    expect(html).toContain('上次的草稿无法读取');
    expect(html).toContain('原草稿暂未覆盖');
    expect(storage.get(key)).toBe(broken);
  });

  it('允许从草稿恢复尚未填完的金额和汇率行', async () => {
    const project = sampleProjectFile();
    project.quote.amount = '';
    const rows = booksToRows(project.fx_books);
    rows[0]!.rate = '';
    storage.set(key, JSON.stringify({ project, fxRows: rows }));
    await start();
    expect(html).not.toContain('上次的草稿无法读取');
    expect(JSON.parse(storage.get(key)!).fxRows[0].rate).toBe('');
  });

  it('浏览器存储不可用时明确说明自动草稿没有保存', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('存储已禁用'); },
      setItem: () => { throw new Error('存储已禁用'); },
    });
    await start();
    expect(html).toContain('自动草稿保存失败，请保存项目文件');
    expect(html).toContain('卖方利润');
  });

  it('取消保存保留未保存状态，也不触发额外下载', async () => {
    await start();
    const button = new ElementStub();
    button.dataset.action = 'new';
    listeners.get('click')!({ target: button });
    vi.stubGlobal('window', { showSaveFilePicker: async () => { throw new DOMException('cancel', 'AbortError'); } });
    save();
    await vi.waitFor(() => expect(html).toContain('已取消保存'));
    expect(html).toContain('尚未写入项目文件');
    expect(createElement).not.toHaveBeenCalled();
  });

  it('写盘失败必须显示失败，不能宣称已经保存', async () => {
    await start();
    vi.stubGlobal('window', { showSaveFilePicker: async () => ({
      name: 'test.json', createWritable: async () => ({
        write: async () => { throw new Error('磁盘已满'); }, close: async () => {},
      }),
    }) });
    save();
    await vi.waitFor(() => expect(html).toContain('保存失败'));
    expect(html).toContain('磁盘已满');
    expect(html).not.toContain('已保存到');
    expect(createElement).not.toHaveBeenCalled();
  });
});
