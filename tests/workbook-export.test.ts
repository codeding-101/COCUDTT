import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { actualQuotesProject } from './fixtures/actual-quotes';
import { chinaImportSampleProjectFile } from '../src/data/sample-project';
import { emptyCustomerQuoteFields } from '../src/domain/customer-quote';
import { projectCustomerQuote } from '../src/data/customer-quote';
import { compareProject, customerWorkbook, internalWorkbook } from '../src/data/workbook-snapshot';
import { decimalCell, excelDecimal, serializeWorkbook, textCell, type WorkbookSnapshot } from '../src/data/xlsx-file';
import { createCustomerWorkbook, createInternalWorkbook, internalWorkbookSnapshot } from '../src/ui/workbook-export';
import { newSensitivityControls } from '../src/ui/sensitivity';
import { serializeProject } from '../src/data/project-file';

const project=()=>{const p=actualQuotesProject();p.incoterm='FOB';return p;};
const fields=()=>({...emptyCustomerQuoteFields(),reference:'PUBLIC-Q-001',remarks:'公开备注'});
const parts=(bytes:Uint8Array)=>Object.fromEntries(Object.entries(unzipSync(bytes)).map(([k,v])=>[k,strFromU8(v)]));
const workbook=(rows=[ [textCell('字段'),textCell('内容')] ]):WorkbookSnapshot=>({audience:'CUSTOMER',title:'示例',generatedAt:'2026-09-10',sheets:[{name:'客户报价',headers:['项目','值'],widths:[24,80],rows}]});
const lookup=(sheet:ReturnType<typeof internalWorkbook>['sheets'][number],key:string)=>sheet.rows.find(r=>r[0]!.value===key)!;

describe('客户 Excel 字段边界',()=>{
  it('解压全部部件，采购/来源/合同/备注/未知扩展/项目名不进入客户文件',()=>{
    const p=project();p.name='PRIVATE_NAME_317';p.goods.seller_goods_cost.amount='82763.128';p.items[0]!.cost_name='PRIVATE_COST_781';p.items[1]!.notes='PRIVATE_NOTE_912';p.term_scenarios!.FOB!.quote_evidence!.reference='PRIVATE_EVIDENCE_871';p.term_scenarios!.FOB!.responsibility_overrides!.insurance!.reason='PRIVATE_CONTRACT_173';
    const quote=projectCustomerQuote(p,fields());Object.assign(quote,{private:'PRIVATE_EXTRA_872',project:p});
    const files=parts(createCustomerWorkbook(quote,'2026-09-10')),all=Object.values(files).join('');
    expect(all).toContain('PUBLIC-Q-001');expect(all).toContain('<v>10000</v>');expect(all).not.toMatch(/PRIVATE_|82763\.128|seller_goods_cost|quote_evidence|values_key|完整项目JSON/);
    expect(Object.keys(files)).toEqual(['[Content_Types].xml','_rels/.rels','xl/workbook.xml','xl/_rels/workbook.xml.rels','xl/styles.xml','xl/worksheets/sheet1.xml']);
    expect(all).not.toMatch(/<f[ >]|TargetMode="External"|hidden|comments|vbaProject|creator/);
    expect(Object.values(parts(createInternalWorkbook(p))).join('')).toContain('PRIVATE_EVIDENCE_871');
  });
  it('实际金额/数量和币种来自公开投影，独立于内部货值与基准币种',()=>{
    const p=project();p.term_scenarios!.FOB!.quote!.amount='12345.1234567';p.term_scenarios!.FOB!.quote!.currency='USD';p.goods.quantity='3';const q=projectCustomerQuote(p,fields()),w=customerWorkbook(q,'2026-09-10');
    expect(lookup(w.sheets[0]!,'报价总额（原币）')[1]).toEqual(decimalCell('12345.1234567'));expect(lookup(w.sheets[0]!,'报价币种')[1]!.value).toBe('USD');expect(lookup(w.sheets[0]!,'数量')[1]).toEqual(decimalCell('3'));
  });
  it('有效期外提示不延长报价，缺公开条款不补造承诺',()=>{
    const w=customerWorkbook(projectCustomerQuote(project(),fields()),'2026-10-12');const text=JSON.stringify(w);expect(text).toContain('2026-09-01 至 2026-09-30');expect(text).toContain('生成日期不在');expect(text).toContain('待双方确认');expect(text).toContain('不构成法律');
  });
  it('冻结输入，后续编辑不改变已生成工作簿或压缩文件',()=>{
    const p=project(),q=projectCustomerQuote(p,fields()),before=JSON.stringify(p);Object.freeze(q);const w=customerWorkbook(q,'2026-09-10'),bytes=serializeWorkbook(w);p.term_scenarios!.FOB!.quote!.amount='1';expect(lookup(w.sheets[0]!,'报价总额（原币）')[1]!.value).toBe('10000');expect(parts(bytes)['xl/worksheets/sheet1.xml']).toContain('<v>10000</v>');expect(before).not.toBe(JSON.stringify(p));
  });
});

describe('内部 Excel 与引擎一致',()=>{
  it('逐术语对照核算报价、未知采购成本/利润、买方支付、税额与抵扣',()=>{
    const p=project(),comparison=compareProject(p),w=internalWorkbook(p,'2026-09-10');
    for(const c of comparison.columns){const row=lookup(w.sheets[1]!,c.incoterm);if(!c.available||!c.feasible){expect(row[5]!.value).toBe('无法计算');continue;}
      expect(row[5]!.value).toBe(c.quote_amount.toFixed());expect(row[6]!.value).toBe('未知');expect(row[8]!.value).toBe('未知');expect(row[9]!.value).toBe(c.buyer.landed_cost_with_tax.toFixed());expect(row[10]!.value).toBe(c.buyer.deductible_vat.toFixed());expect(row[11]!.value).toBe(c.buyer.landed_cost_ex_deductible.toFixed());expect(row[12]!.value).toBe(c.import_tax_total.toFixed());expect(row[14]!.value).toBe('不适用');
    }
  });
  it('费用逐项对照原币/核算金额、归属和汇总排除；未启用项不伪造零',()=>{
    const p=project(),w=internalWorkbook(p),c=compareProject(p);for(const column of c.columns){if(!column.result)continue;for(const item of column.result.items){const row=w.sheets[2]!.rows.find(r=>r[0]!.value===column.incoterm&&r[1]!.value===item.item.cost_id)!;expect(row[5]!.value).toBe(item.gross_amount.toFixed());expect(row[7]!.value).toBe(item.base_amount.toFixed());expect(row[10]!.value).toBe(item.counts_to_seller?'是':'否');expect(row[11]!.value).toBe(item.counts_to_buyer?'是':'否');expect(row[12]!.value).toBe(item.exclusion??'无排除');}}
    const inactive=w.sheets[2]!.rows.find(r=>r[0]!.value==='FOB'&&r[1]!.value==='seller-freight')!;expect(inactive[5]!.value).toBe('未解析');expect(inactive[10]!.value).toBe('否');
  });
  it('当前方案失败仍导出其他方案；失败金额不可沿用占位零',()=>{
    const p=project();p.term_scenarios!.FOB!.quote!.amount='';const w=internalWorkbook(p);const bad=lookup(w.sheets[1]!,'FOB'),good=lookup(w.sheets[1]!,'CIF');expect(bad[1]!.value).toBe('无法计算');expect(bad[5]!.value).toBe('无法计算');expect(good[5]!.value).toBe('10700');expect(w.sheets[2]!.rows.some(r=>r[0]!.value==='FOB')).toBe(false);
  });
  it('保留公式文本/代入值但不生成 Excel 可执行公式，也不把比例统一标成币种',()=>{
    const p=project(),w=internalWorkbook(p),rows=w.sheets[3]!.rows;const step=compareProject(p).columns.find(c=>c.incoterm==='FOB')!.result!.calculations[0]!.steps[0]!;expect(rows.some(r=>r[3]!.value===step.formula&&r[4]!.value===step.substitution)).toBe(true);expect(rows.some(r=>r[6]!.value==='见公式与代入值')).toBe(true);expect(Object.values(parts(serializeWorkbook(w))).join('')).not.toMatch(/<f[ >]/);
  });
  it('JSON归档逐片段拼接与完整输入一致，emoji边界不损坏',()=>{
    const p=project();p.name='示例😀'.repeat(90);const before=serializeProject(p),w=internalWorkbook(p);expect(w.sheets[5]!.rows.map(r=>r[1]!.value).join('')).toBe(before);expect(serializeProject(p)).toBe(before);
  });
  it('商业与海关汇率分别保留来源和计税组成，已有中国示例结果一致',()=>{
    const p=chinaImportSampleProjectFile(),w=internalWorkbook(p),c=compareProject(p);expect(JSON.stringify(w.sheets[4])).toContain('CUSTOMS');expect(JSON.stringify(w.sheets[4])).toContain('CONTRACT');const current=c.columns.find(c=>c.incoterm===p.incoterm)!;expect(lookup(w.sheets[1]!,p.incoterm)[9]!.value).toBe(current.buyer.landed_cost_with_tax.toFixed());expect(w.sheets[3]!.rows.some(r=>r[1]!.value==='完税价格组成')).toBe(true);
  });
  it('内部假设单独存档，失败参数有原因且不阻断实际对比；客户没有假设',()=>{
    const p=project(),before=JSON.stringify(p),good={...newSensitivityControls(),enabled:true,target:'buyer-freight'};const w=internalWorkbookSnapshot(p,'2026-09-10',good);expect(w.sheets.at(-1)!.name).toBe('假设分析');expect(JSON.stringify(w.sheets.at(-1))).toContain('不能作为确定推荐');expect(w.sheets.at(-1)!.rows.some(r=>r[1]!.value==='买方总支付')).toBe(true);
    const bad=internalWorkbookSnapshot(p,'2026-09-10',{...good,target:'missing'});expect(JSON.stringify(bad.sheets.at(-1))).toContain('假设未完成');expect(JSON.stringify(p)).toBe(before);expect(customerWorkbook(projectCustomerQuote(p,fields())).sheets).toHaveLength(1);
  });
});

describe('原生 XLSX 序列化边界',()=>{
  it.each(['=HYPERLINK("https://example.invalid","x")','+cmd','-cmd','@SUM(1,2)','\t=1+1','<x>&"','_x0001_'])('自由文本%s保留为字符串，不能执行公式或外链',(value)=>{
    const files=parts(serializeWorkbook(workbook([[textCell('文字'),textCell(value)]]))),xml=files['xl/worksheets/sheet1.xml']!;expect(xml).toContain('t="inlineStr"');expect(xml).not.toMatch(/<f[ >]|<hyperlink|TargetMode/);if(value==='_x0001_')expect(xml).toContain('_x005F_x0001_');
  });
  it.each(['0','-0.01','12345.1234567','999999999999999'])('金额%s为原生数字，不经JS浮点重写',(value)=>{expect(excelDecimal(value).numeric).toBe(true);const xml=parts(serializeWorkbook(workbook([[textCell('金额'),decimalCell(value)]])))['xl/worksheets/sheet1.xml']!;expect(xml).toContain(`<v>${value}</v>`);});
  it.each(['1234567890123456','0.0000000000001','1234567890.123456'])('超精度%s以原始文本保存',(value)=>{expect(excelDecimal(value).numeric).toBe(false);const xml=parts(serializeWorkbook(workbook([[textCell('金额'),decimalCell(value)]])))['xl/worksheets/sheet1.xml']!;expect(xml).toContain(`>${value}</t>`);expect(xml).toContain('s="3"');});
  it.each(['NaN','Infinity','1e6','1,000',''])('无效数值%s明确失败',(value)=>expect(()=>excelDecimal(value)).toThrow('有限十进制'));
  it('中文长文字分续行保留全量内容，冻结首行，列宽行高与尺寸存在',()=>{
    const text='中文长条款😀'.repeat(100),files=parts(serializeWorkbook(workbook([[textCell('条款'),textCell(text)]]))),xml=files['xl/worksheets/sheet1.xml']!;expect(xml).toContain('↳ 续行');expect(xml).toContain('state="frozen"');expect(xml).toContain('customHeight="1"');expect(xml).toContain('customWidth="1"');expect((xml.match(/😀/gu)??[])).toHaveLength(100);
  });
  it('控制字符编码为合法XML，非法表名/列数/尺寸明确拒绝',()=>{
    expect(parts(serializeWorkbook(workbook([[textCell('字段'),textCell('a\u0000b')]])))['xl/worksheets/sheet1.xml']).toContain('a_x0000_b');const w=workbook();w.sheets[0]!.name='bad/name';expect(()=>serializeWorkbook(w)).toThrow('名称');w.sheets[0]!.name='合法';w.sheets[0]!.widths=[];expect(()=>serializeWorkbook(w)).toThrow('尺寸');
  });
  it('第一列的长文字和其他列续行均保留，不被续行标记替代',()=>{
    const value='长编号'.repeat(100),xml=parts(serializeWorkbook(workbook([[textCell(value),textCell('短内容')]])))['xl/worksheets/sheet1.xml']!;expect((xml.match(/长编号/g)??[])).toHaveLength(100);
  });
  it('冻结列必须指向存在的列，非整数或越界值不会写坏工作簿',()=>{
    const w=workbook();w.sheets[0]!.freezeColumns=99;expect(()=>serializeWorkbook(w)).toThrow('冻结列');w.sheets[0]!.freezeColumns=0.5;expect(()=>serializeWorkbook(w)).toThrow('冻结列');
  });
  it('16位整数即使含大量尾零也以文本保存，避免Excel整数位限制',()=>{
    const value='1000000000000000';expect(excelDecimal(value).numeric).toBe(false);expect(parts(serializeWorkbook(workbook([[textCell('金额'),decimalCell(value)]])))['xl/worksheets/sheet1.xml']).toContain('>1000000000000000</t>');
  });
  it('原生数值的列宽随大金额扩展，不改变输入列宽或数值',()=>{
    const w=workbook([[textCell('金额'),decimalCell('999999999999999')]]);w.sheets[0]!.widths=[24,8];const xml=parts(serializeWorkbook(w))['xl/worksheets/sheet1.xml']!;expect(xml).toContain('max="2" width="25"');expect(xml).toContain('<v>999999999999999</v>');expect(w.sheets[0]!.widths).toEqual([24,8]);
  });
});
