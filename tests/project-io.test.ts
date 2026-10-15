import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleProjectFile } from '../src/data/sample-project';
import { serializeProject, SCHEMA_VERSION } from '../src/data/project-file';
import { booksToRows } from '../src/ui/fx-rows';
import {createContainerCostPair,serializeContainerCostPair} from '../src/data/container-cost-pair';
import {containerBillTemplate} from '../src/data/container-bill-templates';
import {containerReviewTargetKey} from '../src/data/container-review-editor';

// 测试真实的界面事件处理与渲染输出；最小 DOM 替身不负责布局或 HTML 解析。
class ElementStub {
  dataset: Record<string, string> = {};
}
class InputStub extends ElementStub {
  id = 'file-input';
  value = '';
  checked = false;
  type = 'text';
  files: { name: string; text: () => Promise<string>; size?: number }[] = [];
}

describe('打开、保存项目的失败处理', () => {
  let html: string;
  let listeners: Map<string, (event: { target: ElementStub }) => void>;
  let storage: Map<string, string>;
  let createElement: ReturnType<typeof vi.fn>;
  let appRoot: { innerHTML: string; hidden: boolean; addEventListener: (name: string, handler: (event: { target: ElementStub }) => void) => void; insertAdjacentElement: (position: string, panel: RecoveryPanelStub) => void };
  let recoveryPanel: RecoveryPanelStub | null;
  class RecoveryPanelStub {
    id=''; className=''; innerHTML='';
    callbacks=new Map<string,()=>void>();
    setAttribute() {}
    querySelector(id:string) {return {addEventListener: (_type:string,callback:()=>void)=>this.callbacks.set(id,callback)}}
    remove() {recoveryPanel=null}
  }
  const key = 'trade-cost-engine:draft-v1';

  beforeEach(() => {
    vi.resetModules();
    html = '';
    listeners = new Map();
    storage = new Map();
    createElement = vi.fn();
    recoveryPanel=null;
    const app = {
      hidden:false,
      get innerHTML() { return html; },
      set innerHTML(value: string) { html = value; },
      addEventListener: (name: string, handler: (event: { target: ElementStub }) => void) => listeners.set(name, handler),
      insertAdjacentElement: (_position:string,panel:RecoveryPanelStub) => {recoveryPanel=panel},
    };
    appRoot=app;
    vi.stubGlobal('HTMLElement', ElementStub);
    vi.stubGlobal('HTMLInputElement', InputStub);
    vi.stubGlobal('HTMLSelectElement', class extends ElementStub {});
    vi.stubGlobal('document', {
      querySelector: (selector: string) => selector === '#app' ? app : selector === '#app-recovery' ? recoveryPanel : null,
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
  const quickLease=()=>html.match(/data-quick-cost-lease="(\d+)"/)![1]!;
  function quickField(kind:string,field:string,value:string,id?:string,lease=quickLease()){
    const input=new InputStub();input.id='';input.dataset={quickCostKind:kind,quickCostField:field,quickCostLease:lease,...(id?{quickCostId:id}:{})};input.value=value;listeners.get('change')!({target:input});
  }
  // This first app import includes the offline PDF font and full UI graph; allow cold CI startup.
  it('快捷选择不改业务；金额编辑只改变明确选中的原币费用，不联动货值和报价',async()=>{
    await start();const before=JSON.parse(storage.get(key)!);quickField('carriage','choose','freight');expect(JSON.parse(storage.get(key)!)).toEqual(before);
    quickField('carriage','amount','9000.123456','freight');const after=JSON.parse(storage.get(key)!);expect(after.project.items.find((i:any)=>i.cost_id==='freight').amount).toBe('9000.123456');
    before.project.items.find((i:any)=>i.cost_id==='freight').amount='9000.123456';expect(after).toEqual(before);expect(html).toContain('原币金额（USD）');
  },15_000);
  it('快捷路径与完整明细的既有金额路径生成相同项目',async()=>{
    await start();quickField('carriage','choose','freight');quickField('carriage','amount','9001','freight');const quick=JSON.parse(storage.get(key)!);
    const original=sampleProjectFile();original.updated_at=quick.project.updated_at;open(async()=>serializeProject(original));await vi.waitFor(()=>expect(JSON.parse(storage.get(key)!).project.items[1].amount).toBe('8000'));
    const input=new InputStub();input.id='';input.dataset={item:'freight',itemField:'amount'};input.value='9001';listeners.get('change')!({target:input});expect(JSON.parse(storage.get(key)!)).toEqual(quick);
  });
  it('快捷编辑空金额保留原值文本并阻断计算，不默认为零',async()=>{
    await start();quickField('carriage','choose','freight');quickField('carriage','amount','','freight');expect(JSON.parse(storage.get(key)!).project.items[1].amount).toBe('');expect(html).toContain('无法计算');
  });
  it('迟到事件与另一项目复用编号均不能覆盖费用',async()=>{
    await start();quickField('carriage','choose','freight');const old=quickLease();change('name','NEW_VIEW_46');const before=storage.get(key);quickField('carriage','amount','999999','freight',old);expect(storage.get(key)).toBe(before);
    const prior=quickLease();action('new');const replaced=storage.get(key);quickField('carriage','amount','999999','freight',prior);expect(storage.get(key)).toBe(replaced);
  });
  it('复杂计价在快捷面板只读，伪造金额事件不改项目',async()=>{
    await start();const p=sampleProjectFile();p.items[1]!.pricing_method='PERCENT';p.items[1]!.rate='0.01';p.items[1]!.calculation_base={kind:'GOODS_VALUE'};open(async()=>serializeProject(p));await vi.waitFor(()=>expect(JSON.parse(storage.get(key)!).project.items[1].pricing_method).toBe('PERCENT'));quickField('carriage','choose','freight');const before=storage.get(key);quickField('carriage','amount','999999','freight');expect(storage.get(key)).toBe(before);expect(html).toContain('非固定或实际金额计价');
  });
  it('默认新手视图；切换只保存界面偏好，不改草稿、采购成本或当前金额',async()=>{
    await start();expect(html).toContain('data-workspace-mode="beginner"');change('name','MODE_BUSINESS_45');const before=storage.get(key);
    action('mode-professional');expect(html).toContain('data-workspace-mode="professional"');expect(storage.get(key)).toBe(before);expect(html).toContain('80,000.00');expect(storage.get('trade-cost-engine:workspace-mode-v1')).toBe('professional');
    action('mode-beginner');expect(storage.get(key)).toBe(before);expect(html).toContain('data-workspace-mode="beginner"');
  });
  it('已保存的专业模式偏好可恢复，未知值不启用专业模式',async()=>{
    storage.set('trade-cost-engine:workspace-mode-v1','professional');await start();expect(html).toContain('data-workspace-mode="professional"');
  });
  it('模式偏好写入失败不进入故障页，也不丢失当前项目',async()=>{
    await start();const before=storage.get(key);vi.stubGlobal('localStorage',{getItem:(name:string)=>storage.get(name)??null,setItem:()=>{throw Error('PRIVATE_MODE_WRITE45')}});action('mode-professional');
    expect(appRoot.hidden).toBe(false);expect(html).toContain('data-workspace-mode="professional"');expect(html).toContain('本次模式切换有效');expect(html).not.toContain('PRIVATE_MODE_WRITE45');expect(storage.get(key)).toBe(before);
  });
  function open(text: () => Promise<string>, name = 'test.json') {
    const input = new InputStub();
    input.files = [{ name, text }];
    listeners.get('change')!({ target: input });
  }
  function openPair(text:()=>Promise<string>){const input=new InputStub();input.id='pair-file-input';input.files=[{name:'pair.json',text}];listeners.get('change')!({target:input});}
  function pairFixture(){const project=sampleProjectFile();project.name='PAIR_PROJECT_38';project.fx_books=[{id:'ORIGINAL_FX_38',name:'PRIVATE_BOOK_38',type:'CONTRACT',date:'',rates:{'USD/CNY':'7'},extra:{keep:'RAW_METADATA_38'}} as any];const bill=containerBillTemplate('container-bill-synthetic-example');bill.notes='PAIR_BILL_38';return createContainerCostPair(project,bill,{version:'0.1',intents:[]});}
  function pairEdit(field:string,value:string){const input=new InputStub();input.id='';input.dataset={pairEditorField:field};input.value=value;listeners.get('change')!({target:input});}
  function pairEditAction(action:string,line:string){const button=new ElementStub();button.dataset={action,pairLine:line};listeners.get('click')!({target:button});}
  const editorKey='trade-cost-engine:container-cost-editor-v1';
  function copyField(field:string,value:string,checked=false){const input=new InputStub();input.id='';input.dataset={pairCopyField:field};input.value=value;input.checked=checked;listeners.get('change')!({target:input});}
  function reviewField(field:string,value:string){const input=new InputStub();input.id='';input.dataset={pairReviewField:field};input.value=value;listeners.get('change')!({target:input});}
  function reviewAction(action:string,id:string){const button=new ElementStub();button.dataset={action,reviewRecord:id};listeners.get('click')!({target:button});}
  function fillReview(){action('pair-review-start');reviewField('decision','KEEP_RECORDED_AMOUNT');const p=JSON.parse(storage.get('trade-cost-engine:container-cost-pair-v1')!),m=p.mapping.entries[0];reviewField('target',containerReviewTargetKey({kind:'ROW',mapping_id:m.mapping_id,line_id:m.line_id,cost_id:m.cost_id}));reviewField('explanation','PRIVATE_APP_REVIEW44');reviewField('reference','PRIVATE_APP_SOURCE44');reviewField('valid_from','2026-10-01');reviewField('valid_to','2026-10-31');reviewField('checked_on','2026-10-14');}
  function prepareBusinessCopy(name='PRIVATE_NEW_BUSINESS_UI40'){copyField('name',name);copyField('acknowledged','',true);action('pair-copy-prepare');}
  async function openCopySource(){const p=pairFixture();p.bill.rows[0]!.evidence={reference:'合成来源40',valid_from:'2026-10-01',valid_to:'2026-10-31',checked_on:'2026-10-14',status:'USER_CONFIRMED',values_key:'OLD_UI40'};const q=createContainerCostPair(p.project,p.bill,p.selection);openPair(async()=>serializeContainerCostPair(q));await vi.waitFor(()=>expect(html).toContain('PAIR_BILL_38'));return q;}
  it('真实复制表单和另存不改原项目/账单/快照/保存状态，副本新身份与未确认来源',async()=>{await start();const p=await openCopySource(),before=storage.get(key),billBefore=storage.get('trade-cost-engine:container-bill-v1'),pairBefore=storage.get('trade-cost-engine:container-cost-pair-v1');prepareBusinessCopy();expect(html).toContain('已冻结副本');let text='';vi.stubGlobal('window',{showSaveFilePicker:async()=>({createWritable:async()=>({write:async(t:string)=>text=t,close:async()=>{}})})});action('pair-copy-save');await vi.waitFor(()=>expect(text).not.toBe(''));const copied=JSON.parse(text);expect(copied.pair_id).not.toBe(p.pair_id);expect(copied.bill.id).not.toBe(p.bill.id);expect(copied.bill.binding).toBeNull();expect(copied.bill.rows[0].evidence.status).toBe('UNVERIFIED');expect(copied.bill.rows[0].evidence).not.toHaveProperty('values_key');expect(storage.get(key)).toBe(before);expect(storage.get('trade-cost-engine:container-bill-v1')).toBe(billBefore);expect(storage.get('trade-cost-engine:container-cost-pair-v1')).toBe(pairBefore);expect(html).not.toContain('已保存到');});
  it('真实复制接受不跨名称或资料修订，未提交编辑阻断生成',async()=>{await start();const p=await openCopySource();copyField('name','new');copyField('acknowledged','',true);copyField('name','changed');action('pair-copy-prepare');expect(html).not.toContain('data-copy-candidate');copyField('acknowledged','',true);change('name','LIVE_CHANGED40');action('pair-copy-prepare');expect(html).not.toContain('data-copy-candidate');action('pair-capture');action('pair-copy-prepare');expect(html).not.toContain('data-copy-candidate');pairEditAction('pair-editor-start',p.bill.rows[0]!.input.line_id);prepareBusinessCopy();expect(html).not.toContain('data-copy-candidate');expect(html).toContain('未提交编辑');});
  it('副本异步另存冻结生成时内容，双击仅写一次且不把原业务标为副本已保存',async()=>{await start();await openCopySource();prepareBusinessCopy();let finish!:(h:any)=>void,text='';const picker=vi.fn(()=>new Promise(r=>finish=r));vi.stubGlobal('window',{showSaveFilePicker:picker});action('pair-copy-save');action('pair-copy-save');change('name','LIVE_EDIT_DURING_COPY40');finish({name:'new-business.json',createWritable:async()=>({write:async(t:string)=>text=t,close:async()=>{}})});await vi.waitFor(()=>expect(text).not.toBe(''));expect(picker).toHaveBeenCalledOnce();expect(JSON.parse(text).project.name).toBe('PRIVATE_NEW_BUSINESS_UI40');expect(JSON.parse(storage.get(key)!).project.name).toBe('LIVE_EDIT_DURING_COPY40');expect(html).not.toContain('已保存到 new-business.json');});
  it('副本生成后渲染异常原始备份保留原业务与新候选，重试不安装候选',async()=>{await start();const p=await openCopySource();recoveryElements();let blob:Blob|null=null;vi.spyOn(URL,'createObjectURL').mockImplementation(b=>{blob=b as Blob;return 'blob:copy-recovery'});const view=await import('../src/ui/container-cost-pair'),original=view.renderContainerCostPairPanel,fault=vi.spyOn(view,'renderContainerCostPairPanel').mockImplementation(c=>{if(c.copyCandidate)throw Error('PRIVATE_COPY_RENDER40');return original(c);});prepareBusinessCopy();expect(appRoot.hidden).toBe(true);recoveryPanel!.callbacks.get('#recovery-backup')!();const backup=JSON.parse(await blob!.text());expect(backup.container_cost_pair.pair_id).toBe(p.pair_id);expect(backup.container_business_copy.project.name).toBe('PRIVATE_NEW_BUSINESS_UI40');expect(backup.container_business_copy.pair_id).not.toBe(p.pair_id);expect(backup.project.name).toBe(p.project.name);fault.mockRestore();recoveryPanel!.callbacks.get('#recovery-retry')!();expect(appRoot.hidden).toBe(false);expect(html).toContain('data-copy-candidate');expect(JSON.parse(storage.get(key)!).project.name).toBe(p.project.name);});
  it('客户HTML不携带未打开的副本、名称或内部资料',async()=>{await start();await openCopySource();prepareBusinessCopy();await customerProject();customer('reviewed','',true);let text='';vi.stubGlobal('window',{showSaveFilePicker:async()=>({createWritable:async()=>({write:async(t:string)=>text=t,close:async()=>{}})})});action('export-customer-quote');await vi.waitFor(()=>expect(text).not.toBe(''));expect(text).not.toContain('PRIVATE_NEW_BUSINESS_UI40');expect(text).not.toContain('container_business_copy');expect(html).toContain('data-copy-candidate');});
  async function editorFixture(){const p=pairFixture();openPair(async()=>serializeContainerCostPair(p));await vi.waitFor(()=>expect(html.includes('PAIR_BILL_38')).toBe(true));pairEditAction('pair-editor-start',p.bill.rows[0]!.input.line_id);return p;}
  function fillPairEditor(){action('pair-editor-facts');for(const[k,v]of Object.entries({cost_name:'PRIVATE_NEW_UI39',cost_category:'DESTINATION_TERMINAL',trade_node:'DESTINATION_TERMINAL',occurrence_reason:'NORMAL_OPERATION',responsibility:'BUYER',payment_party:'BUYER',economic_bearer:'BUYER',tax_included:'false',customs_value:'EXCLUDE',fx_type:'CONTRACT',basis:'ACCEPT',note:'PRIVATE_ASSUMPTIONS_UI39',reference:'合成合同条款',valid_from:'2026-10-01',valid_to:'2026-10-31',checked_on:'2026-10-14'}))pairEdit(k,v);}
  it('真实编辑事件只提交配对选择，来源独立确认，项目费用与保存状态不变',async()=>{await start();const p=await editorFixture(),before=storage.get(key);fillPairEditor();action('pair-editor-submit');expect(html).toContain('已提交完整提案');let pair=JSON.parse(storage.get('trade-cost-engine:container-cost-pair-v1')!);expect(pair.selection.intents[0].new_cost.amount).toBe('240');expect(pair.selection.intents[0].new_cost.tax_included).toBe(false);expect(pair.selection.intents[0].evidence.status).toBe('UNVERIFIED');pairEditAction('pair-confirm-selection',p.bill.rows[0]!.input.line_id);pair=JSON.parse(storage.get('trade-cost-engine:container-cost-pair-v1')!);expect(pair.selection.intents[0].evidence.status).toBe('USER_CONFIRMED');expect(storage.get(key)).toBe(before);expect(pair.project.items).toEqual(p.project.items);expect(storage.get(editorKey)).toBe('null');});
  it('真实未完成编辑重启保留原值且不能导出旧配对冒充新选择',async()=>{await start();await editorFixture();pairEdit('note','PENDING_RELOAD_UI39');const before=storage.get('trade-cost-engine:container-cost-pair-v1');vi.resetModules();await start();expect(html).toContain('PENDING_RELOAD_UI39');action('pair-save');action('pair-editor-submit');expect(storage.get('trade-cost-engine:container-cost-pair-v1')).toBe(before);expect(JSON.parse(storage.get(editorKey)!).fields.note).toBe('PENDING_RELOAD_UI39');});
  it('真实编辑后改变项目阻断提交，放弃编辑才可捕获新修订',async()=>{await start();await editorFixture();fillPairEditor();const before=storage.get('trade-cost-engine:container-cost-pair-v1');change('name','CHANGED_CONTEXT_UI39');action('pair-editor-submit');action('pair-capture');expect(storage.get('trade-cost-engine:container-cost-pair-v1')).toBe(before);expect(html).toContain('当前修订失配');action('pair-editor-discard');action('pair-capture');expect(JSON.parse(storage.get('trade-cost-engine:container-cost-pair-v1')!).project.name).toBe('CHANGED_CONTEXT_UI39');});
  it('真实客户HTML导出隔离未提交编辑原值与完整选择',async()=>{await start();await editorFixture();fillPairEditor();await customerProject();customer('reviewed','',true);let saved='';vi.stubGlobal('window',{showSaveFilePicker:async()=>({createWritable:async()=>({write:async(t:string)=>saved=t,close:async()=>{}})})});action('export-customer-quote');await vi.waitFor(()=>expect(saved).not.toBe(''));expect(saved).not.toContain('PRIVATE_NEW_UI39');expect(saved).not.toContain('PRIVATE_ASSUMPTIONS_UI39');expect(JSON.parse(storage.get(editorKey)!).fields.cost_name).toBe('PRIVATE_NEW_UI39');});
  it('编辑渲染异常备份保留未完成原值和草稿，重试继续编辑而不提交',async()=>{await start();await editorFixture();recoveryElements();let blob:Blob|null=null;vi.spyOn(URL,'createObjectURL').mockImplementation(b=>{blob=b as Blob;return 'blob:editor-recovery'});const views=await import('../src/ui/views-input'),fault=vi.spyOn(views,'renderFormsRow').mockImplementation(()=>{throw Error('PRIVATE_EDITOR_RENDER')});pairEdit('note','RAW_PENDING_RECOVERY_UI39');expect(appRoot.hidden).toBe(true);expect(recoveryPanel).not.toBeNull();recoveryPanel!.callbacks.get('#recovery-backup')!();const backup=JSON.parse(await blob!.text());expect(backup.container_cost_editor.fields.note).toBe('RAW_PENDING_RECOVERY_UI39');expect(JSON.parse(backup.container_cost_editor_draft_text).fields.note).toBe('RAW_PENDING_RECOVERY_UI39');expect(backup.container_cost_pair.selection.intents).toEqual([]);fault.mockRestore();recoveryPanel!.callbacks.get('#recovery-retry')!();expect(html).toContain('RAW_PENDING_RECOVERY_UI39');expect(appRoot.hidden).toBe(false);expect(JSON.parse(storage.get('trade-cost-engine:container-cost-pair-v1')!).selection.intents).toEqual([]);});
  it('旧项目另存完成不能把后来打开的配对项目标成已保存',async()=>{await start();let resolve!:(handle:any)=>void;let written='';vi.stubGlobal('window',{showSaveFilePicker:()=>new Promise(r=>resolve=r)});save();const p=pairFixture();openPair(async()=>serializeContainerCostPair(p));await vi.waitFor(()=>expect(html.includes('PAIR_BILL_38')).toBe(true));resolve({name:'old-project.json',createWritable:async()=>({write:async(t:string)=>written=t,close:async()=>{}})});await vi.waitFor(()=>expect(written).not.toBe(''));await vi.waitFor(()=>expect(html.includes('本次保存未改变当前文件与保存状态')).toBe(true));expect(html.includes('class="save-state dirty"')).toBe(true);expect(html.includes('old-project.json')).toBe(false);expect(JSON.parse(written).name).not.toBe(p.project.name);expect(JSON.parse(storage.get(key)!).project.name).toBe(p.project.name);});
  it('配对读取期间编辑客户公开字段也取消旧读取，不被安装重置',async()=>{await start();let finish!:(s:string)=>void;openPair(()=>new Promise(r=>finish=r));customer('remarks','KEEP_PUBLIC_EDIT_38');finish(serializeContainerCostPair(pairFixture()));await vi.waitFor(()=>expect(html.includes('正在读取完整配对资料')).toBe(false));expect(html.includes('KEEP_PUBLIC_EDIT_38')).toBe(true);expect(html.includes('PAIR_PROJECT_38')).toBe(false);expect(storage.get('trade-cost-engine:container-cost-pair-v1')).toBeUndefined();});
  it('未完成汇率行不得被配对捕获/另存静默删除，原行留在草稿',async()=>{await start();const p=pairFixture();openPair(async()=>serializeContainerCostPair(p));await vi.waitFor(()=>expect(html.includes('PAIR_BILL_38')).toBe(true));action('add-fx');expect(html.includes('汇率行尚未填写完整')).toBe(true);const before=storage.get('trade-cost-engine:container-cost-pair-v1');action('pair-capture');action('pair-save');expect(storage.get('trade-cost-engine:container-cost-pair-v1')).toBe(before);expect(JSON.parse(storage.get(key)!).fxRows).toHaveLength(2);});
  it('同期间重复汇率行须先核对，配对不以覆盖方式悄悄丢一行',async()=>{const p=pairFixture();const rows=booksToRows(p.project.fx_books);storage.set(key,JSON.stringify({project:p.project,fxRows:[rows[0],{...rows[0],row_id:'duplicate'}]}));storage.set('trade-cost-engine:container-bill-v1',JSON.stringify(p.bill));await start();expect(html.includes('重复币种对')).toBe(false);action('pair-new');expect(html.includes('操作未完成')).toBe(true);expect(storage.get('trade-cost-engine:container-cost-pair-v1')).toBeUndefined();expect(JSON.parse(storage.get(key)!).fxRows).toHaveLength(2);});
  it('配对真实事件同时安装项目/账单，原汇率簿元数据和另存保持',async()=>{await start();const p=pairFixture();openPair(async()=>serializeContainerCostPair(p));await vi.waitFor(()=>expect(html).toContain('PAIR_BILL_38'));expect(html).toContain('PAIR_PROJECT_38');expect(html).toContain('当前项目和账单与已捕获快照一致');let saved='';vi.stubGlobal('window',{showSaveFilePicker:async()=>({createWritable:async()=>({write:async(t:string)=>saved=t,close:async()=>{}})})});action('pair-save');await vi.waitFor(()=>expect(saved).not.toBe(''));expect(JSON.parse(saved)).toEqual(p);expect(JSON.parse(storage.get(key)!).project.fx_books).toEqual(p.project.fx_books);expect(JSON.parse(storage.get('trade-cost-engine:container-bill-v1')!).notes).toBe('PAIR_BILL_38');});
  it('配对汇率行未改时重启保留原簿，实际改率后失配且不自动更新快照',async()=>{await start();const p=pairFixture();openPair(async()=>serializeContainerCostPair(p));await vi.waitFor(()=>expect(html).toContain('PAIR_BILL_38'));vi.resetModules();await start();expect(html).toContain('当前项目和账单与已捕获快照一致');const target=new InputStub();target.id='';target.dataset={fx:'ORIGINAL_FX_38-0',fxField:'rate'};target.value='8';listeners.get('change')!({target});expect(html).toContain('PROJECT_SNAPSHOT_MISMATCH');expect(JSON.parse(storage.get('trade-cost-engine:container-cost-pair-v1')!).project.fx_books).toEqual(p.project.fx_books);});
  it('坏配对与汇率准备失败均不部分替换当前项目或账单',async()=>{await start();const before=storage.get(key);openPair(async()=>'{PRIVATE_BAD');await vi.waitFor(()=>expect(html).toContain('配对读取失败'));expect(storage.get(key)).toBe(before);const fx=await import('../src/ui/fx-rows'),fault=vi.spyOn(fx,'booksToRows').mockImplementation(()=>{throw Error('PRIVATE_FX_PREP');});openPair(async()=>serializeContainerCostPair(pairFixture()));await vi.waitFor(()=>expect(html).toContain('配对读取失败'));expect(storage.get(key)).toBe(before);expect(storage.get('trade-cost-engine:container-bill-v1')).toBeUndefined();expect(html).not.toContain('PRIVATE_FX_PREP');fault.mockRestore();});
  it('项目编辑/新建取消迟到配对，旧文件不能覆盖新输入',async()=>{await start();let finish!:(s:string)=>void;openPair(()=>new Promise(r=>finish=r));action('new-china-blank');finish(serializeContainerCostPair(pairFixture()));await vi.waitFor(()=>expect(html).not.toContain('正在读取完整配对资料'));expect(html).not.toContain('PAIR_PROJECT_38');expect(storage.get('trade-cost-engine:container-cost-pair-v1')).toBeUndefined();});
  it('配对安装后渲染异常隐藏结果，原始备份保留完整两份及配对；重试不丢失',async()=>{await start();const p=pairFixture();recoveryElements();let blob:Blob|null=null;vi.spyOn(URL,'createObjectURL').mockImplementation(b=>{blob=b as Blob;return 'blob:paired-recovery'});const views=await import('../src/ui/views-input'),original=views.renderFormsRow,fault=vi.spyOn(views,'renderFormsRow').mockImplementation(project=>{if(project.name==='PAIR_PROJECT_38')throw Error('PRIVATE_RENDER_PAIR');return original(project);});openPair(async()=>serializeContainerCostPair(p));await vi.waitFor(()=>expect(recoveryPanel).not.toBeNull());recoveryPanel!.callbacks.get('#recovery-backup')!();const backup=JSON.parse(await blob!.text());expect(backup.project).toEqual(p.project);expect(backup.container_bill).toEqual(p.bill);expect(backup.container_cost_pair).toEqual(p);fault.mockRestore();recoveryPanel!.callbacks.get('#recovery-retry')!();expect(html).toContain('PAIR_BILL_38');expect(html).toContain('PAIR_PROJECT_38');expect(appRoot.hidden).toBe(false);});
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
  function action(name: string, index?: number) {
    const button = new ElementStub(); button.dataset.action = name;if(index!==undefined)button.dataset.settlementIndex=String(index); listeners.get('click')!({ target: button });
  }
  function downloadExample(kind:string) {const button=new ElementStub();button.dataset.action='download-funding-example';button.dataset.exampleKind=kind;listeners.get('click')!({target:button});}
  function downloadRoundingExample(kind:string){const button=new ElementStub();button.dataset.action='download-rounding-example';button.dataset.roundingKind=kind;listeners.get('click')!({target:button});}
  function billField(field:string,value:string,row?:number){const e=new InputStub();e.dataset={billField:field,...(row===undefined?{}:{billRow:String(row)})};e.value=value;listeners.get('change')!({target:e});}
  function billAction(name:string,row=0){const b=new ElementStub();b.dataset={action:name,billRow:String(row)};listeners.get('click')!({target:b});}
  function billOpen(text:()=>Promise<string>){const e=new InputStub();e.id='bill-file-input';e.files=[{name:'bill.json',text}];listeners.get('change')!({target:e});}
  it('真实账单事件新建/示例/编辑保存，项目JSON及客户确认不被账单改写',async()=>{
    await start();const before=storage.get(key);billAction('bill-example');billField('notes','PRIVATE_UI_BILL_EVENT');expect(html).toContain('PRIVATE_UI_BILL_EVENT');expect(storage.get(key)).toBe(before);const captures:string[]=[];vi.stubGlobal('window',{showSaveFilePicker:async()=>({name:'bill.json',createWritable:async()=>({write:async(s:string)=>captures.push(s),close:async()=>{}})})});billAction('bill-save');await vi.waitFor(()=>expect(captures).toHaveLength(1));expect(JSON.parse(captures[0]!).kind).toBe('INTERNAL_CONTAINER_BILL');expect(JSON.parse(storage.get(key)!).project).not.toHaveProperty('container_bill');
  });
  it('真实账单文件事件拒绝坏/未来文件，编辑取消迟到读取',async()=>{
    await start();billAction('bill-example');billField('name','KEPT');billOpen(async()=>JSON.stringify({kind:'INTERNAL_CONTAINER_BILL',version:'future'}));await vi.waitFor(()=>expect(html).toContain('账单读取失败'));expect(html).toContain('KEPT');let finish!:(v:string)=>void;billOpen(()=>new Promise(r=>finish=r));billField('name','AFTER_READ');finish('{}');await Promise.resolve();expect(html).toContain('AFTER_READ');expect(html).not.toContain('账单读取失败');
  });
  it('真实账单失败保存不泄露私有路径，取消仍保留输入',async()=>{
    await start();billAction('bill-example');vi.stubGlobal('window',{showSaveFilePicker:async()=>{throw Error('PRIVATE_BILL_PATH')}});billAction('bill-save');await vi.waitFor(()=>expect(html).toContain('账单保存失败'));expect(html).not.toContain('PRIVATE_BILL_PATH');vi.stubGlobal('window',{showSaveFilePicker:async()=>{throw new DOMException('cancel','AbortError')}});billAction('bill-save');await vi.waitFor(()=>expect(html).toContain('已取消账单保存'));expect(html).toContain('synthetic-dd-1');
  });
  it('打开新项目保留账单，刷新读取独立草稿且不嵌入项目',async()=>{
    await start();billAction('bill-example');billField('notes','PRIVATE_BILL_KEEP');action('new-china-import');expect(html).toContain('PRIVATE_BILL_KEEP');expect(html).toContain('当前项目已变更');expect(JSON.parse(storage.get(key)!).project).not.toHaveProperty('container_bill');
  });
  it('账单条件渲染失败进入原始恢复，备份保存账单及独立草稿，重试保留编辑',async()=>{
    await start();billAction('bill-example');recoveryElements();const setter=Object.getOwnPropertyDescriptor(appRoot,'innerHTML')!.set!;let fail=true;Object.defineProperty(appRoot,'innerHTML',{get:()=>html,set:(v:string)=>{if(fail){fail=false;throw Error('PRIVATE_RENDER_BILL');}setter.call(appRoot,v)}});billField('notes','RAW_BILL_RECOVERY');expect(recoveryPanel).not.toBeNull();let blob:Blob|null=null;vi.stubGlobal('URL',{createObjectURL:(b:Blob)=>{blob=b;return 'blob:backup'},revokeObjectURL:()=>{}});recoveryPanel!.callbacks.get('#recovery-backup')!();const raw=JSON.parse(await blob!.text());expect(raw.container_bill.notes).toBe('RAW_BILL_RECOVERY');expect(JSON.parse(raw.container_bill_draft_text).notes).toBe('RAW_BILL_RECOVERY');recoveryPanel!.callbacks.get('#recovery-retry')!();expect(html).toContain('RAW_BILL_RECOVERY');expect(appRoot.hidden).toBe(false);
  });
  it('舍入四资源不读取或替换当前交易/付款/客户/草稿，独立文件名和类型正确',async()=>{
    await start();await customerProject();change('name','PRIVATE_PROJECT_ROUND_CASE_143');customer('remarks','PRIVATE_CLIENT_ROUND_CASE_144');customer('reviewed','',true);action('settlement-create');fundingInputs();settlement('notes','PRIVATE_PLAN_ROUND_CASE_145');const before=storage.get(key),captures:{name:string;mime:string;text:string}[]=[];
    vi.stubGlobal('window',{showSaveFilePicker:async(o:{suggestedName:string;types:{accept:Record<string,string[]>}[]})=>{const result={name:o.suggestedName,mime:Object.keys(o.types[0]!.accept)[0]!,text:''};captures.push(result);return{name:o.suggestedName,createWritable:async()=>({write:async(s:string)=>{result.text=s},close:async()=>{}})};}});
    for(const kind of['project','plan','record','guide']){downloadRoundingExample(kind);await vi.waitFor(()=>expect(captures.at(-1)!.text).not.toBe(''));}
    expect(captures).toHaveLength(4);for(const c of captures){expect(c.name).toContain('synthetic-rounding-example.');expect(c.text).not.toMatch(/PRIVATE_(PROJECT|CLIENT|PLAN)_ROUND_CASE/);}expect(captures[3]!.mime).toBe('text/html');expect(JSON.parse(captures[1]!.text)).toMatchObject({version:'1.4',funding:{rounding:{intervals_confirmed:false}}});expect(JSON.parse(captures[2]!.text).expected.rounded_cost).toBe('0.02');expect(storage.get(key)).toBe(before);expect(html).toContain('PRIVATE_PLAN_ROUND_CASE_145');expect(html).toContain('data-customer-field="reviewed" checked');
  });
  it('舍入案例选择器前固定内容，与旧案例/模板共用忙碌保护',async()=>{
    await start();await customerProject();let finish!:(h:unknown)=>void,saved='';const picker=vi.fn(()=>new Promise(r=>{finish=r}));vi.stubGlobal('window',{showSaveFilePicker:picker});downloadRoundingExample('project');downloadExample('plan');downloadRoundingExample('plan');expect(picker).toHaveBeenCalledOnce();expect(html).toContain('data-rounding-kind="plan" disabled');expect(html).toContain('data-example-kind="plan" disabled');change('name','LATER_PRIVATE_ROUND_CASE_146');const before=storage.get(key);finish({name:'case.project.json',createWritable:async()=>({write:async(s:string)=>{saved=s},close:async()=>{}})});await vi.waitFor(()=>expect(saved).not.toBe(''));expect(saved).not.toContain('LATER_PRIVATE_ROUND_CASE_146');expect(storage.get(key)).toBe(before);expect(html).toContain('LATER_PRIVATE_ROUND_CASE_146');
  });
  it('舍入案例取消/失败/未知资源保留输入，不展示私有文件路径或回退旧案例',async()=>{
    await start();const before=storage.get(key);vi.stubGlobal('window',{showSaveFilePicker:async()=>{throw new DOMException('cancel','AbortError')}});downloadRoundingExample('plan');await vi.waitFor(()=>expect(html).toContain('已取消合成案例文件导出'));vi.stubGlobal('window',{showSaveFilePicker:async()=>({name:'guide.html',createWritable:async()=>({write:async()=>{throw Error('PRIVATE_PATH_ROUND_CASE_147')},close:async()=>{}})})});downloadRoundingExample('guide');await vi.waitFor(()=>expect(html).toContain('合成案例文件导出失败'));expect(html).not.toContain('PRIVATE_PATH_ROUND_CASE_147');expect(createElement).not.toHaveBeenCalled();downloadRoundingExample('../private');await vi.waitFor(()=>expect(html).toContain('合成案例文件导出失败'));expect(storage.get(key)).toBe(before);
  });
  it('舍入离线说明通过Blob下载保留HTML类型和内容，不标记项目已保存',async()=>{
    await start();let blob:Blob|null=null,anchor:{download?:string;href?:string;click:()=>void}|null=null;const click=vi.fn();createElement.mockImplementation(()=>{anchor={click};return anchor});vi.spyOn(URL,'createObjectURL').mockImplementation(b=>{blob=b as Blob;return 'blob:rounding-example'});vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});const before=storage.get(key);downloadRoundingExample('guide');await vi.waitFor(()=>expect(html).toContain('已发起合成案例文件下载'));expect(blob!.type).toBe('text/html');expect(anchor!.download).toBe('synthetic-rounding-example.guide.html');expect(await blob!.text()).toContain('合成舍入手算案例');expect(click).toHaveBeenCalledOnce();expect(storage.get(key)).toBe(before);
  });
  it('案例四资源不读取或替换私有项目/付款/客户/草稿，文件类型和预期值正确',async()=>{
    await start();await customerProject();change('name','PRIVATE_PROJECT_EXAMPLE_916');customer('remarks','PRIVATE_CLIENT_EXAMPLE_717');customer('reviewed','',true);action('settlement-create');fundingInputs();settlement('notes','PRIVATE_PLAN_EXAMPLE_819');const before=storage.get(key),captures:{name:string;mime:string;text:string}[]=[];
    vi.stubGlobal('window',{showSaveFilePicker:async(o:{suggestedName:string;types:{accept:Record<string,string[]>}[]})=>{const result={name:o.suggestedName,mime:Object.keys(o.types[0]!.accept)[0]!,text:''};captures.push(result);return{name:o.suggestedName,createWritable:async()=>({write:async(s:string)=>{result.text=s},close:async()=>{}})};}});
    for(const kind of ['project','plan','record','guide']){downloadExample(kind);await vi.waitFor(()=>expect(html).toContain('已导出合成案例文件'));await vi.waitFor(()=>expect(captures.at(-1)!.text).not.toBe(''));}
    expect(captures).toHaveLength(4);for(const c of captures)expect(c.text).not.toMatch(/PRIVATE_(PROJECT|CLIENT|PLAN)_EXAMPLE/);expect(captures[3]!.mime).toBe('text/html');expect(captures[3]!.name).toContain('.guide.html');expect(JSON.parse(captures[2]!.text).expected.cost).toBe('50');expect(storage.get(key)).toBe(before);expect(html).toContain('PRIVATE_PLAN_EXAMPLE_819');expect(html).toContain('data-customer-field="reviewed" checked');
  });
  it('案例文件在选择器前固定，共用资源忙碌保护，后续编辑不混入输出',async()=>{
    await start();await customerProject();let finish!:(h:unknown)=>void,saved='';const picker=vi.fn(()=>new Promise(r=>{finish=r}));vi.stubGlobal('window',{showSaveFilePicker:picker});downloadExample('project');downloadExample('plan');expect(picker).toHaveBeenCalledOnce();expect(html).toContain('data-example-kind="plan" disabled');change('name','LATER_PRIVATE_CASE_719');const before=storage.get(key);finish({name:'case.project.json',createWritable:async()=>({write:async(s:string)=>{saved=s},close:async()=>{}})});await vi.waitFor(()=>expect(saved).not.toBe(''));expect(saved).not.toContain('LATER_PRIVATE_CASE_719');expect(storage.get(key)).toBe(before);expect(html).toContain('LATER_PRIVATE_CASE_719');
  });
  it('案例取消/写入失败/未知类型不导入、不回退下载，原项目保留',async()=>{
    await start();const before=storage.get(key);vi.stubGlobal('window',{showSaveFilePicker:async()=>{throw new DOMException('cancel','AbortError')}});downloadExample('plan');await vi.waitFor(()=>expect(html).toContain('已取消合成案例文件导出'));vi.stubGlobal('window',{showSaveFilePicker:async()=>({name:'guide.html',createWritable:async()=>({write:async()=>{throw Error('PRIVATE_FILE_PATH_827')},close:async()=>{}})})});downloadExample('guide');await vi.waitFor(()=>expect(html).toContain('合成案例文件导出失败'));expect(html).not.toContain('PRIVATE_FILE_PATH_827');expect(createElement).not.toHaveBeenCalled();downloadExample('../secret');await vi.waitFor(()=>expect(html).toContain('合成案例文件导出失败'));expect(storage.get(key)).toBe(before);
  });
  it('无选择器时真实Blob下载保留MIME和独立内容，不改保存状态或草稿',async()=>{
    await start();let blob:Blob|null=null,anchor:{download?:string;href?:string;click:()=>void}|null=null;const click=vi.fn();createElement.mockImplementation(()=>{anchor={click};return anchor});vi.spyOn(URL,'createObjectURL').mockImplementation(b=>{blob=b as Blob;return 'blob:example'});vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});const before=storage.get(key);downloadExample('guide');await vi.waitFor(()=>expect(html).toContain('已发起合成案例文件下载'));expect(blob!.type).toBe('text/html');expect(anchor!.download).toContain('.guide.html');expect(await blob!.text()).toContain('合成手算案例');expect(click).toHaveBeenCalledOnce();expect(storage.get(key)).toBe(before);
  });
  function settlement(field:string,value:string,row?:'payment'|'fee'|'funding'|'funding-event'|'funding-rate'|'funding-rounding'|'funding-period'|'funding-period-schedule',index=0,checked=false){
    const input=new InputStub();input.id='';input.dataset.settlementField=field;input.value=value;input.checked=checked;
    if(row){input.dataset.settlementRow=row;input.dataset.settlementIndex=String(index);}listeners.get('change')!({target:input});
  }
  function openSettlement(text:()=>Promise<string>){const input=new InputStub();input.id='settlement-file-input';input.files=[{name:'payment.json',text}];listeners.get('change')!({target:input});}
  function inspectRecovery(text:()=>Promise<string>,size=1000) { const input=new InputStub();input.id='recovery-review-input';input.files=[{name:'recovery.json',text,size}];listeners.get('change')!({target:input}); }
  function minimalRecovery() { return JSON.stringify({kind:'INTERNAL_RECOVERY_SNAPSHOT',version:'1.0',stage:'RENDER',project:null,fx_rows:null,settlement_plan:null,sensitivity:null,customer_fields:null,browser_draft_text:null}); }
  it('恢复检查不改交易、草稿、付款备注或客户确认，原始内容不展示',async()=>{
    await start();await customerProject();customer('reviewed','',true);action('settlement-create');settlement('notes','CURRENT_PLAN_718');const before=storage.get(key);
    const value=JSON.parse(minimalRecovery());value.project=sampleProjectFile();value.project.name='PRIVATE_RECOVERY_911';value.fx_rows=[];inspectRecovery(async()=>JSON.stringify(value));
    await vi.waitFor(()=>expect(html).toContain('data-recovery-review-result'));expect(html).not.toContain('PRIVATE_RECOVERY_911');expect(html).toContain('CURRENT_PLAN_718');expect(html).toContain('data-customer-field="reviewed" checked');expect(storage.get(key)).toBe(before);
    action('clear-recovery-review');expect(html).not.toContain('data-recovery-review-result');expect(storage.get(key)).toBe(before);
  });
  it('恢复检查的新选择或清空撤销慢文件读取；坏文件不能沿用旧成功结果',async()=>{
    await start();let finish!:(s:string)=>void;inspectRecovery(()=>new Promise(r=>{finish=r}));inspectRecovery(async()=>'{}');await vi.waitFor(()=>expect(html).toContain('请选择内部恢复备份'));finish(minimalRecovery());await Promise.resolve();await Promise.resolve();expect(html).not.toContain('data-recovery-review-result');
    inspectRecovery(async()=>minimalRecovery());await vi.waitFor(()=>expect(html).toContain('data-recovery-review-result'));inspectRecovery(()=>new Promise(r=>{finish=r}));action('clear-recovery-review');finish(minimalRecovery());await Promise.resolve();await Promise.resolve();expect(html).not.toContain('data-recovery-review-result');expect(html).not.toContain('正在本机读取');
  });
  it('过大文件不调用读取，读取异常不泄露私有路径；选择错误格式不触发项目导入',async()=>{
    await start();const before=storage.get(key);const read=vi.fn(async()=>minimalRecovery());inspectRecovery(read,5*1024*1024+1);await vi.waitFor(()=>expect(html).toContain('超过5 MiB'));expect(read).not.toHaveBeenCalled();
    inspectRecovery(async()=>{throw Error('PRIVATE_PATH_916')});await vi.waitFor(()=>expect(html).toContain('恢复文件读取失败'));expect(html).not.toContain('PRIVATE_PATH_916');
    inspectRecovery(async()=>serializeProject(sampleProjectFile()));await vi.waitFor(()=>expect(html).toContain('请选择内部恢复备份'));expect(storage.get(key)).toBe(before);
  });
  it('恢复界面出现后丢弃慢检查完成，重试不重新显示过期检查',async()=>{
    await start();let finish!:(s:string)=>void;inspectRecovery(()=>new Promise(r=>{finish=r}));recoveryElements();const views=await import('../src/ui/views-input');const fault=vi.spyOn(views,'renderFormsRow').mockImplementation(()=>{throw Error('fault')});
    action('settlement-create');expect(recoveryPanel).not.toBeNull();finish(minimalRecovery());await Promise.resolve();await Promise.resolve();fault.mockRestore();recoveryPanel!.callbacks.get('#recovery-retry')!();expect(html).not.toContain('data-recovery-review-result');expect(html).not.toContain('正在本机读取');
  });
  it('普通输入错误提供真实关联面板入口，修正后清除错误入口',async()=>{
    await start();change('goods.quantity','');expect(html).toContain('data-action="locate-input"');expect(html).toContain('data-input-section="goods"');expect(html).toContain('data-input-section="contract"');
    change('goods.quantity','100');expect(html).not.toContain('data-action="locate-input"');
  });
  function recoveryElements(download?:()=>void) {
    createElement.mockImplementation((tag:string)=>tag==='section'?new RecoveryPanelStub():{click:download??(()=>{}),href:'',download:''});
    vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:recovery');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
  }
  it('渲染异常隐藏旧结果，恢复备份包含当前资金/付款/汇率和客户输入，重试不写草稿',async()=>{
    await start();await customerProject();action('settlement-create');fundingInputs();customer('remarks','PRIVATE_CUSTOMER_RECOVERY_748');
    const original=storage.get(key);let blob:Blob|null=null;recoveryElements();vi.spyOn(URL,'createObjectURL').mockImplementation(data=>{blob=data as Blob;return 'blob:recovery'});
    const views=await import('../src/ui/views-input');const fault=vi.spyOn(views,'renderFormsRow').mockImplementation(()=>{throw Error('PRIVATE_EXCEPTION_884<script>')});
    settlement('notes','KEEP_PLAN_RECOVERY_911');expect(appRoot.hidden).toBe(true);expect(recoveryPanel!.innerHTML).toContain('界面暂时无法显示');expect(recoveryPanel!.innerHTML).not.toContain('PRIVATE_EXCEPTION_884');
    recoveryPanel!.callbacks.get('#recovery-backup')!();const backup=JSON.parse(await blob!.text());expect(backup).toMatchObject({kind:'INTERNAL_RECOVERY_SNAPSHOT',stage:'RENDER',settlement_plan:{notes:'KEEP_PLAN_RECOVERY_911',funding:{principal:'12000'}},customer_fields:{remarks:'PRIVATE_CUSTOMER_RECOVERY_748'}});expect(backup.fx_rows).toBeInstanceOf(Array);expect(storage.get(key)).toBe(original);
    fault.mockRestore();recoveryPanel!.callbacks.get('#recovery-retry')!();expect(appRoot.hidden).toBe(false);expect(recoveryPanel).toBeNull();expect(html).toContain('KEEP_PLAN_RECOVERY_911');expect(html).toContain('60 USD');expect(storage.get(key)).toBe(original);
  });
  it('计算意外异常不能被伪装为输入错误，不保存失败计算或显示旧结果',async()=>{
    recoveryElements();const project=sampleProjectFile(),raw=JSON.stringify({project,fxRows:booksToRows(project.fx_books)});storage.set(key,raw);
    const engine=await import('../src/engine/analyze');const fault=vi.spyOn(engine,'analyze').mockImplementationOnce(()=>{throw Error('PRIVATE_ENGINE_RUNTIME_836')});
    await start();expect(appRoot.hidden).toBe(true);expect(storage.get(key)).toBe(raw);expect(recoveryPanel!.innerHTML).not.toContain('PRIVATE_ENGINE_RUNTIME_836');fault.mockRestore();recoveryPanel!.callbacks.get('#recovery-retry')!();expect(appRoot.hidden).toBe(false);expect(storage.get(key)).toBe(raw);
  });
  it('启动准备失败仍可备份原始坏草稿，重试保留原文和恢复失败提示',async()=>{
    recoveryElements();const raw='broken PRIVATE_DRAFT_START_716';storage.set(key,raw);let blob:Blob|null=null;vi.spyOn(URL,'createObjectURL').mockImplementation(data=>{blob=data as Blob;return 'blob:recovery'});
    const samples=await import('../src/data/sample-project');vi.spyOn(samples,'sampleProjectFile').mockImplementationOnce(()=>{throw Error('PRIVATE_START_EXCEPTION_671')});
    await start();expect(appRoot.hidden).toBe(true);expect(recoveryPanel!.innerHTML).toContain('启动');recoveryPanel!.callbacks.get('#recovery-backup')!();const backup=JSON.parse(await blob!.text());expect(backup.project).toBeNull();expect(backup.browser_draft_text).toBe(raw);
    recoveryPanel!.callbacks.get('#recovery-retry')!();expect(appRoot.hidden).toBe(false);expect(html).toContain('上次的草稿无法读取');expect(storage.get(key)).toBe(raw);
  });
  it('事件异常进入恢复面板，失败期间停止旧界面操作，备份下载失败不清除输入',async()=>{
    await start();const before=storage.get(key);recoveryElements(()=>{throw Error('blocked download')});
    const presets=await import('../src/data/cost-presets');vi.spyOn(presets,'customCostItem').mockImplementationOnce(()=>{throw Error('runtime fault')});action('add-custom');expect(recoveryPanel!.innerHTML).toContain('操作处理');expect(appRoot.hidden).toBe(true);
    action('new-china-blank');expect(storage.get(key)).toBe(before);recoveryPanel!.callbacks.get('#recovery-backup')!();expect(recoveryPanel!.innerHTML).toContain('恢复备份下载失败');expect(storage.get(key)).toBe(before);recoveryPanel!.callbacks.get('#recovery-retry')!();expect(appRoot.hidden).toBe(false);
  });
  it('重复重试不重复绑定事件，未完成输入仍可改正，存储禁用不阻断内存备份',async()=>{
    await start();recoveryElements();const views=await import('../src/ui/views-input');const fault=vi.spyOn(views,'renderFormsRow').mockImplementation(()=>{throw Error('view fault')});change('goods.quantity','');
    const handlers=new Map(listeners);recoveryPanel!.callbacks.get('#recovery-retry')!();expect(recoveryPanel).not.toBeNull();fault.mockRestore();recoveryPanel!.callbacks.get('#recovery-retry')!();expect(listeners).toEqual(handlers);expect(html).toContain('留空不等于零');
    vi.spyOn(views,'renderFormsRow').mockImplementation(()=>{throw Error('view fault')});change('goods.quantity','100');vi.stubGlobal('localStorage',{getItem:()=>{throw Error('denied')},setItem:()=>{throw Error('denied')}});let blob:Blob|null=null;vi.spyOn(URL,'createObjectURL').mockImplementation(data=>{blob=data as Blob;return 'blob:recovery'});recoveryPanel!.callbacks.get('#recovery-backup')!();expect(JSON.parse(await blob!.text()).project.goods.quantity).toBe('100');expect(JSON.parse(await blob!.text()).browser_draft_text).toBeNull();
  });
  it('项目保存准备失败被捕获，不调用文件选择器或触发额外下载',async()=>{
    await start();const before=storage.get(key),picker=vi.fn();vi.stubGlobal('window',{showSaveFilePicker:picker});const file=await import('../src/data/project-file');vi.spyOn(file,'serializeProject').mockImplementationOnce(()=>{throw Error('prepare failed')});
    save();await vi.waitFor(()=>expect(html).toContain('保存失败'));expect(picker).not.toHaveBeenCalled();expect(createElement).not.toHaveBeenCalled();expect(storage.get(key)).toBe(before);expect(appRoot.hidden).toBe(false);
  });
  function fundingInputs() {
    for (const [key,value] of Object.entries({status:'PROVIDED',kind:'OPPORTUNITY',party:'SELLER',principal:'12000',currency:'USD',start_date:'2026-09-01',end_date:'2026-10-01',annual_rate:'6',day_basis:'ACT_360',reference:'PRIVATE_FUNDING_UI_981'})) settlement(key,value,'funding');
  }
  function ledgerInputs() {
    action('settlement-enable-ledger');settlement('status','PROVIDED','funding');
    for(const [index,values]of [{direction:'DECREASE',amount:'4000',currency:'USD',date:'2026-09-11',reference:'PRIVATE_EVENT_UI_817'},{direction:'INCREASE',amount:'2000',currency:'USD',date:'2026-09-21',reference:'PRIVATE_EVENT_UI_818'}].entries()) {
      action('settlement-add-funding-event');for(const [key,value]of Object.entries(values))settlement(key,value,'funding-event',index);
    }
  }
  function rateInputs(){action('settlement-enable-rates');action('settlement-add-rate-event');settlement('date','2026-09-11','funding-rate');settlement('annual_rate','9','funding-rate');settlement('reference','PRIVATE_RATE_UI_993','funding-rate');settlement('status','PROVIDED','funding');}
  function roundingInputs(){action('settlement-enable-rounding');for(const[key,value]of Object.entries({scope:'TOTAL',mode:'HALF_UP',unit:'0.01',reference:'PRIVATE_ROUND_UI_1014',status:'APPLIED'}))settlement(key,value,'funding-rounding');settlement('status','PROVIDED','funding');}
  function periodInputs(upgrade=true){
    if(upgrade)action('settlement-enable-periods');action('settlement-add-period');
    for(const[key,value]of Object.entries({start_date:'2026-09-01',end_date:'2026-10-01',reference:'PRIVATE_PERIOD_UI_1015'}))settlement(key,value,'funding-period');
    settlement('status','PROVIDED','funding-period-schedule');settlement('reference','PRIVATE_SCHEDULE_UI_1015','funding-period-schedule');settlement('status','PROVIDED','funding');settlement('scope','PERIODS','funding-rounding');settlement('status','APPLIED','funding-rounding');settlement('periods_confirmed','','funding-period-schedule',0,true);
  }
  it('1.5显式启用、空表、独立确认及归集结果，不改草稿/客户确认',async()=>{
    await start();await customerProject();customer('reviewed','',true);action('settlement-create');fundingInputs();ledgerInputs();rateInputs();roundingInputs();const before=storage.get(key);action('settlement-enable-periods');expect(html).not.toContain('data-funding-result');expect(html).toContain('PRIVATE_ROUND_UI_1014');expect(html).toContain('data-funding-period-controls');expect(html).not.toContain('data-settlement-row="funding-period"');periodInputs(false);expect(html).toContain('期间舍入假设金额：65.00 USD');expect(html).toContain('65 USD');expect(html).toContain('原计算段 1');expect(storage.get(key)).toBe(before);expect(html).toContain('data-customer-field="reviewed" checked');
  });
  it('资金/事件/期间/舍入编辑及增删撤销1.5确认，慢读取不得覆盖新输入',async()=>{
    await start();await customerProject();action('settlement-create');fundingInputs();ledgerInputs();rateInputs();roundingInputs();periodInputs();const before=storage.get(key);
    for(const row of ['funding','funding-event','funding-rate','funding-period','funding-period-schedule','funding-rounding'] as const){settlement('reference','CHANGED_'+row,row);expect(html).not.toContain('data-settlement-field="periods_confirmed" checked');settlement('status','APPLIED','funding-rounding');settlement('periods_confirmed','','funding-period-schedule',0,true);expect(html).toContain('data-funding-periods');}
    settlement('unit','0.05','funding-rounding');expect(html).not.toContain('data-funding-result');settlement('status','APPLIED','funding-rounding');settlement('periods_confirmed','','funding-period-schedule',0,true);
    action('settlement-add-period');action('settlement-remove-period',1);expect(html).not.toContain('data-settlement-field="periods_confirmed" checked');settlement('periods_confirmed','','funding-period-schedule',0,true);
    let finish!:(s:string)=>void;openSettlement(()=>new Promise(r=>{finish=r}));settlement('reference','KEEP_AFTER_SLOW_PERIOD_1015','funding-period');finish('{}');await Promise.resolve();await Promise.resolve();expect(html).toContain('KEEP_AFTER_SLOW_PERIOD_1015');expect(html).not.toContain('不是受支持');expect(storage.get(key)).toBe(before);
    settlement('periods_confirmed','','funding-period-schedule',0,true);action('settlement-rebind');expect(html).not.toContain('data-funding-result');expect(html).not.toContain('data-settlement-field="periods_confirmed" checked');
  });
  it('1.5JSON/XLSX选择器前冻结期表与确认，写入失败及取消不改输入或泄露路径',async()=>{
    await start();await customerProject();action('settlement-create');fundingInputs();ledgerInputs();rateInputs();roundingInputs();periodInputs();const before=storage.get(key);let finish!:(h:unknown)=>void,saved='';vi.stubGlobal('window',{showSaveFilePicker:()=>new Promise(r=>{finish=r})});action('settlement-save');settlement('reference','AFTER_PERIOD_JSON_1015','funding-period');finish({name:'plan.json',createWritable:async()=>({write:async(s:string)=>{saved=s},close:async()=>{}})});await vi.waitFor(()=>expect(saved).not.toBe(''));expect(JSON.parse(saved)).toMatchObject({version:'1.5',funding:{period_schedule:{periods_confirmed:true,periods:[{reference:'PRIVATE_PERIOD_UI_1015'}]}}});
    settlement('periods_confirmed','','funding-period-schedule',0,true);let blob:Blob|null=null;vi.stubGlobal('window',{showSaveFilePicker:()=>new Promise(r=>{finish=r})});action('export-internal-xlsx');settlement('reference','AFTER_PERIOD_XLSX_1015','funding-period');finish({name:'periods.xlsx',createWritable:async()=>({write:async(b:Blob)=>{blob=b},close:async()=>{}})});await vi.waitFor(()=>expect(blob).not.toBeNull());const{unzipSync,strFromU8}=await import('fflate');const text=Object.values(unzipSync(new Uint8Array(await blob!.arrayBuffer()))).map(b=>strFromU8(b)).join('\n');expect(text).toContain('AFTER_PERIOD_JSON_1015');expect(text).not.toContain('AFTER_PERIOD_XLSX_1015');expect(text).toContain('原段交集');
    vi.stubGlobal('window',{showSaveFilePicker:async()=>{throw new DOMException('cancel','AbortError')}});action('settlement-save');await vi.waitFor(()=>expect(html).toContain('已取消'));vi.stubGlobal('window',{showSaveFilePicker:async()=>({name:'bad.json',createWritable:async()=>({write:async()=>{throw Error('PRIVATE_PATH_PERIOD_1015')},close:async()=>{}})})});action('settlement-save');await vi.waitFor(()=>expect(html).toContain('保存失败'));expect(html).not.toContain('PRIVATE_PATH_PERIOD_1015');expect(html).toContain('AFTER_PERIOD_XLSX_1015');expect(storage.get(key)).toBe(before);
  });
  it('1.5手动备份、重试和只读检查保留原输入/确认；旧重名期间扩展拒绝升级',async()=>{
    await start();await customerProject();action('settlement-create');fundingInputs();ledgerInputs();rateInputs();roundingInputs();periodInputs();const before=storage.get(key);let blob:Blob|null=null;recoveryElements();vi.spyOn(URL,'createObjectURL').mockImplementation(b=>{blob=b as Blob;return 'blob:period-recovery'});const views=await import('../src/ui/views-input'),fault=vi.spyOn(views,'renderFormsRow').mockImplementation(()=>{throw Error('fault')});settlement('reference','KEEP_RECOVERY_PERIOD_1015','funding-period');recoveryPanel!.callbacks.get('#recovery-backup')!();const raw=JSON.parse(await blob!.text());expect(raw.settlement_plan).toMatchObject({version:'1.5',funding:{period_schedule:{periods_confirmed:false,periods:[{reference:'KEEP_RECOVERY_PERIOD_1015'}]}}});fault.mockRestore();recoveryPanel!.callbacks.get('#recovery-retry')!();expect(html).toContain('KEEP_RECOVERY_PERIOD_1015');settlement('periods_confirmed','','funding-period-schedule',0,true);expect(html).toContain('期间舍入假设金额：65.00 USD');inspectRecovery(async()=>JSON.stringify(raw));await vi.waitFor(()=>expect(html).toContain('data-recovery-review-result'));expect(storage.get(key)).toBe(before);
    const old=raw.settlement_plan;old.version='1.4';old.funding.rounding.scope='TOTAL';old.funding.period_schedule='PRIVATE_LEGACY_PERIOD_1015';openSettlement(async()=>JSON.stringify(old));await vi.waitFor(()=>expect(html).toContain('启用明确计息'));action('settlement-enable-periods');expect(html).toContain('重名');expect(html).not.toContain('data-funding-period-controls');
  });
  it('1.4显式启用和舍入层级切换重确认，不改项目或客户状态',async()=>{
    await start();await customerProject();customer('reviewed','',true);action('settlement-create');fundingInputs();ledgerInputs();rateInputs();const before=storage.get(key);action('settlement-enable-rounding');expect(html).not.toContain('data-funding-result');expect(html).toContain('PRIVATE_RATE_UI_993');for(const[key,value]of Object.entries({scope:'TOTAL',mode:'HALF_UP',unit:'0.01',reference:'PRIVATE_ROUND_UI_1014',status:'APPLIED'}))settlement(key,value,'funding-rounding');settlement('status','PROVIDED','funding');expect(html).toContain('舍入假设金额：65.00 USD');expect(html).toContain('65 USD');
    settlement('scope','INTERVALS','funding-rounding');expect(html).not.toContain('data-funding-result');settlement('status','APPLIED','funding-rounding');expect(html).toContain('确认计算区间');settlement('intervals_confirmed','','funding-rounding',0,true);expect(html).toContain('舍入假设金额：65.00 USD');settlement('unit','','funding-rounding');expect(html).not.toContain('data-funding-result');settlement('status','NOT_APPLIED','funding-rounding');expect(html).toContain('65 USD');expect(html).not.toContain('data-funding-rounding open');expect(storage.get(key)).toBe(before);expect(html).toContain('data-customer-field="reviewed" checked');
  });
  it('改起止日/模型/事件日期或增删事件使逐区间确认失效，编辑取消慢读取',async()=>{
    await start();await customerProject();action('settlement-create');fundingInputs();ledgerInputs();rateInputs();roundingInputs();settlement('scope','INTERVALS','funding-rounding');settlement('status','APPLIED','funding-rounding');settlement('intervals_confirmed','','funding-rounding',0,true);expect(html).toContain('data-rounded-cost');
    settlement('date','2026-09-12','funding-rate');expect(html).toContain('确认计算区间');settlement('intervals_confirmed','','funding-rounding',0,true);expect(html).toContain('data-rounded-cost');settlement('start_date','2026-09-02','funding');expect(html).toContain('确认计算区间');settlement('intervals_confirmed','','funding-rounding',0,true);action('settlement-add-rate-event');expect(html).not.toContain('data-funding-result');action('settlement-remove-rate-event',1);expect(html).toContain('确认计算区间');settlement('intervals_confirmed','','funding-rounding',0,true);action('settlement-add-funding-event');action('settlement-remove-funding-event',2);expect(html).toContain('确认计算区间');
    settlement('intervals_confirmed','','funding-rounding',0,true);settlement('balance_model','CONSTANT','funding');settlement('status','PROVIDED','funding');expect(html).toContain('确认计算区间');settlement('intervals_confirmed','','funding-rounding',0,true);let finish!:(s:string)=>void;openSettlement(()=>new Promise(r=>{finish=r}));settlement('reference','KEEP_AFTER_SLOW_ROUNDING_1014','funding-rounding');finish('{}');await Promise.resolve();await Promise.resolve();expect(html).toContain('KEEP_AFTER_SLOW_ROUNDING_1014');expect(html).not.toContain('不是受支持');
  });
  it('1.4JSON和XLSX在选择器前固定舍入依据，后续输入不混入',async()=>{
    await start();await customerProject();action('settlement-create');fundingInputs();ledgerInputs();rateInputs();roundingInputs();const before=storage.get(key);let finish!:(h:unknown)=>void,saved='';vi.stubGlobal('window',{showSaveFilePicker:()=>new Promise(r=>{finish=r})});action('settlement-save');settlement('reference','LATER_ROUND_JSON_1014','funding-rounding');finish({name:'plan.json',createWritable:async()=>({write:async(s:string)=>{saved=s},close:async()=>{}})});await vi.waitFor(()=>expect(saved).not.toBe(''));expect(JSON.parse(saved)).toMatchObject({version:'1.4',funding:{rounding:{reference:'PRIVATE_ROUND_UI_1014',unit:'0.01'}}});
    let blob:Blob|null=null;vi.stubGlobal('window',{showSaveFilePicker:()=>new Promise(r=>{finish=r})});action('export-internal-xlsx');settlement('reference','LATER_ROUND_XLSX_1014','funding-rounding');finish({name:'rounding.xlsx',createWritable:async()=>({write:async(b:Blob)=>{blob=b},close:async()=>{}})});await vi.waitFor(()=>expect(blob).not.toBeNull());const{unzipSync,strFromU8}=await import('fflate');const text=Object.values(unzipSync(new Uint8Array(await blob!.arrayBuffer()))).map(v=>strFromU8(v)).join('\n');expect(text).toContain('LATER_ROUND_JSON_1014');expect(text).not.toContain('LATER_ROUND_XLSX_1014');expect(text).toContain('舍入假设金额');expect(storage.get(key)).toBe(before);
  });
  it('1.4手动备份和重试保留输入，旧重名舍入扩展不被覆盖',async()=>{
    await start();await customerProject();action('settlement-create');fundingInputs();ledgerInputs();rateInputs();roundingInputs();const before=storage.get(key);let blob:Blob|null=null;recoveryElements();vi.spyOn(URL,'createObjectURL').mockImplementation(b=>{blob=b as Blob;return 'blob:recovery'});const views=await import('../src/ui/views-input'),fault=vi.spyOn(views,'renderFormsRow').mockImplementation(()=>{throw Error('fault')});settlement('reference','KEEP_RAW_ROUNDING_1014','funding-rounding');recoveryPanel!.callbacks.get('#recovery-backup')!();expect(JSON.parse(await blob!.text()).settlement_plan).toMatchObject({version:'1.4',funding:{rounding:{reference:'KEEP_RAW_ROUNDING_1014'}}});fault.mockRestore();recoveryPanel!.callbacks.get('#recovery-retry')!();expect(html).toContain('舍入假设金额：65.00 USD');expect(storage.get(key)).toBe(before);
    const raw=JSON.parse(await blob!.text()).settlement_plan;raw.version='1.3';raw.funding.rounding='PRIVATE_LEGACY_ROUND_1014';openSettlement(async()=>JSON.stringify(raw));await vi.waitFor(()=>expect(html).toContain('启用金额舍入'));action('settlement-enable-rounding');expect(html).toContain('重名');expect(html).not.toContain('data-settlement-row="funding-rounding"');let saved='';vi.stubGlobal('window',{showSaveFilePicker:async()=>({name:'legacy.json',createWritable:async()=>({write:async(s:string)=>{saved=s},close:async()=>{}})})});action('settlement-save');await vi.waitFor(()=>expect(saved).not.toBe(''));expect(JSON.parse(saved)).toMatchObject({version:'1.3',funding:{rounding:'PRIVATE_LEGACY_ROUND_1014'}});
  });
  it('利率1.3显式启用、增删和切换不改项目/客户状态，本金事件仍可编辑',async()=>{
    await start();await customerProject();customer('reviewed','',true);action('settlement-create');fundingInputs();ledgerInputs();const before=storage.get(key);action('settlement-enable-rates');expect(html).not.toContain('data-funding-result');expect(html).toContain('PRIVATE_EVENT_UI_817');action('settlement-add-rate-event');settlement('date','2026-09-11','funding-rate');settlement('annual_rate','9','funding-rate');settlement('reference','PRIVATE_RATE_UI_993','funding-rate');settlement('status','PROVIDED','funding');expect(html).toContain('65 USD');
    settlement('amount','2000','funding-event');expect(html).toContain('75 USD');settlement('amount','4000','funding-event');settlement('rate_model','CONSTANT','funding');expect(html).not.toContain('data-funding-result');settlement('status','PROVIDED','funding');expect(html).toContain('50 USD');expect(html).toContain('PRIVATE_RATE_UI_993');settlement('rate_model','EVENTS','funding');settlement('status','PROVIDED','funding');expect(html).toContain('65 USD');action('settlement-remove-rate-event',0);expect(html).toContain('50 USD');expect(storage.get(key)).toBe(before);expect(html).toContain('data-customer-field="reviewed" checked');
  });
  it('利率编辑取消慢文件读取，坏生效日阻断旧结果；删除也取消慢读取',async()=>{
    await start();await customerProject();action('settlement-create');fundingInputs();ledgerInputs();rateInputs();let finish!:(s:string)=>void;openSettlement(()=>new Promise(r=>{finish=r}));settlement('reference','AFTER_SLOW_RATE_993','funding-rate');finish('{}');await Promise.resolve();await Promise.resolve();expect(html).toContain('AFTER_SLOW_RATE_993');expect(html).not.toContain('不是受支持');settlement('date','2026-08-31','funding-rate');expect(html).not.toContain('data-funding-result');expect(html).toContain('超出起止日');
    openSettlement(()=>new Promise(r=>{finish=r}));action('settlement-remove-rate-event',0);finish('{}');await Promise.resolve();await Promise.resolve();expect(html).toContain('50 USD');expect(html).not.toContain('不是受支持');
  });
  it('付款JSON及内部XLSX在选择器前固定1.3利率输入，后续编辑不混入',async()=>{
    await start();await customerProject();action('settlement-create');fundingInputs();ledgerInputs();rateInputs();const before=storage.get(key);let finish!:(h:unknown)=>void,saved='';vi.stubGlobal('window',{showSaveFilePicker:()=>new Promise(r=>{finish=r})});action('settlement-save');settlement('reference','LATER_RATE_JSON_993','funding-rate');finish({name:'plan.json',createWritable:async()=>({write:async(s:string)=>{saved=s},close:async()=>{}})});await vi.waitFor(()=>expect(saved).not.toBe(''));expect(JSON.parse(saved)).toMatchObject({version:'1.3',funding:{rate_events:[{reference:'PRIVATE_RATE_UI_993'}]}});
    let blob:Blob|null=null;vi.stubGlobal('window',{showSaveFilePicker:()=>new Promise(r=>{finish=r})});action('export-internal-xlsx');settlement('reference','LATER_RATE_XLSX_993','funding-rate');finish({name:'rates.xlsx',createWritable:async()=>({write:async(b:Blob)=>{blob=b},close:async()=>{}})});await vi.waitFor(()=>expect(blob).not.toBeNull());const{unzipSync,strFromU8}=await import('fflate');const text=Object.values(unzipSync(new Uint8Array(await blob!.arrayBuffer()))).map(v=>strFromU8(v)).join('\n');expect(text).toContain('LATER_RATE_JSON_993');expect(text).not.toContain('LATER_RATE_XLSX_993');expect(text).toContain('2340000 ÷ 100 ÷ 360');expect(storage.get(key)).toBe(before);
  });
  it('利率输入进入手动异常备份及重试，旧重名字段升级被阻断且原文保存',async()=>{
    await start();await customerProject();action('settlement-create');fundingInputs();ledgerInputs();rateInputs();const before=storage.get(key);let blob:Blob|null=null;recoveryElements();vi.spyOn(URL,'createObjectURL').mockImplementation(b=>{blob=b as Blob;return 'blob:recovery'});const views=await import('../src/ui/views-input'),fault=vi.spyOn(views,'renderFormsRow').mockImplementation(()=>{throw Error('fault')});settlement('reference','KEEP_RAW_RATE_993','funding-rate');recoveryPanel!.callbacks.get('#recovery-backup')!();expect(JSON.parse(await blob!.text()).settlement_plan).toMatchObject({version:'1.3',funding:{rate_events:[{reference:'KEEP_RAW_RATE_993'}]}});fault.mockRestore();recoveryPanel!.callbacks.get('#recovery-retry')!();expect(html).toContain('65 USD');expect(storage.get(key)).toBe(before);
    const raw=JSON.parse(await blob!.text()).settlement_plan;raw.version='1.2';delete raw.funding.rate_model;raw.funding.rate_events='PRIVATE_LEGACY_RATE_993';openSettlement(async()=>JSON.stringify(raw));await vi.waitFor(()=>expect(html).toContain('启用利率事件'));action('settlement-enable-rates');expect(html).toContain('重名');expect(html).not.toContain('data-settlement-row="funding-rate"');let saved='';vi.stubGlobal('window',{showSaveFilePicker:async()=>({name:'legacy.json',createWritable:async()=>({write:async(s:string)=>{saved=s},close:async()=>{}})})});action('settlement-save');await vi.waitFor(()=>expect(saved).not.toBe(''));expect(JSON.parse(saved)).toMatchObject({version:'1.2',funding:{rate_events:'PRIVATE_LEGACY_RATE_993'}});
  });
  it('显式升级1.2重新确认范围，逐笔事件、模型切换保留输入且不写项目/客户确认',async()=>{
    await start();await customerProject();customer('reviewed','',true);action('settlement-create');fundingInputs();const before=storage.get(key);action('settlement-enable-ledger');expect(html).not.toContain('data-funding-result');expect(html).toContain('重新确认');settlement('status','PROVIDED','funding');expect(html).toContain('60 USD');
    action('settlement-add-funding-event');expect(html).not.toContain('data-funding-result');for(const [key,value]of Object.entries({direction:'DECREASE',amount:'4000',currency:'USD',date:'2026-09-11',reference:'PRIVATE_EVENT_ONE'}))settlement(key,value,'funding-event');
    expect(html).toContain('46.666666');expect(html).toContain('data-funding-ledger');settlement('balance_model','CONSTANT','funding');expect(html).not.toContain('data-funding-result');settlement('status','PROVIDED','funding');expect(html).toContain('60 USD');expect(html).toContain('PRIVATE_EVENT_ONE');expect(html).not.toContain('data-funding-ledger');expect(html).toContain('data-customer-field="reviewed" checked');expect(storage.get(key)).toBe(before);
  });
  it('事件编辑和增删撤销慢导入，坏事件不沿用结果，绑定变化也退出',async()=>{
    await start();await customerProject();action('settlement-create');fundingInputs();ledgerInputs();expect(html).toContain('50 USD');let finish!:(s:string)=>void;openSettlement(()=>new Promise(r=>{finish=r}));settlement('reference','AFTER_SLOW_READ','funding-event');finish('{}');await Promise.resolve();await Promise.resolve();expect(html).toContain('AFTER_SLOW_READ');expect(html).not.toContain('不是受支持');
    settlement('amount','12001','funding-event');expect(html).not.toContain('data-funding-result');expect(html).toContain('超过当时本金');settlement('amount','4000','funding-event');expect(html).toContain('50 USD');change('term_scenarios.FOB.quote.amount','20000');expect(html).not.toContain('data-funding-result');action('settlement-rebind');expect(html).toContain('50 USD');
    openSettlement(()=>new Promise(r=>{finish=r}));action('settlement-remove-funding-event',1);finish('{}');await Promise.resolve();await Promise.resolve();expect(html).not.toContain('不是受支持');expect(html).not.toContain('PRIVATE_EVENT_UI_818');
  });
  it('1.2保存及Excel在文件选择前冻结事件；等待时编辑不改已生成内容',async()=>{
    await start();await customerProject();action('settlement-create');fundingInputs();ledgerInputs();const before=storage.get(key);let finish!:(h:unknown)=>void,saved='';vi.stubGlobal('window',{showSaveFilePicker:()=>new Promise(r=>{finish=r})});action('settlement-save');settlement('reference','AFTER_SAVE_817','funding-event');finish({name:'plan.json',createWritable:async()=>({write:async(s:string)=>{saved=s},close:async()=>{}})});await vi.waitFor(()=>expect(saved).not.toBe(''));expect(JSON.parse(saved)).toMatchObject({version:'1.2',funding:{balance_model:'EVENTS'}});expect(saved).not.toContain('AFTER_SAVE_817');
    let blob:Blob|null=null;vi.stubGlobal('window',{showSaveFilePicker:()=>new Promise(r=>{finish=r})});action('export-internal-xlsx');settlement('reference','AFTER_XLSX_817','funding-event');finish({name:'ledger.xlsx',createWritable:async()=>({write:async(b:Blob)=>{blob=b},close:async()=>{}})});await vi.waitFor(()=>expect(blob).not.toBeNull());const{unzipSync,strFromU8}=await import('fflate');const text=Object.values(unzipSync(new Uint8Array(await blob!.arrayBuffer()))).map(v=>strFromU8(v)).join('\n');expect(text).toContain('AFTER_SAVE_817');expect(text).not.toContain('AFTER_XLSX_817');expect(text).toContain('300000 × 6');expect(storage.get(key)).toBe(before);
  });
  it('1.2原始事件进入恢复备份并在重试后保留，损坏导入不能覆盖原账本',async()=>{
    await start();await customerProject();action('settlement-create');fundingInputs();ledgerInputs();const before=storage.get(key);let blob:Blob|null=null;recoveryElements();vi.spyOn(URL,'createObjectURL').mockImplementation(b=>{blob=b as Blob;return 'blob:recovery'});const views=await import('../src/ui/views-input'),fault=vi.spyOn(views,'renderFormsRow').mockImplementation(()=>{throw Error('fault')});settlement('reference','KEEP_RAW_EVENT_817','funding-event');recoveryPanel!.callbacks.get('#recovery-backup')!();expect(JSON.parse(await blob!.text()).settlement_plan).toMatchObject({version:'1.2',funding:{balance_model:'EVENTS',events:[{reference:'KEEP_RAW_EVENT_817'},{reference:'PRIVATE_EVENT_UI_818'}]}});fault.mockRestore();recoveryPanel!.callbacks.get('#recovery-retry')!();expect(html).toContain('50 USD');expect(storage.get(key)).toBe(before);
    openSettlement(async()=>JSON.stringify({version:'1.2',kind:'INTERNAL_SETTLEMENT_PLAN'}));await vi.waitFor(()=>expect(html).toContain('付款计划：'));expect(html).toContain('KEEP_RAW_EVENT_817');expect(html).toContain('50 USD');
  });
  it('旧1.1重名扩展在界面不激活，显式升级失败不覆盖扩展',async()=>{
    await start();await customerProject();const{newSettlementPlan}=await import('../src/domain/settlement'),{settlementBinding}=await import('../src/data/settlement-context');const legacy=newSettlementPlan(settlementBinding(JSON.parse(storage.get(key)!).project));Object.assign(legacy.funding!,{events:'PRIVATE_LEGACY_EXT_817',balance_model:'EVENTS'});openSettlement(async()=>JSON.stringify(legacy));await vi.waitFor(()=>expect(html).toContain('启用变动本金'));action('settlement-enable-ledger');expect(html).toContain('重名');expect(html).not.toContain('data-settlement-row="funding-event"');let saved='';vi.stubGlobal('window',{showSaveFilePicker:async()=>({name:'legacy.json',createWritable:async()=>({write:async(s:string)=>{saved=s},close:async()=>{}})})});action('settlement-save');await vi.waitFor(()=>expect(saved).not.toBe(''));expect(JSON.parse(saved)).toMatchObject({version:'1.1',funding:{events:'PRIVATE_LEGACY_EXT_817'}});
  });
  it('资金假设事件独立于项目/客户检查，缺项退出，原文保存而非填造',async()=>{
    await start();await customerProject();customer('reviewed','',true);const before=storage.get(key);action('settlement-create');fundingInputs();
    expect(html).toContain('data-funding-result');expect(html).toContain('60 USD');expect(storage.get(key)).toBe(before);expect(html).toContain('data-customer-field="reviewed" checked');
    settlement('annual_rate','','funding');expect(html).not.toContain('data-funding-result');expect(html).toContain('年利率');
    let saved='';vi.stubGlobal('window',{showSaveFilePicker:async()=>({name:'plan.json',createWritable:async()=>({write:async(s:string)=>{saved=s},close:async()=>{}})})});action('settlement-save');await vi.waitFor(()=>expect(saved).not.toBe(''));
    expect(JSON.parse(saved).funding.annual_rate).toBe('');expect(JSON.parse(saved).version).toBe('1.1');expect(storage.get(key)).toBe(before);
  });
  it('旧1.0打开不产生资金参数，显式升级保留付款和扩展，状态切换不删除假设',async()=>{
    await start();await customerProject();const {newSettlementPlan}=await import('../src/domain/settlement');const {settlementBinding}=await import('../src/data/settlement-context');const plan=newSettlementPlan(settlementBinding(JSON.parse(storage.get(key)!).project));
    plan.version='1.0';delete plan.funding;plan.notes='LEGACY_KEEP_873';Object.assign(plan,{extra:'LEGACY_EXTENSION_774'});openSettlement(async()=>JSON.stringify(plan));await vi.waitFor(()=>expect(html).toContain('LEGACY_KEEP_873'));
    expect(html).toContain('升级为1.1');expect(html).not.toContain('data-settlement-row="funding"');action('settlement-enable-funding');expect(html).toContain('data-settlement-row="funding"');fundingInputs();settlement('status','NOT_MODELED','funding');expect(html).toContain('不表示成本为零');expect(html).toContain('PRIVATE_FUNDING_UI_981');
    let saved='';vi.stubGlobal('window',{showSaveFilePicker:async()=>({name:'plan.json',createWritable:async()=>({write:async(s:string)=>{saved=s},close:async()=>{}})})});action('settlement-save');await vi.waitFor(()=>expect(saved).not.toBe(''));expect(JSON.parse(saved)).toMatchObject({version:'1.1',notes:'LEGACY_KEEP_873',extra:'LEGACY_EXTENSION_774'});
  });
  it('资金假设编辑撤销慢文件读取，报价变更撤销资金结果，重新绑定不删除本金',async()=>{
    await start();await customerProject();action('settlement-create');fundingInputs();let finish!:(s:string)=>void;openSettlement(()=>new Promise(r=>{finish=r}));settlement('principal','24000','funding');finish('{}');await Promise.resolve();await Promise.resolve();expect(html).not.toContain('不是受支持');expect(html).toContain('120 USD');
    change('term_scenarios.FOB.quote.amount','12345');expect(html).not.toContain('data-funding-result');expect(html).toContain('重新绑定');action('settlement-rebind');expect(html).toContain('120 USD');
  });
  it('内部Excel付款和资金快照在选文件前冻结；客户Excel仍不读取内部计划',async()=>{
    await start();await customerProject();action('settlement-create');fundingInputs();settlement('notes','PRIVATE_PLAN_EXCEL_813');const before=storage.get(key);let finish!:(h:unknown)=>void,blob:Blob|null=null;
    vi.stubGlobal('window',{showSaveFilePicker:()=>new Promise(r=>{finish=r})});action('export-internal-xlsx');settlement('reference','LATER_FUNDING_946','funding');settlement('principal','24000','funding');finish({name:'internal.xlsx',createWritable:async()=>({write:async(b:Blob)=>{blob=b},close:async()=>{}})});await vi.waitFor(()=>expect(blob).not.toBeNull());
    const {unzipSync,strFromU8}=await import('fflate');const text=Object.values(unzipSync(new Uint8Array(await blob!.arrayBuffer()))).map(data=>strFromU8(data)).join('\n');expect(text).toContain('PRIVATE_FUNDING_UI_981');expect(text).toContain('PRIVATE_PLAN_EXCEL_813');expect(text).not.toContain('LATER_FUNDING_946');expect(text).toContain('12000 × 6');
    blob=null;customer('reviewed','',true);vi.stubGlobal('window',{showSaveFilePicker:async()=>({name:'client.xlsx',createWritable:async()=>({write:async(b:Blob)=>{blob=b},close:async()=>{}})})});action('export-customer-xlsx');await vi.waitFor(()=>expect(blob).not.toBeNull());const client=Object.values(unzipSync(new Uint8Array(await blob!.arrayBuffer()))).map(data=>strFromU8(data)).join('\n');expect(client).not.toContain('PRIVATE_PLAN_EXCEL_813');expect(client).not.toContain('LATER_FUNDING_946');expect(client).not.toContain('资金占用假设');expect(storage.get(key)).toBe(before);
  });
  it('付款输入不修改项目/草稿或客户检查，报价编辑撤销绑定而非沿用旧合计',async()=>{
    await start();await customerProject();customer('reviewed','',true);const before=storage.get(key);action('settlement-create');settlement('method','TT');settlement('bank_status','NO_FEES');settlement('value','100','payment');settlement('basis','PERCENT','payment');settlement('date','2026-09-15','payment');settlement('trigger','内部合同预付款','payment');
    expect(html).toContain('data-settlement-result');expect(storage.get(key)).toBe(before);expect(html).toContain('data-customer-field="reviewed" checked');
    change('term_scenarios.FOB.quote.amount','12345');expect(html).toContain('重新绑定');expect(html).not.toContain('data-settlement-result');action('settlement-rebind');expect(html).toContain('data-settlement-result');
  });
  it('付款保存先复制快照并保护重复写入，文件不混入客户公开字段',async()=>{
    await start();await customerProject();customer('reference','PRIVATE_PUBLIC_REFERENCE_916');action('settlement-create');settlement('notes','INTERNAL_PAYMENT_811');const before=storage.get(key);let resolvePicker!:(h:unknown)=>void,saved='',name='';const picker=vi.fn((o:{suggestedName:string})=>{name=o.suggestedName;return new Promise(r=>{resolvePicker=r;});});vi.stubGlobal('window',{showSaveFilePicker:picker});action('settlement-save');action('settlement-save');settlement('notes','AFTER_SNAPSHOT');expect(picker).toHaveBeenCalledOnce();resolvePicker({name:'payment.json',createWritable:async()=>({write:async(s:string)=>{saved=s;},close:async()=>{}})});await vi.waitFor(()=>expect(saved).toContain('INTERNAL_PAYMENT_811'));expect(saved).not.toContain('AFTER_SNAPSHOT');expect(saved).not.toContain('PRIVATE_PUBLIC_REFERENCE_916');expect(name).toBe('internal-settlement-plan.json');expect(storage.get(key)).toBe(before);
  });
  it('付款保存取消/失败和下载回退保留输入，不改项目',async()=>{
    await start();await customerProject();action('settlement-create');settlement('notes','KEEP_PAYMENT_421');const before=storage.get(key);vi.stubGlobal('window',{showSaveFilePicker:async()=>{throw new DOMException('cancel','AbortError');}});action('settlement-save');await vi.waitFor(()=>expect(html).toContain('已取消付款计划保存'));vi.stubGlobal('window',{showSaveFilePicker:async()=>({name:'pay.json',createWritable:async()=>({write:async()=>{throw Error('disk-full')},close:async()=>{}})})});action('settlement-save');await vi.waitFor(()=>expect(html).toContain('付款计划保存失败'));expect(createElement).not.toHaveBeenCalled();expect(html).toContain('KEEP_PAYMENT_421');
    vi.stubGlobal('window',{});const click=vi.fn();createElement.mockReturnValue({click});vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:payment');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});action('settlement-save');await vi.waitFor(()=>expect(html).toContain('已发起内部付款计划下载'));expect(click).toHaveBeenCalledOnce();expect(storage.get(key)).toBe(before);
  });
  it('坏付款文件不能替换已有计划，打开项目/新建后重置，慢读取不污染新项目',async()=>{
    await start();await customerProject();action('settlement-create');settlement('notes','KEEP_PAYMENT_923');openSettlement(async()=>'{}');await vi.waitFor(()=>expect(html).toContain('不是受支持'));expect(html).toContain('KEEP_PAYMENT_923');
    let finish!:(s:string)=>void;openSettlement(()=>new Promise(r=>{finish=r;}));action('new-china-blank');finish('{}');await Promise.resolve();await Promise.resolve();expect(html).not.toContain('KEEP_PAYMENT_923');expect(html).not.toContain('不是受支持');expect(html).toContain('绑定当前报价并新建');
  });
  it('增加/删除费用和价款只修改付款计划，来源切换保留金额与关联并取消新增确认',async()=>{
    await start();await customerProject();action('settlement-create');const before=storage.get(key);action('settlement-add-payment');settlement('value','4321','payment',1);action('settlement-remove-payment',1);expect(html).not.toContain('value="4321"');action('settlement-add-fee');settlement('cost_id','old-bank','fee');settlement('source','EXTRA','fee');settlement('amount','98.76','fee');settlement('not_in_project','','fee',0,true);settlement('source','EXISTING','fee');settlement('source','EXTRA','fee');expect(html).toContain('value="98.76"');expect(html).toContain('value="old-bank"');expect(html).not.toContain('data-settlement-field="not_in_project" checked');expect(storage.get(key)).toBe(before);
  });
  function resource(kind:'template'|'schema',id:string) {
    const button=new ElementStub();button.dataset.action=kind==='template'?'download-project-template':'download-project-schema';
    if(kind==='template')button.dataset.templateId=id;else button.dataset.schemaKind=id;
    listeners.get('click')!({target:button});
  }
  it('下载模板与Schema独立于当前项目，不带内部名称或公开字段，也不替换当前内容',async()=>{
    await start();await customerProject();customer('reference','PRIVATE_CURRENT_729');const before=storage.get(key);let text='',name='';vi.stubGlobal('window',{showSaveFilePicker:async(o:{suggestedName:string})=>{name=o.suggestedName;return{name,createWritable:async()=>({write:async(s:string)=>{text=s;},close:async()=>{}})}}});resource('template','china-import-blank');await vi.waitFor(()=>expect(text).toContain('空白模板'));expect(name).toBe('china-import-blank.json');expect(text).not.toContain('PRIVATE_');expect(JSON.parse(text).goods.quantity).toBe('');expect(storage.get(key)).toBe(before);text='';resource('schema','current');await vi.waitFor(()=>expect(text).toContain('urn:cocudtt:project:0.8'));expect(text).not.toContain('PRIVATE_');expect(storage.get(key)).toBe(before);
  });
  it('模板选择等待期间仍是固定文件，忙碌阻止重复下载，当前编辑保持',async()=>{
    await start();await customerProject();let resolvePicker!:(h:unknown)=>void,text='';const picker=vi.fn(()=>new Promise(r=>{resolvePicker=r;}));vi.stubGlobal('window',{showSaveFilePicker:picker});resource('template','china-import-actual-quotes');resource('schema','legacy');expect(picker).toHaveBeenCalledOnce();expect(html).toContain('正在导出模板');change('goods.name','修改当前商品');resolvePicker({name:'template.json',createWritable:async()=>({write:async(s:string)=>{text=s;},close:async()=>{}})});await vi.waitFor(()=>expect(text).toContain('ACTUAL_QUOTES'));expect(text).not.toContain('修改当前商品');expect(JSON.parse(storage.get(key)!).project.goods.name).toBe('修改当前商品');expect(html).not.toContain('正在导出模板');
  });
  it('模板取消、写盘失败及无效选择保留原项目，不另行下载',async()=>{
    await start();const before=storage.get(key);vi.stubGlobal('window',{showSaveFilePicker:async()=>{throw new DOMException('cancel','AbortError');}});resource('template','china-import-blank');await vi.waitFor(()=>expect(html).toContain('已取消模板'));vi.stubGlobal('window',{showSaveFilePicker:async()=>({name:'schema.json',createWritable:async()=>({write:async()=>{throw Error('disk-full');},close:async()=>{}})})});resource('schema','legacy');await vi.waitFor(()=>expect(html).toContain('导出失败'));const picker=vi.fn();vi.stubGlobal('window',{showSaveFilePicker:picker});resource('template','UNKNOWN');expect(picker).not.toHaveBeenCalled();expect(storage.get(key)).toBe(before);expect(createElement).not.toHaveBeenCalled();
  });
  it('模板下载回退不改变客户检查、项目草稿和保存状态',async()=>{
    await start();await customerProject();customer('reviewed','',true);const before=storage.get(key),click=vi.fn();createElement.mockReturnValue({click});vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:template');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});resource('template','china-import-synthetic-example');await vi.waitFor(()=>expect(html).toContain('已发起模板'));expect(click).toHaveBeenCalledOnce();expect(storage.get(key)).toBe(before);expect(html).toContain('已检查上方公开内容');
  });
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
  it('中英文摘要必须检查后导出，编辑公开或项目字段撤销检查',async()=>{
    await start();await customerProject();const picker=vi.fn();vi.stubGlobal('window',{showSaveFilePicker:picker});action('export-bilingual-summary');await vi.waitFor(()=>expect(html).toContain('请先检查客户预览'));expect(picker).not.toHaveBeenCalled();customer('reviewed','',true);customer('remarks','变更原文');action('export-bilingual-summary');expect(picker).not.toHaveBeenCalled();customer('reviewed','',true);change('goods.name','变更商品');action('export-bilingual-summary');expect(picker).not.toHaveBeenCalled();
  });
  it('摘要固定公开快照，重复点击不重复写入，等待期间编辑不会改变已生成文件',async()=>{
    await start();await customerProject();customer('reference','PUBLIC-SUM');customer('reviewed','',true);let resolvePicker!:(h:unknown)=>void,saved='',name='';const picker=vi.fn((o:{suggestedName:string})=>{name=o.suggestedName;return new Promise(r=>{resolvePicker=r;});});vi.stubGlobal('window',{showSaveFilePicker:picker});action('export-bilingual-summary');action('export-bilingual-summary');expect(picker).toHaveBeenCalledOnce();expect(html).toContain('正在导出摘要');customer('reference','LATER');resolvePicker({name:'summary.html',createWritable:async()=>({write:async(s:string)=>{saved=s;},close:async()=>{}})});await vi.waitFor(()=>expect(saved).toContain('PUBLIC-SUM'));expect(saved).toContain('Risk transfer');expect(saved).not.toContain('LATER');expect(saved).not.toContain('PRIVATE_CUSTOMER_FILENAME_997');expect(name).toBe('PUBLIC-SUM-中英文条款摘要草稿.html');expect(html).not.toContain('正在导出摘要');
  });
  it('摘要取消和写盘失败恢复按钮并保留草稿，不额外下载',async()=>{
    await start();await customerProject();customer('reviewed','',true);const before=storage.get(key);vi.stubGlobal('window',{showSaveFilePicker:async()=>{throw new DOMException('cancel','AbortError');}});action('export-bilingual-summary');await vi.waitFor(()=>expect(html).toContain('已取消中英文条款摘要'));vi.stubGlobal('window',{showSaveFilePicker:async()=>({name:'sum.html',createWritable:async()=>({write:async()=>{throw Error('disk-full');},close:async()=>{}})})});action('export-bilingual-summary');await vi.waitFor(()=>expect(html).toContain('中英文条款摘要导出失败'));expect(storage.get(key)).toBe(before);expect(html).not.toContain('正在导出摘要');expect(createElement).not.toHaveBeenCalled();
  });
  it('摘要下载回退保留项目和来源确认状态',async()=>{
    await start();await customerProject();customer('reviewed','',true);const before=storage.get(key),click=vi.fn();createElement.mockReturnValue({click});vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:summary');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});action('export-bilingual-summary');await vi.waitFor(()=>expect(html).toContain('已发起中英文条款摘要'));expect(click).toHaveBeenCalledOnce();expect(storage.get(key)).toBe(before);
  });
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

  it('PDF写入有效二进制，文件名只用公开编号，不改草稿/保存状态',async()=>{
    await start();await customerProject();customer('reference','PUBLIC-PDF');customer('reviewed','',true);const before=storage.get(key);let blob:Blob|null=null,name='';
    vi.stubGlobal('window',{showSaveFilePicker:async(options:{suggestedName:string})=>{name=options.suggestedName;return{name:'public.pdf',createWritable:async()=>({write:async(data:Blob)=>{blob=data;},close:async()=>{}})}}});action('export-customer-pdf');await vi.waitFor(()=>expect(blob).not.toBeNull(),{timeout:4000});const {PDFDocument}=await import('pdf-lib');const doc=await PDFDocument.load(await blob!.arrayBuffer());expect(name).toBe('PUBLIC-PDF-客户报价草稿.pdf');expect(doc.getTitle()).toBe('PUBLIC-PDF · 报价草稿');expect(storage.get(key)).toBe(before);expect(html).toContain('项目文件仍需单独保存');
  });
  it('PDF未检查阻断，选择文件期间修改项目仍保留选择前快照',async()=>{
    await start();await customerProject();const picker=vi.fn();vi.stubGlobal('window',{showSaveFilePicker:picker});action('export-customer-pdf');await vi.waitFor(()=>expect(html).toContain('请先检查客户预览'));expect(picker).not.toHaveBeenCalled();
    customer('reference','BEFORE-EDIT');customer('reviewed','',true);let resolvePicker!:(handle:unknown)=>void,blob:Blob|null=null;vi.stubGlobal('window',{showSaveFilePicker:()=>new Promise(resolve=>{resolvePicker=resolve;})});action('export-customer-pdf');expect(html).toContain('正在生成 PDF');customer('reference','AFTER-EDIT');change('term_scenarios.FOB.quote.amount','12345');
    resolvePicker({name:'public.pdf',createWritable:async()=>({write:async(data:Blob)=>{blob=data;},close:async()=>{}})});await vi.waitFor(()=>expect(blob).not.toBeNull(),{timeout:4000});const {PDFDocument}=await import('pdf-lib');expect((await PDFDocument.load(await blob!.arrayBuffer())).getTitle()).toBe('BEFORE-EDIT · 报价草稿');expect(JSON.parse(storage.get(key)!).project.term_scenarios.FOB.quote.amount).toBe('12345');
  });
  it('PDF取消、缺字和写入失败不降级下载、不覆盖项目，并恢复按钮',async()=>{
    await start();await customerProject();customer('reviewed','',true);const before=storage.get(key);vi.stubGlobal('window',{showSaveFilePicker:async()=>{throw new DOMException('cancel','AbortError')}});action('export-customer-pdf');await vi.waitFor(()=>expect(html).toContain('已取消客户报价 PDF'));
    customer('remarks','😀');customer('reviewed','',true);const writable=vi.fn();vi.stubGlobal('window',{showSaveFilePicker:async()=>({name:'public.pdf',createWritable:writable})});action('export-customer-pdf');await vi.waitFor(()=>expect(html).toContain('不支持字符'),{timeout:4000});expect(writable).not.toHaveBeenCalled();customer('remarks','合成条款');customer('reviewed','',true);
    vi.stubGlobal('window',{showSaveFilePicker:async()=>({name:'public.pdf',createWritable:async()=>({write:async()=>{throw new Error('disk-full')},close:async()=>{}})})});action('export-customer-pdf');await vi.waitFor(()=>expect(html).toContain('disk-full'),{timeout:4000});expect(storage.get(key)).toBe(before);expect(html).not.toContain('正在生成 PDF');expect(createElement).not.toHaveBeenCalled();
  });
  it('PDF重复点击不并行生成；正常下载回退保持草稿',async()=>{
    await start();await customerProject();customer('reviewed','',true);const before=storage.get(key);let resolvePicker!:(handle:unknown)=>void;const picker=vi.fn(()=>new Promise(resolve=>{resolvePicker=resolve}));vi.stubGlobal('window',{showSaveFilePicker:picker});action('export-customer-pdf');action('export-customer-pdf');expect(picker).toHaveBeenCalledOnce();resolvePicker({name:'public.pdf',createWritable:async()=>({write:async()=>{},close:async()=>{}})});await vi.waitFor(()=>expect(html).toContain('已导出客户报价 PDF'),{timeout:4000});
    vi.stubGlobal('window',{});const click=vi.fn();createElement.mockReturnValue({click});vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:pdf');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});action('export-customer-pdf');await vi.waitFor(()=>expect(html).toContain('已发起客户报价 PDF'),{timeout:4000});expect(click).toHaveBeenCalledOnce();expect(storage.get(key)).toBe(before);
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
    await vi.waitFor(() => expect(html).toContain('打开失败：无法读取文件'));
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

  it('合成核对入口、真实事件及来源确认贯通，不改变项目草稿',async()=>{
    await start();action('pair-review-example');expect(html).toContain('费用核对记录 · 配对 1.1');const before=storage.get(key);fillReview();action('pair-review-submit');expect(html).toContain('PRIVATE_APP_REVIEW44');const p=JSON.parse(storage.get('trade-cost-engine:container-cost-pair-v1')!);expect(p.review_plan.records[0].evidence.status).toBe('UNVERIFIED');reviewAction('pair-review-confirm',p.review_plan.records[0].record_id);expect(JSON.parse(storage.get('trade-cost-engine:container-cost-pair-v1')!).review_plan.records[0].evidence.status).toBe('USER_CONFIRMED');expect(storage.get(key)).toBe(before);
  });
  it('未提交核对编辑经真实事件保留并阻止配对另存',async()=>{
    await start();action('pair-review-example');fillReview();const draft=storage.get('trade-cost-engine:container-review-editor-v1');action('pair-save');expect(html).toContain('存在未提交核对编辑');expect(storage.get('trade-cost-engine:container-review-editor-v1')).toBe(draft);action('pair-review-discard');expect(storage.get('trade-cost-engine:container-review-editor-v1')).toBe('null');
  });
  it('核对编辑异常备份包含1.1及原始编辑，重试保留',async()=>{
    await start();action('pair-review-example');fillReview();let blob:Blob|null=null;recoveryElements();vi.spyOn(URL,'createObjectURL').mockImplementation((b)=>{blob=b as Blob;return'blob:review44';});const fault=vi.spyOn(appRoot,'innerHTML','set').mockImplementationOnce(()=>{throw Error('PRIVATE_REVIEW_RENDER44');});reviewField('explanation','RAW_REVIEW44');expect(appRoot.hidden).toBe(true);recoveryPanel!.callbacks.get('#recovery-backup')!();const raw=JSON.parse(await blob!.text());expect(raw.container_cost_pair.version).toBe('1.1');expect(raw.container_review_editor.fields.explanation).toBe('RAW_REVIEW44');expect(raw.container_review_editor_draft_text).toContain('RAW_REVIEW44');fault.mockRestore();recoveryPanel!.callbacks.get('#recovery-retry')!();expect(html).toContain('RAW_REVIEW44');
  });
  it('新记录正文只能进入内部报告，客户投影不携带核对数据',async()=>{
    await start();action('pair-review-example');fillReview();action('pair-review-submit');let data:string|Blob|null=null;vi.stubGlobal('window',{showSaveFilePicker:async()=>({createWritable:async()=>({write:async(t:string|Blob)=>{data=t;},close:async()=>{}})})});action('export-report');await vi.waitFor(()=>expect(data).not.toBeNull());expect(String(data)).toContain('PRIVATE_APP_REVIEW44');data=null;await customerProject();customer('reviewed','',true);action('export-customer-quote');await vi.waitFor(()=>expect(data).not.toBeNull());expect(String(data)).not.toContain('PRIVATE_APP_REVIEW44');expect(String(data)).not.toContain('PRIVATE_APP_SOURCE44');
  });
  it('写盘失败必须显示失败，不能宣称已经保存', async () => {
    await start();
    vi.stubGlobal('window', { showSaveFilePicker: async () => ({
      name: 'test.json', createWritable: async () => ({
        write: async () => { throw new Error('磁盘已满'); }, close: async () => {},
      }),
    }) });
    save();
    await vi.waitFor(() => expect(html).toContain('保存失败，当前改动尚未写入项目文件'));
    expect(html).not.toContain('磁盘已满');
    expect(html).not.toContain('已保存到');
    expect(createElement).not.toHaveBeenCalled();
  });
});
