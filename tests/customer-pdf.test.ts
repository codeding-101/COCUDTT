import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, decodePDFRawStream, PDFRawStream } from 'pdf-lib';
import { actualQuotesProject } from './fixtures/actual-quotes';
import { emptyCustomerQuoteFields } from '../src/domain/customer-quote';
import { projectCustomerQuote } from '../src/data/customer-quote';
import { customerDocument } from '../src/data/customer-document';
import { createCustomerPdf, layoutCustomerPdf, wrapPdfText } from '../src/ui/customer-pdf';
import { createCustomerQuoteDocument } from '../src/ui/customer-quote';

const quote=()=>{const p=actualQuotesProject();p.incoterm='FOB';return projectCustomerQuote(p,{...emptyCustomerQuoteFields(),reference:'PUBLIC-PDF-001',issuer:'公开公司',recipient:'公开客户',remarks:'合成条款，待双方确认'});};
const measure=(text:string,size:number)=>Array.from(text).length*size;
describe('PDF公开模型与布局',()=>{
  it('公开内容和HTML逐项一致；精度、有效期、条款及风险说明不反推',()=>{
    const q=quote();q.quote.amount='12345.1234567';const content=customerDocument(q,'2026-10-12'),html=createCustomerQuoteDocument(q,'2026-10-12');expect(content.rows.find(r=>r[0]==='报价总额（原币）')![1]).toBe('12,345.1234567 CNY');expect(content.pending.some(v=>v.includes('生成日期不在'))).toBe(true);for(const [label,value]of content.rows){expect(html).toContain(label);if(value)expect(html).toContain(value);}expect(content.standard[0]).toContain('风险转移');
  });
  it('HTML标签及网址仅为可见文字，不进入执行对象',()=>{const q=quote();q.terms.remarks='<script>alert(1)</script> https://example.invalid';const content=customerDocument(q);expect(content.rows.at(-1)![1]).toBe(q.terms.remarks);});
  it('长条款分行分段分页，重复表头/行名，文本不丢失、不压缩字号',()=>{
    const q=quote();q.terms.remarks='长条款完整保留，仍需确认。'.repeat(240);const layout=layoutCustomerPdf(customerDocument(q,'2026-09-10'),measure);expect(layout.pages.length).toBeGreaterThan(2);const fragments=layout.pages.flatMap(p=>p.texts).filter(t=>t.kind==='body'&&t.x===44+122+8).map(t=>t.text).join('');expect(fragments).toContain(q.terms.remarks);expect(layout.pages.slice(1).some(p=>p.texts.some(t=>t.text==='项目'))).toBe(true);expect(layout.pages.flatMap(p=>p.texts).some(t=>t.text.includes('（续）'))).toBe(true);expect(layout.pages.flatMap(p=>p.texts).filter(t=>t.kind==='body').every(t=>t.size>=10.5)).toBe(true);
  });
  it('全部文字和行框在A4页内，页脚与正文有间隔',()=>{
    const q=quote();q.terms.payment='付款安排\n'.repeat(120);const layout=layoutCustomerPdf(customerDocument(q),measure);for(const p of layout.pages){for(const t of p.texts){expect(t.x).toBeGreaterThanOrEqual(44);expect(t.x+measure(t.text,t.size)).toBeLessThanOrEqual(layout.width-44+0.01);expect(t.y).toBeGreaterThanOrEqual(t.kind==='footer'?34:62);expect(t.y+t.size).toBeLessThan(layout.height-30);}for(const b of p.boxes){expect(b.y).toBeGreaterThanOrEqual(62);expect(b.x+b.width).toBeLessThanOrEqual(layout.width-44+0.01);}}expect(layout.pages.every(p=>p.texts.some(t=>t.kind==='footer'))).toBe(true);
  });
  it('80页上限明确阻断，不返回截断文档',()=>{const q=quote();q.terms.remarks='\n'.repeat(10000);expect(()=>layoutCustomerPdf(customerDocument(q),measure)).toThrow('超过80页');});
  it.each(['中文、英文 ABC 123','长单词'+'A'.repeat(200),'第一行\n\n第三行','字段\t内容','中文😀尾字'])('Unicode/空行/长串%s逐字符完整换行',(value)=>{const lines=wrapPdfText(value,60,t=>Array.from(t).length*10);expect(lines.join('')).toBe(value.replaceAll('\n','').replaceAll('\t','    '));expect(lines.every(v=>measure(v,10)<=60)).toBe(true);});
  it('非法宽度和超宽单字符明确失败',()=>{expect(()=>wrapPdfText('X',0,()=>10)).toThrow('宽度');expect(()=>wrapPdfText('X',5,()=>10)).toThrow('单个字符');});
});

describe('原生PDF文件及隐私边界',()=>{
  it('有效PDF可重新读取，只有公开标题和固定metadata，无附件/动作/表单/XMP',async()=>{
    const q=quote();Object.assign(q,{project:{private:'PRIVATE_PROJECT_819'},notes:'PRIVATE_NOTES_621',source:'PRIVATE_SOURCE_118'});
    const bytes=await createCustomerPdf(q,'2026-09-10'),doc=await PDFDocument.load(bytes);expect(new TextDecoder().decode(bytes.slice(0,8))).toContain('%PDF-');expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);expect(doc.getTitle()).toBe('PUBLIC-PDF-001 · 报价草稿');expect(doc.getAuthor()).toBe('');expect(doc.getCreator()).toBe('COCUDTT');for(const key of ['Names','OpenAction','AA','AcroForm','Metadata'])expect(doc.catalog.has(PDFName.of(key))).toBe(false);
    const decoded=doc.context.enumerateIndirectObjects().map(([,object])=>object instanceof PDFRawStream?new TextDecoder().decode(decodePDFRawStream(object).decode()):object.toString()).join('\n');expect(decoded).not.toMatch(/PRIVATE_|seller_goods_cost|quote_evidence|values_key|EmbeddedFiles|JavaScript/);expect(decoded).toContain('ToUnicode');
  });
  it('嵌入经审查的完整本地TrueType资源并保留Unicode映射，避免子集字形错位',async()=>{const bytes=await createCustomerPdf(quote(),'2026-09-10');expect(bytes.length).toBeGreaterThan(1400000);expect(bytes.length).toBeLessThan(1600000);const doc=await PDFDocument.load(bytes);const objects=doc.context.enumerateIndirectObjects().map(([,o])=>o.toString()).join('');expect(objects).toContain('/ToUnicode');expect(objects).toContain('/FontFile2');expect(objects).toContain('/CIDToGIDMap /Identity');});
  it('生成时先复制内容，等待期间编辑不会改变标题或页内输入',async()=>{const q=quote(),promise=createCustomerPdf(q,'2026-09-10');q.reference='CHANGED';q.quote.amount='1';q.terms.remarks='CHANGED';const doc=await PDFDocument.load(await promise);expect(doc.getTitle()).toBe('PUBLIC-PDF-001 · 报价草稿');});
  it.each(['😀','𠮷','\u202E','\u0000','\uD800'])('不支持的字符%s明确退出，不输出缺字或静默删字',async(value)=>{const q=quote();q.terms.remarks=value;await expect(createCustomerPdf(q)).rejects.toThrow(/不支持|双向文字/);expect(q.terms.remarks).toBe(value);});
  it('非法生成日期和极长内容明确拒绝',async()=>{await expect(createCustomerPdf(quote(),'invalid')).rejects.toThrow('生成时间');const q=quote();q.terms.remarks='文字'.repeat(61000);await expect(createCustomerPdf(q)).rejects.toThrow('120000');});
  it('CIF/CIP保险提示、C类风险分离、DDP进口费用与法定资格仍分开',()=>{for(const term of ['CIF','CIP','DDP'] as const){const q=quote();q.quote.incoterm=term;q.standard.insurance_obligation=term==='CIF'?'ICC_C':term==='CIP'?'ICC_A':null;q.standard.freight_risk_separated=term!=='DDP';q.standard.import_cost_bearer=term==='DDP'?'SELLER':'BUYER';const c=customerDocument(q);expect(c.standard.join('')).toContain('不自动确定法定纳税人');if(term!=='DDP'){expect(c.standard.join('')).toContain('不代表货损风险');expect(c.standard.join('')).toContain(term==='CIF'?'(C)':'(A)');}}});
});
