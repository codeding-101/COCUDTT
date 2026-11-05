/** Pinned source is supplied by the local diagnostic server; no evaluation or Node API. */
export const ONBOARDING_PORT_IMPORT="import{registerOnboardingListener as __guideListen121,readOnboardingPreference as __guideRead121,writeOnboardingPreference as __guideWrite121}from'/tools/fee-onboarding-scope.ts';\n";
export function onboardingScopePrefix(prefix:string){if(typeof prefix!=='string'||!/^guide121-[a-z0-9]{1,32}$/.test(prefix))throw Error('ONBOARDING_SOURCE_PREFIX');return prefix;}
export function transformOnboardingSource(input:string,prefix:string){
 onboardingScopePrefix(prefix);const source=input.replace(/\r\n/g,'\n'),count=(s:string,p:string)=>s.split(p).length-1;
 const read="localStorage.getItem(ONBOARDING_KEY)",write="localStorage.setItem(ONBOARDING_KEY,this.hidden?'hidden':'show')";
 if(source.includes('__guide')||count(source,'dialog.addEventListener(')!==3||['cancel','close','keydown'].some(type=>count(source,"dialog.addEventListener('"+type+"',")!==1)||count(source,read)!==1||count(source,write)!==1||count(source,'localStorage.')!==2)throw Error('ONBOARDING_SOURCE_SITES');
 const replacements:Record<string,string>={
  'onboarding-dialog':prefix+'-dialog','onboarding-title':prefix+'-title','data-onboarding-status':'data-'+prefix+'-status',
  '以后不再自动显示（仅此浏览器）':'本次副本会话不再自动显示',
  '关闭后可从“使用引导”再次打开；偏好在关闭时保存。':'关闭后可从“使用引导”再次打开；偏好仅在本次副本会话保留。',
 };
 const counts=Object.fromEntries(Object.keys(replacements).map(p=>[p,count(source,p)]));
 if(counts['onboarding-dialog']!==6||counts['onboarding-title']!==4||counts['data-onboarding-status']!==2||counts['以后不再自动显示（仅此浏览器）']!==1||counts['关闭后可从“使用引导”再次打开；偏好在关闭时保存。']!==1)throw Error('ONBOARDING_SOURCE_LAYOUT');
 let code=source;for(const[a,b]of Object.entries(replacements))code=code.replaceAll(a,b);
 const target="document.getElementById('"+prefix+"-dialog') as HTMLDialogElement|null";
 code=code.replace(read,'__guideRead121('+target+')').replace(write,"__guideWrite121("+target+",this.hidden?'hidden':'show')");
 code=ONBOARDING_PORT_IMPORT+code.replaceAll('dialog.addEventListener(','__guideListen121(dialog,');
 let restored=code.slice(ONBOARDING_PORT_IMPORT.length).replaceAll('__guideListen121(dialog,','dialog.addEventListener(').replace('__guideRead121('+target+')',read).replace("__guideWrite121("+target+",this.hidden?'hidden':'show')",write);
 for(const[a,b]of Object.entries(replacements))restored=restored.replaceAll(b,a);
 if(restored!==source||code.includes('localStorage.'))throw Error('ONBOARDING_SOURCE_ROUNDTRIP');
 return{code,source,prefix,roundtrip:true,listener_sites:3,preference_sites:2,replacements:counts,production_source_changed:false};
}
