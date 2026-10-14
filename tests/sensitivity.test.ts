import { describe, expect, it } from 'vitest';
import { d } from '../src/domain/decimal';
import { toScenario, toScenarios, toTrade, type ProjectFile } from '../src/data/project-file';
import { runSensitivity, sensitivityOffsets, metricChange, type SensitivityRequest } from '../src/engine/sensitivity';
import { compare, type CompareInput } from '../src/engine/compare';
import { actualQuotesProject, syntheticEvidence } from './fixtures/actual-quotes';
import { fxEvidenceValues } from '../src/domain/source-evidence';
import { makeCostItem } from './helpers/factory';
import { createProjectReport } from '../src/ui/project-report';
import { projectSensitivity, renderSensitivityResult, newSensitivityControls } from '../src/ui/sensitivity';

const input=(p=actualQuotesProject(),terms:CompareInput['incoterms']=['FOB']):CompareInput=>({trade:toTrade(p),template:toScenario(p),scenarios:toScenarios(p),anchor:p.anchor,incoterms:terms,taxProfile:p.tax_profile,fxBooks:p.fx_books});
const freight=(id='buyer-freight'):SensitivityRequest=>({variable:{kind:'FREIGHT',cost_id:id},range:{from:'-10',to:'10',step:'10'}});
const plus=(result:ReturnType<typeof runSensitivity>)=>result.points.find(p=>p.change==='10')!.rows[0]!;
function foreignProject():ProjectFile {
  const p=actualQuotesProject();p.incoterm='FOB';p.anchor={kind:'FIXED_QUOTE'};delete p.term_scenarios;
  p.goods.trade_value={amount:'10000',currency:'USD'};p.quote={amount:'10000',currency:'USD',fx_type:'CONTRACT'};
  p.items=[makeCostItem({cost_id:'freight',cost_name:'运费',cost_category:'MAIN_CARRIAGE',trade_node:'MAIN_CARRIAGE',amount:'1000',currency:'USD',fx_type:'CONTRACT',customs_value:'ADD'})];
  p.fx_books=[{id:'contract',name:'商业合同',type:'CONTRACT',date:'2026-09-01',rates:{'USD/CNY':'7'}},{id:'customs',name:'海关',type:'CUSTOMS',date:'2026-09-01',valid_from:'2026-09-01',valid_to:'2026-09-30',rates:{'USD/CNY':'7.1'}}];
  return p;
}
const fx=(book_id:string,pair='USD/CNY'):SensitivityRequest=>({variable:{kind:'FX',book_id,pair},range:{from:'0',to:'10',step:'10'}});

describe('数值范围及输入边界',()=>{
  it.each([
    [{from:'',to:'10',step:'5'},'有限数字'],[{from:'NaN',to:'10',step:'5'},'有限数字'],
    [{from:'0',to:'Infinity',step:'5'},'有限数字'],[{from:'0',to:'10',step:'0'},'步长'],
    [{from:'0',to:'10',step:'-1'},'步长'],[{from:'10',to:'0',step:'5'},'结束'],
    [{from:'-101',to:'0',step:'1'},'低于-100'],[{from:'0',to:'10',step:'3'},'整除'],
    [{from:'0',to:'21',step:'1'},'21个']
  ])('范围%s应阻断',(range,message)=>expect(()=>sensitivityOffsets({...freight(),range})).toThrow(message));
  it('精确小数、单点和21点上限；不强制范围包含0',()=>{
    expect(sensitivityOffsets({...freight(),range:{from:'-0.3',to:'0.3',step:'0.1'}})).toEqual(['-0.3','-0.2','-0.1','0','0.1','0.2','0.3']);
    expect(sensitivityOffsets({...freight(),range:{from:'10',to:'10',step:'5'}})).toEqual(['10']);
    expect(sensitivityOffsets({...freight(),range:{from:'0',to:'20',step:'1'}})).toHaveLength(21);
  });
  it('运费可归零，汇率不能归零',()=>{
    expect(sensitivityOffsets({...freight(),range:{from:'-100',to:'-100',step:'1'}})).toEqual(['-100']);
    expect(()=>sensitivityOffsets({...fx('customs'),range:{from:'-100',to:'0',step:'10'}})).toThrow('大于-100');
  });
  it('未知、零和负基准的差额/百分比保留语义',()=>{
    expect(metricChange(null,d(1)).delta).toBeNull();expect(metricChange(d(0),null).percent).toBeNull();
    expect(metricChange(d(10),d(0)).percent).toBeNull();expect(metricChange(d(-90),d(-100)).percent!.toString()).toBe('10');
  });
});

describe('运费假设与手算',()=>{
  it('FOB买方运费+100，税基+100，关税+5，VAT+13.65，总支付+118.65',()=>{
    const result=runSensitivity(input(),freight()),row=plus(result);
    expect(result.baseline.rows[0]!.payment.value!.toString()).toBe('13170.15');
    expect(row.payment.value!.toString()).toBe('13288.8');expect(row.payment.delta!.toString()).toBe('118.65');
    expect(row.tax.delta!.toString()).toBe('18.65');expect(row.dutiable.delta!.toString()).toBe('100');
    expect(row.quote.delta!.isZero()).toBe(true);expect(row.profit.value).toBeNull();expect(row.profit.delta).toBeNull();
  });
  it('实际CIF卖方运费+60使利润下降，报价不改；报价勾稽检查保留',()=>{
    const p=actualQuotesProject();p.incoterm='CIF';p.goods.seller_goods_cost.amount='8000';
    const result=runSensitivity(input(p,['CIF']),freight('seller-freight')),r=plus(result);
    expect(r.quote.value!.toString()).toBe('10700');expect(r.profit.delta!.toString()).toBe('-60');
    expect(r.payment.delta!.toString()).toBe('11.19');expect(r.tax.delta!.toString()).toBe('11.19');
    expect(r.checks_passed).toBe(false);expect(r.issues.join(' ')).toMatch(/勾稽|报价/);
  });
  it.each(['FIXED','ACTUAL','QTY_X_UNIT','PERCENT','PER_DAY','TIERED'] as const)('%s只缩放金额/费率且重算依赖费用',(pricing_method)=>{
    const p=actualQuotesProject();p.incoterm='FOB';p.items[1]={...p.items[1]!,pricing_method,amount:'1000',quantity:'10',rate:pricing_method==='PERCENT'?'0.1':'100',days:'10',calculation_base:{kind:'GOODS_VALUE'},tiers:[{up_to:null,rate:'100'}]};
    p.items.push(makeCostItem({cost_id:'dependent',trade_node:'IMPORT_CLEARANCE',cost_category:'IMPORT_CLEARANCE',pricing_method:'PERCENT',rate:'0.1',calculation_base:{kind:'COST_ITEMS',ids:['buyer-freight']},amount:undefined}));
    const r=plus(runSensitivity(input(p),freight()));expect(r.dutiable.delta!.toString()).toBe('100');expect(r.payment.delta!.toString()).toBe('128.65');
  });
  it('阶梯高档择低、含于父项去重及原币缩放不被覆盖成固定费',()=>{
    const p=foreignProject();p.items[0]={...p.items[0]!,pricing_method:'TIERED',tier_mode:'FLAT',tier_charge_lower:true,quantity:'9',tiers:[{up_to:'10',rate:'100'},{up_to:null,rate:'50'}]};
    const r=plus(runSensitivity(input(p),freight('freight')));expect(r.dutiable.delta!.toString()).toBe('355');
    const q=actualQuotesProject();q.items.push(makeCostItem({cost_id:'child',cost_category:'MAIN_CARRIAGE',trade_node:'MAIN_CARRIAGE',amount:'100',contained_in_cost_id:'buyer-freight',customs_value:'ADD',applicable_incoterms:['FOB']}));
    const child=plus(runSensitivity(input(q),freight('child')));expect(child.payment.delta!.isZero()).toBe(true);expect(child.tax.delta!.isZero()).toBe(true);
  });
  it('其他术语未启用的替代运价保持原结果，互斥冲突不能假设分析抹去',()=>{
    const r=runSensitivity(input(actualQuotesProject(),['FOB','CIF']),freight());
    expect(r.points.find(p=>p.change==='10')!.rows.find(r=>r.incoterm==='CIF')!.payment.delta!.isZero()).toBe(true);
    const p=actualQuotesProject();p.items[0]!.applicable_incoterms=['FOB'];
    expect(()=>runSensitivity(input(p),freight())).toThrow(/未.*启用|无法计算/);
  });
  it.each(['missing','insurance'])('非运费对象%s不静默成功',(id)=>expect(()=>runSensitivity(input(),freight(id))).toThrow());
  it('退款与空运价阻断，-100%运费归零仍重核税额',()=>{
    const p=actualQuotesProject();p.items[1]!.amount='-100';expect(()=>runSensitivity(input(p),freight())).toThrow('退款');
    const r=runSensitivity(input(),{...freight(),range:{from:'-100',to:'-100',step:'1'}}).points[0]!.rows[0]!;
    expect(r.dutiable.value!.toString()).toBe('10100');expect(r.payment.delta!.toString()).toBe('-1186.5');
  });
  it('零变化不重新量化输入，冻结基准与请求不被改变',()=>{
    const p=actualQuotesProject();p.items[1]!.amount='1000.1234567';const i=input(p),request=freight(),before=JSON.stringify({i,request});
    const freeze=(v:unknown):void=>{if(v&&typeof v==='object'){Object.freeze(v);Object.values(v).forEach(freeze);}};freeze(i);freeze(request);
    const r=runSensitivity(i,request);expect(r.points.find(p=>p.change==='0')!.rows).toEqual(r.baseline.rows);expect(JSON.stringify({i,request})).toBe(before);
  });
  it('单价为正但负计费量形成的退款运费同样不能作为运价涨跌',()=>{
    const p=actualQuotesProject();p.items[1]={...p.items[1]!,pricing_method:'QTY_X_UNIT',quantity:'-10',rate:'100',customs_value:'EXCLUDE'};
    expect(()=>runSensitivity(input(p),freight())).toThrow('退款或负运费');
  });
});

describe('商业与海关汇率独立',()=>{
  it('已确认汇率改变后快照不匹配，保留来源待办且不改变原确认',()=>{
    const p=foreignProject();
    for(const book of p.fx_books)book.evidence={'USD/CNY':syntheticEvidence(fxEvidenceValues({...book,from:'USD',to:'CNY',rate:book.rates['USD/CNY']}))};
    const before=JSON.stringify(p),r=runSensitivity(input(p),fx('customs'));
    expect(r.baseline.rows[0]!.checks_passed,r.baseline.rows[0]!.issues.join(' ')).toBe(true);expect(plus(r).checks_passed).toBe(false);expect(plus(r).issues.join(' ')).toMatch(/汇率.*变化|汇率.*核对/);expect(JSON.stringify(p)).toBe(before);
  });
  it('开启VAT抵扣不改变总支付差额，抵扣后只留下关税差额',()=>{
    const p=foreignProject();p.tax_profile.import.vatDeductibleForBuyer=true;
    const r=plus(runSensitivity(input(p),fx('customs')));expect(r.payment.delta!.toString()).toBe('1456.57');expect(r.net_payment.delta!.toString()).toBe('390.5');expect(r.checks_passed).toBe(false);
  });
  it('商业7→7.7只改变商业支付7700，海关税基78100和税款不变',()=>{
    const r=plus(runSensitivity(input(foreignProject()),fx('contract')));
    expect(r.payment.delta!.toString()).toBe('7700');expect(r.quote.delta!.toString()).toBe('7000');expect(r.tax.delta!.isZero()).toBe(true);expect(r.dutiable.delta!.isZero()).toBe(true);
  });
  it('海关7.1→7.81只改变税基7810，逐税舍入后的税款差1456.57，商业支付不随动',()=>{
    const result=runSensitivity(input(foreignProject()),fx('customs')),r=plus(result);
    expect(r.quote.delta!.isZero()).toBe(true);expect(r.dutiable.delta!.toString()).toBe('7810');expect(r.tax.delta!.toString()).toBe('1456.57');expect(r.payment.delta!.toString()).toBe('1456.57');
    expect(result.adjustment_note).toContain('不是可用于申报');
  });
  it('显式商业汇率及未用汇率行不被强行替换',()=>{
    const p=foreignProject();p.items[0]!.fx_rate='6';const r=plus(runSensitivity(input(p),fx('contract')));expect(r.payment.delta!.toString()).toBe('7000');
    p.fx_books[0]!.rates['EUR/CNY']='8';expect(plus(runSensitivity(input(p),fx('contract','EUR/CNY'))).payment.delta!.isZero()).toBe(true);
  });
  it('反向币种对仍按倒数换算；同时存在直向行时不伪造联动',()=>{
    const p=foreignProject();p.fx_books[0]!.rates={'CNY/USD':'0.125'};
    const r=plus(runSensitivity(input(p),fx('contract','CNY/USD')));expect(r.quote.value!.toString()).toBe('72727.27');
    p.fx_books[0]!.rates['USD/CNY']='7';expect(plus(runSensitivity(input(p),fx('contract','CNY/USD'))).payment.delta!.isZero()).toBe(true);
  });
  it('日期保持且海关有效期失效继续阻断，改假设不补造核对',()=>{
    const p=foreignProject();p.tax_profile.import.declarationDate='2026-10-01';const r=runSensitivity(input(p),fx('customs'));
    expect(r.baseline.rows[0]!.feasible).toBe(false);expect(r.points.every(p=>p.rows.every(r=>!r.feasible&&r.payment.value===null))).toBe(true);
  });
  it('当前精度下汇率归零只失败该点，其他点仍可计算',()=>{
    const r=runSensitivity(input(foreignProject()),{...fx('customs'),range:{from:'-99.999999',to:'0',step:'99.999999'}});
    expect(r.points[0]!.error).toContain('为零');expect(r.points[0]!.rows).toEqual([]);expect(r.points[1]!.rows[0]!.feasible).toBe(true);
  });
  it.each(['CNY/CNY','invalid','EUR/CNY'])('不存在或无效汇率行%s明确拒绝',(pair)=>expect(()=>runSensitivity(input(foreignProject()),fx('customs',pair))).toThrow());
  it('汇率基准为零或表编号重复须拒绝',()=>{
    const p=foreignProject();p.fx_books[1]!.rates['USD/CNY']='0';expect(()=>runSensitivity(input(p),fx('customs'))).toThrow();
    p.fx_books[1]!.rates['USD/CNY']='7.1';p.fx_books.push({...p.fx_books[1]!});expect(()=>runSensitivity(input(p),fx('customs'))).toThrow('重复');
  });
});

describe('承担假设、反解基准与报告隔离',()=>{
  it('未决自愿保费两种承担分别重算，税基不变，真实合同确认不被伪造',()=>{
    const p=actualQuotesProject();delete p.term_scenarios!.FOB!.responsibility_overrides;
    const r=runSensitivity(input(p),{variable:{kind:'RESPONSIBILITY',cost_id:'insurance'},range:{from:'',to:'',step:''}});
    expect(r.baseline.rows[0]!.payment.value!.toString()).toBe('13070.15');
    expect(r.points[0]!.rows[0]!.payment.delta!.isZero()).toBe(true);expect(r.points[1]!.rows[0]!.payment.delta!.toString()).toBe('100');
    expect(r.points.every(point=>point.hypothetical&&!point.rows[0]!.checks_passed)).toBe(true);expect(r.points.every(point=>point.rows[0]!.tax.delta!.isZero())).toBe(true);
  });
  it('已明确承担的费用不作为未决费用选项',()=>expect(()=>runSensitivity(input(),{variable:{kind:'RESPONSIBILITY',cost_id:'buyer-freight'},range:{from:'',to:'',step:''}})).toThrow('未确定'));
  it('其他未决费用保持，基准为零时不输出无穷百分比',()=>{
    const p=actualQuotesProject();delete p.term_scenarios!.FOB!.responsibility_overrides;p.items.push(makeCostItem({cost_id:'unloading',trade_node:'FINAL_DELIVERY',amount:'200'}));p.incoterm='CIF';p.anchor={kind:'FIXED_QUOTE'};p.quote={amount:'0',currency:'CNY',fx_type:'CONTRACT'};
    const r=runSensitivity(input(p,['CIF']),{variable:{kind:'RESPONSIBILITY',cost_id:'unloading'},range:{from:'',to:'',step:''}});
    expect(r.points[1]!.rows[0]!.quote.percent).toBeNull();expect(renderSensitivityResult(r)).not.toMatch(/Infinity|NaN/);
  });
  it('固定买方支付反解报价保持目标，固定利润率按成本反解',()=>{
    const p=actualQuotesProject();p.incoterm='FOB';p.quote={amount:'10000',currency:'CNY',fx_type:'CONTRACT'};p.anchor={kind:'FIXED_MARKET_PRICE',buyer_total:'15000',currency:'CNY'};
    expect(plus(runSensitivity(input(p),freight())).payment.delta!.isZero()).toBe(true);
    p.anchor={kind:'FIXED_MARGIN_RATE',margin_rate:'0.2'};p.goods.seller_goods_cost.amount='8000';p.incoterm='CIF';p.quote={amount:'10700',currency:'CNY',fx_type:'CONTRACT'};
    const r=plus(runSensitivity(input(p,['CIF']),freight('seller-freight')));expect(r.quote.delta!.toString()).toBe('75');expect(r.profit.delta!.toString()).toBe('15');
  });
  it('缺报价或利润率反解条件时不拿旧金额填充失败行',()=>{
    const p=actualQuotesProject();delete p.term_scenarios!.FOB!.quote;
    expect(()=>runSensitivity(input(p),freight())).toThrow('无法计算');
    const q=foreignProject();q.anchor={kind:'FIXED_MARGIN_RATE',margin_rate:'0.2'};const r=runSensitivity(input(q),fx('customs'));
    expect(r.points.every(p=>p.rows.every(r=>!r.feasible&&r.profit.value===null))).toBe(true);
  });
  it('报告参数及结果来自快照，转义用户内容，无控件/脚本，不替换项目输入',()=>{
    const p=actualQuotesProject();p.incoterm='FOB';p.items[1]!.cost_name='<img src=x onerror=1>';const before=JSON.stringify(p),controls={...newSensitivityControls(),enabled:true,target:'buyer-freight'};
    const result=projectSensitivity(p,controls),html=createProjectReport(p,'2026-10-12',controls);
    expect(html).toContain('生成时的假设分析');expect(html).toContain('参数快照');expect(html).toContain('13,288.80');expect(html).toContain('&lt;img');expect(html).not.toMatch(/<script|<input|data-sensitivity-field=/);expect(JSON.stringify(p)).toBe(before);
    p.items[1]!.amount='9000';controls.to='999';expect(result.request.range.to).toBe('10');expect(html).toContain('13,288.80');
  });
  it('无效参数在内部报告保存错误及参数，不伪装成成功',()=>{
    const controls={...newSensitivityControls(),enabled:true,target:'buyer-freight',step:'0'};
    expect(createProjectReport(actualQuotesProject(),'2026-10-12',controls)).toContain('假设分析未完成');
  });
  it('基础校验不被新模块移除，零商品数量仍阻断',()=>{
    const p=foreignProject();p.goods.quantity='0';const r=runSensitivity(input(p),fx('customs'));expect(r.baseline.rows[0]!.issues.join(' ')).toContain('商品数量');expect(r.points.every(p=>p.rows.every(r=>!r.feasible))).toBe(true);
    expect(compare(input(actualQuotesProject())).columns[0]!.decision_ready).toBe(true);
  });
});
