import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { unzlibSync } from 'fflate';
import fontData from '../assets/fonts/quote-sans.base64.txt?raw';
import { customerDocument, type CustomerDocument } from '../data/customer-document.js';
import type { CustomerQuote } from '../domain/customer-quote.js';

export const PDF_MIME='application/pdf';
export class CustomerPdfError extends Error {}
const fail=(message:string):never=>{throw new CustomerPdfError(message);};
const WIDTH=595.28,HEIGHT=841.89,MARGIN=44,BOTTOM=62,TOP=752,SIZE=10.5,LEADING=17,LABEL_WIDTH=122,PADDING=8;
const CONTENT_WIDTH=WIDTH-MARGIN*2;
let decodedFont:Uint8Array|null=null;
function fontBytes():Uint8Array {
  if(!decodedFont){const binary=atob(fontData.trim()),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);decodedFont=unzlibSync(bytes);}
  return decodedFont;
}
export function wrapPdfText(text:string,width:number,measure:(text:string)=>number):string[] {
  if(!Number.isFinite(width)||width<=0)return fail('PDF排版宽度无效');
  const lines:string[]=[];
  for(const paragraph of text.replace(/\r\n?/g,'\n').replace(/\t/g,'    ').split('\n')){
    let line='',length=0;
    for(const character of paragraph){const size=measure(character);if(size>width)return fail('PDF单个字符无法放入页面');if(line&&length+size>width+0.0001){lines.push(line);line='';length=0;}line+=character;length+=size;}
    lines.push(line);
  }
  return lines;
}
export interface PdfText { x:number;y:number;size:number;text:string;kind:'header'|'body'|'table-header'|'footer' }
export interface PdfBox { x:number;y:number;width:number;height:number;shade:boolean }
export interface PdfLayoutPage { texts:PdfText[];boxes:PdfBox[] }
export interface CustomerPdfLayout { pages:PdfLayoutPage[];width:number;height:number }

/** Pure public-text layout; split long rows with repeated labels/headers, never shrink type. */
export function layoutCustomerPdf(content:CustomerDocument,measure:(text:string,size:number)=>number):CustomerPdfLayout {
  const pages:PdfLayoutPage[]=[];let page:PdfLayoutPage;let y=TOP;
  const text=(value:string,x:number,baseline:number,size=SIZE,kind:PdfText['kind']='body')=>{if(value)page.texts.push({x,y:baseline,size,text:value,kind});};
  function newPage(table=false):void {
    if(pages.length>=80)return fail('报价说明超过80页，请减少公开文字后再导出');
    page={texts:[],boxes:[]};pages.push(page);y=TOP;
    text('客户报价说明 · 草稿',MARGIN,HEIGHT-52,17,'header');text('供双方复核；尚不表示已签署合同或确认全部履约条件。',MARGIN,HEIGHT-74,9,'header');
    if(table)tableHeader();
  }
  function tableHeader():void {page.boxes.push({x:MARGIN,y:y-26,width:CONTENT_WIDTH,height:26,shade:true});text('项目',MARGIN+PADDING,y-18,SIZE,'table-header');text('公开内容',MARGIN+LABEL_WIDTH+PADDING,y-18,SIZE,'table-header');y-=26;}
  function row(label:string,value:string):void {
    const values=wrapPdfText(value||'待双方确认',CONTENT_WIDTH-LABEL_WIDTH-PADDING*2,t=>measure(t,SIZE));let offset=0;
    while(offset<values.length){
      const labels=wrapPdfText(label+(offset?'（续）':''),LABEL_WIDTH-PADDING*2,t=>measure(t,SIZE));
      let capacity=Math.floor((y-BOTTOM-PADDING*2)/LEADING);
      if(capacity<Math.max(2,labels.length)){newPage(true);capacity=Math.floor((y-BOTTOM-PADDING*2)/LEADING);}
      const count=Math.min(values.length-offset,capacity),lineCount=Math.max(count,labels.length),height=lineCount*LEADING+PADDING*2;
      page.boxes.push({x:MARGIN,y:y-height,width:LABEL_WIDTH,height,shade:true},{x:MARGIN+LABEL_WIDTH,y:y-height,width:CONTENT_WIDTH-LABEL_WIDTH,height,shade:false});
      labels.forEach((line,i)=>text(line,MARGIN+PADDING,y-PADDING-SIZE-i*LEADING));
      values.slice(offset,offset+count).forEach((line,i)=>text(line,MARGIN+LABEL_WIDTH+PADDING,y-PADDING-SIZE-i*LEADING));
      y-=height;offset+=count;if(offset<values.length)newPage(true);
    }
  }
  function paragraph(value:string):void {for(const line of wrapPdfText(value,CONTENT_WIDTH,t=>measure(t,SIZE))){if(y-LEADING<BOTTOM)newPage();text(line,MARGIN,y-SIZE);y-=LEADING;}y-=7;}
  function heading(value:string):void {if(y-LEADING*3<BOTTOM)newPage();y-=12;text(value,MARGIN,y,12);y-=25;}
  newPage();paragraph('生成时间（ISO时间戳）：'+content.generatedAt);tableHeader();content.rows.forEach(([label,value])=>row(label,value));
  heading('术语标准提示');content.standard.forEach(paragraph);
  heading('待双方确认');(content.pending.length?content.pending:['当前填写及核对未发现额外待办；实际合同与履约安排仍须双方确认。']).forEach((value,i)=>paragraph(`${i+1}. ${value}`));
  heading('使用说明');paragraph(content.disclaimer);paragraph(content.precision);
  pages.forEach((p,i)=>{p.texts.push({x:MARGIN,y:34,size:9,text:`客户报价草稿 · 第 ${i+1} / ${pages.length} 页`,kind:'footer'});});
  return {pages,width:WIDTH,height:HEIGHT};
}
function validateGlyphs(content:CustomerDocument,font:PDFFont):void {
  const all=[content.reference,content.generatedAt,...content.rows.flat(),...content.standard,...content.pending,content.disclaimer,content.precision].join('\n');
  if(all.length>120000)return fail('公开报价说明超过120000字符，请缩短后导出');
  if(/[\u202A-\u202E\u2066-\u2069]/.test(all))return fail('PDF暂不支持双向文字控制符；请保留原文并使用HTML或Excel导出');
  const available=new Set(font.getCharacterSet());
  for(const character of all){if(['\n','\r','\t'].includes(character))continue;const point=character.codePointAt(0)!;if(!available.has(point))return fail(`PDF字体不支持字符 U+${point.toString(16).toUpperCase()}；原文未改，请使用HTML或Excel导出`);}
}
function draw(page:PDFPage,layout:PdfLayoutPage,font:PDFFont):void {
  for(const box of layout.boxes)page.drawRectangle({x:box.x,y:box.y,width:box.width,height:box.height,borderColor:rgb(.83,.87,.91),borderWidth:.5,...(box.shade?{color:rgb(.95,.97,.99)}:{})});
  for(const entry of layout.texts)page.drawText(entry.text,{x:entry.x,y:entry.y,font,size:entry.size,color:entry.kind==='header'?rgb(.14,.26,.41):rgb(.09,.14,.22)});
}
export async function createCustomerPdf(quote:CustomerQuote,generatedAt=new Date().toISOString()):Promise<Uint8Array<ArrayBuffer>> {
  // Build all primitive strings before the first await: edits cannot change this document.
  const content=customerDocument(quote,generatedAt),date=new Date(generatedAt);if(Number.isNaN(date.getTime()))return fail('PDF生成时间无效');
  const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
  // Embed the already reduced, reviewed resource intact: fontkit subsetting caused
  // missing/misnumbered glyphs in independent rendering despite valid text extraction.
  const font=await doc.embedFont(fontBytes(),{subset:false,customName:'COCUDTTQuoteSansSC'});validateGlyphs(content,font);
  const layout=layoutCustomerPdf(content,(text,size)=>font.widthOfTextAtSize(text,size));
  doc.setTitle((content.reference||'客户报价说明')+' · 报价草稿');doc.setAuthor('');doc.setCreator('COCUDTT');doc.setProducer('COCUDTT PDF');doc.setSubject('客户公开报价说明草稿');doc.setKeywords([]);doc.setLanguage('zh-CN');doc.setCreationDate(date);doc.setModificationDate(date);
  for(const page of layout.pages)draw(doc.addPage([layout.width,layout.height]),page,font);
  return new Uint8Array(await doc.save());
}
