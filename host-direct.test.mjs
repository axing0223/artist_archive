import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
globalThis.chrome={runtime:{getManifest:()=>({version:'0.5.0'})}};
const host=require('./app/host-direct.js');
const {imageUrl,apiUrl,postId,generateUrl,subscriptionUrl,bearer}=host.rules;
const png=Uint8Array.from([137,80,78,71,13,10,26,10]);
const okResponse=(body,{type='application/json',status=200}={})=>({ok:status>=200&&status<300,status,headers:{get:()=>type},blob:async()=>new Blob([body instanceof Uint8Array?body:JSON.stringify(body)],{type}),json:async()=>typeof body==='string'?JSON.parse(body):body,text:async()=>typeof body==='string'?body:JSON.stringify(body)});

test('直连实现只认写死的域名与路径，和后台那套规则一致',()=>{
  assert.equal(imageUrl('https://cdn.donmai.us/360x360/a.jpg'),'https://cdn.donmai.us/360x360/a.jpg');
  for(const bad of ['https://evil.example/a.jpg','http://cdn.donmai.us/a.jpg','https://cdn.donmai.us.evil.example/a.jpg','https://user:pass@cdn.donmai.us/a.jpg','https://cdn.donmai.us:444/a.jpg'])assert.throws(()=>imageUrl(bad),/图片地址/,'应拒绝：'+bad);
  assert.equal(apiUrl('https://danbooru.donmai.us/posts.json?tags=a'),'https://danbooru.donmai.us/posts.json?tags=a');
  for(const bad of ['https://evil.example/posts.json','https://danbooru.donmai.us/posts','https://danbooru.donmai.us.evil.example/posts.json'])assert.throws(()=>apiUrl(bad),/接口地址/,'应拒绝：'+bad);
  assert.equal(postId('12036303'),'https://danbooru.donmai.us/posts/12036303.json');
  assert.equal(postId('https://danbooru.donmai.us/posts/12036303'),'https://danbooru.donmai.us/posts/12036303.json');
  assert.throws(()=>postId('0'));assert.throws(()=>postId('https://evil.example/posts/1'));
  assert.equal(generateUrl('https://image.novelai.net/ai/generate-image'),'https://image.novelai.net/ai/generate-image');
  assert.equal(generateUrl('https://image.novelai.net/ai/generate-image?x=1#y'),'https://image.novelai.net/ai/generate-image','查询串与片段要丢掉');
  for(const bad of ['https://evil.example/ai/generate-image','https://image.novelai.net/user/data','http://image.novelai.net/ai/generate-image'])assert.throws(()=>generateUrl(bad),/生图地址/,'应拒绝：'+bad);
  assert.equal(subscriptionUrl('https://api.novelai.net/user/subscription'),'https://api.novelai.net/user/subscription');
  assert.equal(subscriptionUrl('https://image.novelai.net/user/subscription'),'https://image.novelai.net/user/subscription');
  for(const bad of ['https://api.novelai.net/user/data','https://evil.example/user/subscription','https://api.novelai.net:444/user/subscription'])assert.throws(()=>subscriptionUrl(bad),/额度地址/,'应拒绝：'+bad);
  assert.equal(bearer('pst-abcdefghijklmnop'),'pst-abcdefghijklmnop');
  for(const bad of ['','short','has space',123])assert.throws(()=>bearer(bad),/token/,'应拒绝：'+String(bad));
});
test('直连取图：带 Cookie 请求，只接受真图片；429 要如实报错',async()=>{
  const seen=[];
  const fetcher=async(url,init)=>{seen.push({url,init});return okResponse(png,{type:'image/png'});};
  const original=globalThis.fetch;globalThis.fetch=fetcher;
  try{
    const blob=await host.image('https://cdn.donmai.us/360x360/a.jpg');
    assert.equal(blob.type,'image/png');
    assert.equal(seen[0].init.credentials,'include','要带登录态');
    assert.equal(seen[0].init.redirect,'error');
    globalThis.fetch=async()=>({...okResponse('no',{type:'text/html'}),ok:true,status:200,headers:{get:()=>'text/html'}});
    await assert.rejects(()=>host.image('https://cdn.donmai.us/360x360/a.jpg'),/不是图片/);
    globalThis.fetch=async()=>({...okResponse('slow down',{type:'text/plain',status:429})});
    await assert.rejects(()=>host.image('https://cdn.donmai.us/360x360/a.jpg'),/频繁/);
  }finally{globalThis.fetch=original;}
});
test('直连取原图地址：优先原图，回退预览，字段全空就如实报错',async()=>{
  const original=globalThis.fetch;
  const withPost=body=>{globalThis.fetch=async(url,init)=>{assert.match(url,/^https:\/\/danbooru\.donmai\.us\/posts\/\d+\.json$/);assert.equal(init.credentials,'include');return okResponse(body);};};
  try{
    withPost({preview_file_url:'https://cdn.donmai.us/360x360/a.jpg'});
    assert.equal(await host.resolve('12036303'),'https://cdn.donmai.us/360x360/a.jpg');
    withPost({file_url:'https://cdn.donmai.us/original/full.jpg',preview_file_url:'https://cdn.donmai.us/360x360/a.jpg'});
    assert.equal(await host.resolve('12036303'),'https://cdn.donmai.us/original/full.jpg','有原图就优先原图');
    withPost({media_asset:{variants:[{type:'180x180',url:'https://cdn.donmai.us/180x180/a.jpg'},{type:'original',url:'https://cdn.donmai.us/original/v.jpg'}]}});
    assert.equal(await host.resolve('12036303'),'https://cdn.donmai.us/original/v.jpg');
    withPost({});
    await assert.rejects(()=>host.resolve('12036303'),/没有可用的图片地址/);
    withPost({file_url:'https://evil.example/a.jpg'});
    await assert.rejects(()=>host.resolve('12036303'),/图片地址/,'别的域名不能放行');
  }finally{globalThis.fetch=original;}
});
test('直连接口：状态码与正文原样带回，不抛异常',async()=>{
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async()=>okResponse([{id:1}],{status:200});
    const good=await host.api('https://danbooru.donmai.us/posts.json?limit=1');
    assert.equal(good.ok,true);assert.equal(good.status,200);
    assert.deepEqual(await good.json(),[{id:1}]);
    globalThis.fetch=async()=>okResponse({message:'nope'},{status:404});
    const missing=await host.api('https://danbooru.donmai.us/posts.json?limit=1');
    assert.equal(missing.ok,false);assert.equal(missing.status,404);
    assert.deepEqual(await missing.json(),{message:'nope'});
  }finally{globalThis.fetch=original;}
});
test('直连生图：POST 带 Authorization，返回 zip；401/402 把服务器原话带出来',async()=>{
  const original=globalThis.fetch;let seen=null;
  try{
    globalThis.fetch=async(url,init)=>{seen={url,init};return okResponse(png,{type:'application/zip'});};
    const blob=await host.generate('{"action":"generate"}','pst-abcdefghijklmnop');
    assert.equal(seen.url,'https://image.novelai.net/ai/generate-image');
    assert.equal(seen.init.method,'POST');
    assert.equal(seen.init.headers.authorization,'Bearer pst-abcdefghijklmnop');
    assert.equal(seen.init.credentials,'omit','不要把别的站点的 Cookie 带去 NovelAI');
    assert.equal(seen.init.body,'{"action":"generate"}');
    assert.equal(blob.type,'application/zip');
    globalThis.fetch=async()=>okResponse({message:'Invalid token'},{status:401});
    await assert.rejects(()=>host.generate('{}','pst-abcdefghijklmnop'),/token 被拒绝.*Invalid token/);
    globalThis.fetch=async()=>okResponse({message:'Not enough Anlas'},{status:402});
    await assert.rejects(()=>host.generate('{}','pst-abcdefghijklmnop'),/Anlas 不足.*Not enough Anlas/);
    await assert.rejects(()=>host.generate('','pst-abcdefghijklmnop'),/参数/);
  }finally{globalThis.fetch=original;}
});
test('直连额度：GET 带 token，返回原样 JSON',async()=>{
  const original=globalThis.fetch;let seen=null;
  try{
    globalThis.fetch=async(url,init)=>{seen={url,init};return okResponse({tier:3,usage:{percent:42}});};
    const payload=await host.subscription('https://api.novelai.net/user/subscription','pst-abcdefghijklmnop');
    assert.equal(seen.init.headers.authorization,'Bearer pst-abcdefghijklmnop');
    assert.equal(seen.init.credentials,'omit');
    assert.equal(payload.tier,3);assert.equal(payload.usage.percent,42);
    globalThis.fetch=async()=>okResponse('{}',{status:401});
    await assert.rejects(()=>host.subscription('https://api.novelai.net/user/subscription','pst-abcdefghijklmnop'),/token 被拒绝/);
  }finally{globalThis.fetch=original;}
});
test('直连实现顶替桥：在 chrome-extension:// 里 ArtistExtension 就是它，file:// 才走消息通道',async()=>{
  const code=await fs.readFile('app/extension-bridge.js','utf8'),direct=await fs.readFile('app/host-direct.js','utf8');
  const manifest=JSON.parse(await fs.readFile('图片取图扩展/manifest.json','utf8'));
  const load=protocol=>{
    const listeners=[];
    /* 浏览器里 window 就是 globalThis，两个脚本才会看到同一个对象；沙箱也得照这个来。 */
    const sandbox={location:{protocol},crypto:{randomUUID:()=>'x'},setTimeout,clearTimeout,DOMException,URL,fetch:async()=>{},console,
      chrome:{runtime:{getManifest:()=>({version:manifest.version})}},
      addEventListener:(type,fn)=>listeners.push(fn),postMessage:()=>{}};
    sandbox.window=sandbox;sandbox.globalThis=sandbox;
    vm.runInNewContext(direct,sandbox);
    vm.runInNewContext(code,sandbox);
    return {win:sandbox,listeners};
  };
  const extensionPage=load('chrome-extension:');
  assert.equal(extensionPage.win.ArtistExtension,extensionPage.win.ArtistHostDirect,'扩展页直接用直连实现');
  assert.equal(extensionPage.win.ArtistExtension.direct,true);
  assert.equal(extensionPage.win.ArtistExtension.connected,true,'直连模式永远算已连接');
  assert.equal(extensionPage.win.ArtistExtension.version,manifest.version,'报的必须是扩展自己的版本');
  assert.equal(extensionPage.listeners.length,0,'直连模式不该再挂消息监听');
  for(const key of ['check','resolve','image','api','generate','subscription'])assert.equal(typeof extensionPage.win.ArtistExtension[key],'function',key+' 必须在');
  assert.equal(extensionPage.win.ArtistExtension.canFetchApi,true);
  assert.equal(extensionPage.win.ArtistExtension.canGenerate,true);
  assert.equal(extensionPage.win.ArtistExtension.canAccount,true);
  const filePage=load('file:');
  assert.equal(filePage.win.ArtistExtension.direct,undefined,'file:// 走原来的桥');
  assert.equal(filePage.listeners.length,1,'file:// 仍然靠消息通道');
});
