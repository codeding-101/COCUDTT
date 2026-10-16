/** Layout preference only; never part of project or public quote data. */
export type CustomerQuoteView='full'|'compact';
export function requireCustomerQuoteView(value:unknown):CustomerQuoteView{
 if(value==='full'||value==='compact')return value;
 throw Error('客户报价版式无效，请选择简洁版或完整版');
}
export const customerQuoteViewLabel=(view:CustomerQuoteView):string=>requireCustomerQuoteView(view)==='compact'?'简洁版':'完整版';
