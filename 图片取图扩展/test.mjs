import {fetchImage,resolvePost} from './probe.mjs';
const $=id=>document.getElementById(id);let objectUrl,report;
function showReport(){ $('report').textContent=JSON.stringify(report,null,2); }
async function run(byPost){
  if(!$('test-image').disabled){
    $('test-image').disabled=$('test-post').disabled=$('copy-report').disabled=true;$('copy-status').textContent='';$('preview').hidden=true;
    if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}$('image').removeAttribute('src');
    const started=performance.now();report={time:new Date().toISOString(),version:chrome.runtime.getManifest().version,mode:byPost?'作品接口 → 图片':'图片直连',credentials:$('session').checked?'include':'omit',requests:[],result:'RUNNING'};
    $('status').dataset.state='running';$('status').textContent='正在读取图片，单次请求最多等待 20 秒…';showReport();
    const options={credentials:report.credentials,report:entry=>{report.requests.push(entry);showReport();}};
    try{
      const url=byPost?await resolvePost($('post-id').value,options):$('image-url').value.trim();report.imageUrl=url;
      const blob=await fetchImage(url,options);objectUrl=URL.createObjectURL(blob);const img=$('image');img.src=objectUrl;
      try{await img.decode();}catch{throw Error('服务器声明为图片，但浏览器无法解码，尚未通过测试。');}
      if(!img.naturalWidth||!img.naturalHeight)throw Error('图片尺寸无效，尚未通过测试。');
      report.result='PASS';report.bytes=blob.size;report.width=img.naturalWidth;report.height=img.naturalHeight;
      $('preview').hidden=false;$('dimensions').textContent=`${img.naturalWidth} × ${img.naturalHeight} · ${blob.size.toLocaleString()} 字节`;
      $('save-image').href=objectUrl;$('save-image').download='danbooru-preview.'+(blob.type==='image/jpeg'?'jpg':blob.type.split('/')[1]);
      $('status').dataset.state='pass';$('status').textContent='通过：扩展已取得并解码图片，可以继续验证与画师库的连接。';
    }catch(error){report.result='FAIL';report.error=error.name==='TimeoutError'?'请求超时。':error.message;report.errorType=error.name;$('status').dataset.state='fail';$('status').textContent='未通过：'+report.error;}
    finally{report.elapsedMs=Math.round(performance.now()-started);showReport();$('test-image').disabled=$('test-post').disabled=$('copy-report').disabled=false;}
  }
}
$('test-image').onclick=()=>run(false);$('test-post').onclick=()=>run(true);
$('copy-report').onclick=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(report,null,2));$('copy-status').textContent='已复制';}catch{$('copy-status').textContent='请直接选中上方记录并复制。';}};

/* 环境探测：判断「把画师库.html 集成进扩展」这条路走不走得通。
   要点有两个——扩展页能不能用文件夹选择器，扩展页直连 Danbooru 能不能带上登录 Cookie。 */
const probe={version:chrome.runtime.getManifest().version,origin:location.origin,protocol:location.protocol,at:new Date().toISOString()};
const showProbe=()=>{$('probe-report').textContent=JSON.stringify(probe,null,2);};
const verdict=(node,ok,text)=>{node.dataset.state=ok?'pass':'fail';node.textContent=text;showProbe();};
/* 1) 文件夹：选一个目录，在里面写一个小文件、读回来、再删掉，走完整条链路才算通过。 */
$('probe-folder').onclick=async()=>{
  const status=$('probe-folder-status');
  verdict(status,false,'正在等待你选择文件夹…');
  try{
    if(typeof window.showDirectoryPicker!=='function')throw Error('这个环境里没有 showDirectoryPicker');
    const dir=await window.showDirectoryPicker({id:'artist-library-probe',mode:'readwrite'});
    const permission=await dir.queryPermission({mode:'readwrite'});
    const name='画师库探测-可以删除.tmp',payload='probe '+Date.now();
    let roundTrip=false;
    try{
      const handle=await dir.getFileHandle(name,{create:true}),writable=await handle.createWritable();
      await writable.write(payload);await writable.close();
      roundTrip=(await (await handle.getFile()).text())===payload;
    }finally{try{await dir.removeEntry(name);}catch{}}
    probe.folder={ok:roundTrip,dirName:dir.name,permission,roundTrip,note:'已删除探测文件'};
    verdict(status,roundTrip,roundTrip?`通过：选到「${dir.name}」，写入/读回/删除都成功。`:'能选文件夹，但读写没走通，看下面记录。');
  }catch(error){probe.folder={ok:false,errorType:error.name,error:error.message};verdict(status,false,`未通过：${error.name} · ${error.message}`);}
};
/* 2) 登录态：直连 Danbooru 拉三条作品，看图片地址字段有没有回来（那三个字段只对可见用户返回）。 */
$('probe-cookie').onclick=async()=>{
  const status=$('probe-cookie-status');
  verdict(status,false,'正在请求 danbooru.donmai.us…');
  try{
    const response=await fetch('https://danbooru.donmai.us/posts.json?limit=3',{credentials:'include',cache:'no-store'});
    const posts=await response.json();
    const list=Array.isArray(posts)?posts:[];
    const withImage=list.filter(post=>post.preview_file_url||post.large_file_url||post.file_url).length;
    probe.cookie={ok:response.status===200&&withImage>0,status:response.status,count:list.length,withImageUrl:withImage,ids:list.map(post=>post.id)};
    verdict(status,probe.cookie.ok,probe.cookie.ok?`通过：${list.length} 条作品里 ${withImage} 条带图片地址，登录态有效。`:`未通过：HTTP ${response.status}，${list.length} 条作品里只有 ${withImage} 条带图片地址——登录 Cookie 没生效。`);
  }catch(error){probe.cookie={ok:false,errorType:error.name,error:error.message};verdict(status,false,`未通过：${error.name} · ${error.message}`);}
};
$('probe-copy').onclick=async()=>{const text=JSON.stringify(probe,null,2);try{await navigator.clipboard.writeText(text);$('probe-copy-status').textContent='已复制，发给我就行';}catch{$('probe-copy-status').textContent='复制失败，请手动选中记录复制。';}};
showProbe();
