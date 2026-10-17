import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {parseProject,toScenario,toTrade,type ProjectFile} from '../src/data/project-file';
import {analyze} from '../src/engine/analyze';
import {scenarioWithDerivedInclusions} from '../src/engine/compare';
const source=readFileSync(new URL('../docs/cases/china-import-walkthrough.project.json',import.meta.url),'utf8').replace(/\r\n/g,'\n');
interface Case {id:string;label:string;changes:{target:string;value:string}[];expected:{dutiable_value:string;duty:string;consumption_tax:string;vat:string;buyer_total:string;buyer_ex_deductible:string;delta_buyer:string;seller_margin:null};}
const record=JSON.parse(readFileSync(new URL('../docs/cases/china-import-walkthrough.expected.json',import.meta.url),'utf8')) as {kind:string;professional_review:string;real_documents:string;scenarios:Case[]};
function data(c:Case):ProjectFile {
 const p=parseProject(source);
 for(const change of c.changes){
  if(change.target==='CONTRACT_USD_CNY'||change.target==='CUSTOMS_USD_CNY')p.fx_books.find(b=>b.type===(change.target==='CONTRACT_USD_CNY'?'CONTRACT':'CUSTOMS'))!.rates['USD/CNY']=change.value;
  else if(change.target==='FREIGHT_USD')p.items.find(i=>i.cost_id==='freight')!.amount=change.value;
  else if(change.target==='QUOTE_USD')p.quote.amount=change.value;
  else throw Error('Unknown case change');
 }
 return p;
}
function run(p:ProjectFile){const trade=toTrade(p);return analyze({trade,scenario:scenarioWithDerivedInclusions(toScenario(p),trade),taxProfile:p.tax_profile,fxBooks:p.fx_books});}
/** Independent integer-cent arithmetic for this four-row example only; no Decimal/production tax functions. */
function reference(id:string){
 const quote=id==='requoted-freight'?109300n:108300n,freight=id==='requoted-freight'?9000n:8000n,customs=id==='customs-fx'?718n:708n,commercial=id==='commercial-fx'?720n:700n;
 const round=(cents:bigint,rate:bigint)=>(cents*rate+50n)/100n;
 const value=(100000n+freight+300n)*customs,duty=round(value,5n),vat=round(value+duty,13n),total=quote*commercial+duty+vat;
 const money=(n:bigint)=>`${n/100n}.${String(n%100n).padStart(2,'0')}`;
 return {dutiable_value:money(value),duty:money(duty),consumption_tax:'0.00',vat:money(vat),buyer_total:money(total),buyer_ex_deductible:money(total),delta_buyer:money(total-90110149n),seller_margin:null};
}
describe('reproducible China import buyer walkthrough',()=>{
 it.each(record.scenarios)('$id: manually recorded answers match independent integer arithmetic',c=>{expect(c.expected).toEqual(reference(c.id));});
 it.each(record.scenarios)('$id: application matches each answer and keeps profit unknown and decision provisional',c=>{
  const p=data(c),before=JSON.stringify(p),r=run(p);
  const actual={dutiable_value:r.dutiable_value.value.toFixed(2),duty:r.import_tax.duty.toFixed(2),consumption_tax:r.import_tax.consumption_tax.toFixed(2),vat:r.import_tax.vat.toFixed(2),buyer_total:r.buyer.landed_cost_with_tax.toFixed(2),buyer_ex_deductible:r.buyer.landed_cost_ex_deductible.toFixed(2)};
  for(const key of Object.keys(actual) as (keyof typeof actual)[])expect(actual[key],key).toBe(c.expected[key]);
  expect(r.seller.margin).toBeNull();expect(r.rebate.applicable).toBe(false);expect(r.seller.rebate_total.isZero()).toBe(true);expect(r.decision.ready).toBe(false);expect(r.decision.issues.join()).toContain('示例数据');expect(JSON.stringify(p)).toBe(before);
 });
 it('baseline is fixed, buyer-focused and explicitly non-professional/non-real',()=>{
  const p=parseProject(source);expect(p.schema_version).toBe('0.8');expect(p.updated_at).toBe('2026-10-17T00:00:00Z');expect(p.tax_profile.import.declarationDate).toBe('2026-09-10');expect(p.goods.seller_goods_cost.amount).toBe('');expect(p.tax_profile.import.vatDeductibleForBuyer).toBe(false);expect(record.kind).toBe('SYNTHETIC_IMPORT_WALKTHROUGH');expect(record.professional_review).toBe('NOT_PERFORMED');expect(record.real_documents).toBe('NOT_AVAILABLE');
 });
 it('each experiment starts with a detached baseline and does not accumulate prior FX changes',()=>{
  const a=data(record.scenarios[1]!),b=data(record.scenarios[2]!);a.fx_books[0]!.rates['USD/CNY']='999';expect(b.fx_books.find(b=>b.type==='CONTRACT')!.rates['USD/CNY']).toBe('7.0000');expect(data(record.scenarios[0]!).quote.amount).toBe('108300');expect(readFileSync(new URL('../docs/cases/china-import-walkthrough.project.json',import.meta.url),'utf8').replace(/\r\n/g,'\n')).toBe(source);
 });
 it('separate FX experiments affect only their intended price or tax path',()=>{
  const baseline=run(data(record.scenarios[0]!)),commercial=run(data(record.scenarios[1]!)),customs=run(data(record.scenarios[2]!));expect(commercial.dutiable_value.value.eq(baseline.dutiable_value.value)).toBe(true);expect(commercial.import_tax.vat.eq(baseline.import_tax.vat)).toBe(true);expect(customs.seller.revenue.eq(baseline.seller.revenue)).toBe(true);expect(customs.import_tax.vat.eq(baseline.import_tax.vat)).toBe(false);
 });
 it('changing freight does not automatically modify the recorded contract quote',()=>{
  const p=data(record.scenarios[0]!);p.items.find(i=>i.cost_id==='freight')!.amount='9000';run(p);expect(p.quote.amount).toBe('108300');const repriced=data(record.scenarios[3]!);expect(repriced.quote.amount).toBe('109300');
 });
 it.each(['missing-customs','zero-customs','zero-quantity'] as const)('invalid baseline %s must block calculation rather than fill a value',kind=>{
  const p=data(record.scenarios[0]!);if(kind==='missing-customs')p.fx_books=p.fx_books.filter(b=>b.type!=='CUSTOMS');if(kind==='zero-customs')p.fx_books.find(b=>b.type==='CUSTOMS')!.rates['USD/CNY']='0';if(kind==='zero-quantity')p.goods.quantity='0';expect(()=>run(p)).toThrow();
 });
 it('unconfirmed goods-price basis stays unconfirmed and cannot become a ready recommendation',()=>{const p=data(record.scenarios[0]!);p.goods.trade_value_basis='UNCONFIRMED';const r=run(p);expect(p.goods.trade_value_basis).toBe('UNCONFIRMED');expect(r.decision.ready).toBe(false);expect(r.decision.issues.join()).toMatch(/净价|货值|货物/);});
 it('embedded downloadable JSON is the exact issued project text',()=>{
  const html=readFileSync(new URL('../china-import-walkthrough.html',import.meta.url),'utf8');const href=html.match(/id="download-project"[^>]+href="data:application\/json;charset=utf-8,([^"]+)"/)![1]!;expect(decodeURIComponent(href)).toBe(source);expect(html).toContain('无法评估');expect(html).toContain('参考测算');
 });
 it('offline guide contains no script, active storage access, external assets or automatic import',()=>{
  const html=readFileSync(new URL('../china-import-walkthrough.html',import.meta.url),'utf8');expect(html).not.toMatch(/<script|<iframe|<form|\son\w+\s*=|\bsrc\s*=|url\(/i);expect(html).not.toContain('localStorage');expect(html).not.toContain('fetch(');expect(html).toContain('不会自动导入');
 });
});
