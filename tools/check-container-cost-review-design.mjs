// Independent bounded arithmetic oracle for synthetic design cases. No production imports.
import {readFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
const fail=()=>{throw new Error('UNSUPPORTED_INPUT');};
const shape=(x,keys)=>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).sort().join('|')!==keys.split(' ').sort().join('|'))fail();};
const dec=s=>{if(typeof s!=='string'||! /^(0|[1-9]\d{0,23})(\.\d{1,18})?$/.test(s))fail();const [a,b='']=s.split('.');return [BigInt(a+b),10n**BigInt(b.length)];};
const fmt=(n,d)=>{const neg=n<0n;n=neg?-n:n;const a=n/d,r=n%d;if(!r)return (neg?'-':'')+a;let tail='',v=r;for(let i=0;v&&i<40;i++){v*=10n;tail+=v/d;v%=d;}if(v)fail();return (neg?'-':'')+a+'.'+tail;};
const text=s=>{if(typeof s!=='string'||!s.trim()||s.length>100)fail();};
const date=s=>{if(typeof s!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(s))fail();const v=Date.parse(s+'T00:00:00Z');if(!Number.isFinite(v)||new Date(v).toISOString().slice(0,10)!==s)fail();return v/86400000;};
function cells(x){
 shape(x,'boxes start end startIncluded endIncluded scope currency kind');text(x.scope);
 if(!/^[A-Z]{3}$/.test(x.currency)||!['DEMURRAGE','DETENTION','COMBINED'].includes(x.kind))fail();
 if(!Array.isArray(x.boxes)||!x.boxes.length||x.boxes.length>6||new Set(x.boxes).size!==x.boxes.length)fail();x.boxes.forEach(text);
 if(typeof x.startIncluded!=='boolean'||typeof x.endIncluded!=='boolean')fail();
 const start=date(x.start),end=date(x.end);if(end<start||end-start>30)fail();
 const result=[];for(const b of x.boxes)for(let n=start+(x.startIncluded?0:1);n<=end-(x.endIncluded?0:1);n++)result.push(b+'@'+n);
 return new Set(result);
}
function evaluate(c){
 const x=c.input;
 switch(c.family){
 case 'PRECISION': {shape(x,'amount');const [n,d]=dec(x.amount);return {exact:fmt(n,d),coreExact:(n*1000000n)%d===0n};}
 case 'ROUNDING': {
  shape(x,'amounts quantum method level');if(!Array.isArray(x.amounts)||!x.amounts.length||x.amounts.length>12)fail();
  if(!['HALF_UP','HALF_EVEN','DOWN'].includes(x.method)||!['LINE','TOTAL'].includes(x.level))fail();
  const [u,v]=dec(x.quantum);if(!u)fail();const amounts=x.amounts.map(dec);
  const round=([n,d])=>{const a=n*v,b=d*u,q=a/b,r=a%b;return q+(x.method==='DOWN'?0n:r*2n>b||r*2n===b&&(x.method==='HALF_UP'||q%2n===1n)?1n:0n);};
  const den=amounts.reduce((a,[,d])=>a>d?a:d,1n),sum=amounts.reduce((a,[n,d])=>a+n*(den/d),0n);
  const units=x.level==='LINE'?amounts.reduce((a,b)=>a+round(b),0n):round([sum,den]);
  return {original:fmt(sum,den),applied:fmt(units*u,v),difference:fmt(units*u*den-sum*v,v*den)};
 }
 case 'COVERAGE': {shape(x,'left right');const a=cells(x.left),b=cells(x.right);return {leftCells:a.size,rightCells:b.size,sharedCells:[...a].filter(n=>b.has(n)).length};}
 case 'CHANNELS': {
  shape(x,'gross rate creditEvidence customsAdjustment');const [g,gd]=dec(x.gross),[r,rd]=dec(x.rate),[a,ad]=dec(x.customsAdjustment);
  if(r>=rd||typeof x.creditEvidence!=='boolean')fail();const netN=g*rd,netD=gd*(rd+r),taxN=g*r;
  // Finite exact examples only: no implied statutory rounding policy.
  return {cash:fmt(g,gd),net:fmt(netN,netD),tax:fmt(taxN,netD),expense:x.creditEvidence?fmt(netN,netD):fmt(g,gd),customs:fmt(a,ad)};
 }
 case 'PARENT_GRAPH': {
  shape(x,'nodes');if(!Array.isArray(x.nodes)||!x.nodes.length||x.nodes.length>10)fail();const map=new Map();
  for(const n of x.nodes){shape(n,'id active parent');text(n.id);if(typeof n.active!=='boolean'||n.parent!==null&&typeof n.parent!=='string'||map.has(n.id))fail();map.set(n.id,n);}
  for(const n of x.nodes.filter(n=>n.active)){const seen=new Set([n.id]);let p=n.parent;while(p!==null){const parent=map.get(p);if(!parent?.active||seen.has(p))fail();seen.add(p);p=parent.parent;}}
  return {roots:x.nodes.filter(n=>n.active&&n.parent===null).map(n=>n.id).sort()};
 }
 default: fail();
 }
}
const fixture=JSON.parse(readFileSync(new URL('../docs/cases/container-cost-review-design.json',import.meta.url),'utf8'));
if(fixture.kind!=='SYNTHETIC_DESIGN_ONLY'||fixture.version!=='0.1')fail();
const ids=new Set(),counts={valid:0,rejected:0};
for(const c of fixture.cases){
 if(ids.has(c.id))throw new Error('duplicate case '+c.id);ids.add(c.id);
 if(c.reject){let rejected=false;try{evaluate(c);}catch(e){if(e.message!=='UNSUPPORTED_INPUT')throw e;rejected=true;}if(!rejected)throw new Error(c.id+' unexpectedly accepted');counts.rejected++;}
 else {const result=evaluate(c);if(!isDeepStrictEqual(result,c.expected))throw new Error(c.id+': '+JSON.stringify(result)+' != '+JSON.stringify(c.expected));counts.valid++;}
}
for(const family of ['PRECISION','ROUNDING','COVERAGE','CHANNELS','PARENT_GRAPH'])if(!fixture.cases.some(c=>c.family===family&&!c.reject)||!fixture.cases.some(c=>c.family===family&&c.reject))throw new Error('missing family coverage');
console.log(`Container review design: ${counts.valid} hand cases + ${counts.rejected} rejected inputs passed; no production activation.`);
