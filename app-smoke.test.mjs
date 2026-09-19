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
  append(...nodes){for(const node of nodes)if(node){node.parentNode=this;this.children.push(node);}}
  replaceChildren(...nodes){this.children=nodes.filter(Boolean);for(const node of this.children)node.parentNode=this;}
  remove(){const parent=this.parentNode;if(parent)parent.children=parent.children.filter(child=>child!==this);this.parentNode=null;}
  setAttribute(key,value){this[key]=value;}
  removeAttribute(key){delete this[key];}
  addEventListener(type,fn){(this.listeners??={});(this.listeners[type]??=[]).push(fn);}
  fire(type,event={}){if(typeof event.preventDefault!=='function'){event.defaultPrevented=false;event.preventDefault=()=>{event.defaultPrevented=true;};}for(const fn of this.listeners?.[type]||[])fn(event);return event;}
  querySelectorAll(){return [];}
}
async function boot(){
  const elements=new Map(),state={renders:[],queried:[],scrolled:[],mounted:[],copied:[]};
  const document={getElementById:id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id);},createElement:tag=>new El(tag),
    querySelector:selector=>{state.queried.push(selector);return {scrollIntoView:()=>state.scrolled.push(selector),classList:{add(){},remove(){}},getBoundingClientRect:()=>({top:0,height:0,left:0,width:0})};},
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
    window:{innerWidth:1200,innerHeight:800,listeners:{},addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}},document,localStorage,navigator:{clipboard:{writeText:async text=>{state.copied.push(text);}}},
    IntersectionObserver:IO,ResizeObserver:RO,Option,
    crypto:{randomUUID:()=>'uuid-'+Math.random().toString(36).slice(2)},
    fetch:async()=>{throw Error('测试中不应联网');},
    URL:FileUrl,Blob,structuredClone,setTimeout,clearTimeout,requestAnimationFrame:fn=>fn(),
    ArtistImages:{bind(){},dispose(){},setFolder(){},clear(){},dataUrl:async()=>'data:image/jpeg;base64,/9j/2Q==',fetch:async()=>new Blob([])},
    ArtistExtension:{connected:false,canGenerate:false,canAccount:false,version:'',generate:async()=>{throw Error('未连接');},subscription:async()=>{throw Error('未连接');},check:async()=>{throw Error('测试中未连接扩展');},image:async()=>{throw Error('未连接');},resolve:async()=>{throw Error('未连接');}},
    ArtistGallery:{render(container,rows,card){state.card=card;state.rows=rows;state.renders.push(rows.map(row=>card(row)));},clear(){},pin(){},visible:()=>[],mount(uid){state.mounted.push(uid);return true;}},
    ArtistLookup:{plan(){throw Error('测试中不查询');},lookup:async()=>[],posts:async()=>[],details:async()=>({counts:{total:null,beforeTotal:null}})},
  };
  for(const file of ['artist-id.js','image-cache.js','image-loader.js','folder-store.js','novelai.js','image-gen.js','work-picker.js','viewer.js','test-images.js','app.js'])
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
  assert.equal(card.children.length,3,'卡片应是信息区、作品区与顶部标签条');
  const info=card.children[0];
  assert.ok(info.className.includes('artist-info'));
  const actions=info.children[info.children.length-1];
  assert.ok(actions.className.includes('artist-actions'),'按钮应在 artist-info 内部的最下方');
  assert.equal(actions.children.length,2,'左边编辑、右边画师页面');
  assert.equal(actions.children[0].textContent,'编辑');
  assert.equal(actions.children[1].textContent,'画师页面 ↗');
  assert.equal(actions.children[0].className,'edit-button','两处都用同一套按钮样式');
  assert.equal(actions.children[1].className,'edit-button');
  assert.equal(String(card.children[2].className).includes('artist-meta'),true,'分类与标签移到顶部标签条');
  const texts=[];const walk=node=>{if(node._text)texts.push(node._text);for(const child of node.children||[])walk(child);};
  walk(card);
  assert.equal(texts.includes('刷新'),false,'刷新按钮已移除，改由保存时自动刷新');
  assert.equal(texts.some(t=>String(t).includes('张图片 · 卡片预览')),false,'作品下方的张数说明应已移除');
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
test('画师卡片：主分类与标签搬出信息区，放进顶部标签条',async()=>{
  const {state}=await boot();
  const card=state.card(bareArtist({category:'二次元',tags:['厚涂','黑白']}));
  const texts=node=>{const out=[];const walk=n=>{if(n._text)out.push(n._text);for(const child of n.children||[])walk(child);};walk(node);return out;};
  const info=texts(card.children[0]),meta=texts(card.children[2]);
  assert.equal(info.includes('二次元'),false,'分类不再留在信息区');
  assert.equal(info.includes('厚涂'),false,'标签不再留在信息区');
  assert.equal(meta.includes('二次元'),true,'分类在顶部标签条里');
  assert.equal(meta.includes('厚涂')&&meta.includes('黑白'),true,'标签也在顶部标签条里');
  assert.ok(findByClass(card.children[2],'primary'),'分类沿用原有徽章样式');
  assert.ok(findByClass(card.children[2],'secondary'),'标签沿用原有样式');
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
  assert.deepEqual(actions.children.map(child=>child.textContent),['保存','取消','刷新','删除画师'],'四个按钮要在同一个容器里依次排列');
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
  assert.match(html,/id="card-size" type="range" min="140" max="360" step="1"/,'刻度要细到 1，不能是 20');
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
test('展开与收起 Danbooru 读取区后，视图重新对准正在编辑的卡片',async()=>{
  const {elements,state}=await boot();
  elements.get('add-artist').onclick();
  await wait(30);
  const card=lastRender(state)[0];
  const input=findByPlaceholder(card,'画师名字（必填）');
  input.value='tester';input.oninput();
  state.scrolled.length=0;state.mounted.length=0;
  findText(card,'展开读取').onclick();
  await wait(30);
  assert.equal(state.mounted.length>=1,true,'滚动前要先按真实高度挂载这张卡片，否则占位用的是旧高度');
  assert.equal(state.scrolled.length>=1,true,'展开后应把视图对准这张卡片');
  assert.equal(String(state.scrolled[0]).includes(state.mounted[0]),true,'挂载的和滚动对准的必须是同一张卡片');
  state.scrolled.length=0;
  await wait(460);
  assert.equal(state.scrolled.length>=1,true,'平滑滚动结束后要再校验一次，防止目标漂移');
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
test('生图参数独立成一个对话框，入口在顶部「设置」右边',async()=>{
  const html=await fs.readFile('app/index.html','utf8');
  assert.match(html,/id="settings-open"[^>]*>设置<\/button><button id="gen-settings-open"/,'「生图参数」要排在「设置」右边');
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
  assert.match(String(getEl(elements,'opus-status').textContent),/额度/);
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
  assert.match(html,/id="gen-quality" type="checkbox"/);
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
  assert.match(css,/\.setting-row\.textarea-row>div:first-child\{flex:0 0 320px\}/,'说明栏固定同宽，三个框才会一样宽');
  assert.match(css,/\.setting-row textarea\{[^}]*max-width:none/,'不再封顶，能占满整行剩余宽度');
  assert.match(css,/\.setting-row textarea\{[^}]*flex:1 1 auto/);
  assert.equal(css.includes('max-width:520px'),false,'旧的 520px 上限要去掉');
  assert.match(css,/\.wide-dialog\{width:min\(1180px,96vw\)\}/,'对话框加宽，行内比例不变');
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
test('画师卡片：选用的笔名显示在名字下方，没选用就不显示',async()=>{
  const {state}=await boot();
  const texts=node=>{const out=[];const walk=n=>{if(n._text)out.push(n._text);for(const child of n.children||[])walk(child);};walk(node);return out;};
  const plain=state.card(bareArtist({aliases:['甲','乙']}));
  assert.equal(findAllByClass(plain,'alias').length,0,'没选用笔名时不显示');
  assert.equal(texts(plain).includes('甲'),false,'未选用的笔名不出现在卡片上');
  const shown=state.card(bareArtist({aliases:['甲','乙'],alias:'乙'})),marks=findAllByClass(shown,'alias');
  assert.equal(marks.length,1,'选用后显示一条');
  assert.equal(marks[0].textContent,'乙','只写笔名本身，不加前缀');
  const info=shown.children[0];
  assert.equal(info.children[1].children[0]._text,'tester','第二位是画师名字，包在可点击复制的按钮里');
  assert.equal(String(info.children[2].className).includes('alias'),true,'笔名紧跟在名字下方');
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
test('画师卡片：打了分才在左上角显示角标，1-5 各有对应底板',async()=>{
  const {state}=await boot();
  const plain=state.card(bareArtist());
  assert.equal(findAllByClass(plain,'score-badge').length,0,'未评分不显示角标');
  assert.equal(plain.children.length,3,'没打分时是信息区、作品区、顶部标签条');
  for(const score of [1,2,3,4,5]){
    const card=state.card(bareArtist({score})),badges=findAllByClass(card,'score-badge');
    assert.equal(badges.length,1,'分数 '+score+' 应有且只有一个角标');
    assert.equal(String(badges[0].className).includes('score-'+score),true,'分数 '+score+' 要用对应的底板');
    assert.equal(badges[0].textContent,String(score),'角标只写数字，不带「分」字');
    assert.equal(card.children.length,4,'有角标时多出一个元素，且不挤占信息区');
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
