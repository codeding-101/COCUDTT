import{describe,it,expect,vi}from'vitest';
import{FeeBrowserNativeCodec,feeBrowserNativeUtf8Bytes}from'../tools/fee-browser-native-codec';
import{encodeFeeLayeredCapturePrototype,decodeFeeLayeredCapturePrototype,inspectFeeLayeredCaptureBudget}from'../tools/fee-layered-capture-prototype';
import{SESSION_TIMING_TEXTS,SESSION_TIMING_INVALID_TEXTS,sessionTimingParts}from'../tools/fee-session-timing-cases';
describe('single-pass text measurement preserves the original wire',()=>{
 it.each(SESSION_TIMING_TEXTS)('$id matches unchanged Node oracle in both formats',async({text})=>{expect(feeBrowserNativeUtf8Bytes(text)).toBe(new TextEncoder().encode(text).length);for(const format of['COMPACT','PRETTY_LF']as const){const input=sessionTimingParts(text,format),codec=new FeeBrowserNativeCodec(),wire=await codec.encode(input,new AbortController().signal);expect(wire).toBe(encodeFeeLayeredCapturePrototype(input));expect(JSON.parse(wire).summary).toEqual(inspectFeeLayeredCaptureBudget(input));expect(await codec.decode(wire,new AbortController().signal)).toStrictEqual(decodeFeeLayeredCapturePrototype(wire));}});
 it.each(SESSION_TIMING_INVALID_TEXTS.map((text,id)=>({text,id})))('rejects isolated surrogate$id before any crypto',async({text})=>{const digest=vi.spyOn(crypto.subtle,'digest');try{expect(()=>feeBrowserNativeUtf8Bytes(text)).toThrow('UNICODE');await expect(new FeeBrowserNativeCodec().encode(sessionTimingParts(text),new AbortController().signal)).rejects.toThrow('UNICODE');expect(digest).not.toHaveBeenCalled();}finally{digest.mockRestore();}});
});
