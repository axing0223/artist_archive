(() => {
  const pending=new Map();let connected=false,version='';
  /* 接口通道是 0.3.2 才有的。旧扩展不认这个类型，会静默丢弃消息、让页面干等到超时，
     所以先按版本判断能不能用，不能用就直接让调用方退回直连。 */
  const API_VERSION=[0,3,2];
  const supportsApi=value=>{
    const parts=String(value||'').split('.').map(Number);
    if(parts.length<3||parts.some(part=>!Number.isInteger(part)||part<0))return false;
    for(let i=0;i<3;i++)if(parts[i]!==API_VERSION[i])return parts[i]>API_VERSION[i];
    return true;
  };
  window.addEventListener('message',event=>{const m=event.data;if(event.source!==window)return;if(m?.channel==='artist-images-ready-v1'){connected=true;version=String(m.version||'');for(const [id,task] of pending)if(task.type==='ping'){task.finish();task.resolve({version:m.version});}return;}if(m?.channel!=='artist-images-reply-v1')return;const task=pending.get(m.id);if(!task)return;task.finish();m.ok?task.resolve(m):task.reject(Error(m.error||'扩展取图失败'));});
  function request(type,url,signal){return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new DOMException('已取消','AbortError'));return;}
    const id=crypto.randomUUID();let timer;const finish=()=>{clearTimeout(timer);pending.delete(id);signal?.removeEventListener('abort',abort);};
    const abort=()=>{finish();window.postMessage({channel:'artist-images-v1',type:'cancel',id},'*');reject(new DOMException('已取消','AbortError'));};
    pending.set(id,{resolve,reject,finish,type});signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{finish();window.postMessage({channel:'artist-images-v1',type:'cancel',id},'*');reject(Error(type==='ping'?'未连接扩展：请更新扩展、开启“允许访问文件网址”，再重新打开本网页。':'扩展请求超时，请检查连接或稍后重试。'));},type==='ping'?2000:30000);
    window.postMessage({channel:'artist-images-v1',type,id,url},'*');
  });}
  window.ArtistExtension={get connected(){return connected;},get version(){return version;},get canFetchApi(){return connected&&supportsApi(version);},async check(){try{const result=await request('ping');connected=true;version=String(result?.version||'');return result.version;}catch(error){connected=false;version='';throw error;}},async resolve(id,signal){if(!connected)await this.check();const r=await request('resolve',id,signal);if(typeof r.url!=='string'||!r.url.startsWith('https://'))throw Error('扩展返回了无效的原图地址');return r.url;},async image(url,signal){if(!connected)await this.check();const r=await request('image',url,signal);if(!/^data:image\/(jpeg|png|webp|gif|avif);base64,[a-zA-Z0-9+/=]+$/.test(r.data))throw Error('扩展返回了无效图片');return (await fetch(r.data)).blob();},async api(url,signal){if(!connected)await this.check();const r=await request('api',url,signal);const status=Number(r.status)||0;return {ok:status>=200&&status<300,status,json:async()=>r.json};}};
})();
