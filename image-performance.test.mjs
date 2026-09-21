import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
  class Element{
    remove(){if(this.parentNode){const p=this.parentNode;p.children=p.children.filter(n=>n!==this);this.parentNode=null;}}
    insertBefore(node,before){if(node===before)return;node.remove();const i=this.children.indexOf(before);node.parentNode=this;if(i<0)this.children.push(node);else this.children.splice(i,0,node);}
constructor(){this.style={};this.dataset={};this.children=[];}append(child){this.children.push(child);}replaceChildren(...nodes){this.children=nodes;}getBoundingClientRect(){return {height:320};}}
  class IO{constructor(fn){this.fn=fn;observers.push(this);}observe(){}unobserve(){}disconnect(){}}
  class RO{observe(){}unobserve(){}unobserve(){}disconnect(){}}
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
  class Element{
    remove(){if(this.parentNode){const p=this.parentNode;p.children=p.children.filter(n=>n!==this);this.parentNode=null;}}
    insertBefore(node,before){if(node===before)return;node.remove();const i=this.children.indexOf(before);node.parentNode=this;if(i<0)this.children.push(node);else this.children.splice(i,0,node);}
constructor(){this.style={};this.dataset={};this.children=[];}append(child){this.children.push(child);}replaceChildren(...nodes){this.children=nodes;}getBoundingClientRect(){return {height:320};}}
  class IO{constructor(fn){this.fn=fn;observers.push(this);}observe(){}unobserve(){}disconnect(){}}
  class RO{observe(){}unobserve(){}unobserve(){}disconnect(){}}
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
  class Element{
    remove(){if(this.parentNode){const p=this.parentNode;p.children=p.children.filter(n=>n!==this);this.parentNode=null;}}
    insertBefore(node,before){if(node===before)return;node.remove();const i=this.children.indexOf(before);node.parentNode=this;if(i<0)this.children.push(node);else this.children.splice(i,0,node);}
constructor(){created++;this.style={};this.dataset={};this.children=[];}append(child){this.children.push(child);}replaceChildren(...nodes){this.children=nodes;}getBoundingClientRect(){return {height:320};}}
  class IO{constructor(fn){this.fn=fn;observers.push(this);}observe(){}unobserve(){}disconnect(){}}
  class RO{observe(){}unobserve(){}unobserve(){}disconnect(){}}
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
/* 带布局的假画廊：占位高度按 style.height 累计出 top，动画调用记在 animations 里。
   画廊「该滑多远」就是拿前后两次 top 相减算出来的，所以这层假布局必须给出真的 top——
   只返回一个 height 的话，滑动这条路径等于没测。 */
function stage(){
  const observers=[],disposed=[];
  class Element{
    remove(){if(this.parentNode){const p=this.parentNode;p.children=p.children.filter(n=>n!==this);this.parentNode=null;}}
    insertBefore(node,before){if(node===before)return;node.remove();const i=this.children.indexOf(before);node.parentNode=this;if(i<0)this.children.push(node);else this.children.splice(i,0,node);}

    constructor(){this.style={};this.dataset={};this.children=[];this.animations=[];}
    append(child){child.parentNode=this;this.children.push(child);}
    replaceChildren(...nodes){for(const node of nodes)node.parentNode=this;this.children=nodes.filter(Boolean);}
    animate(frames,options){this.animations.push({frames,options});return {finished:Promise.resolve(),cancel(){}};}
    getBoundingClientRect(){
      /* 容器自己负责排版：按顺序把每个占位的 top 算出来（挂上卡片的用卡片高度，空占位用记下的高度）。 */
      if(this.isStage){let y=0;for(const slot of this.children){const h=slot.style.height?parseFloat(slot.style.height):(slot.cardHeight||300);slot.top=y;slot.height=h;y+=h;}return {top:0,height:y,left:0};}
      return {top:this.top||0,height:this.height||0,left:0};
    }
  }
  class IO{constructor(fn){this.fn=fn;observers.push(this);}observe(){}unobserve(){}unobserve(){}disconnect(){}}
  class RO{observe(){}unobserve(){}unobserve(){}disconnect(){}}
  const window={innerWidth:1200,innerHeight:800},gallery=new Element();gallery.isStage=true;
  return {Element,window,gallery,observers,disposed,context:{window,document:{createElement:()=>new Element()},IntersectionObserver:IO,ResizeObserver:RO,ArtistImages:{dispose:id=>disposed.push(id)}}};
}
/* 首次渲染时每张卡都有自己的入场动画；要单独看「这次变化带来了什么动画」，先把它清掉。 */
function clearAnimations(gallery){for(const slot of gallery.children)slot.animations.length=0;}
/* 把当前所有占位一次性挂上卡片：模拟 IntersectionObserver 说「都进视野了」。 */
function mountAll(observers,gallery,height=320){for(const slot of gallery.children)slot.cardHeight=height;observers[observers.length-1].fn(gallery.children.map(target=>({target,isIntersecting:true})));clearAnimations(gallery);}
test('画师增减或换序时按 uid 复用占位，只有新来的才新建',async()=>{
  const kit=stage();
  vm.runInNewContext(await fs.readFile('app/virtual-gallery.js','utf8'),kit.context);
  const gallery=kit.gallery;
  kit.window.ArtistGallery.render(gallery,[{uid:'a'},{uid:'b'}],()=>new kit.Element());
  const [slotA,slotB]=gallery.children;
  kit.window.ArtistGallery.render(gallery,[{uid:'a'},{uid:'b'},{uid:'c'}],()=>new kit.Element());
  assert.equal(gallery.children.length,3,'多了一位');
  assert.equal(gallery.children[0],slotA,'没动的占位要接着用');
  assert.equal(gallery.children[1],slotB);
  assert.equal(gallery.children[2].dataset.uid,'c','只有新来的才新建占位');
  kit.window.ArtistGallery.render(gallery,[{uid:'b'},{uid:'a'},{uid:'c'}],()=>new kit.Element());
  assert.equal(gallery.children.map(slot=>slot.dataset.uid).join(','),'b,a,c','顺序要跟着列表走');
  assert.deepEqual(gallery.children.map(slot=>slot.dataset.index),[0,1,2],'占位上的下标要跟着更新');
});
test('删除一位画师时，剩下的卡片从旧位置滑上来，而不是直接跳上去',async()=>{
  const kit=stage(),{gallery,observers,window}=kit;
  vm.runInNewContext(await fs.readFile('app/virtual-gallery.js','utf8'),kit.context);
  const rows=[{uid:'a'},{uid:'b'},{uid:'c'}];
  window.ArtistGallery.render(gallery,rows,()=>new kit.Element());
  mountAll(observers,gallery);
  assert.equal(window.ArtistGallery.visible().length,3,'三张都挂上了');
  const [slotA,slotB,slotC]=gallery.children,cardC=slotC.children[0];
  window.ArtistGallery.render(gallery,[{uid:'a'},{uid:'c'}],()=>new kit.Element());
  assert.equal(gallery.children.length,2);
  assert.equal(gallery.children[0],slotA);
  assert.equal(gallery.children[1],slotC);
  assert.equal(slotC.children[0],cardC,'卡片 DOM 不能重建：重建会重新取图，看着就是闪一下');
  assert.equal(window.ArtistGallery.visible().length,2,'剩下的卡片保持在挂载状态');
  assert.equal(kit.disposed.join(','),'card:b','只释放被删掉那张的图');
  assert.equal(slotA.animations.length,0,'没动的卡片不该有动画');
  assert.equal(slotB.animations.length,0);
  assert.equal(slotC.animations.length,1,'下面那位要滑上来');
  /* vm 里造出来的对象和测试不在同一个 realm，deepEqual 会卡在原型不同上，所以比 JSON。 */
  assert.equal(JSON.stringify(slotC.animations[0].frames),JSON.stringify([{transform:'translateY(320px)'},{transform:'none'}]),'滑的距离正好是被删掉那张的高度');
});
test('卡片指纹没变就不重画；就地更新过并同步过指纹的也不再重画',async()=>{
  const kit=stage(),{gallery,observers,window}=kit;
  vm.runInNewContext(await fs.readFile('app/virtual-gallery.js','utf8'),kit.context);
  let built=0,stamp='v1';
  const make=()=>{built++;return new kit.Element();};
  const keyOf=()=>stamp,rows=[{uid:'a'}];
  window.ArtistGallery.render(gallery,rows,make,keyOf);
  mountAll(observers,gallery);
  assert.equal(built,1);
  window.ArtistGallery.render(gallery,rows,make,keyOf);
  assert.equal(built,1,'同一份数据再渲染一次不该重画：重画会让卡片上的图片重新淡入，看着就是整屏闪一下');
  /* 模拟编辑态里就地补了一格作品：数据变了，但卡片 DOM 是 app 自己补好的，同步指纹之后不该再被整张重画
     （整张重画会把下面展开着的候选列表一起冲掉）。 */
  stamp='v2';
  window.ArtistGallery.markPainted('a');
  window.ArtistGallery.render(gallery,rows,make,keyOf);
  assert.equal(built,1,'就地更新过并同步过指纹的卡片，下一次渲染不该再整张重画');
  stamp='v3';
  window.ArtistGallery.render(gallery,rows,make,keyOf);
  assert.equal(built,2,'内容真的变了才重画');
});
test('新出现的卡片在原位淡入上浮；系统里关了动效就一个都不放',async()=>{
  const kit=stage(),{gallery,observers,window}=kit;
  vm.runInNewContext(await fs.readFile('app/virtual-gallery.js','utf8'),kit.context);
  window.ArtistGallery.render(gallery,[{uid:'a'}],()=>new kit.Element());
  mountAll(observers,gallery);
  const slotA=gallery.children[0];
  window.ArtistGallery.render(gallery,[{uid:'a'},{uid:'b'}],()=>new kit.Element());
  const slotB=gallery.children[1];
  assert.equal(slotA.animations.length,0,'原来那张没动就不该有动画');
  assert.equal(slotB.animations.length,1,'新来的要淡入上浮');
  assert.equal(JSON.stringify(slotB.animations[0].frames),JSON.stringify([{opacity:0,transform:'translateY(16px) scale(.985)'},{opacity:1,transform:'none'}]),'新来的要淡入上浮');  kit.context.matchMedia=()=>({matches:true});
  window.ArtistGallery.render(gallery,[{uid:'a'},{uid:'b'},{uid:'c'}],()=>new kit.Element());
  assert.equal(gallery.children[2].animations.length,0,'关掉动效后新卡也不该动');
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
test('同一组缩略图逐张进场：每多一张多等一档，隔久了重新排队，延迟期间不许先闪出来',async()=>{
  const observers=[],animations=[];
  let clock=1000;
  class IO{constructor(fn){this.fn=fn;observers.push(this);}observe(){}unobserve(){}}
  const window={};
  const context={window,ImageResources:{ByteCache,Queue},IntersectionObserver:IO,AbortController,DOMException,Date:{now:()=>clock},Map,fetch,URL:{createObjectURL:()=>'blob:x',revokeObjectURL(){}},FolderStore:{imageOf:store.imageOf,readImage:async()=>new Blob(['bytes'])},ArtistExtension:{image:()=>{throw Error('本地图片不应联网');}}};
  vm.runInNewContext(await fs.readFile('app/image-loader.js','utf8'),context);
  const api=window.ArtistImages;
  const make=()=>({classList:{add(){},remove(){}},src:'',removeAttribute(){this.src='';},animate(keyframes,options){animations.push({keyframes,options});return {finished:Promise.resolve(),cancel(){}};}});
  const settle=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
  const thumb='缩略图/'+'c'.repeat(24)+'.png';
  api.setFolder({});
  const group='card:0001-a';
  for(let i=0;i<4;i++){const img=make();api.bind(img,'0001-a',{thumb},group);observers[0].fn([{target:img,isIntersecting:true}]);}
  await settle();
  assert.equal(animations.length,4,'四张都进场了');
  assert.deepEqual(animations.map(item=>item.options.delay),[0,24,48,72],'同一组里逐张进场，每多一张多等一档');
  assert.equal(animations[0].options.fill,'backwards','延迟期间要压住首帧，否则会先整张闪出来再淡入');
  assert.equal(animations[0].keyframes[0].opacity,0,'进场从透明开始');
  assert.equal(animations[0].keyframes[0].transform,'translateY(10px) scale(.97)','进场和 takoma 一样：轻微上浮 + 放大到位');
  animations.length=0;
  clock+=5000;
  const late=make();
  api.bind(late,'0001-a',{thumb},group);
  observers[0].fn([{target:late,isIntersecting:true}]);
  await settle();
  assert.equal(animations[0].options.delay,0,'隔久了就是新的一批，从 0 重新排');
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
/* ---------- 真实磁盘测量：删一位画师到底该碰多少东西 ----------
   这里把 File System Access 那套接口架在 node:fs 上，用真的磁盘、真的目录树跑一遍 write()，
   目的不是模拟浏览器那点 IPC 延迟（node 每步都快得多），而是数「碰了多少个目录、写了多少个文件」：
   浏览器的耗时几乎就等于这个次数乘上每次的往返延迟，所以次数才是那个 2 秒卡顿的根。 */
const notFound=()=>new DOMException('不存在','NotFoundError');
async function kindOf(target){try{const info=await fs.stat(target);return info.isDirectory()?'dir':info.isFile()?'file':'';}catch{return '';}}
class NodeFile{
  constructor(file,counters){this.file=file;this.counters=counters;this.kind='file';this.name=path.basename(file);}
  async getFile(){const bytes=await fs.readFile(this.file);return {name:this.name,size:bytes.length,type:'',text:async()=>bytes.toString('utf8'),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};}
  async createWritable(){this.counters.write++;const self=this;return {write:async value=>{await fs.writeFile(self.file,value);},close:async()=>{},abort:async()=>{}};}
}
class NodeDir{
  constructor(dir,counters){this.dir=dir;this.counters=counters;this.kind='directory';}
  async getDirectoryHandle(name,{create=false}={}){
    this.counters.dir++;const target=path.join(this.dir,name);
    if(create)await fs.mkdir(target,{recursive:true});
    else if(await kindOf(target)!=='dir')throw notFound();
    return new NodeDir(target,this.counters);
  }
  async getFileHandle(name,{create=false}={}){
    this.counters.file++;const target=path.join(this.dir,name),kind=await kindOf(target);
    if(create){if(kind!=='file')await fs.writeFile(target,'');}
    else if(kind!=='file')throw notFound();
    return new NodeFile(target,this.counters);
  }
  async *values(){
    for(const entry of await fs.readdir(this.dir,{withFileTypes:true})){const target=path.join(this.dir,entry.name);yield entry.isDirectory()?new NodeDir(target,this.counters):new NodeFile(target,this.counters);}
  }
  async removeEntry(name,{recursive=false}={}){this.counters.remove++;await fs.rm(path.join(this.dir,name),{recursive});}
}
function sampleLibrary(total){
  return {...store.empty(),artists:Array.from({length:total},(_,i)=>({
    uid:String(i+1).padStart(4,'0')+'-tester'+i+'-'+(1000+i),order:i+1,name:'tester'+i,category:null,score:null,aliases:[],alias:null,tags:[],artistUrl:'',description:'',note:'',
    works:Array.from({length:3},(_,j)=>({id:String(i*10+j),thumb:'https://cdn.donmai.us/preview/'+i+'-'+j+'.jpg'})),
  }))};
}
test('删除一位画师只该动它自己的目录，不能重写后面每位画师的信息.json',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'artist-delete-')),counters={dir:0,file:0,write:0,remove:0};
  try{
    const library=sampleLibrary(233),dir=new NodeDir(root,counters);
    await store.write(dir,library);
    const before={...counters},started=performance.now();
    /* 与 app.js 里 removeArtist 的做法完全一致：滤掉一位，再给剩下的人重排序号。 */
    const next={...library,artists:library.artists.filter(a=>a.uid!==library.artists[2].uid)};
    next.artists.forEach((a,i)=>a.order=i+1);
    await store.write(dir,next);
    const ms=performance.now()-started,delta=key=>counters[key]-before[key];
    const detail=`用时 ${ms.toFixed(0)}ms，目录查询 ${delta('dir')} 次，文件写入 ${delta('write')} 个，删除 ${delta('remove')} 次`;
    assert.equal(delta('remove'),1,'只该删掉那一位画师的目录：'+detail);
    assert.ok(delta('write')<=2,'删除一位画师最多只该写 画师库.json，实际写了 '+delta('write')+' 个文件（'+detail+'）');
    assert.ok(delta('dir')<=8,'删除一位画师不该遍历其它画师的目录，实际查询 '+delta('dir')+' 次（'+detail+'）');
    assert.equal((await fs.readdir(path.join(root,'画师'))).length,232,'磁盘上应真的少一个画师目录');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
/* 反过来也要守住：指纹忽略 order 之后，作品真变了必须照样重写、旧图片必须照样清掉，
   否则「删了一格但磁盘上的图和 信息.json 还是旧的」这种更难查的问题会悄悄回来。 */
test('作品真的变了照样重写 信息.json 并清掉不再引用的旧图片',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'artist-change-')),counters={dir:0,file:0,write:0,remove:0};
  try{
    const library=sampleLibrary(3),dir=new NodeDir(root,counters);
    await store.write(dir,library);
    const target=library.artists[1],stale='a'.repeat(24)+'.png',images=path.join(root,'画师',target.uid,'缩略图');
    await fs.writeFile(path.join(images,stale),'旧图');
    const edited=structuredClone(library);
    edited.artists[1].works[1].thumb='缩略图/'+stale;
    const before={...counters};
    await store.write(dir,edited);
    /* 只有 1 个文件：这位画师的 信息.json。索引（画师标识列表 + 头部设置）这次没变，
       所以不重写——见下面「索引内容没变时不重写 画师库.json」。 */
    assert.equal(counters.write-before.write,1,'改了作品要重写这位画师的 信息.json');
    assert.equal(JSON.parse(await fs.readFile(path.join(root,'画师',target.uid,'信息.json'),'utf8')).works[1].thumb,'缩略图/'+stale,'改完的引用必须真的落盘');
    assert.ok((await fs.readdir(images)).includes(stale),'还在引用的图片不能被当成垃圾删掉');
    const dropped=structuredClone(edited);
    dropped.artists[1].works[1].thumb='https://cdn.donmai.us/preview/other.jpg';
    await store.write(dir,dropped);
    assert.ok(!(await fs.readdir(images)).includes(stale),'不再被引用的旧图片要清掉');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
/* 改标签名 / 删标签是「只动元数据」：图片一格都没变，就不该去开图片目录、更不该做旧图清理。
   走 'meta' 标记的这条路，落盘的只有被改动的那些 信息.json。 */
test('只改标签名时不去碰图片目录，只重写带该标签的画师',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'artist-meta-')),counters={dir:0,file:0,write:0,remove:0};
  try{
    const library=sampleLibrary(40),dir=new NodeDir(root,counters);
    await store.write(dir,library);
    const renamed=structuredClone(library);
    renamed.tags=['新名'];
    renamed.artists.forEach((artist,index)=>{if(index%2===0)artist.tags=['新名'];});
    const before={...counters};
    await store.write(dir,renamed,'meta');
    /* 20 位带标签的画师各一份 信息.json，外加一次 画师库.json 索引。 */
    assert.equal(counters.write-before.write,21,'只该重写带这个标签的画师，外加索引');
    /* 20 位画师目录 + 索引所在的「数据」根目录；不带 'meta' 时这里会是 40 次以上。 */
    assert.ok(counters.dir-before.dir<=22,'不该去开图片目录，实际开了 '+(counters.dir-before.dir)+' 次目录');
    assert.equal(counters.remove-before.remove,0,'元数据改动不该删任何东西');
    const index=JSON.parse(await fs.readFile(path.join(root,'画师库.json'),'utf8'));
    assert.deepEqual(index.tags,['新名']);
    assert.equal(JSON.parse(await fs.readFile(path.join(root,'画师','0001-tester0-1000','信息.json'),'utf8')).tags[0],'新名');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'画师','0002-tester1-1001','信息.json'),'utf8')).tags,[],'没带这个标签的画师一个字都不该改');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
/* 反过来守住最危险的一种走法：有画师的图片还只是 data: 内联没落盘时，
   'meta' 这条路会把「图片字段还是 data:」的旧文件写回去，等于把刚选的图丢掉。
   所以它必须自己退回完整路径——这条断言就是这个保险丝。 */
test('还有图片没落盘时，标了 meta 也必须退回完整路径把图写下来',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'artist-meta-inline-')),counters={dir:0,file:0,write:0,remove:0};
  const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  try{
    const library=sampleLibrary(2),dir=new NodeDir(root,counters);
    await store.write(dir,library);
    const withInline=structuredClone(library);withInline.tags=['新名'];
    withInline.artists[0].tags=['新名'];withInline.artists[0].works[0].thumb=pixel;
    const before={...counters};
    const saved=await store.write(dir,withInline,'meta');
    assert.ok(saved.artists[0].works[0].thumb.startsWith('缩略图/'),'内联图片必须落盘，不能被 meta 快路径跳过');
    assert.ok(counters.write-before.write>=2,'至少要写那张图和 信息.json');
    const onDisk=JSON.parse(await fs.readFile(path.join(root,'画师',withInline.artists[0].uid,'信息.json'),'utf8'));
    assert.equal(onDisk.works[0].thumb,saved.artists[0].works[0].thumb,'落盘的 信息.json 必须指向刚落下的图片');
    assert.deepEqual((await fs.readdir(path.join(root,'画师',withInline.artists[0].uid,'缩略图'))).length,1,'缩略图目录里正好一张图');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
/* 落盘改成并发池之后最容易踩的一个坑：完成的先后顺序不是原顺序。
   画师顺序就是索引顺序，一旦按完成顺序拼结果，磁盘上的 画师库.json 就会乱序。 */
test('并发落盘之后画师顺序仍与原顺序一致',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'artist-order-')),counters={dir:0,file:0,write:0,remove:0};
  try{
    const library=sampleLibrary(60),dir=new NodeDir(root,counters);
    const saved=await store.write(dir,library);
    assert.deepEqual(saved.artists.map(a=>a.uid),library.artists.map(a=>a.uid),'返回的画师顺序必须与传入一致');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'画师库.json'),'utf8')).artists,library.artists.map(a=>a.uid),'磁盘上的索引顺序必须与传入一致');
    assert.deepEqual((await store.read(dir)).artists.map(a=>a.uid),library.artists.map(a=>a.uid),'读回来还是同一个顺序');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
/* 待办 1.6.1 点名的另一半：`order` 不进指纹之后，「新增 / 删除 / 拖拽排序画师」
   都不该再重写后面那几百个 信息.json。删除已有用例覆盖，这里守住「只换顺序」这一种：
   顺序信息本来就存在 画师库.json 的 uid 列表里，画师文件里的 order 只是顺手记一笔。 */
test('只调整画师顺序时不重写任何 信息.json，只提交索引',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'artist-reorder-')),counters={dir:0,file:0,write:0,remove:0};
  try{
    const library=sampleLibrary(120),dir=new NodeDir(root,counters);
    await store.write(dir,library);
    /* 与 app.js 的拖拽排序一样：换位置、再重排序号。 */
    const reordered={...library,artists:library.artists.slice().reverse().map((artist,index)=>({...artist,order:index+1}))};
    const before={...counters};
    const saved=await store.write(dir,reordered);
    assert.equal(counters.write-before.write,1,'只换顺序时只该写一次索引，实际写了 '+(counters.write-before.write)+' 个文件');
    assert.ok(counters.dir-before.dir<=4,'不该逐位打开画师目录，实际查了 '+(counters.dir-before.dir)+' 次');
    assert.deepEqual(saved.artists.map(a=>a.uid),reordered.artists.map(a=>a.uid));
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'画师库.json'),'utf8')).artists,reordered.artists.map(a=>a.uid));
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
/* 索引随人数线性变大（1200 位时写一次约 89 ms），而有些保存连它一起没变。
   这时候不该再写一遍：内容一样，写下去只是白等。 */
test('索引内容没变时不重写 画师库.json',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'artist-index-')),counters={dir:0,file:0,write:0,remove:0};
  try{
    const library=sampleLibrary(30),dir=new NodeDir(root,counters);
    await store.write(dir,library);
    const indexFile=path.join(root,'画师库.json');
    /* 只改一位画师的标签：索引里没有标签信息，所以索引内容一个字都不该变。 */
    const tagged=structuredClone(library);
    tagged.artists[0].tags=['新标签'];
    let before={...counters};
    await store.write(dir,tagged,'meta');
    assert.equal(counters.write-before.write,1,'只该写那一位画师的 信息.json，索引不该重写');
    /* 反过来：索引真变了就必须写。 */
    const settings=structuredClone(tagged);settings.saveLargeImages=true;
    before={...counters};
    await store.write(dir,settings);
    assert.equal(counters.write-before.write,1,'设置变了要重写索引');
    assert.equal(JSON.parse(await fs.readFile(indexFile,'utf8')).saveLargeImages,true);
  }finally{await fs.rm(root,{recursive:true,force:true});}
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


test('回归：同路径测试图替换后清缓存并刷新已显示图片',async()=>{
 const observers=[],window={},revoked=[];let bytes='old',reads=0;
 class IO{constructor(fn){this.fn=fn;observers.push(this);}observe(){}unobserve(){}}
 const context={window,ImageResources:{ByteCache,Queue},IntersectionObserver:IO,AbortController,DOMException,Date,Map,URL:{createObjectURL:()=> 'blob:'+reads,revokeObjectURL:url=>revoked.push(url)},FolderStore:{imageOf:store.imageOf,readImage:async()=>{reads++;return new Blob([bytes]);}}};
 vm.runInNewContext(await fs.readFile('app/image-loader.js','utf8'),context);
 const api=window.ArtistImages,work={thumb:'缩略图/a-测试风格1.jpeg'},uid='0001-a-1',img={classList:{add(){},remove(){}},removeAttribute(){this.src=undefined;}};
 api.setFolder({});api.bind(img,uid,work,'card');observers[0].fn([{target:img,isIntersecting:true}]);await new Promise(r=>setImmediate(r));
 assert.equal(img.src,'blob:1');bytes='replacement';api.invalidate?.(uid,work.thumb);await new Promise(r=>setImmediate(r));
 assert.equal(await(await api.fetch(uid,work,'thumb')).text(),'replacement');assert.equal(img.src,'blob:2');assert.ok(revoked.includes('blob:1'));
});

test('长列表首次渲染的动画测量局限在附近占位，不扫描两千个离屏节点',async()=>{
 const kit=stage();let measured=0;const rect=kit.Element.prototype.getBoundingClientRect;kit.Element.prototype.getBoundingClientRect=function(){measured++;return rect.call(this);};
 vm.runInNewContext(await fs.readFile('app/virtual-gallery.js','utf8'),kit.context);
 kit.window.ArtistGallery.render(kit.gallery,Array.from({length:2000},(_,i)=>({uid:String(i)})),()=>new kit.Element());
 assert.ok(measured<30,'测量 '+measured+' 次，必须与屏幕附近节点数量有关');
});
test('卡片内容变化重画前释放原图片绑定，避免脱离 DOM 的图片留在缓存管理器里',async()=>{
 const kit=stage();vm.runInNewContext(await fs.readFile('app/virtual-gallery.js','utf8'),kit.context);
 kit.window.ArtistGallery.render(kit.gallery,[{uid:'a',value:1}],()=>new kit.Element());mountAll(kit.observers,kit.gallery);kit.disposed.length=0;
 kit.window.ArtistGallery.render(kit.gallery,[{uid:'a',value:2}],()=>new kit.Element());
 assert.deepEqual(kit.disposed,['card:a']);
 kit.window.ArtistGallery.render(kit.gallery,[{uid:'a',value:2}],()=>new kit.Element());assert.equal(kit.disposed.length,1,'未变卡片不释放或重新加载');
});


test('编辑卡片收起但顺序不变时，下方卡片也从原位置平滑移动',async()=>{
 const kit=stage(),{gallery,observers,window}=kit;
 vm.runInNewContext(await fs.readFile('app/virtual-gallery.js','utf8'),kit.context);
 const rows=[{uid:'a',editing:true},{uid:'b'}];
 const make=artist=>{const slot=gallery.children.find(node=>node.dataset.uid===artist.uid);if(slot)slot.cardHeight=artist.editing?700:320;return new kit.Element();};
 window.ArtistGallery.render(gallery,rows,make);mountAll(observers,gallery);
 const sibling=gallery.children[1],card=sibling.children[0];
 window.ArtistGallery.render(gallery,[{uid:'a',editing:false},rows[1]],make);
 assert.equal(sibling.children[0],card,'相邻卡片保持 DOM 和图片绑定');
 assert.equal(sibling.animations.length,1,'同顺序下高度改变也要移动');
 assert.equal(sibling.animations[0].frames[0].transform,'translateY(380px)');
 clearAnimations(gallery);window.ArtistGallery.render(gallery,[{uid:'a',editing:false},rows[1]],make);
 assert.equal(sibling.animations.length,0,'落盘后的重复渲染不重新播放移动动画');
});


test('新增或删除画师只增删对应占位，复用观察器和其余节点',async()=>{
 const kit=stage(),{gallery,observers,window}=kit;vm.runInNewContext(await fs.readFile('app/virtual-gallery.js','utf8'),kit.context);
 const rows=[{uid:'a'},{uid:'b'}];window.ArtistGallery.render(gallery,rows,()=>new kit.Element());mountAll(observers,gallery);
 const kept=[...gallery.children];let detached=0;for(const slot of kept){const original=slot.remove;slot.remove=function(){detached++;original.call(this);};}
 window.ArtistGallery.render(gallery,[...rows,{uid:'c'}],()=>new kit.Element());
 assert.equal(detached,0,'追加时不能从父容器移走已有节点');assert.equal(observers.length,1,'不能给全部占位重建观察器');
 window.ArtistGallery.render(gallery,rows,()=>new kit.Element());assert.equal(detached,0);assert.deepEqual(gallery.children,kept);
 // 已经移除的占位收到旧观察事件也不能挂载成另一位画师。
 const stale=new kit.Element();stale.dataset={uid:'c',index:0};observers[0].fn([{target:stale,isIntersecting:true}]);
 assert.equal(window.ArtistGallery.visible().length,2);
 window.ArtistGallery.clear();assert.equal(gallery.children.length,0,'切换资料库清理原有占位');
});

test('局部卡片更新成功时不销毁整张卡的图片组',async()=>{
 const kit=stage(),{gallery,observers,window}=kit;vm.runInNewContext(await fs.readFile('app/virtual-gallery.js','utf8'),kit.context);
 let patches=0;const patch=(node,artist)=>{patches++;node.value=artist.value;return true;};
 window.ArtistGallery.render(gallery,[{uid:'a',value:1}],()=>new kit.Element(),null,patch);mountAll(observers,gallery);
 const node=gallery.children[0].children[0];kit.disposed.length=0;
 window.ArtistGallery.render(gallery,[{uid:'a',value:2}],()=>{throw Error('不应整卡重建');},null,patch);
 assert.equal(patches,1);assert.equal(node.value,2);assert.equal(gallery.children[0].children[0],node);assert.deepEqual(kit.disposed,[]);
});


for(const loaded of [false,true])test('临时预览写盘后沿用图片与缓存：'+(loaded?'已经显示':'仍在加载'),async()=>{
 const observers=[],revoked=[];let reads=0,created=0;const window={};
 class IO{constructor(fn){this.fn=fn;observers.push(this);}observe(){}unobserve(){}}
 const context={window,ImageResources:{ByteCache,Queue},IntersectionObserver:IO,AbortController,DOMException,Date,Map,
  URL:{createObjectURL:()=>`blob:${++created}`,revokeObjectURL:value=>revoked.push(value)},
  FolderStore:{imageOf:store.imageOf,blobOf:store.blobOf,readImage:async()=>{reads++;return new Blob(['replacement']);}}};
 vm.runInNewContext(await fs.readFile('app/image-loader.js','utf8'),context);
 const api=window.ArtistImages,uid='0001-a-manual',before={id:'1',thumb:'data:image/png;base64,AQID'},after={id:'1',thumb:'缩略图/a.png'};
 const img={classList:{add(){},remove(){}},removeAttribute(){this.src=undefined;}};api.setFolder({});api.bind(img,uid,before,'card:'+uid);
 observers[0].fn([{target:img,isIntersecting:true}]);if(loaded)await new Promise(r=>setImmediate(r));
 assert.equal(api.adoptPersisted(img,after),true);
 await new Promise(r=>setImmediate(r));assert.equal(img.src,'blob:1');assert.equal(created,1);assert.deepEqual(revoked,[]);
 assert.equal((await api.fetch(uid,after,'thumb')).size,3);assert.equal(reads,0,'刚刚保存的同一份图片不再读盘解码');
 api.invalidate(uid,after.thumb);await new Promise(r=>setImmediate(r));
 assert.equal(reads,1,'之后真的覆盖同路径图片仍必须失效缓存');assert.equal(img.src,'blob:2');assert.ok(revoked.includes('blob:1'));
});
