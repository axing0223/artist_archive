(() => {
  const cache=new ImageResources.ByteCache(),queue=new ImageResources.Queue(3),bindings=new Map(),failures=new Map();let folder,epoch=0;
  const key=(uid,w)=>w.file?'local:'+epoch+':'+uid+':'+w.file:w.image;
  async function get(uid,w,signal){
    const id=key(uid,w),hit=cache.get(id);if(hit)return hit;
    const failed=failures.get(id);if(failed&&Date.now()-failed.time<30000)throw Error(failed.message);
    const requestedFolder=folder,requestedEpoch=epoch;
    return queue.run(async()=>{const existing=cache.get(id);if(existing)return existing;try{
      let blob;
      if(w.file){if(!requestedFolder)throw Error('请先选择数据文件夹');blob=await FolderStore.readImage(requestedFolder,uid,w.file);}
      else if(w.image?.startsWith('data:'))blob=await (await fetch(w.image)).blob();
      else blob=await ArtistExtension.image(w.image,signal);
      if(signal?.aborted)throw new DOMException('已取消','AbortError');
      if(requestedEpoch===epoch)cache.set(id,blob);return blob;
    }catch(error){if(error.name!=='AbortError')failures.set(id,{time:Date.now(),message:error.message});while(failures.size>100)failures.delete(failures.keys().next().value);throw error;}},signal);
  }
  function release(record){record.controller?.abort();record.controller=null;if(record.objectUrl)URL.revokeObjectURL(record.objectUrl);record.objectUrl=null;record.img.removeAttribute('src');}
  async function load(record){if(record.controller||record.objectUrl)return;const controller=new AbortController();record.controller=controller;record.img.classList.remove('image-failed');
    try{const blob=await get(record.uid,record.work,controller.signal);if(record.controller!==controller||!bindings.has(record.img))return;record.objectUrl=URL.createObjectURL(blob);record.img.src=record.objectUrl;record.img.title='';}
    catch(error){if(error.name!=='AbortError'&&record.controller===controller){record.img.classList.add('image-failed');record.img.title=error.message;record.img.alt='图片未加载：'+error.message;record.error?.(error);}}
  }
  const observer=new IntersectionObserver(entries=>{for(const entry of entries){const r=bindings.get(entry.target);if(!r)continue;if(entry.isIntersecting)load(r);else release(r);}},{rootMargin:'300px'});
  function bind(img,uid,work,group,error){unbind(img);const record={img,uid,work,group,error};bindings.set(img,record);img.decoding='async';img.onerror=()=>{if(record.objectUrl){img.classList.add('image-failed');img.title='图片内容无法解码';}};observer.observe(img);}
  function unbind(img){const r=bindings.get(img);if(r){observer.unobserve(img);release(r);bindings.delete(img);}}
  function dispose(group){for(const [img,r] of bindings)if(r.group===group)unbind(img);}
  function clear(){cache.clear();failures.clear();for(const r of bindings.values()){release(r);observer.unobserve(r.img);observer.observe(r.img);}}
  window.ArtistImages={bind,dispose,get,clear,setFolder(value){for(const img of [...bindings.keys()])unbind(img);cache.clear();failures.clear();epoch++;folder=value;},stats(){return {bytes:cache.bytes,entries:cache.items.size,active:queue.active,queued:queue.waiting.length,bound:bindings.size};},async dataUrl(uid,w,signal){const blob=await get(uid,w,signal);return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});}};
})();
