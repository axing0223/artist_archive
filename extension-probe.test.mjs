import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {fetchImage,resolvePost,imageUrl,postUrl,apiUrl,fetchApi} from './图片取图扩展/probe.mjs';
const url='https://cdn.donmai.us/180x180/79/ac/79ac317b7f7c085b9ac65f02752f9211.jpg';
test('扩展只请求指定网站，本地连接脚本仅匹配文件页面',async()=>{
  const m=JSON.parse(await fs.readFile('图片取图扩展/manifest.json','utf8'));
  assert.equal(m.manifest_version,3);assert.deepEqual(m.host_permissions,['https://danbooru.donmai.us/*','https://cdn.donmai.us/*']);assert.deepEqual(m.content_scripts[0].matches,['file:///*']);assert.equal(m.content_scripts[0].all_frames,false);
  for(const s of ['https://evil.example/a.jpg','http://cdn.donmai.us/a.jpg','https://cdn.donmai.us.evil.example/a.jpg','https://user:pass@cdn.donmai.us/a.jpg','https://cdn.donmai.us:444/a.jpg'])assert.throws(()=>imageUrl(s));
  assert.equal(postUrl('12036303'),'https://danbooru.donmai.us/posts/12036303.json');assert.throws(()=>postUrl('0'));assert.throws(()=>postUrl('https://evil.example/posts/12036303'));
});
test('成功请求返回图片字节，并记录状态而非 Cookie',async()=>{
  const records=[],bytes=Uint8Array.from([255,216,255,217]);
  const blob=await fetchImage(url,{report:x=>records.push(x),fetcher:async (target,options)=>{assert.equal(target,url);assert.equal(options.credentials,'include');assert.equal(options.redirect,'error');return new Response(bytes,{headers:{'Content-Type':'image/jpeg'}});}});
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),bytes);assert.equal(blob.type,'image/jpeg');assert.equal(records[0].status,200);assert.equal(records[0].cookie,undefined);
});
test('403 验证、200 HTML、空图片和超大图片均不得通过',async()=>{
  await assert.rejects(fetchImage(url,{fetcher:async()=>new Response('challenge',{status:403,headers:{'cf-mitigated':'challenge','content-type':'text/html'}})}),/Cloudflare/);
  await assert.rejects(fetchImage(url,{fetcher:async()=>new Response('<html>blocked</html>',{headers:{'content-type':'text/html'}})}),/不是图片/);
  await assert.rejects(fetchImage(url,{fetcher:async()=>new Response('',{headers:{'content-type':'image/jpeg'}})}),/空文件/);
  await assert.rejects(fetchImage(url,{fetcher:async()=>new Response('x',{headers:{'content-type':'image/jpeg','content-length':String(51*1024*1024)}})}),/大小限制/);
});
test('作品接口优先取原图地址，回退预览，拒绝非图片域名和 HTML',async()=>{
  assert.equal(await resolvePost('12036303',{fetcher:async()=>Response.json({preview_file_url:url})}),url,'只有预览时回退预览');
  assert.equal(await resolvePost('12036303',{fetcher:async()=>Response.json({preview_file_url:url,file_url:'https://cdn.donmai.us/original/full.jpg'})}),'https://cdn.donmai.us/original/full.jpg','有原图时优先原图');
  assert.equal(await resolvePost('12036303',{fetcher:async()=>Response.json({media_asset:{variants:[{type:'180x180',url:url},{type:'original',url:'https://cdn.donmai.us/original/v.jpg'}]}})}),'https://cdn.donmai.us/original/v.jpg','从 variants 里取原图');
  assert.equal(await resolvePost('12036303',{fetcher:async()=>Response.json({large_file_url:'https://cdn.donmai.us/sample/l.jpg'})}),'https://cdn.donmai.us/sample/l.jpg','没有再回退到 large');
  await assert.rejects(resolvePost('12036303',{fetcher:async()=>Response.json({file_url:'https://evil.example/a.jpg'})}),/图片地址/);
  await assert.rejects(resolvePost('12036303',{fetcher:async()=>Response.json({})}),/未提供图片地址/);
  await assert.rejects(resolvePost('12036303',{fetcher:async()=>new Response('challenge',{headers:{'content-type':'text/html'}})}),/JSON/);
});
test('接口地址只放行 danbooru 的 .json，且必须带登录态取回',async()=>{
  assert.equal(apiUrl('https://danbooru.donmai.us/posts.json?tags=a&limit=3'),'https://danbooru.donmai.us/posts.json?tags=a&limit=3');
  for(const bad of ['https://evil.example/posts.json','http://danbooru.donmai.us/posts.json','https://danbooru.donmai.us.evil.example/posts.json','https://user:pass@danbooru.donmai.us/posts.json','https://danbooru.donmai.us:444/posts.json','https://danbooru.donmai.us/posts'])assert.throws(()=>apiUrl(bad),/接口地址/,'应拒绝：'+bad);
  let seen=null;
  const result=await fetchApi('https://danbooru.donmai.us/posts.json?tags=a',{fetcher:async(url,options)=>{seen={url,options};return new Response(JSON.stringify([{id:1,file_url:'https://cdn.donmai.us/original/a.jpg'}]),{headers:{'content-type':'application/json'}});}});
  assert.equal(seen.options.credentials,'include','必须带 Cookie，否则图片地址字段会被站点隐藏');
  assert.equal(seen.options.redirect,'error');
  assert.equal(result.status,200);
  assert.equal(result.json[0].file_url,'https://cdn.donmai.us/original/a.jpg','带登录态才有图片地址');
  await assert.rejects(fetchApi('https://danbooru.donmai.us/posts.json',{fetcher:async()=>new Response('<html>challenge</html>',{headers:{'content-type':'text/html'}})}),/JSON/,'被验证页拦截要如实报错');
  await assert.rejects(fetchApi('https://danbooru.donmai.us/posts.json',{fetcher:async()=>new Response('slow down',{status:429,headers:{'content-type':'text/html'}})}),/频繁/);
  assert.equal((await fetchApi('https://danbooru.donmai.us/posts.json',{fetcher:async()=>new Response('',{status:404,headers:{'content-type':'application/json'}})})).status,404,'空响应也要把状态码带回去');
});
test('本地连接脚本按 meta 标记启用：工具页与画师库页都能连上，没标记的本地页面不能',async()=>{
  const code=await fs.readFile('图片取图扩展/content.js','utf8');
  const run=(pathname,hasMeta)=>{
    const listeners=[],win={addEventListener:(type,fn)=>listeners.push(fn),postMessage:()=>{}};win.top=win;
    vm.runInNewContext(code,{window:win,location:{protocol:'file:',pathname},document:{querySelector:()=>hasMeta},
      chrome:{runtime:{getManifest:()=>({version:'0.3.1'}),sendMessage:async()=>({ok:true})}}});
    return listeners.length;
  };
  assert.equal(run('/F:/ai项目/画师分类/工具/回填作品.html',true),1,'回填工具页必须能建立桥接，否则整个流程无法取图');
  assert.equal(run('/F:/ai项目/画师分类/画师库.html',true),1,'画师库页面照旧可用');
  assert.equal(run('/F:/随便.html',true),1,'启用依据是 meta 标记，而不是写死的文件名');
  assert.equal(run('/F:/随便.html',false),0,'没有 meta 标记的本地页面不得建立桥接');
  for(const file of ['app/index.html','工具/回填作品.html'])
    assert.match(await fs.readFile(file,'utf8'),/<meta name="artist-library" content="v1">/,file+' 必须保留这个标记');
});
