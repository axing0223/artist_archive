import {fetchImage,imageUrl} from './probe.mjs';
import {allowedSender} from './bridge-policy.mjs';
chrome.action.onClicked.addListener(()=>chrome.tabs.create({url:chrome.runtime.getURL('test.html')}));
const jobs=new Map(),queue=[];let active=0;
function pump(){while(active<3&&queue.length){const job=queue.shift();if(job.controller.signal.aborted){jobs.delete(job.key);job.respond({ok:false,error:'已取消'});continue;}active++;run(job).finally(()=>{active--;jobs.delete(job.key);pump();});}}
async function run(job){try{const blob=await fetchImage(job.url,{credentials:'include',signal:AbortSignal.any([job.controller.signal,AbortSignal.timeout(20000)]),maxBytes:8*1024*1024});let s='';const bytes=new Uint8Array(await blob.arrayBuffer());for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));job.respond({ok:true,data:'data:'+blob.type+';base64,'+btoa(s)});}catch(e){job.respond({ok:false,error:e.name==='TimeoutError'?'图片请求超时':e.message});}}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!allowedSender(sender,chrome.runtime.id)||message?.channel!=='artist-images-v1')return;
  if(message.type==='ping'){respond({ok:true,version:chrome.runtime.getManifest().version});return;}
  if(typeof message.id!=='string'||message.id.length>100)return;
  const key=sender.tab.id+':'+message.id;
  if(message.type==='cancel'){jobs.get(key)?.controller.abort();respond({ok:true});return;}
  if(message.type!=='image')return;
  try{const url=imageUrl(message.url);if(jobs.size>=24||jobs.has(key))throw Error('图片队列已满，请稍后重试');const job={key,url,respond,controller:new AbortController()};jobs.set(key,job);queue.push(job);pump();}
  catch(e){respond({ok:false,error:e.message});}return true;
});
