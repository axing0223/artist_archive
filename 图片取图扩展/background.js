import {fetchImage,resolvePost,fetchApi,imageUrl,generateImage} from './probe.mjs';
import {allowedSender} from './bridge-policy.mjs';
chrome.action.onClicked.addListener(()=>chrome.tabs.create({url:chrome.runtime.getURL('test.html')}));
const CHUNK=4*1024*1024,MAX_BYTES=50*1024*1024,KEEP=120000,GENERATE_URL='https://image.novelai.net/ai/generate-image';
const jobs=new Map(),queue=[];let active=0;
function sweep(){const now=Date.now();for(const [key,job] of jobs)if(job.expires&&job.expires<now)jobs.delete(key);}
function pump(){while(active<3&&queue.length){const job=queue.shift();if(job.controller.signal.aborted){jobs.delete(job.key);job.respond({ok:false,error:'已取消'});continue;}active++;run(job).finally(()=>{active--;pump();});}}
async function run(job){
  try{
    /* 生图要等几十秒，取图 60 秒足够；两者共用一套分块回传。 */
    const blob=job.generate
      ?await generateImage(job.url,job.body,{token:job.token,signal:AbortSignal.any([job.controller.signal,AbortSignal.timeout(180000)]),maxBytes:MAX_BYTES})
      :await fetchImage(job.url,{credentials:'include',signal:AbortSignal.any([job.controller.signal,AbortSignal.timeout(60000)]),maxBytes:MAX_BYTES});
    const bytes=new Uint8Array(await blob.arrayBuffer());let s='';
    for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));
    job.base64=btoa(s);job.expires=Date.now()+KEEP;
    job.respond({ok:true,type:blob.type,bytes:bytes.length,chunks:Math.max(1,Math.ceil(job.base64.length/CHUNK))});
  }catch(error){jobs.delete(job.key);job.respond({ok:false,error:error.name==='TimeoutError'?'请求超时':error.message});}
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!allowedSender(sender,chrome.runtime.id)||message?.channel!=='artist-images-v1')return;
  if(message.type==='ping'){respond({ok:true,version:chrome.runtime.getManifest().version});return;}
  if(typeof message.id!=='string'||message.id.length>100)return;
  const key=sender.tab.id+':'+message.id;
  if(message.type==='cancel'){jobs.get(key)?.controller.abort();jobs.delete(key);respond({ok:true});return;}
  if(message.type==='chunk'){
    sweep();const job=jobs.get(key);
    if(!job||!job.base64){respond({ok:false,error:'数据已过期，请重新获取'});return;}
    const index=Number(message.index);
    if(!Number.isSafeInteger(index)||index<0){respond({ok:false,error:'分块编号无效'});return;}
    respond({ok:true,index,data:job.base64.slice(index*CHUNK,(index+1)*CHUNK)});return;
  }
  if(message.type==='resolve'){
    resolvePost(message.url).then(url=>respond({ok:true,url}),error=>respond({ok:false,error:error.name==='TimeoutError'?'作品信息请求超时':error.message}));
    return true;
  }
  if(message.type==='api'){
    fetchApi(message.url).then(result=>respond({ok:true,status:result.status,json:result.json}),error=>respond({ok:false,error:error.name==='TimeoutError'?'接口请求超时':error.message}));
    return true;
  }
  if(message.type==='generate'){
    /* 页面送来的地址一律换成写死的端点：扩展不能变成任意 POST 代理。 */
    try{sweep();if(queue.length>=24||jobs.has(key))throw Error('请求队列已满，请稍后重试');const job={key,url:GENERATE_URL,body:message.body,token:message.token,generate:true,respond,controller:new AbortController()};jobs.set(key,job);queue.push(job);pump();}
    catch(e){respond({ok:false,error:e.message});}return true;
  }
  if(message.type!=='image')return;
  try{sweep();const url=imageUrl(message.url);if(queue.length>=24||jobs.has(key))throw Error('图片队列已满，请稍后重试');const job={key,url,respond,controller:new AbortController()};jobs.set(key,job);queue.push(job);pump();}
  catch(e){respond({ok:false,error:e.message});}return true;
});
