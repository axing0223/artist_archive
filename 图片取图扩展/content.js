(() => {
  if(window!==window.top||location.protocol!=='file:'||decodeURIComponent(location.pathname).split('/').pop()!=='画师库.html'||!document.querySelector('meta[name="artist-library"][content="v1"]'))return;
  const reply=(id,result)=>window.postMessage({channel:'artist-images-reply-v1',id,...result},'*');
  const send=message=>chrome.runtime.sendMessage(message);
  window.addEventListener('message',async event=>{
    const m=event.data;if(event.source!==window||m?.channel!=='artist-images-v1'||typeof m.id!=='string'||m.id.length>100||!['ping','image','cancel','resolve'].includes(m.type))return;
    try{
      const meta=await send({channel:m.channel,id:m.id,type:m.type,url:m.url});
      if(m.type!=='image'){reply(m.id,meta||{ok:false,error:'扩展未响应，请刷新扩展和画师库'});return;}
      if(!meta?.ok){reply(m.id,meta||{ok:false,error:'扩展未响应，请刷新扩展和画师库'});return;}
      const chunks=Number(meta.chunks);
      if(!Number.isSafeInteger(chunks)||chunks<1)throw Error('扩展返回的图片尺寸信息无效，请更新扩展后重试');
      let data='';
      for(let index=0;index<chunks;index++){
        const part=await send({channel:m.channel,id:m.id,type:'chunk',index});
        if(!part?.ok)throw Error(part?.error||'图片分块读取失败');
        data+=part.data;
      }
      reply(m.id,{ok:true,data:'data:'+meta.type+';base64,'+data});
    }catch(e){reply(m.id,{ok:false,error:e.message||'扩展连接已失效，请重新打开画师库'});}
  });
  window.postMessage({channel:'artist-images-ready-v1',version:chrome.runtime.getManifest().version},'*');
})();
