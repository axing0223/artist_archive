// 密度切换逐帧回归：独立浏览器 + OPFS 演示图片，不接触真实资料。
// DENSITY_ARTISTS=2000 以复用图片的元数据快照检查虚拟列表；默认 24 位。
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

 await send('Runtime.evaluate',{expression:'window.densityTestCount='+JSON.stringify(Number(process.env.DENSITY_ARTISTS)||24)});
 const result=await send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:'('+densityChecks.toString()+')()'});
 if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
 assert.deepEqual(errors,[],'密度切换不应产生页面异常');
 const report=result.result.value;
 await fs.mkdir(path.join(root,'.ui-artifacts'),{recursive:true});
 await fs.writeFile(path.join(root,'.ui-artifacts/density-frames.json'),JSON.stringify(report,null,2));
 const summary=report.map(({frames,...rest})=>rest);console.log(JSON.stringify(summary,null,2));
 assert.ok(report.every(r=>r.reversal<=2),'布局切换不能先缩小再回弹或来回跳动');
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

async function densityChecks(){
 const delay=ms=>new Promise(r=>setTimeout(r,ms)),report=[];
 const {folder}=await ArtistDemo.seed(Math.min(window.densityTestCount,24));
 if(window.densityTestCount>24){
  const data=await FolderStore.read(folder),large={...data,artists:Array.from({length:window.densityTestCount},(_,i)=>({...data.artists[i%24],uid:String(i+1).padStart(4,'0')+'-density'+i+'-manual',name:'density_artist_'+i,order:i+1}))};
  const read=FolderStore.read;FolderStore.read=async()=>large;
  try{await document.getElementById('choose-folder').onclick();}finally{FolderStore.read=read;}
 }
 await delay(700);
 for(const position of ['top','middle','bottom']){
  if(document.documentElement.dataset.density!=='comfortable'){document.getElementById('density-toggle').click();await delay(800);}
  window.scrollTo(0,position==='top'?0:position==='middle'?2000:document.documentElement.scrollHeight);await delay(650);
  for(const direction of ['compact','comfortable']){
   const slots=[...document.querySelectorAll('.artist-slot')].filter(s=>s.firstElementChild&&s.getBoundingClientRect().bottom>220&&s.getBoundingClientRect().top<innerHeight-40).slice(0,3);
   if(!slots.length)throw Error('必须有可见卡片参与动画测试');
   const frames=[],start=performance.now();
   const sample=()=>{frames.push({t:Math.round(performance.now()-start),scroll:scrollY,rects:slots.map(s=>{const c=s.getBoundingClientRect(),w=s.querySelector('.works')?.getBoundingClientRect();return {y:c.top,h:c.height,x:w?.left,width:w?.width};})});};
   sample();document.getElementById('density-toggle').click();
   await new Promise(resolve=>{function frame(){sample();if(performance.now()-start<750)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});
   // 取最大反向位移，不累计每帧的亚像素舍入噪声；2px 容差仍能捕获原来的百像素回弹。
   let reversal=0,worst='';
   for(let i=0;i<slots.length;i++)for(const key of ['y','h','x','width']){
    const values=frames.map(f=>f.rects[i][key]).filter(Number.isFinite),sign=values.at(-1)>=values[0]?1:-1;let peak=sign*values[0],back=0;
    for(const value of values){peak=Math.max(peak,sign*value);back=Math.max(back,peak-sign*value);}
    if(back>reversal){reversal=back;worst=i+':'+key;}
   }
   if(document.documentElement.dataset.density!==direction)throw Error('布局切换未完成');
   if(document.querySelector('.is-changing-density')||document.documentElement.style.overflowAnchor)throw Error('布局动画临时状态未清理');
   const mounted=document.querySelectorAll('.artist').length;if(mounted>35)throw Error('切换后离屏卡片未回收：'+mounted);
   report.push({artists:window.densityTestCount,position,direction,mounted,reversal:Math.round(reversal*100)/100,worst,frames});await delay(150);
  }
 }
 return report;
}
