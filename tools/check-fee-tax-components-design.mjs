// Synthetic design oracle only. No production imports, project conversion or application API.
import{readFileSync,readdirSync}from'node:fs';import{isDeepStrictEqual}from'node:util';
const fail=()=>{throw Error('UNSUPPORTED_INPUT')};
const shape=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==keys.split(' ').sort().join('|'))fail()};
const text=v=>{if(typeof v!=='string'||!v.trim()||v.length>200)fail()};
const gcd=(a,b)=>{while(b)[a,b]=[b,a%b];return a};
const q=(n,d=1n)=>{if(d<=0n||n<0n)fail();const g=gcd(n,d);return[n/g,d/g]};
const decimal=v=>{if(typeof v!=='string'||!/^(0|[1-9]\d{0,23})(\.\d{1,18})?$/.test(v))fail();const[a,b='']=v.split('.');return q(BigInt(a+b),10n**BigInt(b.length))};
const plus=(a,b)=>q(a[0]*b[1]+b[0]*a[1],a[1]*b[1]),minus=(a,b)=>q(a[0]*b[1]-b[0]*a[1],a[1]*b[1]),times=(a,b)=>q(a[0]*b[0],a[1]*b[1]),divide=(a,b)=>q(a[0]*b[1],a[1]*b[0]),lte=(a,b)=>a[0]*b[1]<=b[0]*a[1];
const zero=q(0n),one=q(1n),keys=['cash','net','tax','credit','economic','customs'];
const serialize=value=>value===null?null:{numerator:String(value[0]),denominator:String(value[1])};
function line(v){
 shape(v,'line_id currency gross tax credit customs');
 if(typeof v.line_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(v.line_id)||typeof v.currency!=='string'||!/^[A-Z]{3}$/.test(v.currency))fail();
 const cash=v.gross===null?null:decimal(v.gross);let net=null,tax=null,credit=null,customs=null;
 const issues=[];if(cash===null)issues.push('CASH_AMOUNT_UNKNOWN');
 switch(v.tax?.kind){
  case 'UNKNOWN':shape(v.tax,'kind');issues.push('TAX_COMPONENT_UNKNOWN');break;
  case 'NO_SEPARATION':shape(v.tax,'kind');issues.push('TAX_NOT_SEPARATED');break;
  case 'EXPLICIT':shape(v.tax,'kind net tax');if(cash===null)fail();net=decimal(v.tax.net);tax=decimal(v.tax.tax);if(!isDeepStrictEqual(plus(net,tax),cash))fail();break;
  case 'GROSS_RATE':{shape(v.tax,'kind rate');if(cash===null)fail();const rate=decimal(v.tax.rate);if(!lte(rate,one)||isDeepStrictEqual(rate,one))fail();net=divide(cash,plus(one,rate));tax=minus(cash,net);break;}
  default:fail();
 }
 switch(v.credit?.kind){
  case 'UNKNOWN':shape(v.credit,'kind');issues.push('CREDIT_UNDETERMINED');break;
  // NONE means no credit adjustment in this scenario, not a legal determination of non-deductibility.
  case 'NONE':shape(v.credit,'kind basis');text(v.credit.basis);credit=zero;break;
  case 'ASSUMED':shape(v.credit,'kind amount basis document_ref eligibility_ref');text(v.credit.basis);text(v.credit.document_ref);text(v.credit.eligibility_ref);if(tax===null||cash===null)fail();credit=decimal(v.credit.amount);if(!lte(credit,tax))fail();break;
  default:fail();
 }
 switch(v.customs?.kind){
  case 'UNKNOWN':shape(v.customs,'kind');issues.push('CUSTOMS_COMPONENT_UNDETERMINED');break;
  case 'NOT_ADDED':shape(v.customs,'kind basis');text(v.customs.basis);customs=zero;break;
  case 'ADD_COMPONENT':shape(v.customs,'kind amount basis');text(v.customs.basis);if(cash===null)fail();customs=decimal(v.customs.amount);if(!lte(customs,cash))fail();break;
  default:fail();
 }
 const economic=cash!==null&&credit!==null?minus(cash,credit):null;
 return{values:{cash,net,tax,credit,economic,customs},issues};
}
function evaluate(c){
 if(c.family==='LINE'){const r=line(c.input);return{channels:Object.fromEntries(keys.map(k=>[k,serialize(r.values[k])])),issues:r.issues};}
 if(c.family==='TOTAL'){
  shape(c.input,'currency rows');const v=c.input;if(typeof v.currency!=='string'||!/^[A-Z]{3}$/.test(v.currency)||!Array.isArray(v.rows)||!v.rows.length||v.rows.length>8)fail();
  const ids=new Set();for(const row of v.rows){if(!row||typeof row!=='object'||ids.has(row.line_id)||row.currency!==v.currency)fail();ids.add(row.line_id)}
  const rows=v.rows.map(line),unknown_counts={},known_subtotals={},totals={};
  for(const k of keys){unknown_counts[k]=rows.filter(r=>r.values[k]===null).length;const sum=rows.reduce((n,r)=>r.values[k]===null?n:plus(n,r.values[k]),zero);known_subtotals[k]=serialize(sum);totals[k]=unknown_counts[k]?null:serialize(sum);}
  return{totals,known_subtotals,unknown_counts};
 }
 fail();
}
const fixture=JSON.parse(readFileSync(new URL('../docs/cases/fee-tax-components-design.json',import.meta.url),'utf8'));
if(fixture.kind!=='SYNTHETIC_DESIGN_ONLY'||fixture.version!=='0.1'||fixture.production_enabled!==false)fail();
const ids=new Set(),counts={valid:0,rejected:0};
for(const c of fixture.cases){
 if(typeof c.id!=='string'||ids.has(c.id)||!['LINE','TOTAL'].includes(c.family))fail();ids.add(c.id);
 const original=JSON.stringify(c.input);
 if(c.reject===true){let rejected=false;try{evaluate(c)}catch(e){if(e.message!=='UNSUPPORTED_INPUT')throw e;rejected=true}if(!rejected)throw Error(c.id+' unexpectedly accepted');counts.rejected++;}
 else{const actual=evaluate(c);if(!isDeepStrictEqual(actual,c.expected))throw Error(c.id+': '+JSON.stringify(actual)+' != '+JSON.stringify(c.expected));counts.valid++;}
 if(JSON.stringify(c.input)!==original)throw Error(c.id+' input mutated');
}
for(const family of['LINE','TOTAL'])if(!fixture.cases.some(c=>c.family===family&&!c.reject)||!fixture.cases.some(c=>c.family===family&&c.reject))throw Error('Missing family coverage');
// Inverse construction: start from integer net and rate, construct gross and tax;
// compare to gross/(1+rate) without deriving expected values through that formula.
let constructed=0;
for(const rate of[0n,3n,6n,9n,13n])for(let k=1n;k<=20n;k++)for(const partial of[false,true]){
 const net=100n*k,tax=rate*k,gross=net+tax,credit=partial?q(tax,2n):zero;
 const input={line_id:'inverse',currency:'CNY',gross:String(gross),tax:{kind:'GROSS_RATE',rate:'0.'+String(rate).padStart(2,'0')},credit:partial?{kind:'ASSUMED',amount:tax%2n===0n?String(tax/2n):String(tax/2n)+'.5',basis:'SYNTHETIC',document_ref:'SYNTHETIC',eligibility_ref:'SYNTHETIC'}:{kind:'NONE',basis:'SYNTHETIC'},customs:{kind:'UNKNOWN'}};
 const r=line(input);for(const[key,value]of Object.entries({cash:q(gross),net:q(net),tax:q(tax),credit,economic:minus(q(gross),credit),customs:null}))if(!isDeepStrictEqual(r.values[key],value))throw Error('Inverse construction mismatch '+key);constructed++;
}
const independentModules=new Set(['domain/fee-tax-components.ts','domain/fee-tax-components-validation.ts','engine/fee-tax-components.ts','domain/fee-tax-attachment.ts','data/fee-tax-attachment.ts','data/fee-tax-attachment-snapshot.ts']);
function checkInactive(directory,prefix=''){for(const entry of readdirSync(directory,{withFileTypes:true})){const path=prefix+entry.name,url=new URL(entry.name+(entry.isDirectory()?'/':''),directory);if(entry.isDirectory())checkInactive(url,path+'/');else if(entry.name.endsWith('.ts')&&!independentModules.has(path)&&readFileSync(url,'utf8').includes('fee-tax-components'))throw Error('Independent fee tax module must not be integrated into the running app or old calculation paths');}}
checkInactive(new URL('../src/',import.meta.url));
console.log(JSON.stringify({kind:'FEE_TAX_COMPONENTS_DESIGN',fixedHandCases:counts.valid,rejectedCases:counts.rejected,inverseConstructedCases:constructed,runtimeIntegrated:false}));
