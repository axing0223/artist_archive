import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
class El{
  constructor(tag='div'){
    this.tagName=tag;this.children=[];this.className='';this._text='';this.dataset={};this.props={};
    this.style={setProperty:(k,v)=>{this.props[k]=v;}};
    this.classList={
      add:cls=>{const list=String(this.className).split(/\s+/).filter(Boolean);if(!list.includes(cls))this.className=[...list,cls].join(' ');},
      remove:cls=>{this.className=String(this.className).split(/\s+/).filter(name=>name&&name!==cls).join(' ');},
      toggle:()=>{},
    };
    this.hidden=false;this.value='';this.type='';this.checked=false;this.title='';this.placeholder='';this.href='';this.disabled=false;
    this.onclick=null;this.oninput=null;this.onchange=null;this.onerror=null;this.onload=null;
    this.showModal=()=>{};this.close=()=>{};
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
    URL:{createObjectURL:()=>'blob:x',revokeObjectURL(){}},Blob,structuredClone,setTimeout,clearTimeout,requestAnimationFrame:fn=>fn(),
    ArtistImages:{bind(){},dispose(){},setFolder(){},clear(){},dataUrl:async()=>'data:image/jpeg;base64,/9j/2Q==',fetch:async()=>new Blob([])},
    ArtistExtension:{connected:false,check:async()=>{throw Error('测试中未连接扩展');},image:async()=>{throw Error('未连接');},resolve:async()=>{throw Error('未连接');}},
    ArtistGallery:{render(container,rows,card){state.card=card;state.rows=rows;state.renders.push(rows.map(row=>card(row)));},clear(){},pin(){},visible:()=>[]},
    ArtistLookup:{plan(){throw Error('测试中不查询');},lookup:async()=>[],posts:async()=>[],details:async()=>({counts:{total:null,beforeTotal:null}})},
  };
  for(const file of ['artist-id.js','image-cache.js','image-loader.js','folder-store.js','work-picker.js','test-images.js','app.js'])
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
test('删除画师改为按钮二次确认，不再调用系统对话框',async()=>{
  const {elements,state}=await boot();
  elements.get('add-artist').onclick();
  const card=lastRender(state)[0];
  const find=(node,label)=>{for(const child of node.children||[]){if(child._text===label)return child;const hit=find(child,label);if(hit)return hit;}return null;};
  const remove=find(card,'删除画师');
  assert.ok(remove,'编辑态应有删除按钮');
  remove.onclick();
  assert.equal(remove.textContent,'再次点击确认删除','第一次点击只进入确认态');
  assert.equal(String(remove.className).includes('is-armed'),true,'确认态要有醒目样式');
});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const findByPlaceholder=(node,placeholder)=>{if(node.placeholder===placeholder)return node;for(const child of node.children||[]){const hit=findByPlaceholder(child,placeholder);if(hit)return hit;}return null;};
const findText=(node,label)=>{if(node._text===label)return node;for(const child of node.children||[]){const hit=findText(child,label);if(hit)return hit;}return null;};
async function createArtist(state,elements,name){
  elements.get('add-artist').onclick();
  const input=findByPlaceholder(lastRender(state)[0],'画师名字（必填）');
  input.value=name;input.oninput();
  await findText(lastRender(state)[0],'保存').onclick();
}
test('新增画师：填好名字保存后进入列表，并拿到正式序号标识',async()=>{
  const {elements,state}=await boot();
  await createArtist(state,elements,'测试画师');
  assert.equal(state.rows.length,1,'保存后列表里出现这位画师');
  assert.equal(state.rows[0].name,'测试画师');
  assert.match(state.rows[0].uid,/^\d{4}-测试画师-manual$/,'应发到正式序号，而不是临时草稿号');
});
test('新增画师：名字为空时拒绝保存并给出提示',async()=>{
  const {elements,state}=await boot();
  elements.get('add-artist').onclick();
  const card=lastRender(state)[0];
  await findText(card,'保存').onclick();
  assert.match(state.rows[0].uid,/^draft-/,'空名字不该拿到正式序号，仍是草稿');
  assert.equal(state.rows[0].name,'','草稿名字没有被填入');
  assert.equal(findText(card,'请填写画师名字。')!==null,true,'要给出可见的错误提示');
  assert.equal(card.className.includes('is-editing'),true,'仍停留在编辑态');
});
test('新增画师：与已有画师重名时拒绝保存',async()=>{
  const {elements,state}=await boot();
  await createArtist(state,elements,'同名');
  elements.get('add-artist').onclick();
  const card=lastRender(state).slice(-1)[0];
  const input=findByPlaceholder(card,'画师名字（必填）');
  assert.ok(input,'新草稿排在列表末尾，应能在这里找到名字输入框');
  input.value='同名';input.oninput();
  await findText(card,'保存').onclick();
  assert.equal(state.rows.length,2,'不应出现第二位同名画师（原有 1 位 + 未保存的草稿）');
  assert.equal(findText(card,'已有同名画师。')!==null,true);
});
test('删除画师：第一次点击只进入确认态，第二次才真的移除',async()=>{
  const {elements,state}=await boot();
  await createArtist(state,elements,'待删除');
  assert.equal(state.rows.length,1);
  findText(lastRender(state)[0],'编辑').onclick();
  await wait(180);
  const remove=findText(lastRender(state)[0],'删除画师');
  assert.ok(remove,'编辑态应有删除按钮');
  remove.onclick();
  assert.equal(state.rows.length,1,'第一次点击不能删除');
  assert.equal(remove.textContent,'再次点击确认删除');
  await remove.onclick();
  assert.equal(state.rows.length,0,'第二次点击才移除');
});
test('取消编辑：改动不写入数据',async()=>{
  const {elements,state}=await boot();
  await createArtist(state,elements,'原名字');
  findText(lastRender(state)[0],'编辑').onclick();
  await wait(180);
  const input=findByPlaceholder(lastRender(state)[0],'画师名字（必填）');
  input.value='改过的名字';input.oninput();
  findText(lastRender(state)[0],'取消').onclick();
  await wait(180);
  assert.equal(state.rows.length,1);
  assert.equal(state.rows[0].name,'原名字','取消后应保留原值');
});
test('重排时给画廊加临时标记，标记过后滚动挂载的卡片不再重复淡入',async()=>{
  const {elements}=await boot();
  const gallery=elements.get('gallery');
  assert.equal(String(gallery.className).includes('is-refreshing'),true,'渲染后应带上重排标记');
  await wait(340);
  assert.equal(String(gallery.className).includes('is-refreshing'),false,'标记会自动移除，之后滚动加载的卡片不再播动画');
});
test('删除分类也走按钮二次确认，不再弹系统对话框',async()=>{
  const {elements,state}=await boot();
  elements.get('manage-tags').onclick();
  const list=elements.get('category-list');
  const findText=(node,label)=>{if(node._text===label)return node;for(const child of node.children||[]){const hit=findText(child,label);if(hit)return hit;}return null;};
  const remove=findText(list,'删除');
  assert.ok(remove,'分类列表里应有删除按钮');
  const before=state.rows.length;
  remove.onclick();
  assert.equal(remove.textContent,'确认删除？','第一次点击只进入确认态');
  assert.equal(String(remove.className).includes('is-armed'),true);
  assert.equal(state.rows.length,before,'确认前不改动数据');
});
test('编辑已有画师时，卡片渲染成编辑态而不是浏览态',async()=>{
  const {elements,state}=await boot();
  elements.get('add-artist').onclick();
  const editing=lastRender(state)[0];
  assert.ok(editing.className.includes('is-editing'));
  assert.equal(editing.children.length>=3,true,'编辑态卡片应有信息区、作品区与展开区');
});
