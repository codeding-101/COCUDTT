/** Synthetic codec equivalence cases; no workbench, saved-file or installation authority. */
import type{FeeBrowserCaptureCodec}from'./fee-browser-capture-contract';
import{feeLayeredParts}from'./fee-layered-capture-cases';
export const SESSION_TIMING_TEXTS=Object.freeze([
 {id:'below-sharing-threshold',text:'A'.repeat(1023)},
 {id:'at-sharing-threshold',text:'A'.repeat(1024)},
 {id:'ascii-controls-and-escapes',text:(Array.from({length:32},(_,i)=>String.fromCharCode(i)).join('')+'"\\').repeat(40)},
 {id:'latin-boundaries',text:'\u007f\u0080\u07ff'.repeat(400)},
 {id:'bmp-boundaries',text:'\u0800\ud7ff\ue000\uffff\ufeff\u2028\u2029'.repeat(160)},
 {id:'surrogate-pair-boundaries',text:'\ud800\udc00\udbff\udfff😀'.repeat(180)},
 {id:'unicode-leading',text:'中😀'+'A'.repeat(2048)},
 {id:'unicode-middle',text:'A'.repeat(1024)+'中😀'+'B'.repeat(1024)},
 {id:'unicode-trailing',text:'A'.repeat(2048)+'中😀'},
 {id:'all-nonsurrogate-bmp',text:Array.from({length:65536},(_,i)=>i>=0xd800&&i<=0xdfff?'':String.fromCharCode(i)).join('')},
]);
export const SESSION_TIMING_INVALID_TEXTS=Object.freeze(['\ud800'+'A'.repeat(1024),'A'.repeat(512)+'\ud800'+'B'.repeat(512),'A'.repeat(1024)+'\ud800','\udfff'+'A'.repeat(1024),'A'.repeat(512)+'\udfff'+'B'.repeat(512),'A'.repeat(1024)+'\udfff']);
export function sessionTimingParts(text:string,format:'COMPACT'|'PRETTY_LF'='COMPACT'){return feeLayeredParts({raw:text,repeated:text,unknown:{negative_zero:-0,note:'UNKNOWN_IMPORTED'}},format);}
export async function probeSessionTiming(codec:FeeBrowserCaptureCodec){const cases:{id:string;checks:Record<string,boolean>}[]=[],wires:{id:string;wire:string}[]=[];
 for(const item of SESSION_TIMING_TEXTS)for(const format of['COMPACT','PRETTY_LF']as const){const input=sessionTimingParts(item.text,format),wire=await codec.encode(input,new AbortController().signal),restored=await codec.decode(wire,new AbortController().signal),root=restored.retained_root as{raw:string;repeated:string;unknown:{negative_zero:number}},packet=JSON.parse(wire),expected=format==='COMPACT'?JSON.stringify(input.retained_root):JSON.stringify(input.retained_root,null,2)+'\n';cases.push({id:item.id+':'+format,checks:{exact_text:root.raw===item.text&&root.repeated===item.text,negative_zero:Object.is(root.unknown.negative_zero,-0),exact_retained:restored.capture.retained_json===expected,retained_bytes:packet.summary.retained_text_utf8_bytes===new TextEncoder().encode(expected).length,capture_bytes:packet.summary.capture.compact_utf8_bytes===new TextEncoder().encode(JSON.stringify(restored.capture)).length,same_wire:wire===await codec.encode(input,new AbortController().signal),no_authority:restored.financial_writes===0&&!restored.import_authority&&!restored.confirmation_authority&&!restored.runtime_integrated,frozen:Object.isFrozen(restored)&&Object.isFrozen(restored.capture.files.project)}});wires.push({id:item.id+':'+format,wire});}
 for(let i=0;i<SESSION_TIMING_INVALID_TEXTS.length;i++){let rejected=false;try{await codec.encode(sessionTimingParts(SESSION_TIMING_INVALID_TEXTS[i]!),new AbortController().signal);}catch(error){rejected=!!error&&typeof error==='object'&&Object.getOwnPropertyDescriptor(error,'code')?.value==='UNICODE';}cases.push({id:'isolated-surrogate-'+i,checks:{unicode_rejected:rejected}});}
 return{scope:'SESSION_CODEC_TEXT_EQUIVALENCE',cases,wires,financial_writes:0,import_authority:false,confirmation_authority:false,full_workbench_switch:false,production_integrated:false};
}
