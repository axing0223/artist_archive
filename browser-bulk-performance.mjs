// 批量性能回归：真实 Chrome/Edge + 独立 OPFS，站点请求由固定数据替代。
// PERF_BULK_ARTISTS=300；PERF_BASELINE_REF=<提交> 可对照旧版，仅关闭性能阈值。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=path.dirname(fileURLToPath(import.meta.url));
const candidates=[process.env.BROWSER_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
let executable;for(const candidate of candidates)if(await fs.stat(candidate).catch(()=>null)){executable=candidate;break;}
if(!executable||typeof WebSocket==='undefined')throw Error('需要 Node.js 22+ 和 Chrome/Edge；可用 BROWSER_PATH 指定浏览器可执行文件。');
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'artist-library-smoke-'));
const appRoot=path.join(root,'app');
const baseline=process.env.PERF_BASELINE_REF||'';
const assets=new Map();
for(const name of await fs.readdir(appRoot)){
 assets.set(name,baseline?execFileSync('git',['-c','safe.directory='+root,'show',baseline+':app/'+name],{cwd:root,windowsHide:true}):await fs.readFile(path.join(appRoot,name)));
}
async function browserChecks({artistCount,baseline}){
 const check=(condition,message)=>{if(!condition)throw Error(message);};
 const $=id=>document.getElementById(id),folder=await navigator.storage.getDirectory();
 window.showDirectoryPicker=async()=>folder;
 const canvas=document.createElement('canvas');canvas.width=canvas.height=32;
 canvas.getContext('2d').fillRect(0,0,32,32);
 const pixel=canvas.toDataURL('image/png'),blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
 const seed=FolderStore.empty();
 seed.artists=Array.from({length:artistCount},(_,i)=>({uid:ArtistId.create({seq:i+1,name:'seed'+i}),name:'seed'+i,tags:[],works:[{id:'seed'+i,thumb:pixel}],counts:{total:0}}));
 console.info('准备真实测试文件：'+artistCount+' 位');
 await FolderStore.write(folder,seed);console.info('测试文件已准备，加载资料库');await $('choose-folder').onclick();
 ArtistLookup.lookup=async()=>[];
 ArtistLookup.details=async(name,date,{previews}={})=>({counts:{total:10,beforeTotal:5,beforeDate:date,checkedAt:'performance'},countsError:false,works:previews?[{id:name,thumbUrl:'https://example.com/'+name+'.png'}]:[]});
 ArtistImages.dataUrl=async()=>pixel;
 const nativeValues=FileSystemDirectoryHandle.prototype.values,nativeWritable=FileSystemFileHandle.prototype.createWritable;
 const nativeWrite=FolderStore.write,nativeRender=ArtistGallery.render,Reader=window.FileReader;
 let counters=null,inStore=false,readers=0;
 FileSystemDirectoryHandle.prototype.values=function(...args){
  if(counters&&inStore&&['缩略图','大图'].includes(this.name))counters.imageTraversals++;
  return nativeValues.apply(this,args);
 };
 FileSystemFileHandle.prototype.createWritable=function(...args){
  if(counters&&inStore&&this.name==='信息.json')counters.metadataWrites++;
  return nativeWritable.apply(this,args);
 };
 FolderStore.write=async(...args)=>{
  if(counters){counters.saves++;counters.artistRecords+=args[1].artists.length;counters.firstWriteAfterReads??=readers;}
  inStore=true;try{return await nativeWrite(...args);}finally{inStore=false;}
 };
 ArtistGallery.render=(...args)=>{if(counters)counters.renders++;return nativeRender(...args);};
 window.FileReader=class extends Reader{readAsDataURL(...args){readers++;return super.readAsDataURL(...args);}};
 const rows=[];
 const measure=async(action,run)=>{
  console.info('开始：'+action);
  readers=0;counters={action,saves:0,artistRecords:0,imageTraversals:0,metadataWrites:0,renders:0,firstWriteAfterReads:null};
  const started=performance.now();await run();
  const row={...counters,ms:Math.round(performance.now()-started)};rows.push(row);counters=null;console.info('完成：'+action+'，'+row.ms+' ms');return row;
 };
 try{
  const refreshed=await measure('刷新数量',()=>$('sync-all').onclick());
  const refreshedData=await FolderStore.read(folder);
  check(refreshedData.artists.length===artistCount&&refreshedData.artists.every(a=>a.counts.total===10),'刷新结果必须持久化');
  check(refreshed.metadataWrites===artistCount,'每位刷新画师只写一次资料');
  if(!baseline)check(refreshed.imageTraversals===0,'数量更新不能遍历图片目录');

  $('batch-names').value=Array.from({length:100},(_,i)=>'added'+i).join('\n');
  $('batch-works').checked=true;$('batch-generate').checked=false;
  const collected=await measure('采集100位',()=>$('batch-form').onsubmit({preventDefault(){}}));
  const collectedData=await FolderStore.read(folder),added=collectedData.artists.slice(artistCount);
  check(added.length===100&&added.every(a=>a.counts.total===10&&FolderStore.imageOf(a.works[0],'thumb')?.kind==='local'),'全部采集结果与图片必须落盘');
  if(!baseline){
   check(collected.saves<=15,'快速采集应合并保存，实际 '+collected.saves+' 次');
   check(collected.metadataWrites===200,'新增和采集各写一次，不能重写旧画师或重复写新增画师');
  }

  let outputWrites=0;
  const exported=await measure('导出备份',async()=>{
   const file=await folder.getFileHandle('性能备份.json',{create:true}),stream=await file.createWritable();
   try{await FolderStore.exportTo(folder,collectedData,{write:async value=>{outputWrites++;await stream.write(value);}});await stream.close();}
   catch(error){await stream.abort();throw error;}
   const backup=JSON.parse(await(await file.getFile()).text());
   check(backup.artists.length===artistCount+100,'导出备份必须可解析且人数完整');
  });
  exported.outputWrites=outputWrites;
  if(!baseline)check(outputWrites<100,'备份应合并文件流写入');

  ArtistTestImages.files=Array.from({length:25},(_,i)=>new File([blob],'test'+i+'.png',{type:'image/png'}));
  $('test-start').value='1';$('test-seq').value='2';
  const imported=await measure('导入25张测试图',()=>ArtistTestImages.runImport());
  const importedData=await FolderStore.read(folder);
  check(importedData.artists.filter(a=>a.works.some(w=>w.kind==='test'&&w.testSeq===2)).length===25,'导入测试图的持久化结果必须完整');
  if(!baseline)check(imported.firstWriteAfterReads<=10,'不能等全部原图解码完才首次保存');

  ArtistTestImages.renderRemoval();
  for(const input of $('test-remove-list').querySelectorAll('input'))input.checked=input.value==='2';
  await ArtistTestImages.runRemove();
  await measure('删除25张测试图',()=>ArtistTestImages.runRemove());
  const removedData=await FolderStore.read(folder);
  check(removedData.artists.every(a=>a.works.every(w=>w.kind!=='test')),'删除测试图后不能残留引用');
  check(removedData.artists.every(a=>a.works.length===1),'删除测试图必须保留原作品');
  for(const a of removedData.artists.slice(0,25)){
   check((await FolderStore.readImage(folder,a.uid,a.works[0].thumb)).size>0,'保留的原作品图片必须可读');
   const artist=await(await folder.getDirectoryHandle('画师')).getDirectoryHandle(a.uid);
   for(const kind of ['缩略图','大图'])for await(const entry of (await artist.getDirectoryHandle(kind)).values())check(!entry.name.includes('测试风格2'),'删除后测试图片文件必须清理');
  }
  return {artistCount,rows};
 }finally{
  FolderStore.write=nativeWrite;ArtistGallery.render=nativeRender;window.FileReader=Reader;
  FileSystemDirectoryHandle.prototype.values=nativeValues;FileSystemFileHandle.prototype.createWritable=nativeWritable;
 }
}
const server=http.createServer(async(req,res)=>{
 try{
  const requested=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!requested.startsWith(appRoot+path.sep)){res.writeHead(403).end();return;}
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
  res.setHeader('content-type',mime[path.extname(requested)]||'application/octet-stream');
  res.setHeader('content-security-policy',"script-src 'self'; object-src 'none'; img-src 'self' blob: data:; base-uri 'none'");
  const asset=assets.get(path.basename(requested));if(!asset)throw Error('missing');res.end(asset);
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
  if(message.method==='Runtime.consoleAPICalled')console.error(message.params.args.map(arg=>arg.value??arg.description??'').join(' '));
  const task=pending.get(message.id);if(task){clearTimeout(task.timer);pending.delete(message.id);message.error?task.reject(Error(message.error.message)):task.resolve(message.result);}
 });
 send=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP 超时：'+method));},method==='Runtime.evaluate'?600000:20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 await send('Runtime.enable');await send('Network.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Network.setBlockedURLs',{urls:['https://*']}); // 测试不可请求采集站点或生图服务。
 await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/app/index.html'});
 for(let i=0;i<100;i++){
  const state=await send('Runtime.evaluate',{expression:'document.readyState === "complete" && typeof FolderStore !== "undefined"',returnByValue:true});
  if(state.result.value)break;await sleep(50);
 }
 const result=await send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:'('+browserChecks.toString()+')('+JSON.stringify({artistCount:Number(process.env.PERF_BULK_ARTISTS)||300,baseline:!!baseline})+')'});
 if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
 assert.deepEqual(errors,[],'页面不应出现未处理异常');
 console.log(JSON.stringify({baseline:baseline||null,...result.result.value},null,2));
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
