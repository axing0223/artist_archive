import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
class El{
  constructor(tag='div'){
    this.tagName=tag;this.children=[];this.className='';this._text='';this.dataset={};this.props={};
    this.style={setProperty:(k,v)=>{this.props[k]=v;}};this.classList={add:()=>{},remove:()=>{},toggle:()=>{}};
    this.hidden=false;this.value='';this.type='';this.checked=false;this.title='';this.placeholder='';this.href='';this.disabled=false;
    this.onclick=null;this.oninput=null;this.onchange=null;this.onerror=null;this.onload=null;
  }
  get textContent(){return this._text;}
  set textContent(value){this._text=value==null?'':String(value);this.children=[];}
  append(...nodes){for(const node of nodes)if(node)this.children.push(node);}
  replaceChildren(...nodes){this.children=nodes.filter(Boolean);}
  setAttribute(key,value){this[key]=value;}
  removeAttribute(key){delete this[key];}
  addEventListener(){}
  querySelectorAll(){return [];}
}
async function boot(){
  const elements=new Map(),state={renders:[]};
  const document={getElementById:id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id);},createElement:tag=>new El(tag),querySelector:()=>null,querySelectorAll:()=>[],documentElement:new El('html')};
  const localStorage={store:new Map(),getItem(key){return this.store.has(key)?this.store.get(key):null;},setItem(key,value){this.store.set(key,String(value));}};
  class IO{constructor(fn){this.fn=fn;}observe(){}unobserve(){}disconnect(){}}
  class RO{observe(){}unobserve(){}disconnect(){}}
  class Option{constructor(text,value){this.textContent=text;this.value=value;}}
  const ctx={
    window:{addEventListener(){},innerWidth:1200},document,localStorage,
    IntersectionObserver:IO,ResizeObserver:RO,Option,
    crypto:{randomUUID:()=>'uuid-'+Math.random().toString(36).slice(2)},
    fetch:async()=>{throw Error('测试中不应联网');},
    URL:{createObjectURL:()=>'blob:x',revokeObjectURL(){}},Blob,setTimeout,clearTimeout,requestAnimationFrame:fn=>fn(),
    ArtistImages:{bind(){},dispose(){},setFolder(){},clear(){},dataUrl:async()=>'data:image/jpeg;base64,/9j/2Q==',fetch:async()=>new Blob([])},
    ArtistExtension:{connected:false,check:async()=>{throw Error('测试中未连接扩展');},image:async()=>{throw Error('未连接');},resolve:async()=>{throw Error('未连接');}},
    ArtistGallery:{render(container,rows,card){state.card=card;state.renders.push(rows.map(row=>card(row)));},clear(){},pin(){},visible:()=>[]},
    ArtistLookup:{plan(){throw Error('测试中不查询');},lookup:async()=>[],posts:async()=>[],details:async()=>({counts:{total:null,beforeTotal:null}})},
  };
  for(const file of ['artist-id.js','image-cache.js','image-loader.js','folder-store.js','work-picker.js','app.js'])
    vm.runInNewContext(await fs.readFile('app/'+file,'utf8'),ctx);
  return {elements,state};
}
const lastRender=state=>state.renders[state.renders.length-1]||[];
test('点击「添加画师」能进入内联编辑态，渲染过程不应抛错',async()=>{
  const {elements,state}=await boot();
  const add=elements.get('add-artist');
  assert.ok(add&&typeof add.onclick==='function','工具栏的「添加画师」应绑定点击处理');
  add.onclick();
  const cards=lastRender(state);
  assert.equal(cards.length,1,'应渲染出一张卡片');
  assert.ok(cards[0].className.includes('is-editing'),'新画师卡片应处于内联编辑态');
});
test('浏览态卡片：artist-info 左下「编辑」右下「画师页面」，且不再显示张数说明',async()=>{
  const {state}=await boot();
  const artist={uid:'0001-tester-1',order:1,name:'tester',category:null,tags:[],danbooruId:1,counts:{},artistUrl:'https://danbooru.donmai.us/artists/1',description:'',note:'',basis:'',status:'',works:[{id:'1',thumb:null}]};
  const card=state.card(artist);
  assert.equal(card.children.length,2,'卡片应只有信息区与作品区，按钮不再单独占一栏');
  const info=card.children[0];
  assert.ok(info.className.includes('artist-info'));
  const actions=info.children[info.children.length-1];
  assert.ok(actions.className.includes('artist-actions'),'按钮应在 artist-info 内部的最下方');
  assert.equal(actions.children.length,2,'左边编辑、右边画师页面');
  assert.equal(actions.children[0].textContent,'编辑');
  assert.equal(actions.children[1].textContent,'画师页面 ↗');
  assert.equal(actions.children[0].className,'edit-button','两处都用同一套按钮样式');
  assert.equal(actions.children[1].className,'edit-button');
  const find=(node,label)=>{for(const child of node.children||[]){if(child._text===label)return child;const hit=find(child,label);if(hit)return hit;}return null;};
  const refresh=find(info,'刷新');
  assert.ok(refresh,'标题行应有刷新按钮');
  assert.equal(refresh.className,'edit-button','刷新也用同一套按钮样式');
  const texts=[];const walk=node=>{if(node._text)texts.push(node._text);for(const child of node.children||[])walk(child);};
  walk(card);
  assert.equal(texts.some(t=>String(t).includes('张图片 · 卡片预览')),false,'作品下方的张数说明应已移除');
});
test('没有画师页面链接时不显示右下角按钮',async()=>{
  const {state}=await boot();
  const artist={uid:'0001-tester-1',order:1,name:'tester',category:null,tags:[],danbooruId:null,counts:{},artistUrl:'',description:'',note:'',basis:'',status:'',works:[]};
  const info=state.card(artist).children[0],actions=info.children[info.children.length-1];
  assert.equal(actions.children.length,1);
  assert.equal(actions.children[0].textContent,'编辑');
});
test('卡片显示备注，但作品张数说明不再显示',async()=>{
  const {state}=await boot();
  const artist={uid:'0001-tester-1',order:1,name:'tester',category:null,tags:[],danbooruId:null,counts:{},artistUrl:'',description:'',note:'这里是备注内容',basis:'',status:'',works:[{id:'1',thumb:null},{id:'2',thumb:null}]};
  const texts=[];const walk=node=>{if(node._text)texts.push(node._text);for(const child of node.children||[])walk(child);};
  walk(state.card(artist));
  assert.equal(texts.includes('这里是备注内容'),true,'备注要显示出来');
  assert.equal(texts.some(t=>String(t).includes('张图片')),false,'张数说明仍然不显示');
});
test('没有备注时不留下空行',async()=>{
  const {state}=await boot();
  const artist={uid:'0001-tester-1',order:1,name:'tester',category:null,tags:[],danbooruId:null,counts:{},artistUrl:'',description:'',note:'',basis:'',status:'',works:[{id:'1',thumb:null}]};
  const card=state.card(artist),works=card.children[1];
  assert.equal(works.children.filter(child=>child.className==='sample-note').length,0);
});
test('编辑态的三个操作按钮集中在同一个容器里，顺序为保存、取消、删除',async()=>{
  const {elements,state}=await boot();
  elements.get('add-artist').onclick();
  const card=lastRender(state)[0];
  const findClass=(node,cls)=>{if(String(node.className).includes(cls))return node;for(const child of node.children||[]){const hit=findClass(child,cls);if(hit)return hit;}return null;};
  const actions=findClass(card,'artist-actions');
  assert.ok(actions,'编辑态卡片应有操作区');
  assert.deepEqual(actions.children.map(child=>child.textContent),['保存','取消','删除画师'],'三个按钮要在同一个容器里依次排列');
  assert.equal(actions.children[0].className.includes('primary-action'),true,'保存是主操作');
});
test('编辑已有画师时，卡片渲染成编辑态而不是浏览态',async()=>{
  const {elements,state}=await boot();
  elements.get('add-artist').onclick();
  const editing=lastRender(state)[0];
  assert.ok(editing.className.includes('is-editing'));
  assert.equal(editing.children.length>=3,true,'编辑态卡片应有信息区、作品区与展开区');
});
