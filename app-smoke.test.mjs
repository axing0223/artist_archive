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
  const elements=new Map(),state={renders:[],queried:[],scrolled:[]};
  const document={getElementById:id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id);},createElement:tag=>new El(tag),
    querySelector:selector=>{state.queried.push(selector);return {scrollIntoView:()=>state.scrolled.push(selector),classList:{add(){},remove(){}}};},
    querySelectorAll:()=>[],documentElement:new El('html')};
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
  for(const file of ['artist-id.js','image-cache.js','image-loader.js','folder-store.js','work-picker.js','viewer.js','test-images.js','app.js'])
    vm.runInNewContext(await fs.readFile('app/'+file,'utf8'),ctx);
  return {elements,state,ctx};
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
test('展开与收起 Danbooru 读取区后，视图重新对准正在编辑的卡片',async()=>{
  const {elements,state}=await boot();
  elements.get('add-artist').onclick();
  await wait(30);
  const card=lastRender(state)[0];
  const input=findByPlaceholder(card,'画师名字（必填）');
  input.value='tester';input.oninput();
  state.scrolled.length=0;
  findText(card,'展开读取').onclick();
  await wait(30);
  assert.equal(state.scrolled.length>=1,true,'展开后应把视图对准这张卡片');
  state.scrolled.length=0;
  findText(lastRender(state)[0],'收起').onclick();
  await wait(30);
  assert.equal(state.scrolled.length>=1,true,'收起后同样要重新对准，否则卡片变矮会让滚动位置跑掉');
  assert.equal(String(state.scrolled[0]).includes('0001')||String(state.scrolled[0]).includes('draft-'),true,'对准的是当前编辑画师的占位');
});
test('编辑已有画师时，卡片渲染成编辑态而不是浏览态',async()=>{
  const {elements,state}=await boot();
  elements.get('add-artist').onclick();
  const editing=lastRender(state)[0];
  assert.ok(editing.className.includes('is-editing'));
  assert.equal(editing.children.length>=3,true,'编辑态卡片应有信息区、作品区与展开区');
});
const post=id=>({id,url:'https://danbooru.donmai.us/posts/'+id,caption:'',thumbUrl:'https://cdn.donmai.us/360x360/'+id+'.jpg',previewUrl:'https://cdn.donmai.us/720x720/'+id+'.jpg',largeUrl:'https://cdn.donmai.us/original/'+id+'.jpg'});
const stub=(ctx,{lookup,details})=>{ctx.ArtistLookup={plan:value=>({input:String(value),query:String(value),kind:'name',siteUrl:'',apiUrl:''}),lookup,details,posts:async()=>[]};};
const runBatch=async(elements,names,collect=true)=>{
  const get=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id);};
  get('batch-artists').onclick();
  get('batch-names').value=names;
  get('batch-works').checked=collect;
  await get('batch-form').onsubmit({preventDefault(){}});
};
const findByClass=(node,cls)=>{for(const child of [node,...(node.children||[])]){if(String(child.className).split(/\s+/).includes(cls))return child;}for(const child of node.children||[]){const hit=findByClass(child,cls);if(hit)return hit;}return null;};
const findAllByClass=(node,cls,out=[])=>{if(String(node.className).split(/\s+/).includes(cls))out.push(node);for(const child of node.children||[])findAllByClass(child,cls,out);return out;};
const tagRowOf=editor=>findByClass(editor,'tag-editor-row');
test('编辑卡片的标签：全部标签平铺成按钮，点击勾选、再点取消',async()=>{
  const {elements,state}=await boot();
  elements.get('add-artist').onclick();
  const editor=findByClass(lastRender(state)[0],'tag-editor');
  assert.ok(editor,'编辑卡片里应有标签编辑器');
  const initial=findAllByClass(editor,'tag-choice');
  assert.ok(initial.length>0,'应把所有已有标签平铺成按钮');
  assert.equal(initial.every(choice=>choice.tagName==='button'),true,'每个标签是一个按钮');
  assert.equal(initial.every(choice=>choice.className==='tag-choice'),true,'默认全部未勾选');
  assert.equal(initial.every(choice=>choice['aria-pressed']==='false'),true,'未勾选时 aria-pressed 为 false');
  assert.equal(String(tagRowOf(editor).children[0].tagName).toLowerCase(),'input','下面留新建标签的输入框');

  initial[0].onclick();
  const picked=findAllByClass(editor,'tag-choice')[0];
  assert.equal(String(picked.className).includes('active'),true,'点击后进入勾选态');
  assert.equal(picked['aria-pressed'],'true');
  picked.onclick();
  const cleared=findAllByClass(editor,'tag-choice')[0];
  assert.equal(cleared.className,'tag-choice','再点一次取消勾选');
  assert.equal(cleared['aria-pressed'],'false');
});
test('编辑卡片的标签：勾选结果随保存写进画师资料',async()=>{
  const {elements,state}=await boot();
  elements.get('add-artist').onclick();
  const card=lastRender(state)[0];
  const nameInput=findByPlaceholder(card,'画师名字（必填）');
  nameInput.value='带标签的画师';nameInput.oninput();
  const editor=findByClass(card,'tag-editor'),choices=findAllByClass(editor,'tag-choice');
  const first=choices[0].textContent,second=choices[1].textContent;
  choices[0].onclick();
  findAllByClass(editor,'tag-choice')[1].onclick();
  await findText(lastRender(state)[0],'保存').onclick();
  assert.equal(state.rows[0].tags.length,2,'勾选两个标签');
  assert.equal(state.rows[0].tags.includes(first)&&state.rows[0].tags.includes(second),true,'勾选结果要写进画师资料');
});
test('编辑卡片的标签：输入新标签回车即可加入，并立刻变成勾选态的按钮',async()=>{
  const {elements,state}=await boot();
  elements.get('add-artist').onclick();
  const editor=findByClass(lastRender(state)[0],'tag-editor');
  const before=findAllByClass(editor,'tag-choice').length;
  const [input,addButton]=tagRowOf(editor).children;
  input.value='  新风格  ';input.onkeydown({key:'Enter',preventDefault(){}});
  let choices=findAllByClass(editor,'tag-choice');
  assert.equal(choices.length,before+1,'新标签应立刻出现在按钮里');
  const fresh=choices.find(choice=>choice.textContent==='新风格');
  assert.ok(fresh,'新标签按钮存在，且首尾空格已去掉');
  assert.equal(String(fresh.className).includes('active'),true,'新建的标签应处于勾选态');
  assert.equal(input.value,'','加入后应清空输入框');
  input.value='新风格';input.onkeydown({key:'Enter',preventDefault(){}});
  assert.equal(findAllByClass(editor,'tag-choice').length,before+1,'重复标签不应重复加入');
  input.value='另一个';addButton.onclick();
  assert.equal(findAllByClass(editor,'tag-choice').length,before+2,'「添加」按钮与回车等效');
});
test('管理标签：平时只显示名字，点「重命名」才就地把该行变输入框',async()=>{
  const {elements}=await boot();
  elements.get('manage-tags').onclick();
  const list=elements.get('tag-list'),row=list.children[0];
  assert.ok(row,'标签列表应有内容');
  const name=findByClass(row,'manage-name');
  assert.ok(name,'平时显示的应是文字而不是输入框');
  assert.equal(row.children.some(child=>child.tagName==='input'),false,'未进入编辑态时不应有输入框');
  assert.ok(findText(row,'重命名')&&findText(row,'删除'),'每行有重命名与删除');
  findText(row,'重命名').onclick();
  const input=row.children.find(child=>child.tagName==='input');
  assert.ok(input,'点重命名后该行应变成输入框');
  assert.equal(input.value,name.textContent,'输入框要预填当前名字');
  assert.ok(findText(row,'保存')&&findText(row,'取消'),'就地编辑要有保存与取消');
  findText(row,'取消').onclick();
  const rebuilt=elements.get('tag-list').children[0];
  assert.notEqual(rebuilt,row,'取消后列表重建回显示态');
  assert.equal(rebuilt.children.some(child=>child.tagName==='input'),false,'回到文字显示');
});
test('管理标签：搜索框只保留匹配的行，无匹配时给出提示',async()=>{
  const {elements}=await boot();
  elements.get('manage-tags').onclick();
  const list=elements.get('tag-list'),total=list.children.length,search=elements.get('tag-search');
  assert.ok(total>1,'默认应有多个标签才能验证筛选');
  const target=findByClass(list.children[0],'manage-name').textContent;
  search.value=target;search.oninput({target:search});
  assert.equal(list.children.length,1,'只剩匹配的一行');
  assert.equal(findByClass(list.children[0],'manage-name').textContent,target);
  search.value='绝对不存在的标签xyz';search.oninput({target:search});
  assert.equal(list.children.length,0);
  assert.equal(elements.get('tag-empty').hidden,false,'没有匹配时要给出提示');
  search.value='';search.oninput({target:search});
  assert.equal(list.children.length,total,'清空搜索恢复全部');
  assert.equal(elements.get('tag-empty').hidden,true);
});
test('管理分类：与标签同样支持行内重命名与筛选',async()=>{
  const {elements}=await boot();
  elements.get('manage-tags').onclick();
  const list=elements.get('category-list'),row=list.children[0];
  const name=findByClass(row,'manage-name');
  assert.ok(name,'分类也改为平时只显示名字');
  const target=name.textContent,total=list.children.length;
  findText(row,'重命名').onclick();
  assert.ok(row.children.find(child=>child.tagName==='input'),'分类同样就地编辑');
  findText(row,'取消').onclick();
  const search=elements.get('category-search');
  search.value=target;search.oninput({target:search});
  assert.equal(list.children.length,1,'分类也支持筛选');
  search.value='';search.oninput({target:search});
  assert.equal(list.children.length,total);
});
test('管理对话框：主分类与标签改成标签页，一次只展开一个',async()=>{
  const {elements}=await boot();
  elements.get('manage-tags').onclick();
  assert.equal(elements.get('panel-category').hidden,false,'打开时停在主分类');
  assert.equal(elements.get('panel-tag').hidden,true,'标签面板默认收起');
  assert.equal(elements.get('tab-category')['aria-selected'],'true');
  assert.equal(String(elements.get('tab-category').className).includes('active'),true);
  assert.equal(String(elements.get('tab-tag').className).includes('active'),false);
  elements.get('tab-tag').onclick();
  assert.equal(elements.get('panel-category').hidden,true,'切到标签后分类面板收起');
  assert.equal(elements.get('panel-tag').hidden,false);
  assert.equal(elements.get('tab-tag')['aria-selected'],'true');
  assert.equal(elements.get('tab-category')['aria-selected'],'false');
  assert.equal(String(elements.get('tab-category').className).includes('active'),false,'旧标签页要去掉高亮');
  assert.ok(findByClass(elements.get('tag-list').children[0],'manage-name'),'标签列表照常可用');
});
test('管理标签：拖动行首把手调整顺序，并同步到顶部筛选栏',async()=>{
  const {elements}=await boot();
  elements.get('manage-tags').onclick();
  const list=elements.get('tag-list');
  const before=list.children.map(row=>findByClass(row,'manage-name').textContent);
  assert.ok(before.length>=3,'默认标签数量要够验证移动');
  const handle=findByClass(list.children[0],'manage-handle');
  assert.ok(handle,'未筛选时每行应有拖动把手');
  handle.ondragstart({dataTransfer:null});
  list.children[2].ondragover({preventDefault(){}});
  list.children[2].ondrop({preventDefault(){}});
  await wait(20);
  const after=elements.get('tag-list').children.map(row=>findByClass(row,'manage-name').textContent);
  assert.equal(after.length,before.length,'数量不增不减');
  assert.equal(after[2],before[0],'被拖动的标签落到第 3 位');
  assert.equal(after[0],before[1],'其余标签依次前移');
  const filterOrder=elements.get('tags').children.map(button=>button.textContent);
  assert.equal(filterOrder[2],before[0],'新顺序要反映到顶部筛选栏');
});
test('管理分类：同样可以拖动把手调整顺序',async()=>{
  const {elements}=await boot();
  elements.get('manage-tags').onclick();
  const list=elements.get('category-list');
  const before=list.children.map(row=>findByClass(row,'manage-name').textContent);
  assert.ok(before.length>=2,'默认分类数量要够验证移动');
  assert.ok(findByClass(list.children[0],'manage-handle'),'分类也有拖动把手');
  findByClass(list.children[0],'manage-handle').ondragstart({dataTransfer:null});
  list.children[1].ondrop({preventDefault(){}});
  await wait(20);
  const after=elements.get('category-list').children.map(row=>findByClass(row,'manage-name').textContent);
  assert.equal(after[0],before[1],'与后一项互换位置');
  assert.equal(after[1],before[0]);
});
test('管理标签：筛选状态下不提供拖动把手，避免顺序歧义',async()=>{
  const {elements}=await boot();
  elements.get('manage-tags').onclick();
  const list=elements.get('tag-list'),search=elements.get('tag-search');
  const target=findByClass(list.children[0],'manage-name').textContent;
  assert.ok(findByClass(list.children[0],'manage-handle'),'未筛选时可以拖动排序');
  search.value=target;search.oninput({target:search});
  assert.equal(findAllByClass(list.children[0],'manage-handle').length,0,'筛选时不给把手');
  assert.equal(findByClass(list.children[0],'manage-name').textContent,target,'名字仍然显示');
  assert.ok(findText(list.children[0],'重命名'),'重命名照旧可用');
  search.value='';search.oninput({target:search});
  assert.ok(findByClass(list.children[0],'manage-handle'),'清空筛选后把手回来');
});
test('批量导入：默认勾选采集，为每位新画师写入作品数量与最新 3 张作品',async()=>{
  const {elements,state,ctx}=await boot();
  stub(ctx,{lookup:async()=>[{id:196870,name:'iuui',aliases:[],pageUrl:'https://danbooru.donmai.us/artists/196870'}],
    details:async()=>({counts:{checkedAt:'2026-01-01T00:00:00.000Z',total:1234,beforeDate:'2026-07-01',beforeTotal:100},works:[post('1'),post('2'),post('3'),post('4')],previewError:false,countsError:false})});
  await runBatch(elements,'iuui\nmodare');
  assert.equal(state.rows.length,2,'两位画师都应加入');
  assert.equal(state.rows[0].counts.total,1234,'作品数量要写入');
  assert.equal(state.rows[0].works.length,3,'只保留最新 3 张，第 4 张丢弃');
  assert.match(state.rows[0].uid,/^0001-iuui-196870$/,'解析到编号后应补进标识');
  assert.equal(state.rows[0].works[0].thumb.startsWith('data:'),true,'缩略图应先缓存为内联数据');
});
test('批量导入：采集开关在页面上默认勾选，且不再写「不采集作品」的旧说明',async()=>{
  const html=await fs.readFile('app/index.html','utf8');
  assert.match(html,/id="batch-works" type="checkbox" checked/,'采集最新 3 张作品应是默认行为');
  assert.equal(html.includes('不采集作品'),false,'旧提示语要同步改掉，否则与实际行为不符');
});
test('批量导入：取消勾选时保持旧行为，不采集作品也不写数量',async()=>{
  const {elements,state,ctx}=await boot();
  let queried=0;
  stub(ctx,{lookup:async()=>{queried++;return [];},details:async()=>{queried++;return {counts:{total:null},works:[],countsError:false};}});
  await runBatch(elements,'iuui',false);
  assert.equal(state.rows.length,1);
  assert.equal(queried,0,'未勾选采集时不应发出任何网络请求');
  assert.equal(state.rows[0].works.length,0);
  assert.equal(state.rows[0].counts,undefined,'不写数量，保持与旧版本一致');
  assert.match(state.rows[0].uid,/^0001-iuui-manual$/);
});
test('批量导入：名字匹配不唯一时不写编号，避免写错 Danbooru 编号',async()=>{
  const {elements,state,ctx}=await boot();
  stub(ctx,{lookup:async()=>[{id:1,name:'other',aliases:[],pageUrl:''},{id:2,name:'another',aliases:[],pageUrl:''}],
    details:async()=>({counts:{checkedAt:'x',total:7},works:[post('9')],countsError:false})});
  await runBatch(elements,'iuui');
  assert.match(state.rows[0].uid,/^0001-iuui-manual$/,'候选不唯一时必须保留 manual');
  assert.equal(state.rows[0].counts.total,7,'作品数量照常写入');
  assert.equal(state.rows[0].works.length,1);
});
test('批量导入：数量读取失败时不写数量，留待下次重试',async()=>{
  const {elements,state,ctx}=await boot();
  stub(ctx,{lookup:async()=>[],details:async()=>({counts:{total:null},works:[post('5')],countsError:true})});
  await runBatch(elements,'iuui');
  assert.equal(state.rows[0].counts,undefined,'失败不写 counts.checkedAt，重新提交同一名单会重试');
  assert.equal(state.rows[0].works.length,0);
});
