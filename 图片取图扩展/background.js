import {fetchImage,resolvePost,fetchApi,imageUrl,generateImage,fetchSubscription} from './probe.mjs';
import {allowedSender} from './bridge-policy.mjs';
const LIBRARY='app/index.html',MENU_ID='artist-library-add',PENDING_KEY='pendingArtistActions',SELECTION_MAX=200;
/* 只找已经开着的画师库页面，绝不主动创建（右键菜单那条路不许开页面）。 */
async function findLibraryTab(){
  try{
    if(chrome.runtime.getContexts){
      const contexts=await chrome.runtime.getContexts({contextTypes:['TAB'],documentUrls:[chrome.runtime.getURL(LIBRARY)]});
      const open=contexts.find(context=>context.tabId!=null&&context.tabId>=0);
      if(open)return {tabId:open.tabId,windowId:open.windowId,existed:true};
    }
  }catch{}
  return null;
}
/* 用户明确要打开画师库时（点图标、点漂浮提示）才创建，并切到前台。 */
async function showLibrary(){
  const found=await findLibraryTab();
  if(found){
    try{if(found.tabId!=null)await chrome.tabs.update(found.tabId,{active:true});}catch{}
    try{if(found.windowId!=null)await chrome.windows.update(found.windowId,{focused:true});}catch{}
    return found;
  }
  try{const tab=await chrome.tabs.create({url:chrome.runtime.getURL(LIBRARY),active:true});return {tabId:tab?.id,windowId:tab?.windowId,existed:false};}
  catch{return null;}
}
/* 页面还没接管时把待办排在会话存储里（内存态），它加载完成后会来领。
   MV3 的服务工作线程随时可能被回收，所以不能只放在内存变量里。 */
async function queueAction(action){
  try{const store=await chrome.storage.session.get(PENDING_KEY);const list=Array.isArray(store?.[PENDING_KEY])?store[PENDING_KEY]:[];list.push(action);await chrome.storage.session.set({[PENDING_KEY]:list});}catch{}
}
async function drainActions(){
  try{const store=await chrome.storage.session.get(PENDING_KEY);const list=Array.isArray(store?.[PENDING_KEY])?store[PENDING_KEY]:[];if(list.length)await chrome.storage.session.remove(PENDING_KEY);return list;}catch{return [];}
}
/* 点扩展图标打开画师库；已经开着就切过去，别开一堆标签页。 */
chrome.action.onClicked.addListener(()=>{showLibrary();});
/* 右键菜单：选中文字 → 添加到画师库。
   真正落盘必须由画师库页面来做（数据在你选的文件夹里，只有页面拿得到那套 File System Access 逻辑），
   所以这里的做法是：页面开着就交给它，没开着就悄悄开一个后台标签页（active:false，不抢焦点），
   等它建完卡把结果回传，再在用户当前所在页面右上角飘一个提示。 */
/* 菜单要在每次服务工作线程启动时重建（MV3 会被回收）。建的时候要单飞：
   onInstalled/onStartup 与启动时那一次可能撞在一起，重复 id 会让扩展页面记一条错误。 */
let buildingMenu=false;
function buildMenu(){
  if(buildingMenu)return;
  buildingMenu=true;
  chrome.contextMenus.removeAll(()=>{
    if(chrome.runtime.lastError)console.warn('[画师库] 清理右键菜单失败：',chrome.runtime.lastError.message);
    chrome.contextMenus.create({id:MENU_ID,title:'添加到画师库',contexts:['selection']},()=>{
      buildingMenu=false;
      if(chrome.runtime.lastError)console.warn('[画师库] 右键菜单创建失败：',chrome.runtime.lastError.message);
    });
  });
}
chrome.runtime.onInstalled.addListener(buildMenu);
chrome.runtime.onStartup.addListener(buildMenu);
buildMenu();
const badge=async(ok,title)=>{
  try{
    await chrome.action.setBadgeBackgroundColor({color:ok?'#177a4b':'#c0392b'});
    await chrome.action.setBadgeText({text:ok?'✓':'✗'});
    await chrome.action.setTitle({title});
  }catch{}
};
/* 结果优先画在用户当前所在页面的右上角；注入不了就退回角标，别让结果无声无息。
   两种情况都在服务工作线程的控制台留一行——排查「提示没出现」时就靠它。 */
const toast=async payload=>{
  const tabId=payload?.sourceTabId;
  if(Number.isInteger(tabId)){
    try{
      await chrome.scripting.executeScript({target:{tabId},files:['toast.js']});
      await chrome.tabs.sendMessage(tabId,{type:'artist-library.toast',payload});
      console.info('[画师库] 已在标签页',tabId,'显示漂浮提示：',payload?.state?('状态 '+payload.state):(payload?.ok?'成功':'失败'));
      return true;
    }catch(error){console.warn('[画师库] 漂浮提示注入失败，改用角标：',error?.message||error);}
  }else console.warn('[画师库] 没有来源标签页，漂浮提示无处可画，改用角标。');
  await badge(payload?.ok===true,payload?.ok===true?`已添加「${payload?.name||''}」`:'添加失败：'+(payload?.reason||''));
  return false;
};
let handledRequestId=null;
/* 收到建卡结果：更新那朵漂浮提示，成功顺手清掉角标。同一个请求只认第一条。
   要 await——不然提示还没画出去，服务工作线程就可能被回收。 */
const finish=async result=>{
  if(!result||typeof result!=='object')return;
  if(result.requestId&&result.requestId===handledRequestId)return;
  handledRequestId=result.requestId||null;
  await toast(result);
  if(result.ok)setTimeout(()=>chrome.action.setBadgeText({text:''}).catch(()=>{}),6000);
};
chrome.contextMenus.onClicked.addListener(async (info,tab)=>{
  if(info.menuItemId!==MENU_ID)return;
  const text=String(info.selectionText||'').replace(/\s+/g,' ').trim().slice(0,SELECTION_MAX);
  if(!text)return;
  const request={text,requestId:Date.now().toString(36)+Math.random().toString(36).slice(2,7),sourceTabId:Number.isInteger(tab?.id)?tab.id:null};
  try{await chrome.action.setBadgeBackgroundColor({color:'#3b4a63'});await chrome.action.setBadgeText({text:'…'});}catch{}
  /* 先弹出「正在尝试」，再问开着的画师库；没人接就记下来，等你下次打开画师库时自动添加。
     全程不主动开页面。 */
  await toast({state:'pending',text,sourceTabId:request.sourceTabId});
  let delivered=false,result=null;
  try{result=await chrome.runtime.sendMessage({type:'artist-library.create',...request});delivered=true;}catch{}
  /* 页面回了结果就用它把提示改成成功/失败；没接住才排队。 */
  if(delivered){await finish(result);return;}
  await queueAction({kind:'create',...request});
  await toast({state:'queued',text,sourceTabId:request.sourceTabId});
  try{await chrome.action.setBadgeText({text:''});}catch{}
});
/* 画师库页面的消息：加载完成后领取待办；建完卡回传结果。 */
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.channel!=='artist-library-page')return;
  if(message.type==='ready'){drainActions().then(actions=>respond({actions}));return true;}
  if(message.type==='created'){finish(message.result);}
});
/* takoma 提示词助手：内容脚本问「这个标签对应库里的哪位画师」。
   只找已经开着的画师库页面（findLibraryTab 不会创建标签页，正合已确认的方案），
   没开着就如实回 no-library，由浮窗提示用户先打开。库数据只有画师库页面拿得到
   （File System Access 的文件夹句柄在那边），所以这一跳不能省。 */
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type!=='takoma.lookup')return;
  if(sender?.id!==chrome.runtime.id)return;
  (async()=>{
    const found=await findLibraryTab();
    if(!found){respond({ok:false,reason:'no-library'});return;}
    try{respond(await chrome.tabs.sendMessage(found.tabId,{type:'artist-library.lookup',tag:String(message.tag||'')}));}
    catch(error){respond({ok:false,reason:'画师库没有回应：'+(error?.message||error)});}
  })();
  return true;
});
/* takoma 提示词助手：库里没有这个标签时，拿 Danbooru 结果回去画缩略图。
   跨站请求只能在这里发（内容脚本受页面同源限制），所以这一跳也由 background 代劳。
   坑（这就是「站点没有返回图片」的原因）：probe.mjs 的 fetchApi 返回的是 {status,json} 包装对象，
   不是解析好的 JSON——直接 Array.isArray(结果) 永远为假，列表恒空。这里必须解构出 json。
   取 12 条再挑出前 10 条有效的：浮窗固定 5 列，两行正好 10 张，多要两条是为了剔掉没预览图的。
   large 优先 file_url（原图），点图放大才是真的放大，而不是把缩略图拉大。 */
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type!=='takoma.danbooru')return;
  if(sender?.id!==chrome.runtime.id)return;
  (async()=>{
    try{
      const tag=String(message.tag||'').trim();
      if(!tag){respond({ok:false,reason:'空标签'});return;}
      const {json}=await fetchApi('https://danbooru.donmai.us/posts.json?limit=12&tags='+encodeURIComponent(tag));
      const list=(Array.isArray(json)?json:[])
        .filter(post=>post&&Number.isSafeInteger(post.id)&&(post.preview_file_url||post.large_file_url))
        .slice(0,10)
        .map(post=>({id:post.id,thumb:post.preview_file_url||post.large_file_url,large:post.file_url||post.large_file_url||post.preview_file_url}));
      respond({ok:true,posts:list});
    }catch(error){respond({ok:false,reason:'站点没有回应：'+(error?.message||error)});}
  })();
  return true;
});
/* 点漂浮提示：打开（或切到）画师库，让它定位到新卡片。
   只有「已添加」「已收下」这类真的建好卡的提示才带 uid，才谈得上定位；
   排队/失败那两朵提示没有 uid，它们的意思只是「把页面打开」——建卡由页面领 create 待办自己完成。
   这种情况要是再排一条 uid 为空的定位待办，那段文字就会落进页面里「识别画师」的旧流程。 */
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type!=='artist-library.toast-click')return;
  (async()=>{
    try{await chrome.action.setBadgeText({text:''});}catch{}
    /* 点提示是用户主动要看页面，这时候开页面/切前台都是应该的。 */
    const found=await showLibrary();
    const uid=String(message.uid||'');
    if(!uid)return;
    const payload={type:'artist-library.focus',uid,text:String(message.text||''),ok:message.ok===true};
    if(found?.existed){try{await chrome.runtime.sendMessage(payload);return;}catch{}}
    /* 页面是刚开的（或者刚才没接住）：排进待办，它加载完成后自己来领。 */
    await queueAction({kind:'focus',...payload});
  })();
});
const CHUNK=4*1024*1024,MAX_BYTES=50*1024*1024,KEEP=120000,GENERATE_URL='https://image.novelai.net/ai/generate-image';
const jobs=new Map(),queue=[];let active=0;
function sweep(){const now=Date.now();for(const [key,job] of jobs)if(job.expires&&job.expires<now)jobs.delete(key);}
function pump(){while(active<3&&queue.length){const job=queue.shift();if(job.controller.signal.aborted){jobs.delete(job.key);job.respond({ok:false,error:'已取消'});continue;}active++;run(job).finally(()=>{active--;pump();});}}
async function run(job){
  try{
    /* 生图要等几十秒，取图 60 秒足够；两者共用一套分块回传。 */
    const blob=job.generate
      ?await generateImage(job.url,job.body,{token:job.token,signal:AbortSignal.any([job.controller.signal,AbortSignal.timeout(180000)]),maxBytes:MAX_BYTES})
      :await fetchImage(job.url,{credentials:'include',signal:AbortSignal.any([job.controller.signal,AbortSignal.timeout(60000)]),maxBytes:MAX_BYTES});
    const bytes=new Uint8Array(await blob.arrayBuffer());let s='';
    for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));
    job.base64=btoa(s);job.expires=Date.now()+KEEP;
    job.respond({ok:true,type:blob.type,bytes:bytes.length,chunks:Math.max(1,Math.ceil(job.base64.length/CHUNK))});
  }catch(error){jobs.delete(job.key);job.respond({ok:false,error:error.name==='TimeoutError'?'请求超时':error.message});}
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!allowedSender(sender,chrome.runtime.id)||message?.channel!=='artist-images-v1')return;
  if(message.type==='ping'){respond({ok:true,version:chrome.runtime.getManifest().version});return;}
  if(typeof message.id!=='string'||message.id.length>100)return;
  const key=sender.tab.id+':'+message.id;
  if(message.type==='cancel'){jobs.get(key)?.controller.abort();jobs.delete(key);respond({ok:true});return;}
  if(message.type==='chunk'){
    sweep();const job=jobs.get(key);
    if(!job||!job.base64){respond({ok:false,error:'数据已过期，请重新获取'});return;}
    const index=Number(message.index);
    if(!Number.isSafeInteger(index)||index<0){respond({ok:false,error:'分块编号无效'});return;}
    respond({ok:true,index,data:job.base64.slice(index*CHUNK,(index+1)*CHUNK)});return;
  }
  if(message.type==='resolve'){
    resolvePost(message.url).then(url=>respond({ok:true,url}),error=>respond({ok:false,error:error.name==='TimeoutError'?'作品信息请求超时':error.message}));
    return true;
  }
  if(message.type==='api'){
    fetchApi(message.url).then(result=>respond({ok:true,status:result.status,json:result.json}),error=>respond({ok:false,error:error.name==='TimeoutError'?'接口请求超时':error.message}));
    return true;
  }
  if(message.type==='subscription'){
    /* 只读查询：返回体很小，不用分块。 */
    fetchSubscription(message.url,{token:message.token}).then(json=>respond({ok:true,json}),error=>respond({ok:false,error:error.name==='TimeoutError'?'额度查询超时':error.message}));
    return true;
  }
  if(message.type==='generate'){
    /* 页面送来的地址一律换成写死的端点：扩展不能变成任意 POST 代理。 */
    try{sweep();if(queue.length>=24||jobs.has(key))throw Error('请求队列已满，请稍后重试');const job={key,url:GENERATE_URL,body:message.body,token:message.token,generate:true,respond,controller:new AbortController()};jobs.set(key,job);queue.push(job);pump();}
    catch(e){respond({ok:false,error:e.message});}return true;
  }
  if(message.type!=='image')return;
  try{sweep();const url=imageUrl(message.url);if(queue.length>=24||jobs.has(key))throw Error('图片队列已满，请稍后重试');const job={key,url,respond,controller:new AbortController()};jobs.set(key,job);queue.push(job);pump();}
  catch(e){respond({ok:false,error:e.message});}return true;
});
