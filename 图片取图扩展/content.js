(() => {
  if(window!==window.top||location.protocol!=='file:'||decodeURIComponent(location.pathname).split('/').pop()!=='画师库.html'||!document.querySelector('meta[name="artist-library"][content="v1"]'))return;
  const reply=(id,result)=>window.postMessage({channel:'artist-images-reply-v1',id,...result},'*');
  window.addEventListener('message',async event=>{
    const m=event.data;if(event.source!==window||m?.channel!=='artist-images-v1'||typeof m.id!=='string'||m.id.length>100||!['ping','image','cancel'].includes(m.type))return;
    try{const result=await chrome.runtime.sendMessage({channel:m.channel,id:m.id,type:m.type,url:m.url});reply(m.id,result||{ok:false,error:'扩展未响应，请刷新扩展和画师库'});}catch(e){reply(m.id,{ok:false,error:'扩展连接已失效，请重新打开画师库'});}
  });
  window.postMessage({channel:'artist-images-ready-v1',version:chrome.runtime.getManifest().version},'*');
})();
