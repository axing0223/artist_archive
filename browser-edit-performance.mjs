// 保存/删除响应回归：真实页面、独立浏览器配置和 OPFS，不访问用户资料。
// 对照 0/600ms 文件写入延迟，测量下一张卡片何时开始移动，同时检查实际落盘和操作锁。
// PERF_ARTISTS=2000 使用元数据快照扩大列表（仅前两位建立真实文件），不代表真实磁盘吞吐。
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
 send=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP 超时：'+method));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 await send('Runtime.enable');await send('Network.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1080,height:1920,deviceScaleFactor:1,mobile:false});
 if(process.env.PERF_REDUCED_MOTION)await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await send('Network.setBlockedURLs',{urls:['https://*']}); // 测试不可请求采集站点或生图服务。
 await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/app/index.html'});
 for(let i=0;i<100;i++){
  const state=await send('Runtime.evaluate',{expression:'document.readyState === "complete" && typeof FolderStore !== "undefined"',returnByValue:true});
  if(state.result.value)break;await sleep(50);
 }
 const result=await send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:'('+browserChecks.toString()+')('+JSON.stringify(Number(process.env.PERF_ARTISTS)||2)+')'});
 if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
 assert.deepEqual(errors,[],'页面不应出现未处理异常');
 console.log(JSON.stringify(result.result.value,null,2));
 assert.ok(result.result.value.every(row=>row.movementMs<300),'保存/删除后卡片应在 300ms 内开始移动，不应等待写盘');
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
 return results;
}
