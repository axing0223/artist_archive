// 书钉性能与交互回归：隔离浏览器、OPFS 演示图片，不访问真实资料。
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
 send=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP 超时：'+method));},90000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 await send('Runtime.enable');await send('Network.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1080,height:1920,deviceScaleFactor:1,mobile:false});
 await send('Network.setBlockedURLs',{urls:['https://*']}); // 测试不可请求采集站点或生图服务。
 await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/app/index.html'});
 for(let i=0;i<100;i++){
  const state=await send('Runtime.evaluate',{expression:'document.readyState === "complete" && typeof FolderStore !== "undefined"',returnByValue:true});
  if(state.result.value)break;await sleep(50);
 }
 await send('Runtime.evaluate',{expression:await fs.readFile(path.join(root,'tools/ui-demo.js'),'utf8')});


 const result=await send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:'('+pinChecks.toString()+')()'});
 if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
 assert.deepEqual(errors,[],'书钉操作不应出现页面异常');
 console.log(JSON.stringify(result.result.value,null,2));
 const out=path.join(root,'.ui-artifacts');await fs.mkdir(out,{recursive:true});
 const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,'pin-check.png'),Buffer.from(shot.data,'base64'));
 const r=result.result.value;
 assert.equal(r.otherCardsRefreshed,0,'创建书钉不应重画其余卡片');
 assert.equal(r.retainedPinnedImagesReplaced,0,'新增书钉不应重载已有书钉图片');

 assert.ok(r.barTop>=r.controlsBottom&&r.badgeTop>=r.scrollerTop,'浮窗顶部和评分徽章不能被裁切');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await sleep(500);
 const small=await send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{const bar=document.getElementById('pinned-bar').getBoundingClientRect(),controls=document.querySelector('.library-controls').getBoundingClientRect(),status=document.querySelector('.status-bar').getBoundingClientRect();return {top:bar.top,controls:controls.bottom,bottom:bar.bottom,status:status.top,overflow:document.documentElement.scrollWidth>innerWidth};})()`});
 assert.ok(small.result.value.top>=small.result.value.controls&&small.result.value.bottom<=small.result.value.status&&!small.result.value.overflow,'窄屏浮窗应在工具栏和状态栏之间：'+JSON.stringify(small.result.value));
 console.log('窄屏定位通过：'+JSON.stringify(small.result.value));

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


async function pinChecks(){
 const delay=ms=>new Promise(r=>setTimeout(r,ms)),until=async fn=>{for(let i=0;i<150;i++){if(fn())return;await delay(20);}throw Error('书钉状态超时');};
 await ArtistDemo.seed(8);await delay(600);
 if(document.documentElement.dataset.density!=='compact'){document.getElementById('density-toggle').click();await delay(750);}
 const cards=[...document.querySelectorAll('#gallery .artist')],others=cards.slice(1,4).map(card=>({card,head:card.querySelector('.artist-info'),img:card.querySelector('img')}));
 cards[0].querySelector('.pin-button').click();await until(()=>!document.getElementById('gallery').inert&&document.querySelector('#pinned-bar .artist'));await delay(400);
 const otherCardsRefreshed=others.filter(({card,head,img})=>!head.isConnected||card.querySelector('.artist-info')!==head||card.querySelector('img')!==img).length;
 const firstPinned=document.querySelector('#pinned-bar .artist'),pinnedImg=firstPinned.querySelector('img');
 document.querySelectorAll('#gallery .pin-button')[1].click();await until(()=>!document.getElementById('gallery').inert&&document.querySelectorAll('#pinned-bar .artist').length===2);await delay(400);
 const retainedPinnedImagesReplaced=Number(!pinnedImg.isConnected||document.querySelector('#pinned-bar .artist img')!==pinnedImg);
 window.scrollTo(0,1100);await delay(400);
 const bar=document.getElementById('pinned-bar').getBoundingClientRect(),controls=document.querySelector('.library-controls').getBoundingClientRect(),badge=document.querySelector('#pinned-bar .score-badge').getBoundingClientRect(),scroller=document.querySelector('.pinned-area').getBoundingClientRect();

 const report={otherCardsRefreshed,retainedPinnedImagesReplaced,barTop:bar.top,controlsBottom:controls.bottom,badgeTop:badge.top,scrollerTop:scroller.top};
 const check=(value,message)=>{if(!value)throw Error(message);},listPin=i=>document.querySelectorAll('#gallery .pin-button')[i];
 const saved=async()=>{await until(()=>!document.getElementById('gallery').inert);await delay(350);};
 const resourceCheck=()=>check(ArtistImages.stats().bound===document.querySelectorAll('#gallery .thumb img,#pinned-bar .thumb img').length,'图片绑定应与当前卡片对应，不能遗留已取消书钉的图片');
 document.getElementById('filter-toggle').click();await delay(350);
 check(document.getElementById('pinned-bar').getBoundingClientRect().top>=document.querySelector('.library-controls').getBoundingClientRect().bottom,'展开筛选后书钉仍不能被挡住');
 document.getElementById('filter-toggle').click();await delay(350);
 const retained=document.querySelector('#pinned-bar .artist'),toggle=document.querySelector('.pinned-toggle');
 toggle.click();await delay(320);check(toggle.getAttribute('aria-expanded')==='false'&&document.querySelector('.pinned-area').getBoundingClientRect().height<1,'收起仅保留标题栏');
 toggle.click();await delay(320);check(document.querySelector('#pinned-bar .artist')===retained&&toggle.getAttribute('aria-expanded')==='true','展开复用原卡片');
 window.scrollTo(0,0);await delay(400);
 const untouched=document.querySelectorAll('#gallery .artist')[3],untouchedHead=untouched.querySelector('.artist-info');
 listPin(2).click();await saved();check(listPin(3).disabled,'达到上限时其余书钉按钮立即禁用');check(untouched.querySelector('.artist-info')===untouchedHead,'达到上限只同步按钮，不能重画其余卡片');
 const secondPinnedImg=document.querySelectorAll('#pinned-bar .artist img')[5];
 document.querySelector('#pinned-bar .pin-button').click();await saved();check(!listPin(3).disabled,'取消后立即恢复可用');check(secondPinnedImg.isConnected,'取消一位不能拆掉其他书钉图片');resourceCheck();

 // 从浮窗拖入图片，保存前后的新预览与未修改的作品都应保留原节点和 URL。
 const retainedWork=document.querySelectorAll('#pinned-bar .thumb img')[1],retainedSource=retainedWork.src;
 const originalWrite=FolderStore.write;FolderStore.write=async(...args)=>{await delay(600);return originalWrite(...args);};
 const canvas=document.createElement('canvas');canvas.width=canvas.height=32;canvas.getContext('2d').fillRect(0,0,32,32);
 const transfer=new DataTransfer();transfer.items.add(new File([await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))],'pin-work.png',{type:'image/png'}));
 document.querySelector('#pinned-bar .work').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));
 await until(()=>document.getElementById('gallery').inert&&document.querySelector('#pinned-bar .thumb img')?.naturalWidth===32);
 const preview=document.querySelector('#pinned-bar .thumb img'),previewSource=preview.src;await saved();FolderStore.write=originalWrite;
 check(preview===document.querySelector('#pinned-bar .thumb img')&&preview.src===previewSource,'书钉中的新增图片落盘后不能二次闪烁');
 check(retainedWork.isConnected&&retainedWork.src===retainedSource,'书钉修改作品不能重载其余图片');resourceCheck();
 // 浮窗编辑保存、取消必须保留完整功能和图片，且不受滚动区域限高裁切。
 const pinnedArtist=document.querySelector('#pinned-bar .artist');pinnedArtist.querySelector('.artist-actions').lastElementChild.click();await delay(420);
 const editor=document.querySelector('#pinned-bar .artist.is-editing');check(editor&&document.getElementById('pinned-bar').classList.contains('is-editing'),'书钉中可正常编辑');
 const note=editor.querySelector('textarea[placeholder]')||editor.querySelector('textarea');note.value='书钉编辑回归';note.dispatchEvent(new Event('input',{bubbles:true}));
 [...editor.querySelectorAll('button')].find(b=>b.textContent==='保存').click();await saved();check(!document.querySelector('#pinned-bar .artist.is-editing'),'保存后恢复书钉');resourceCheck();
 // 清空后再次创建，验证独立画廊能重新挂载且资源不累积。
 for(let cycle=0;cycle<3;cycle++){
  while(document.querySelector('#pinned-bar .pin-button')){document.querySelector('#pinned-bar .pin-button').click();await saved();}
  check(document.getElementById('pinned-bar').hidden,'最后一个取消后浮动区隐藏');resourceCheck();
  window.scrollTo(0,0);await delay(300);listPin(0).click();await saved();
  await until(()=>[...document.querySelectorAll('#pinned-bar .thumb img')].every(img=>img.complete&&img.naturalWidth>0));resourceCheck();
 }

 // 列表卡片在钉住后没有重建，编辑时不能从旧闭包把 pinned=false 写回。
 window.scrollTo(0,0);await delay(300);document.querySelector('#gallery .artist-actions').lastElementChild.click();await delay(400);
 const listEditor=document.querySelector('#gallery .artist.is-editing');check(listEditor,'列表仍可编辑已钉住的画师');
 [...listEditor.querySelectorAll('button')].find(b=>b.textContent==='保存').click();await saved();
 check(document.querySelectorAll('#pinned-bar .pin-button').length===1&&!document.getElementById('pinned-bar').hidden,'列表编辑保存必须保留最新书钉状态');resourceCheck();
 report.interactionsPassed=true;report.boundImages=ArtistImages.stats().bound;
 window.scrollTo(0,900);await delay(350);return report;
}
