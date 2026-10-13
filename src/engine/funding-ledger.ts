import Decimal from 'decimal.js';
import type { FundingAssumption, FundingLedgerAudit } from '../domain/funding.js';
import type { FundingResult } from './funding.js';
import { isIsoDate } from './tax/china-import.js';
const Money=Decimal.clone({precision:256,rounding:Decimal.ROUND_HALF_UP});
const fail=(message:string):never=>{throw Error(`变动本金假设未完成：${message}`);};
function number(text:string,label:string,positive=false):Decimal {
  const raw=text.trim();
  if(raw.length>160||!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw))return fail(`${label}须为非负十进制文本，不接受空白、负数、千分位或指数`);
  const value=new Money(raw);
  if(!value.isFinite()||value.sd()>80||value.dp()>40||(positive?value.lte(0):value.lt(0)))return fail(`${label}须${positive?'大于零':'非负'}，最多80有效位与40小数位`);
  return value;
}
const dateValue=(date:string):number=>{if(!isIsoDate(date))return fail('日期须为真实有效的YYYY-MM-DD');return Date.parse(date+'T00:00:00Z');};
/** Called only after settlement structure and quote binding validation. One explicit ledger, no cash-flow inference. */
export function calculateFundingLedger(input: FundingAssumption): FundingResult {
  if(input.status!=='PROVIDED'||!Array.isArray(input.events))return fail('须明确确认测算范围并提供本金事件数组，空白不能当作无事件');
  if(input.kind==='UNCONFIRMED'||input.party==='UNCONFIRMED'||input.day_basis==='UNCONFIRMED')return fail('性质、测算方与计息基准须明确，不从付款方式推定');
  if(!/^[A-Z]{3}$/.test(input.currency))return fail('本金币种须为三位大写代码');
  if(!input.reference.trim())return fail('须记录本金期间、固定利率与计息基准依据');
  const start=dateValue(input.start_date),end=dateValue(input.end_date);
  if(end<start)return fail('截止日不能早于起始日');
  const opening=number(input.principal,'期初本金'),rate=number(input.annual_rate,'年利率（百分数）');
  const denominator=input.day_basis==='ACT_365F'?365:360;
  let balance=opening,previous=start,previousDate=input.start_date,exposure=new Money(0);
  const ledger:FundingLedgerAudit={closing_principal:'',principal_days:'',segments:[],events:[]};
  const segment=(until:number,date:string):void=>{
    const days=(until-previous)/86400000;
    if(days>0){
      const principalDays=balance.times(days),cost=principalDays.times(rate).div(100).div(denominator);
      exposure=exposure.plus(principalDays);
      ledger.segments.push({start_date:previousDate,end_date:date,days,principal:balance.toFixed(),principal_days:principalDays.toFixed(),cost:cost.toFixed(),formula:`${balance.toFixed()} × ${rate.toFixed()} ÷ 100 × ${days} ÷ ${denominator}`});
    }
    previous=until;previousDate=date;
  };
  for(const row of input.events){
    const at=dateValue(row.date);
    if(at<start||at>end)return fail(`事件${row.id}超出起止日范围，不能遗漏区间外的本金变动`);
    if(at<previous)return fail('本金事件须按日期升序录入；同日按列表顺序，不自动排序或净额合并');
    if(row.currency!==input.currency)return fail(`事件${row.id}币种与本金币种不同，不自动换算或跨币种冲抵`);
    if(!row.reference.trim())return fail(`事件${row.id}须记录本金变动依据`);
    const amount=number(row.amount,`事件${row.id}金额`,true);
    segment(at,row.date);
    const before=balance;
    balance=row.direction==='INCREASE'?balance.plus(amount):balance.minus(amount);
    if(balance.lt(0))return fail(`事件${row.id}减额超过当时本金；不能自动冲抵利息或其他款项`);
    ledger.events.push({...row,amount:amount.toFixed(),before:before.toFixed(),after:balance.toFixed()});
  }
  segment(end,input.end_date);
  const cost=exposure.times(rate).div(100).div(denominator);
  ledger.closing_principal=balance.toFixed();ledger.principal_days=exposure.toFixed();
  return {kind:input.kind,party:input.party,principal:opening.toFixed(),currency:input.currency,start_date:input.start_date,end_date:input.end_date,
    annual_rate:rate.toFixed(),days:(end-start)/86400000,denominator,cost:cost.toFixed(),reference:input.reference,
    formula:`${exposure.toFixed()} × ${rate.toFixed()} ÷ 100 ÷ ${denominator}`,ledger};
}
