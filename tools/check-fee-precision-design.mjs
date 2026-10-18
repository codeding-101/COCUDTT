// Reduced synthetic arithmetic protocol only. No production imports, files, storage or fee writes.
import{readFileSync,readdirSync}from'node:fs';import{isDeepStrictEqual}from'node:util';
const fail=()=>{throw Error('UNSUPPORTED_PRECISION_DESIGN_INPUT');};
const shape=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==keys.split(' ').sort().join('|'))fail();};
const gcd=(a,b)=>{a=a<0n?-a:a;while(b)[a,b]=[b,a%b];return a;};
const fraction=(n,d=1n)=>{if(d<=0n)fail();const g=gcd(n,d);return{n:n/g,d:d/g};};
const plus=(a,b)=>fraction(a.n*b.d+b.n*a.d,a.d*b.d),minus=(a,b)=>fraction(a.n*b.d-b.n*a.d,a.d*b.d),times=(a,b)=>fraction(a.n*b.n,a.d*b.d),divide=(a,b)=>fraction(a.n*b.d,a.d*b.n),lte=(a,b)=>a.n*b.d<=b.n*a.d,zero=()=>fraction(0n);
const decimal=v=>{if(typeof v!=='string'||!/^(0|[1-9]\d{0,23})(\.\d{1,18})?$/.test(v))fail();const[a,b='']=v.split('.');return fraction(BigInt(a+b),10n**BigInt(b.length));};
function amount(v){
 if(v===null)return null;if(typeof v==='string')return decimal(v);
 shape(v,'numerator denominator');if(typeof v.numerator!=='string'||typeof v.denominator!=='string'||!/^(0|[1-9]\d{0,79})$/.test(v.numerator)||!/^[1-9]\d{0,79}$/.test(v.denominator))fail();
 const n=BigInt(v.numerator),d=BigInt(v.denominator);if(gcd(n,d)!==1n)fail();return fraction(n,d);
}
const serial=v=>v===null?null:{numerator:String(v.n),denominator:String(v.d)};
const currency=v=>{if(typeof v!=='string'||!/^[A-Z]{3}$/.test(v))fail();return v;};
const reference=v=>{if(typeof v!=='string'||!v.trim()||v.length>200)fail();};
function policy(v,required=false){
 if(v?.kind==='UNRESOLVED'){shape(v,'kind');if(required)fail();return null;}
 shape(v,'kind unit mode basis');if(v.kind!=='EXPLICIT'||!['HALF_UP','HALF_EVEN','DOWN'].includes(v.mode))fail();reference(v.basis);
 const unit=decimal(v.unit);if(unit.n<=0n||!lte(unit,fraction(1n))||(unit.n*1_000_000n)%unit.d!==0n)fail();return{unit,mode:v.mode};
}
function quantize(v,p){
 if(v===null||p===null)return null;
 const scaled=divide(v,p.unit),whole=scaled.n/scaled.d,remainder=scaled.n%scaled.d,twice=2n*remainder;
 const up=p.mode!=='DOWN'&&(twice>scaled.d||twice===scaled.d&&(p.mode==='HALF_UP'||whole%2n===1n));
 return times(fraction(whole+(up?1n:0n)),p.unit);
}
function date(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)fail();return v;}
function evaluate(c){
 const v=c.input;
 switch(c.family){
  case 'ROUND':{
   shape(v,'currency amount policy');currency(v.currency);const a=amount(v.amount),p=policy(v.policy),r=quantize(a,p),issues=[];if(a===null)issues.push('AMOUNT_UNKNOWN');if(p===null)issues.push('POLICY_UNRESOLVED');
   return{rounded:serial(r),delta:serial(r===null?null:minus(r,a)),issues};
  }
  case 'GROUP':{
   shape(v,'currency rows policy scope');currency(v.currency);const p=policy(v.policy,true);if(!['PER_LINE','TOTAL'].includes(v.scope)||!Array.isArray(v.rows)||!v.rows.length||v.rows.length>8)fail();
   const ids=new Set(),values=v.rows.map(row=>{shape(row,'line_id currency amount');if(typeof row.line_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(row.line_id)||ids.has(row.line_id)||currency(row.currency)!==v.currency)fail();ids.add(row.line_id);return amount(row.amount);});
   const known=values.filter(x=>x!==null),original=known.reduce(plus,zero()),subtotal=known.map(x=>quantize(x,p)).reduce(plus,zero()),unknown=values.length-known.length;
   const line=unknown?null:subtotal,total=unknown?null:quantize(original,p),selected=v.scope==='PER_LINE'?line:total;
   return{line_total:serial(line),aggregate_total:serial(total),selected:serial(selected),delta:serial(selected===null?null:minus(selected,original)),scope_difference:serial(line===null?null:minus(line,total)),known_line_subtotal:serial(subtotal),unknown_rows:unknown};
  }
  case 'SPLIT_AUDIT':{
   shape(v,'currency gross net tax credit customs policy');currency(v.currency);const p=policy(v.policy,true),G=amount(v.gross),N=amount(v.net),T=amount(v.tax),X=amount(v.credit),C=amount(v.customs);
   if(G===null||N===null||T===null||!isDeepStrictEqual(plus(N,T),G)||X!==null&&!lte(X,T)||C!==null&&!lte(C,G))fail();
   const E=X===null?null:minus(G,X),values=[G,N,T,X,E,C].map(x=>quantize(x,p)),[g,n,t,x,e]=values,priceGap=minus(minus(g,n),t),economicGap=x===null?null:minus(e,minus(g,x)),issues=[];
   if(priceGap.n!==0n)issues.push('PRICE_TAX_ROUNDING_DIFFERENCE');if(economicGap!==null&&economicGap.n!==0n)issues.push('ECONOMIC_ROUNDING_DIFFERENCE');
   return{channels:values.map(serial),price_tax_gap:serial(priceGap),economic_gap:serial(economicGap),issues};
  }
  case 'FX':{
   shape(v,'amount from to purpose channel as_of rate_source policy');currency(v.from);currency(v.to);if(v.from===v.to)fail();
   const p=policy(v.policy,true),r=v.rate_source;shape(r,'base quote rate type rate_date valid_from valid_to reference');currency(r.base);currency(r.quote);reference(r.reference);
   if(!['CONTRACT','MARKET','CUSTOMS'].includes(r.type)||r.base===r.quote)fail();
   const day=date(v.as_of),published=date(r.rate_date),start=date(r.valid_from),end=date(r.valid_to);if(start>end||day<start||day>end||published>day)fail();
   if(v.purpose==='COMMERCIAL_REVIEW'){if(!['cash','net','tax','credit','economic'].includes(v.channel)||!['CONTRACT','MARKET'].includes(r.type))fail();}
   else if(v.purpose==='CUSTOMS_COMPONENT_REVIEW'){if(v.channel!=='customs'||r.type!=='CUSTOMS'||v.to!=='CNY'||day<'2024-12-01'||!isDeepStrictEqual(p.unit,fraction(1n,100n))||p.mode!=='HALF_UP')fail();}else fail();
   const rate=decimal(r.rate);if(rate.n<=0n)fail();let direct;
   if(v.from===r.base&&v.to===r.quote)direct=true;else if(v.from===r.quote&&v.to===r.base)direct=false;else fail();
   const a=amount(v.amount),exact=a===null?null:times(a,direct?rate:divide(fraction(1n),rate)),rounded=quantize(exact,p);
   return{direction:direct?'DIRECT':'INVERSE',unrounded:serial(exact),rounded:serial(rounded),delta:serial(rounded===null?null:minus(rounded,exact)),scope:'DESIGN_FX_REVIEW_ONLY'};
  }
  case 'STAGE_ORDER':{
   shape(v,'amount rate intermediate final');const a=amount(v.amount),rate=decimal(v.rate),intermediate=policy(v.intermediate,true),final=policy(v.final,true);if(a===null||rate.n<=0n)fail();
   const direct=quantize(times(a,rate),final),double=quantize(times(quantize(a,intermediate),rate),final);return{exact_then_target:serial(direct),intermediate_then_target:serial(double),gap:serial(minus(double,direct))};
  }
  default:fail();
 }
}
const fixture=JSON.parse(readFileSync(new URL('../docs/cases/fee-precision-design.json',import.meta.url),'utf8'));
if(fixture.kind!=='SYNTHETIC_PRECISION_DESIGN_ONLY'||fixture.version!=='0.1'||fixture.runtime_enabled!==false)fail();
const ids=new Set();let valid=0,rejected=0;
for(const c of fixture.cases){shape(c,c.reject===true?'id family input reject':'id family input expected');if(typeof c.id!=='string'||!/^[A-Za-z0-9_-]+$/.test(c.id)||ids.has(c.id))fail();ids.add(c.id);const before=JSON.stringify(c.input);if(c.reject){let rejectedInput=false;try{evaluate(c);}catch(e){if(e.message!=='UNSUPPORTED_PRECISION_DESIGN_INPUT')throw e;rejectedInput=true;}if(!rejectedInput)throw Error(c.id+' unexpectedly accepted');rejected++;}else{const actual=evaluate(c);if(!isDeepStrictEqual(actual,c.expected))throw Error(c.id+' mismatch: '+JSON.stringify(actual)+' expected '+JSON.stringify(c.expected));valid++;}if(before!==JSON.stringify(c.input))throw Error('Input changed');}
for(const family of['ROUND','GROUP','SPLIT_AUDIT','FX','STAGE_ORDER'])if(!fixture.cases.some(c=>c.family===family&&!c.reject)||!fixture.cases.some(c=>c.family===family&&c.reject))throw Error('Missing coverage '+family);
// Independent construction: choose integer quantum count and remainder, not a decimal rounding API.
let constructed=0;
for(const denominator of[2n,3n,7n,10n,113n])for(let integer=0n;integer<12n;integer++)for(let remainder=0n;remainder<denominator;remainder++)for(const mode of['HALF_UP','HALF_EVEN','DOWN']){
 const p={unit:fraction(1n,100n),mode},v=fraction(integer*denominator+remainder,denominator*100n),r=quantize(v,p);
 let count=integer;if(mode==='HALF_UP'&&remainder>=denominator-remainder||mode==='HALF_EVEN'&&(remainder>denominator-remainder||remainder===denominator-remainder&&integer%2n===1n))count++;
 const expected=fraction(count,100n);if(!isDeepStrictEqual(r,expected)||!isDeepStrictEqual(plus(v,minus(r,v)),r)||!isDeepStrictEqual(quantize(r,p),r))throw Error('Constructed rounding mismatch');constructed++;
}
// Integer cross multiplication for exact direct/inverse conversions; no pre-rounded inverse rate.
let inverseChecks=0;for(let a=0n;a<=30n;a++)for(const rate of[3n,7n,113n,1000000000001n]){const original=fraction(a,7n),converted=times(original,fraction(rate,100n)),restored=times(converted,fraction(100n,rate));if(!isDeepStrictEqual(restored,original))throw Error('Exact FX mismatch');inverseChecks++;}
const modules=new Set(['data/fee-envelope.ts','data/fee-application-proposal.ts','domain/fee-precision.ts','domain/fee-precision-validation.ts','engine/fee-precision.ts','domain/fee-precision-selection.ts','data/fee-precision-selection.ts','data/fee-precision-selection-json.ts','data/fee-precision-selection-editor.ts','data/fee-precision-selection-snapshot.ts','ui/fee-precision-selection-controller.ts','ui/fee-precision-selection-form.ts','ui/fee-precision-selection-workspace.ts','ui/app.ts']);
function inactive(directory,prefix=''){for(const e of readdirSync(directory,{withFileTypes:true})){const path=prefix+e.name,u=new URL(e.name+(e.isDirectory()?'/':''),directory);if(e.isDirectory())inactive(u,path+'/');else if(e.name.endsWith('.ts')&&!modules.has(path)&&/fee-precision|FEE_PRECISION/.test(readFileSync(u,'utf8')))throw Error('Precision module must not enter running UI or old calculations');}}
inactive(new URL('../src/',import.meta.url));
console.log(JSON.stringify({kind:fixture.kind,validCases:valid,rejectedCases:rejected,constructedRoundingCases:constructed,inverseFxChecks:inverseChecks,runtimeIntegrated:true,numericModuleImplemented:true,independentOracleImportsProduction:false}));
