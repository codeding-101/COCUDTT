import{vi}from'vitest';

class TestStyle {
 private values=new Map<string,{value:string;priority:string}>();
 getPropertyValue(name:string):string{
  if(name!=='overflow')return this.values.get(name)?.value??'';
  const x=this.getPropertyValue('overflow-x'),y=this.getPropertyValue('overflow-y');
  if(this.getPropertyPriority('overflow-x')!==this.getPropertyPriority('overflow-y'))return '';
  return x===y?x:x&&y?x+' '+y:'';
 }
 getPropertyPriority(name:string):string{
  if(name!=='overflow')return this.values.get(name)?.priority??'';
  const x=this.getPropertyPriority('overflow-x'),y=this.getPropertyPriority('overflow-y');return x===y?x:'';
 }
 setProperty(name:string,value:string,priority=''):void{
  if(!value){this.removeProperty(name);return;}
  if(name==='overflow'){const[x,y]=value.split(/\s+/);this.setProperty('overflow-x',x!,priority);this.setProperty('overflow-y',y??x!,priority);}
  else this.values.set(name,{value,priority});
 }
 removeProperty(name:string):string{const old=this.getPropertyValue(name);if(name==='overflow'){this.values.delete('overflow-x');this.values.delete('overflow-y');}else this.values.delete(name);return old;}
 get overflow():string{return this.getPropertyValue('overflow');}
 set overflow(value:string){this.setProperty('overflow',value);}
}

export class TestElement {
 parentNode:TestElement|null=null;
 children:TestElement[]=[];
 dataset:Record<string,string|undefined>={};
 style=new TestStyle();
 id='';open=false;scrollTop=0;hidden=false;textContent='';value='';files:File[]=[];tabIndex=0;
 events=new Map<string,(event:any)=>void>();
 focus=vi.fn((_options?:unknown)=>{});
 showModal=vi.fn(()=>{this.open=true;});
 close=vi.fn(()=>{this.open=false;this.events.get('close')?.({});});
 constructor(public tagName='DIV',private root=false){}
 get parentElement():TestElement|null{return this.parentNode;}
 get nextSibling():TestElement|null{if(!this.parentNode)return null;return this.parentNode.children[this.parentNode.children.indexOf(this)+1]??null;}
 get isConnected():boolean{return this.root||!!this.parentNode?.isConnected;}
 append(...nodes:TestElement[]):void{for(const node of nodes)this.insertBefore(node,null);}
 insertBefore(node:TestElement,next:TestElement|null):void{
  if(next&&next.parentNode!==this)throw Error('Foreign next sibling');
  node.remove();const at=next?this.children.indexOf(next):this.children.length;this.children.splice(at,0,node);node.parentNode=this;
 }
 before(node:TestElement):void{this.parentNode?.insertBefore(node,this);}
 replaceWith(node:TestElement):void{this.before(node);this.remove();}
 remove():void{if(this.parentNode){const children=this.parentNode.children;children.splice(children.indexOf(this),1);this.parentNode=null;}}
 contains(node:unknown):boolean{return node instanceof TestElement&&(node===this||this.children.some(child=>child.contains(node)));}
 closest(selector:string):TestElement|null{
  if(selector==='dialog'&&this.tagName==='DIALOG')return this;
  if(selector==='[hidden],[inert]'&&this.hidden)return this;
  return this.parentNode?.closest(selector)??null;
 }
 getClientRects():unknown[]{return this.isConnected&&!this.hidden?[{}]:[];}
 addEventListener(name:string,fn:(event:any)=>void):void{this.events.set(name,fn);}
 querySelector(selector:string):TestElement|null{return this.querySelectorAll(selector)[0]??null;}
 querySelectorAll(selector:string):TestElement[]{
  const matches=(node:TestElement)=>{
   if(selector.startsWith('#'))return node.id===selector.slice(1);
   for(const[key,attribute]of Object.entries({mobileSettingsHost:'host',mobileSettingsPlaceholder:'placeholder',mobileSettingsFeedback:'feedback'}))if(selector.includes('data-mobile-settings-'+attribute))return node.dataset[key]!==undefined;
   if(selector.includes('advanced-settings'))return node.dataset.evidenceSection==='advanced-settings';
   if(selector==='[data-action]'||selector.includes('button:not'))return node.dataset.action!==undefined;
   return false;
  };
  return this.children.flatMap(child=>[...(matches(child)?[child]:[]),...child.querySelectorAll(selector)]);
 }
}

export function mobileSettingsEnvironment(){
 let small=true;
 const body=new TestElement('BODY',true),original=new TestElement(),trigger=new TestElement('BUTTON'),feedback=new TestElement('P'),next=new TestElement();
 trigger.dataset.action='show-mobile-settings';feedback.dataset.mobileSettingsFeedback='';body.style.overflow='auto';
 let panel:TestElement,host:TestElement,dialog:TestElement;
 const createView=()=>{
  panel=new TestElement('DETAILS');panel.dataset.evidenceSection='advanced-settings';
  dialog=new TestElement('DIALOG');dialog.id='mobile-settings-dialog';
  host=new TestElement();host.dataset.mobileSettingsHost='';dialog.append(host);original.append(panel,next);body.append(dialog);
 };
 body.append(trigger,feedback,original);createView();
 const doc={body,activeElement:trigger,createElement:(tag:string)=>new TestElement(tag.toUpperCase()),querySelector:(selector:string)=>body.querySelector(selector),querySelectorAll:(selector:string)=>body.querySelectorAll(selector)};
 trigger.focus.mockImplementation(()=>{doc.activeElement=trigger;});
 vi.stubGlobal('matchMedia',()=>({matches:small}));vi.stubGlobal('window',{scrollX:5,scrollY:456,scrollTo:vi.fn()});vi.stubGlobal('document',doc);vi.stubGlobal('HTMLElement',TestElement);vi.stubGlobal('getComputedStyle',()=>({visibility:'visible'}));
 return{body,original,trigger,feedback,next,doc,create:(tag='div')=>new TestElement(tag.toUpperCase()),get panel(){return panel;},get host(){return host;},get dialog(){return dialog;},get events(){return dialog.events;},get marker(){return body.querySelector('[data-mobile-settings-placeholder]');},desktop:()=>{small=false;},replaceView:()=>{panel.remove();dialog.remove();for(const node of [...original.children])node.remove();createView();}};
}
