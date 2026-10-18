import{readFileSync}from'node:fs';
import{expect,vi}from'vitest';
import{parseFeePrecisionSelection}from'../../src/data/fee-precision-selection';
import{FeePrecisionSelectionController,type FeePrecisionSelectionControllerEnvironment,type FeePrecisionCurrentSources}from'../../src/ui/fee-precision-selection-controller';
export const precisionText=readFileSync(new URL('../../templates/fee-precision-selection-synthetic-example.json',import.meta.url),'utf8');
export const deferred=<T>()=>{let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};};
export async function precisionHarness(adopt=true,storage=new Map<string,string>()){
 const a=await parseFeePrecisionSelection(precisionText);let current:FeePrecisionCurrentSources|null={pair_json:a.pair_snapshot_json,attachment_json:a.attachment_snapshot_json},blocked=false;
 const writes:{name:string;text:string;mime:string}[]=[],env:FeePrecisionSelectionControllerEnvironment={storage:{getItem:vi.fn(k=>storage.get(k)??null),setItem:vi.fn((k,v)=>{storage.set(k,v);})},currentSources:()=>current,blocked:()=>blocked,changed:vi.fn(),write:vi.fn(async(name,text,mime)=>{writes.push({name,text,mime});return'SAVED' as const;})};
 const c=new FeePrecisionSelectionController(env);if(adopt){expect(await c.openFile({text:async()=>precisionText})).toBe(true);expect(await c.adoptPreview(c.state().preview!.token)).toBe(true);}
 return{a,c,env,storage,writes,record_id:a.records[0]!.record_id,pair:a.pair_snapshot_json,attachment:a.attachment_snapshot_json,setCurrent:(v:FeePrecisionCurrentSources|null)=>{current=v;},setBlocked:(v:boolean)=>{blocked=v;}};
}
export async function changePrecision(h:Awaited<ReturnType<typeof precisionHarness>>,basis='新的合成政策'){
 const choice=structuredClone(h.a.records[0]!.choice);if(choice.kind!=='ROUND')throw Error('fixture');choice.policy.basis=basis;
 expect(h.c.beginEdit(h.record_id)).toBe(true);expect(h.c.editText(JSON.stringify(choice))).toBe(true);expect(await h.c.submitEditor()).toBe(true);
}
