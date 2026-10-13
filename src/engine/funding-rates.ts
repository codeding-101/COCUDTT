import Decimal from 'decimal.js';
import type { FundingAssumption, FundingLedgerAudit, FundingRateAudit } from '../domain/funding.js';
import type { FundingResult } from './funding.js';
import { isIsoDate } from './tax/china-import.js';
const Money=Decimal.clone({precision:256,rounding:Decimal.ROUND_HALF_UP});
const fail=(message:string):never=>{throw Error(`利率事件假设未完成：${message}`);};
function number(text:string,label:string,positive=false):Decimal {
  const raw=text.trim();
  if(raw.length>160||!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw))return fail(`${label}须为非负十进制文本，不接受空白、负数、千分位或指数`);
  const value=new Money(raw);
  if(!value.isFinite()||value.sd()>80||value.dp()>40||(positive?value.lte(0):value.lt(0)))return fail(`${label}须${positive?'大于零':'非负'}，最多80有效位与40小数位`);
  return value;
}
const dateValue=(date:string):number=>{if(!isIsoDate(date))return fail('日期须为真实有效的YYYY-MM-DD');return Date.parse(date+'T00:00:00Z');};
/** Validated 1.3 only. Explicit absolute rates, single ledger, start included/end excluded. */
export function calculateFundingRates(input:FundingAssumption):FundingResult {
  if(input.status!=='PROVIDED'||!Array.isArray(input.rate_events))return fail('须确认测算范围并提供利率事件数组，空白不能当作无事件');
  if(input.kind==='UNCONFIRMED'||input.party==='UNCONFIRMED'||input.day_basis==='UNCONFIRMED')return fail('性质、测算方与计息基准须明确');
  if(!/^[A-Z]{3}$/.test(input.currency))return fail('币种须为三位大写代码');
  if(!input.reference.trim())return fail('须记录期初本金、利率、期间和计息基准依据');
  const start=dateValue(input.start_date),end=dateValue(input.end_date);
  if(end<start)return fail('截止日不能早于起始日');
  const opening=number(input.principal,input.balance_model==='EVENTS'?'期初本金':'恒定本金',input.balance_model==='CONSTANT');
  const openingRate=number(input.annual_rate,'期初年利率（百分数）'),denominator=input.day_basis==='ACT_365F'?365:360;
  // Validate each supplied order before merging boundaries; never sort or net user events.
  const principalEvents=input.balance_model==='EVENTS'?input.events!:[];
  let previousPrincipal=start,previousRate=start-1;
  const amounts=principalEvents.map(row=>{
    const at=dateValue(row.date);
    if(at<start||at>end)return fail(`本金事件${row.id}超出起止日范围`);
    if(at<previousPrincipal)return fail('本金事件须按日期升序；同日按列表顺序');previousPrincipal=at;
    if(row.currency!==input.currency)return fail(`本金事件${row.id}币种不同，不自动换算`);
    if(!row.reference.trim())return fail(`本金事件${row.id}须记录依据`);
    return number(row.amount,`本金事件${row.id}金额`,true);
  });
  const newRates=input.rate_events.map(row=>{
    const at=dateValue(row.date);
    if(at<start||at>end)return fail(`利率事件${row.id}超出起止日范围`);
    if(at<=previousRate)return fail('利率事件须按日期严格升序，同日重复生效日须人工核对');previousRate=at;
    if(!row.reference.trim())return fail(`利率事件${row.id}须记录新利率依据`);
    return number(row.annual_rate,`利率事件${row.id}新年利率（百分数）`);
  });
  const dates=[...new Set([input.start_date,...principalEvents.map(row=>row.date),...input.rate_events.map(row=>row.date),input.end_date])].sort();
  let balance=opening,rate=openingRate,rateReference=input.reference,exposure=new Money(0),weighted=new Money(0),p=0,r=0;
  const ledger:FundingLedgerAudit={closing_principal:'',principal_days:'',segments:[],events:[]};
  const rates:FundingRateAudit={closing_rate:'',weighted_principal_rate_days:'',events:[]};
  for(let d=0;d<dates.length;d++){
    const date=dates[d]!;
    while(p<principalEvents.length&&principalEvents[p]!.date===date){
      const row=principalEvents[p]!,amount=amounts[p]!,before=balance;
      balance=row.direction==='INCREASE'?balance.plus(amount):balance.minus(amount);
      if(balance.lt(0))return fail(`本金事件${row.id}减额超过当时本金；不能自动冲抵利息`);
      ledger.events.push({...row,amount:amount.toFixed(),before:before.toFixed(),after:balance.toFixed()});p++;
    }
    if(r<input.rate_events.length&&input.rate_events[r]!.date===date){
      const row=input.rate_events[r]!,before=rate;rate=newRates[r]!;rateReference=row.reference;
      rates.events.push({...row,annual_rate:rate.toFixed(),before:before.toFixed(),after:rate.toFixed()});r++;
    }
    const next=dates[d+1];if(!next)continue;
    const days=(dateValue(next)-dateValue(date))/86400000,principalDays=balance.times(days),weight=principalDays.times(rate);
    exposure=exposure.plus(principalDays);weighted=weighted.plus(weight);
    ledger.segments.push({start_date:date,end_date:next,days,principal:balance.toFixed(),principal_days:principalDays.toFixed(),annual_rate:rate.toFixed(),rate_reference:rateReference,
      cost:weight.div(100).div(denominator).toFixed(),formula:`${balance.toFixed()} × ${rate.toFixed()} ÷ 100 × ${days} ÷ ${denominator}`});
  }
  ledger.closing_principal=balance.toFixed();ledger.principal_days=exposure.toFixed();
  rates.closing_rate=rate.toFixed();rates.weighted_principal_rate_days=weighted.toFixed();
  return{kind:input.kind,party:input.party,principal:opening.toFixed(),currency:input.currency,start_date:input.start_date,end_date:input.end_date,
    annual_rate:openingRate.toFixed(),days:(end-start)/86400000,denominator,cost:weighted.div(100).div(denominator).toFixed(),reference:input.reference,
    formula:`${weighted.toFixed()} ÷ 100 ÷ ${denominator}`,ledger,rates};
}
