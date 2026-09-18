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
