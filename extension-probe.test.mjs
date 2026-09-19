import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {fetchImage,resolvePost,imageUrl,postUrl,apiUrl,fetchApi,generateImage,novelaiUrl,bearerToken,subscriptionUrl,fetchSubscription} from './图片取图扩展/probe.mjs';
const url='https://cdn.donmai.us/180x180/79/ac/79ac317b7f7c085b9ac65f02752f9211.jpg';
test('扩展只请求指定网站，本地连接脚本仅匹配文件页面',async()=>{
  const m=JSON.parse(await fs.readFile('图片取图扩展/manifest.json','utf8'));
  assert.equal(m.manifest_version,3);assert.deepEqual(m.host_permissions,['https://danbooru.donmai.us/*','https://cdn.donmai.us/*','https://image.novelai.net/*','https://api.novelai.net/*']);assert.deepEqual(m.content_scripts[0].matches,['file:///*']);assert.equal(m.content_scripts[0].all_frames,false);
  assert.match(m.content_security_policy.extension_pages,/connect-src[^;]*https:\/\/image\.novelai\.net/,'后台要发得出去，CSP 里必须放行生图端点');
  assert.match(m.content_security_policy.extension_pages,/connect-src[^;]*https:\/\/api\.novelai\.net/,'查额度用的是 api 域名，也要放行');
  for(const s of ['https://evil.example/a.jpg','http://cdn.donmai.us/a.jpg','https://cdn.donmai.us.evil.example/a.jpg','https://user:pass@cdn.donmai.us/a.jpg','https://cdn.donmai.us:444/a.jpg'])assert.throws(()=>imageUrl(s));
  assert.equal(postUrl('12036303'),'https://danbooru.donmai.us/posts/12036303.json');assert.throws(()=>postUrl('0'));assert.throws(()=>postUrl('https://evil.example/posts/12036303'));
});
test('生图端点写死成 NovelAI 的文生图地址，别处一律拒绝',()=>{
  assert.equal(novelaiUrl('https://image.novelai.net/ai/generate-image'),'https://image.novelai.net/ai/generate-image');
  assert.equal(novelaiUrl('https://image.novelai.net/ai/generate-image?x=1#y'),'https://image.novelai.net/ai/generate-image','查询串与片段都要丢掉');
  for(const bad of ['https://evil.example/ai/generate-image','http://image.novelai.net/ai/generate-image','https://image.novelai.net.evil.example/ai/generate-image','https://user:pass@image.novelai.net/ai/generate-image','https://image.novelai.net:444/ai/generate-image','https://image.novelai.net/ai/generate-image/../user/data','https://api.novelai.net/user/data'])
    assert.throws(()=>novelaiUrl(bad),/生图地址/,'应拒绝：'+bad);
  assert.equal(bearerToken('pst-abcdefghijklmnop'),'pst-abcdefghijklmnop');
  for(const bad of ['','short','has space here','line\nbreak',123])assert.throws(()=>bearerToken(bad),/token/,'应拒绝：'+String(bad));
});
test('生图：POST 到 NovelAI，token 只走 Authorization 头，返回 zip',async()=>{
  const zip=Uint8Array.from([80,75,3,4,1,2,3]),seen={};
  const blob=await generateImage('https://image.novelai.net/ai/generate-image','{"action":"generate"}',{token:'pst-abcdefghijklmnop',
    fetcher:async(target,options)=>{seen.target=target;seen.options=options;return new Response(zip,{headers:{'content-type':'application/zip'}});}});
  assert.equal(seen.target,'https://image.novelai.net/ai/generate-image');
  assert.equal(seen.options.method,'POST');
  assert.equal(seen.options.body,'{"action":"generate"}');
  assert.equal(seen.options.headers.authorization,'Bearer pst-abcdefghijklmnop','token 只能放在请求头里');
  assert.equal(seen.options.credentials,'omit','不要把别的站点的 Cookie 带去 NovelAI');
  assert.equal(seen.options.redirect,'error');
  assert.equal(blob.type,'application/zip');
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),zip);
});
test('额度查询走白名单，只带 token 读订阅信息',async()=>{
  assert.equal(subscriptionUrl('https://image.novelai.net/user/subscription'),'https://image.novelai.net/user/subscription');
  assert.equal(subscriptionUrl('https://api.novelai.net/user/subscription'),'https://api.novelai.net/user/subscription');
  assert.equal(subscriptionUrl('https://api.novelai.net/user/subscription?x=1#y'),'https://api.novelai.net/user/subscription','查询串与片段都要丢掉');
  for(const bad of ['https://evil.example/user/subscription','http://api.novelai.net/user/subscription','https://api.novelai.net.evil.example/user/subscription','https://user:pass@api.novelai.net/user/subscription','https://api.novelai.net:444/user/subscription','https://api.novelai.net/user/data','https://image.novelai.net/user/subscription/../user/data'])
    assert.throws(()=>subscriptionUrl(bad),/额度地址/,'应拒绝：'+bad);
  let seen=null;
  const payload=await fetchSubscription('https://api.novelai.net/user/subscription',{token:'pst-abcdefghijklmnop',
    fetcher:async(target,options)=>{seen={target,options};return new Response(JSON.stringify({tier:3,usage:{percent:42}}),{headers:{'content-type':'application/json'}});}});
  assert.equal(seen.options.headers.authorization,'Bearer pst-abcdefghijklmnop','token 只能放在请求头里');
  assert.equal(seen.options.credentials,'omit');
  assert.equal(payload.tier,3);assert.equal(payload.usage.percent,42);
  const fail=(status,body,type='application/json')=>fetchSubscription('https://api.novelai.net/user/subscription',{token:'pst-abcdefghijklmnop',fetcher:async()=>new Response(body,{status,headers:{'content-type':type}})});
  await assert.rejects(fail(401,JSON.stringify({message:'Invalid token'})),/token 被拒绝/);
  await assert.rejects(fail(500,'boom','text/plain'),/HTTP 500/);
  await assert.rejects(fail(200,'<html>challenge</html>','text/html'),/没有返回 JSON/);
  await assert.rejects(fetchSubscription('https://api.novelai.net/user/subscription',{token:'bad token',fetcher:async()=>new Response('{}')}),/token/,'token 形状不对就别发出去');
});
test('右键菜单：选中文字 → 添加到画师库，交给页面上的「识别画师」',async()=>{
  const manifest=JSON.parse(await fs.readFile('图片取图扩展/manifest.json','utf8'));
  assert.deepEqual(manifest.permissions,['contextMenus','storage'],'右键菜单与会话交接各要一个权限，别多要');
  /* 把 import 行去掉后在沙箱里跑一遍后台脚本：菜单建了没、点了之后东西送到哪。 */
  const code=(await fs.readFile('图片取图扩展/background.js','utf8')).replace(/^import .*$/gm,'');
  const run=async({pageOpen=false}={})=>{
    const created=[],clicked=[],pushed=[],createdTabs=[],stored=new Map(),focused=[],iconClicks=[];
    const chrome={
      runtime:{
        id:'self',
        getURL:path=>'chrome-extension://self/'+path,
        getContexts:async()=>(pageOpen?[{tabId:7,windowId:3,documentUrl:'chrome-extension://self/app/index.html'}]:[]),
        sendMessage:async message=>{pushed.push(message);if(!pageOpen)throw Error('没有接收方');},
        onMessage:{addListener:fn=>clicked.push({listener:fn})},
        onInstalled:{addListener:fn=>created.push({installed:fn})},
        onStartup:{addListener:fn=>created.push({startup:fn})},
      },
      tabs:{create:async({url})=>{createdTabs.push(url);return {id:9,windowId:4};},update:async(id,info)=>focused.push([id,info])},
      windows:{update:async(id,info)=>focused.push([id,info])},
      action:{onClicked:{addListener:fn=>iconClicks.push(fn)}},
      contextMenus:{
        removeAll:cb=>{created.length=0;cb&&cb();},
        create:options=>clicked.push({menu:options}),
        onClicked:{addListener:fn=>clicked.push({onClick:fn})},
      },
      storage:{session:{get:async key=>{const value=stored.get(key);return value===undefined?{}:{[key]:value};},set:async obj=>{for(const [key,value] of Object.entries(obj))stored.set(key,value);},remove:async key=>{stored.delete(key);}}},
    };
    const sandbox={chrome,setTimeout,clearTimeout,console,URL,fetch:async()=>{throw Error('测试里不该联网');},AbortSignal,Blob,Response,TextDecoder,btoa};
    sandbox.globalThis=sandbox;
    vm.runInNewContext(code,sandbox);
    return {created,clicked,pushed,createdTabs,stored,focused,iconClicks};
  };
  const fresh=await run();
  const menu=fresh.clicked.find(item=>item.menu)?.menu;
  assert.ok(menu,'启动时要建右键菜单');
  assert.equal(menu.id,'artist-library-add');
  assert.equal(menu.title,'添加到画师库');
  assert.equal(menu.contexts.join(','),'selection','只在选中文字时出现');
  assert.equal(typeof fresh.clicked.find(item=>item.onClick)?.onClick,'function','要处理菜单点击');
  /* 页面没开着：菜单点击后存起来等页面来取 */
  const cold=await run({pageOpen:false});
  await cold.clicked.find(item=>item.onClick).onClick({menuItemId:'artist-library-add',selectionText:'  modare\n 105704 '});
  assert.deepEqual(cold.createdTabs,['chrome-extension://self/app/index.html'],'没有页面就打开画师库');
  assert.equal(cold.stored.get('pendingArtistText'),'modare 105704','空白折叠后存下来，等页面加载完来取');
  /* 页面开着：直接推给它，并且不再重复落盘 */
  const warm=await run({pageOpen:true});
  await warm.clicked.find(item=>item.onClick).onClick({menuItemId:'artist-library-add',selectionText:'modare'});
  assert.equal(warm.pushed.length,1,'页面开着就直接送过去');
  assert.equal(warm.pushed[0].type,'artist-library.add');
  assert.equal(warm.pushed[0].text,'modare');
  assert.equal(warm.stored.has('pendingArtistText'),false,'送成功了就不留在待办里');
  assert.equal(warm.focused.length,2,'把画师库那个标签页切到前面');
  assert.equal(warm.focused[0][0],7);assert.equal(warm.focused[0][1].active,true);
  assert.equal(warm.focused[1][0],3);assert.equal(warm.focused[1][1].focused,true);
  /* 页面加载完成后主动来取：取到的同时清掉，避免下次刷新又跑一遍 */
  const handoff=await run({pageOpen:false});
  await handoff.clicked.find(item=>item.onClick).onClick({menuItemId:'artist-library-add',selectionText:'atdan'});
  const ready=handoff.clicked.find(item=>item.listener)?.listener;
  const replies=[];
  const keep=ready({channel:'artist-library-page',type:'ready'},null,value=>replies.push(value));
  assert.equal(keep,true,'异步回复要返回 true');
  while(!replies.length)await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(replies.length,1);assert.equal(replies[0].text,'atdan');
  assert.equal(handoff.stored.has('pendingArtistText'),false,'交给页面后要清掉');
  /* 别的菜单项与我们无关 */
  const other=await run();
  await other.clicked.find(item=>item.onClick).onClick({menuItemId:'something-else',selectionText:'modare'});
  assert.deepEqual(other.createdTabs,[],'别人的菜单项不该开页面');
  assert.equal(other.stored.has('pendingArtistText'),false);
  /* 点扩展图标：没开着就开画师库，开着就切过去 */
  const icon=await run({pageOpen:false});
  await icon.iconClicks[0]();
  assert.deepEqual(icon.createdTabs,['chrome-extension://self/app/index.html']);
  const iconWarm=await run({pageOpen:true});
  await iconWarm.iconClicks[0]();
  assert.deepEqual(iconWarm.createdTabs,[],'已经开着就不再开新标签页');
  assert.equal(iconWarm.focused[0][0],7);
});
test('生图失败时带出服务器原话，且不把错误正文当成图片',async()=>{
  const fail=(status,body,type='application/json')=>generateImage('https://image.novelai.net/ai/generate-image','{}',{token:'pst-abcdefghijklmnop',fetcher:async()=>new Response(body,{status,headers:{'content-type':type}})});
  await assert.rejects(fail(401,JSON.stringify({message:'Invalid token'})),/token 被拒绝.*Invalid token/);
  await assert.rejects(fail(402,JSON.stringify({message:'Not enough Anlas'})),/Anlas 不足.*Not enough Anlas/);
  await assert.rejects(fail(429,'slow down','text/plain'),/稍后再试/);
  await assert.rejects(fail(500,'<html>oops</html>','text/html'),/HTTP 500/);
  await assert.rejects(fail(200,'{"ok":true}','application/json'),/拒绝了请求/,'200 但返回 JSON 说明没拿到图，不能当成成功');
  await assert.rejects(generateImage('https://image.novelai.net/ai/generate-image','',{token:'pst-abcdefghijklmnop',fetcher:async()=>new Response(Uint8Array.from([80,75,3,4]),{headers:{'content-type':'application/zip'}})}),/参数/);
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
