/** Independent internal inputs. Never a project, customer document or persisted approval. */
import { parseFeeEnvelopeJson } from '../src/data/fee-envelope-json';
import { CUSTOMER_QUOTE_FIELDS,emptyCustomerQuoteFields,type CustomerQuoteFields } from '../src/domain/customer-quote';
import { requireCustomerQuoteView,type CustomerQuoteView } from '../src/data/customer-quote-view';
import { newSensitivityControls,type SensitivityControls } from '../src/ui/sensitivity';
import { feeBrowserNativeUtf8Bytes } from './fee-browser-native-codec';

export const TRADE_FORMS_INPUT_BYTES=4*1024*1024;
export interface TradeFormsInput {
  version:'1.0';kind:'INTERNAL_TRADE_FORM_INPUTS';scope:'INTERNAL_INPUTS_ONLY';
  sensitivity:SensitivityControls;customer_fields:CustomerQuoteFields;customer_view:CustomerQuoteView;
  customer_review_required:true;financial_writes:0;import_authority:false;confirmation_authority:false;customer_document:false;
}
export class TradeFormsFormatError extends Error {constructor(readonly code:string){super('TRADE_FORMS_FORMAT_'+code);}}
function fail(code:string):never{throw new TradeFormsFormatError(code);}
function fields(value:unknown,names:readonly string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))fail('SHAPE');const d=value as Record<string,unknown>;if(Object.keys(d).length!==names.length||names.some(k=>!Object.hasOwn(d,k)))fail('FIELDS');return d;}
export function newTradeFormsInput():TradeFormsInput{return{version:'1.0',kind:'INTERNAL_TRADE_FORM_INPUTS',scope:'INTERNAL_INPUTS_ONLY',sensitivity:newSensitivityControls(),customer_fields:emptyCustomerQuoteFields(),customer_view:'full',customer_review_required:true,financial_writes:0,import_authority:false,confirmation_authority:false,customer_document:false};}
export function validateTradeFormsInput(value:unknown):asserts value is TradeFormsInput {
  const d=fields(value,['version','kind','scope','sensitivity','customer_fields','customer_view','customer_review_required','financial_writes','import_authority','confirmation_authority','customer_document']);
  if(d.version!=='1.0'||d.kind!=='INTERNAL_TRADE_FORM_INPUTS'||d.scope!=='INTERNAL_INPUTS_ONLY')fail('VERSION');
  if(d.customer_review_required!==true||d.financial_writes!==0||d.import_authority!==false||d.confirmation_authority!==false||d.customer_document!==false)fail('AUTHORITY');
  const s=fields(d.sensitivity,['enabled','kind','target','from','to','step']);
  if(typeof s.enabled!=='boolean'||!['FREIGHT','FX','RESPONSIBILITY'].includes(s.kind as string))fail('SENSITIVITY');
  for(const key of['target','from','to','step'])if(typeof s[key]!=='string'||(s[key]as string).length>4000)fail('TEXT');
  const c=fields(d.customer_fields,CUSTOMER_QUOTE_FIELDS);
  for(const key of CUSTOMER_QUOTE_FIELDS)if(typeof c[key]!=='string'||(c[key]as string).length>4000)fail('TEXT');
  requireCustomerQuoteView(d.customer_view);
}
export function readTradeFormsInput(raw:string):TradeFormsInput {
  if(typeof raw!=='string'||raw.length>TRADE_FORMS_INPUT_BYTES||feeBrowserNativeUtf8Bytes(raw)>TRADE_FORMS_INPUT_BYTES)fail('FILE_SIZE');
  const d=parseFeeEnvelopeJson(raw,TRADE_FORMS_INPUT_BYTES);validateTradeFormsInput(d);return d;
}
export function writeTradeFormsInput(value:TradeFormsInput):string {validateTradeFormsInput(value);const raw=JSON.stringify(value,null,2)+'\n';readTradeFormsInput(raw);return raw;}
