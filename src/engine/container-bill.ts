import type {ContainerBillAudit,ContainerBillDailyLine,ContainerBillDay,ContainerBillInput,ContainerBillLine,ContainerBillLineAudit,ContainerBillOverlap} from '../domain/container-bill.js';

const DAY=86_400_000,MAX_DAYS=3660,SCALE=10n**18n;
const MONEY=/^(?:0|[1-9]\d{0,23})(?:\.\d{1,18})?$/;
const BASE=['line_id','scope_id','direction','equipment_type','container_ids','currency','reference','charge_kind','mode'];
/** Controlled field paths only; never include private input values in errors. */
function fail(path:string):never {throw new Error(`CONTAINER_BILL_INVALID:${path}`);}
function object(value:unknown,path:string,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail(path);
 const obj=value as Record<string,unknown>;
 if(Object.keys(obj).some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(obj,key)))fail(path);
 return obj;
}
function text(value:unknown,path:string,max=200):asserts value is string {if(typeof value!=='string'||!value.trim()||value.length>max)fail(path);}
function integer(value:unknown,path:string,min:number,max:number):asserts value is number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)fail(path);}
function rate(value:unknown,path:string):asserts value is string {if(typeof value!=='string'||value!==value.trim()||!MONEY.test(value))fail(path);}
function date(value:unknown,path:string):number{
 if(typeof value!=='string'||value.length!==10||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number(value.slice(0,4))<1900)fail(path);
 const ms=Date.parse(value+'T00:00:00.000Z');
 if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==value)fail(path);
 return ms/DAY;
}
/** Unknown modes/fields fail closed instead of supplying carrier defaults. */
export function validateContainerBillInput(value:unknown):asserts value is ContainerBillInput {
 const root=object(value,'root',['version','lines']);if(root.version!=='0.1')fail('version');
 if(!Array.isArray(root.lines)||root.lines.length>50)fail('lines');
 const ids=new Set<string>();
 Array.from(root.lines).forEach((raw:unknown,index:number)=>{
  const p=`lines[${index}]`;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail(p);
  const mode=(raw as Record<string,unknown>).mode;
  if(mode!=='DAILY'&&mode!=='PER_CONTAINER')fail(p+'.mode');
  const line=object(raw,p,[...BASE,...(mode==='DAILY'?['period','daily']:['rate'])]);
  for(const key of ['line_id','scope_id','equipment_type'])text(line[key],p+'.'+key);
  const id=line.line_id as string;if(ids.has(id))fail(p+'.line_id');ids.add(id);
  text(line.reference,p+'.reference',4000);
  if(!['IMPORT','EXPORT'].includes(line.direction as string))fail(p+'.direction');
  if(typeof line.currency!=='string'||line.currency.length!==3||!/^[A-Z]{3}$/.test(line.currency))fail(p+'.currency');
  if(!Array.isArray(line.container_ids)||line.container_ids.length<1||line.container_ids.length>50)fail(p+'.container_ids');
  const containers=new Set<string>();Array.from(line.container_ids).forEach((id:unknown,i:number)=>{text(id,p+`.container_ids[${i}]`);if(containers.has(id))fail(p+'.container_ids');containers.add(id);});
  if(mode==='PER_CONTAINER'){
   if(!['THC_ORIGIN','THC_DESTINATION','INSPECTION'].includes(line.charge_kind as string))fail(p+'.charge_kind');
   rate(line.rate,p+'.rate');return;
  }
  if(!['DEMURRAGE','DETENTION','COMBINED_DD'].includes(line.charge_kind as string))fail(p+'.charge_kind');
  const period=object(line.period,p+'.period',['start_date','end_date','start_included','end_included','start_event','end_event']);
  const start=date(period.start_date,p+'.period.start_date'),end=date(period.end_date,p+'.period.end_date');
  if(end<start||end-start+1>MAX_DAYS)fail(p+'.period');
  if(typeof period.start_included!=='boolean'||typeof period.end_included!=='boolean')fail(p+'.period');
  text(period.start_event,p+'.period.start_event');text(period.end_event,p+'.period.end_event');
  const daily=object(line.daily,p+'.daily',['free_day_basis','charge_day_basis','free_days','tier_mode','tier_basis','tiers']);
  if(daily.free_day_basis!=='CALENDAR_DAYS')fail(p+'.daily.free_day_basis');
  if(daily.charge_day_basis!=='CALENDAR_DAYS')fail(p+'.daily.charge_day_basis');
  if(daily.tier_mode!=='MARGINAL')fail(p+'.daily.tier_mode');
  if(!['AFTER_FREE_TIME','FROM_PERIOD_START'].includes(daily.tier_basis as string))fail(p+'.daily.tier_basis');
  integer(daily.free_days,p+'.daily.free_days',0,MAX_DAYS);
  if(!Array.isArray(daily.tiers)||daily.tiers.length<1||daily.tiers.length>20)fail(p+'.daily.tiers');
  const tiers=daily.tiers;
  let previous=0;Array.from(tiers).forEach((rawTier:unknown,i:number)=>{
   const t=p+`.daily.tiers[${i}]`,tier=object(rawTier,t,['through_day','rate']);rate(tier.rate,t+'.rate');
   if(i===tiers.length-1){if(tier.through_day!==null)fail(t+'.through_day');}
   else {integer(tier.through_day,t+'.through_day',previous+1,MAX_DAYS);previous=tier.through_day;}
  });
 });
}
function units(value:string):bigint {const[a,b='']=value.split('.');return BigInt(a!)*SCALE+BigInt(b.padEnd(18,'0'));}
function amount(value:bigint):string {const fractional=(value%SCALE).toString().padStart(18,'0').replace(/0+$/,'');return (value/SCALE).toString()+(fractional?'.'+fractional:'');}
function iso(day:number):string {return new Date(day*DAY).toISOString().slice(0,10);}
function bounds(line:ContainerBillDailyLine):[number,number]{
 return[date(line.period.start_date,'period.start_date')+(line.period.start_included?0:1),date(line.period.end_date,'period.end_date')-(line.period.end_included?0:1)];
}
function calculateLine(line:ContainerBillLine):ContainerBillLineAudit {
 const count=line.container_ids.length;
 if(line.mode==='PER_CONTAINER')return{input:structuredClone(line),container_count:count,per_container_amount:amount(units(line.rate)),amount:amount(units(line.rate)*BigInt(count)),selected_days:null,consumed_free_days:null,unused_free_days:null,billable_days:null,days:[],tier_totals:[]};
 const[first,last]=bounds(line),selected=Math.max(0,last-first+1),free=Math.min(selected,line.daily.free_days);
 const days:ContainerBillDay[]=[],sums=line.daily.tiers.map(()=>({days:0,value:0n}));let total=0n;
 for(let i=0;i<selected;i++){
  const ordinal=i+1;
  if(ordinal<=free){days.push({date:iso(first+i),period_day:ordinal,billable_day:null,tier_day:null,status:'FREE',tier_index:null,rate:null,per_container_amount:'0',amount:'0'});continue;}
  const billable=ordinal-free,tierDay=line.daily.tier_basis==='AFTER_FREE_TIME'?billable:ordinal;
  const tierIndex=line.daily.tiers.findIndex(t=>t.through_day===null||tierDay<=t.through_day!);
  const tier=line.daily.tiers[tierIndex]!,perBox=units(tier.rate);total+=perBox;
  sums[tierIndex]!.days++;sums[tierIndex]!.value+=perBox;
  days.push({date:iso(first+i),period_day:ordinal,billable_day:billable,tier_day:tierDay,status:'CHARGED',tier_index:tierIndex,rate:tier.rate,per_container_amount:amount(perBox),amount:amount(perBox*BigInt(count))});
 }
 return{input:structuredClone(line),container_count:count,amount:amount(total*BigInt(count)),per_container_amount:amount(total),selected_days:selected,consumed_free_days:free,unused_free_days:line.daily.free_days-free,billable_days:selected-free,days,
  tier_totals:sums.map((s,i)=>({tier_index:i,days:s.days,rate:line.daily.tiers[i]!.rate,per_container_amount:amount(s.value),amount:amount(s.value*BigInt(count))}))};
}
function overlaps(lines:ContainerBillLine[]):ContainerBillOverlap[]{
 const result:ContainerBillOverlap[]=[];
 for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){
  const a=lines[i]!,b=lines[j]!;
  if(a.scope_id!==b.scope_id||a.direction!==b.direction||a.mode!==b.mode)continue;
  const common=a.container_ids.filter(id=>b.container_ids.includes(id));if(!common.length)continue;
  if(a.mode==='PER_CONTAINER'&&b.mode==='PER_CONTAINER'){
   if(a.charge_kind===b.charge_kind)result.push({line_ids:[a.line_id,b.line_id],container_ids:common,reason:'SAME_FIXED_SCOPE',start_date:null,end_date:null});
  }else if(a.mode==='DAILY'&&b.mode==='DAILY'){
   const combined=a.charge_kind!==b.charge_kind&&(a.charge_kind==='COMBINED_DD'||b.charge_kind==='COMBINED_DD');
   const[af,al]=bounds(a),[bf,bl]=bounds(b),start=Math.max(af,bf),end=Math.min(al,bl);if(start>end)continue;
   result.push({line_ids:[a.line_id,b.line_id],container_ids:common,reason:combined?'COMBINED_AND_SEPARATE':a.charge_kind===b.charge_kind?'SAME_DAILY_SCOPE':'SEPARATE_DD_SHARED_DAYS',start_date:iso(start),end_date:iso(end)});
  }
 }
 return result;
}
/** No portfolio total: alternatives, inclusion and currency conversion require separate review. */
export function calculateContainerBill(value:unknown):ContainerBillAudit {
 validateContainerBillInput(value);
 return{version:'0.1',scope:'ASSUMPTION_ONLY',lines:value.lines.map(calculateLine),potential_overlaps:overlaps(value.lines)};
}
