import {describe,expect,it} from 'vitest';
import {reviewFeeTaxComponent,summarizeFeeTaxComponents} from '../src/engine/fee-tax-components';
import {FeeTaxComponentsInputError} from '../src/domain/fee-tax-components';
import {parseProject,serializeProject,toScenario,toTrade} from '../src/data/project-file';
import {sampleProjectFile} from '../src/data/sample-project';
import {analyze} from '../src/engine/analyze';
const line=():any=>({line_id:'fee1',currency:'CNY',gross:'113',tax:{kind:'EXPLICIT',net:'100',tax:'13'},credit:{kind:'NONE',basis:'合成假设'},customs:{kind:'NOT_ADDED',basis:'合成假设'}});
const rejects=(input:unknown)=>expect(()=>reviewFeeTaxComponent(input)).toThrow(FeeTaxComponentsInputError);
const analyzeProject=(project:ReturnType<typeof sampleProjectFile>)=>analyze({trade:toTrade(project),scenario:toScenario(project),taxProfile:project.tax_profile,fxBooks:project.fx_books});

describe('不可信结构与输入边界',()=>{
 it.each([null,undefined,0,true,[],new Date(),new(class Record{})()])('拒绝非普通对象 %s',rejects);
 it('支持没有原型的纯数据记录',()=>{const input=Object.assign(Object.create(null),line());expect(reviewFeeTaxComponent(input).channels.cash).toEqual({numerator:'113',denominator:'1'});});
 it.each(['gross','tax','credit','customs'])('不调用顶层%s访问器',key=>{const input=line();let calls=0;Object.defineProperty(input,key,{get(){calls++;throw Error('must not run')},enumerable:true});rejects(input);expect(calls).toBe(0);});
 it.each(['tax','credit','customs'])('不调用分支%s的kind访问器',key=>{const input=line();let calls=0;Object.defineProperty(input[key],'kind',{get(){calls++;return 'UNKNOWN'},enumerable:true});rejects(input);expect(calls).toBe(0);});
 it.each(['symbol','hidden','extra','inherited'])('拒绝额外或非数据字段 %s',mode=>{const input=line();if(mode==='symbol')input[Symbol('hidden')]='x';if(mode==='hidden')Object.defineProperty(input,'gross',{value:'113',enumerable:false});if(mode==='extra')input.tax.rate='0.13';if(mode==='inherited')Object.setPrototypeOf(input,{extra:'x'});rejects(input);});
 it.each(['root','branch','array','row'])('撤销Proxy %s转换为受控输入错误',where=>{const proxy=Proxy.revocable({},{});proxy.revoke();if(where==='array')expect(()=>summarizeFeeTaxComponents({currency:'CNY',rows:proxy.proxy})).toThrow(FeeTaxComponentsInputError);else if(where==='row')expect(()=>summarizeFeeTaxComponents({currency:'CNY',rows:[proxy.proxy]})).toThrow(FeeTaxComponentsInputError);else{const input=line();if(where==='root')rejects(proxy.proxy);else{input.tax=proxy.proxy;rejects(input);}}});
 it.each(['sparse','accessor','symbol','extra','hidden'])('数组%s不静默丢行或读取访问器',mode=>{const rows:any[]=[line()];let calls=0;if(mode==='sparse')rows.length=2;if(mode==='accessor')Object.defineProperty(rows,'0',{get(){calls++;return line()},enumerable:true});if(mode==='symbol')(rows as any)[Symbol('x')]=1;if(mode==='extra')(rows as any).memo='x';if(mode==='hidden')Object.defineProperty(rows,'0',{value:line(),enumerable:false});expect(()=>summarizeFeeTaxComponents({currency:'CNY',rows})).toThrow(FeeTaxComponentsInputError);expect(calls).toBe(0);});
 it.each(['',' ','-0','+1','01','1.',' .1','1e2','1,000','Infinity',1,NaN,false])('十进制值%s不强制转换',value=>{const input=line();input.gross=value;rejects(input);});
 it.each(['basis','document_ref','eligibility_ref'])('抵扣依据%s须为明确非空有界文本',key=>{for(const value of ['','  ','a'.repeat(201),null,1]){const input=line();input.credit={kind:'ASSUMED',amount:'1',basis:'合成',document_ref:'合成',eligibility_ref:'合成',[key]:value};rejects(input);}});
 it('200代码单元依据与80字符ID允许，超过1字符拒绝',()=>{const input=line();input.line_id='a'.repeat(80);input.credit.basis='a'.repeat(200);reviewFeeTaxComponent(input);input.line_id+='a';rejects(input);input.line_id='fee1';input.credit.basis+='a';rejects(input);});
 it('精确错误路径定位第二行不相等的价税，而不是输出部分汇总',()=>{const b=line();b.line_id='fee2';b.gross='114';try{summarizeFeeTaxComponents({currency:'CNY',rows:[line(),b]});expect.fail('must reject')}catch(error){expect(error).toBeInstanceOf(FeeTaxComponentsInputError);expect((error as FeeTaxComponentsInputError).path).toBe('batch.rows.1.tax');}});
});

describe('旧业务与新独立模块隔离',()=>{
 it('旧同名扩展保留原文而不激活，分析结果保持',()=>{
  const project=sampleProjectFile(),baseline=analyzeProject(project);
  const raw={...project,fee_tax_components:{version:'future',rows:[line()],confirmed:true}};
  const reopened=parseProject(serializeProject(raw));expect((reopened as any).fee_tax_components).toEqual(raw.fee_tax_components);
  expect(analyzeProject(reopened)).toEqual(baseline);reviewFeeTaxComponent(line());expect(analyzeProject(reopened)).toEqual(baseline);
 });
 it('独立输入不是项目文件，旧含税旗也不是新成分输入',()=>{
  expect(()=>parseProject(JSON.stringify(line()))).toThrow();rejects({...line(),tax_included:true,tax_rate_ref:'service-rate'});
 });
});
