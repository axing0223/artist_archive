import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
/* 冒烟测试里的 stub 会把整个 ArtistLookup 换掉（连 plan 一起），假 plan 的 apiUrl 是空的。
   想验「三路搜索各自用了哪个参数」，就得把真实的 plan 接回去。 */
const nodeRequire=createRequire(import.meta.url);
const RealArtistLookup=nodeRequire('./app/artist-lookup.js');
const RealArtistId=nodeRequire('./app/artist-id.js');
const useRealPlan=ctx=>{ctx.ArtistLookup.plan=(value,options)=>RealArtistLookup.plan(value,options);};
class El{
  constructor(tag='div'){
    this.tagName=tag;this.children=[];this.className='';this._text='';this.dataset={};this.props={};
    this.style={setProperty:(k,v)=>{this.props[k]=v;}};
    this.classList={
      /* 跟真实 DOM 一样支持一次给多个类名，否则「加两个类」的代码在测试里只生效一半。 */
      add:(...classes)=>{const list=String(this.className).split(/\s+/).filter(Boolean);for(const cls of classes)if(!list.includes(cls))list.push(cls);this.className=list.join(' ');},
      remove:(...classes)=>{const drop=new Set(classes);this.className=String(this.className).split(/\s+/).filter(name=>name&&!drop.has(name)).join(' ');},
      /* toggle 要认第二个参数，不然「按条件加类」的代码在测试里永远看不出效果。 */
      toggle:(cls,force)=>{
        const list=String(this.className).split(/\s+/).filter(Boolean),on=force===undefined?!list.includes(cls):!!force;
        this.className=(on?[...new Set([...list,cls])]:list.filter(name=>name!==cls)).join(' ');
        return on;
      },
      contains:cls=>String(this.className).split(/\s+/).includes(cls),
    };
    this.hidden=false;this.value='';this.type='';this.checked=false;this.title='';this.placeholder='';this.href='';this.disabled=false;
    this.onclick=null;this.oninput=null;this.onchange=null;this.onerror=null;this.onload=null;
    this.showModal=()=>{};this.close=()=>{};
  }
  get textContent(){return this._text;}
  set textContent(value){this._text=value==null?'':String(value);this.children=[];}
  append(...nodes){for(const node of nodes)if(node){node.remove?.();node.parentNode=this;this.children.push(node);}}
  replaceChildren(...nodes){this.children=nodes.filter(Boolean);for(const node of this.children)node.parentNode=this;}
  insertBefore(node,before){if(node===before)return;node.remove();const index=this.children.indexOf(before);if(index<0)return this.append(node);node.parentNode=this;this.children.splice(index,0,node);}
  remove(){const parent=this.parentNode;if(parent)parent.children=parent.children.filter(child=>child!==this);this.parentNode=null;}
  setAttribute(key,value){this[key]=value;}
  removeAttribute(key){delete this[key];}
  focus(){this.focused=true;}scrollIntoView(options){(this.scrolls ||= []).push(options);}select(){}
  addEventListener(type,fn){(this.listeners??={});(this.listeners[type]??=[]).push(fn);}
  fire(type,event={}){if(typeof event.preventDefault!=='function'){event.defaultPrevented=false;event.preventDefault=()=>{event.defaultPrevented=true;};}for(const fn of this.listeners?.[type]||[])fn(event);return event;}
  querySelectorAll(){return [];}
}
/* 内存版文件夹：让冒烟测试真的走一遍「选好文件夹 → 保存 → 读回」的路径。 */
class FakeFile{
  constructor(name){this.name=name;this.kind='file';this.bytes='';}
  async getFile(){return new Blob([this.bytes]);}
  async createWritable(){const self=this;return {write:async value=>{self.bytes=value;},close:async()=>{},abort:async()=>{}};}
}
class FakeDir{
  constructor(name='数据'){this.name=name;this.kind='directory';this.items=new Map();}
  async getDirectoryHandle(name,{create=false}={}){if(!this.items.has(name)&&create)this.items.set(name,new FakeDir(name));const item=this.items.get(name);if(!item||item.kind!=='directory')throw new DOMException('不存在','NotFoundError');return item;}
  async getFileHandle(name,{create=false}={}){if(!this.items.has(name)&&create)this.items.set(name,new FakeFile(name));const item=this.items.get(name);if(!item||item.kind!=='file')throw new DOMException('不存在','NotFoundError');return item;}
  async *values(){yield* this.items.values();}
  async removeEntry(name){if(!this.items.has(name))throw new DOMException('找不到','NotFoundError');this.items.delete(name);}
}
/* 够用的 IndexedDB 替身：只服务「记住上次的数据文件夹」这条路径。 */
class FakeRequest{
  constructor(run){this.result=undefined;this.error=null;Promise.resolve().then(()=>{try{this.result=run();this.onsuccess?.();}catch(error){this.error=error;this.onerror?.();}});}
}
class FakeIDB{
  constructor(){this.stores=new Map();}
  createObjectStore(name){if(this.stores.has(name))throw Error('已存在');const store=new Map();this.stores.set(name,store);return store;}
  transaction(name){const map=this.stores.get(name);const request=fn=>new FakeRequest(()=>fn(map));return {objectStore:()=>({put:(value,key)=>request(()=>{map.set(key,value);return key;}),get:key=>request(()=>map.get(key)),delete:key=>request(()=>{map.delete(key);return true;})})};}
  close(){}
  open(){const request={result:this,onupgradeneeded:null,onsuccess:null,onerror:null};Promise.resolve().then(()=>{if(!this.stores.has('handles'))this.createObjectStore('handles');request.onupgradeneeded?.();request.onsuccess?.();});return request;}
}
/* 准备一个「上次用过的文件夹」：把句柄写进替身里，并给它加上权限查询/申请。 */
function makeIndexedDB(remembered){
  const db=new FakeIDB();
  if(remembered){
    const asked={query:0,request:0};
    const handle=Object.assign(remembered.dir,{
      asked,
      queryPermission:async()=>{asked.query++;return remembered.query||'granted';},
      requestPermission:async()=>{asked.request++;return remembered.request||'granted';},
    });
    db.createObjectStore('handles').set('dataFolder',handle);
  }
  return db;
}
async function boot(options={}){
  const elements=new Map(),state={renders:[],queried:[],scrolled:[],scrollCalls:[],mounted:[],copied:[],pageListeners:[],pageMessages:[],pendingActions:options.actions||[]};
  const document={getElementById:id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id);},createElement:tag=>new El(tag),
    querySelector:selector=>{state.queried.push(selector);return {scrollIntoView:(options={})=>{state.scrolled.push(selector);state.scrollCalls.push({selector,options});},classList:{add(){},remove(){}},getBoundingClientRect:()=>({top:0,height:0,left:0,width:0})};},
    querySelectorAll:()=>[],documentElement:new El('html')};
  const localStorage={store:new Map(),getItem(key){return this.store.has(key)?this.store.get(key):null;},setItem(key,value){this.store.set(key,String(value));}};
  class IO{constructor(fn){this.fn=fn;}observe(){}unobserve(){}disconnect(){}}
  class RO{observe(){}unobserve(){}disconnect(){}}
  class Option{constructor(text,value){this.textContent=text;this.value=value;}}
/* URL 要有真的构造函数：代码里用 new URL() 解析链接，只给 createObjectURL 的假对象
   会让所有带链接的画师在保存校验处静默失败。 */
class FileUrl extends URL{}
FileUrl.createObjectURL=()=>'blob:x';FileUrl.revokeObjectURL=()=>{};
  const ctx={
    window:{innerWidth:1200,innerHeight:800,listeners:{},addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);},showDirectoryPicker:async()=>new FakeDir()},document,localStorage,navigator:{clipboard:{writeText:async text=>{state.copied.push(text);}}},
    /* 扩展页里才有 chrome.runtime：页面靠它接右键菜单与漂浮提示的消息，也要主动去领一次待办。 */
    chrome:{runtime:{onMessage:{addListener:fn=>state.pageListeners.push(fn)},sendMessage:async message=>{
      state.pageMessages.push(message);
      if(message?.channel==='artist-library-page'&&message.type==='ready')return {actions:state.pendingActions};
      return null;
    }}},
    IntersectionObserver:IO,ResizeObserver:RO,Option,AbortController,AbortSignal,
    /* 记忆里的数据文件夹：给了 remembered 就预先塞进这个替身里，模拟「上次用过」。 */
    indexedDB:state.indexedDB=makeIndexedDB(options.remembered),
    atob,DOMException,crypto:{subtle:webcrypto.subtle,randomUUID:()=>'uuid-'+Math.random().toString(36).slice(2)},
    fetch:async()=>{throw Error('测试中不应联网');},
    URL:FileUrl,Blob,structuredClone,setTimeout,clearTimeout,requestAnimationFrame:fn=>fn(),
    ArtistImages:{bind(){},unbind(){},dispose(){},setFolder(){},clear(){},dataUrl:async()=>'data:image/jpeg;base64,/9j/2Q==',fetch:async()=>new Blob([])},
    ArtistExtension:{connected:false,canGenerate:false,canAccount:false,version:'',generate:async()=>{throw Error('未连接');},subscription:async()=>{throw Error('未连接');},check:async()=>{throw Error('测试中未连接扩展');},image:async()=>{throw Error('未连接');},resolve:async()=>{throw Error('未连接');}},
    ArtistGallery:{render(container,rows,card,keyOf){state.card=card;state.rows=rows;state.keyOf=keyOf;state.renders.push(rows.map(row=>card(row)));},clear(){},pin(){},markPainted(){},visible:()=>[],mount(uid){state.mounted.push(uid);return true;}},
    ArtistLookup:{plan(){throw Error('测试中不查询');},lookup:async()=>[],posts:async()=>[],details:async()=>({counts:{total:null,beforeTotal:null}})},
  };
  for(const file of ['artist-id.js','image-cache.js','image-loader.js','folder-store.js','folder-memory.js','novelai.js','image-gen.js','generate-queue.js','work-picker.js','viewer.js','test-images.js','library-index.js','app.js'])
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
test('浏览卡片按信息、五张作品、补充资料分层，操作集中且删除须明确选择',async()=>{
 const {state}=await boot();const card=state.card(bareArtist({artistUrl:'https://example.com/artist'}));
 assert.equal(card.children.length,3);assert.ok(card.children[0].className.includes('artist-info'));assert.ok(card.children[1].className.includes('works'));assert.ok(card.children[2].className.includes('artist-footer'));
 const actions=findByClass(card,'artist-actions');assert.ok(findText(actions,'编辑'));assert.ok(findText(actions,'删除'));const source=actions.children.find(n=>n.tagName==='a');assert.equal(source['aria-label'],'打开 tester 的画师页面');
 assert.deepEqual(actions.children.map(node=>node.textContent),['删除','画师页面','编辑'],'卡片右上角按删除、画师页面、编辑排列');assert.ok(findByClass(card.children[0],'artist-meta'));assert.equal(findAllByClass(card.children[1],'work').length,5,'必须为五个作品位置');
});
test('浏览态卡片的「删除画师」也要点两次才真删',async()=>{
  const {elements,state}=await boot();
  await createArtist(state,elements,'待删的');
  const uid=state.rows[0].uid;
  const button=()=>findText(lastRender(state)[0],'删除')||findText(lastRender(state)[0],'确认删除');
  const first=button();
  assert.equal(first.textContent,'删除','第一步是「删除」');
  await first.onclick();
  assert.equal(state.rows.length,1,'第一次点击只进入确认态，不删');
  assert.equal(first.textContent,'确认删除','就地变成确认文案');
  await first.onclick();
  assert.equal(state.rows.length,0,'第二次点击才真的删掉');
  assert.equal(state.rows.some(artist=>artist.uid===uid),false,'删的就是这张卡片这一位');
});
test('画师卡片：没写画风描述时不显示默认提示文字',async()=>{
  const {state}=await boot();
  const texts=node=>{const out=[];const walk=n=>{if(n._text)out.push(n._text);for(const child of n.children||[])walk(child);};walk(node);return out;};
  const empty=state.card(bareArtist());
  assert.equal(findAllByClass(empty,'description').length,0,'空描述不该渲染出 p 元素');
  assert.equal(texts(empty).includes('点击编辑，记录画风和特点。'),false,'空描述不再用占位文字');
  const filled=state.card(bareArtist({description:'厚涂风格，偏爱冷色。'}));
  assert.equal(texts(filled).includes('厚涂风格，偏爱冷色。'),true,'有描述时照常显示');
});
test('画师卡片：分类与标签整合进信息区，不再跨越作品图片',async()=>{
  const {state}=await boot();
  const card=state.card(bareArtist({category:'二次元',tags:['厚涂','黑白']}));
  const texts=node=>{const out=[];const walk=n=>{if(n._text)out.push(n._text);for(const child of n.children||[])walk(child);};walk(node);return out;};
  const metaNode=findByClass(card.children[0],'artist-meta'),info=texts(card.children[0]),meta=texts(metaNode);
  assert.equal(info.includes('二次元'),true,'分类位于信息区');
  assert.equal(info.includes('厚涂'),true,'标签位于信息区');
  assert.equal(meta.includes('二次元'),true,'分类在顶部标签条里');
  assert.equal(meta.includes('厚涂')&&meta.includes('黑白'),true,'标签也在顶部标签条里');
  assert.equal(findByClass(findByClass(card,'name-row'),'artist-meta'),metaNode,'分类和标签紧随名称，合并到同一行');
  assert.ok(findByClass(metaNode,'primary'),'分类沿用原有徽章样式');
  assert.ok(findByClass(metaNode,'secondary'),'标签沿用原有样式');
});
test('未填写画师页面时仍可编辑和删除，且不显示空链接',async()=>{
 const {state}=await boot();const actions=findByClass(state.card(bareArtist()),'artist-actions');assert.ok(findText(actions,'编辑'));assert.ok(findText(actions,'删除'));assert.equal(actions.children.some(n=>n.tagName==='a'),false);assert.equal(findText(actions,'画师页面').disabled,true);
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
test('编辑按钮在右上角按删除、刷新、取消、保存排列',async()=>{
  const {elements,state}=await boot();
  elements.get('add-artist').onclick();
  const card=lastRender(state)[0];
  const findClass=(node,cls)=>{if(String(node.className).includes(cls))return node;for(const child of node.children||[]){const hit=findClass(child,cls);if(hit)return hit;}return null;};
  const actions=findClass(card,'artist-actions');
  assert.ok(actions,'编辑态卡片应有操作区');
  assert.deepEqual(actions.children.map(child=>child.textContent),['删除画师','刷新','取消','保存'],'四个按钮要在同一个容器里依次排列');
  assert.equal(actions.children[3].className.includes('primary-action'),true,'保存是主操作');
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
test('设置里可以切换采集排序，编辑卡片按它取作品',async()=>{
  const {elements,state,ctx}=await boot();
  const asked=[];
  ctx.ArtistLookup={...ctx.ArtistLookup,plan:value=>({query:String(value)}),posts:async(tag,options)=>{asked.push({tag,...options});return [];}};
  const select=elements.get('work-order');
  assert.equal(select.children.map(option=>option.value).join(','),'favcount,score,id_desc','三档排序，收藏最多排第一');
  assert.equal(select.value,'favcount','默认按收藏最多采集');
  select.value='score';select.onchange();
  await wait(20);
  elements.get('add-artist').onclick();
  const card=lastRender(state)[0],nameInput=findByPlaceholder(card,'画师名字（必填）');
  nameInput.value='tester';nameInput.oninput();
  findText(card,'展开读取').onclick();
  await wait(20);
  assert.equal(asked.length,1,'展开后按设置取一次作品');
  assert.equal(asked[0].order,'score','用的是设置里改过的排序');
  assert.equal(asked[0].tag,'tester');
  assert.match(await fs.readFile('app/index.html','utf8'),/id="work-order" aria-label="采集作品的排序"/,'设置里要有这一栏');
});
test('保存画师是纯本地的：不发任何网络请求',async()=>{
  const {elements,state,ctx}=await boot();
  let calls=0;
  stub(ctx,{lookup:async()=>{calls++;return [];},details:async()=>{calls++;return {counts:{total:null,beforeTotal:null},countsError:false};}});
  elements.get('add-artist').onclick();
  const card=lastRender(state)[0],nameInput=findByPlaceholder(card,'画师名字（必填）');
  nameInput.value='tester';nameInput.oninput();
  const start=Date.now();
  await findText(lastRender(state)[0],'保存').onclick();
  const elapsed=Date.now()-start;
  assert.equal(calls,0,'保存不该发任何请求，数量和笔名都不在保存时读');
  assert.equal(state.rows.length,1,'画师照常保存');
  assert.equal(state.rows[0].name,'tester');
  assert.ok(elapsed<80,'不联网的保存应当是即时的，实测 '+elapsed+'ms');
});
test('刷新所有画师数据：核对正式名并刷新数量',async()=>{
  const {elements,state,ctx}=await boot();
  const asked=[];
  stub(ctx,{lookup:async()=>[],details:async name=>{asked.push(name);return {counts:{checkedAt:'x',total:asked.length*10,beforeDate:'2026-07-01',beforeTotal:1},countsError:false};}});
  const get=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id);};
  get('batch-artists').onclick();get('batch-names').value='甲\n乙\n丙';get('batch-works').checked=false;
  await get('batch-form').onsubmit({preventDefault(){}});
  assert.equal(state.rows.length,3,'先建出三位没有数量的画师');
  assert.equal(state.rows.every(artist=>!artist.counts),true,'没勾采集时不写数量');
  await get('sync-all').onclick();
  assert.equal(asked.length,3,'三位都要刷');
  assert.equal(state.rows.every(artist=>artist.counts&&artist.counts.total>0),true,'数量写进资料');
  assert.equal(get('sync-all').textContent,'开始刷新','结束后按钮回到初始文案');
  assert.equal(String(get('sync-all').className).includes('is-armed'),false,'结束后不再是停止态');
});
test('刷新所有画师数据：中途停下来的部分会保留',async()=>{
  const {elements,state,ctx}=await boot();
  let calls=0;
  const button=()=>{if(!elements.has('sync-all'))elements.set('sync-all',new El());return elements.get('sync-all');};
  stub(ctx,{lookup:async()=>[],details:async()=>{calls++;if(calls===2)button().onclick();return {counts:{checkedAt:'x',total:5},countsError:false};}});
  const get=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id);};
  get('batch-artists').onclick();get('batch-names').value='甲\n乙\n丙\n丁';get('batch-works').checked=false;
  await get('batch-form').onsubmit({preventDefault(){}});
  await get('sync-all').onclick();
  assert.ok(calls<4,'中途停止后不该再继续请求后面的画师，实际请求 '+calls+' 次');
  assert.ok(state.rows.some(artist=>artist.counts),'停下来之前刷到的部分要保留');
  assert.equal(String(get('sync-all').className).includes('is-armed'),false,'停止后按钮要复位');
});
test('导入画师时若站点已有正式名，名字与标识一起改过去并登记目录迁移',async()=>{
  const {elements,state,ctx}=await boot();
  const renames=[],original=ctx.FolderStore.rename;
  ctx.FolderStore.rename=(dir,from,to)=>{renames.push(from+'→'+to);return original(dir,from,to);};
  stub(ctx,{lookup:async()=>[{id:7,name:'betanonbeet',aliases:['betabeet'],pageUrl:''}],details:async()=>({counts:{checkedAt:'x',total:1},works:[],countsError:false})});
  const get=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id);};
  get('batch-artists').onclick();get('batch-names').value='betabeet';get('batch-works').checked=true;
  await get('batch-form').onsubmit({preventDefault(){}});
  assert.equal(state.rows[0].name,'betanonbeet','要改用站点上的正式名');
  assert.equal(state.rows[0].uid,'0001-betanonbeet-7','标识里的名字也要跟着换');
  assert.deepEqual(renames,['0001-betabeet-manual→0001-betanonbeet-7'],'必须登记目录迁移，否则 write 会删掉旧目录里的图片');
  assert.deepEqual([...state.rows[0].aliases],['betabeet'],'旧名也留在笔名里');
});
test('刷新所有画师数据：只改站点上确实改过名的那些',async()=>{
  const {elements,state,ctx}=await boot();
  const renames=[],original=ctx.FolderStore.rename;
  ctx.FolderStore.rename=(dir,from,to)=>{renames.push(from+'→'+to);return original(dir,from,to);};
  stub(ctx,{lookup:async plan=>{const name=plan.query;return name==='old'?[{id:5,name:'new',aliases:['old'],pageUrl:''}]:[{id:6,name,aliases:[],pageUrl:''}];},
    details:async()=>({counts:{checkedAt:'x',total:1},works:[],countsError:false})});
  const get=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id);};
  get('batch-artists').onclick();get('batch-names').value='old\nkeep';get('batch-works').checked=false;
  await get('batch-form').onsubmit({preventDefault(){}});
  assert.equal(state.rows.length,2,'两位画师，导入时不查站点');
  await get('sync-all').onclick();
  assert.equal(state.rows[0].name,'new','改过名的跟着改');
  assert.equal(state.rows[0].uid,'0001-new-5');
  assert.equal(state.rows[1].name,'keep','没改过名的不动');
  assert.equal(state.rows[1].uid,'0002-keep-manual','标识也不该变');
  assert.deepEqual(renames,['0001-old-manual→0001-new-5'],'只登记真正改名的那一位');
  assert.equal(get('sync-all').textContent,'开始刷新','结束后按钮复位');
});
test('刷新所有画师数据：撞名时跳过，不制造重名',async()=>{
  const {elements,state,ctx}=await boot();
  stub(ctx,{lookup:async plan=>plan.query==='dup'?[{id:9,name:'taken',aliases:[],pageUrl:''}]:[{id:8,name:plan.query,aliases:[],pageUrl:''}],
    details:async()=>({counts:{},countsError:false})});
  const get=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id);};
  get('batch-artists').onclick();get('batch-names').value='taken\ndup';get('batch-works').checked=false;
  await get('batch-form').onsubmit({preventDefault(){}});
  await get('sync-all').onclick();
  assert.equal(state.rows[0].name,'taken');
  assert.equal(state.rows[1].name,'dup','改名会撞上已有画师时要跳过');
  assert.equal(state.rows[1].uid,'0002-dup-manual');
});
test('导入画师时读一次笔名，保存时不再查询',async()=>{
  const {elements,state,ctx}=await boot();
  let lookups=0,details=0;
  stub(ctx,{lookup:async()=>{lookups++;return [{id:7,name:'tester',aliases:['甲','乙','丙'],pageUrl:''}];},
    details:async()=>{details++;return {counts:{checkedAt:'x',total:1},works:[],countsError:false};}});
  const get=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id);};
  get('batch-artists').onclick();get('batch-names').value='tester';get('batch-works').checked=true;
  await get('batch-form').onsubmit({preventDefault(){}});
  assert.equal(state.rows[0].aliases.length,3,'导入时读到的笔名要存进资料');
  assert.equal(lookups,1,'导入时查一次笔名');
  const before=details;
  findText(lastRender(state)[0],'编辑').onclick();
  await wait(180);
  await findText(lastRender(state)[0],'保存').onclick();
  assert.equal(lookups,1,'保存时不再查询笔名');
  assert.equal(details,before,'保存时也不再查询数量，一次请求都不发');
  assert.equal(state.rows[0].aliases.length,3,'不查笔名也不会把已有的弄丢');
  assert.equal(state.rows[0].counts.total,1,'已有的数量也不会被弄丢');
});
test('批量导入可以只对本次改排序，默认跟随设置',async()=>{
  const {elements,state,ctx}=await boot();
  const asked=[];
  stub(ctx,{lookup:async()=>[],details:async(name,date,options)=>{asked.push(options.order);return {counts:{checkedAt:'x',total:1},works:[],countsError:false};}});
  const get=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id);};
  const select=get('batch-order');
  assert.equal(select.children.map(option=>option.value).join(','),'favcount,score,id_desc','三档排序，收藏最多排第一');
  const submit=async names=>{get('batch-names').value=names;get('batch-works').checked=true;await get('batch-form').onsubmit({preventDefault(){}});};
  get('batch-artists').onclick();
  assert.equal(select.value,'favcount','打开时默认用设置里的排序');
  await submit('甲画师');
  assert.deepEqual(asked,['favcount'],'默认跟随设置');
  asked.length=0;
  get('batch-artists').onclick();
  select.value='score';
  await submit('乙画师');
  assert.deepEqual(asked,['score'],'这一次可以单独换排序');
  assert.equal(get('batch-order').value,'score','改过的排序在本次对话框里保留');
  get('batch-artists').onclick();
  assert.equal(get('batch-order').value,'favcount','重新打开会重置回设置里的默认');
});
test('收起「从 Danbooru 添加作品」后不留下空的 work-picker 容器',async()=>{
  const {elements,state}=await boot();
  elements.get('add-artist').onclick();
  const card=lastRender(state)[0],nameInput=findByPlaceholder(card,'画师名字（必填）');
  nameInput.value='tester';nameInput.oninput();
  const expand=findByClass(card,'artist-expand'),hosts=()=>expand.children.filter(child=>String(child.className).includes('work-picker'));
  findText(card,'展开读取').onclick();
  await wait(20);
  assert.equal(hosts().length,1,'展开后应有一个容器');
  findText(card,'收起').onclick();
  await wait(20);
  assert.equal(hosts().length,0,'收起后容器要整个移除，不能只清空里面的内容');
  assert.equal(expand.children.length,1,'展开区只剩标题行');
  findText(card,'展开读取').onclick();
  await wait(20);
  assert.equal(hosts().length,1,'再展开仍然只有一个，不会越积越多');
  findText(card,'收起').onclick();
  await wait(20);
  assert.equal(hosts().length,0);
});
test('编辑界面刷新当前画师：数量、正式名、笔名一起更新，保存时才落盘',async()=>{
  const {elements,state,ctx}=await boot();
  const renames=[],original=ctx.FolderStore.rename;
  ctx.FolderStore.rename=(dir,from,to)=>{renames.push(from+'→'+to);return original(dir,from,to);};
  stub(ctx,{lookup:async()=>[{id:7,name:'betanonbeet',aliases:['betabeet','bb'],pageUrl:''}],
    details:async()=>({counts:{checkedAt:'x',total:42,beforeTotal:9},countsError:false})});
  await createArtist(state,elements,'betabeet');
  findText(lastRender(state)[0],'编辑').onclick();
  await wait(180);
  await findText(lastRender(state)[0],'刷新').onclick();
  const card=lastRender(state)[0];
  assert.equal(findByPlaceholder(card,'画师名字（必填）').value,'betanonbeet','名字同步成站点上的正式名');
  assert.equal(findAllByClass(findByClass(card,'alias-picker'),'alias-choice').length,2,'笔名也一并带回来');
  await findText(lastRender(state)[0],'保存').onclick();
  assert.equal(state.rows[0].name,'betanonbeet');
  assert.equal(state.rows[0].uid,'0001-betanonbeet-7','保存时标识跟着名字一起换');
  assert.equal(state.rows[0].counts.total,42,'数量落盘');
  assert.equal(state.rows[0].counts.beforeTotal,9);
  assert.deepEqual(renames,['0001-betabeet-manual→0001-betanonbeet-7'],'要登记目录迁移，否则旧目录里的图片会被删掉');
});
test('编辑界面刷新：站点正式名会撞上库里已有画师时不跟着改',async()=>{
  const {elements,state,ctx}=await boot();
  const get=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id);};
  get('batch-artists').onclick();get('batch-names').value='old\ntaken';get('batch-works').checked=false;
  await get('batch-form').onsubmit({preventDefault(){}});
  stub(ctx,{lookup:async()=>[{id:9,name:'taken',aliases:[],pageUrl:''}],details:async()=>({counts:{},countsError:false})});
  findText(lastRender(state)[0],'编辑').onclick();
  await wait(180);
  await findText(lastRender(state)[0],'刷新').onclick();
  assert.equal(findByPlaceholder(lastRender(state)[0],'画师名字（必填）').value,'old','撞名时不该改名字');
  await findText(lastRender(state)[0],'保存').onclick();
  assert.equal(state.rows[0].name,'old','撞名时不该改名字');
  assert.equal(state.rows[0].uid,'0001-old-9','名字不变，但刷新补上了编号，标识要跟着补');
  assert.equal(state.rows[1].name,'taken','另一位不受影响');
});
test('编辑界面刷新：点取消则刷到的内容全部丢弃',async()=>{
  const {elements,state,ctx}=await boot();
  stub(ctx,{lookup:async()=>[{id:7,name:'betanonbeet',aliases:['betabeet'],pageUrl:''}],
    details:async()=>({counts:{checkedAt:'x',total:42},countsError:false})});
  await createArtist(state,elements,'betabeet');
  findText(lastRender(state)[0],'编辑').onclick();
  await wait(180);
  await findText(lastRender(state)[0],'刷新').onclick();
  findText(lastRender(state)[0],'取消').onclick();
  await wait(180);
  assert.equal(state.rows[0].name,'betabeet','取消后保持原样');
  assert.equal(state.rows[0].uid,'0001-betabeet-manual');
  assert.notEqual(state.rows[0].counts&&state.rows[0].counts.total,42,'刷新只改表单，没保存就不该落盘');
});
test('设置里的预览图尺寸滑动条可以逐像素调',async()=>{
  const html=await fs.readFile('app/index.html','utf8');
  assert.match(html,/id="card-size"[^>]*type="range" min="140" max="360" step="1"/,'刻度要细到 1，不能是 20');
  const {elements}=await boot();
  const get=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id);};
  const size=get('card-size'),label=get('card-size-value');
  size.value='237';size.oninput();
  assert.equal(label.textContent,'237','滑到哪就显示哪，不再被吸附到整数十');
});
test('画师卡片：点画师名即可复制 tag',async()=>{
  const {state}=await boot();
  const card=state.card(bareArtist({name:'modare'})),nameButton=findByClass(card,'artist-name');
  assert.ok(nameButton,'画师名要可点击');
  assert.equal(nameButton.textContent,'modare');
  assert.equal(nameButton.title,'点击复制画师 tag');
  await nameButton.onclick();
  assert.deepEqual(state.copied,['modare'],'复制的是画师 tag，不是序号也不是编号');
});
test('筛选列表：分数精确匹配、可多选，未评分单独一项',async()=>{
  const {elements,state}=await boot();
  const get=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id);};
  get('batch-artists').onclick();get('batch-names').value='甲\n乙';get('batch-works').checked=false;
  await get('batch-form').onsubmit({preventDefault(){}});
  findText(lastRender(state)[0],'编辑').onclick();
  await wait(180);
  findAllByClass(findByClass(lastRender(state)[0],'score-picker'),'score-pick')[4].onclick();
  await findText(lastRender(state)[0],'保存').onclick();
  const picks=get('scores').children,visible=()=>state.renders[state.renders.length-1].length;
  assert.equal(picks.length,6,'1 到 5 分，加一个未评分');
  assert.equal(picks.slice(0,5).map(b=>b.textContent).join(''),'12345');
  assert.equal(picks[5].textContent,'未评分');
  assert.equal(picks.every(b=>b['aria-pressed']==='false'),true,'默认不按分数筛');
  picks[5].onclick();
  assert.equal(visible(),1,'筛未评分只剩没打分的那位');
  picks[4].onclick();
  assert.equal(visible(),2,'可多选：未评分 + 5 分');
  picks[5].onclick();
  assert.equal(visible(),1,'取消未评分，只剩 5 分那位');
  picks[4].onclick();
  assert.equal(visible(),2,'全部取消后不按分数筛');
});
test('清除筛选会把分数也一起清掉',async()=>{
  const {elements,state}=await boot();
  const get=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id);};
  get('batch-artists').onclick();get('batch-names').value='甲';get('batch-works').checked=false;
  await get('batch-form').onsubmit({preventDefault(){}});
  get('scores').children[4].onclick();
  assert.equal(get('scores').children[4]['aria-pressed'],'true');
  get('reset').onclick();
  assert.equal(get('scores').children[4]['aria-pressed'],'false','清除筛选要把分数一起复位');
});
test('手动展开聚焦候选作品，视线对准画师作品格，收起返回编辑卡片',async()=>{
 const {elements,state}=await boot();elements.get('add-artist').onclick();await wait(30);const card=lastRender(state)[0];
 const input=findByPlaceholder(card,'画师名字（必填）');input.value='tester';input.oninput();
 state.scrollCalls.length=0;
 findText(card,'展开读取').onclick();await wait(30);const grid=findByClass(card,'candidate-previews'),host=findByClass(card,'work-picker');
 assert.equal(grid.focused,true,'键盘焦点到候选作品');assert.equal((host.scrolls||[]).length,0,'候选区不再自己抢视线');
 const call=state.scrollCalls.find(item=>item.selector.includes('.works'));
 assert.ok(call,'展开后视线交给画师作品格');assert.equal(call.options.block,'start','顶部对齐：作品格与第一行候选同时入画');
 state.scrolled.length=0;state.scrollCalls.length=0;const hostScrolls=(host.scrolls||[]).length;await wait(460);
 assert.equal((host.scrolls||[]).length,hostScrolls,'图片挂载后的二次校准不能把候选区再顶上去');
 if(state.scrollCalls.length)assert.ok(state.scrollCalls.every(item=>item.selector.includes('.works')),'二次校准若发生，也只能对准作品格');
 findText(card,'收起').onclick();await wait(30);assert.ok(state.scrolled.length>0,'收起返回当前编辑卡片');
});

test('编辑已有画师时，卡片渲染成编辑态而不是浏览态',async()=>{
  const {elements,state}=await boot();
  elements.get('add-artist').onclick();
  const editing=lastRender(state)[0];
  assert.ok(editing.className.includes('is-editing'));
  assert.equal(editing.children.length>=3,true,'编辑态卡片应有信息区、作品区与展开区');
});
const post=id=>({id,url:'https://danbooru.donmai.us/posts/'+id,caption:'',thumbUrl:'https://cdn.donmai.us/360x360/'+id+'.jpg',previewUrl:'https://cdn.donmai.us/720x720/'+id+'.jpg',largeUrl:'https://cdn.donmai.us/original/'+id+'.jpg'});
const stub=(ctx,{lookup,details,posts})=>{ctx.ArtistLookup={plan:(value,options)=>({input:String(value),query:String(value),kind:options?.match==='id'?'id':'name',siteUrl:'',apiUrl:''}),lookup,details,posts:posts||(async()=>[])};};
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
const bareArtist=extra=>({uid:'0001-tester-1',order:1,name:'tester',category:null,score:null,aliases:[],alias:null,tags:[],danbooruId:null,counts:{},artistUrl:'',description:'',note:'',basis:'',status:'',works:[{id:'1',thumb:null}],...extra});
const getEl=(elements,id)=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id);};
const thumbWorks=n=>Array.from({length:n},(_,i)=>({id:String(i+1),thumb:null}));
test('固定测试风格图：右侧 2 格固定给测试风格 1、2，作品图只用左边 3 格',async()=>{
  const {elements,state}=await boot();
  const card=()=>state.card(bareArtist({works:thumbWorks(4)}));
  assert.equal(findAllByClass(card(),'work-generate').length,0,'默认关闭时不留固定格');
  const toggle=getEl(elements,'fixed-test');toggle.checked=true;await toggle.onchange();
  let children=findByClass(card(),'works').children;
  assert.equal(children.length,5,'固定 5 格');
  assert.equal(children.slice(0,3).filter(node=>String(node.className).includes('work-generate')).length,0,'左边 3 格照旧放作品');
  assert.equal(children[3].className,'work work-generate','第 4 格固定');
  assert.equal(children[4].className,'work work-generate','第 5 格固定');
  assert.deepEqual(children.slice(3).map(node=>findByClass(node,'generate-seq').textContent),['测试风格 2','测试风格 1'],'序号 1 在最右');
  assert.equal(children.filter(node=>node.children.some(child=>String(child.className).includes('thumb'))).length,3,'第 4 张作品被固定格挡住，不再显示');
});
test('固定测试风格图：已有的测试图回自己的固定格，只剩另一格给「生成」',async()=>{
  const {elements,state}=await boot();
  const toggle=getEl(elements,'fixed-test');toggle.checked=true;await toggle.onchange();
  const children=findByClass(state.card(bareArtist({works:[...thumbWorks(3),{id:'',kind:'test',testSeq:1,thumb:null}]})),'works').children;
  assert.equal(children[3].className,'work work-generate','序号 2 还没生成，留一个生成入口');
  assert.equal(findByClass(children[3],'generate-seq').textContent,'测试风格 2');
  assert.equal(String(children[4].className).includes('is-test'),true,'序号 1 的测试图占最右格');
});
test('卡片格子左下角：#编号可点开对应的 Danbooru 作品页，测试风格图不给链接',async()=>{
  const {state}=await boot();
  const card=state.card(bareArtist({works:[{id:'12345',url:'https://danbooru.donmai.us/posts/12345',thumb:null}]}));
  const mark=findByClass(card,'work-id');
  assert.ok(mark,'有编号的作品要给出可点的编号');
  assert.equal(mark.textContent,'#12345');
  assert.equal(mark.href,'https://danbooru.donmai.us/posts/12345');
  assert.equal(mark.target,'_blank');assert.equal(mark.rel,'noopener noreferrer');
  /* 没有存 url 但知道编号时，按编号拼出作品页 */
  const built=state.card(bareArtist({works:[{id:'777',url:'',thumb:null}]}));
  assert.equal(findByClass(built,'work-id').href,'https://danbooru.donmai.us/posts/777');
  /* 测试风格图只有序号文字，不是链接 */
  const test=state.card(bareArtist({works:[{id:'',kind:'test',testSeq:2,thumb:null}]}));
  assert.equal(findByClass(test,'work-id'),null,'测试风格图不该有编号链接');
  assert.ok(findText(test,'测试风格 2'),'测试风格图只写序号');
});
test('卡片格子右下角：删除按钮要点两次，第二次才真的删掉这一格',async()=>{
  const {elements,state}=await boot();
  await createArtist(state,elements,'tester');
  const artist=state.rows[0];artist.works.push({id:'1',url:'',thumb:null},{id:'2',url:'',thumb:null});
  const button=findByClass(state.card(artist),'slot-delete');
  assert.ok(button,'右下角要有删除按钮');
  assert.equal(button.textContent,'删除');
  await button.onclick();
  assert.equal(button.textContent,'再点一次删除','第一次点击只进入确认态');
  assert.equal(String(button.className).includes('is-armed'),true);
  assert.equal(artist.works.length,2,'还没真的删');
  await button.onclick();
  assert.equal(state.rows[0].works.length,1,'第二次点击才删掉这一格');
  assert.equal(state.rows[0].works[0].id,'2','删的是被点的那一格');
});
test('拖图片到格子上：格子接住了拖放，整页兜底不会让浏览器打开这个文件',async()=>{
  const {elements,state,ctx}=await boot();
  await wait(10);
  const box=findByClass(state.card(bareArtist({works:[]})),'work-empty');
  assert.ok(box,'空格子也要能接住拖放');
  assert.equal(typeof box.listeners?.dragover?.[0],'function','格子要监听 dragover');
  assert.equal(typeof box.listeners?.drop?.[0],'function','格子要监听 drop');
  const over={dataTransfer:{dropEffect:''}};
  box.fire('dragover',over);
  assert.equal(over.defaultPrevented,true,'不 preventDefault 的话浏览器不会触发 drop');
  assert.equal(over.dataTransfer.dropEffect,'copy');
  assert.equal(String(box.className).includes('is-drop-target'),true,'悬停时要高亮');
  box.fire('dragleave');
  assert.equal(String(box.className).includes('is-drop-target'),false,'移开要取消高亮');
  /* 没选数据文件夹时拖进来：不发请求，把原因说清楚 */
  const drop={dataTransfer:{files:[{name:'a.png',type:'image/png',size:100}]}};
  box.fire('drop',drop);
  assert.equal(drop.defaultPrevented,true);
  assert.match(String(getEl(elements,'storage-status').textContent),/数据.*文件夹/);
  /* 整页兜底：window 上挂着 dragover/drop 的 preventDefault */
  assert.equal(typeof ctx.window.listeners?.dragover?.[0],'function','窗口层要兜住拖放，免得浏览器直接打开文件');
  assert.equal(typeof ctx.window.listeners?.drop?.[0],'function');
});
test('批量导入：同时生成测试风格图默认关闭，且只在勾了以后才排生成需求',async()=>{
  const html=await fs.readFile('app/index.html','utf8');
  assert.match(html,/id="batch-generate"[^>]*type="checkbox"(?![^>]*checked)[^>]*><span><\/span>/,'默认必须是关的：不能带 checked');
  assert.match(html,/id="batch-run" class="action primary-action">添加到画师库/,'按钮要有 id，才能就地变红确认');
  const {elements}=await boot();
  assert.equal(getEl(elements,'batch-generate').checked,false,'不勾就不排');
});
test('批量导入：超过 20 位又勾了生成时，按钮先变红确认，再点一次才真的导入',async()=>{
  const {elements,state}=await boot();
  const names=n=>Array.from({length:n},(_,i)=>'artist'+i).join('\n');
  const run=async()=>getEl(elements,'batch-form').onsubmit({preventDefault(){}});
  getEl(elements,'batch-works').checked=false;
  getEl(elements,'batch-generate').checked=true;
  getEl(elements,'batch-names').value=names(21);
  const button=getEl(elements,'batch-run');
  await run();
  assert.equal(state.rows.length,0,'第一次点击不该导入');
  assert.equal(button.textContent,'确认导入 21 位？');
  assert.equal(String(button.className).includes('is-armed'),true,'要点亮（样式表里 is-armed 的主按钮就是红的）');
  assert.match(String(getEl(elements,'batch-message').textContent),/21 条/,'要写清楚会排多少条生成需求');
  await run();
  assert.equal(state.rows.length,21,'第二次点才真的导入');
  assert.equal(button.textContent,'添加到画师库','确认后按钮要复原');
  assert.equal(String(button.className).includes('is-armed'),false);
});
test('批量导入：人数不多、或没勾生成时都不弹二次确认',async()=>{
  const {elements,state}=await boot();
  const run=async()=>getEl(elements,'batch-form').onsubmit({preventDefault(){}});
  const names=n=>Array.from({length:n},(_,i)=>'artist'+i).join('\n');
  getEl(elements,'batch-works').checked=false;
  getEl(elements,'batch-generate').checked=true;
  getEl(elements,'batch-names').value=names(20);
  await run();
  assert.equal(state.rows.length,20,'刚好 20 位不算「超过 20」，直接导入');
  /* 没勾生成时，人再多也不确认 */
  const {elements:e2,state:s2}=await boot();
  getEl(e2,'batch-works').checked=false;
  getEl(e2,'batch-generate').checked=false;
  getEl(e2,'batch-names').value=names(30);
  await getEl(e2,'batch-form').onsubmit({preventDefault(){}});
  assert.equal(s2.rows.length,30,'没勾生成就直接导入');
  assert.equal(String(getEl(e2,'batch-run').className).includes('is-armed'),false,'按钮不该点亮');
  assert.equal(String(getEl(e2,'batch-message').textContent).includes('确认'),false,'也不该出现确认文案');
});
test('批量导入勾了生成时：导入照常先跑完，生成需求进后台队列（不占导入时间）',async()=>{
  const {elements,state,ctx}=await boot();
  await getEl(elements,'choose-folder').onclick();
  assert.match(String(getEl(elements,'folder-name').textContent),/当前文件夹/,'先得真的连上数据文件夹');
  /* 生成这一步换成立即失败、间隔调成 0：既不打网络，也不让测试等 5±3 秒。 */
  const asked=[];
  ctx.ArtistImageGen.generate=async artist=>{asked.push(artist.name);throw Error('测试里不发请求');};
  ctx.ArtistImageGen.genGapDelay=()=>0;
  getEl(elements,'batch-works').checked=false;
  getEl(elements,'batch-generate').checked=true;
  getEl(elements,'batch-names').value='甲\n乙\n丙';
  await getEl(elements,'batch-form').onsubmit({preventDefault(){}});
  assert.equal(state.rows.length,3,'导入该结束就结束');
  assert.match(String(getEl(elements,'batch-message').textContent),/已排入 3 条生成需求/,'导入结束后才排队，并把条数写清楚');
  const badge=getEl(elements,'gen-queue');
  assert.equal(badge.hidden,false,'有排队时顶部要出现队列入口');
  assert.match(String(badge.textContent),/排队 [1-9]\d*/);
  assert.equal(badge.title.includes('取消'),true,'点一下能取消排队');
  /* 不勾生成时不该排任何东西 */
  const {elements:e2,state:s2,ctx:c2}=await boot();
  await getEl(e2,'choose-folder').onclick();
  let fired=0;c2.ArtistImageGen.generate=async()=>{fired++;throw Error('不该走到这里');};
  getEl(e2,'batch-works').checked=false;getEl(e2,'batch-generate').checked=false;
  getEl(e2,'batch-names').value='甲\n乙';
  await getEl(e2,'batch-form').onsubmit({preventDefault(){}});
  assert.equal(s2.rows.length,2);
  assert.equal(getEl(e2,'gen-queue').hidden,true,'没勾就不该有排队');
  assert.equal(String(getEl(e2,'batch-message').textContent).includes('排入'),false);
  assert.equal(fired,0);
});
test('打开网页就自动接上上次的文件夹：权限还在时不打扰用户',async()=>{
  const dir=new FakeDir('数据');
  const {elements,state}=await boot({remembered:{dir,query:'granted'}});
  await wait(20);
  assert.equal(dir.asked.query,1,'要先问一下权限还在不在');
  assert.equal(dir.asked.request,0,'权限还在就不该再弹申请');
  assert.match(String(getEl(elements,'folder-name').textContent),/当前文件夹：数据/,'自动接上要显示当前文件夹');
  assert.match(String(getEl(elements,'storage-status').textContent),/上次的文件夹/,'状态栏要说清是自动接上的');
  assert.equal(getEl(elements,'resume-folder').hidden,true,'自动接上后不该再显示那个按钮');
  assert.equal(getEl(elements,'add-artist').disabled,false,'接上之后功能要能用');
  const {elements:e2,state:s2}=await boot({remembered:{dir:new FakeDir('数据'),query:'denied'}});
  await wait(20);
  assert.equal(getEl(e2,'resume-folder').hidden,true,'权限被拒就不给按钮');
  assert.equal(String(getEl(e2,'folder-name').textContent).includes('当前文件夹'),false,'也不该自动接上');
  assert.equal(s2.indexedDB.stores.get('handles').has('dataFolder'),false,'权限没了就把这条记忆忘掉');
});
test('浏览器重启后权限退回询问：给一个按钮，点一下就能继续用上次的文件夹',async()=>{
  const dir=new FakeDir('数据');
  const {elements,state}=await boot({remembered:{dir,query:'prompt',request:'granted'}});
  await wait(20);
  const button=getEl(elements,'resume-folder');
  assert.equal(button.hidden,false,'该出现「继续使用上次的文件夹」');
  assert.match(String(button.textContent),/数据/,'按钮上要写清是哪个文件夹');
  assert.match(String(getEl(elements,'storage-status').textContent),/上次用的是/);
  assert.equal(String(getEl(elements,'folder-name').textContent).includes('当前文件夹'),false,'没点按钮之前不接上');
  assert.equal(dir.asked.request,0,'先不申请，等用户点');
  await button.onclick();
  assert.equal(dir.asked.request,1,'点一下才去申请权限');
  assert.match(String(getEl(elements,'folder-name').textContent),/当前文件夹：数据/);
  assert.equal(button.hidden,true,'接上后按钮收起');
  assert.equal(state.indexedDB.stores.get('handles').has('dataFolder'),true,'继续用之后这条记忆留着');
  /* 用户在权限弹窗里点了拒绝：忘掉这条记忆，回到手动选择 */
  const denied=new FakeDir('数据');
  const second=await boot({remembered:{dir:denied,query:'prompt',request:'denied'}});
  await wait(20);
  await getEl(second.elements,'resume-folder').onclick();
  assert.equal(denied.asked.request,1);
  assert.equal(getEl(second.elements,'resume-folder').hidden,true);
  assert.match(String(getEl(second.elements,'storage-status').textContent),/重新选择/);
  assert.equal(second.state.indexedDB.stores.get('handles').has('dataFolder'),false,'拒绝了就把记忆清掉');
  assert.equal(String(getEl(second.elements,'folder-name').textContent).includes('当前文件夹'),false);
});
test('手动选完文件夹会记下来，供下次打开时自动接上',async()=>{
  const {elements,state}=await boot();
  await getEl(elements,'choose-folder').onclick();
  assert.match(String(getEl(elements,'folder-name').textContent),/当前文件夹/);
  const stored=state.indexedDB.stores.get('handles')?.get('dataFolder');
  assert.ok(stored,'选过的文件夹要存进 IndexedDB');
  assert.equal(stored.name,'数据','存的是目录句柄本身');
  assert.match(String(getEl(elements,'storage-status').textContent),/已连接文件夹/);
  assert.equal(String(getEl(elements,'storage-status').textContent).includes('记不住'),false,'能记住时不该出现那句提示');
});
test('固定格的生成按钮：排队/正在生成时，重建卡片也要显示对应状态而不是变回「生成」',async()=>{
  const {elements,state,ctx}=await boot();
  await getEl(elements,'choose-folder').onclick();
  await createArtist(state,elements,'tester');
  const toggle=getEl(elements,'fixed-test');toggle.checked=true;await toggle.onchange();
  const artist=state.rows[0];
  /* 生图这块换成「挂着不返回」，好让队列停在正在生成的状态 */
  let release=null;
  ctx.ArtistImageGen.generate=()=>new Promise(resolve=>{release=resolve;});
  const boxes=()=>findAllByClass(state.card(artist),'work-generate');
  /* 同一张卡片上取两格（同一次构建里的节点，点之前先拿到手） */
  const [left,right]=boxes();
  const arm=node=>{const button=findByClass(node,'generate-button');button.onclick();button.onclick();};
  arm(right);
  /* 1 号图还在跑的时候，把另一格也排上——这正是用户报的场景 */
  arm(left);
  /* 关键：卡片被重建（保存、队列变动都会触发）之后，格子不能再变回「生成」 */
  const rebuilt=boxes();
  const stateOf=node=>{
    if(String(node.className).includes('is-generating')||findByClass(node,'gen-spinner'))return 'running';
    if(String(node.className).includes('is-queued'))return 'queued';
    return 'plain';
  };
  const kinds=rebuilt.map(stateOf);
  assert.equal(kinds.includes('running'),true,'正在生成的那一格重建后仍要显示正在生成，实际：'+rebuilt.map(node=>node.className).join(' | '));
  assert.equal(kinds.includes('queued'),true,'排队中的那一格重建后仍要显示排队中');
  assert.equal(kinds.includes('plain'),false,'这时候不该有任何一格回到可点的「生成」按钮');
  const queued=rebuilt[kinds.indexOf('queued')];
  assert.match(String(findByClass(queued,'generate-button')?.textContent),/排队中/, '排队那一格要写清排在第几位');
  release?.({blob:new Blob([]),prompt:'x',free:true,width:832,height:1216,steps:28,account:null});
  await wait(30);
});
test('保存一位画师、切换筛选都不再整屏重播入场动画；动效只由画廊逐张处理',async()=>{
  const {elements,state}=await boot();
  await createArtist(state,elements,'tester');
  const gallery=()=>getEl(elements,'gallery');
  assert.equal(String(gallery().className).includes('is-refreshing'),false,'不该再挂整屏重播标记');
  /* 只是改内容（保存设置、保存某位画师）：列表还是那一批人，本来就不该动 */
  getEl(elements,'save-large').checked=true;
  await getEl(elements,'save-large').onchange();
  assert.equal(String(gallery().className).includes('is-refreshing'),false,'保存不该让整屏重播动画');
  /* 列表本身变了（筛选出 0 位）：现在由画廊决定谁滑动、谁入场，页面这一层不再插手 */
  const tags=getEl(elements,'tags');
  assert.equal(tags.children.length>0,true,'默认标签按钮应当已经渲染');
  tags.children[0].onclick();
  assert.equal(state.rows.length,0,'筛选后列表确实变了');
  assert.equal(String(gallery().className).includes('is-refreshing'),false,'整屏重播这套已经取消');
});
test('生图抖动等待期间，格子上显示的是「正在生成」而不是「排队中」',async()=>{
  const {elements,state,ctx}=await boot();
  await getEl(elements,'choose-folder').onclick();
  await createArtist(state,elements,'tester');
  const toggle=getEl(elements,'fixed-test');toggle.checked=true;await toggle.onchange();
  const artist=state.rows[0];
  ctx.ArtistImageGen.genGapDelay=()=>5000;   // 拉长抖动，好在等待期间观察
  let release=null;
  ctx.ArtistImageGen.generate=()=>new Promise(resolve=>{release=resolve;});
  const [left,right]=findAllByClass(state.card(artist),'work-generate');
  const arm=node=>{const button=findByClass(node,'generate-button');button.onclick();button.onclick();};
  arm(right);arm(left);                       // 右格先跑，左格排队
  release?.({blob:new Blob([]),prompt:'x',free:true,width:832,height:1216,steps:28,account:null});
  await wait(20);                             // 让第一条跑完，进入抖动等待
  const waiting=findAllByClass(state.card(artist),'work-generate').find(node=>String(node.className).includes('is-generating'));
  assert.ok(waiting,'等待间隔的那一格应当是「正在生成」状态');
  assert.equal(findByClass(waiting,'generate-button'),null,'不该显示可点的生成按钮');
  assert.match(String(findByClass(waiting,'gen-progress')?.textContent),/间隔|正在请求/,'要写清是在等间隔还是已经在请求');
  assert.equal(findAllByClass(state.card(artist),'work-generate').some(node=>String(node.className).includes('is-queued')),false,'这时不该有任何一格还写着「排队中」');
});
test('批量导入：收起对话框不会中断采集，要停得点「停止采集」',async()=>{
  const {elements,state,ctx}=await boot();
  const asked=[];
  stub(ctx,{lookup:async()=>[],details:async name=>{asked.push(name);return {counts:{checkedAt:'x',total:3},works:[post('1')],countsError:false};}});
  getEl(elements,'batch-works').checked=true;
  getEl(elements,'batch-names').value='甲\n乙\n丙';
  const running=getEl(elements,'batch-form').onsubmit({preventDefault(){}});
  /* 采集刚开始就把对话框收起来 */
  getEl(elements,'batch-dialog').fire('close');
  await running;
  assert.equal(asked.length,3,'收起对话框之后采集要继续跑完');
  assert.equal(state.rows.length,3);
  assert.equal(state.rows.every(a=>a.counts&&a.counts.checkedAt),true,'三位都要采到数量');
  assert.match(String(getEl(elements,'batch-message').textContent),/采集 3 位/,'结束时对话框里要有汇总');
  assert.match(String(getEl(elements,'storage-status').textContent),/采集/,'页面底部也要能看到采集结果');
  assert.equal(getEl(elements,'batch-stop').hidden,true,'采集结束就收起停止按钮');
  assert.equal(getEl(elements,'batch-stop-dialog').hidden,true);
});
test('批量导入：点「停止采集」才真的停，已经采集到的保留',async()=>{
  const {elements,state,ctx}=await boot();
  let release=null,gate=new Promise(resolve=>{release=resolve;}),started=0;
  stub(ctx,{lookup:async()=>[],details:async()=>{started++;await gate;return {counts:{checkedAt:'x',total:3},works:[post('1')],countsError:false};}});
  getEl(elements,'batch-works').checked=true;
  getEl(elements,'batch-names').value='甲\n乙\n丙';
  const running=getEl(elements,'batch-form').onsubmit({preventDefault(){}});
  await wait(20);
  assert.equal(started,1,'第一位开始采集');
  assert.equal(getEl(elements,'batch-stop').hidden,false,'采集期间工具栏要出现「停止采集」');
  assert.equal(getEl(elements,'batch-stop-dialog').hidden,false,'对话框里也要有一个');
  assert.equal(getEl(elements,'batch-run').disabled,true,'采集期间不允许再次提交');
  getEl(elements,'batch-stop').onclick();
  assert.match(String(getEl(elements,'storage-status').textContent),/正在停止/);
  release();
  await running;
  assert.equal(started,1,'停在这位之后就不再往下采集');
  assert.equal(state.rows.filter(a=>a.counts&&a.counts.checkedAt).length,1,'已经采集到的要保留');
  assert.equal(getEl(elements,'batch-stop').hidden,true,'停下来后收起按钮');
  assert.equal(getEl(elements,'batch-run').disabled,false,'可以再次提交');
  assert.match(String(getEl(elements,'batch-message').textContent),/已中止/,'要说明是中途停的');
});
test('右键菜单：能定位到唯一的画师就直接建一张新卡，并把结果回传',async()=>{
  const {elements,state,ctx}=await boot();
  await getEl(elements,'choose-folder').onclick();
  const asked=[];
  stub(ctx,{
    lookup:async plan=>{asked.push(plan.query);return [{id:105704,name:'modare',aliases:['旧名'],pageUrl:'https://danbooru.donmai.us/artists/105704'}];},
    posts:async(name,{limit})=>{asked.push(name+' 的前 '+limit+' 张');return [post('1'),post('2'),post('3')];},
    details:async()=>({counts:{checkedAt:'x',total:1234,beforeDate:'2026-07-01',beforeTotal:100},works:[],countsError:false}),
  });
  assert.equal(state.pageListeners.length,1,'页面要挂上扩展消息的监听');
  const replies=[];
  const keep=state.pageListeners[0]({type:'artist-library.create',text:'  modare\n 105704 ',requestId:'r1',sourceTabId:42},null,value=>replies.push(value));
  assert.equal(keep,true,'要异步回复结果');
  await wait(40);
  assert.equal(replies.length,1);
  const result=replies[0];
  assert.equal(result.ok,true,'定位到唯一画师就该建卡成功');
  assert.equal(result.name,'modare');
  assert.equal(result.danbooruId,105704,'要索引到 Danbooru 编号');
  assert.equal(result.works,3,'要带上作品');
  assert.equal(result.requestId,'r1');assert.equal(result.sourceTabId,42,'回传时要带回来源标签页，好把提示画在那里');
  assert.deepEqual(asked,['modare 105704','modare 的前 3 张'],'先按名字查画师、再取作品');
  assert.equal(state.rows.length,1,'画师库里多了一张卡');
  assert.equal(state.rows[0].uid,result.uid);
  assert.equal(state.rows[0].works.length,3,'作品要缓存成缩略图一起写进去');
  assert.equal(state.rows[0].aliases[0],'旧名');
});
test('右键菜单：没选文件夹与已在库里时不建卡；认不出画师时建一张空卡留给用户',async()=>{
  /* 没选文件夹：写不了盘，不建 */
  const noFolder=await boot();
  const first=[];
  noFolder.state.pageListeners[0]({type:'artist-library.create',text:'modare'},null,value=>first.push(value));
  await wait(20);
  assert.equal(first[0].ok,false);assert.match(first[0].reason,/数据文件夹/);
  /* 站点上找不到：照样把选中的文字收进库里，资料留给用户补 */
  const missing=await boot();
  await getEl(missing.elements,'choose-folder').onclick();
  stub(missing.ctx,{lookup:async()=>[],posts:async()=>[],details:async()=>({counts:{}})});
  const second=[];
  missing.state.pageListeners[0]({type:'artist-library.create',text:'no-such-artist'},null,value=>second.push(value));
  await wait(30);
  assert.equal(second[0].ok,true,'认不出也要收下：'+JSON.stringify(second[0]));
  assert.equal(second[0].partial,true,'要标明资料待补');
  assert.equal(second[0].name,'no-such-artist','卡名就用选中的文字');
  assert.equal(second[0].danbooruId,null,'没认出来就不写编号');
  assert.equal(missing.state.rows.length,1,'要真的建出一张卡');
  /* 候选不唯一：不替用户挑一个，但也不让这次右键落空——仍然用选中的文字建卡 */
  const many=await boot();
  await getEl(many.elements,'choose-folder').onclick();
  stub(many.ctx,{lookup:async()=>[{id:1,name:'other',aliases:[],pageUrl:''},{id:2,name:'another',aliases:[],pageUrl:''}],posts:async()=>[],details:async()=>({counts:{}})});
  const third=[];
  many.state.pageListeners[0]({type:'artist-library.create',text:'modare'},null,value=>third.push(value));
  await wait(30);
  assert.equal(third[0].ok,true,'多个候选时也要建卡：'+JSON.stringify(third[0]));
  assert.equal(third[0].partial,true,'不能替用户挑，所以这一张是待补资料的空卡');
  assert.equal(third[0].name,'modare','用的是选中的文字，不是随便挑的候选');
  assert.equal(third[0].danbooruId,null,'不替用户挑，就不写编号');
  assert.equal(many.state.rows.length,1);
  /* 已经在库里：不重复建卡，并把已有那张的 uid 带回去好定位 */
  const exists=await boot();
  await getEl(exists.elements,'choose-folder').onclick();
  stub(exists.ctx,{lookup:async()=>[{id:105704,name:'modare',aliases:[],pageUrl:''}],posts:async()=>[post('9')],details:async()=>({counts:{}})});
  const fourth=[];
  exists.state.pageListeners[0]({type:'artist-library.create',text:'modare'},null,value=>fourth.push(value));
  await wait(30);
  const uid=fourth[0].uid;
  const again=[];
  exists.state.pageListeners[0]({type:'artist-library.create',text:'modare'},null,value=>again.push(value));
  await wait(30);
  assert.equal(again[0].ok,false);assert.match(again[0].reason,/已经在画师库里/);
  assert.equal(again[0].uid,uid,'要把已有那张卡的 uid 带回去');
  assert.equal(exists.state.rows.length,1,'不会多出一张重复卡');
});
test('右键菜单：整段文字没匹配上时，再试第一个像标签的词',async()=>{
  const {elements,state,ctx}=await boot();
  await getEl(elements,'choose-folder').onclick();
  const tried=[];
  stub(ctx,{
    lookup:async plan=>{tried.push(plan.query);return plan.query==='modare'?[{id:105704,name:'modare',aliases:[],pageUrl:''}]:[];},
    posts:async()=>[post('1')],
    details:async()=>({counts:{total:5}}),
  });
  const replies=[];
  state.pageListeners[0]({type:'artist-library.create',text:'modare (@modare_105704)'},null,value=>replies.push(value));
  await wait(30);
  assert.deepEqual(tried,['modare (@modare_105704)','modare'],'整段失败后用第一个词再试一次');
  assert.equal(replies[0].ok,true);
  assert.equal(replies[0].name,'modare');
  assert.equal(state.rows.length,1);
});
test('点漂浮提示回到页面：清掉筛选、滚到新卡片并让它闪一下',async()=>{
  const {elements,state}=await boot();
  await createArtist(state,elements,'tester');
  const uid=state.rows[0].uid;
  state.pageListeners[0]({type:'artist-library.focus',uid,text:'modare'});
  assert.equal(state.mounted.includes(uid),true,'要主动把那一段挂载出来');
  assert.equal(state.scrolled.some(selector=>selector.includes(uid)),true,'要滚到那张卡片');
  assert.match(String(getEl(elements,'storage-status').textContent),/已定位/);
  /* 卡片不在了（比如已被删）时只报一句状态：绝不再把人送回「识别画师」——
     那是强制建卡之前的旧流程，会把同一段文字又变成一次手动识别。 */
  const gone=await boot();
  const goneOpened=[];
  getEl(gone.elements,'quick-dialog').showModal=()=>goneOpened.push('quick');
  gone.state.pageListeners[0]({type:'artist-library.focus',uid:'不存在',text:'modare'});
  assert.equal(getEl(gone.elements,'quick-input').value,'','不该把文字填进识别框');
  assert.deepEqual(goneOpened,[],'卡片不在了也不该弹出识别画师');
  assert.match(String(getEl(gone.elements,'storage-status').textContent),/不在库里/);
  /* 排队/失败那朵漂浮提示没有 uid：点它只该把页面打开，建卡交给 create 待办。
     旧版本这里会落到 addFromSelection，于是「右键 → 点提示打开页面」会自己弹出识别界面——
     页面一边建卡一边把人拽回手动识别。 */
  const blank=await boot();
  const blankOpened=[];
  getEl(blank.elements,'quick-dialog').showModal=()=>blankOpened.push('quick');
  blank.state.pageListeners[0]({type:'artist-library.focus',uid:'',text:'yotte615'});
  assert.equal(getEl(blank.elements,'quick-input').value,'','没有 uid 的定位请求不该填识别框');
  assert.deepEqual(blankOpened,[],'没有 uid 的定位请求不该弹出识别画师');
  assert.equal(blank.state.rows.length,0,'没有 uid 的定位请求不该建卡');
});
test('快捷识别：勾选候选作品后点「添加此画师」，只有勾上的才保存',async()=>{
  const {elements,state,ctx}=await boot();
  stub(ctx,{lookup:async()=>[{id:196870,name:'iuui',aliases:[],pageUrl:'https://danbooru.donmai.us/artists/196870'}],
    details:async()=>({counts:{total:5}}),posts:async()=>[post('11'),post('12')]});
  getEl(elements,'quick-input').value='iuui';
  await getEl(elements,'quick-form').onsubmit({preventDefault(){}});
  await wait(30);
  const row=findByClass(getEl(elements,'quick-results'),'candidate');
  assert.ok(row,'应列出一位候选画师');
  const grid=findByClass(row,'candidate-previews');
  assert.equal(findAllByClass(grid,'pick').length,2,'候选作品都列出来了');
  /* 这一处没有「勾上即加入」：画师本身还不存在，得先攒着勾选，再点「添加此画师」一起落盘。 */
  const label=grid.children[0],box=label.children[0];
  box.checked=true;await box.onchange();
  assert.equal(String(label.className).includes('is-added'),false,'这种用法下不该打「已加入」标记');
  assert.equal(String(findByClass(row,'picker-count').textContent).includes('已选 1 张'),true,'计数说的是「已选」');
  await findText(row,'添加此画师').onclick();
  assert.equal(state.rows.length,1,'画师加进列表');
  assert.equal(state.rows[0].name,'iuui');
  assert.deepEqual([...state.rows[0].works].map(work=>String(work.id)),['11'],'只有勾上的那一张被保存');
  assert.equal(String(getEl(elements,'quick-status').textContent).includes('已添加 iuui'),true,'走完整个成功路径');
});
test('页面是刚被右键菜单打开的那种：等数据文件夹就绪再建卡，然后回传结果',async()=>{
  const app=await fs.readFile('app/app.js','utf8');
  assert.match(app,/bindExtensionMessages\(\);/,'init 里要主动领取一次');
  const {elements,state,ctx}=await boot({actions:[{kind:'create',text:'atdan',requestId:'r9',sourceTabId:7}]});
  await wait(20);
  assert.equal(state.rows.length,0,'文件夹还没接上，先不写');
  assert.equal(state.pageMessages.some(message=>message.type==='created'),false,'也不该急着回一个失败');
  assert.equal(app.includes('等数据文件夹就绪'),true,'要有「等文件夹就绪」这条提示语');
  stub(ctx,{lookup:async()=>[{id:7,name:'atdan',aliases:[],pageUrl:''}],posts:async()=>[post('5')],details:async()=>({counts:{total:9}})});
  await getEl(elements,'choose-folder').onclick();
  await wait(40);
  const reply=state.pageMessages.find(message=>message.type==='created');
  assert.ok(reply,'接上文件夹后要把结果回传后台');
  assert.equal(reply.result.ok,true);
  assert.equal(reply.result.requestId,'r9');
  assert.equal(reply.result.sourceTabId,7,'来源标签页要原样带回去，提示才画得到那个页面上');
  assert.equal(state.rows.length,1);
});
test('生图排队接进了页面：公用一条队列，间隔取 5±3 秒的抖动值',async()=>{
  const html=await fs.readFile('app/index.html','utf8'),app=await fs.readFile('app/app.js','utf8');
  assert.match(html,/<script src="generate-queue\.js" defer><\/script>/,'开发页也要加载队列模块');
  assert.match(app,/ArtistGenerateQueue\.create\(\{gap:\(\)=>ArtistImageGen\.genGapDelay\(\)/,'队列的间隔必须来自那个 5±3 秒的函数');
  assert.match(app,/function enqueueGenerate\(/,'生成走排队入口');
  assert.equal(app.includes('function generateTest('),false,'旧的直发函数要撤掉，免得绕过队列');
  assert.match(app,/if\(volatile\|\|busy\|\|generating\|\|syncingAll\|\|batchRunning\|\|!genQueue\.idle\)/,'还没跑完就关页面要拦一下（排队、刷新全库、采集都算）');
  const {ctx}=await boot();
  assert.equal(typeof ctx.ArtistGenerateQueue.create,'function','队列模块在页面里可用');
});
test('生图参数为独立对话框，入口归入测试风格工具菜单',async()=>{
  const html=await fs.readFile('app/index.html','utf8');
  assert.match(html, /id="test-menu"[\s\S]*?id="gen-settings-open"[\s\S]*?<\/details>/,'生图参数在测试风格工具菜单内');
  assert.match(html,/id="gen-settings" class="small-dialog wide-dialog"/);
  const settingsBlock=html.slice(html.indexOf('id="settings"'),html.indexOf('id="gen-settings"'));
  for(const id of ['gen-token','gen-model','gen-size','gen-steps','gen-negative','gen-prompt1','gen-prompt2','gen-cfg-rescale','gen-transparent','gen-anlas','gen-account'])
    assert.equal(settingsBlock.includes('id="'+id+'"'),false,id+' 不该再留在「设置」里');
  assert.equal(html.slice(html.indexOf('id="gen-settings"')).includes('id="fixed-test"'),false,'固定测试风格图是显示开关，留在「设置」里');
  assert.match(html,/id="fixed-test"/);
});
test('生图参数：顶部按钮打开新对话框并回填，改了就存回本机',async()=>{
  const {elements,ctx}=await boot();
  ctx.localStorage.setItem('artist-library.image-gen',JSON.stringify({steps:31,model:'nai-diffusion-3',width:960,cfgRescale:0.25,transparentBg:true,useAnlas:true}));
  const opened=[];
  getEl(elements,'gen-settings').showModal=()=>opened.push('gen');
  getEl(elements,'gen-settings-open').onclick();
  assert.deepEqual(opened,['gen'],'点顶部按钮要弹出「生图参数」');
  assert.equal(getEl(elements,'gen-steps').value,'31');
  assert.equal(getEl(elements,'gen-model').value,'nai-diffusion-3');
  assert.equal(getEl(elements,'gen-cfg-rescale').value,'0.25');
  assert.equal(getEl(elements,'gen-transparent').checked,true);
  assert.equal(getEl(elements,'gen-anlas').checked,true);
  const rescale=getEl(elements,'gen-cfg-rescale');rescale.value='0.6';rescale.oninput();
  assert.equal(JSON.parse(ctx.localStorage.getItem('artist-library.image-gen')).cfgRescale,0.6);
  const transparent=getEl(elements,'gen-transparent');transparent.checked=false;transparent.onchange();
  assert.equal(JSON.parse(ctx.localStorage.getItem('artist-library.image-gen')).transparentBg,false,'开关也要存回去');
  const anlas=getEl(elements,'gen-anlas');anlas.checked=true;anlas.onchange();
  assert.equal(JSON.parse(ctx.localStorage.getItem('artist-library.image-gen')).useAnlas,true);
  const prompt=getEl(elements,'gen-prompt1');prompt.value='artist:{tag}, 1girl';prompt.oninput();
  assert.equal(JSON.parse(ctx.localStorage.getItem('artist-library.image-gen')).prompt1,'artist:{tag}, 1girl');
  const width=getEl(elements,'gen-width');width.value='99999';width.onchange();
  assert.equal(JSON.parse(ctx.localStorage.getItem('artist-library.image-gen')).width,null,'超出上限的宽高不留在设置里');
  assert.equal(getEl(elements,'gen-height').value,'','没填过的留空，交给档位决定');
  const token=getEl(elements,'gen-token');token.value='pst-abcdefghijklmnop';token.oninput();
  assert.equal(ctx.localStorage.getItem('artist-library.novelai-token'),'pst-abcdefghijklmnop');
  assert.equal(ctx.localStorage.getItem('artist-library.image-gen').includes('pst-'),false,'token 不能和生图参数写在一起');
});
test('顶部的额度按钮：没配 token 时不去打接口，说明去哪儿填',async()=>{
  const {elements}=await boot();
  await wait(10);
  getEl(elements,'opus-status').onclick();
  assert.match(String(getEl(elements,'quota-label').textContent),/NovelAI/);
  assert.match(String(getEl(elements,'gen-account').textContent),/token/,'要把「去填 token」说清楚');
});
test('固定格的【生成】按钮：第一次只是点亮，第二次才真的发；没选文件夹时说明原因',async()=>{
  const {elements,state,ctx}=await boot();
  const toggle=getEl(elements,'fixed-test');toggle.checked=true;await toggle.onchange();
  let asked=0;
  const realGenerate=ctx.ArtistImageGen.generate;
  ctx.ArtistImageGen.generate=async()=>{asked++;throw Error('不该走到这里');};
  const box=findByClass(state.card(bareArtist({works:thumbWorks(1)})),'work-generate');
  const button=findByClass(box,'generate-button'),label=findByClass(box,'generate-seq'),seqText=label.textContent;
  assert.match(seqText,/^测试风格 \d$/);
  assert.equal(button.textContent,'生成');
  button.onclick();
  assert.equal(button.textContent,'再点一次开始','第一次点击只进入确认态，不弹窗');
  assert.equal(String(box.className).includes('is-armed'),true,'格子上要有醒目的确认样式');
  assert.equal(label.textContent,'会消耗额度或点数','确认态要把代价写出来');
  assert.equal(asked,0,'确认前不能发请求');
  await button.onclick();
  assert.equal(asked,0,'没有数据文件夹时不该真的去生成');
  assert.match(String(getEl(elements,'storage-status').textContent),/数据.*文件夹/);
  assert.equal(button.textContent,'生成','拒绝之后按钮要复位');
  assert.equal(label.textContent,seqText,'序号文字也要复原');
  ctx.ArtistImageGen.generate=realGenerate;
});
test('生成中的过渡动画有旋转环与进度文字，样式表里也有动画定义',async()=>{
  const css=await fs.readFile('app/style.css','utf8');
  assert.match(css,/\.gen-spinner\{[^}]*animation:gen-spin/);
  assert.match(css,/@keyframes gen-spin\{/);
  assert.match(css,/\.gen-progress\{/);
  assert.match(css,/prefers-reduced-motion/,'动画要照顾系统里的「减少动态效果」设置');
  const app=await fs.readFile('app/app.js','utf8');
  assert.match(app,/generatingMark\(/);
  assert.match(app,/gen-spinner/);
  assert.match(app,/gen-progress/);
});
test('质量标签开关跟着生图参数走，界面默认是开的',async()=>{
  const html=await fs.readFile('app/index.html','utf8');
  assert.match(html,/id="gen-quality"[^>]*type="checkbox"/);
  const {elements,ctx}=await boot();
  getEl(elements,'gen-settings-open').onclick();
  assert.equal(getEl(elements,'gen-quality').checked,true,'默认开启，跟站点一致');
  const box=getEl(elements,'gen-quality');box.checked=false;box.onchange();
  assert.equal(JSON.parse(ctx.localStorage.getItem('artist-library.image-gen')).qualityTags,false,'关掉要存回本机');
  getEl(elements,'gen-settings-open').onclick();
  assert.equal(getEl(elements,'gen-quality').checked,false,'再打开对话框要还是关着');
});
test('三个提示词输入框用同一套尺寸规则：同一行结构、同一档宽度',async()=>{
  const html=await fs.readFile('app/index.html','utf8'),css=await fs.readFile('app/style.css','utf8');
  for(const id of ['gen-negative','gen-prompt1','gen-prompt2'])
    assert.match(html,new RegExp('class="setting-row textarea-row"[^>]*>[\\s\\S]{0,400}?id="'+id+'"'),id+' 要和其他两个一样挂在 textarea-row 上');
  assert.equal((html.match(/setting-row textarea-row/g)||[]).length,3,'只该有这三个长文本框');
  assert.match(css,/\.textarea-row>div:first-child\{flex:0 0 [0-9]+px\}/,'长文本框说明使用统一列宽');
  assert.match(css,/\.setting-row textarea\{[^}]*flex:1/,'输入框使用剩余宽度');
  assert.match(css,/@media\(max-width:760px\)[\s\S]*?\.textarea-row\{flex-direction:column/,'窄窗口中说明和输入框改为上下排列');
});
test('生图参数的下拉框来自 NovelAI 模块，模板与尺寸不会写死两遍',async()=>{
  const {elements,ctx}=await boot();
  const values=id=>getEl(elements,id).children.map(o=>o.value).join(',');
  assert.equal(values('gen-model'),ctx.ArtistNovelAI.MODELS.map(m=>m.value).join(','));
  assert.equal(values('gen-size'),ctx.ArtistNovelAI.SIZES.map(s=>s.value).join(','));
  assert.equal(values('gen-sampler'),ctx.ArtistNovelAI.SAMPLERS.map(s=>s.value).join(','));
  assert.equal(values('gen-uc'),ctx.ArtistNovelAI.UC_PRESETS.map(p=>p.value).join(','));
  getEl(elements,'gen-settings-open').onclick();
  assert.equal(getEl(elements,'gen-model').value,'nai-diffusion-5-full','默认 V5 Full');
  assert.equal(getEl(elements,'gen-size').value,'832x1216','默认竖图');
  assert.match(getEl(elements,'gen-prompt1').value,/\{tag\}/,'两个模板都要带 {tag} 变量');
  assert.match(getEl(elements,'gen-prompt2').value,/\{tag\}/);
});
test('画师卡片：选用的笔名与名字放在同一身份信息区，没选用就不显示',async()=>{
  const {state}=await boot();
  const texts=node=>{const out=[];const walk=n=>{if(n._text)out.push(n._text);for(const child of n.children||[])walk(child);};walk(node);return out;};
  const plain=state.card(bareArtist({aliases:['甲','乙']}));
  assert.equal(findAllByClass(plain,'alias').length,0,'没选用笔名时不显示');
  assert.equal(texts(plain).includes('甲'),false,'未选用的笔名不出现在卡片上');
  const shown=state.card(bareArtist({aliases:['甲','乙'],alias:'乙'})),marks=findAllByClass(shown,'alias');
  assert.equal(marks.length,1,'选用后显示一条');
  assert.equal(marks[0].textContent,'乙','只写笔名本身，不加前缀');
  const info=shown.children[0];
  assert.equal(findByClass(info,'artist-name').textContent,'tester','画师名字仍可复制');
  assert.ok(findByClass(findByClass(info,'name-row'),'alias'),'笔名与画师名字一起显示');
});
test('编辑有笔名的画师：单选一个，保存写进资料并显示在卡片上',async()=>{
  const {elements,state,ctx}=await boot();
  stub(ctx,{lookup:async()=>[{id:7,name:'tester',aliases:['甲','乙','丙'],pageUrl:''}],details:async()=>({counts:{checkedAt:'x',total:1},works:[],countsError:false})});
  const get=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id);};
  get('batch-artists').onclick();get('batch-names').value='tester';get('batch-works').checked=true;
  await get('batch-form').onsubmit({preventDefault(){}});
  assert.equal(state.rows[0].aliases.length,3,'导入时读到的笔名要存进资料');
  findText(lastRender(state)[0],'编辑').onclick();
  await wait(180);
  const picker=findByClass(lastRender(state)[0],'alias-picker');
  let picks=findAllByClass(picker,'alias-choice');
  assert.equal(picks.length,3,'三个笔名都列出来');
  assert.equal(picks.every(pick=>pick['aria-pressed']==='false'),true,'默认没有选用');
  picks[1].onclick();
  picks=findAllByClass(picker,'alias-choice');
  assert.equal(picks[1]['aria-pressed'],'true');
  assert.equal(String(findAllByClass(picker,'alias-chip')[1].className).includes('active'),true,'选用的那一个要高亮');
  picks[0].onclick();
  picks=findAllByClass(picker,'alias-choice');
  assert.equal(picks[0]['aria-pressed'],'true','可以改选另一个');
  assert.equal(picks[1]['aria-pressed'],'false','只能选一个，上一个自动取消');
  picks[0].onclick();
  assert.equal(findAllByClass(picker,'alias-choice')[0]['aria-pressed'],'false','再点同一个取消选用');
  findAllByClass(picker,'alias-choice')[2].onclick();
  await findText(lastRender(state)[0],'保存').onclick();
  assert.equal(state.rows[0].alias,'丙','选用的笔名要写进资料');
  assert.equal(findAllByClass(state.card(state.rows[0]),'alias')[0].textContent,'丙','卡片上要显示出来，且不带前缀');
});
test('编辑卡片：可以自己添加笔名，也能移除',async()=>{
  const {elements,state}=await boot();
  elements.get('add-artist').onclick();
  const editor=findByClass(lastRender(state)[0],'alias-editor');
  assert.ok(editor,'编辑卡片里应有笔名区');
  assert.ok(findByClass(editor,'tag-choices-empty'),'没有笔名时给出说明');
  const [input,addButton]=findByClass(editor,'alias-row').children;
  assert.equal(input.placeholder,'输入自定义笔名后回车');
  input.value='  自定义笔名  ';input.onkeydown({key:'Enter',preventDefault(){}});
  let chips=findAllByClass(editor,'alias-chip');
  assert.equal(chips.length,1,'回车即可加入');
  assert.equal(chips[0].children[0].textContent,'自定义笔名','首尾空格要去掉');
  assert.equal(String(chips[0].className).includes('active'),true,'新加的直接选用');
  assert.equal(input.value,'','加入后清空输入框');
  input.value='自定义笔名';input.onkeydown({key:'Enter',preventDefault(){}});
  assert.equal(findAllByClass(editor,'alias-chip').length,1,'重复笔名不重复加入');
  input.value='第二个';addButton.onclick();
  chips=findAllByClass(editor,'alias-chip');
  assert.equal(chips.length,2,'「添加」按钮与回车等效');
  chips[1].children[1].onclick();
  chips=findAllByClass(editor,'alias-chip');
  assert.equal(chips.length,1,'点 × 移除该笔名');
  assert.equal(chips[0].children[1]['aria-label'],'移除笔名 自定义笔名');
  assert.equal(chips[0].children[0]['aria-pressed'],'false','移除正在选用的那个后要同时取消选用');
});
test('编辑卡片：自定义笔名不会被保存时读到的列表覆盖',async()=>{
  const {elements,state,ctx}=await boot();
  stub(ctx,{lookup:async()=>[{id:7,name:'tester',aliases:['甲','乙'],pageUrl:''}],details:async()=>({counts:{checkedAt:'x',total:1},works:[],countsError:false})});
  const get=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id);};
  get('batch-artists').onclick();get('batch-names').value='tester';get('batch-works').checked=true;
  await get('batch-form').onsubmit({preventDefault(){}});
  assert.equal(state.rows[0].aliases.length,2,'导入时读到 Danbooru 的笔名');
  findText(lastRender(state)[0],'编辑').onclick();
  await wait(180);
  const editor=findByClass(lastRender(state)[0],'alias-editor'),[input]=findByClass(editor,'alias-row').children;
  input.value='我的叫法';input.onkeydown({key:'Enter',preventDefault(){}});
  await findText(lastRender(state)[0],'保存').onclick();
  const aliases=[...state.rows[0].aliases];
  assert.equal(aliases.length,3,'自己加的笔名要保留');
  assert.equal(aliases.includes('我的叫法'),true);
  assert.equal(aliases.includes('甲')&&aliases.includes('乙'),true,'导入时读到的也还在');
});
test('编辑卡片：还没读到笔名时给出说明，不留空白',async()=>{
  const {elements,state}=await boot();
  elements.get('add-artist').onclick();
  const picker=findByClass(lastRender(state)[0],'alias-picker');
  assert.ok(picker,'编辑卡片里应有笔名区');
  assert.equal(findAllByClass(picker,'alias-choice').length,0);
  assert.ok(findByClass(picker,'tag-choices-empty'),'没有笔名时要说明什么时候会有');
});
test('画师卡片：参考评分独立为卡片角标，1-5 分均有明确标签',async()=>{
  const {state}=await boot();
  const plain=state.card(bareArtist());
  assert.equal(findAllByClass(plain,'score-badge').length,0,'未评分不显示角标');
  assert.equal(plain.children.length,3,'卡片由信息区、作品区与补充资料区组成');
  for(const score of [1,2,3,4,5]){
    const card=state.card(bareArtist({score})),badges=findAllByClass(card,'score-badge');
    assert.equal(badges.length,1,'分数 '+score+' 应有且只有一个角标');
    assert.equal(String(badges[0].className).includes('score-'+score),true,'分数 '+score+' 要用对应的底板');
    assert.equal(badges[0].textContent,String(score),'徽章只展示分数');
    assert.equal(badges[0]['aria-label'],'参考评分 '+score+' 分','读屏仍能获知分数含义');
    assert.equal(card.children.length,4,'评分徽章独立于信息、作品和补充资料区');
    assert.equal(card.children[0],badges[0],'徽章直接属于卡片，定位不受名称行影响');
    assert.equal(findByClass(findByClass(card,'name-row'),'score-badge'),null,'评分不占名称行空间');
  }
});
test('画师卡片：越界或非法分数不会渲染出没有底板的角标',async()=>{
  const {state}=await boot();
  for(const bad of [0,6,9,-1,null,undefined,'3',3.5,NaN])assert.equal(findAllByClass(state.card(bareArtist({score:bad})),'score-badge').length,0,'score='+String(bad)+' 不应渲染角标');
});
test('编辑卡片：1-5 分按钮，点一下选中，再点同一个取消打分',async()=>{
  const {elements,state}=await boot();
  elements.get('add-artist').onclick();
  const card=lastRender(state)[0],picker=findByClass(card,'score-picker');
  assert.ok(picker,'编辑卡片里应有分数选择器');
  let picks=findAllByClass(picker,'score-pick');
  assert.equal(picks.length,5,'一共 1 到 5 分');
  assert.equal(picks.map(pick=>pick.textContent).join(''),'12345');
  assert.equal(picks.every(pick=>pick['aria-pressed']==='false'),true,'默认未评分');
  picks[4].onclick();
  picks=findAllByClass(picker,'score-pick');
  assert.equal(picks[4]['aria-pressed'],'true','点了 5 分');
  assert.equal(String(picks[4].className).includes('active'),true);
  assert.equal(String(picks[4].className).includes('score-5'),true,'按钮用对应底板做预览');
  assert.equal(picks.every((pick,i)=>i===4||pick['aria-pressed']==='false'),true,'其他分数不受影响');
  picks[4].onclick();
  assert.equal(findAllByClass(picker,'score-pick')[4]['aria-pressed'],'false','再点同一个取消打分');
});
test('编辑卡片：打的分随保存写进画师资料',async()=>{
  const {elements,state}=await boot();
  elements.get('add-artist').onclick();
  const card=lastRender(state)[0],nameInput=findByPlaceholder(card,'画师名字（必填）');
  nameInput.value='打分的画师';nameInput.oninput();
  findAllByClass(findByClass(card,'score-picker'),'score-pick')[2].onclick();
  await findText(lastRender(state)[0],'保存').onclick();
  assert.equal(state.rows[0].score,3,'选中的 3 分要写进资料');
  assert.equal(findAllByClass(state.card(state.rows[0]),'score-badge').length,1,'保存后卡片上出现角标');
});
test('改名会把数量清空，交给「刷新所有画师作品数量」补齐',async()=>{
  const {elements,state,ctx}=await boot();
  const get=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id);};
  stub(ctx,{lookup:async()=>[],details:async()=>({counts:{checkedAt:'x',total:9,beforeTotal:1},countsError:false})});
  await createArtist(state,elements,'原名');
  await get('sync-all').onclick();
  assert.equal(state.rows[0].counts.total,9,'先刷出数量');
  findText(lastRender(state)[0],'编辑').onclick();
  await wait(180);
  const nameInput=findByPlaceholder(lastRender(state)[0],'画师名字（必填）');
  nameInput.value='改过的名字';nameInput.oninput();
  await findText(lastRender(state)[0],'保存').onclick();
  assert.equal(state.rows[0].counts,null,'换了名字，旧数量不再可信，要清空');
  assert.equal(state.rows[0].name,'改过的名字');
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
  assert.match(html,/id="batch-works"[^>]*type="checkbox" checked/,'采集最新 3 张作品应是默认行为');
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
test('批量采集：每位画师采完就刷新对应卡片，不用等整批结束',async()=>{
  const {elements,state,ctx}=await boot();
  const asked=[];
  stub(ctx,{lookup:async()=>[],posts:async()=>[],
    details:async name=>{asked.push(name);return {counts:name==='甲'?{total:11,beforeTotal:5}:{total:22,beforeTotal:7},works:[post(name==='甲'?'1':'2')]};}});
  await runBatch(elements,'甲\n乙',true);
  assert.deepEqual(asked,['甲','乙'],'一位一位按名单顺序采');
  const cardOf=(render,name)=>render.find(card=>card.dataset.artist===name);
  const showsCount=(render,name,text)=>{const card=cardOf(render,name);return !!card&&String(findByClass(card,'artist-site-count').textContent)===text;};
  const at=state.renders.findIndex(render=>showsCount(render,'甲','站点作品 11'));
  assert.ok(at>0,'甲采完就该有一次渲染把他的数量与缩略图补上');
  assert.ok(at<state.renders.length-1,'这次渲染要发生在整批结束之前，而不是最后统一刷新');
  assert.equal(showsCount(state.renders[at],'乙','站点作品 22'),false,'那一刻乙还没采到');
  assert.equal(showsCount(state.renders[state.renders.length-1],'乙','站点作品 22'),true,'乙采完同样补上');
});
test('批量采集：采完自动清空筛选，并把分类切到「待判断」',async()=>{
  const {elements,state,ctx}=await boot();
  stub(ctx,{lookup:async()=>[],details:async()=>({counts:{total:3},works:[post('1')]})});
  /* 先制造会挡住新画师的筛选：勾一个标签、搜索框里留字 */
  await createArtist(state,elements,'旧的');
  getEl(elements,'tags').children[0].onclick();
  getEl(elements,'search').value='zzz';getEl(elements,'search').oninput({target:getEl(elements,'search')});
  assert.equal(state.rows.length,0,'筛选把所有人都挡在外面');
  await runBatch(elements,'新来的',true);
  assert.equal(state.rows.length,2,'采集完应该看得到刚采回来的画师（连同原本那位待判断的）');
  assert.equal(state.rows.some(artist=>artist.name==='新来的'),true);
  const active=findAllByClass(getEl(elements,'categories'),'active');
  assert.equal(active.length,1,'只有一个分类处于选中态');
  assert.equal(String(active[0].textContent),'待判断','分类自动切到「待判断」');
  assert.equal(String(active[0].children[0].textContent),'2','计数跟着显示 2 位待判断');
  assert.equal(getEl(elements,'search').value,'','搜索框被清空');
  assert.equal(findAllByClass(getEl(elements,'tags'),'active').length,0,'标签筛选被清空');
});
test('设置里可以打开「编辑画师时自动展开 danbooru 作品」，默认关闭',async()=>{
  const {elements,state,ctx}=await boot();
  stub(ctx,{lookup:async()=>[],details:async()=>({counts:{}}),posts:async()=>[post('11')]});
  const toggle=getEl(elements,'auto-open-works');
  assert.equal(toggle.checked,false,'默认关闭');
  await createArtist(state,elements,'tester');
  const edit=()=>findText(lastRender(state)[0],'编辑')||findText(lastRender(state)[0],'取消');
  edit().onclick();
  await wait(200);
  assert.equal(findByClass(lastRender(state)[0],'candidate-previews'),null,'没开开关就不该自动读作品');
  findText(lastRender(state)[0],'取消').onclick();
  await wait(200);
  toggle.checked=true;await toggle.onchange();
  assert.equal(state.rows[0].name,'tester','改开关不该动数据');
  findText(lastRender(state)[0],'编辑').onclick();
  await wait(200);
  assert.ok(findByClass(lastRender(state)[0],'candidate-previews'),'开了开关，进编辑态就把候选列出来');
  assert.equal(findText(lastRender(state)[0],'收起')!==null,true,'按钮同时变成「收起」');
});
test('批量生成测试风格图：按钮在「导入测试风格图」右边，对话框有范围与序号',async()=>{
  const html=await fs.readFile('app/index.html','utf8');
  assert.match(html,/id="test-import-open"[^>]*>导入测试风格图<\/button><button id="gen-batch-open"[^>]*>批量生成测试风格图<\/button>/,'按钮紧挨着「导入测试风格图」，在它右边');
  for(const id of ['gen-batch','gen-batch-from','gen-batch-to','gen-batch-seqs','gen-batch-skip','gen-batch-preview','gen-batch-run'])assert.match(html,new RegExp('id="'+id+'"'),'对话框要有 '+id);
  assert.match(html,/id="gen-batch-skip"[^>]*checked/,'「跳过已经有的」默认开着');
});
test('批量生成测试风格图：序号段 × 测试风格序号＝排入的条数',async()=>{
  const {elements,state,ctx}=await boot();
  /* 第一条会立刻开跑；让它停在那里，pending 才数得准。 */
  ctx.ArtistImageGen.generate=()=>new Promise(()=>{});
  ctx.ArtistImageGen.cachedAccount=()=>({opusPercent:60,opusImages:1038,anlas:0,tier:3});
  await getEl(elements,'choose-folder').onclick();
  await runBatch(elements,'甲\n乙\n丙',false);
  assert.equal(state.rows.length,3);
  getEl(elements,'gen-batch-open').onclick();
  const from=getEl(elements,'gen-batch-from'),to=getEl(elements,'gen-batch-to'),seqs=getEl(elements,'gen-batch-seqs'),preview=getEl(elements,'gen-batch-preview');
  assert.equal(from.value,'1','默认填当前看到的这一段（这里是全部）');
  assert.equal(to.value,'3');
  seqs.value='1,2';seqs.oninput();
  assert.match(String(preview.textContent),/将排入 6 条/,'3 位画师 × 2 个序号');
  assert.match(String(preview.textContent),/额度上限参考：当前 Opus 免费额度只剩约 1038 张/);
  const button=getEl(elements,'gen-batch-run');
  button.textContent='排入生成队列';   /* 假 DOM 不解析 index.html 里的初始文案，这里补上 */
  await button.onclick();
  assert.equal(button.textContent,'排入生成队列','额度够就不必二次确认（预览：'+String(preview.textContent)+'）');
  assert.equal(getEl(elements,'gen-queue').hidden,false,'顶部出现排队徽标');
  assert.match(String(getEl(elements,'gen-queue').textContent),/排队 5 · 清空/,'排入 6 条，第一条已经开跑');
  assert.match(String(getEl(elements,'storage-status').textContent),/已排入 6 条生成需求/);
  /* 「1-2」这种写法与「1,2」等价 */
  seqs.value='1-2';seqs.oninput();
  assert.match(String(preview.textContent),/将排入 6 条/);
  /* 空白的风格序号要给出提示，而不是静默排出 0 条 */
  seqs.value='';seqs.oninput();
  assert.match(String(preview.textContent),/要写成像 1、1,2 或 1-2/);
});
test('批量生成测试风格图：超过当前额度时先变红，第二次点才真的排',async()=>{
  const {elements,state,ctx}=await boot();
  ctx.ArtistImageGen.generate=()=>new Promise(()=>{});
  ctx.ArtistImageGen.cachedAccount=()=>({opusPercent:0.5,opusImages:9,anlas:0,tier:3});
  await getEl(elements,'choose-folder').onclick();
  await runBatch(elements,'甲\n乙\n丙\n丁',false);
  assert.equal(state.rows.length,4);
  getEl(elements,'gen-batch-open').onclick();
  const seqs=getEl(elements,'gen-batch-seqs'),button=getEl(elements,'gen-batch-run'),preview=getEl(elements,'gen-batch-preview');
  seqs.value='1-3';seqs.oninput();
  assert.match(String(preview.textContent),/将排入 12 条/);
  await button.onclick();
  assert.equal(button.textContent,'确认排入 12 条？','超额度要先确认');
  assert.equal(String(button.className).includes('is-armed'),true,'按钮变红');
  assert.match(String(preview.textContent),/Opus 免费额度只剩约 9 张/,'说明为什么拦下来');
  assert.equal(getEl(elements,'gen-queue').hidden,true,'第一次点击不该排入任何东西');
  /* 改了输入就要撤销确认状态：确认针对的是刚才那份计算 */
  seqs.value='1-2';seqs.oninput();
  assert.equal(button.textContent,'排入生成队列','改输入后撤销确认');
  assert.equal(String(button.className).includes('is-armed'),false);
  seqs.value='1-3';seqs.oninput();
  await button.onclick();
  assert.equal(button.textContent,'确认排入 12 条？');
  await button.onclick();
  assert.match(String(getEl(elements,'gen-queue').textContent),/排队 11 · 清空/,'第二次点才真的排');
  assert.equal(String(button.className).includes('is-armed'),false,'排完恢复原样');
});
test('批量生成测试风格图：读不到额度也要先确认一次',async()=>{
  const {elements,state,ctx}=await boot();
  ctx.ArtistImageGen.generate=()=>new Promise(()=>{});
  await getEl(elements,'choose-folder').onclick();
  await runBatch(elements,'甲\n乙',false);
  assert.equal(state.rows.length,2);
  getEl(elements,'gen-batch-open').onclick();
  getEl(elements,'gen-batch-seqs').value='1';
  getEl(elements,'gen-batch-seqs').oninput();
  const button=getEl(elements,'gen-batch-run');
  await button.onclick();
  assert.equal(button.textContent,'确认排入 2 条？','额度未知就不能默认放行');
  assert.match(String(getEl(elements,'gen-batch-preview').textContent),/读不到剩余额度/);
  assert.equal(getEl(elements,'gen-queue').hidden,true,'第一次点击不该排入任何东西');
  await button.onclick();
  assert.match(String(getEl(elements,'gen-queue').textContent),/排队 1 · 清空/,'确认后照常排入（第一条已经开跑）');
});
test('批量生成测试风格图：默认跳过已经有这个序号的画师，也能关掉',async()=>{
  const {elements,state,ctx}=await boot();
  ctx.ArtistImageGen.generate=()=>new Promise(()=>{});
  ctx.ArtistImageGen.cachedAccount=()=>({opusPercent:60,opusImages:1038,anlas:0});
  await getEl(elements,'choose-folder').onclick();
  await runBatch(elements,'甲\n乙',false);
  state.rows[0].works.push({id:'',kind:'test',testSeq:1,thumb:null});
  getEl(elements,'gen-batch-open').onclick();
  getEl(elements,'gen-batch-seqs').value='1';
  getEl(elements,'gen-batch-seqs').oninput();
  const preview=getEl(elements,'gen-batch-preview'),skip=getEl(elements,'gen-batch-skip');
  skip.checked=true;skip.onchange();
  assert.match(String(preview.textContent),/将排入 1 条/,'甲已经有测试风格 1，只剩乙要排');
  assert.match(String(preview.textContent),/跳过 1 条已经有这个序号的/);
  skip.checked=false;skip.onchange();
  assert.match(String(preview.textContent),/将排入 2 条/,'关掉跳过就两位都排');
  assert.equal(/跳过 1 条/.test(String(preview.textContent)),false);
});
test('批量生成测试风格图：默认序号段跟着当前筛选走',async()=>{
  const {elements,state}=await boot();
  await getEl(elements,'choose-folder').onclick();
  await runBatch(elements,'甲\n乙\n丙',false);
  const search=getEl(elements,'search');
  search.value='丙';search.oninput({target:search});
  await wait(200);
  assert.equal(state.rows.length,1,'搜索把列表收到一位');
  getEl(elements,'gen-batch-open').onclick();
  assert.equal(getEl(elements,'gen-batch-from').value,'3','默认从当前看到的这一位开始');
  assert.equal(getEl(elements,'gen-batch-to').value,'3');
  getEl(elements,'gen-batch-seqs').value='1';
  getEl(elements,'gen-batch-seqs').oninput();
  assert.match(String(getEl(elements,'gen-batch-preview').textContent),/将排入 1 条/);
});
test('工具栏按钮与对话框标题都叫「批量采集画师」',async()=>{
  const html=await fs.readFile('app/index.html','utf8');
  assert.match(html,/id="batch-artists"[^>]*>批量采集画师</);
  assert.match(html,/id="batch-title">批量采集画师</);
  assert.equal(html.includes('批量导入名字'),false,'旧名字不该再出现');
  assert.equal(html.includes('批量导入画师名字'),false);
  assert.match(html,/id="auto-open-works"/,'设置里要有这个开关');
  assert.equal(html.slice(html.indexOf('id="gen-settings"')).includes('id="auto-open-works"'),false,'它是编辑行为开关，留在「设置」里');
});
test('切换「采集作品的排序」之后，视线回到画师作品上',async()=>{
  const {elements,state,ctx}=await boot();
  stub(ctx,{lookup:async()=>[],details:async()=>({counts:{}}),posts:async()=>[post('11')]});
  elements.get('add-artist').onclick();
  const card=()=>lastRender(state)[0];
  const input=findByPlaceholder(card(),'画师名字（必填）');
  input.value='tester';input.oninput();
  findText(card(),'展开读取').onclick();
  await wait(30);
  const orderSelect=findByClass(card(),'picker-order').children[1];
  assert.ok(orderSelect,'候选区要有排序选择器');
  state.scrolled.length=0;state.scrollCalls.length=0;
  orderSelect.value='score';
  await orderSelect.onchange();
  assert.equal(findByClass(card(),'candidate-previews').focused,true,'换排序后聚焦新候选页');
  const call=state.scrollCalls.find(item=>item.selector.includes('.works'));
  assert.ok(call,'视线回到画师作品格，而不是把候选区顶到最上面');
  assert.equal(call.options.block,'nearest','作品格还在眼前就不动它');
});
test('卡片指纹：数据一样就一样，数据变了就不一样（画廊据此决定要不要重画）',async()=>{
  const {elements,state}=await boot();
  await createArtist(state,elements,'tester');
  const artist=state.rows[0];
  assert.equal(typeof state.keyOf,'function','render 必须把「卡片指纹」交给画廊，否则画廊只能每次都重画');
  assert.equal(state.keyOf(artist),state.keyOf(artist),'同一份数据两次算出来必须一致');
  assert.equal(state.keyOf({...artist}),state.keyOf(artist),'内容相同的副本也要算出同一个指纹，否则每次渲染都会整屏闪');
  assert.notEqual(state.keyOf({...artist,works:artist.works.concat([post('99')])}),state.keyOf(artist),'作品变了要重画');
  assert.notEqual(state.keyOf({...artist,name:artist.name+'2'}),state.keyOf(artist),'名字变了要重画');
});
test('候选作品勾上就直接进作品列表，不用再点按钮，候选列表也不会被冲掉',async()=>{
  const {elements,state,ctx}=await boot();
  stub(ctx,{lookup:async()=>[],details:async()=>({counts:{}}),posts:async()=>[post('11'),post('12')]});
  elements.get('add-artist').onclick();
  const card=()=>lastRender(state)[0];
  const input=findByPlaceholder(card(),'画师名字（必填）');
  input.value='tester';input.oninput();
  findText(card(),'展开读取').onclick();
  await wait(30);
  assert.equal(findText(card(),'添加所选到作品列表'),null,'那个按钮已经删掉');
  assert.equal(findText(card(),'＋ 上传本地图片'),null,'上传按钮也删掉');
  const grid=findByClass(card(),'candidate-previews');
  assert.equal(findAllByClass(grid,'pick').length,2,'两位候选都列出来了');
  const label=grid.children[0],box=label.children[0];
  box.checked=true;await box.onchange();
  assert.equal(String(label.className).includes('is-added'),true,'勾上就算加入');
  assert.equal(findAllByClass(card(),'work').length,1,'作品格里立刻补上这一张，不再需要别的按钮');
  assert.equal(String(findByClass(card(),'work-count').textContent),'本库图片 1 · 站点作品 未读取','顶部的数量也要跟着变：括号外是本库张数，括号里是作者作品数');
  assert.ok(findByClass(card(),'candidate-previews'),'候选列表不能被冲掉，否则连勾第二张都做不到');
  box.checked=false;await box.onchange();
  assert.equal(findAllByClass(card(),'work').length,0,'取消勾选就把它移出');
  assert.equal(String(findByClass(card(),'work-count').textContent),'本库图片 0 · 站点作品 未读取');
  box.checked=true;await box.onchange();
  await findText(card(),'保存').onclick();
  assert.equal(state.rows[0].works.length,1,'保存后作品真的落在画师身上');
  assert.equal(String(state.rows[0].works[0].id),'11','落下的正是勾选的那一张');
});
test('「收起」就在「展开读取」旁边：同一个按钮换名字，列表下面不再重复一个',async()=>{
  const {elements,state,ctx}=await boot();
  stub(ctx,{lookup:async()=>[],details:async()=>({counts:{}}),posts:async()=>[post('11')]});
  elements.get('add-artist').onclick();
  const card=()=>lastRender(state)[0];
  const input=findByPlaceholder(card(),'画师名字（必填）');
  input.value='tester';input.oninput();
  const toggle=()=>findText(card(),'展开读取')||findText(card(),'收起');
  assert.equal(toggle().textContent,'展开读取','没展开时叫「展开读取」');
  const before=card();
  toggle().onclick();
  await wait(30);
  assert.equal(card()===before,true,'展开不该重画卡片');
  assert.equal(toggle().textContent,'收起','展开后同一个按钮改叫「收起」');
  const hosts=()=>findAllByClass(card(),'work-picker');
  assert.equal(hosts().length,1,'候选列表挂在一个容器里');
  assert.equal(findAllByClass(hosts()[0],'picker-actions').length,0,'列表下面不再有那一行按钮');
  toggle().onclick();
  await wait(30);
  assert.equal(hosts().length,0,'收起后容器整个移除');
  assert.equal(toggle().textContent,'展开读取','名字改回来');
});


const tick=()=>new Promise(resolve=>setImmediate(resolve));
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function connectedApp(){
 const app=await boot(),dir=new FakeDir('回归测试');app.ctx.window.showDirectoryPicker=async()=>dir;
 await app.elements.get('choose-folder').onclick();return {...app,dir};
}
test('回归：自动展开设置在真实保存、重开设置和重新读盘后仍为开启',async()=>{
 const {elements,ctx,dir}=await connectedApp();
 const toggle=elements.get('auto-open-works');toggle.checked=true;await toggle.onchange();
 elements.get('settings-open').onclick();assert.equal(toggle.checked,true);
 assert.equal((await ctx.FolderStore.read(dir)).autoOpenWorks,true);
 await elements.get('choose-folder').onclick();elements.get('settings-open').onclick();assert.equal(toggle.checked,true);
});
test('回归：全库刷新期间保存设置与新增画师，刷新完成不覆盖',async()=>{
 const {elements,state,ctx,dir}=await connectedApp();await createArtist(state,elements,'a');
 const started=gate(),response=gate();stub(ctx,{lookup:async()=>[],details:async()=>{started.resolve();await response.promise;return {counts:{total:7,checkedAt:'now'}};}});
 const refreshing=elements.get('sync-all').onclick();await started.promise;
 elements.get('save-large').checked=true;await elements.get('save-large').onchange();
 await runBatch(elements,'b',false);response.resolve();await refreshing;
 const saved=await ctx.FolderStore.read(dir);
 assert.equal(saved.saveLargeImages,true);assert.deepEqual([...saved.artists].map(a=>a.name),['a','b']);assert.equal(saved.artists[0].counts.total,7);
});
test('回归：批采停止后重提名单只续采未完成者',async()=>{
 const {elements,ctx,dir}=await connectedApp(),started=gate(),response=gate(),asked=[];
 stub(ctx,{lookup:async()=>[],details:async name=>{asked.push(name);if(asked.length===1){started.resolve();await response.promise;}return {counts:{total:1,checkedAt:'now'},works:[]};}});
 const batch=runBatch(elements,'a\nb\nc');await started.promise;elements.get('batch-stop').onclick();response.resolve();await batch;
 await runBatch(elements,'a\nb\nc');assert.deepEqual(asked,['a','b','c']);
 assert.equal((await ctx.FolderStore.read(dir)).artists.every(a=>a.counts.checkedAt==='now'),true);
});
test('回归：采集正式名变化后仍为该画师排入生成',async()=>{
 const {elements,ctx}=await connectedApp(),asked=[];
 stub(ctx,{lookup:async()=>[{id:7,name:'new_name',aliases:['old_name']}],details:async()=>({counts:{total:1,checkedAt:'now'},works:[]})});
 ctx.ArtistImageGen.generate=async artist=>{asked.push(artist.name);throw Error('测试不联网');};ctx.ArtistImageGen.genGapDelay=()=>0;
 getEl(elements,'batch-generate').checked=true;await runBatch(elements,'old_name');await tick();
 assert.deepEqual(asked,['new_name']);
});


test('回归：刷新和采集同时结束时写盘串行且保留两边结果',async()=>{
 const {elements,state,ctx,dir}=await connectedApp();await createArtist(state,elements,'a');
 const first=gate(),second=gate(),firstReady=gate(),secondReady=gate();
 stub(ctx,{lookup:async()=>[],details:async name=>{(name==='a'?firstReady:secondReady).resolve();await(name==='a'?first:second).promise;return {counts:{total:name==='a'?11:22,checkedAt:'now'},works:[]};}});
 const refreshing=elements.get('sync-all').onclick();await firstReady.promise;
 const collecting=runBatch(elements,'b');await secondReady.promise;
 const writing=gate(),release=gate(),original=ctx.FolderStore.write;let active=0,maxActive=0,firstWrite=true;
 ctx.FolderStore.write=async(...args)=>{active++;maxActive=Math.max(maxActive,active);try{if(firstWrite){firstWrite=false;writing.resolve();await release.promise;}return await original(...args);}finally{active--;}};
 first.resolve();await writing.promise;second.resolve();await tick();release.resolve();await Promise.all([refreshing,collecting]);
 const data=await ctx.FolderStore.read(dir);
 assert.equal(maxActive,1);assert.deepEqual([...data.artists].map(a=>[a.name,a.counts.total]),[['a',11],['b',22]]);
});
test('回归：采集期间切换文件夹不打开选择器或写入另一库',async()=>{
 const {elements,ctx}=await connectedApp(),started=gate(),response=gate();let opened=0;
 ctx.window.showDirectoryPicker=async()=>{opened++;return new FakeDir('另一库');};
 stub(ctx,{lookup:async()=>[],details:async()=>{started.resolve();await response.promise;return {counts:{total:1,checkedAt:'now'},works:[]};}});
 const collecting=runBatch(elements,'a');await started.promise;
 await elements.get('choose-folder').onclick();assert.equal(opened,0);assert.match(elements.get('storage-status').textContent,/任务结束/);
 response.resolve();await collecting;
});


test('浏览卡片按实际五格排列顺序切图，站点作品数跟随名字',async()=>{
 const {state,ctx}=await boot();let opened;ctx.ArtistViewer.open=value=>opened=value;
 const reference={id:'10',thumb:'data:image/jpeg;base64,/9j/2Q=='},test1={id:'11',kind:'test',testSeq:1,thumb:reference.thumb},test2={id:'12',kind:'test',testSeq:2,thumb:reference.thumb};
 const card=state.card(bareArtist({works:[test1,test2,reference],counts:{total:456}}));
 findAllByClass(card,'thumb')[0].onclick();assert.deepEqual([...opened.items].map(work=>work.id),['10','12','11']);assert.equal(opened.work.id,'10');
 const count=findByClass(card,'artist-site-count');assert.equal(count.textContent,'站点作品 456');assert.equal(findByClass(findByClass(card,'name-row'),'artist-site-count'),count);
});

test('顶部额度分开显示张数、百分比与点数，重复点击合并请求',async()=>{
 const {ctx,elements}=await boot();let calls=0,release;const response=new Promise(resolve=>release=resolve),info={tier:3,opusImages:1038,opusPercent:60,anlas:12345};
 ctx.ArtistImageGen.loadToken=()=>'仅测试';ctx.ArtistImageGen.cachedAccount=()=>info;ctx.ArtistImageGen.account=async()=>{calls++;return response;};
 const first=getEl(elements,'opus-status').onclick(),second=getEl(elements,'opus-status').onclick();assert.equal(calls,1);release(info);await Promise.all([first,second]);
 assert.equal(getEl(elements,'quota-images').textContent,'约 1038 张');assert.equal(getEl(elements,'quota-percent').textContent,'60%');assert.equal(getEl(elements,'quota-points').textContent,'12345 点');
});


test('删除前面的画师后，只改变排序序号不应让后面的卡片重新取图',async()=>{
 const {state}=await boot(),artist=bareArtist({uid:'0002-tester-manual',order:2});
 const before=state.keyOf(artist);
 assert.equal(state.keyOf({...artist,order:1}),before,'卡片显示的是稳定画师编号，排序下标不影响内容');
 assert.notEqual(state.keyOf({...artist,note:'已修改'}),before,'实际显示的内容变化仍需更新');
});


for(const action of ['保存','删除画师'])test(action+'提前呈现后写盘失败：保留修改、恢复操作并允许重试',async()=>{
 const {elements,state,ctx,dir}=await connectedApp();await runBatch(elements,'a\nb',false);
 findText(lastRender(state)[0],'编辑').onclick();await wait(150);
 const editor=lastRender(state)[0],note=findByPlaceholder(editor,'备注');note.value='尚未落盘的备注';note.oninput();
 const button=findText(editor,action);if(action==='删除画师')await button.onclick();
 const original=ctx.FolderStore.write,started=gate(),release=gate();let writes=0;
 ctx.FolderStore.write=async()=>{writes++;started.resolve();await release.promise;throw Error('模拟磁盘不可写');};
 const saving=button.onclick();await started.promise;
 try{
  assert.ok(lastRender(state).every(card=>!card.className.includes('is-editing')),'写盘未完成时已收起编辑器');
  assert.equal(state.rows.length,action==='保存'?2:1);
  assert.equal(elements.get('gallery').inert,true,'包括新挂载卡片在内的列表操作被锁定');
  assert.equal(elements.get('storage-status').textContent,'正在保存…');
  await button.onclick();findText(lastRender(state)[0],'编辑').onclick();
  assert.equal(writes,1,'连续点击不会重复写入');assert.ok(lastRender(state).every(card=>!card.className.includes('is-editing')));
 }finally{release.resolve();await saving;ctx.FolderStore.write=original;}
 assert.equal(elements.get('gallery').inert,false);
 assert.match(elements.get('storage-status').textContent,/文件保存失败.*修改暂留本页/);
 assert.equal((await ctx.FolderStore.read(dir)).artists.length,2,'失败不能伪造磁盘成功');
 // 后续保存从当前内存快照继续，不能丢失刚才未落盘的修改。
 elements.get('save-large').checked=true;await elements.get('save-large').onchange();
 const stored=await ctx.FolderStore.read(dir);
 assert.equal(stored.artists.length,action==='保存'?2:1);
 if(action==='保存')assert.equal(stored.artists[0].note,'尚未落盘的备注');
 assert.equal(stored.saveLargeImages,true);
});


/* ── 回归：草稿（还没拿到正式序号的新画师）不能当正式画师对待 ───────────── */

test('回归：新建画师时编辑态的序号不能显示 undefined',async()=>{
  const {elements,state}=await boot();
  elements.get('add-artist').onclick();
  const serial=findByClass(lastRender(state)[0],'serial');
  assert.ok(serial,'编辑态应有序号节点');
  assert.notEqual(serial.textContent,'undefined','草稿还没有正式序号，但不能把 undefined 画到卡片上');
  assert.match(serial.textContent,/^\d{4}$/,'序号位置应显示补足四位的数字');
});
test('回归：草稿标识不能写进画师目录',async()=>{
  const {ctx,dir}=await connectedApp();
  await assert.rejects(()=>ctx.FolderStore.saveImage(dir,'draft-abc-1','large',new Blob(['x'],{type:'image/png'})),/草稿/);
  const artists=dir.items.get('画师');
  assert.equal(artists?artists.items.has('draft-abc-1'):false,false,'不能在数据目录里留下 draft- 开头的孤儿目录');
});
test('回归：草稿态点开作品不该放行「保存原图」',async()=>{
  const {elements,state,ctx}=await boot();let opened=null;
  ctx.ArtistViewer.open=value=>opened=value;
  stub(ctx,{lookup:async()=>[],details:async()=>({counts:{}}),posts:async()=>[post('11')]});
  elements.get('add-artist').onclick();
  const card=()=>lastRender(state)[0];
  const input=findByPlaceholder(card(),'画师名字（必填）');input.value='tester';input.oninput();
  findText(card(),'展开读取').onclick();await wait(30);
  const grid=findByClass(card(),'candidate-previews'),box=grid.children[0].children[0];
  box.checked=true;await box.onchange();
  findAllByClass(card(),'thumb')[0].onclick();
  assert.ok(opened,'点作品应打开大图');
  assert.equal(opened.persist,false,'草稿还没有正式标识，不该出现「保存原图」按钮');
});

/* ── 回归：业务校验被拒绝 ≠ 写盘失败 ────────────────────────────────── */

test('回归：重名被拒绝时不算写盘失败，也不该锁住切换数据文件夹',async()=>{
  const {elements,state,ctx}=await connectedApp();
  await createArtist(state,elements,'同名');
  let opened=0;ctx.window.showDirectoryPicker=async()=>{opened++;return new FakeDir('另一库');};
  elements.get('add-artist').onclick();
  const card=lastRender(state).slice(-1)[0];
  const input=findByPlaceholder(card,'画师名字（必填）');assert.ok(input,'新草稿排在列表末尾');
  input.value='同名';input.oninput();
  await findText(card,'保存').onclick();
  assert.equal(findText(card,'已有同名画师。')!==null,true,'仍要给出重名提示');
  assert.doesNotMatch(getEl(elements,'storage-status').textContent,/文件保存失败/,'校验拒绝不是写盘失败，不能吓唬用户去导出备份');
  await elements.get('choose-folder').onclick();
  assert.equal(opened,1,'校验失败之后仍应能切换数据文件夹');
});

/* ── 回归：两次异步添加各自克隆整库，不能以旧盖新 ───────────────────── */

test('回归：连点两位候选画师「添加」，两位都要留下，不能互相覆盖',async()=>{
  const {elements,state,ctx,dir}=await connectedApp();
  const release1=gate(),release2=gate(),started1=gate(),started2=gate();let started=0;
  stub(ctx,{lookup:async()=>[{id:196870,name:'alpha',aliases:[],pageUrl:'https://danbooru.donmai.us/artists/196870'},{id:196871,name:'beta',aliases:[],pageUrl:'https://danbooru.donmai.us/artists/196871'}],
    details:async()=>{started++;if(started===1){started1.resolve();await release1.promise;}else{started2.resolve();await release2.promise;}return {counts:{total:5}};},
    posts:async()=>[post('11')]});
  getEl(elements,'quick-input').value='两位候选';
  await getEl(elements,'quick-form').onsubmit({preventDefault(){}});
  await wait(30);
  const rows=findAllByClass(getEl(elements,'quick-results'),'candidate');
  assert.equal(rows.length,2,'应列出两位候选画师');
  for(const row of rows){const grid=findByClass(row,'candidate-previews'),box=grid.children[0].children[0];box.checked=true;await box.onchange();}
  await wait(30);
  const first=findText(rows[0],'添加此画师').onclick();
  const second=findText(rows[1],'添加此画师').onclick();
  await started1.promise;release1.resolve();
  await started2.promise;release2.resolve();
  await Promise.all([first,second]);await tick();
  const stored=await ctx.FolderStore.read(dir);
  assert.deepEqual([...stored.artists].map(a=>a.name),['alpha'],'先加进来的那位必须留在库里，不能被后一次提交覆盖掉');
  assert.equal(state.rows.length,1,'界面上也要留着它');
  /* 修复前这里会反过来：alpha 被 beta 覆盖，folder-store 随即把 alpha 的目录整个删掉。 */
  const artistsDir=dir.items.get('画师'),kept=[...(artistsDir?artistsDir.items.keys():[])].filter(name=>!['缩略图','大图'].includes(name));
  assert.equal(artistsDir?.items.has('0001-alpha-196870'),true,'它的图片目录也要在，不能被后续提交顺手删掉');
  assert.deepEqual(kept,['0001-alpha-196870'],'没入库的那位不该在磁盘上留下目录');
});
test('回归：导入测试风格图期间落地的保存不能被旧快照覆盖',async()=>{
  const {elements,ctx}=await boot();
  let stored={version:1,categories:[],tags:[],saveLargeImages:false,artists:[{uid:'0001-甲-manual',order:1,name:'甲',category:null,score:null,aliases:[],alias:null,tags:[],artistUrl:'',description:'',note:'',works:[]}]};
  const release=gate(),reading=gate();
  const host={getData:()=>stored,getBusy:()=>false,
    readImage:async()=>{reading.resolve();await release.promise;return 'data:image/png;base64,AAAA';},
    thumbnail:async()=>'data:image/png;base64,AAAA',
    save:async next=>{stored=typeof next==='function'?next(structuredClone(stored)):next;return true;}};
  ctx.ArtistTestImages.init(host);ctx.ArtistTestImages.files=[{name:'t.png',type:'image/png',size:10}];
  getEl(elements,'test-start').value='1';getEl(elements,'test-seq').value='1';
  const running=ctx.ArtistTestImages.runImport();
  await reading.promise;
  /* 导入还在读图片的时候，别处保存了一个设置。 */
  stored={...stored,saveLargeImages:true};
  release.resolve();await running;
  assert.equal(stored.saveLargeImages,true,'并发保存的设置不能被导入带出的旧快照抹掉');
  assert.equal(stored.artists[0].works.length,1,'导入的测试风格图要落在这位画师身上');
});


/* ── 回归：候选作品区的视线落点 ─────────────────────────────────────── */

/* 编辑态卡片的候选区：先进入编辑态、填好名字、展开读取。 */
async function openCandidatePicker(elements,state,ctx,posts){
  stub(ctx,{lookup:async()=>[],details:async()=>({counts:{}}),posts});
  elements.get('add-artist').onclick();
  const card=()=>lastRender(state)[0];
  const input=findByPlaceholder(card(),'画师名字（必填）');input.value='tester';input.oninput();
  findText(card(),'展开读取').onclick();await wait(30);
  return card;
}
test('回归：展开候选后视线对准画师作品格，且用顶部对齐',async()=>{
  const {elements,state,ctx}=await boot();
  const card=()=>lastRender(state)[0];
  stub(ctx,{lookup:async()=>[],details:async()=>({counts:{}}),posts:async()=>[post('11')]});
  elements.get('add-artist').onclick();
  const input=findByPlaceholder(card(),'画师名字（必填）');input.value='tester';input.oninput();
  state.scrollCalls.length=0;
  findText(card(),'展开读取').onclick();
  await wait(30);
  const call=state.scrollCalls.find(item=>item.selector.includes('.works'));
  assert.ok(call,'展开之后应把视线交给画师作品格，而不是候选区');
  assert.equal(call.options.block,'start','手动展开用顶部对齐，让作品格与第一行候选同时入画');
});
test('回归：翻页与换排序后只在作品格看不见时才拉回视线',async()=>{
  const {elements,state,ctx}=await boot();
  const card=await openCandidatePicker(elements,state,ctx,async()=>Array.from({length:44},(_,i)=>post(String(i+1))));
  state.scrollCalls.length=0;
  findText(card(),'下一页 →').onclick();await wait(30);
  let call=state.scrollCalls.find(item=>item.selector.includes('.works'));
  assert.ok(call,'翻页之后也要把视线交回画师作品格，而不是把候选区顶到最上面');
  assert.equal(call.options.block,'nearest','翻页用 nearest：作品格还在眼前就不动它');
  state.scrollCalls.length=0;
  const orderSelect=findByClass(card(),'picker-order').children[1];
  orderSelect.value='score';orderSelect.onchange();await wait(30);
  call=state.scrollCalls.find(item=>item.selector.includes('.works'));
  assert.ok(call,'换排序之后同样把视线交回画师作品格');
  assert.equal(call.options.block,'nearest','换排序同样用 nearest');
});
test('回归：勾选作品下载缩略图期间仍然可以按 a/d 翻页',async()=>{
  const {elements,state,ctx}=await boot();
  const release=gate();
  ctx.ArtistImages.dataUrl=async()=>{await release.promise;return 'data:image/jpeg;base64,/9j/2Q==';};
  const card=await openCandidatePicker(elements,state,ctx,async()=>Array.from({length:44},(_,i)=>post(String(i+1))));
  const picker=findByClass(card(),'work-picker');
  assert.ok(picker,'展开后应挂上候选区');
  const grid=findByClass(card(),'candidate-previews'),box=grid.children[0].children[0];
  box.checked=true;const adding=box.onchange();
  await tick();
  picker.fire('keydown',{key:'d',preventDefault(){},stopPropagation(){}});
  await wait(30);
  assert.equal(findByClass(card(),'picker-page').textContent,'第 2 页','缩略图还在下载时也该能翻页，不能静默吞掉按键');
  release.resolve();await adding;
});


/* ── 回归：卡片计数与顶部动作区 ─────────────────────────────────────── */

test('画师卡片：站点作品后面跟着「数据截至日前作品」',async()=>{
  const {state}=await boot();
  const card=state.card(bareArtist({counts:{total:456,beforeTotal:332,beforeDate:'2026-07-01'}}));
  const before=findByClass(card,'artist-before-count');
  assert.ok(before,'卡片要显示数据截至日前的作品数');
  assert.equal(before.textContent,'数据截至日前作品 332');
  assert.equal(findByClass(card,'artist-site-count').textContent,'站点作品 456','原来那一项不受影响');
  const row=findByClass(card,'name-row');
  assert.ok(row.children.indexOf(before)>row.children.indexOf(findByClass(card,'artist-site-count')),'排在「站点作品」后面');
  assert.match(String(before.title),/2026-07-01/,'悬停要说明这是哪个截至日期');
});
test('画师卡片：没读过数量时，数据截至日前作品显示未读取',async()=>{
  const {state}=await boot();
  const card=state.card(bareArtist({counts:{}}));
  assert.equal(findByClass(card,'artist-before-count').textContent,'数据截至日前作品 未读取');
});
test('顶部动作：菜单并进标题区，顺序为更多操作 / 测试风格图 / 批量采集画师 / 添加画师',async()=>{
  const html=await fs.readFile('app/index.html','utf8');
  assert.equal(html.includes('view-toolbar'),false,'view-toolbar 已经删掉');
  assert.equal(html.includes('id="view-title"'),false,'#view-title 一并删掉');
  assert.equal(html.includes('id="count"'),false,'#count 一并删掉');
  const at=id=>html.indexOf('id="'+id+'"');
  const order=['library-menu','test-menu','batch-artists','quick-open'].map(at);
  assert.ok(order.every(index=>index>0),'四个动作都要还在页面上');
  assert.deepEqual(order,[...order].sort((a,b)=>a-b),'顺序应为更多操作 / 测试风格图 / 批量采集画师 / 添加画师');
  assert.ok(at('library-menu')>html.indexOf('collection-actions'),'两个菜单要并进 collection-actions');
  assert.ok(at('quick-open')<html.indexOf('task-controls'),'并且仍留在 collection-actions 里');
  assert.ok(at('import-file')>0,'隐藏的备份文件输入框不能跟着一起删掉');
});
test('已经删掉的计数元素不再被任何脚本写入',async()=>{
  for(const file of ['app/app.js','app/workspace.js']){
    const source=await fs.readFile(file,'utf8');
    assert.equal(source.includes("$('count')"),false,file+' 不能再去写 #count');
    assert.equal(source.includes("$('view-title')"),false,file+' 不能再去写 #view-title');
  }
});


for(const action of ['删除作品','新增画师'])test(action+'在慢写盘前呈现，失败后保留内存修改并释放保存锁',async()=>{
 const {elements,state,ctx,dir}=await connectedApp();
 await ctx.FolderStore.write(dir,{...ctx.FolderStore.empty(),artists:[bareArtist({uid:'0001-a-manual',name:'a'})]});await elements.get('choose-folder').onclick();
 const original=ctx.FolderStore.write,started=gate(),release=gate();
 ctx.FolderStore.write=async()=>{started.resolve();await release.promise;throw Error('模拟写入失败');};
 let operation;
 if(action==='删除作品'){const button=findByClass(lastRender(state)[0],'slot-delete');await button.onclick();operation=button.onclick();}
 else operation=runBatch(elements,'new',false);
 await started.promise;
 try{
  assert.equal(elements.get('storage-status').textContent,'正在保存…');assert.equal(elements.get('gallery').inert,true);
  if(action==='删除作品')assert.equal(state.rows[0].works.length,0);else assert.equal(state.rows.length,2);
 }finally{release.resolve();await operation;ctx.FolderStore.write=original;}
 assert.equal(elements.get('gallery').inert,false);assert.match(elements.get('storage-status').textContent,/文件保存失败/);
 const persisted=await ctx.FolderStore.read(dir);assert.equal(persisted.artists.length,1);assert.equal(persisted.artists[0].works.length,1);
 elements.get('save-large').checked=true;await elements.get('save-large').onchange();
 const retried=await ctx.FolderStore.read(dir);
 if(action==='删除作品')assert.equal(retried.artists[0].works.length,0);else assert.equal(retried.artists.length,2);
});


/* ── 回归：批量采集时标出正在采集的那张卡片 ─────────────────────────── */

test('批量采集：正在采集的那张卡片显示「采集中」',async()=>{
  const {elements,state,ctx}=await connectedApp();
  const started=gate(),release=gate();
  stub(ctx,{lookup:async()=>[],details:async()=>{started.resolve();await release.promise;return {counts:{total:5,checkedAt:'now'},works:[]};},posts:async()=>[]});
  const batch=runBatch(elements,'甲\n乙');
  await started.promise;
  const cards=lastRender(state);
  const first=cards.find(card=>findText(card,'甲'));
  assert.ok(first,'第一位画师的卡片要在');
  assert.ok(findByClass(first,'artist-collecting'),'正在采集的那张卡片要显示「采集中」');
  const second=cards.find(card=>findText(card,'乙'));
  assert.ok(second&&!findByClass(second,'artist-collecting'),'还没轮到的那位不该显示「采集中」');
  release.resolve();await batch;
  assert.equal(lastRender(state).some(card=>findByClass(card,'artist-collecting')),false,'采集结束后标记要消失');
});
test('批量采集：中途停止后「采集中」也要收干净',async()=>{
  const {elements,state,ctx}=await connectedApp();
  const started=gate(),release=gate();
  stub(ctx,{lookup:async()=>[],details:async()=>{started.resolve();await release.promise;return {counts:{total:5,checkedAt:'now'},works:[]};},posts:async()=>[]});
  const batch=runBatch(elements,'甲\n乙');
  await started.promise;
  assert.ok(lastRender(state).some(card=>findByClass(card,'artist-collecting')),'采集中要能看到标记');
  elements.get('batch-stop').onclick();
  release.resolve();await batch;
  assert.equal(lastRender(state).some(card=>findByClass(card,'artist-collecting')),false,'中止采集后不能留着「采集中」');
});


/* ── 回归：名字搜不到时，还要按主页地址再搜一次 ─────────────────────── */

/* yotte615 这类字符串可能只在画师的主页地址里，不在名字/组名/别名里；
   名字类搜索永远搜不到，只有 url_matches 能命中。 */
test('批量采集：名字与别名都搜不到时，再按主页地址搜一次',async()=>{
  const {elements,ctx,dir}=await connectedApp();
  const asked=[];
  stub(ctx,{
    lookup:async plan=>{asked.push(plan.apiUrl);return new URL(plan.apiUrl).searchParams.has('search[url_matches]')?[{id:999,name:'yotte615_artist',aliases:[],pageUrl:'https://danbooru.donmai.us/artists/999'}]:[];},
    details:async()=>({counts:{total:5,checkedAt:'now'},works:[]}),
    posts:async()=>[],
  });
  useRealPlan(ctx);
  await runBatch(elements,'yotte615');
  assert.equal(asked.length,3,'名字、综合、主页地址三路依次都要试：'+asked.join(' | '));
  assert.match(asked[2],/url_matches/,'最后一路要按主页地址搜');
  const saved=await ctx.FolderStore.read(dir);
  assert.equal(saved.artists[0].danbooruId,999,'第三路命中的编号要写回画师');
  assert.equal(saved.artists[0].name,'yotte615_artist','名字也要跟着站点的正式名走');
});
test('右键菜单：名字搜不到时也按主页地址再搜一次',async()=>{
  const {elements,state,ctx}=await boot();
  await getEl(elements,'choose-folder').onclick();
  const asked=[];
  stub(ctx,{
    lookup:async plan=>{asked.push(plan.apiUrl);return new URL(plan.apiUrl).searchParams.has('search[url_matches]')?[{id:999,name:'yotte615_artist',aliases:[],pageUrl:'https://danbooru.donmai.us/artists/999'}]:[];},
    posts:async()=>[post('1')],
    details:async()=>({counts:{},works:[],countsError:false}),
  });
  useRealPlan(ctx);
  const replies=[];
  state.pageListeners[0]({type:'artist-library.create',text:'yotte615',requestId:'r1',sourceTabId:42},null,value=>replies.push(value));
  await wait(40);
  assert.equal(replies.length,1);
  assert.equal(replies[0].ok,true,'按主页地址搜到唯一画师后应该建卡成功：'+JSON.stringify(replies[0]));
  assert.ok(asked.some(url=>new URL(url).searchParams.has('search[url_matches]')),'要试过主页地址这一路：'+asked.join(' | '));
});
test('识别画师：名字类搜索落空时补一次主页地址搜索',async()=>{
  const {elements,state,ctx}=await boot();
  const asked=[];
  stub(ctx,{
    lookup:async plan=>{asked.push(plan.apiUrl);return new URL(plan.apiUrl).searchParams.has('search[url_matches]')?[{id:999,name:'yotte615_artist',aliases:[],pageUrl:'https://danbooru.donmai.us/artists/999'}]:[];},
    posts:async()=>[post('1')],
    details:async()=>({counts:{total:7}}),
  });
  useRealPlan(ctx);
  getEl(elements,'quick-input').value='yotte615';
  await getEl(elements,'quick-form').onsubmit({preventDefault(){}});
  await wait(40);
  const row=findByClass(getEl(elements,'quick-results'),'candidate');
  assert.ok(row,'补搜命中后要列出候选：'+asked.join(' | '));
  assert.ok(asked.some(url=>new URL(url).searchParams.has('search[url_matches]')),'要试过主页地址这一路：'+asked.join(' | '));
});


/* ── 回归：右键建卡——认不出来也照建，5 个排队要依次建 ─────────────── */

test('右键菜单：认不出画师时也要建一张空卡，资料留给你自己补',async()=>{
  const {state,ctx,dir}=await connectedApp();
  stub(ctx,{lookup:async()=>[],posts:async()=>[],details:async()=>({counts:{}})});
  useRealPlan(ctx);
  const replies=[];
  state.pageListeners[0]({type:'artist-library.create',text:'yotte615',requestId:'r1',sourceTabId:42},null,value=>replies.push(value));
  await wait(80);
  assert.equal(replies.length,1);
  assert.equal(replies[0].ok,true,'认不出来也要把卡建出来：'+JSON.stringify(replies[0]));
  assert.equal(replies[0].partial,true,'要标明这是一张资料待补的卡');
  const saved=await ctx.FolderStore.read(dir);
  assert.equal(saved.artists.length,1,'库里要出现这一位');
  assert.equal(saved.artists[0].name,'yotte615','卡名就用选中的文字');
  assert.equal(saved.artists[0].danbooruId,null,'没认出来就不写编号');
  assert.equal(saved.artists[0].works.length,0,'也没有作品');
});
test('右键菜单：画师已经在库里时仍然不重复建卡',async()=>{
  const {state,ctx,dir}=await connectedApp();
  stub(ctx,{lookup:async()=>[{id:196870,name:'yotte615',aliases:[],pageUrl:'https://danbooru.donmai.us/artists/196870'}],posts:async()=>[post('1')],details:async()=>({counts:{total:5}})});
  useRealPlan(ctx);
  const replies=[];const send=value=>replies.push(value);
  state.pageListeners[0]({type:'artist-library.create',text:'yotte615',requestId:'r1',sourceTabId:42},null,send);
  await wait(80);
  state.pageListeners[0]({type:'artist-library.create',text:'yotte615',requestId:'r2',sourceTabId:42},null,send);
  await wait(80);
  assert.equal(replies.length,2);
  assert.equal(replies[0].ok,true,'第一次建卡成功：'+JSON.stringify(replies[0]));
  assert.equal(replies[1].ok,false,'同一个画师第二次不该再建：'+JSON.stringify(replies[1]));
  assert.match(String(replies[1].reason),/已经在画师库里/);
  assert.equal((await ctx.FolderStore.read(dir)).artists.length,1);
});
test('右键菜单：排队 5 个且文件夹还没就绪时，要全部等到就绪再依次建卡',async()=>{
  const actions=Array.from({length:5},(_,i)=>({kind:'create',text:'artist'+i,requestId:'r'+i,sourceTabId:42}));
  const {elements,state,ctx}=await boot({actions});
  const dir=new FakeDir('排队测试');ctx.window.showDirectoryPicker=async()=>dir;
  let issued=0;
  stub(ctx,{lookup:async plan=>{const id=1000+(++issued);return [{id,name:plan.query,aliases:[],pageUrl:'https://danbooru.donmai.us/artists/'+id}];},posts:async()=>[],details:async()=>({counts:{total:3}})});
  useRealPlan(ctx);
  await wait(80);
  assert.equal((await ctx.FolderStore.read(dir)).artists.length,0,'文件夹还没接上，一张都不该建');
  /* 状态栏此刻可能被「未连接扩展」的检查结果覆盖，所以这里只断言行为：5 个都在等，
     一个都不该被判定失败（旧的单变量等待位只会等第一个，其余四个会当场失败）。 */
  const rejected=state.pageMessages.filter(message=>message?.type==='created'&&message.result?.ok===false);
  assert.deepEqual(rejected,[],'文件夹没就绪时不该出现失败回执：'+JSON.stringify(rejected.map(message=>message.result.reason)));
  await getEl(elements,'choose-folder').onclick();
  await wait(400);
  const saved=await ctx.FolderStore.read(dir);
  assert.equal(saved.artists.length,5,'接上文件夹后 5 张都要建出来：'+JSON.stringify(saved.artists.map(a=>a.name)));
  /* 注意 [...saved.artists]：saved 来自 vm 上下文，直接用它的 map 会得到另一个 realm 的数组，
     deepStrictEqual 比原型时会判不等（哪怕内容一模一样）。 */
  assert.deepEqual([...saved.artists].map(a=>RealArtistId.parse(a.uid)?.seq),[1,2,3,4,5],'序号要依次发放，不能全撞在 0001：'+JSON.stringify([...saved.artists].map(a=>a.uid)));
});
