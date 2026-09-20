// 作品增删/新增画师性能回归：真实页面、独立浏览器配置和 OPFS，不访问用户资料。
// 测量页面更新延迟、无关图片变暗、原有列表节点拆装和未变图片的 DOM/src 稳定性。
// PERF_WRITE_DELAY 默认 600ms，可设为 0 对照。
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
 const result=await send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:'('+browserChecks.toString()+')('+JSON.stringify({writeDelay:Number(process.env.PERF_WRITE_DELAY??600)})+')'});
 if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
 assert.deepEqual(errors,[],'页面不应出现未处理异常');
 console.log(JSON.stringify(result.result.value,null,2));
 assert.ok(result.result.value.every(row=>row.responseMs<300&&row.dimmedOtherImages===0&&row.removedExistingSlots===0&&row.replacedRetainedImages===0&&row.savedPreviewReplaced===0),'局部操作应及时更新，不能让整页图片变暗、重新挂载或重载未改作品');
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
async function browserChecks({writeDelay}){
 const check=(value,message)=>{if(!value)throw Error(message);};
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const until=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await delay(20);}throw Error('等待页面状态超时：'+document.getElementById('storage-status').textContent);};
 const $=id=>document.getElementById(id),folder=await navigator.storage.getDirectory();window.showDirectoryPicker=async()=>folder;
 const originalWrite=FolderStore.write,results=[];
 const canvas=document.createElement('canvas');canvas.width=canvas.height=32;const ctx=canvas.getContext('2d');
 const thumbs=['red','green','blue'].map(color=>{ctx.fillStyle=color;ctx.fillRect(0,0,32,32);return canvas.toDataURL('image/png');});
 for(const action of ['添加作品','删除作品','新增画师']){
  const seed=FolderStore.empty();seed.artists=Array.from({length:3},(_,i)=>({uid:ArtistId.create({seq:i+1,name:'artist'+i}),name:'artist'+i,tags:[],works:thumbs.map((thumb,j)=>({id:String(i*10+j+1),thumb,large:thumb}))}));
  await originalWrite(folder,seed);await $('choose-folder').onclick();window.scrollTo(0,0);
  await until(()=>document.querySelectorAll('#gallery img[src]').length===9);await delay(350);
  const slots=[...$('gallery').children],target=slots[0],others=slots.slice(1).flatMap(n=>[...n.querySelectorAll('img')]);
  const retained=[...target.querySelectorAll('img')].slice(action==='删除作品'?1:0),sources=new Map([...others,...retained].map(img=>[img,img.src]));
  let removedExistingSlots=0,done=false,responseMs=null,writeStarted=false;
  const observer=new MutationObserver(records=>{for(const record of records)if(record.target===$('gallery'))for(const node of record.removedNodes)if(slots.includes(node))removedExistingSlots++;});observer.observe($('gallery'),{childList:true});
  FolderStore.write=async(...args)=>{writeStarted=true;await delay(writeDelay);try{return await originalWrite(...args);}finally{done=true;}};
  let trigger;
  if(action==='添加作品'){
   const file=new File([await new Promise(r=>canvas.toBlob(r,'image/png'))],'added.png',{type:'image/png'}),transfer=new DataTransfer();transfer.items.add(file);
   trigger=()=>target.querySelectorAll('.works > .work')[3].dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));
  }else if(action==='删除作品'){
   const button=target.querySelector('.slot-delete');button.click();trigger=()=>button.click();
  }else{
   $('batch-artists').click();$('batch-names').value='artist-new';$('batch-works').checked=false;$('batch-generate').checked=false;
   trigger=()=>{$('batch-form').onsubmit({preventDefault(){}});$('batch-dialog').close();};
  }
  const start=performance.now(),changed=()=>action==='新增画师'?$('gallery').children.length===4:target.querySelectorAll('.work[data-work]').length===(action==='添加作品'?4:2);
  const track=()=>{if(changed())responseMs??=performance.now()-start;if(!done||responseMs===null)requestAnimationFrame(track);};requestAnimationFrame(track);trigger();
  await until(()=>writeStarted);await delay(30);
  if(!done){check($('gallery').inert,'及时呈现时仍需保留保存锁');check($('storage-status').textContent==='正在保存…','文件完成前不能宣告保存成功');}
  const addedPreview=action==='添加作品'?target.querySelectorAll('.works img')[3]:null;
  if(addedPreview)await until(()=>addedPreview.src&&addedPreview.naturalWidth>0);
  const addedSource=addedPreview?.src;
  const dimmedOtherImages=others.filter(img=>Number(getComputedStyle(img.closest('button')).opacity)<.99).length;
  await until(()=>done&&responseMs!==null);await delay(350);observer.disconnect();
  check(ArtistImages.stats().bound===document.querySelectorAll('#gallery img').length,'移除作品必须释放图片绑定，不能累积已脱离页面的图片');
  check(!$('gallery').inert&&!document.querySelector('.is-saving-locked'),'保存后必须恢复操作锁与临时样式');
  const replacedRetainedImages=[...sources].filter(([img,src])=>!img.isConnected||img.src!==src).length;
  const stored=await FolderStore.read(folder);if(action==='新增画师'?stored.artists.length!==4:stored.artists[0].works.length!==(action==='添加作品'?4:2))throw Error('实际写盘结果不符');
  if(action==='删除作品'){
   const open=ArtistViewer.open;let preview;ArtistViewer.open=value=>preview=value;
   target.querySelector('.thumb').click();check(preview.work.id==='2'&&preview.items.map(w=>w.id).join(',')==='2,3','移位后预览必须使用最新作品与顺序');ArtistViewer.open=open;
   const kept=target.querySelectorAll('img')[1],keptSource=kept.src,button=target.querySelector('.slot-delete');
   await button.onclick();await button.onclick();
   check((await FolderStore.read(folder)).artists[0].works.map(w=>w.id).join(',')==='3','连续删除必须删除移位后的当前作品');
   check(kept.isConnected&&kept.src===keptSource,'连续删除不能重载未删除的作品');
   done=false;const transfer=new DataTransfer();transfer.items.add(new File([await new Promise(r=>canvas.toBlob(r,'image/png'))],'replacement.png',{type:'image/png'}));
   target.querySelector('.work').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));await until(()=>done);await delay(50);
   const moved=await FolderStore.read(folder);check(moved.artists[0].works.length===1&&moved.artists[0].works[0].id==='','移位后拖放必须替换当前格，不能使用旧下标追加');
  }
  const savedPreviewReplaced=addedPreview&&(!addedPreview.isConnected||target.querySelectorAll('.works img')[3]!==addedPreview||addedPreview.src!==addedSource)?1:0;
  results.push({action,savedPreviewReplaced,responseMs:Math.round(responseMs),dimmedOtherImages,removedExistingSlots,replacedRetainedImages});FolderStore.write=originalWrite;
 }
 // 编辑态移除、从站点勾选添加/取消也必须保留其余作品绑定。
 [...document.querySelector('.artist-actions').children].find(node=>node.textContent==='编辑').click();await until(()=>document.querySelector('.is-editing'));await delay(500);
 const editor=document.querySelector('.is-editing');await until(()=>editor.querySelectorAll('.works img[src]').length===3);
 const retained=[...editor.querySelectorAll('.works img')].slice(1),sources=retained.map(img=>img.src);
 editor.querySelector('.danger-link').click();check(retained.every((img,i)=>img.isConnected&&img.src===sources[i]),'编辑器移除一张不能重载其余作品');
 ArtistLookup.posts=async()=>[{id:'999',thumb:thumbs[0],large:thumbs[0]}];editor.querySelector('.artist-expand button').click();
 await until(()=>editor.querySelector('.candidate-previews input[type=checkbox]'));await delay(600);
 await until(()=>retained.every(img=>img.src));const before=retained.map(img=>img.src),checkbox=editor.querySelector('.candidate-previews input[type=checkbox]');
 checkbox.click();await until(()=>editor.querySelectorAll('.works img').length===3);
 check(retained.every((img,i)=>img.isConnected&&img.src===before[i]),'勾选候选作品不能重载编辑器已有作品');
 checkbox.click();await until(()=>editor.querySelectorAll('.works img').length===2);
 check(retained.every((img,i)=>img.isConnected&&img.src===before[i]),'取消候选作品不能重载编辑器已有作品');
 await [...editor.querySelector('.artist-actions').children].find(node=>node.textContent==='保存').onclick();
 check((await FolderStore.read(folder)).artists[0].works.map(w=>w.id).join(',')==='2,3','编辑后的作品结果应正确落盘');
 // 写盘失败后保留临时预览；另一项设置触发重试（会克隆数据）也不能再闪一次。
 const card=document.querySelector('.artist-slot'),transfer=new DataTransfer();transfer.items.add(new File([await new Promise(r=>canvas.toBlob(r,'image/png'))],'retry.png',{type:'image/png'}));
 FolderStore.write=async()=>{await delay(500);throw Error('模拟写盘失败');};
 card.querySelectorAll('.works > .work')[2].dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));
 await until(()=>card.querySelectorAll('.works img[src]').length===3);const retryPreview=card.querySelectorAll('.works img')[2],retrySource=retryPreview.src;
 await until(()=>$('storage-status').textContent.includes('文件保存失败'));FolderStore.write=originalWrite;
 $('save-large').checked=true;await $('save-large').onchange();await delay(300);
 check(retryPreview.isConnected&&retryPreview.src===retrySource,'写盘失败后通过其他操作重试，也应保持临时预览的节点和图片地址');
 check((await FolderStore.read(folder)).artists[0].works.length===3,'失败后重试必须实际保存新图片');
 return results;
}
