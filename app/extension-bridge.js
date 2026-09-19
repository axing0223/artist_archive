(() => {
  const pending=new Map();let connected=false,version='';
  /* 接口通道是 0.3.2、生图通道是 0.4.0 才有的。旧扩展不认这些类型，会静默丢弃消息、
     让页面干等到超时，所以先按版本判断能不能用，不能用就直接让调用方退回直连。 */
  const API_VERSION=[0,3,2],GENERATE_VERSION=[0,4,0];
  const supports=(value,required)=>{
    const parts=String(value||'').split('.').map(Number);
    if(parts.length<3||parts.some(part=>!Number.isInteger(part)||part<0))return false;
    for(let i=0;i<3;i++)if(parts[i]!==required[i])return parts[i]>required[i];
    return true;
  };
  window.addEventListener('message',event=>{const m=event.data;if(event.source!==window)return;if(m?.channel==='artist-images-ready-v1'){connected=true;version=String(m.version||'');for(const [id,task] of pending)if(task.type==='ping'){task.finish();task.resolve({version:m.version});}return;}if(m?.channel!=='artist-images-reply-v1')return;const task=pending.get(m.id);if(!task)return;task.finish();m.ok?task.resolve(m):task.reject(Error(m.error||'扩展取图失败'));});
  /* 生图一张要等几十秒，超时时间不能和取图一样。 */
  const TIMEOUT={ping:2000,generate:180000},DEFAULT_TIMEOUT=30000;
  function request(type,payload,signal){return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new DOMException('已取消','AbortError'));return;}
    const id=crypto.randomUUID();let timer;const finish=()=>{clearTimeout(timer);pending.delete(id);signal?.removeEventListener('abort',abort);};
    const abort=()=>{finish();window.postMessage({channel:'artist-images-v1',type:'cancel',id},'*');reject(new DOMException('已取消','AbortError'));};
    pending.set(id,{resolve,reject,finish,type});signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{finish();window.postMessage({channel:'artist-images-v1',type:'cancel',id},'*');reject(Error(type==='ping'?'未连接扩展：请更新扩展、开启“允许访问文件网址”，再重新打开本网页。':type==='generate'?'生图请求超时：NovelAI 可能正忙，稍后可重试。':'扩展请求超时，请检查连接或稍后重试。'));},TIMEOUT[type]||DEFAULT_TIMEOUT);
    window.postMessage({channel:'artist-images-v1',type,id,...payload},'*');
  });}
  window.ArtistExtension={get connected(){return connected;},get version(){return version;},get canFetchApi(){return connected&&supports(version,API_VERSION);},get canGenerate(){return connected&&supports(version,GENERATE_VERSION);},async check(){try{const result=await request('ping',{});connected=true;version=String(result?.version||'');return result.version;}catch(error){connected=false;version='';throw error;}},async resolve(id,signal){if(!connected)await this.check();const r=await request('resolve',{url:id},signal);if(typeof r.url!=='string'||!r.url.startsWith('https://'))throw Error('扩展返回了无效的原图地址');return r.url;},async image(url,signal){if(!connected)await this.check();const r=await request('image',{url},signal);if(!/^data:image\/(jpeg|png|webp|gif|avif);base64,[a-zA-Z0-9+/=]+$/.test(r.data))throw Error('扩展返回了无效图片');return (await fetch(r.data)).blob();},async api(url,signal){if(!connected)await this.check();const r=await request('api',{url},signal);const status=Number(r.status)||0;return {ok:status>=200&&status<300,status,json:async()=>r.json};},async generate(body,token,signal){if(!connected)await this.check();const r=await request('generate',{url:'https://image.novelai.net/ai/generate-image',body,token},signal);if(!/^data:application\/zip;base64,[a-zA-Z0-9+/=]+$/.test(r.data))throw Error('扩展返回了无效的生图结果');return (await fetch(r.data)).blob();}};
})();
