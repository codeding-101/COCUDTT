/** Independent, deliberately small DAILY oracle for DESIGN fixtures only.
 * No production imports, UI integration, payment-format upgrade or bank inference.
 * Fixture limits (six decimal places / 366 days) are not production model limits.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const source=process.argv[2]?resolve(process.argv[2]):resolve(import.meta.dirname,'../docs/cases/funding-period-design.json');
const data=JSON.parse(readFileSync(source,'utf8')),S=1000000n,DAY=86400000;
const fail=code=>{throw Object.assign(Error(code),{code});};
function date(text){
  if(typeof text!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(text))fail('DATE');
  const ms=Date.parse(text+'T00:00:00Z');
  if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==text)fail('DATE');
  return ms/DAY;
}
function scaled(text,positive=false){
  if(typeof text!=='string'||text.length>30||!/^\d+(?:\.\d{1,6})?$/.test(text))fail('NUMBER');
  const [whole,part='']=text.split('.'),n=BigInt(whole)*S+BigInt(part.padEnd(6,'0'));
  if(positive&&n===0n)fail('NUMBER');return n;
}
function gcd(a,b){while(b){const c=a%b;a=b;b=c;}return a;}
function fraction(n,d){const g=gcd(n,d);return`${n/g}/${d/g}`;}
function round(n,d,unit,mode){
  const numerator=n*S,denominator=d*unit,q=numerator/denominator,r=numerator%denominator;
  return q+(mode==='DOWN'?0n:r*2n>denominator||r*2n===denominator&&(mode==='HALF_UP'||q%2n===1n)?1n:0n);
}
function format(units,unit,text){
  const dp=(text.split('.')[1]??'').length,n=units*unit,whole=n/S;
  return whole.toString()+(dp?'.'+(n%S).toString().padStart(6,'0').slice(0,dp):'');
}
function checkInput(input){
  const {funding:f,schedule:s,rounding:r}=input,start=date(f.start_date),end=date(f.end_date);
  if(end<start||end-start>366)fail('RANGE');
  if(!['FINANCING','OPPORTUNITY'].includes(f.kind)||!['BUYER','SELLER'].includes(f.party)||! /^[A-Z]{3}$/.test(f.currency)||![360,365].includes(f.denominator))fail('BASIS');
  let principal=scaled(f.principal),rate=scaled(f.annual_rate);
  if(s.status!=='PROVIDED')fail('SCHEDULE_STATUS');
  if(s.periods_confirmed!==true)fail('SCHEDULE_CONFIRMATION');
  if(typeof s.reference!=='string'||!s.reference.trim())fail('SCHEDULE_REFERENCE');
  if(!Array.isArray(s.periods)||s.periods.length>100)fail('PERIOD_STRUCTURE');
  const ids=new Set();let previous=start;
  const periods=s.periods.map(p=>{
    if(typeof p.id!=='string'||!p.id.trim()||ids.has(p.id))fail('PERIOD_ID');ids.add(p.id);
    if(typeof p.reference!=='string'||!p.reference.trim())fail('PERIOD_REFERENCE');
    const from=date(p.start_date),to=date(p.end_date);
    if(to<=from)fail('PERIOD_LENGTH');
    if(from!==previous||from<start||to>end)fail('PERIOD_COVERAGE');previous=to;
    return{from,to,n:0n};
  });
  if(previous!==end||start===end&&periods.length!==0)fail('PERIOD_COVERAGE');
  if(r.scope!=='PERIODS'||!['HALF_UP','HALF_EVEN','DOWN'].includes(r.mode)||!r.reference?.trim())fail('ROUNDING');
  const unit=scaled(r.unit,true),denominator=S*S*100n*BigInt(f.denominator);
  // User order is validated, never sorted or silently netted.
  let before=start;
  const pe=f.principal_events.map(p=>{
    const at=date(p.date);if(at<before||at<start||at>end)fail('PRINCIPAL_ORDER');before=at;
    if(p.currency!==f.currency)fail('CURRENCY');
    if(!['INCREASE','DECREASE'].includes(p.direction)||!p.reference?.trim())fail('PRINCIPAL_EVENT');
    return{...p,at,amount:scaled(p.amount,true)};
  });
  before=start-1;
  const re=f.rate_events.map(p=>{
    const at=date(p.date);if(at<=before||at<start||at>end)fail('RATE_ORDER');before=at;
    if(!p.reference?.trim())fail('RATE_EVENT');return{...p,at,rate:scaled(p.annual_rate)};
  });
  let pi=0,ri=0,periodIndex=0,total=0n;
  for(let day=start;day<=end;day++){
    while(pi<pe.length&&pe[pi].at===day){const p=pe[pi++];principal+=p.direction==='INCREASE'?p.amount:-p.amount;if(principal<0n)fail('NEGATIVE_BALANCE');}
    if(ri<re.length&&re[ri].at===day)rate=re[ri++].rate;
    if(day===end)break; // Cutoff events audit only, no extra day or period.
    while(periods[periodIndex]&&day>=periods[periodIndex].to)periodIndex++;
    const period=periods[periodIndex];if(!period||day<period.from)fail('PERIOD_COVERAGE');
    const daily=principal*rate;period.n+=daily;total+=daily;
  }
  const rounded=periods.map(p=>round(p.n,denominator,unit,r.mode)),sum=rounded.reduce((a,b)=>a+b,0n);
  const boundaries=new Set([start,end,...pe.map(p=>p.at),...re.map(p=>p.at)]);
  return{raw_fraction:fraction(total,denominator),period_fractions:periods.map(p=>fraction(p.n,denominator)),period_rounded:rounded.map(n=>format(n,unit,r.unit)),rounded_total:format(sum,unit,r.unit),closing_principal_scaled:principal.toString(),closing_rate_scaled:rate.toString(),calculation_segments:start===end?0:boundaries.size-1};
}
assert.equal(data.kind,'FUNDING_PERIOD_DESIGN_FIXTURES');assert.equal(data.version,'1.0');assert.equal(data.synthetic,true);
assert.ok(Array.isArray(data.cases)&&data.cases.length===30,'Require all 30 reviewed cases');
const ids=new Set();let accepted=0,rejected=0;
for(const c of data.cases){
  assert.ok(c.id&&!ids.has(c.id),'Unique case id');ids.add(c.id);
  if(c.expected_error){
    let caught;try{checkInput(c.input)}catch(error){caught=error;}
    assert.equal(caught?.code,c.expected_error,c.id+' rejection');rejected++;
  }else{
    const result=checkInput(c.input);
    for(const [key,value] of Object.entries(c.expected))assert.deepEqual(result[key],value,c.id+' '+key);
    accepted++;
  }
}
assert.equal(accepted,14);assert.equal(rejected,16);
console.log(JSON.stringify({kind:data.kind,validHandCases:accepted,rejectedBoundaryCases:rejected,productionFeatureEnabled:false,productionImports:false}));
