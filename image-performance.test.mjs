import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {allowedSender} from './图片取图扩展/bridge-policy.mjs';
const require=createRequire(import.meta.url),{ByteCache,Queue}=require('./app/image-cache.js'),store=require('./app/folder-store.js');
test('读取 10000 次后缓存仍受字节和张数双重限制，命中更新淘汰顺序',()=>{
  const cache=new ByteCache(32*1024*1024,64);for(let i=0;i<10000;i++)cache.set(String(i),{size:1024*1024});assert.equal(cache.items.size,32);assert.equal(cache.bytes,32*1024*1024);
  cache.get('9968');cache.set('new',{size:1024*1024});assert.ok(cache.get('9968'));assert.equal(cache.get('9969'),undefined);cache.clear();assert.equal(cache.bytes,0);
  for(let i=0;i<10000;i++)cache.set(String(i),{size:1});assert.equal(cache.items.size,64);
});
test('队列最多同时执行 3 个请求，取消排队任务不触发取图',async()=>{
  const queue=new Queue(3);let active=0,max=0,executed=0;const gate=[];const work=()=>queue.run(async()=>{executed++;active++;max=Math.max(max,active);await new Promise(r=>gate.push(r));active--;});
  const jobs=[work(),work(),work()];await new Promise(r=>setImmediate(r));const controller=new AbortController();const canceled=queue.run(()=>{throw Error('不应执行');},controller.signal);controller.abort();await assert.rejects(canceled,{name:'AbortError'});gate.forEach(r=>r());await Promise.all(jobs);assert.equal(max,3);assert.equal(executed,3);
});
test('连续滚动的 2000 个占位保留顺序，但只构建附近卡片并释放离开的卡片',async()=>{
  const observers=[],disposed=[];let built=0;
  class Element{constructor(){this.style={};this.dataset={};this.children=[];}append(child){this.children.push(child);}replaceChildren(...nodes){this.children=nodes;}getBoundingClientRect(){return {height:320};}}
  class IO{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){}}
  class RO{observe(){}unobserve(){}disconnect(){}}
  const window={innerWidth:1200},context={window,document:{createElement:()=>new Element()},IntersectionObserver:IO,ResizeObserver:RO,ArtistImages:{dispose:id=>disposed.push(id)}};
  vm.runInNewContext(await fs.readFile('app/virtual-gallery.js','utf8'),context);const gallery=new Element(),rows=Array.from({length:2000},(_,i)=>({uid:'artist-'+i}));window.ArtistGallery.render(gallery,rows,()=>{built++;return new Element();});
  assert.equal(gallery.children.length,2000);assert.equal(built,0);const near=gallery.children.slice(0,4);observers[0].fn(near.map(target=>({target,isIntersecting:true})));assert.equal(built,4);assert.equal(window.ArtistGallery.visible().length,4);
  observers[0].fn(near.map(target=>({target,isIntersecting:false})));assert.equal(window.ArtistGallery.visible().length,0);assert.equal(disposed.length,4);assert.equal(gallery.children[0].style.height,'320px');
  observers[0].fn([{target:gallery.children[1999],isIntersecting:true}]);assert.equal(window.ArtistGallery.visible()[0].uid,'artist-1999');assert.equal(built,5);
});
test('图片离开视野/移除卡片时撤销 Blob URL，缓存可再次复用',async()=>{
  const observers=[],revoked=[];let reads=0;const window={};class IO{constructor(fn){this.fn=fn;observers.push(this);}observe(){}unobserve(){}}
  const context={window,ImageResources:{ByteCache,Queue},IntersectionObserver:IO,AbortController,DOMException,Date,Map,fetch,URL:{createObjectURL:()=>`blob:${reads}`,revokeObjectURL:url=>revoked.push(url)},FolderStore:{imageOf:store.imageOf,readImage:async()=>{reads++;return new Blob(['bytes']);}},ArtistExtension:{image:()=>{throw Error('本地图片不应联网');}}};
  const thumb='缩略图/'+'a'.repeat(24)+'.png';
  vm.runInNewContext(await fs.readFile('app/image-loader.js','utf8'),context);const api=window.ArtistImages,img={classList:{add(){},remove(){}},removeAttribute(){this.src=undefined;}};api.setFolder({});api.bind(img,'0001-a-1',{thumb},'card:0001-a-1');observers[0].fn([{target:img,isIntersecting:true}]);await new Promise(r=>setImmediate(r));assert.equal(reads,1);assert.equal(img.src,'blob:1');observers[0].fn([{target:img,isIntersecting:false}]);assert.equal(revoked.length,1);assert.equal(img.src,undefined);
  observers[0].fn([{target:img,isIntersecting:true}]);await new Promise(r=>setImmediate(r));assert.equal(reads,1);api.dispose('card:0001-a-1');assert.equal(revoked.length,2);assert.equal(api.stats().bound,0);
});
test('原图只有在线地址时经扩展取回，同一张第二次直接命中缓存',async()=>{
  const observers=[],requested=[];const window={};class IO{constructor(fn){this.fn=fn;observers.push(this);}observe(){}unobserve(){}}
  const context={window,ImageResources:{ByteCache,Queue},IntersectionObserver:IO,AbortController,DOMException,Date,Map,fetch,URL:{createObjectURL:()=>'blob:large',revokeObjectURL(){}},FolderStore:{imageOf:store.imageOf,readImage:()=>{throw Error('本地还没有原图，不该读文件');}},ArtistExtension:{image:async url=>{requested.push(url);return new Blob(['original']);}}};
  vm.runInNewContext(await fs.readFile('app/image-loader.js','utf8'),context);
  const api=window.ArtistImages,img={classList:{add(){},remove(){}},removeAttribute(){this.src=undefined;}};api.setFolder({});
  const work={thumb:'缩略图/'+'a'.repeat(24)+'.jpg',largeUrl:'https://cdn.donmai.us/original/b.jpg'};
  api.bind(img,'0001-a-1',work,'viewer','large');observers[0].fn([{target:img,isIntersecting:true}]);await new Promise(r=>setImmediate(r));
  assert.deepEqual(requested,['https://cdn.donmai.us/original/b.jpg']);assert.equal(img.src,'blob:large');
  api.dispose('viewer');api.bind(img,'0001-a-1',work,'viewer','large');observers[0].fn([{target:img,isIntersecting:true}]);await new Promise(r=>setImmediate(r));
  assert.equal(requested.length,1,'缓存命中后不再请求扩展');
});
test('编辑中的卡片被钉住后滚出视野也不释放，取消钉住即恢复',async()=>{
  const observers=[],disposed=[];let built=0;
  class Element{constructor(){this.style={};this.dataset={};this.children=[];}append(child){this.children.push(child);}replaceChildren(...nodes){this.children=nodes;}getBoundingClientRect(){return {height:320};}}
  class IO{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){}}
  class RO{observe(){}unobserve(){}disconnect(){}}
  const window={innerWidth:1200},context={window,document:{createElement:()=>new Element()},IntersectionObserver:IO,ResizeObserver:RO,ArtistImages:{dispose:id=>disposed.push(id)}};
  vm.runInNewContext(await fs.readFile('app/virtual-gallery.js','utf8'),context);
  const gallery=new Element(),rows=[{uid:'a'},{uid:'b'}];
  window.ArtistGallery.render(gallery,rows,()=>{built++;return new Element();});
  observers[0].fn(rows.map((row,i)=>({target:gallery.children[i],isIntersecting:true})));
  assert.equal(built,2);
  window.ArtistGallery.pin('a',true);
  observers[0].fn(rows.map((row,i)=>({target:gallery.children[i],isIntersecting:false})));
  assert.equal(window.ArtistGallery.visible().length,1,'钉住的卡片要留着，否则编辑到一半就被卸载');
  assert.deepEqual(disposed,['card:b'],'只释放没被钉住的那张');
  window.ArtistGallery.pin('a',false);
  observers[0].fn([{target:gallery.children[0],isIntersecting:false}]);
  assert.equal(window.ArtistGallery.visible().length,0,'取消钉住后正常释放');
});
test('同一批画师重绘时不重建占位，只重画已挂载的卡片',async()=>{
  const observers=[];let built=0,created=0;
  class Element{constructor(){created++;this.style={};this.dataset={};this.children=[];}append(child){this.children.push(child);}replaceChildren(...nodes){this.children=nodes;}getBoundingClientRect(){return {height:320};}}
  class IO{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){}}
  class RO{observe(){}unobserve(){}disconnect(){}}
  const window={innerWidth:1200},context={window,document:{createElement:()=>new Element()},IntersectionObserver:IO,ResizeObserver:RO,ArtistImages:{dispose(){}}};
  vm.runInNewContext(await fs.readFile('app/virtual-gallery.js','utf8'),context);
  const gallery=new Element(),rows=[{uid:'a',n:1},{uid:'b',n:1}];
  window.ArtistGallery.render(gallery,rows,()=>{built++;return new Element();});
  observers[0].fn(rows.map((row,i)=>({target:gallery.children[i],isIntersecting:true})));
  assert.equal(built,2,'两张都挂载了');
  const slotsBefore=gallery.children.slice(),builtBefore=built,observerCount=observers.length;
  window.ArtistGallery.render(gallery,[{uid:'a',n:2},{uid:'b',n:2}],()=>{built++;return new Element();});
  assert.equal(gallery.children.length,2,'占位数量不变');
  assert.equal(gallery.children[0],slotsBefore[0],'占位对象要复用，不能重建——重建会连整棵布局树一起丢掉');
  assert.equal(gallery.children[1],slotsBefore[1]);
  assert.equal(observers.length,observerCount,'不该重建观察器');
  assert.equal(built,builtBefore+2,'已挂载的卡片要重画，内容才会更新');
  assert.equal(window.ArtistGallery.visible().map(artist=>artist.n).join(','),'2,2','挂载记录要指向新对象');
});
test('画师增减或换序时才重建占位',async()=>{
  const observers=[];let created=0;
  class Element{constructor(){created++;this.style={};this.dataset={};this.children=[];}append(child){this.children.push(child);}replaceChildren(...nodes){this.children=nodes;}getBoundingClientRect(){return {height:320};}}
  class IO{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){}}
  class RO{observe(){}unobserve(){}disconnect(){}}
  const window={innerWidth:1200},context={window,document:{createElement:()=>new Element()},IntersectionObserver:IO,ResizeObserver:RO,ArtistImages:{dispose(){}}};
  vm.runInNewContext(await fs.readFile('app/virtual-gallery.js','utf8'),context);
  const gallery=new Element();
  window.ArtistGallery.render(gallery,[{uid:'a'},{uid:'b'}],()=>new Element());
  const first=gallery.children[0];
  window.ArtistGallery.render(gallery,[{uid:'a'},{uid:'b'},{uid:'c'}],()=>new Element());
  assert.equal(gallery.children.length,3,'多了一位要重建');
  assert.notEqual(gallery.children[0],first);
  const before=gallery.children.slice();
  window.ArtistGallery.render(gallery,[{uid:'b'},{uid:'a'},{uid:'c'}],()=>new Element());
  assert.notEqual(gallery.children[0],before[0],'换了顺序也要重建，否则占位与画师对不上');
  assert.equal(gallery.children[0].dataset.uid,'b');
});
test('查看器里缩略图换成原图时做交叉淡入，中途不清空已显示的图',async()=>{
  const observers=[],animations=[],revoked=[];
  class IO{constructor(fn){this.fn=fn;observers.push(this);}observe(){}unobserve(){}}
  const window={};
  const context={window,ImageResources:{ByteCache,Queue},IntersectionObserver:IO,AbortController,DOMException,Date,Map,fetch,URL:{createObjectURL:()=>'blob:'+animations.length,revokeObjectURL:url=>revoked.push(url)},FolderStore:{imageOf:store.imageOf,readImage:async()=>new Blob(['bytes'])},ArtistExtension:{image:async()=>new Blob(['remote'])}};
  vm.runInNewContext(await fs.readFile('app/image-loader.js','utf8'),context);
  const api=window.ArtistImages,img={classList:{add(){},remove(){}},src:'',removeAttribute(){this.src='';},animate(keyframes){animations.push(keyframes);return {finished:Promise.resolve(),cancel(){}};}};
  api.setFolder({});
  const thumb='缩略图/'+'a'.repeat(24)+'.png',large='大图/'+'b'.repeat(24)+'.png';
  api.bind(img,'0001-a',{thumb},'viewer','thumb');
  observers[0].fn([{target:img,isIntersecting:true}]);
  await new Promise(r=>setImmediate(r));
  assert.equal(animations.length,1,'首次显示只有淡入');
  assert.equal(animations[0][0].opacity,0);
  const firstSrc=img.src;
  assert.ok(firstSrc,'缩略图已上屏');
  api.bind(img,'0001-a',{thumb,large},'viewer','large');
  assert.equal(img.src,firstSrc,'换目标时不能清空正在显示的图，否则中间会闪一下空白');
  observers[0].fn([{target:img,isIntersecting:true}]);
  await new Promise(r=>setImmediate(r));
  assert.equal(animations.length,3,'换图时先淡出再淡入');
  assert.equal(animations[1][1].opacity,0,'第二段是淡出');
  assert.equal(animations[2][1].opacity,1,'第三段是淡入');
  assert.notEqual(img.src,firstSrc,'换完才指向新图');
});
test('连接通道只接受本扩展在本地顶层页面注入的脚本，不接受网站、子框架或其他扩展',()=>{
  const s={id:'this-extension',tab:{id:1},frameId:0,url:'file:///F:/test/'+encodeURIComponent('画师库.html')};assert.equal(allowedSender(s,'this-extension'),true);
  assert.equal(allowedSender({...s,url:'file:///F:/工具/'+encodeURIComponent('回填作品.html')},'this-extension'),true,'本地工具页也要能连上：页面身份改由 content.js 的 meta 标记把关');
  for(const override of [{frameId:1},{id:'other'},{url:'https://evil.example/画师库.html'},{url:'https://evil.example/a.html'},{url:'http://127.0.0.1/a.html'}])assert.equal(allowedSender({...s,...override},'this-extension'),false,'只放行本扩展、顶层框架、file: 协议');
});
test('HTML 与隔离脚本按块取回大图，端到端返回可用 Blob 并传播服务器失败',async()=>{
  const listeners=[];const win={addEventListener:(type,fn)=>listeners.push(fn),postMessage:data=>queueMicrotask(()=>listeners.forEach(fn=>fn({source:win,data})))};win.top=win;let fail=false,chunkFail=false,resolveFail=false,apiFail=false,chunkCalls=0;
  const context={window:win,location:{protocol:'file:',pathname:'/F:/画师库.html'},document:{querySelector:()=>true},crypto,DOMException,fetch,setTimeout,clearTimeout,chrome:{runtime:{getManifest:()=>({version:'0.3.2'}),sendMessage:async m=>{
    if(m.type==='ping')return {ok:true,version:'0.3.2'};
    if(m.type==='resolve')return resolveFail?{ok:false,error:'作品信息请求超时'}:{ok:true,url:'https://cdn.donmai.us/original/full.jpg'};
    if(m.type==='api')return apiFail?{ok:false,error:'接口请求超时'}:{ok:true,status:200,json:[{id:1,file_url:'https://cdn.donmai.us/original/a.jpg'}]};
    if(m.type==='image')return fail?{ok:false,error:'服务器拒绝请求：HTTP 403'}:{ok:true,type:'image/jpeg',bytes:4,chunks:2};
    chunkCalls++;if(chunkFail)return {ok:false,error:'图片数据已过期，请重新获取'};
    return {ok:true,index:m.index,data:m.index===0?'/9j/':'2Q=='};
  }}}};
  vm.runInNewContext(await fs.readFile('app/extension-bridge.js','utf8'),context);vm.runInNewContext(await fs.readFile('图片取图扩展/content.js','utf8'),context);
  assert.equal(await win.ArtistExtension.check(),'0.3.2');
  assert.equal(win.ArtistExtension.canFetchApi,true,'0.3.2 才带接口通道');
  const blob=await win.ArtistExtension.image('https://cdn.donmai.us/test.jpg');
  assert.equal(blob.type,'image/jpeg');assert.equal(blob.size,4);assert.equal(chunkCalls,2,'按扩展给出的分块数逐块取回');
  assert.equal(await win.ArtistExtension.resolve('12036303'),'https://cdn.donmai.us/original/full.jpg','按作品编号问出原图地址');
  resolveFail=true;await assert.rejects(win.ArtistExtension.resolve('12036303'),/超时/,'解析失败要如实抛出');resolveFail=false;
  const api=await win.ArtistExtension.api('https://danbooru.donmai.us/posts.json?tags=a');
  assert.equal(api.ok,true);assert.equal(api.status,200);
  assert.equal((await api.json())[0].file_url,'https://cdn.donmai.us/original/a.jpg','经扩展取回的接口数据要带图片地址');
  apiFail=true;await assert.rejects(win.ArtistExtension.api('https://danbooru.donmai.us/posts.json'),/超时/,'接口失败要如实抛出');apiFail=false;
  assert.equal((await win.ArtistExtension.api('https://danbooru.donmai.us/posts.json')).status,200,'失败后要能恢复');
  fail=true;await assert.rejects(win.ArtistExtension.image('https://cdn.donmai.us/test.jpg'),/403/);
  fail=false;chunkFail=true;await assert.rejects(win.ArtistExtension.image('https://cdn.donmai.us/test.jpg'),/过期/,'分块失败要如实报错而不是返回残缺图片');
});
test('扩展版本过旧时不启用接口通道，直接退回直连而不是干等到超时',async()=>{
  const code=await fs.readFile('app/extension-bridge.js','utf8'),content=await fs.readFile('图片取图扩展/content.js','utf8');
  const canFetch=async version=>{
    const listeners=[],win={addEventListener:(type,fn)=>listeners.push(fn),postMessage:data=>queueMicrotask(()=>listeners.forEach(fn=>fn({source:win,data})))};win.top=win;
    const context={window:win,location:{protocol:'file:',pathname:'/F:/画师库.html'},document:{querySelector:()=>true},crypto,setTimeout,clearTimeout,
      chrome:{runtime:{getManifest:()=>({version}),sendMessage:async m=>m.type==='ping'?{ok:true,version}:{ok:true}}}};
    vm.runInNewContext(code,context);vm.runInNewContext(content,context);
    await win.ArtistExtension.check();
    return win.ArtistExtension.canFetchApi;
  };
  assert.equal(await canFetch('0.3.2'),true,'0.3.2 起才有接口通道');
  assert.equal(await canFetch('0.3.10'),true,'两位数的段号不能按字符串比较');
  assert.equal(await canFetch('0.4.0'),true,'更新的版本照常可用');
  assert.equal(await canFetch('0.3.1'),false,'旧扩展不认 api 类型，会静默丢弃消息');
  assert.equal(await canFetch('0.3.0'),false);
  assert.equal(await canFetch('0.2.9'),false);
  assert.equal(await canFetch(''),false,'版本号读不到时按不可用处理');
  assert.equal(await canFetch('unknown'),false);
});
