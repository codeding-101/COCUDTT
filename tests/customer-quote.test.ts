import {describe,expect,it} from 'vitest';
import {emptyCustomerQuoteFields, type CustomerQuote, type CustomerQuoteFields} from '../src/domain/customer-quote';
import {projectCustomerQuote} from '../src/data/customer-quote';
import {createCustomerQuoteDocument,customerQuoteFileName,renderCustomerQuoteBody} from '../src/ui/customer-quote';
import {createProjectReport} from '../src/ui/project-report';
import {actualQuotesProject,confirmQuote} from './fixtures/actual-quotes';
import {newSensitivityControls} from '../src/ui/sensitivity';

const fields=():CustomerQuoteFields=>({...emptyCustomerQuoteFields(),issuer:'公开报价公司',recipient:'公开客户',reference:'Q-2026-001',delivery_terms:'按双方确认日期交付',payment_terms:'按双方约定付款',included_scope:'合同明确的运费范围',excluded_scope:'未另约的卸货费用待确认',insurance_terms:'保险按双方约定',tax_terms:'进口税费按适用规则核对',remarks:'供客户确认'});
const project=()=>{const p=actualQuotesProject();p.incoterm='FOB';return p;};
const render=(p=project(),f=fields())=>createCustomerQuoteDocument(projectCustomerQuote(p,f),'2026-09-10T10:00:00Z');

describe('客户白名单与内部信息隔离',()=>{
  it('仅有公开键，原币金额/数量/术语与实际报价一致',()=>{
    const p=project(),q=projectCustomerQuote(p,fields());
    expect(Object.keys(q).sort()).toEqual(['version','kind','issuer','recipient','reference','goods','quote','terms','standard','pending'].sort());
    expect(Object.keys(q.quote).sort()).toEqual(['amount','currency','incoterm','named_place','incoterms_version','valid_from','valid_to'].sort());
    expect(q.quote.amount).toBe('10000');expect(q.quote.currency).toBe('CNY');expect(q.goods.quantity).toBe(String(p.goods.quantity));expect(q.quote.named_place).toBe(p.term_scenarios!.FOB!.quote!.named_place);
  });
  it('采购成本、货物净价、税费计算及项目名不进入客户文件，内部报告继续保留',()=>{
    const p=project();p.name='PRIVATE_PROJECT_8f81';p.goods.seller_goods_cost.amount='82763.128';p.goods.trade_value.amount='65319.271';
    const q=projectCustomerQuote(p,fields()),html=createCustomerQuoteDocument(q,'2026-09-10');
    for(const marker of ['PRIVATE_PROJECT_8f81','82763.128','82,763.128','65319.271','65,319.271'])expect(JSON.stringify(q)+html).not.toContain(marker);
    const internal=createProjectReport(p,'2026-09-10');expect(internal).toContain('PRIVATE_PROJECT_8f81');expect(internal).toContain('82763.128');expect(internal).toContain('完整项目输入快照');
  });
  it('私有费用名称/金额、备注、来源、汇率、税务对象和扩展字段全部排除',()=>{
    const p=project();const markers=['COST_PRIVATE_b67','NOTE_PRIVATE_ab4','SOURCE_PRIVATE_a66','FX_PRIVATE_551','TAX_PRIVATE_995','EXTENSION_PRIVATE_881'];
    p.items[0]!.cost_name=markers[0]!;p.items[1]!.notes=markers[1]!;p.term_scenarios!.FOB!.quote_evidence!.reference=markers[2]!;
    p.fx_books.push({id:'unused',name:markers[3]!,type:'MARKET',date:'2026-09-01',rates:{'EUR/CNY':'8'}});
    (p.tax_profile as unknown as Record<string,unknown>).internal_note=markers[4];(p as unknown as Record<string,unknown>).extra=markers[5];
    const q=projectCustomerQuote(p,fields()),html=createCustomerQuoteDocument(q,'2026-09-10');
    for(const marker of markers)expect(JSON.stringify(q)+html).not.toContain(marker);
    expect(html).not.toMatch(/seller_goods_cost|fx_books|values_key|term_scenarios|<pre|application\/json/);
  });
  it('内部测算失败的详细错误不被复制给客户',()=>{
    const p=project();p.goods.seller_goods_cost.amount='PRIVATE_INVALID_VALUE_775';const html=render(p);
    expect(html).not.toContain('PRIVATE_INVALID_VALUE_775');expect(html).toContain('方案仍有');expect(html).toContain('待核对');
  });
  it('来源快照与人工备注可包含脚本样文本，客户只看到通用待办',()=>{
    const p=project();p.term_scenarios!.FOB!.responsibility_overrides!.insurance!.reason='<script>PRIVATE_CONTRACT()</script>';
    p.term_scenarios!.FOB!.quote_evidence!.values_key='PRIVATE_HASH_733';const html=render(p);
    expect(html).not.toContain('PRIVATE_CONTRACT');expect(html).not.toContain('PRIVATE_HASH_733');expect(html).toContain('核对尚未完成');
  });
  it('公开字段对象的额外属性、渲染对象的顶层/嵌套额外属性不能被展开',()=>{
    const f={...fields(),supplier_cost:'PRIVATE_FIELDS_733'};const q=projectCustomerQuote(project(),f);
    const extended={...q,internal:'PRIVATE_MODEL_554',quote:{...q.quote,fx_rate:'PRIVATE_FX_995'}} as CustomerQuote;
    const html=createCustomerQuoteDocument(extended,'2026-09-10');expect(html).not.toMatch(/PRIVATE_FIELDS_733|PRIVATE_MODEL_554|PRIVATE_FX_995/);
  });
  it('公开文字按用户明确输入保留并转义，不偷偷从内部备注补条款',()=>{
    const f=fields();f.remarks='<img src=x onerror=alert(1)>公开说明';f.payment_terms='公开付款\n第二行';const html=render(project(),f);
    expect(html).toContain('&lt;img');expect(html).toContain('公开付款\n第二行');expect(html).not.toMatch(/<script|<img|<iframe|<form|<input|<textarea|<link|<meta[^>]+http-equiv/i);
  });
  it('投保人、保单编号、免赔/除外、承运人/合同条款不自动进入客户文本',()=>{
    const p=project();p.incoterm='CIF';const policy=p.term_scenarios!.CIF!.insurance!;
    policy.insurer='PRIVATE_INSURER_121';policy.policy_reference='PRIVATE_POLICY_882';policy.deductible='PRIVATE_DEDUCT_816';policy.exclusions='PRIVATE_EXCLUDE_446';
    p.term_scenarios!.CIF!.transport={segments:[{segment_id:'leg',mode:'SEA',from:'德国',to:'中国',carrier:'PRIVATE_CARRIER_646',contract_reference:'PRIVATE_TRANSPORT_774'}],delivery_segment_id:'leg',delivery_at:'ORIGIN',delivery_event:'ON_BOARD',delivery_location:'PRIVATE_LOCATION_454',paid_to:'PRIVATE_PAIDTO_393',handover_basis:'AGREED_POINT',agreement_note:'PRIVATE_AGREEMENT_559'};
    const html=render(p);expect(html).not.toMatch(/PRIVATE_(?:INSURER|POLICY|DEDUCT|EXCLUDE|CARRIER|TRANSPORT|LOCATION|PAIDTO|AGREEMENT)/);
  });
  it('假设报告包含变化值，但客户报价仍只用实际原币报价',()=>{
    const p=project(),before=JSON.stringify(p);const html=createProjectReport(p,'2026-09-10',{...newSensitivityControls(),enabled:true,target:'buyer-freight'});
    expect(html).toContain('13,288.80');const customer=render(p);expect(customer).not.toContain('13,288.80');expect(customer).not.toContain('生成时的假设');expect(JSON.stringify(p)).toBe(before);
  });
  it('冻结输入、公开字段和后续编辑不改变已生成客户快照',()=>{
    const p=project(),f=fields(),before=JSON.stringify(p);const freeze=(v:unknown):void=>{if(v&&typeof v==='object'){Object.freeze(v);Object.values(v).forEach(freeze);}};freeze(p);freeze(f);
    const q=projectCustomerQuote(p,f);expect(JSON.stringify(p)).toBe(before);expect(renderCustomerQuoteBody(q,'2026-09-10')).toContain('10,000.00');
    const other=project();const next=fields(),saved=projectCustomerQuote(other,next);other.term_scenarios!.FOB!.quote!.amount='12345';next.remarks='修改后';expect(saved.quote.amount).toBe('10000');expect(saved.terms.remarks).toBe('供客户确认');
  });
});

describe('实际报价与基础边界',()=>{
  it.each(['FIXED_QUOTE','FIXED_MARKET_PRICE','FIXED_MARGIN_RATE'] as const)('模拟基准%s不得冒充实际客户报价',(kind)=>{
    const p=project();p.anchor=kind==='FIXED_MARKET_PRICE'?{kind,buyer_total:'15000',currency:'CNY'}:kind==='FIXED_MARGIN_RATE'?{kind,margin_rate:'0.2'}:{kind};expect(()=>projectCustomerQuote(p,fields())).toThrow('实际报价');
  });
  it('缺术语报价不能回退公共报价或另一术语报价',()=>{
    const p=project();delete p.term_scenarios!.FOB!.quote;expect(()=>projectCustomerQuote(p,fields())).toThrow('没有实际报价');
  });
  it.each(['0','-1','','NaN','Infinity','10,000','CNY100','1e4'])('报价%s须阻断',(amount)=>{
    const p=project();p.term_scenarios!.FOB!.quote!.amount=amount;expect(()=>projectCustomerQuote(p,fields())).toThrow('报价总额');
  });
  it.each(['0','-1',''])('商品数量%s须阻断',(quantity)=>{const p=project();p.goods.quantity=quantity;expect(()=>projectCustomerQuote(p,fields())).toThrow('商品数量');});
  it('海运术语不能用于空运，缺地点/单位/币种不导出伪完整客户文件',()=>{
    const p=project();p.carriage_mode='AIR';expect(()=>projectCustomerQuote(p,fields())).toThrow('运输方式');p.carriage_mode='SEA';p.term_scenarios!.FOB!.quote!.named_place='';expect(()=>projectCustomerQuote(p,fields())).toThrow('指定地点');
    p.term_scenarios!.FOB!.quote!.named_place='港口';p.goods.unit='';expect(()=>projectCustomerQuote(p,fields())).toThrow('单位');p.goods.unit='PCS';p.term_scenarios!.FOB!.quote!.currency='人民币';expect(()=>projectCustomerQuote(p,fields())).toThrow('币种');
  });
  it('原币报价保留超过两位及六位的小数，不生成净价或单价',()=>{
    const p=project();p.term_scenarios!.FOB!.quote!.amount='12345.1234567';p.goods.quantity='3';const q=projectCustomerQuote(p,fields()),html=createCustomerQuoteDocument(q,'2026-09-10');
    expect(q.quote.amount).toBe('12345.1234567');expect(html).toContain('12,345.1234567 CNY');expect(html).not.toContain('4,115.04');expect(html).toContain('报价总额（原币）');
  });
  it('公开字段错误不回显原始敏感值，长度限制明确',()=>{
    const f=fields();f.remarks='x'.repeat(4001);expect(()=>projectCustomerQuote(project(),f)).toThrow('4000字符');
    (f as unknown as Record<string,unknown>).remarks={private:'PRIVATE_OBJECT_888'};expect(()=>projectCustomerQuote(project(),f)).toThrow('文字');
  });
  it('客户文件名来自公开编号，不从内部项目名称生成',()=>{
    const p=project();p.name='PRIVATE_FILENAME_681';const f=fields();f.reference='../Q:1/2026';const name=customerQuoteFileName(projectCustomerQuote(p,f));expect(name).not.toMatch(/PRIVATE_FILENAME|[\\/:*?"<>|]/);expect(name).toContain('客户报价草稿.html');
  });
});

describe('有效期、待办与基础概念',()=>{
  it('无报价来源/有效期保留待确认，不补成永久有效',()=>{
    const p=project();delete p.term_scenarios!.FOB!.quote_evidence;const q=projectCustomerQuote(p,fields());expect(q.quote.valid_from).toBeNull();expect(q.quote.valid_to).toBeNull();expect(q.pending.join(' ')).toContain('有效期');expect(render(p)).toContain('待双方确认');
  });
  it('有效期倒置或无效日期不当成合法日期展示',()=>{
    const p=project();p.term_scenarios!.FOB!.quote_evidence!.valid_from='2026-10-01';const q=projectCustomerQuote(p,fields());expect(q.quote.valid_from).toBeNull();
    p.term_scenarios!.FOB!.quote_evidence!.valid_from='2026-02-30';expect(projectCustomerQuote(p,fields()).quote.valid_from).toBeNull();
  });
  it('比较日期、报价修改使确认失效，客户只保留通用重新核对提示',()=>{
    const p=project();p.evaluation_date='2026-10-10';expect(projectCustomerQuote(p,fields()).pending.join(' ')).toContain('重新确认');p.evaluation_date='2026-09-10';p.term_scenarios!.FOB!.quote!.amount='11000';expect(projectCustomerQuote(p,fields()).pending.join(' ')).toContain('核对尚未完成');
  });
  it('生成日期超出报价有效期不自动续期，边界日仍可复核',()=>{
    const q=projectCustomerQuote(project(),fields());expect(createCustomerQuoteDocument(q,'2026-10-12T12:00:00Z')).toContain('生成日期不在');expect(createCustomerQuoteDocument(q,'2026-09-30T12:00:00Z')).not.toContain('生成日期不在');
    expect(q.quote.valid_to).toBe('2026-09-30');expect(q.pending.join(' ')).not.toContain('生成日期');
  });
  it('缺公开条款保留待填项，不拿内部约定或术语默认补齐',()=>{
    const q=projectCustomerQuote(project(),emptyCustomerQuoteFields());expect(q.pending.join(' ')).toContain('付款');expect(q.pending.join(' ')).toContain('费用范围');expect(q.terms.payment).toBe('');expect(q.terms.included).toBe('');
  });
  it('CIF/CIP仍分离风险与费用并区分默认险别，卸货费用另核合同',()=>{
    const p=project();p.incoterm='CIF';const cif=projectCustomerQuote(p,fields());expect(cif.standard.insurance_obligation).toBe('ICC_C');expect(renderCustomerQuoteBody(cif,'2026-09-10')).toContain('货损风险');
    p.incoterm='CIP';p.carriage_mode='MULTIMODAL';p.term_scenarios!.CIP={quote:{amount:'10700',currency:'CNY',fx_type:'CONTRACT',named_place:'仓库'}};const cip=projectCustomerQuote(p,fields());expect(cip.standard.insurance_obligation).toBe('ICC_A');expect(renderCustomerQuoteBody(cip,'2026-09-10')).toContain('卸货费用另核合同');
  });
  it('FCA缺地点的客户提示待核对；无投保义务不自动决定保费承担',()=>{
    const p=project();p.incoterm='FCA';p.carriage_mode='ROAD';p.term_scenarios!.FCA={quote:{amount:'10000',currency:'CNY',fx_type:'CONTRACT',named_place:'工厂'}};const q=projectCustomerQuote(p,fields());expect(q.standard.risk_pending).toBe(true);expect(renderCustomerQuoteBody(q,'2026-09-10')).toContain('保费承担依双方约定');
  });
  it('DDP费用承担不生成买方税額、VAT抵扣或法定进口主体承诺',()=>{
    const p=project();p.incoterm='DDP';p.term_scenarios!.DDP={quote:{amount:'13000',currency:'CNY',fx_type:'CONTRACT',named_place:'仓库'}};confirmQuote(p,'DDP');const q=projectCustomerQuote(p,fields()),html=createCustomerQuoteDocument(q,'2026-09-10');expect(q.standard.import_cost_bearer).toBe('SELLER');expect(html).toContain('不自动确定法定纳税人或抵扣资格');expect(html).not.toContain('抵扣后成本');
  });
});
