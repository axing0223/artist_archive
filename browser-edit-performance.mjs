// 保存/删除响应回归：真实页面、独立浏览器配置和 OPFS，不访问用户资料。
// 对照 0/600ms 文件写入延迟，测量下一张卡片何时开始移动，同时检查实际落盘和操作锁。
// PERF_ARTISTS=2000 使用元数据快照扩大列表（仅前两位建立真实文件），不代表真实磁盘吞吐。
// PERF_TAG_ARTISTS（默认 60）专测「重命名标签」：每位都建真实目录与真实图片文件，
// 统计整个保存要多少次文件系统往返——这是「改标签保存极慢」那条待办的尺子。
// PERF_REDUCED_MOTION=1 可检查关闭动画时的同一流程；需要 Node.js 22+ 和 Chrome/Edge。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=path.dirname(fileURLToPath(import.meta.url));
const candidates=[process.env.BROWSER_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
let executable;for(const candidate of candidates)if(await fs.stat(candidate).catch(()=>null)){executable=candidate;break;}
if(!executable||typeof WebSocket==='undefined')throw Error('需要 Node.js 22+ 和 Chrome/Edge；可用 BROWSER_PATH 指定浏览器可执行文件。');
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'artist-library-smoke-'));
const appRoot=path.join(root,'app');
const server=http.createServer(async(req,res)=>{
 try{
  const requested=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!requested.startsWith(appRoot+path.sep)){res.writeHead(403).end();return;}
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
  res.setHeader('content-type',mime[path.extname(requested)]||'application/octet-stream');
  res.setHeader('content-security-policy',"script-src 'self'; object-src 'none'; img-src 'self' blob: data:; base-uri 'none'");
  res.end(await fs.readFile(requested));
 }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const child=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-sync','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws,send,processError;child.on('error',error=>{processError=error;});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 let port;
 for(let i=0;i<100;i++){
  if(processError)throw processError;
  const info=await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8').catch(()=>null);
  if(info){port=Number(info.split('\n')[0]);break;}
  await sleep(100);
 }
 assert.ok(port,'浏览器必须启动独立调试端口');
 const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 ws=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 let nextId=0;const pending=new Map(),errors=[];
 ws.addEventListener('message',event=>{
  const message=JSON.parse(event.data);
  if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
  const task=pending.get(message.id);if(task){clearTimeout(task.timer);pending.delete(message.id);message.error?task.reject(Error(message.error.message)):task.resolve(message.result);}
 });
 send=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++nextId;
  /* 给足余量：标签测量那一段要在 OPFS 里建几十位画师的真实目录与图片。 */
  const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP 超时：'+method));},120000);
  pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
 });
 await send('Runtime.enable');await send('Network.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1080,height:1920,deviceScaleFactor:1,mobile:false});
 if(process.env.PERF_REDUCED_MOTION)await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await send('Network.setBlockedURLs',{urls:['https://*']}); // 测试不可请求采集站点或生图服务。
 await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/app/index.html'});
 for(let i=0;i<100;i++){
  const state=await send('Runtime.evaluate',{expression:'document.readyState === "complete" && typeof FolderStore !== "undefined"',returnByValue:true});
  if(state.result.value)break;await sleep(50);
 }
 const result=await send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:'(window.__tagRenameCheck='+tagRenameCheck.toString()+',window.__perfTagArtists='+JSON.stringify(Number(process.env.PERF_TAG_ARTISTS)||60)+',('+browserChecks.toString()+'))('+JSON.stringify(Number(process.env.PERF_ARTISTS)||2)+')'});
 if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
 assert.deepEqual(errors,[],'页面不应出现未处理异常');
 console.log(JSON.stringify(result.result.value,null,2));
 assert.ok(result.result.value.filter(row=>typeof row.movementMs==='number').every(row=>row.movementMs<300),'保存/删除后卡片应在 300ms 内开始移动，不应等待写盘');
}finally{
 if(send&&ws?.readyState===WebSocket.OPEN)await send('Browser.close').catch(()=>{});
 ws?.close();
 if(child.exitCode===null)await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(3000)]);
 if(child.exitCode===null)child.kill();
 await new Promise(resolve=>server.close(resolve));
 // 只清理由本脚本 mkdtemp 创建的目录，并核对绝对路径边界。
 const resolved=path.resolve(profile),temp=path.resolve(os.tmpdir())+path.sep;
 if(!resolved.startsWith(temp)||!path.basename(resolved).startsWith('artist-library-smoke-'))throw Error('拒绝清理非测试目录');
 await fs.rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(error=>console.warn('临时浏览器配置尚被占用：'+resolved+'（'+error.message+'）'));
}
async function browserChecks(artistCount){
 const check=(value,message)=>{if(!value)throw Error(message);};
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const until=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await delay(20);}throw Error('等待页面状态超时');};
 const folder=await navigator.storage.getDirectory();window.showDirectoryPicker=async()=>folder;
 const originalWrite=FolderStore.write,originalRead=FolderStore.read,originalRender=ArtistGallery.render,results=[];
 for(const storageDelay of [0,600])for(const action of ['保存','删除画师']){
  const seed=FolderStore.empty();seed.artists=Array.from({length:artistCount},(_,i)=>({uid:ArtistId.create({seq:i+1,name:'artist'+i}),name:'artist'+i,tags:[],works:[]}));
  await originalWrite(folder,{...seed,artists:seed.artists.slice(0,2)});FolderStore.read=async()=>structuredClone(seed);await document.getElementById('choose-folder').onclick();
  await until(()=>document.querySelector('.artist-actions button[aria-label="删除画师 artist0"]'));
  [...document.querySelector('.artist-actions').children].find(n=>n.textContent==='编辑').click();
  await until(()=>document.querySelector('article.is-editing'));await delay(500);
  const editor=document.querySelector('article.is-editing'),note=editor.querySelector('textarea[placeholder="备注"]');
  note.value='性能回归';note.dispatchEvent(new Event('input',{bubbles:true}));
  const button=[...editor.querySelectorAll('button')].find(n=>n.textContent===action);
  if(action==='删除画师')button.click();
  const sibling=document.querySelectorAll('.artist-slot')[1],siblingCard=sibling.firstElementChild,position=()=>sibling.getBoundingClientRect().top+scrollY;
  const top=position();let movementMs=null,maxFrameGap=0,writeMs=null,writeStart=null,done=false,last=performance.now();
  FolderStore.write=async(...args)=>{writeStart=performance.now();await delay(storageDelay);try{return await originalWrite(...args);}finally{writeMs=performance.now()-writeStart;done=true;}};
  let renderMs=0,renderStart=null,firstRender=null;ArtistGallery.render=(...args)=>{const t=performance.now();renderStart=t;firstRender??=t;try{return originalRender(...args);}finally{renderMs+=performance.now()-t;}};
  const start=performance.now();
  const track=()=>{const now=performance.now();maxFrameGap=Math.max(maxFrameGap,now-last);last=now;if(movementMs===null&&Math.abs(position()-top)>3)movementMs=now-start;if(!done||movementMs===null)requestAnimationFrame(track);};
  requestAnimationFrame(track);button.click();
  if(storageDelay){
   await until(()=>movementMs!==null);
   check(!done,'卡片开始移动不能等待文件写完');
   check(document.getElementById('gallery').inert,'等待写盘时，包括惰性挂载的卡片都不得重复操作');
   check(document.getElementById('storage-status').textContent==='正在保存…','提前呈现不能提前宣告保存成功');
  }
  await until(()=>done&&movementMs!==null);await delay(300);
  check(!document.getElementById('gallery').inert,'写盘结束后释放操作锁');
  check(sibling.firstElementChild===siblingCard,'相邻卡片 DOM 和图片绑定必须复用');
  if(artistCount===2){
   const stored=await originalRead(folder);
   check(action==='保存'?stored.artists[0].note==='性能回归':stored.artists.length===1,'实际文件必须包含保存或删除结果');
  }
  results.push({action,artistCount,storageDelay,renderMs:Math.round(renderMs),firstRenderMs:Math.round(firstRender-start),lastRenderMs:Math.round(renderStart-start),movementMs:Math.round(movementMs),maxFrameGap:Math.round(maxFrameGap),writeMs:Math.round(writeMs),writeStartedMs:Math.round(writeStart-start)});
  FolderStore.write=originalWrite;FolderStore.read=originalRead;ArtistGallery.render=originalRender;
 }
 results.push(await window.__tagRenameCheck({folder,originalWrite,originalRead,until,check,tagCount:window.__perfTagArtists}));
 return results;
}
/* 「改标签命名」这条路的尺子。重命名一个标签要重写"带这个标签的那批画师"，
   每位画师在 write() 里付的代价远不止一个 信息.json：还要打开它的目录与两个图片子目录，
   并各遍历一遍做旧图清理。先把这些代价变成可读的数字，再谈优化值多少。
   计数口径：dir=getDirectoryHandle，file=getFileHandle，write=落盘的图片文件数，
   remove=删掉的旧图片数，list=遍历图片目录的轮数。
   索引与 信息.json 都走 FileSystemFileHandle.createWritable，拿不到独立计数，
   所以直接比对 信息.json 的修改时间，数出到底重写了几位画师。 */
async function tagRenameCheck({folder:rawFolder,originalWrite,originalRead,until,check,tagCount:count}){
 const tagCount=Math.max(2,Number(count)||60),oldName='旧名',newName='新名',tagged=Math.floor(tagCount/2);
 const counters={dir:0,file:0,write:0,remove:0,list:0};
 /* Chrome 的 FileSystemDirectoryHandle 上，方法不是可写属性，直接赋值无法拦截（会静默无效）。
    所以包一层 Proxy，只改写五个要计数的成员，其余原样透出。 */
 const wrapCounters=target=>new Proxy(target,{
  get(object,property,receiver){
   if(property==='getDirectoryHandle')return async function(...args){counters.dir++;return wrapCounters(await object.getDirectoryHandle(...args));};
   if(property==='getFileHandle')return async function(...args){counters.file++;return wrapCounters(await object.getFileHandle(...args));};
   if(property==='removeEntry')return async function(...args){counters.remove++;return object.removeEntry(...args);};
   /* 只把图片目录的遍历算作「旧图清理」，别的遍历不记，免得把数字撑起来。 */
   if(property==='values')return function(...args){const iterator=object.values(...args);return{next:async()=>{const step=await iterator.next();if(!step.done)counters.list++;return step;},[Symbol.asyncIterator](){return this;}};};
   const value=Reflect.get(object,property,receiver);
   if(typeof value==='function')return value.bind(object);
   return value;
  },
 });
 const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
 const seed=FolderStore.empty();seed.tags=[oldName];
 seed.artists=Array.from({length:tagCount},(_,i)=>{const name='tagartist'+i;return {uid:ArtistId.create({seq:i+1,name}),name,tags:i<tagged?[oldName]:[],works:[{id:'w-'+i,thumb:pixel,large:pixel}]};});
 const infoTimes=async()=>{const artists=await rawFolder.getDirectoryHandle('画师'),seen=new Map();for(const artist of seed.artists){try{const file=await (await (await artists.getDirectoryHandle(artist.uid)).getFileHandle('信息.json')).getFile();seen.set(artist.uid,file.lastModified);}catch{seen.set(artist.uid,null);}}return seen;};
 const snapshot=()=>({dir:counters.dir,file:counters.file,list:counters.list});
 const folder=wrapCounters(rawFolder);
 /* 应用是拿自己 showDirectoryPicker 的句柄干活的，我们另外造一个代理交给它没用；
    而这个脚本第 87 行已经把 showDirectoryPicker 换成了固定返回值。所以要从那里下手：
    每次应用来取句柄，都给它一个计数代理。 */
 const storage=navigator.storage,originalGetDirectory=storage.getDirectory.bind(storage);
 storage.getDirectory=async()=>wrapCounters(await originalGetDirectory());
 window.showDirectoryPicker=async()=>wrapCounters(rawFolder);
 /* 计量必须从应用真正握着的那份目录句柄上取。应用是拿自己 showDirectoryPicker 的句柄干活的，
    我们传进去的代理它不会用，所以「把代理交给应用」这条计数路线是死的——只能包住 FolderStore.write，
    在它被调用的前后各读一次计数器。 */
 const originalStoreWrite=FolderStore.write;
 let meta=null,writeMs=0;
 FolderStore.write=async(...args)=>{
  const start=performance.now(),before=snapshot();
  try{return await originalStoreWrite(...args);}
  finally{
   const after=snapshot();
   meta={dir:after.dir-before.dir,file:after.file-before.file,list:after.list-before.list,write:counters.write,remove:counters.remove,mode:String(args[2])};
   writeMs=performance.now()-start;
  }
 };
 const started=performance.now();
 await originalWrite(folder,seed);
 /* 真实使用里，库是「打开文件夹读进来」的，图片早就是本地路径；
    所以这里落盘后立刻读回来当数据源——否则应用内存里还留着 data: 内联图，
    而「有图没落盘就不许走快路径」那道保险丝会（正确地）把每次保存都压回完整路径。 */
 const clean=await originalRead(folder);
 FolderStore.read=async()=>structuredClone(clean);
 const startupMs=performance.now()-started;
 /* 建库那一次也要计量，但不算进改名：它一样会经过被包住的 write。 */
 counters.dir=0;counters.file=0;counters.list=0;counters.write=0;counters.remove=0;
 meta=null;
 const beforeTimes=await infoTimes();
 /* infoTimes 用的是不计数的手柄，所以这里计数器的增量只来自应用自己的落盘。 */
 await document.getElementById('choose-folder').onclick();
 /* 标签列表只在打开「管理标签」对话框时才填充，所以这一步是必须的。 */
 await until(()=>!document.getElementById('manage-tags').disabled);
 document.getElementById('manage-tags').click();
 await until(()=>document.getElementById('tag-list').querySelector('.manage-tag-row'));
 /* clickStart 是「用户点下保存」那一刻：改名真正花掉的时间从这里算。
    这里不能用 until：它只认同步断言，而找标签行要读 DOM，写成异步会更清楚。 */
 const clickStart=performance.now();
 let renamed=false;
 for(let i=0;i<200&&!renamed;i++){
  const row=[...document.getElementById('tag-list').querySelectorAll('.manage-tag-row')].find(node=>node.querySelector('.manage-name')?.textContent===oldName);
  if(row){
   const open=[...row.querySelectorAll('button')].find(node=>node.textContent==='重命名');
   if(open){
    open.click();
    const input=row.querySelector('input'),keep=input&&[...row.querySelectorAll('button')].find(node=>node.textContent==='保存');
    if(input&&keep){input.value=newName;keep.click();renamed=true;break;}
   }
  }
  await delay(20);
 }
 check(renamed,'标签管理里必须能找到「'+oldName+'」并就地改名');
 await until(()=>!document.getElementById('gallery').inert);
 check(meta,'这次改名必须真的走到落盘');
 const afterTimes=await infoTimes();
 const delta={...meta};
 const touched=[...afterTimes].filter(([uid,time])=>beforeTimes.get(uid)!==time);
 const touchedTagged=touched.filter(([uid])=>seed.artists.find(artist=>artist.uid===uid).tags.includes(oldName)).length;
 const stored=await originalRead(folder);
 check(touched.length===tagged,'只有带这个标签的 '+tagged+' 位画师该被重写，实际重写了 '+touched.length+' 位');
 check(touchedTagged===tagged,'被重写的必须正好是带这个标签的那批画师');
 check(stored.tags.includes(newName)&&!stored.tags.includes(oldName),'新标签名要进索引，旧名字要消失');
 check(stored.artists.filter(artist=>artist.tags.includes(newName)).length===tagged,'改完仍应正好 '+tagged+' 位画师带新标签');
 check(delta.dir>=tagged,'重写 '+tagged+' 位画师不可能只查 '+delta.dir+' 次目录，这次测量多半没真的写');
 check(delta.mode==='meta','改标签必须带 meta 标记落盘，否则每位画师都要白付一遍图片目录与旧图清理');
 /* 只写 信息.json 的快路径根本不碰图片目录，所以一轮遍历都不该有；
    走完整路径则每位画师至少两轮（缩略图 + 大图）。这是「快路径真的生效了」的直接证据。 */
 check(delta.list<tagged,'改标签不该逐位遍历图片目录，实际遍历了 '+delta.list+' 轮（完整路径约 '+tagged*2+' 轮起），涉及 '+delta.dir+' 次目录查询');
 /* store 侧实测耗时按位均摊。注意这**只是落盘那一段**：用户体感的等待还包含
    应用在它外面的 structuredClone、指纹与索引序列化，那部分这次没单独量。 */
 const writePerArtist=writeMs/tagged;
 return {action:'重命名标签',artistCount:tagCount,tagged,rewritten:touched.length,
  startupMs:Math.round(startupMs),writeMs:Math.round(writeMs),perArtistMs:+writePerArtist.toFixed(2),
  counts:{dir:delta.dir,file:delta.file,list:delta.list,write:delta.write,remove:delta.remove},
  perArtist:{dir:+(delta.dir/tagged).toFixed(2),file:+(delta.file/tagged).toFixed(2),list:+(delta.list/tagged).toFixed(2)}};
}
