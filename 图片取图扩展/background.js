import {fetchImage,resolvePost,fetchApi,imageUrl,generateImage,fetchSubscription} from './probe.mjs';
import {allowedSender} from './bridge-policy.mjs';
const LIBRARY='app/index.html',MENU_ID='artist-library-add',PENDING_KEY='pendingArtistText',SELECTION_MAX=200;
/* 找到（或打开）画师库那个标签页。用 getContexts 认自己扩展的页面，不额外要 tabs 权限。 */
async function libraryTab(){
  const url=chrome.runtime.getURL(LIBRARY);
  try{
    if(chrome.runtime.getContexts){
      const contexts=await chrome.runtime.getContexts({contextTypes:['TAB'],documentUrls:[url]});
      const open=contexts.find(context=>context.tabId!=null&&context.tabId>=0);
      if(open)return {tabId:open.tabId,windowId:open.windowId,existed:true};
    }
  }catch{}
  try{const tab=await chrome.tabs.create({url});return {tabId:tab?.id,windowId:tab?.windowId,existed:false};}
  catch{return {tabId:null,windowId:null,existed:false};}
}
async function focusTab(found){
  if(!found.existed)return;
  try{if(found.tabId!=null)await chrome.tabs.update(found.tabId,{active:true});}catch{}
  try{if(found.windowId!=null)await chrome.windows.update(found.windowId,{focused:true});}catch{}
}
/* 点扩展图标打开画师库；已经开着就切过去，别开一堆标签页。 */
chrome.action.onClicked.addListener(async()=>{const found=await libraryTab();await focusTab(found);});
/* 右键菜单：选中文字 → 添加到画师库（把文字交给画师库的「识别画师」）。
   菜单要在每次服务工作线程启动时重建（MV3 会被回收），先清空再建，免得重复 id 报错。 */
function buildMenu(){
  chrome.contextMenus.removeAll(()=>chrome.contextMenus.create({id:MENU_ID,title:'添加到画师库',contexts:['selection']}));
}
chrome.runtime.onInstalled.addListener(buildMenu);
chrome.runtime.onStartup.addListener(buildMenu);
buildMenu();
chrome.contextMenus.onClicked.addListener(async info=>{
  if(info.menuItemId!==MENU_ID)return;
  const text=String(info.selectionText||'').replace(/\s+/g,' ').trim().slice(0,SELECTION_MAX);
  if(!text)return;
  const found=await libraryTab();
  await focusTab(found);
  /* 页面开着就直接推给它；刚打开的那个还没加载完，推不过去，就留在会话存储里等它来取。 */
  if(found.existed){
    try{await chrome.runtime.sendMessage({type:'artist-library.add',text});return;}catch{}
  }
  try{await chrome.storage.session.set({[PENDING_KEY]:text});}catch{}
});
/* 画师库页面加载完成后会来问一次「有没有待办的选中文字」，这里把存着的那条交给它。 */
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.channel!=='artist-library-page'||message.type!=='ready')return;
  (async()=>{
    let text='';
    try{const store=await chrome.storage.session.get(PENDING_KEY);text=String(store?.[PENDING_KEY]||'');if(text)await chrome.storage.session.remove(PENDING_KEY);}catch{}
    respond({text});
  })();
  return true;
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
