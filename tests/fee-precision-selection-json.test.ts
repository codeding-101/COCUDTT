import{describe,it,expect,beforeAll}from'vitest';
import{parseFeePrecisionSelectionJson as parse,copyFeePrecisionSelectionJson as copy,canonicalFeePrecisionSelectionJson as canonical,feePrecisionSelectionSha256 as sha}from'../src/data/fee-precision-selection-json';
import{FeePrecisionSelectionError,FEE_PRECISION_SELECTION_BYTES}from'../src/domain/fee-precision-selection';
import{createFeePrecisionSelection,parseFeePrecisionSelection,validateFeePrecisionSelection,serializeFeePrecisionSelection}from'../src/data/fee-precision-selection';
import{populatedAttachment}from'./fixtures/fee-tax-attachment';
import{serializeFeeTaxAttachment}from'../src/data/fee-tax-attachment';

describe('独立64MiB无损JSON边界',()=>{
 it.each(['{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"a":{"x":1,"x":2}}','{"a":1,}','[1,]','{a:1}','01','1e400','NaN','true false','/*x*/{}','{"x":"\\uD800"}','"\uDC00"','[','{"x":"\\q"}','{"x":"\\uZZZZ"}','{"x":undefined}'])('拒绝歧义或坏JSON %s',text=>expect(()=>parse(text)).toThrow(FeePrecisionSelectionError));
 it.each(['null','true','false','0','-0','1.25','1e-3','[]','{}','{"a":[1,{"x":"😀\\n\\u4e2d"}]}','{"__proto__":{"x":1}}'])('合法JSON %s保持原语义',text=>expect(parse(text)).toEqual(JSON.parse(text)));
 it('字节限额、深度和节点实际检查，未以字符数代替UTF-8',()=>{expect(()=>parse('"中"',4)).toThrow('UTF8_SIZE');expect(parse('"中"',5)).toBe('中');expect(()=>parse('"😀"',5)).toThrow('UTF8_SIZE');expect(parse('"😀"',6)).toBe('😀');expect(()=>parse('['.repeat(34)+'0'+']'.repeat(34))).toThrow();expect(()=>parse('['+Array(300001).fill('0').join(',')+']')).toThrow();expect(()=>parse(' '.repeat(FEE_PRECISION_SELECTION_BYTES+1))).toThrow('UTF8_SIZE');});
 it('对象快照确实允许超过旧24MiB上限，仍受新64MiB限制',()=>{const v={text:'x'.repeat(24*1024*1024+1)};expect((copy(v) as typeof v).text.length).toBe(v.text.length);expect(()=>copy({text:'x'.repeat(FEE_PRECISION_SELECTION_BYTES)})).toThrow();});
 it.each(['getter','hidden','symbol','cycle','sparse','array-extra','array-accessor','array-subclass','class','custom-prototype','revoked','infinite','bigint','undefined','lone-surrogate','function'])('拒绝不可信对象%s且不调用getter',mode=>{
  let calls=0,value:any={x:1};if(mode==='getter')Object.defineProperty(value,'x',{enumerable:true,get(){calls++;throw Error('PRIVATE_GETTER');}});if(mode==='hidden')Object.defineProperty(value,'x',{value:1,enumerable:false});if(mode==='symbol')value[Symbol('x')]=2;if(mode==='cycle')value.x=value;if(mode==='sparse')value=new Array(1);if(mode==='array-extra'){value=[];value.memo=1;}if(mode==='array-accessor'){value=[1];Object.defineProperty(value,'0',{enumerable:true,get(){calls++;return 1;}});}if(mode==='array-subclass')value=new(class extends Array{})(1);if(mode==='class')value=new Date();if(mode==='custom-prototype')value=Object.assign(Object.create({inherited:1}),{x:1});if(mode==='revoked'){const p=Proxy.revocable({},{});p.revoke();value=p.proxy;}if(mode==='infinite')value.x=Infinity;if(mode==='bigint')value.x=1n;if(mode==='undefined')value.x=undefined;if(mode==='lone-surrogate')value.x='\uD800';if(mode==='function')value.x=()=>1;expect(()=>copy(value)).toThrow(FeePrecisionSelectionError);expect(calls).toBe(0);
 });
 it('null原型安全脱离、__proto__不污染，排序保留尾零及数组顺序',()=>{const input=Object.assign(Object.create(null),{z:['1.00','1'],a:'中文'}),out=copy(input);expect(Object.getPrototypeOf(out)).toBe(Object.prototype);expect(canonical(out)).toBe('{"a":"中文","z":["1.00","1"]}');const proto=copy(parse('{"__proto__":{"polluted":true}}'));expect(Object.hasOwn(proto as object,'__proto__')).toBe(true);expect(({} as any).polluted).toBeUndefined();});
 it('标准SHA-256向量，孤立代理项不参与有损摘要',async()=>{expect(await sha('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');expect(await sha('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');await expect(sha('\uD800')).rejects.toThrow();});
});

describe('三层真实文件均预检重复键与无损原文',()=>{
 let a:Awaited<ReturnType<typeof createFeePrecisionSelection>>,text:string;
 beforeAll(async()=>{const s=await populatedAttachment();a=await createFeePrecisionSelection(s.raw,await serializeFeeTaxAttachment(s.attachment));text=await serializeFeePrecisionSelection(a);});
 it('外层重复及转义同名字段拒绝',async()=>{await expect(parseFeePrecisionSelection(text.replace('"version": "1.0"','"version": "1.0", "\\u0076ersion":"1.0"'))).rejects.toThrow('STRICT_JSON');});
 it.each(['pair','attachment','attachment-pair'])('%s层的重复键不会被JSON.parse静默覆盖',async layer=>{
  const bad=structuredClone(a);
  if(layer==='pair')bad.pair_snapshot_json=bad.pair_snapshot_json.replace('"kind":','"revision":1,"kind":');
  else if(layer==='attachment')bad.attachment_snapshot_json=bad.attachment_snapshot_json.replace('"kind":','"revision":1,"kind":');
  else{const tax=JSON.parse(bad.attachment_snapshot_json);tax.pair_snapshot_json=tax.pair_snapshot_json.replace('"kind":','"revision":1,"kind":');bad.attachment_snapshot_json=JSON.stringify(tax);}
  await expect(validateFeePrecisionSelection(bad)).rejects.toThrow(layer==='pair'?'PAIR_SNAPSHOT':'ATTACHMENT_SNAPSHOT');
 });
 it.each(['pair','attachment'])('%s层孤立代理项拒绝，不因重算外层hash通过',async layer=>{const bad=structuredClone(a);if(layer==='pair')bad.pair_snapshot_json=bad.pair_snapshot_json.replace('"name":','"bad":"\\uD800","name":');else bad.attachment_snapshot_json=bad.attachment_snapshot_json.replace('"kind":','"bad":"\\uD800","kind":');await expect(validateFeePrecisionSelection(bad)).rejects.toThrow();});
 it('创建时不一致的两份合法配对原文整体拒绝，不部分返回',async()=>{await expect(createFeePrecisionSelection(a.pair_snapshot_json+'\n',a.attachment_snapshot_json)).rejects.toThrow('SOURCE_PAIR_MISMATCH');});
 it('真实对象入口不执行外层与内层访问器',async()=>{let calls=0;const bad=structuredClone(a);Object.defineProperty(bad,'pair_snapshot_json',{enumerable:true,get(){calls++;throw Error('PRIVATE_GETTER');}});await expect(validateFeePrecisionSelection(bad)).rejects.toThrow('STRICT_JSON');expect(calls).toBe(0);});
 it.each(['pair','attachment'])('%s真实来源尺寸上限在解析前检查',async layer=>{const pair=layer==='pair'?a.pair_snapshot_json+' '.repeat(10*1024*1024+1):a.pair_snapshot_json,tax=layer==='attachment'?a.attachment_snapshot_json+' '.repeat(24*1024*1024+1):a.attachment_snapshot_json;await expect(createFeePrecisionSelection(pair,tax)).rejects.toThrow(layer==='pair'?'PAIR_SNAPSHOT':'ATTACHMENT_SNAPSHOT');});
 it.each(['pair-key','attachment-hash','inner-pair-hash'])('%s嵌套真实指纹坏值不能被外层摘要掩盖',async layer=>{const bad=structuredClone(a);if(layer==='pair-key')bad.pair_snapshot_json=bad.pair_snapshot_json.replace(/"content_key":\s*"/, '"content_key":"tampered');else{const tax=JSON.parse(bad.attachment_snapshot_json);tax[layer==='attachment-hash'?'content_sha256':'pair_snapshot_sha256']='0'.repeat(64);bad.attachment_snapshot_json=JSON.stringify(tax);}await expect(validateFeePrecisionSelection(bad)).rejects.toThrow(layer==='pair-key'?'PAIR_SNAPSHOT':'ATTACHMENT_SNAPSHOT');});
});
