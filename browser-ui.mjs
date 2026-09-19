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
 await evaluate('ArtistDemo.seed(24)');await evaluate('window.scrollTo(0,0)');await sleep(650);
 const capture=async name=>{const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,name+'.png'),Buffer.from(shot.data,'base64'));};
 await capture('portrait-dark');
 const fiveImages=()=>JSON.stringify([...document.querySelectorAll('.artist:not(.is-editing) .works')].map(row=>{const works=[...row.querySelectorAll(':scope > .work')],rects=works.map(n=>n.getBoundingClientRect());return {count:works.length,oneLine:Math.max(...rects.map(r=>r.top))-Math.min(...rects.map(r=>r.top))<1,fits:rects.every(r=>r.left>=0&&r.right<=innerWidth),contain:[...row.querySelectorAll('img')].every(img=>getComputedStyle(img).objectFit==='contain')};}));
 const verifyFive=async label=>{const rows=JSON.parse(await evaluate('('+fiveImages.toString()+')()'));assert.ok(rows.length>0,label+' 必须显示卡片');assert.ok(rows.every(row=>row.count===5&&row.oneLine&&row.fits&&row.contain),label+' 五图完整同行：'+JSON.stringify(rows));};
 await verifyFive('1080×1920 竖屏');
 await evaluate('document.getElementById("theme-toggle").click()');await sleep(200);await capture('portrait-light');await evaluate('document.getElementById("theme-toggle").click()');
 await evaluate('document.getElementById("settings-open").click()');await sleep(250);await capture('settings');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 assert.equal(await evaluate('document.querySelectorAll("dialog[open]").length'),0,'真实 Escape 必须关闭对话框');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await sleep(450);
 await capture('mobile');
 const mobile=await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})');assert.ok(mobile.scroll<=mobile.width,'390px 窄窗口不能横向溢出');await verifyFive('390px 窄窗口');
 await evaluate('document.getElementById("filter-toggle").click()');assert.equal(await evaluate('document.getElementById("filter-panel").hidden'),false);await evaluate('document.getElementById("filter-toggle").click()');
 await evaluate('document.getElementById("settings-open").click()');await sleep(200);assert.equal(await evaluate('document.getElementById("settings").scrollWidth<=document.getElementById("settings").clientWidth+1'),true,'设置弹窗在窄屏不能横向溢出');await evaluate('document.getElementById("settings").close()');
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
 const {folder,data}=await ArtistDemo.seed(24);window.scrollTo(0,0);await until(()=>document.querySelectorAll('.artist').length>1);
 const input=(id,value)=>{$(id).value=value;$(id).dispatchEvent(new Event('input',{bubbles:true}));};
 input('search','空野 春日');await until(()=>$('gallery').children.length===1);check($('gallery').firstElementChild.dataset.uid===data.artists[0].uid,'搜索必须同时匹配笔名和备注');
 $('reset').click();await until(()=>$('gallery').children.length===24);
 const category=[...$('categories').children].find(b=>b.dataset.filterKey==='category:场景 / 环境');category.focus();category.click();
 check(document.activeElement.dataset.filterKey==='category:场景 / 环境','分类重绘后必须保留键盘焦点');check($('gallery').children.length===8,'分类筛选必须正确');check($('active-filters').children.length===1,'已选分类应显示可移除条件');
 $('active-filters').firstElementChild.click();check($('gallery').children.length===24,'移除条件恢复完整列表');
 $('library-sort').value='score';$('library-sort').dispatchEvent(new Event('change'));check($('gallery').children[1].dataset.uid===data.artists[5].uid,'评分排序同分时维持原始顺序');
 $('library-sort').value='order';$('library-sort').dispatchEvent(new Event('change'));
 const prior=$('gallery').children.length;$('search').value='尚未输入完成';$('search').dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));await delay(180);check($('gallery').children.length===prior,'中文组合输入期间不得触发查询');
 $('search').value='mizu_no_oto';$('search').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));await until(()=>$('gallery').children.length===4);$('reset').click();
 document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'/',bubbles:true}));check(document.activeElement===$('search'),'斜杠聚焦搜索');
 $('command-open').click();check($('command-dialog').open,'快捷操作应打开');input('command-search','资料库设置');check($('command-results').querySelectorAll('button').length===1,'快捷操作支持搜索');$('command-search').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));check(!$('command-dialog').open&&$('settings').open,'回车执行所选操作');$('settings').close();
 const menu=document.querySelector('.card-menu');menu.open=true;const remove=menu.querySelector('button');remove.click();check(menu.open&&remove.classList.contains('is-armed'),'删除第一次确认时菜单应保持展开');check($('gallery').children.length===24,'第一次确认不能删除画师');menu.open=false;
 $('quick-open').click();check($('quick-dialog').open&&document.activeElement===$('quick-input'),'识别添加直接聚焦输入');$('quick-dialog').querySelector('[data-close-dialog]').click();
 document.querySelector('.thumb').click();await until(()=>$('viewer').open);check($('viewer-position').textContent==='1 / 5','预览显示完整图片序号');$('viewer-next').click();check($('viewer-position').textContent==='2 / 5','可切到下一张');$('viewer').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));check($('viewer-position').textContent==='1 / 5','方向键可切回上一张');$('viewer').close();
 $('manage-tags').click();$('tab-category').focus();$('tab-category').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));check(document.activeElement===$('tab-tag')&&!$('panel-tag').hidden,'标签页支持方向键切换');$('tag-manager').close();
 $('density-toggle').click();check(document.documentElement.dataset.density==='compact','布局密度切换生效');check(localStorage.getItem('artist-library.density')==='compact','布局密度需持久化');$('density-toggle').click();
 $('status-toggle').click();check($('activity-list').children.length>0,'活动记录应包含连接和保存状态');$('activity-dialog').close();
 // 对话框实际渲染、所有表单标签、DOM 唯一标识。
 const pairs=[['settings-open','settings'],['gen-settings-open','gen-settings'],['batch-artists','batch-dialog'],['gen-batch-open','gen-batch'],['test-import-open','test-import']];
 for(const [trigger,id] of pairs){$(trigger).click();check($(id).open,id+' 应可打开');check($(id).scrollWidth<=$(id).clientWidth+1,id+' 内容不得横向溢出');$(id).close();}
 const ids=[...document.querySelectorAll('[id]')].map(n=>n.id);check(new Set(ids).size===ids.length,'页面 ID 必须唯一');
 const unlabeled=[...document.querySelectorAll('input:not([type=hidden]):not([hidden]),select,textarea')].filter(n=>!n.getAttribute('aria-label')&&!n.getAttribute('aria-labelledby')&&!n.labels?.length);
 check(!unlabeled.length,'可见表单控件必须有名称：'+unlabeled.map(n=>n.id).join(','));
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
