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
test('点扩展图标：没开着就打开画师库，开着就切到那个标签页',async()=>{
  const manifest=JSON.parse(await fs.readFile('图片取图扩展/manifest.json','utf8'));
  assert.deepEqual(manifest.permissions,['contextMenus','storage','scripting','activeTab'],'右键菜单、会话交接、漂浮提示各要各自那一个权限，别多要');
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
  assert.equal(typeof fresh.iconClicks[0],'function','要处理点图标');
  /* 点扩展图标：没开着就开画师库，开着就切过去 */
  const icon=await run({pageOpen:false});
  await icon.iconClicks[0]();
  assert.deepEqual(icon.createdTabs,['chrome-extension://self/app/index.html']);
  const iconWarm=await run({pageOpen:true});
  await iconWarm.iconClicks[0]();
  assert.deepEqual(iconWarm.createdTabs,[],'已经开着就不再开新标签页');
  assert.equal(iconWarm.focused[0][0],7);
});
test('右键菜单：静默建卡（后台标签页）→ 结果画在当前页面右上角 → 点提示回到画师库',async()=>{
  const manifest=JSON.parse(await fs.readFile('图片取图扩展/manifest.json','utf8'));
  assert.equal(manifest.permissions.includes('scripting'),true,'要在用户当前页面画漂浮提示');
  assert.equal(manifest.permissions.includes('activeTab'),true,'只在你主动用菜单的那一页临时取权限，不要全站权限');
  const code=(await fs.readFile('图片取图扩展/background.js','utf8')).replace(/^import .*$/gm,'');
  const run=async({pageOpen=false}={})=>{
    const messages=[],createdTabs=[],injected=[],sentToTabs=[],badges=[],stored=new Map();
    const chrome={
      runtime:{
        id:'self',
        getURL:path=>'chrome-extension://self/'+path,
        getContexts:async()=>(pageOpen?[{tabId:7,windowId:3,documentUrl:'chrome-extension://self/app/index.html'}]:[]),
        sendMessage:async message=>{messages.push(message);if(!pageOpen)throw Error('没有接收方');return null;},
        onMessage:{addListener:fn=>messages.push({listener:fn})},
        onInstalled:{addListener:()=>{}},onStartup:{addListener:()=>{}},
        getManifest:()=>({version:'0.5.0'}),
      },
      tabs:{create:async options=>{createdTabs.push(options);return {id:9,windowId:4};},update:async()=>{},sendMessage:async(id,message)=>{sentToTabs.push([id,message]);}},
      windows:{update:async()=>{}},
      action:{onClicked:{addListener:()=>{}},setBadgeText:async o=>badges.push(['text',o.text]),setBadgeBackgroundColor:async o=>badges.push(['color',o.color]),setTitle:async o=>badges.push(['title',o.title])},
      scripting:{executeScript:async o=>{injected.push(o);if(o.target.tabId===666)throw Error('这一页不允许注入');}},
      contextMenus:{removeAll:cb=>cb&&cb(),create:options=>messages.push({menu:options}),onClicked:{addListener:fn=>messages.push({onMenu:fn})}},
      storage:{session:{get:async key=>{const value=stored.get(key);return value===undefined?{}:{[key]:value};},set:async obj=>{for(const [key,value] of Object.entries(obj))stored.set(key,value);},remove:async key=>{stored.delete(key);}}},
    };
    const sandbox={chrome,setTimeout,clearTimeout,console,URL,fetch:async()=>{throw Error('测试里不该联网');},AbortSignal,Blob,Response,TextDecoder,btoa,
      /* 取图通道那条监听器要用它：给个「不是自己人」，让它安静让开。 */
      allowedSender:()=>false};
    sandbox.globalThis=sandbox;
    vm.runInNewContext(code,sandbox);
    const api={messages,createdTabs,injected,sentToTabs,badges,stored,
      menu:()=>messages.find(item=>item.onMenu).onMenu,
      /* 真正的 runtime 会把消息派发给所有监听器，替身也照做——后台注册了不止一个监听器。 */
      receive:(message,respond=()=>{})=>{let returned;for(const item of messages)if(item.listener){const value=item.listener(message,null,respond);if(value!==undefined)returned=value;}return returned;},
    };
    return api;
  };
  /* 等异步结果：有上限，条件永远不成立时报错而不是把测试挂死。 */
  const until=async(condition,label)=>{for(let i=0;i<400;i++){if(condition())return;await new Promise(resolve=>setTimeout(resolve,0));}throw Error('等待超时：'+label);};
  /* 页面没开着：开一个不抢焦点的后台标签页，把待办排进会话存储 */
  const cold=await run({pageOpen:false});
  await cold.menu()({menuItemId:'artist-library-add',selectionText:' modare '},{id:42});
  assert.equal(cold.createdTabs.length,1);
  assert.equal(cold.createdTabs[0].active,false,'静默：新开的标签页不能抢焦点');
  assert.match(cold.createdTabs[0].url,/app\/index\.html$/);
  const queued=cold.stored.get('pendingArtistActions');
  assert.equal(queued.length,1);
  assert.equal(queued[0].kind,'create');
  assert.equal(queued[0].text,'modare');
  assert.equal(queued[0].sourceTabId,42,'要记住你是在哪个页面点的右键');
  /* 页面来领待办：领完就清空，避免下次刷新又跑一遍 */
  const replies=[];
  cold.receive({channel:'artist-library-page',type:'ready'},value=>replies.push(value));
  await until(()=>replies.length,'页面领取待办后的回复');
  assert.equal(replies[0].actions.length,1);
  assert.equal(replies[0].actions[0].text,'modare');
  assert.equal(cold.stored.has('pendingArtistActions'),false);
  /* 页面建完卡回传：在来源标签页里注入漂浮提示 */
  cold.receive({channel:'artist-library-page',type:'created',result:{ok:true,uid:'0001-modare-105704',name:'modare',danbooruId:105704,works:3,sourceTabId:42}});
  await until(()=>cold.sentToTabs.length,'把漂浮提示送进来源标签页');
  assert.equal(cold.injected.length,1,'把提示脚本注入到你右键的那一页');
  assert.equal(cold.injected[0].files.join(','),'toast.js');
  assert.equal(cold.injected[0].target.tabId,42);
  assert.equal(cold.sentToTabs[0][1].type,'artist-library.toast');
  assert.equal(cold.sentToTabs[0][1].payload.ok,true);
  assert.equal(cold.sentToTabs[0][1].payload.danbooruId,105704);
  /* 页面已经开着：直接问它，不再开标签页，也不落盘 */
  const warm=await run({pageOpen:true});
  await warm.menu()({menuItemId:'artist-library-add',selectionText:'atdan'},{id:42});
  assert.deepEqual(warm.createdTabs,[],'已经开着就别再开');
  assert.equal(warm.messages.some(message=>message.type==='artist-library.create'&&message.text==='atdan'),true,'直接把活交给它');
  assert.equal(warm.stored.has('pendingArtistActions'),false);
  /* 菜单本身：只在选中文字时出现，点了别的菜单项不做事 */
  const menu=cold.messages.find(item=>item.menu)?.menu;
  assert.equal(menu.title,'添加到画师库');
  assert.equal(menu.contexts.join(','),'selection');
  const other=await run();
  await other.menu()({menuItemId:'something-else',selectionText:'modare'},{id:42});
  assert.deepEqual(other.createdTabs,[],'别人的菜单项不该开页面');
  assert.equal(other.stored.has('pendingArtistActions'),false);
  /* 注入不了（比如那种不允许脚本的页面）：退回角标，别让结果无声无息 */
  const blocked=await run({pageOpen:false});
  blocked.receive({channel:'artist-library-page',type:'created',result:{ok:false,reason:'站点上没找到这个画师',sourceTabId:666}});
  await until(()=>blocked.badges.length,'注入失败时退回角标');
  assert.equal(blocked.badges.some(item=>item[0]==='text'&&item[1]==='✗'),true,'失败要留个红角标');
  /* 点漂浮提示：切到画师库（没开着就开一个前台标签页）并让它定位到新卡片 */
  const click=await run({pageOpen:false});
  click.receive({type:'artist-library.toast-click',uid:'0001-modare-105704',text:'modare',ok:true});
  await until(()=>click.createdTabs.length,'点提示时打开画师库');
  assert.equal(click.createdTabs[0].active,true,'点提示就是要看它，这次要开在前台');
  const focusAction=click.stored.get('pendingArtistActions');
  await until(()=>click.stored.get('pendingArtistActions')?.length,'把定位待办排进会话存储');
  const queued2=click.stored.get('pendingArtistActions');
  assert.equal(queued2.length>=1,true,'定位待办要排上');
  assert.equal(queued2[queued2.length-1].kind,'focus');
  assert.equal(queued2[queued2.length-1].uid,'0001-modare-105704');
  const warmClick=await run({pageOpen:true});
  warmClick.receive({type:'artist-library.toast-click',uid:'0001-modare-105704',text:'modare',ok:true});
  await until(()=>warmClick.messages.some(message=>message.type==='artist-library.focus'),'页面开着时直接推定位消息');
  assert.equal(warmClick.messages.find(message=>message.type==='artist-library.focus').uid,'0001-modare-105704');
});
test('漂浮提示：画在右上角、点一下把结果交回后台',async()=>{
  const code=await fs.readFile('图片取图扩展/toast.js','utf8');
  const sent=[],listeners=[],removed=[],raf=[];
  /* 记录样式赋值顺序：这条测试就是为了守住「定位不能被 all:initial 抹掉」这个坑。 */
  const fakeStyle=()=>{const order=[],props={};const target={order,props,setProperty:(name,value)=>{order.push([name,value]);props[name]=value;}};
    return new Proxy(target,{set(t,key,value){if(key==='order'||key==='props'||key==='setProperty')return true;order.push([key,value]);props[key]=value;return true;},get:(t,key)=>t[key]});};
  const makeNode=()=>{
    const node={style:fakeStyle(),children:[],id:'',textContent:'',title:'',
      attachShadow(){this.shadow=makeNode();return this.shadow;},
      setAttribute(name,value){this[name]=value;},
      append(...items){this.children.push(...items);},
      addEventListener(type,fn){(this.handlers||={})[type]=fn;},
      remove(){removed.push(this);},
    };
    return node;
  };
  const document={body:makeNode(),documentElement:makeNode(),createElement:()=>makeNode(),getElementById:()=>null};
  const sandbox={document,setTimeout,clearTimeout,console,requestAnimationFrame:fn=>raf.push(fn),chrome:{runtime:{onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:message=>sent.push(message)}}};
  sandbox.globalThis=sandbox;
  vm.runInNewContext(code,sandbox);
  assert.equal(listeners.length,1,'要挂上消息监听');
  listeners[0]({type:'artist-library.toast',payload:{ok:true,name:'modare',danbooruId:105704,works:3,uid:'0001-modare-105704',text:'modare'}});
  const host=document.body.children[0];
  assert.ok(host,'要往页面里插一个提示节点');
  const names=host.style.order.map(item=>item[0]);
  assert.equal(host.style.props.position,'fixed','必须是固定定位');
  assert.equal(host.style.props.top,'18px');
  assert.equal(host.style.props.right,'18px');
  assert.equal(host.style.props['z-index'],'2147483647','要盖在页面内容之上');
  assert.equal(names.indexOf('all')<names.indexOf('position'),true,'all:initial 必须先写，否则会把定位抹掉（这就是之前提示看不见的原因）');
  const box=host.shadow.children[0];
  assert.equal(box.style.props.cursor,'pointer');
  assert.match(box.style.props.boxShadow,/rgba/,'提示要有漂浮感');
  assert.equal(box.style.props.opacity,'0','先透明，下一帧再淡入');
  assert.equal(box.children[0].textContent,'已添加「modare」');
  assert.equal(box.children[1].textContent,'Danbooru #105704 · 3 张作品','要写清编号与作品数');
  assert.equal(box.children[2].textContent,'点击进入画师库并定位');
  assert.equal(raf.length,1,'用 requestAnimationFrame 做淡入（不依赖 @keyframes，CSP 管不到）');
  raf[0]();
  assert.equal(box.style.props.opacity,'1');
  assert.equal(typeof box.handlers?.click,'function','点提示要能进画师库');
  box.handlers.click();
  assert.equal(sent[0].type,'artist-library.toast-click');
  assert.equal(sent[0].uid,'0001-modare-105704');
  assert.equal(sent[0].ok,true);
  assert.equal(removed.includes(host),true,'点完就把提示收掉');
  /* 失败的那种：红底、写原因，且不带上一次的内容 */
  listeners[0]({type:'artist-library.toast',payload:{ok:false,reason:'站点上没找到这个画师',text:'xyz'}});
  const failed=document.body.children[1];
  assert.equal(failed.shadow.children[0].children[0].textContent,'没能添加画师');
  assert.equal(failed.shadow.children[0].children[1].textContent,'站点上没找到这个画师');
  assert.match(failed.shadow.children[0].style.props.borderLeft,/c0392b/,'失败用红色');
  assert.match(failed.shadow.children[0].style.props.background,/fdf3f2/,'失败用红色底');
  assert.equal(String(failed.shadow.children[0].style.props.borderLeft).includes('177a4b'),false,'别把上一次成功的配色带过来');
  /* 严格 CSP 的站点：不能用 <style> 或 innerHTML 注入样式，只能走 CSSOM */
  assert.equal(/\.innerHTML\s*=/.test(code),false,'不要用 innerHTML 注入样式（会被页面 CSP 拦）');
  assert.equal(/createElement\(['"]style['"]\)/.test(code),false,'不要插 style 元素（会被页面 CSP 拦）');
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
