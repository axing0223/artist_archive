import {fetchImage,resolvePost,fetchApi,imageUrl,generateImage,fetchSubscription} from './probe.mjs';
import {allowedSender} from './bridge-policy.mjs';
const LIBRARY='app/index.html',MENU_ID='artist-library-add',PENDING_KEY='pendingArtistActions',SELECTION_MAX=200;
/* 找到（或打开）画师库那个标签页。用 getContexts 认自己扩展的页面，不额外要 tabs 权限。
   background=true 时新开的标签页不抢焦点——右键菜单那条路要的就是「静默」。 */
async function libraryTab({background=false}={}){
  const url=chrome.runtime.getURL(LIBRARY);
  try{
    if(chrome.runtime.getContexts){
      const contexts=await chrome.runtime.getContexts({contextTypes:['TAB'],documentUrls:[url]});
      const open=contexts.find(context=>context.tabId!=null&&context.tabId>=0);
      if(open)return {tabId:open.tabId,windowId:open.windowId,existed:true};
    }
  }catch{}
  try{const tab=await chrome.tabs.create({url,active:!background});return {tabId:tab?.id,windowId:tab?.windowId,existed:false};}
  catch{return {tabId:null,windowId:null,existed:false};}
}
async function focusTab(found){
  if(!found.existed)return;
  try{if(found.tabId!=null)await chrome.tabs.update(found.tabId,{active:true});}catch{}
  try{if(found.windowId!=null)await chrome.windows.update(found.windowId,{focused:true});}catch{}
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
chrome.action.onClicked.addListener(async()=>{const found=await libraryTab();await focusTab(found);});
/* 右键菜单：选中文字 → 添加到画师库。
   真正落盘必须由画师库页面来做（数据在你选的文件夹里，只有页面拿得到那套 File System Access 逻辑），
   所以这里的做法是：页面开着就交给它，没开着就悄悄开一个后台标签页（active:false，不抢焦点），
   等它建完卡把结果回传，再在用户当前所在页面右上角飘一个提示。 */
function buildMenu(){
  chrome.contextMenus.removeAll(()=>chrome.contextMenus.create({id:MENU_ID,title:'添加到画师库',contexts:['selection']}));
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
/* 结果优先画在用户当前所在页面的右上角；注入不了就退回角标，别让结果无声无息。 */
const toast=async payload=>{
  const tabId=payload?.sourceTabId;
  if(Number.isInteger(tabId)){
    try{
      await chrome.scripting.executeScript({target:{tabId},files:['toast.js']});
      await chrome.tabs.sendMessage(tabId,{type:'artist-library.toast',payload});
      return true;
    }catch{}
  }
  await badge(payload?.ok===true,payload?.ok===true?`已添加「${payload?.name||''}」`:'添加失败：'+(payload?.reason||''));
  return false;
};
chrome.contextMenus.onClicked.addListener(async (info,tab)=>{
  if(info.menuItemId!==MENU_ID)return;
  const text=String(info.selectionText||'').replace(/\s+/g,' ').trim().slice(0,SELECTION_MAX);
  if(!text)return;
  const request={text,requestId:Date.now().toString(36)+Math.random().toString(36).slice(2,7),sourceTabId:Number.isInteger(tab?.id)?tab.id:null};
  try{await chrome.action.setBadgeBackgroundColor({color:'#3b4a63'});await chrome.action.setBadgeText({text:'…'});}catch{}
  const found=await libraryTab({background:true});
  if(found.existed){
    /* 页面已经开着：直接问它，结果会以 artist-library-page/created 回来 */
    try{await chrome.runtime.sendMessage({type:'artist-library.create',...request});return;}catch{}
  }
  /* 刚打开的那个还没接管，先排进待办等它来领 */
  await queueAction({kind:'create',...request});
});
/* 画师库页面的消息：加载完成后领取待办；建完卡回传结果。 */
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.channel!=='artist-library-page')return;
  if(message.type==='ready'){drainActions().then(actions=>respond({actions}));return true;}
  if(message.type==='created'){
    const result=message.result||{};
    toast(result);
    if(result.ok)setTimeout(()=>chrome.action.setBadgeText({text:''}).catch(()=>{}),6000);
  }
});
/* 点漂浮提示：打开（或切到）画师库，让它定位到新卡片；失败的那种就把文字送回「添加下一位画师」。 */
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type!=='artist-library.toast-click')return;
  (async()=>{
    try{await chrome.action.setBadgeText({text:''});}catch{}
    const payload={type:'artist-library.focus',uid:String(message.uid||''),text:String(message.text||''),ok:message.ok===true};
    const found=await libraryTab();
    if(found.existed){await focusTab(found);try{await chrome.runtime.sendMessage(payload);return;}catch{}}
    else await queueAction({kind:'focus',...payload});
    if(found.existed)await focusTab(found);
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
