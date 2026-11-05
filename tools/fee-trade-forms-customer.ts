/** Customer bytes are generated exclusively from the original closed public projection. */
import type { CustomerQuote } from '../src/domain/customer-quote';
import { requireCustomerQuoteView,type CustomerQuoteView } from '../src/data/customer-quote-view';
import { createCustomerQuoteDocument,customerQuoteFileName } from '../src/ui/customer-quote';
export type CustomerArtifactFormat='HTML'|'XLSX'|'PDF';
export interface CustomerArtifact {readonly name:string;readonly mime:string;readonly data:Uint8Array<ArrayBuffer>}
export async function tradeFormsCustomerArtifact(quote:CustomerQuote,generatedAt:string,view:CustomerQuoteView,format:CustomerArtifactFormat):Promise<CustomerArtifact>{
  requireCustomerQuoteView(view);const htmlName=customerQuoteFileName(quote,view);
  let data:Uint8Array<ArrayBuffer>,mime:string,name:string;
  if(format==='HTML'){data=new TextEncoder().encode(createCustomerQuoteDocument(quote,generatedAt,view));mime='text/html;charset=utf-8';name=htmlName;}
  else if(format==='XLSX'){const{createCustomerWorkbook}=await import('../src/ui/workbook-export');data=new Uint8Array(createCustomerWorkbook(quote,generatedAt,view));mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';name=htmlName.replace(/\.html$/,'.xlsx');}
  else if(format==='PDF'){const{createCustomerPdf}=await import('../src/ui/customer-pdf');data=await createCustomerPdf(quote,generatedAt,view);mime='application/pdf';name=htmlName.replace(/\.html$/,'.pdf');}
  else throw Error('客户导出格式无效');
  if(data.byteLength>16*1024*1024)throw Error('客户文件超过16 MiB，请保留原文并减少公开文字后再导出');
  return Object.freeze({name,mime,data});
}
export function startTradeFormsCustomerDownload(file:CustomerArtifact):'DOWNLOAD_STARTED'{
  const url=URL.createObjectURL(new Blob([new Uint8Array(file.data)],{type:file.mime})),a=document.createElement('a');
  try{a.href=url;a.download=file.name;a.hidden=true;document.body.append(a);a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}
  return'DOWNLOAD_STARTED';
}
