/** Small synthetic values; factories isolate cycles, shared references and accessors per case. */
export const FEE_COMPATIBILITY_VALUE_CASES = [
  'plain','unicode','unicode_forms','opaque_text','marker_keys','key_order','null_prototype','shared_reference','negative_zero',
  'depth_28','depth_29','depth_30','depth_31','depth_32',
  'undefined','function','symbol_value','symbol_key','non_enumerable','sparse_array','custom_prototype','cycle','nan','infinity','lone_high','lone_low','accessor','to_json'
] as const;
export type FeeCompatibilityValueCase = typeof FEE_COMPATIBILITY_VALUE_CASES[number];
export function feeCompatibilityCategory(id: string): 'BASELINE' | 'JSON_EXTENSION' | 'JSON_DEPTH' | 'JSON_NODES' | 'UNSUPPORTED_JAVASCRIPT' {
  if(id==='baseline')return 'BASELINE';
  if(id.startsWith('depth_'))return 'JSON_DEPTH';
  if(id.startsWith('nodes_'))return 'JSON_NODES';
  if(id.startsWith('holder_')||['plain','unicode','unicode_forms','opaque_text','marker_keys','key_order','null_prototype','shared_reference','negative_zero'].includes(id))return 'JSON_EXTENSION';
  return 'UNSUPPORTED_JAVASCRIPT';
}
export function feeCompatibilityValue(id: FeeCompatibilityValueCase): {value:unknown; calls:()=>number} {
  let calls=0;
  const value=(():unknown=>{
    if(id.startsWith('depth_')){let v:unknown='SYNTHETIC_LEAF';for(let n=0;n<Number(id.slice(6));n++)v={next:v};return v;}
    switch(id){
      case 'plain': return {unknown:[null,false,'',0,{keep:'SYNTHETIC'}]};
      case 'unicode': return {text:'中国进口 🚢 𠀀',raw:'\uFEFF{未完成\r\n\\"'};
      case 'unicode_forms': return {composed:'é',decomposed:'e\u0301'};
      case 'opaque_text': return {raw:'\uFEFF{"duplicate":1,"duplicate":2,\r\n',invalid_json:'{do not parse'};
      case 'marker_keys': return JSON.parse('{"__proto__":{"data":true},"constructor":"literal","ref":"https://example.invalid/not-fetched"}');
      case 'key_order': return Object.fromEntries([['z',1],['a',2],['10',3],['2',4]]);
      case 'null_prototype': return Object.assign(Object.create(null) as object,{keep:'SYNTHETIC'});
      case 'shared_reference': {const child={keep:'SYNTHETIC'};return {a:child,b:child};}
      case 'negative_zero': return {value:-0};
      case 'undefined': return {value:undefined};
      case 'function': return {value:()=>0};
      case 'symbol_value': return {value:Symbol('SYNTHETIC')};
      case 'symbol_key': return {[Symbol('SYNTHETIC')]:'hidden',visible:true};
      case 'non_enumerable': return Object.defineProperty({visible:true},'hidden',{value:'SYNTHETIC',enumerable:false});
      case 'sparse_array': return [0,,2];
      case 'custom_prototype': return Object.assign(Object.create({inherited:'SYNTHETIC'}) as object,{visible:true});
      case 'cycle': {const v:{self?:unknown}={};v.self=v;return v;}
      case 'nan': return {value:NaN};
      case 'infinity': return {value:Infinity};
      case 'lone_high': return {value:'\ud800'};
      case 'lone_low': return {value:'\udc00'};
      case 'accessor': return Object.defineProperty({},'value',{enumerable:true,get:()=>{calls++;return 'SYNTHETIC';}});
      case 'to_json': return {toJSON(){calls++;return {visible:'SYNTHETIC'};}};
      default: throw Error('UNKNOWN_COMPATIBILITY_CASE');
    }
  })();
  return {value,calls:()=>calls};
}
