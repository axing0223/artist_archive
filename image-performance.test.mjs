import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {allowedSender} from './图片取图扩展/bridge-policy.mjs';
const require=createRequire(import.meta.url),{ByteCache,Queue}=require('./app/image-cache.js');
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
  const context={window,ImageResources:{ByteCache,Queue},IntersectionObserver:IO,AbortController,DOMException,Date,Map,fetch,URL:{createObjectURL:()=>`blob:${reads}`,revokeObjectURL:url=>revoked.push(url)},FolderStore:{readImage:async()=>{reads++;return new Blob(['bytes']);}},ArtistExtension:{image:()=>{throw Error('本地图片不应联网');}}};
  vm.runInNewContext(await fs.readFile('app/image-loader.js','utf8'),context);const api=window.ArtistImages,img={classList:{add(){},remove(){}},removeAttribute(){this.src=undefined;}};api.setFolder({});api.bind(img,'a',{file:'预览图/a.png'},'card:a');observers[0].fn([{target:img,isIntersecting:true}]);await new Promise(r=>setImmediate(r));assert.equal(reads,1);assert.equal(img.src,'blob:1');observers[0].fn([{target:img,isIntersecting:false}]);assert.equal(revoked.length,1);assert.equal(img.src,undefined);
  observers[0].fn([{target:img,isIntersecting:true}]);await new Promise(r=>setImmediate(r));assert.equal(reads,1);api.dispose('card:a');assert.equal(revoked.length,2);assert.equal(api.stats().bound,0);
});
test('连接通道只接受本地画师库顶层页面，不接受网站或其他扩展',()=>{
  const s={id:'this-extension',tab:{id:1},frameId:0,url:'file:///F:/test/'+encodeURIComponent('画师库.html')};assert.equal(allowedSender(s,'this-extension'),true);
  for(const override of [{frameId:1},{id:'other'},{url:'https://evil.example/画师库.html'},{url:'file:///F:/other.html'}])assert.equal(allowedSender({...s,...override},'this-extension'),false);
});
test('HTML 与隔离脚本端到端消息往返，返回可用 Blob 并传播服务器失败',async()=>{
  const listeners=[];const win={addEventListener:(type,fn)=>listeners.push(fn),postMessage:data=>queueMicrotask(()=>listeners.forEach(fn=>fn({source:win,data})))};win.top=win;let fail=false;
  const context={window:win,location:{protocol:'file:',pathname:'/F:/画师库.html'},document:{querySelector:()=>true},crypto,DOMException,fetch,setTimeout,clearTimeout,chrome:{runtime:{getManifest:()=>({version:'0.2.0'}),sendMessage:async m=>m.type==='ping'?{ok:true,version:'0.2.0'}:fail?{ok:false,error:'服务器拒绝请求：HTTP 403'}:{ok:true,data:'data:image/jpeg;base64,/9j/2Q=='}}}};
  vm.runInNewContext(await fs.readFile('app/extension-bridge.js','utf8'),context);vm.runInNewContext(await fs.readFile('图片取图扩展/content.js','utf8'),context);assert.equal(await win.ArtistExtension.check(),'0.2.0');const blob=await win.ArtistExtension.image('https://cdn.donmai.us/test.jpg');assert.equal(blob.type,'image/jpeg');assert.equal(blob.size,4);fail=true;await assert.rejects(win.ArtistExtension.image('https://cdn.donmai.us/test.jpg'),/403/);
});
