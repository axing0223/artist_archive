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
 const result=await send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:'('+browserChecks.toString()+')()'});
 if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
 assert.deepEqual(errors,[],'页面不应出现未处理异常');
 console.log('界面与性能回归通过：'+JSON.stringify(result.result.value));
 const out=path.join(root,'.ui-artifacts');await fs.mkdir(out,{recursive:true});
 await fs.writeFile(path.join(out,'performance.json'),JSON.stringify(result.result.value,null,2));
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
 await evaluate('ArtistDemo.seed(24).then(({thumbnails})=>ArtistDemo.installPreviewServices(thumbnails))');await evaluate('window.scrollTo(0,0)');await sleep(650);
 const capture=async name=>{const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,name+'.png'),Buffer.from(shot.data,'base64'));};
 await capture('portrait-dark');
 const fiveImages=()=>JSON.stringify([...document.querySelectorAll('.artist:not(.is-editing) .works')].map(row=>{const works=[...row.querySelectorAll(':scope > .work')],rects=works.map(n=>n.getBoundingClientRect());return {count:works.length,oneLine:Math.max(...rects.map(r=>r.top))-Math.min(...rects.map(r=>r.top))<1,fits:rects.every(r=>r.left>=0&&r.right<=innerWidth),contain:[...row.querySelectorAll('img')].every(img=>getComputedStyle(img).objectFit==='contain')};}));
 const verifyFive=async label=>{const rows=JSON.parse(await evaluate('('+fiveImages.toString()+')()'));assert.ok(rows.length>0,label+' 必须显示卡片');assert.ok(rows.every(row=>row.count===5&&row.oneLine&&row.fits&&row.contain),label+' 五图完整同行：'+JSON.stringify(rows));};
 await verifyFive('1080×1920 竖屏');
 /* 切分类后第一张卡要停在固定筛选栏下方：曾经因为平滑滚动期间文档高度一直在变，
    滚动目标漂移，整张卡被筛选栏盖住，看着像停在了第二张。 */
 await evaluate(`(()=>{[...document.querySelectorAll('#categories button')].find(b=>b.dataset.filterKey==='category:二次元').click();})()`);
 await sleep(900);
 const firstCard=await evaluate(`(()=>{const slot=document.querySelector('#gallery .artist-slot'),card=slot&&slot.querySelector('.artist'),bar=document.querySelector('.library-controls');if(!card)return {ok:false,reason:'这一分类下没有卡片'};const r=card.getBoundingClientRect();return {cardTop:Math.round(r.top),cardBottom:Math.round(r.bottom),barBottom:Math.round(bar.getBoundingClientRect().bottom),focused:document.activeElement===card||card.contains(document.activeElement),name:card.querySelector('.artist-name')?.textContent};})()`);
 assert.ok(firstCard.cardTop>=firstCard.barBottom-2,'切分类后第一张卡要落在固定栏下方，不能被盖住：'+JSON.stringify(firstCard));
 assert.ok(firstCard.focused,'焦点要落在第一张卡上：'+JSON.stringify(firstCard));
 /* 排序方向：点一下第一位应该换人。 */
 const flipped=await evaluate(`(()=>{const nameOf=()=>document.querySelector('#gallery .artist-slot .artist-name')?.textContent;const before=nameOf();document.getElementById('sort-direction').click();return {before,after:nameOf(),label:document.getElementById('sort-direction').textContent};})()`);
 assert.notEqual(flipped.before,flipped.after,'切换排序方向后第一位应该换人：'+JSON.stringify(flipped));
 await sleep(400);
 assert.equal(await evaluate('document.getElementById("sort-direction").getAttribute("aria-pressed")'),'true','按钮要记住当前是降序');
 await evaluate('document.getElementById("sort-direction").click()');
 await evaluate(`(()=>{[...document.querySelectorAll('#categories button')].find(b=>b.dataset.filterKey==='category:全部').click();})()`);
 await sleep(800);
 /* 点「编辑」应当是同一张卡片就地变高、下面的卡片被平滑推开，
    而不是旧卡片淡出、新卡片再出现。 */
 const morph=await evaluate(`(()=>{const card=document.querySelector('.artist:not(.is-editing)');const slot=card.closest('.artist-slot');const uid=slot.dataset.uid;const before=slot.getBoundingClientRect().height;const old=card;[...card.querySelectorAll('.artist-actions button')].find(n=>n.textContent==='编辑').click();const ghost=slot.querySelector('.card-ghost'),fresh=slot.children[0],sr=slot.getBoundingClientRect(),gr=ghost?ghost.getBoundingClientRect():null;return {before:Math.round(before),after:Math.round(slot.getBoundingClientRect().height),editing:fresh.classList.contains('is-editing'),slotAlive:slot.isConnected&&slot.dataset.uid===uid,animations:slot.getAnimations().length,morphing:old.classList.contains('is-morphing'),ghost:!!ghost,ghostFading:ghost?ghost.getAnimations().length:0,freshFading:fresh.getAnimations().length,ghostTop:gr?Math.round(gr.top-sr.top):null,ghostOverflow:gr?Math.round(gr.bottom-sr.bottom):null};})()`);
 assert.equal(morph.editing,true,'点编辑后同一块占位里应立刻是编辑态：'+JSON.stringify(morph));
 assert.equal(morph.slotAlive,true,'占位不能被拆掉重建：'+JSON.stringify(morph));
 assert.ok(morph.animations>0,'展开要有高度过渡，而不是瞬间跳变：'+JSON.stringify(morph));
 assert.equal(morph.morphing,false,'不再走「旧卡片淡出再重画」的老路：'+JSON.stringify(morph));
 assert.ok(morph.ghostTop!==null&&Math.abs(morph.ghostTop)<=2,'渐隐副本必须覆盖在占位顶部，不能掉到新内容下面：'+JSON.stringify(morph));
 assert.ok(morph.ghostOverflow<=1,'渐隐副本不能把占位撑高：'+JSON.stringify(morph));
 assert.ok(morph.ghostFading>0&&morph.freshFading>0,'旧内容渐隐、新内容渐显：'+JSON.stringify(morph));
 await sleep(650);await capture('editor-top');
 await evaluate('document.querySelector(".artist-expand button").click()');await sleep(650);
 assert.ok(await evaluate('document.activeElement===document.querySelector(".work-picker .candidate-previews")'),'手动展开的键盘焦点位于作品区域');
 assert.ok(await evaluate('document.querySelector(".work-picker .picker-status").getBoundingClientRect().top>=document.querySelector(".library-controls").getBoundingClientRect().bottom-1'),'手动展开后排序与分页不被固定栏遮挡');
 const editorWorks=await evaluate('(()=>{const w=document.querySelector(".is-editing .works").getBoundingClientRect(),b=document.querySelector(".library-controls").getBoundingClientRect();return Math.round(w.top-b.bottom);})()');
 assert.ok(editorWorks>=0&&editorWorks<200,'展开后视线交给作品格，且紧接在固定工具栏下方：间距 '+editorWorks+'px');
 await capture('picker-portrait');
 const collapse=await evaluate(`(()=>{const card=document.querySelector('.artist.is-editing:not(.card-ghost)');const slot=card.closest('.artist-slot');const before=slot.getBoundingClientRect().height;const old=card;[...card.querySelectorAll('.artist-actions button')].find(n=>n.textContent==='取消').click();const ghost=slot.querySelector('.card-ghost'),fresh=slot.children[0],sr=slot.getBoundingClientRect(),gr=ghost?ghost.getBoundingClientRect():null;return {before:Math.round(before),after:Math.round(slot.getBoundingClientRect().height),editing:fresh.classList.contains('is-editing'),animations:slot.getAnimations().length,morphing:old.classList.contains('is-morphing'),ghost:!!ghost,ghostFading:ghost?ghost.getAnimations().length:0,freshFading:fresh.getAnimations().length,ghostImages:ghost?[...ghost.querySelectorAll('img')].filter(i=>i.getAttribute('src')).length:0,ghostTop:gr?Math.round(gr.top-sr.top):null,ghostOverflow:gr?Math.round(gr.bottom-sr.bottom):null};})()`);
 assert.equal(collapse.editing,false,'取消后同一块占位里立刻回到浏览态：'+JSON.stringify(collapse));
 assert.ok(collapse.animations>0,'收起也要平滑收缩，而不是瞬间跳回去：'+JSON.stringify(collapse));
 assert.equal(collapse.morphing,false,'收起同样不走淡出老路：'+JSON.stringify(collapse));
 assert.ok(collapse.ghostTop!==null&&Math.abs(collapse.ghostTop)<=2,'渐隐副本必须覆盖在占位顶部：'+JSON.stringify(collapse));
 assert.ok(collapse.ghostOverflow<=1,'收缩时副本不能溢出占位去盖住下面的卡片：'+JSON.stringify(collapse));
 assert.ok(collapse.ghostImages>0,'渐隐副本里的图片不能是空的：'+JSON.stringify(collapse));
 assert.ok(collapse.freshFading>0,'收起后浏览态内容也要渐显：'+JSON.stringify(collapse));
 await sleep(450);await evaluate('window.scrollTo(0,0)');await sleep(450);

 /* 评分角标故意溢出卡片左上角 10px：卡片滚过固定筛选栏时，它连「筛选栏左右内边距之外那条缝」
    也必须被挡住，否则会从栏边露出一角。采样点取角标最左侧，正是修复前漏光的位置。 */
 await evaluate(`(()=>{const bar=document.querySelector('.library-controls'),badges=[...document.querySelectorAll('.score-badge')];const b=bar.getBoundingClientRect();let best=null,gap=1e9;for(const x of badges){const r=x.getBoundingClientRect(),g=r.top-b.bottom;if(Math.abs(g)<Math.abs(gap)){gap=g;best=x;}}/* 先滚到筛选栏粘住（top:var(--header)），再多滚一点让角标钻进栏内。 */const stick=Math.max(0,Math.round(b.top-66));window.scrollBy({top:Math.round(gap)+stick+26,behavior:'instant'});})()`);
 await sleep(320);
 const badgeCover=await evaluate(`(()=>{const bar=document.querySelector('.library-controls'),badges=[...document.querySelectorAll('.score-badge')];const b=bar.getBoundingClientRect();let best=null,gap=1e9;for(const x of badges){const r=x.getBoundingClientRect(),g=r.top-b.bottom;if(Math.abs(g)<Math.abs(gap)){gap=g;best=x;}}const r=best.getBoundingClientRect();const overlap=Math.min(b.bottom,r.bottom)-Math.max(b.top,r.top);if(overlap<6)return {overlap:Math.round(overlap),probed:false};const y=(Math.max(b.top,r.top)+Math.min(b.bottom,r.bottom))/2;const stack=document.elementsFromPoint(Math.round(r.left+3),Math.round(y)).map(n=>String(n.className).slice(0,30)||n.tagName);return {overlap:Math.round(overlap),probed:true,badgeLeft:Math.round(r.left),barLeft:Math.round(b.left),top:stack[0],badgeIndex:stack.findIndex(s=>s.includes('score-badge'))};})()`);
 assert.ok(badgeCover.probed,'评分角标必须能与固定筛选栏重叠，否则这条断言没测到东西：'+JSON.stringify(badgeCover));
 assert.ok(!String(badgeCover.top).includes('score-badge'),'角标与筛选栏重叠时不能压在栏上（含栏左右内边距之外那条缝）：'+JSON.stringify(badgeCover));
 await evaluate('window.scrollTo(0,0)');await sleep(320);

 /* 筛选栏背景要铺满整屏：连 main 左右内边距那一带也该是栏的背景，
    否则卡片滚过时仍会在栏外侧露出一条内容。 */
 const barCover=await evaluate(`(()=>{const bar=document.querySelector('.library-controls');const b=bar.getBoundingClientRect();const y=Math.round((b.top+b.bottom)/2);const cw=document.documentElement.clientWidth;const inBar=n=>!!n&&(n===bar||bar.contains(n));const left=document.elementFromPoint(4,y),right=document.elementFromPoint(cw-6,y);const cs=getComputedStyle(bar,'::before');return {probe:[4,y,cw-6],leftHit:left?(String(left.className).slice(0,26)||left.tagName):null,rightHit:right?(String(right.className).slice(0,26)||right.tagName):null,leftOk:inBar(left),rightOk:inBar(right),before:{width:cs.width,left:cs.left,right:cs.right,background:cs.backgroundColor,zIndex:cs.zIndex,pointerEvents:cs.pointerEvents},scrollWidth:document.documentElement.scrollWidth,clientWidth:cw};})()`);
 assert.ok(barCover.leftOk&&barCover.rightOk,'筛选栏背景应铺满整屏（含两侧内边距）：'+JSON.stringify(barCover));
 assert.ok(barCover.scrollWidth<=barCover.clientWidth+1,'铺满整屏不能引入横向溢出：'+JSON.stringify(barCover));

 /* 顶部菜单往下弹时会盖住筛选栏。过渡期间面板有自己的 transform 动画，
    层叠顺序会短暂翻转，所以要在动画进行中多点采样，而不是只看动画结束。 */
 const menuStack=[];
 for(const wait of [60,140,260]){
  await evaluate('document.getElementById("test-menu").open=false');await sleep(280);
  await evaluate('document.getElementById("test-menu").open=true');await sleep(wait);
  menuStack.push(await evaluate(`(()=>{const p=document.querySelector('#test-menu .menu-panel'),b=document.querySelector('.library-controls');const pr=p.getBoundingClientRect(),br=b.getBoundingClientRect();const y=(Math.max(pr.top,br.top)+Math.min(pr.bottom,br.bottom))/2;const x=(Math.max(pr.left,br.left)+Math.min(pr.right,br.right))/2;const stack=document.elementsFromPoint(Math.round(x),Math.round(y)).map(n=>String(n.className).slice(0,24)||n.tagName);return {wait:${wait},overlap:Math.round(Math.min(pr.bottom,br.bottom)-Math.max(pr.top,br.top)),top:stack[0],panelIndex:stack.findIndex(s=>s.includes('menu-panel')),barIndex:stack.findIndex(s=>s.includes('library-controls'))};})()`));
 }
 await evaluate('document.getElementById("test-menu").open=false');await sleep(240);
 assert.ok(menuStack.every(m=>m.overlap<=0||(m.panelIndex>=0&&(m.barIndex<0||m.panelIndex<m.barIndex))),'菜单展开的过程中必须始终盖住固定筛选栏：'+JSON.stringify(menuStack));

 /* 「画风与备注」展开与收缩要停在同一个位置（最左边），否则每次开合标题都会横跳。 */
 const notesLeft=async()=>evaluate(`(()=>{const n=document.querySelector('.artist:not(.is-editing) .artist-notes');const s=n.querySelector('summary').getBoundingClientRect(),c=n.closest('.artist').getBoundingClientRect();return Math.round(s.left-c.left);})()`);
 await evaluate(`(()=>{document.querySelector('.artist:not(.is-editing) .artist-notes').open=false;})()`);await sleep(280);
 const closedLeft=await notesLeft();
 await evaluate(`(()=>{document.querySelector('.artist:not(.is-editing) .artist-notes').open=true;})()`);await sleep(320);
 const openedLeft=await notesLeft();
 await evaluate(`(()=>{document.querySelector('.artist:not(.is-editing) .artist-notes').open=false;})()`);await sleep(240);
 assert.ok(Math.abs(openedLeft-closedLeft)<=2,'「画风与备注」展开与收缩都要停在最左边：收缩 '+closedLeft+'px / 展开 '+openedLeft+'px');

 await evaluate('document.getElementById("theme-toggle").click()');await sleep(200);await capture('portrait-light');await evaluate('document.getElementById("theme-toggle").click()');
 await evaluate('document.getElementById("settings-open").click()');await sleep(250);await capture('settings');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 assert.equal(await evaluate('document.querySelectorAll("dialog[open]").length'),0,'真实 Escape 必须关闭对话框');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await sleep(450);
 await capture('mobile');
 const mobile=await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})');assert.ok(mobile.scroll<=mobile.width,'390px 窄窗口不能横向溢出');await verifyFive('390px 窄窗口');
 await evaluate('document.getElementById("filter-toggle").click()');assert.equal(await evaluate('document.getElementById("filter-panel").hidden'),false);await evaluate('document.getElementById("filter-toggle").click()');
 await evaluate('document.getElementById("settings-open").click()');await sleep(200);assert.equal(await evaluate('document.getElementById("settings").scrollWidth<=document.getElementById("settings").clientWidth+1'),true,'设置弹窗在窄屏不能横向溢出');await evaluate('document.getElementById("settings").close()');

 // 不同比例原图与窗口方向：单行说明不能产生滚动条，图片区域使用完整 contain。
 for(const [width,height,label] of [[1080,1920,'portrait'],[1920,1080,'landscape'],[390,844,'narrow']]){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await sleep(250);
  for(const [imageWidth,imageHeight,shape] of [[600,1600,'tall'],[1600,900,'wide'],[800,800,'square']]){
   await evaluate('('+((w,h)=>{const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');ctx.fillStyle='#759391';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#dcebe1';ctx.lineWidth=10;ctx.strokeRect(5,5,w-10,h-10);ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(w,h);ctx.moveTo(w,0);ctx.lineTo(0,h);ctx.stroke();const data=canvas.toDataURL();ArtistViewer.open({title:'作品详情 · 比例检查',uid:'preview-ratio',work:{thumb:data,large:data},caption:'比例检查'});}).toString()+')('+imageWidth+','+imageHeight+')');await sleep(500);
   const layout=await evaluate('('+(()=>{const d=document.getElementById('viewer'),img=document.getElementById('large-image'),stage=img.parentElement,footer=document.querySelector('.viewer-bottom');return {dialogFits:d.scrollHeight<=d.clientHeight+1&&d.scrollWidth<=d.clientWidth+1,footerFits:footer.scrollHeight<=footer.clientHeight+1&&footer.scrollWidth<=footer.clientWidth+1,stageFits:stage.scrollHeight<=stage.clientHeight+1,natural:[img.naturalWidth,img.naturalHeight],contain:getComputedStyle(img).objectFit==='contain',area:[stage.clientWidth,stage.clientHeight]};}).toString()+')()');
   assert.ok(layout.dialogFits&&layout.footerFits&&layout.stageFits&&layout.contain&&layout.area[1]>0,label+'/'+shape+' 图片完整适配且不出现多余滚动条：'+JSON.stringify(layout));assert.deepEqual(layout.natural,[imageWidth,imageHeight]);
   if((label==='portrait'&&shape==='tall')||(label==='landscape'&&shape==='wide'))await capture('viewer-'+label);
   await evaluate('document.getElementById("viewer").close()');await sleep(220);
  }
 }
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await sleep(220);
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await evaluate('document.getElementById("density-toggle").click()');await sleep(80);assert.equal(await evaluate('document.getAnimations().filter(a=>a.playState==="running").length'),0,'减少动态效果时不运行装饰动画');
 assert.deepEqual(errors,[],'所有界面验收过程中无未处理异常');console.log('1080×1920 竖屏 / 390px 窄窗口五图同行 / 深浅主题 / 原生 Escape / 减少动态效果通过；截图：'+out);

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
 const $=id=>document.getElementById(id),check=(value,message)=>{if(!value)throw Error(message);},delay=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async fn=>{for(let i=0;i<120;i++){if(await fn())return;await delay(25);}throw Error('等待状态超时：'+JSON.stringify({status:$('storage-status').textContent,query:$('search').value,count:$('count').textContent,rows:$('gallery').children.length}));};
 const {folder,data,thumbnails}=await ArtistDemo.seed(24);window.scrollTo(0,0);await until(()=>document.querySelectorAll('.artist').length>1);
 const input=(id,value)=>{$(id).value=value;$(id).dispatchEvent(new Event('input',{bubbles:true}));};
 input('search','空野 春日');await until(()=>$('gallery').children.length===1);check($('gallery').firstElementChild.dataset.uid===data.artists[0].uid,'搜索必须同时匹配笔名和备注');
 $('reset').click();await until(()=>$('gallery').children.length===24);
 const category=[...$('categories').children].find(b=>b.dataset.filterKey==='category:场景 / 环境');category.focus();category.click();
 await delay(500);check(document.activeElement===document.querySelector('.artist'),'分类切换后聚焦第一张画师卡片');check(document.activeElement.getBoundingClientRect().top<document.querySelector('.library-controls').getBoundingClientRect().bottom+60,'第一张卡片应靠近固定工具栏下方');check($('gallery').children.length===8,'分类筛选必须正确');check($('active-filters').children.length===1,'已选分类应显示可移除条件');
 $('active-filters').firstElementChild.click();check($('gallery').children.length===24,'移除条件恢复完整列表');
 $('library-sort').value='score';$('library-sort').dispatchEvent(new Event('change'));check($('gallery').children[1].dataset.uid===data.artists[5].uid,'评分排序同分时维持原始顺序');
 $('library-sort').value='order';$('library-sort').dispatchEvent(new Event('change'));
 const prior=$('gallery').children.length;$('search').value='尚未输入完成';$('search').dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));await delay(180);check($('gallery').children.length===prior,'中文组合输入期间不得触发查询');
 $('search').value='mizu_no_oto';$('search').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));await until(()=>$('gallery').children.length===4);$('reset').click();
 document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'/',bubbles:true}));check(document.activeElement===$('search'),'斜杠聚焦搜索');
 $('command-open').click();check($('command-dialog').open,'快捷操作应打开');input('command-search','资料库设置');check($('command-results').querySelectorAll('button').length===1,'快捷操作支持搜索');$('command-search').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));check(!$('command-dialog').open&&$('settings').open,'回车执行所选操作');$('settings').close();
 const actions=document.querySelector('.artist-actions');check([...actions.children].map(node=>node.textContent).join('/')==='删除/画师页面/编辑','卡片按钮顺序');const remove=actions.firstElementChild;remove.click();check(remove.classList.contains('is-armed'),'删除第一次点击进入确认态');await delay(200);check(getComputedStyle(remove).color==='rgb(255, 255, 255)','二次确认删除文字为白色');check($('gallery').children.length===24,'第一次确认不能删除画师');check($('back-top').closest('.status-bar'),'回到顶部固定在状态栏');
 $('quick-open').click();check($('quick-dialog').open&&document.activeElement===$('quick-input'),'识别添加直接聚焦输入');$('quick-dialog').querySelector('[data-close-dialog]').click();
 document.querySelector('.thumb').click();await until(()=>$('viewer').open);check($('viewer-position').textContent==='1 / 5','预览显示完整图片序号');$('viewer-next').click();check($('viewer-position').textContent==='2 / 5','可切到下一张');$('viewer').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));check($('viewer-position').textContent==='1 / 5','方向键可切回上一张');$('viewer').close();

 // 高度滑块在原先失效的上限以上仍可调，紧凑模式也使用设置的实际像素。
 $('settings-open').click();await delay(350);
 for(const height of [160,300,360]){input('card-size',String(height));await delay(30);check(Math.abs(document.querySelector('.thumb').getBoundingClientRect().height-height)<1,'预览高度应等于 '+height+'，实际 '+document.querySelector('.thumb').getBoundingClientRect().height+' / '+getComputedStyle(document.querySelector('.thumb')).height+' / '+document.documentElement.style.getPropertyValue('--card-size'));}
 $('density-toggle').click();input('card-size','251');await delay(30);check(Math.abs(document.querySelector('.thumb').getBoundingClientRect().height-251)<1,'紧凑视图也响应逐像素高度');$('density-toggle').click();
 $('settings').close();$('settings-open').click();check($('card-size').value==='251','再次打开设置保留高度');check(localStorage.getItem('artist-library.card-size')==='251','预览高度需持久化');input('card-size','190');$('settings').close();
 document.querySelector('.thumb').click();await until(()=>$('large-image').naturalWidth>0);await delay(300);
 for(const [key,position] of [['d','2 / 5'],['a','1 / 5'],['ArrowRight','2 / 5'],['ArrowLeft','1 / 5'],['D','2 / 5']]){$('viewer').dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));check($('viewer-position').textContent===position,key+' 切图');}
 $('viewer').dispatchEvent(new KeyboardEvent('keydown',{key:'a',ctrlKey:true,bubbles:true}));check($('viewer-position').textContent==='2 / 5','Ctrl+A 不应切图');
 await until(()=>$('large-image').naturalWidth>0);await delay(350);
 check($('viewer').scrollHeight<=$('viewer').clientHeight+1,'作品详情单行说明不应纵向溢出');check($('viewer').scrollWidth<=$('viewer').clientWidth+1,'作品详情不应横向溢出');
 check(getComputedStyle($('large-image')).objectFit==='contain','原图完整保留比例');
 $('viewer').close();await delay(35);check(!$('viewer').open&&getComputedStyle($('viewer')).display!=='none','关闭已退出交互，画面仍在退场');check($('large-image').hasAttribute('src'),'退出动画期间保留图片');await delay(220);check(getComputedStyle($('viewer')).display==='none'&&!$('large-image').hasAttribute('src'),'退出完成后隐藏并释放图片');
 for(const dialog of document.querySelectorAll('dialog')){dialog.showModal();await delay(220);dialog.close();await delay(30);check(dialog.getAnimations().some(a=>a.playState==='running'),dialog.id+' 关闭应有动态过渡');await delay(200);}
 $('manage-tags').click();$('tab-category').focus();$('tab-category').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));check(document.activeElement===$('tab-tag')&&!$('panel-tag').hidden,'标签页支持方向键切换');$('tag-manager').close();
 $('density-toggle').click();check(document.documentElement.dataset.density==='compact','布局密度切换生效');check(localStorage.getItem('artist-library.density')==='compact','布局密度需持久化');$('density-toggle').click();
 $('status-toggle').click();check($('activity-list').children.length>0,'活动记录应包含连接和保存状态');$('activity-dialog').close();

 $('filter-toggle').click();await delay(220);$('filter-toggle').click();await delay(35);check(getComputedStyle($('filter-panel')).display!=='none','筛选面板收起保留退场');await delay(200);
 const notes=document.querySelector('.artist-notes');notes.open=true;await delay(240);notes.open=false;await delay(35);const noteOpacity=Number(getComputedStyle(notes,'::details-content').opacity);check(noteOpacity>0&&noteOpacity<1,'备注收起时内容逐渐淡出');await delay(220);check(parseFloat(getComputedStyle(notes,'::details-content').height)===0,'备注收起完成后不占额外高度');
 const actionMenu=$('test-menu');actionMenu.open=true;await delay(220);actionMenu.open=false;await delay(35);const menuOpacity=Number(getComputedStyle(actionMenu,'::details-content').opacity);check(menuOpacity>0&&menuOpacity<1,'操作菜单收起时逐渐淡出');await delay(200);
 // 对话框实际渲染、所有表单标签、DOM 唯一标识。
 const pairs=[['settings-open','settings'],['gen-settings-open','gen-settings'],['batch-artists','batch-dialog'],['gen-batch-open','gen-batch'],['test-import-open','test-import']];
 for(const [trigger,id] of pairs){$(trigger).click();check($(id).open,id+' 应可打开');check($(id).scrollWidth<=$(id).clientWidth+1,id+' 内容不得横向溢出');$(id).close();}
 const ids=[...document.querySelectorAll('[id]')].map(n=>n.id);check(new Set(ids).size===ids.length,'页面 ID 必须唯一');
 const unlabeled=[...document.querySelectorAll('input:not([type=hidden]):not([hidden]),select,textarea')].filter(n=>!n.getAttribute('aria-label')&&!n.getAttribute('aria-labelledby')&&!n.labels?.length);
 check(!unlabeled.length,'可见表单控件必须有名称：'+unlabeled.map(n=>n.id).join(','));

 // 真实分页、跨页选择、编辑按钮、手动与自动展开；全部使用虚构图片。
 ArtistDemo.installPreviewServices(thumbnails);
 await until(()=>$('quota-images').textContent==='约 1038 张');check($('quota-percent').textContent==='60%'&&$('quota-points').textContent==='10000 点','顶部额度三项展示');check($('opus-status').closest('.header-actions'),'额度位于顶部操作区');
 const openEditor=async()=>{[...document.querySelector('.artist-actions').children].find(n=>n.textContent==='编辑').click();await until(()=>document.querySelector('.is-editing'));await delay(500);};
 const closeEditor=async()=>{[...document.querySelector('.is-editing .artist-actions').children].find(n=>n.textContent==='取消').click();await until(()=>!document.querySelector('.is-editing'));await delay(200);};
 await openEditor();const editorActions=document.querySelector('.is-editing .artist-actions');check([...editorActions.children].map(n=>n.textContent).join('/')==='删除画师/刷新/取消/保存','编辑按钮顺序');check(editorActions.getBoundingClientRect().top<document.querySelector('.is-editing .edit-grid').getBoundingClientRect().top,'编辑按钮放在表单上方右侧');
 document.querySelector('.artist-expand button').click();await until(()=>document.querySelectorAll('.work-picker .pick').length===21);await delay(500);
 const picker=document.querySelector('.work-picker'),pickerGrid=picker.querySelector('.candidate-previews'),page=()=>picker.querySelector('.picker-page').textContent;
 check(document.activeElement===pickerGrid,'手动展开后键盘焦点进入作品');const rects=[...pickerGrid.querySelectorAll('.pick')].map(n=>n.getBoundingClientRect());check(new Set(rects.map(r=>Math.round(r.top))).size===3&&new Set(rects.map(r=>Math.round(r.left))).size===7,'候选作品三行七列');
 check(!picker.querySelector('input[type=range]')&&!/全选|全不选|加载更多/.test(picker.textContent),'移除旧预览与加载控件');check(picker.querySelector('.picker-status .picker-order')&&picker.querySelector('.picker-status .picker-pagination'),'排序与分页置于顶部状态栏');
 let checkbox=picker.querySelector('.pick input');checkbox.click();await until(()=>picker.querySelector('.pick.is-added'));const firstID=picker.querySelector('.pick-id').textContent;
 const flip=key=>pickerGrid.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));checkbox.dispatchEvent(new KeyboardEvent('keydown',{key:'d',bubbles:true}));await until(()=>page().startsWith('第 2'));check(picker.querySelector('.pick-id').textContent!==firstID,'翻页替换当前作品');checkbox=picker.querySelector('.pick input');checkbox.click();await until(()=>picker.querySelector('.pick.is-added'));flip('ArrowLeft');await until(()=>page().startsWith('第 1'));check(picker.querySelector('.pick input').checked,'返回上一页保留勾选');flip('ArrowRight');await until(()=>page().startsWith('第 2'));flip('a');await until(()=>page().startsWith('第 1'));check(pickerGrid.children.length===21,'翻页不积累DOM');
 const select=picker.querySelector('select');select.value='score';select.dispatchEvent(new Event('change'));await until(()=>picker.querySelector('.pick-id').textContent==='#90064');check(page().startsWith('第 1'),'换排序返回第一页');
 await closeEditor();$('settings-open').click();$('auto-open-works').checked=true;await $('auto-open-works').onchange();$('settings').close();await delay(220);
 await openEditor();await until(()=>document.querySelector('.work-picker .pick'));check(document.activeElement!==document.querySelector('.candidate-previews'),'自动展开不抢作品区焦点');check(document.querySelector('.editor-head').getBoundingClientRect().top>=0,'自动展开保留编辑头部可见');await closeEditor();
 $('settings-open').click();$('auto-open-works').checked=false;await $('auto-open-works').onchange();$('settings').close();await delay(220);
 // 编辑中的草稿不因修改筛选而丢失，排序也不销毁编辑表单。
 $('add-artist').click();await until(()=>document.querySelector('.is-editing'));
 const name=document.querySelector('input[placeholder="画师名字（必填）"]');name.value='未保存草稿';name.dispatchEvent(new Event('input',{bubbles:true}));input('search','完全无匹配');await delay(180);check(name===document.querySelector('input[placeholder="画师名字（必填）"]'),'筛选不能销毁正在编辑的表单节点');check(document.querySelector('input[placeholder="画师名字（必填）"]').value==='未保存草稿','筛选变化保留编辑草稿');
 [...document.querySelector('.is-editing').querySelectorAll('button')].find(b=>b.textContent==='取消').click();await until(()=>!document.querySelector('.is-editing'));$('reset').click();
 // 真实 DOM 压力：注入资料快照模拟读取，图片不走网络、不接触真实目录。
 const large={...data,artists:Array.from({length:2000},(_,i)=>({...data.artists[i%24],uid:String(i+1).padStart(4,'0')+'-stress'+i+'-manual',name:'stress_artist_'+i,order:i+1}))};
 const read=FolderStore.read;FolderStore.read=async()=>large;
 let measured=0;const rect=Element.prototype.getBoundingClientRect;Element.prototype.getBoundingClientRect=function(){if(this.classList?.contains('artist-slot'))measured++;return rect.call(this);};
 const begin=performance.now();try{await $('choose-folder').onclick();}finally{FolderStore.read=read;Element.prototype.getBoundingClientRect=rect;}
 const openMs=Math.round(performance.now()-begin);await delay(350);check($('gallery').children.length===2000,'完整元数据列表应可用');
 const initialCards=document.querySelectorAll('.artist').length;check(initialCards<25,'2000 位画师只挂载附近卡片：'+initialCards);check(measured<150,'布局测量不得随两千条数据一起增长：'+measured);
 window.scrollTo(0,document.body.scrollHeight);await delay(500);const afterScroll=document.querySelectorAll('.artist').length;check(afterScroll<30,'滚动后旧卡片应卸载：'+afterScroll);check(ArtistImages.stats().bound<160,'离屏图片绑定必须释放');
 const searchBegin=performance.now();input('search','stress_artist_1999');await until(()=>$('gallery').children.length===1);const searchMs=Math.round(performance.now()-searchBegin);check($('gallery').firstElementChild.dataset.uid===large.artists[1999].uid,'长列表查询正确');
 input('search','没有符合条件的画师');await until(()=>!$('empty').hidden);check($('empty-action').textContent==='清除全部筛选','无匹配时应提供可执行的恢复入口');$('empty-action').click();check($('gallery').children.length===2000,'清除筛选恢复全列表');
 return {searchAliasesAndNotes:true,composingInput:true,filterFocus:true,sortStable:true,keyboardCommands:true,dialogLabels:true,draftPreserved:true,artists:2000,initialCards,afterScroll,layoutMeasurements:measured,openMs,searchIncludingDebounceMs:searchMs,imageResources:ArtistImages.stats()};
}
