// 可选真实浏览器回归：Node.js 22+，使用独立临时配置与浏览器私有文件系统。
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
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Network.setBlockedURLs',{urls:['https://*']}); // 测试不可请求采集站点或生图服务。
 await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/app/index.html'});
 for(let i=0;i<100;i++){
  const state=await send('Runtime.evaluate',{expression:'document.readyState === "complete" && typeof FolderStore !== "undefined"',returnByValue:true});
  if(state.result.value)break;await sleep(50);
 }
 const result=await send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:'('+browserChecks.toString()+')()'});
 if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
 assert.deepEqual(errors,[],'页面不应出现未处理异常');
 console.log('真实浏览器回归通过：'+JSON.stringify(result.result.value));
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
async function browserChecks(){
 const check=(condition,message)=>{if(!condition)throw Error(message);};
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const until=async predicate=>{for(let i=0;i<100;i++){if(await predicate())return;await delay(30);}throw Error('等待页面状态超时：'+JSON.stringify({status:document.getElementById('storage-status')?.textContent,cards:document.querySelectorAll('article.artist').length,images:[...document.images].map(img=>({src:img.src,title:img.title,rect:img.getBoundingClientRect().toJSON()})),text:document.body.innerText.slice(0,1500)}));};
 const $=id=>document.getElementById(id);
 // 真实 FileSystemDirectoryHandle，但位于全新浏览器配置的 OPFS；不选择电脑上的数据文件夹。
 const folder=await navigator.storage.getDirectory();window.showDirectoryPicker=async()=>folder;
 const canvas=document.createElement('canvas');canvas.width=canvas.height=16;const context=canvas.getContext('2d');context.fillStyle='red';context.fillRect(0,0,16,16);
 const uid='0001-browser-manual',seed=FolderStore.empty();
 seed.artists=[{uid,name:'browser',tags:[],works:[{id:'',kind:'test',testSeq:1,caption:'',thumb:canvas.toDataURL('image/jpeg'),large:canvas.toDataURL('image/png')}]}];
 await FolderStore.write(folder,seed);await $('choose-folder').onclick();$('gallery').scrollIntoView({block:'center'});
 await until(()=>document.querySelector('.work.is-test img')?.src);
 $('auto-open-works').checked=true;await $('auto-open-works').onchange();$('settings-open').onclick();
 check($('auto-open-works').checked,'保存后重开设置应保留自动展开');$('close-settings').click();
 await $('choose-folder').onclick();$('settings-open').onclick();check($('auto-open-works').checked,'重新读取文件夹应保留自动展开');$('close-settings').click();
 // 真实页面异步保存与后台刷新交错。
 let resolveStarted,release;const started=new Promise(r=>resolveStarted=r),response=new Promise(r=>release=r);
 ArtistLookup.plan=name=>({query:name});ArtistLookup.lookup=async()=>[];
 ArtistLookup.details=async()=>{resolveStarted();await response;return {counts:{total:19,checkedAt:'browser-test'}};};
 const refreshing=$('sync-all').onclick();await started;
 $('save-large').checked=true;await $('save-large').onchange();release();await refreshing;
 let stored=await FolderStore.read(folder);check(stored.saveLargeImages&&stored.artists[0].counts.total===19,'刷新不能覆盖同时保存的设置');
 // 真实拖放、canvas 缩略图、同路径图片写入和正在显示的 Blob 缓存更新。
 const original=stored.artists[0].works[0],before=await(await ArtistImages.fetch(uid,original,'thumb')).arrayBuffer();
 context.fillStyle='blue';context.fillRect(0,0,16,16);
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')),transfer=new DataTransfer();transfer.items.add(new File([blob],'replacement.png',{type:'image/png'}));
 await until(()=>document.querySelector('.work.is-test'));
 document.querySelector('.work.is-test').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));
 await until(()=>$('storage-status').textContent.includes('已把 1 张图片放进'));
 stored=await FolderStore.read(folder);const replaced=stored.artists[0].works[0];check(replaced.thumb===original.thumb,'测试必须覆盖同一个图片路径');
 const after=await(await ArtistImages.fetch(uid,replaced,'thumb')).arrayBuffer();
 check(String(new Uint8Array(before))!==String(new Uint8Array(after)),'替换后不得仍返回旧图片');
 // 真正的卡片编辑表单：验证 DOM 接线、保存和读回。
 [...document.querySelectorAll('.artist-actions button')].find(node=>node.textContent==='编辑').click();await until(()=>document.querySelector('input[placeholder="画师名字（必填）"]'));
 const editor=document.querySelector('article.is-editing'),note=[...editor.querySelectorAll('textarea')].find(node=>node.placeholder==='备注');
 check(note,'真实编辑页必须有备注输入框');note.value='真实浏览器回归';note.dispatchEvent(new Event('input',{bubbles:true}));
 const save=[...editor.querySelectorAll('button')].find(node=>node.textContent==='保存');await save.onclick();
 stored=await FolderStore.read(folder);check(stored.artists[0].note==='真实浏览器回归','编辑备注必须写入真实文件');
 return {settingsPersisted:true,concurrentRefreshMerged:true,replacedImageReloaded:true,editorSaved:true,artists:stored.artists.length};
}
